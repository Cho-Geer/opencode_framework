import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { ghPrComment } from "../service/repo/gh";
import { hasRepoGrant, consumeRepoGrant } from "../service/repo/grants";
import { auditRepoRemoteWriteBlocked, auditRepoClassified } from "../service/repo/audit";
import { classifyGhArgv } from "../service/repo/classify";
import { writeLog } from "../lib/log-manager";

export default tool({
  description: "Add a comment to a GitHub pull request (requires remote_repo_write grant + human confirmation)",
  args: {
    pr: tool.schema.union([tool.schema.string(), tool.schema.number()]).describe("PR number or URL"),
    body: tool.schema.string().describe("Comment body text"),
  },
  execute: async (args, context) => {
    return withInterruptGuard("safe_gh_pr_comment", async () => {
      const op = classifyGhArgv(["gh", "pr", "comment"]);
      auditRepoClassified(op, context.sessionID);

      const grant = hasRepoGrant(
        context.sessionID,
        "remote_repo_write",
        "safe_gh_pr_comment",
      );

      if (!grant) {
        auditRepoRemoteWriteBlocked(context.sessionID, context.agent || "unknown", "safe_gh_pr_comment",
          "No active remote_repo_write grant with human confirmation");
        throw new Error(
          "[REPO-REMOTE-WRITE-BLOCKED] No active remote_repo_write grant.\n" +
          "Request Orchestrator to dispatch with dispatch_privilege=remote_repo_write, then call confirm_repo_grant."
        );
      }

      const result = ghPrComment({ pr: args.pr, body: args.body });

      if (!result.ok) {
        throw new Error(`[REPO-PR-COMMENT-FAILED] ${result.stderr}`);
      }

      consumeRepoGrant(grant.id);

      writeLog("repo-operation-runtime", "INFO", {
        event: "REPO-PR-COMMENT-SUCCESS",
        session_id: context.sessionID,
        agent: context.agent,
        pr: args.pr,
        grant_id: grant.id,
      });

      return JSON.stringify({
        ok: true,
        tool: "safe_gh_pr_comment",
        operationKind: "remote_write",
        provider: "gh",
        grantId: grant.id,
        stdout: result.stdout,
        exitCode: result.exitCode,
      });
    });
  },
});
