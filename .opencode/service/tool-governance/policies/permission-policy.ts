import type { ToolGovernanceContext } from "../context";
import type { ToolGovernanceDecision } from "../decision";
import { getAgentShellAllowlist } from "../../permission/reader";
import { matchGlob } from "../../file-guard/shell-config";

export function evaluate(ctx: ToolGovernanceContext): ToolGovernanceDecision | null {
  if (ctx.tool !== "safe_shell" && ctx.tool !== "bash") return null;
  if (!ctx.command) return null;

  const shellResult = getAgentShellAllowlist(ctx.agent);
  if (shellResult.toolDenied) {
    return {
      outcome: "deny",
      ruleId: "SHELL-TOOL-DENIED",
      layer: "static-permission",
      severity: "error",
      message: `[SHELL-TOOL-DENIED] safe_shell denied by opencode.json permission for agent ${ctx.agent}.`,
      details: { agent: ctx.agent },
    };
  }
  if (shellResult.denied.some((p: string) => matchGlob(ctx.command!, p))) {
    return {
      outcome: "deny",
      ruleId: "SHELL-CMD-DENIED",
      layer: "static-permission",
      severity: "error",
      message: `[SHELL-CMD-DENIED] Command denied by opencode.json safe_shell permission.`,
      details: { command: ctx.command!.slice(0, 120) },
    };
  }
  if (shellResult.needsConfirmation.some((p: string) => matchGlob(ctx.command!, p))) {
    return {
      outcome: "ask",
      ruleId: "SHELL-CMD-ASK",
      layer: "static-permission",
      severity: "warn",
      message: `[SHELL-CMD-ASK] Command requires confirmation (non-interactive: blocked).`,
      details: { command: ctx.command!.slice(0, 120) },
    };
  }
  return null;
}
