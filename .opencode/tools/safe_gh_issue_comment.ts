import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { ghIssueComment } from "../service/repo/gh";
import { hasRepoGrant, consumeRepoGrant } from "../service/repo/grants";
import { auditRepoRemoteWriteBlocked, auditRepoClassified } from "../service/repo/audit";
import { classifyGhArgv } from "../service/repo/classify";
import { writeLog } from "../lib/log-manager";

export default tool({
  description: "Add a comment to a GitHub issue (requires remote_repo_write grant + human confirmation)",
  args: {
    issue: tool.schema.union([tool.schema.string(), tool.schema.number()]).describe("Issue number or URL"),
    body: tool.schema.string().describe("Comment body text"),
  },
  execute: async (args, context) => {
    return withInterruptGuard("safe_gh_issue_comment", async () => {
      const op = classifyGhArgv(["gh", "issue", "comment"]);
      auditRepoClassified(op, context.sessionID);

      const grant = hasRepoGrant(
        context.sessionID,
        "remote_repo_write",
        "safe_gh_issue_comment",
      );

      if (!grant) {
        auditRepoRemoteWriteBlocked(context.sessionID, context.agent || "unknown", "safe_gh_issue_comment",
          "No active remote_repo_write grant with human confirmation");
        throw new Error(
          "[REPO-REMOTE-WRITE-BLOCKED] No active remote_repo_write grant."
        );
      }

      const result = ghIssueComment({ issue: args.issue, body: args.body });

      if (!result.ok) {
        throw new Error(`[REPO-ISSUE-COMMENT-FAILED] ${result.stderr}`);
      }

      consumeRepoGrant(grant.id);

      writeLog("repo-operation-runtime", "INFO", {
        event: "REPO-ISSUE-COMMENT-SUCCESS",
        session_id: context.sessionID,
        agent: context.agent,
        issue: args.issue,
        grant_id: grant.id,
      });

      return JSON.stringify({
        ok: true,
        tool: "safe_gh_issue_comment",
        operationKind: "remote_write",
        provider: "gh",
        grantId: grant.id,
        stdout: result.stdout,
        exitCode: result.exitCode,
      });
    });
  },
});
