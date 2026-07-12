import type { ToolGovernanceContext } from "./context";
import { presentBlock, presentAllow } from "./presenter";
import { evaluate as evalPermission } from "./policies/permission-policy";
import { evaluate as evalPath } from "./policies/path-policy";
import { evaluate as evalRepo } from "./policies/repo-policy";
import { evaluate as evalEvidence } from "./policies/evidence-policy";
import { evaluate as evalGrant } from "./policies/grant-policy";
import { evaluate as evalShell } from "./policies/shell-policy";

const POLICIES = [evalPermission, evalPath, evalRepo, evalEvidence, evalGrant, evalShell];

export function evaluate(ctx: ToolGovernanceContext): void {
  let allowedByPolicy = false;
  for (const policy of POLICIES) {
    const decision = policy(ctx);
    if (decision === null) continue;
    if (decision.outcome === "deny") {
      throw presentBlock(ctx, decision);
    }
    if (decision.outcome === "ask") {
      throw presentBlock(ctx, decision);
    }
    if (decision.outcome === "allow") {
      // Precise, attributable allow log (ruleId@layer) — satisfies the
      // repo-op allow-logging gap from the Phase 3 contraction.
      presentAllow(ctx, `${decision.ruleId}@${decision.layer}`);
      allowedByPolicy = true;
      continue;
    }
  }
  if (!allowedByPolicy) presentAllow(ctx, "all-policies-passed");
}
