import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { ghPrCreate } from "../service/repo/gh";
import { hasRepoGrant, consumeRepoGrant } from "../service/repo/grants";
import { auditRepoRemoteWriteBlocked, auditRepoClassified } from "../service/repo/audit";
import { classifyGhArgv } from "../service/repo/classify";
import { writeLog } from "../lib/log-manager";

export default tool({
  description: "Create a GitHub pull request (requires remote_repo_write grant + human confirmation)",
  args: {
    title: tool.schema.string().describe("PR title"),
    body: tool.schema.string().optional().describe("PR body/description"),
    base: tool.schema.string().optional().describe("Base branch (default: main)"),
    head: tool.schema.string().optional().describe("Head branch"),
    dryRun: tool.schema.boolean().optional().describe("Preview without creating"),
  },
  execute: async (args, context) => {
    return withInterruptGuard("safe_gh_pr_create", async () => {
      const op = classifyGhArgv(["gh", "pr", "create"]);
      auditRepoClassified(op, context.sessionID);

      const grant = hasRepoGrant(
        context.sessionID,
        "remote_repo_write",
        "safe_gh_pr_create",
      );

      if (!grant) {
        auditRepoRemoteWriteBlocked(context.sessionID, context.agent || "unknown", "safe_gh_pr_create",
          "No active remote_repo_write grant with human confirmation");
        throw new Error(
          "[REPO-REMOTE-WRITE-BLOCKED] No active remote_repo_write grant.\n" +
          "safe_gh_pr_create requires human confirmation before creating a PR.\n" +
          "Request Orchestrator to dispatch with dispatch_privilege=remote_repo_write, then call confirm_repo_grant."
        );
      }

      const result = ghPrCreate({
        title: args.title,
        body: args.body,
        base: args.base,
        head: args.head,
        dryRun: args.dryRun,
      });

      if (!result.ok) {
        throw new Error(`[REPO-PR-CREATE-FAILED] ${result.stderr}`);
      }

      if (!args.dryRun) {
        consumeRepoGrant(grant.id);
      }

      writeLog("repo-operation-runtime", "INFO", {
        event: "REPO-PR-CREATE-SUCCESS",
        session_id: context.sessionID,
        agent: context.agent,
        title: args.title,
        dryRun: args.dryRun,
        grant_id: grant.id,
      });

      return JSON.stringify({
        ok: true,
        tool: "safe_gh_pr_create",
        operationKind: "remote_write",
        provider: "gh",
        grantId: grant.id,
        dryRun: args.dryRun || false,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
  },
});
