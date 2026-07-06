// ────────────────────────────────────────────────────────────────────
// LEGACY HANDLER — NOT in active execution_order
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/gate.ts — compliance gate lifecycle (stale drain)
// Migrated from plugins/gate-after.ts
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { drainStaleSessions } from "../../service/gate/drain";

export const name = "gate";
export const tools = ["*"]; // filters internally for gate tools

export async function handle(input: any, _output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);

  // Periodic stale session drain (on compliance gate tools)
  const isGateTool = input.tool?.startsWith("compliance-gate_compliance_gate");
  if (!isGateTool) return;

  writeLog("gate-after", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent,
    event: "TOOL-AFTER",
    detail: `gate-complete | tool=${input.tool}`,
  });

  try {
    const result = drainStaleSessions();
    if (result.purged > 0) {
      writeLog("gate-after", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent,
        event: "TOOL-AFTER",
        detail: `stale-drain | drained=${result.purged}`,
      });
    }
  } catch (err: any) {
    writeLog("gate-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent,
      level: "ERROR", event: "TOOL-AFTER",
      detail: "stale-drain failed: " + err.message,
    });
  }
}
