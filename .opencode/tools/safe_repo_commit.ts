import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { repoCommit, getStagedFiles, assertStagedFilesAllowed } from "../service/repo/git";
import { hasRepoGrant, consumeRepoGrant, toRepoRelativePath, assertNoRuntimeStatePaths } from "../service/repo/grants";
import {
  auditRepoWriteGrantMissing,
  auditRepoCommitSuccess,
  auditRepoCommitHookFailed,
  auditRepoClassified,
} from "../service/repo/audit";
import { classifyGitArgv } from "../service/repo/classify";
import { writeLog } from "../lib/log-manager";

export default tool({
  description: "Create a git commit with staged files (requires repo_maintenance grant, grant consumed on success)",
  args: {
    message: tool.schema.string().describe("Commit message"),
    expectedPaths: tool.schema.array(tool.schema.string()).describe("Expected staged file paths (repo-relative, must match exactly)"),
    reason: tool.schema.string().optional().describe("Reason for this commit"),
    dryRun: tool.schema.boolean().optional().describe("Validate without actually committing"),
  },
  execute: async (args, context) => {
    return withInterruptGuard("safe_repo_commit", async () => {
      const op = classifyGitArgv(["git", "commit"]);
      auditRepoClassified(op, context.sessionID);

      const message = args.message;
      if (!message || message.trim().length === 0) {
        throw new Error("[REPO-COMMIT-EMPTY-MESSAGE] Commit message must not be empty.");
      }

      const msgLower = message.toLowerCase();
      if (msgLower.includes("--no-verify") || msgLower.includes("[bypass") ||
          msgLower.includes("core.hookspath") || msgLower.includes("core.skiphooks")) {
        throw new Error("[REPO-HOOK-BYPASS-BLOCKED] Commit message contains hook bypass indicators.");
      }

      const normalizedPaths = args.expectedPaths.map((p) => toRepoRelativePath(p));
      if (normalizedPaths.length === 0) {
        throw new Error("[REPO-COMMIT-NO-PATHS] expectedPaths must not be empty.");
      }
      assertNoRuntimeStatePaths(normalizedPaths);

      const grant = hasRepoGrant(
        context.sessionID,
        "repo_maintenance",
        "safe_repo_commit",
        normalizedPaths,
      );

      if (!grant) {
        auditRepoWriteGrantMissing(context.sessionID, context.agent || "unknown", "safe_repo_commit", op);
        throw new Error(
          "[REPO-GRANT-MISSING] No active repo_maintenance grant for this session.\n" +
          "safe_repo_commit requires a bound repo_maintenance grant.\n" +
          "Request Orchestrator to dispatch with dispatch_privilege=repo_maintenance."
        );
      }

      const stagedFiles = getStagedFiles();
      if (stagedFiles.length === 0) {
        throw new Error("[REPO-STAGED-EMPTY] No files are staged for commit. Use safe_repo_stage first.");
      }

      assertStagedFilesAllowed(normalizedPaths);
      assertNoRuntimeStatePaths(stagedFiles);

      if (args.dryRun) {
        return JSON.stringify({
          ok: true,
          tool: "safe_repo_commit",
          operationKind: "local_write",
          provider: "git",
          grantId: grant.id,
          paths: stagedFiles,
          dryRun: true,
          stdout: `dry-run: would commit ${stagedFiles.length} files with message: ${message}`,
        });
      }

      const result = repoCommit(message);

      if (!result.ok) {
        if (result.stderr && result.stderr.includes("hook")) {
          auditRepoCommitHookFailed(context.sessionID, context.agent || "unknown", result.stderr, grant.id);
        }
        throw new Error(
          `[REPO-COMMIT-HOOK-FAILED] Git commit failed (exit ${result.exitCode}).\n` +
          `Grant NOT consumed — retry after fixing the issue.\n` +
          `stderr: ${result.stderr.slice(0, 500)}`
        );
      }

      consumeRepoGrant(grant.id);

      auditRepoCommitSuccess(
        context.sessionID,
        context.agent || "unknown",
        result.commitSha || "unknown",
        stagedFiles,
        grant.id,
      );

      writeLog("repo-operation-runtime", "INFO", {
        event: "REPO-COMMIT-SUCCESS",
        session_id: context.sessionID,
        agent: context.agent,
        commit_sha: result.commitSha,
        paths: stagedFiles,
        grant_id: grant.id,
      });

      return JSON.stringify({
        ok: true,
        tool: "safe_repo_commit",
        operationKind: "local_write",
        provider: "git",
        grantId: grant.id,
        commitSha: result.commitSha,
        paths: stagedFiles,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
  },
});
