import type { ToolGovernanceContext } from "../context";
import type { ToolGovernanceDecision } from "../decision";
import { getAllowlist, matchGlob, _hasAgentDangerousBypass } from "../../file-guard/shell-config";
import { isDangerous } from "../../file-guard/shell-guard";

export function evaluate(ctx: ToolGovernanceContext): ToolGovernanceDecision | null {
  if (ctx.tool !== "safe_shell" && ctx.tool !== "bash") return null;
  if (!ctx.command) return null;

  const allowlist = getAllowlist(ctx.agent);
  const hasBypass = _hasAgentDangerousBypass(ctx.agent, ctx.command);

  if (!hasBypass && isDangerous(ctx.command)) {
    return {
      outcome: "deny",
      ruleId: "DANGEROUS-PATTERN",
      layer: "tool-final-guard",
      severity: "error",
      message: `[DANGEROUS-PATTERN] Command matches blocked pattern.`,
      details: { command: ctx.command.slice(0, 120) },
    };
  }

  if (allowlist !== "ALL_ALLOWED" && !allowlist.some((p: string) => matchGlob(ctx.command!, p))) {
    return {
      outcome: "deny",
      ruleId: "NOT-IN-ALLOWLIST",
      layer: "tool-final-guard",
      severity: "error",
      message: `[NOT-IN-ALLOWLIST] Command not in agent ${ctx.agent} allowlist.`,
      details: { command: ctx.command.slice(0, 120), agent: ctx.agent },
    };
  }

  return null;
}
