import type { ToolGovernanceContext } from "../context";
import type { ToolGovernanceDecision } from "../decision";
import { isRepoReadOperation } from "../../repo/classify";

// Sole adjudicator for repo operations. The tool-governance-handler pre-classifies
// shell commands (classifyRepoShellCommand) and GitHub MCP tools (classifyGithubMcpTool)
// and stores the result on ctx.repoOperation. codegraph.ts no longer performs repo-op
// adjudication (Phase 3 contraction).
export function evaluate(ctx: ToolGovernanceContext): ToolGovernanceDecision | null {
  const repoOp = ctx.repoOperation;
  if (!repoOp || repoOp.provider === "none") return null;

  if (isRepoReadOperation(repoOp)) {
    // Repo read is allowed — emit an explicit allow decision so the controller
    // records a precise, attributable allow log (ruleId/layer) for audit.
    return {
      outcome: "allow",
      ruleId: "REPO-OP",
      layer: "repo-policy",
      severity: "info",
      message: `[REPO-OP] ${repoOp.provider} ${repoOp.kind} read allowed`,
      details: { kind: repoOp.kind, provider: repoOp.provider, subcommand: repoOp.subcommand },
    };
  }

  return {
    outcome: "deny",
    ruleId: "REPO-OP",
    layer: "repo-policy",
    severity: "warn",
    message: `[REPO-OP] Direct ${repoOp.provider} ${repoOp.kind} operations are blocked. Use safe_repo_* first-class tools instead.`,
    details: { kind: repoOp.kind, provider: repoOp.provider, subcommand: repoOp.subcommand },
  };
}
