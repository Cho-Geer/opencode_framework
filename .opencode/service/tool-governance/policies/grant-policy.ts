import type { ToolGovernanceContext } from "../context";
import type { ToolGovernanceDecision } from "../decision";

const GRANT_TOOLS = new Set(["safe_repo_stage", "safe_repo_unstage", "safe_repo_commit", "safe_repo_push", "safe_gh_pr_create", "safe_gh_pr_comment", "safe_gh_issue_comment"]);

export function evaluate(ctx: ToolGovernanceContext): ToolGovernanceDecision | null {
  if (!GRANT_TOOLS.has(ctx.tool)) return null;

  return {
    outcome: "audit_only",
    ruleId: "GRANT-CHECK-DELEGATED",
    layer: "grant",
    severity: "info",
    message: `Grant check is delegated to the tool's own validation (hasRepoGrant / hasGrant).`,
    details: { tool: ctx.tool },
  };
}
