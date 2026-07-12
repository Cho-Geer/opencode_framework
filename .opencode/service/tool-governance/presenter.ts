import { writeLog } from "../../lib/log-manager";
import { writeJsonl } from "../../lib/jsonl-writer";
import type { ToolGovernanceContext } from "./context";
import type { ToolGovernanceDecision } from "./decision";

function severityToLogLevel(
  severity: ToolGovernanceDecision["severity"],
): "INFO" | "WARN" | "ERROR" {
  switch (severity) {
    case "info":
      return "INFO";
    case "warn":
      return "WARN";
    case "error":
      return "ERROR";
  }
}

export function presentBlock(ctx: ToolGovernanceContext, decision: ToolGovernanceDecision): Error {
  writeLog("tool-governance", "runtime", {
    sessionID: ctx.sessionID,
    callID: ctx.callID,
    agent: ctx.agent,
    tool: ctx.tool,
    level: severityToLogLevel(decision.severity),
    event: "GOVERNANCE-BLOCK",
    detail: `ruleId=${decision.ruleId} layer=${decision.layer} outcome=${decision.outcome}`,
  });
  writeJsonl("audit", {
    event: "governance_block",
    ruleId: decision.ruleId,
    layer: decision.layer,
    outcome: decision.outcome,
    tool: ctx.tool,
    agent: ctx.agent,
    sessionID: ctx.sessionID,
  }, { sessionID: ctx.sessionID, tool: ctx.tool });
  const fullMessage = `${decision.message}\nlayer=${decision.layer} outcome=${decision.outcome} tool=${ctx.tool} agent=${ctx.agent}`;
  return new Error(fullMessage);
}

export function presentAllow(ctx: ToolGovernanceContext, ruleId: string): void {
  writeLog("tool-governance", "runtime", {
    sessionID: ctx.sessionID,
    callID: ctx.callID,
    agent: ctx.agent,
    tool: ctx.tool,
    level: "INFO",
    event: "GOVERNANCE-ALLOW",
    detail: `ruleId=${ruleId} layer=allow outcome=allow`,
  });
  writeJsonl("audit", {
    event: "governance_allow",
    ruleId,
    layer: "allow",
    outcome: "allow",
    tool: ctx.tool,
    agent: ctx.agent,
    sessionID: ctx.sessionID,
  }, { sessionID: ctx.sessionID, tool: ctx.tool });
}
