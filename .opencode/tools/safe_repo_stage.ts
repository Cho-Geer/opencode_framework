import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { repoStage } from "../service/repo/git";
import { hasRepoGrant, toRepoRelativePath, assertNoRuntimeStatePaths } from "../service/repo/grants";
import { auditRepoWriteGrantMissing, auditRepoWriteStaged, auditRepoClassified } from "../service/repo/audit";
import { classifyGitArgv } from "../service/repo/classify";
import { writeLog } from "../lib/log-manager";

export default tool({
  description: "Stage specific files for commit (requires repo_maintenance grant)",
  args: {
    paths: tool.schema.array(tool.schema.string()).describe("File paths to stage (repo-relative, no wildcards)"),
    reason: tool.schema.string().optional().describe("Reason for staging these files"),
    dryRun: tool.schema.boolean().optional().describe("Validate without actually staging"),
  },
  execute: async (args, context) => {
    return withInterruptGuard("safe_repo_stage", async () => {
      const op = classifyGitArgv(["git", "add"]);
      auditRepoClassified(op, context.sessionID);

      const normalizedPaths = args.paths.map((p) => toRepoRelativePath(p));
      assertNoRuntimeStatePaths(normalizedPaths);

      const grant = hasRepoGrant(
        context.sessionID,
        "repo_maintenance",
        "safe_repo_stage",
        normalizedPaths,
      );

      if (!grant) {
        auditRepoWriteGrantMissing(context.sessionID, context.agent || "unknown", "safe_repo_stage", op);
        throw new Error(
          "[REPO-GRANT-MISSING] No active repo_maintenance grant for this session.\n" +
          "safe_repo_stage requires a bound repo_maintenance grant.\n" +
          "Request Orchestrator to dispatch with dispatch_privilege=repo_maintenance."
        );
      }

      if (args.dryRun) {
        return JSON.stringify({
          ok: true,
          tool: "safe_repo_stage",
          operationKind: "local_write",
          provider: "git",
          grantId: grant.id,
          paths: normalizedPaths,
          dryRun: true,
          stdout: "dry-run: files would be staged",
        });
      }

      const result = repoStage(normalizedPaths);

      if (!result.ok) {
        throw new Error(`[REPO-STAGE-FAILED] ${result.stderr}`);
      }

      auditRepoWriteStaged(context.sessionID, context.agent || "unknown", "safe_repo_stage", normalizedPaths, grant.id);

      writeLog("repo-operation-runtime", "INFO", {
        event: "REPO-WRITE-STAGED",
        session_id: context.sessionID,
        agent: context.agent,
        paths: normalizedPaths,
        grant_id: grant.id,
      });

      return JSON.stringify({
        ok: true,
        tool: "safe_repo_stage",
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
