// uc7ks-before.ts — "tool.execute.before" plugin: UC7KS knowledge pipeline enforcement
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { checkUC7KS } from "../lib/uc7ks-utils";
import { getEnforcementMode } from "../lib/gate-core";

export default withPluginLifecycle("uc7ks-before", { "tool.execute.before": toolExecuteBefore });

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const mode = getEnforcementMode();

  writeLog("uc7ks-before", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent,
    agentType: agent,
    event: "TOOL-BEFORE",
    detail: `enter | tool=${input.tool} | mode=${mode}`,
  });

  const blockReason = checkUC7KS(input.tool, agent, mode);
  if (blockReason) {
    // F6 (2026-06-11): Tag UC7-001c blocks with specific event type
    // for log-based diagnostics. Distinguishes evidence-incomplete blocks
    // from generic pipeline-not-started blocks.
    const isEvidenceBlock = blockReason.indexOf("UC7-001c") !== -1;
    const logEvent = isEvidenceBlock ? "UC7-001C-BLOCKED" : "TOOL-BEFORE";
    const logLevel = isEvidenceBlock ? "WARN" : "ERROR";

    writeLog("uc7ks-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      level: logLevel,
      event: logEvent,
      detail: `BLOCKED | ${blockReason.substring(0, 200)}`,
    });
    if (mode === "strict" || mode === "locked") throw new Error(blockReason);
    return;
  }

  writeLog("uc7ks-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-BEFORE",
    detail: "exit (pass)",
  });
}
