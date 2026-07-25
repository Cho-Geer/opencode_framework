import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { repoUnstage } from "../service/repo/git";
import { hasRepoGrant, toRepoRelativePath } from "../service/repo/grants";
import { auditRepoWriteGrantMissing, auditRepoClassified } from "../service/repo/audit";
import { classifyGitArgv } from "../service/repo/classify";
import { writeLog } from "../lib/log-manager";

export default tool({
  description: "Unstage specific files from the git index (requires repo_maintenance grant)",
  args: {
    paths: tool.schema.array(tool.schema.string()).describe("File paths to unstage (repo-relative)"),
    reason: tool.schema.string().optional().describe("Reason for unstaging"),
    dryRun: tool.schema.boolean().optional().describe("Validate without actually unstaging"),
  },
  execute: async (args, context) => {
    return withInterruptGuard("safe_repo_unstage", async () => {
      const op = classifyGitArgv(["git", "restore", "--staged"]);
      auditRepoClassified(op, context.sessionID);

      const normalizedPaths = args.paths.map((p) => toRepoRelativePath(p));

      const grant = hasRepoGrant(
        context.sessionID,
        "repo_maintenance",
        "safe_repo_unstage",
        normalizedPaths,
      );

      if (!grant) {
        auditRepoWriteGrantMissing(context.sessionID, context.agent || "unknown", "safe_repo_unstage", op);
        throw new Error(
          "[REPO-GRANT-MISSING] No active repo_maintenance grant for this session.\n" +
          "safe_repo_unstage requires a bound repo_maintenance grant."
        );
      }

      if (args.dryRun) {
        return JSON.stringify({
          ok: true,
          tool: "safe_repo_unstage",
          operationKind: "local_write",
          provider: "git",
          grantId: grant.id,
          paths: normalizedPaths,
          dryRun: true,
          stdout: "dry-run: files would be unstaged",
        });
      }

      const result = repoUnstage(normalizedPaths);

      if (!result.ok) {
        throw new Error(`[REPO-UNSTAGE-FAILED] ${result.stderr}`);
      }

      writeLog("repo-operation-runtime", "INFO", {
        event: "REPO-WRITE-UNSTAGED",
        session_id: context.sessionID,
        agent: context.agent,
        paths: normalizedPaths,
        grant_id: grant.id,
      });

      return JSON.stringify({
        ok: true,
        tool: "safe_repo_unstage",
        operationKind: "local_write",
        provider: "git",
        grantId: grant.id,
        paths: normalizedPaths,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
  },
});
