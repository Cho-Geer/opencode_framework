// ────────────────────────────────────────────────────────────────────
// LEGACY HANDLER — NOT in active execution_order
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/before/uc7ks.ts — UC7KS knowledge pipeline enforcement
// Migrated from plugins/uc7ks-before.ts
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { checkUC7KS } from "../../lib/uc7ks-utils";
import { shouldBlock } from "../../service/enforcement/rule-disposition";

export const name = "uc7ks";
export const tools = ["*"];

export async function handle(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const policy = shouldBlock("knowledge-external-query")
    ? "knowledge-external-query:block"
    : "knowledge-external-query:audit";

  writeLog("uc7ks-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent,
    agentType: agent, event: "TOOL-BEFORE",
    detail: `enter | tool=${input.tool} | policy=${policy}`,
  });

  const blockReason = checkUC7KS(input.tool, agent);
  if (blockReason) {
    const isEvidenceBlock = blockReason.indexOf("UC7-001c") !== -1;
    const logEvent = isEvidenceBlock ? "UC7-001C-BLOCKED" : "TOOL-BEFORE";
    const logLevel = shouldBlock("knowledge-external-query") ? "ERROR" : "WARN";

    writeLog("uc7ks-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      level: logLevel, event: logEvent,
      detail: `${shouldBlock("knowledge-external-query") ? "BLOCKED" : "AUDIT"} | ${blockReason.substring(0, 200)}`,
    });
    if (shouldBlock("knowledge-external-query")) throw new Error(blockReason);
    return;
  }

  writeLog("uc7ks-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-BEFORE", detail: "exit (pass)",
  });
}
