import type { ToolGovernanceContext } from "../context";
import type { ToolGovernanceDecision } from "../decision";
import { readImpactState } from "../../file-guard/codegraph-state";
import { isCodeGraphExemptAgent, getCodeGraphExemptPatterns } from "../../enforcement/exemptions";
import { shouldBlock } from "../../enforcement/rule-disposition";

const SOURCE_EDIT_TOOLS = new Set(["safe_edit", "safe_delete", "safe_restore", "safe_framework_edit"]);

export function evaluate(ctx: ToolGovernanceContext): ToolGovernanceDecision | null {
  if (!SOURCE_EDIT_TOOLS.has(ctx.tool)) return null;
  if (!shouldBlock("source-edit-without-codegraph")) return null;
  if (isCodeGraphExemptAgent(ctx.agent)) return null;

  const filePath = ctx.targetPaths[0] || "";
  if (!filePath) return null;

  const patterns = getCodeGraphExemptPatterns();
  if (patterns.length > 0 && patterns.some((re) => re.test(filePath))) return null;

  const state = readImpactState();
  const sessionRecord = state.sessions[ctx.sessionID];
  if (sessionRecord?.impact_called) return null;

  return {
    outcome: "deny",
    ruleId: "CODEGRAPH-ENFORCE",
    layer: "impact-evidence",
    severity: "warn",
    message: `[CODEGRAPH-ENFORCE] ${ctx.tool} blocked: you must call codegraph_explore before modifying code.`,
    details: { tool: ctx.tool, filePath, agent: ctx.agent },
  };
}
