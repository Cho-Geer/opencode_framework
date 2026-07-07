import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { execGit } from "../service/repo/git";
import { hasRepoGrant, consumeRepoGrant } from "../service/repo/grants";
import { auditRepoRemoteWriteBlocked, auditRepoClassified } from "../service/repo/audit";
import { classifyGitArgv } from "../service/repo/classify";
import { writeLog } from "../lib/log-manager";

export default tool({
  description: "Push commits to remote (requires remote_repo_write grant + human confirmation)",
  args: {
    remote: tool.schema.string().describe("Remote name (e.g., origin)"),
    branch: tool.schema.string().describe("Branch name to push"),
    dryRun: tool.schema.boolean().optional().describe("Preview push without executing"),
  },
  execute: async (args, context) => {
    return withInterruptGuard("safe_repo_push", async () => {
      const op = classifyGitArgv(["git", "push", args.remote, args.branch]);
      auditRepoClassified(op, context.sessionID);

      const grant = hasRepoGrant(
        context.sessionID,
        "remote_repo_write",
        "safe_repo_push",
        undefined,
        [args.remote],
      );

      if (!grant) {
        auditRepoRemoteWriteBlocked(context.sessionID, context.agent || "unknown", "safe_repo_push",
          "No active remote_repo_write grant with human confirmation");
        throw new Error(
          "[REPO-REMOTE-WRITE-BLOCKED] No active remote_repo_write grant for this session.\n" +
          "safe_repo_push requires a remote_repo_write grant WITH human confirmation.\n" +
          "Request Orchestrator to dispatch with dispatch_privilege=remote_repo_write."
        );
      }

      if (args.dryRun) {
        const result = execGit(["push", "--dry-run", args.remote, args.branch]);
        return JSON.stringify({
          ok: true,
          tool: "safe_repo_push",
          operationKind: "remote_write",
          provider: "git",
          grantId: grant.id,
          dryRun: true,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          remotes: [args.remote],
        });
      }

      const result = execGit(["push", args.remote, args.branch]);
      if (!result.ok) {
        throw new Error(`[REPO-PUSH-FAILED] ${result.stderr}`);
      }

      consumeRepoGrant(grant.id);

      writeLog("repo-operation-runtime", "INFO", {
        event: "REPO-REMOTE-PUSH-SUCCESS",
        session_id: context.sessionID,
        agent: context.agent,
        remote: args.remote,
        branch: args.branch,
        grant_id: grant.id,
      });

      return JSON.stringify({
        ok: true,
        tool: "safe_repo_push",
        operationKind: "remote_write",
        provider: "git",
        grantId: grant.id,
        remotes: [args.remote],
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
  },
});
