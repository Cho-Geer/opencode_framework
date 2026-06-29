// gate-after.ts — "tool.execute.after" plugin: compliance gate lifecycle
// Phase 3B migration: delegates drain to service/gate/drain
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { drainStaleSessions } from "../service/gate/drain";

export default withPluginLifecycle("gate-after", { "tool.execute.after": toolExecuteAfter });

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);

  // Periodic stale session drain (on compliance gate tools)
  const isGateTool = input.tool?.startsWith("compliance-gate_compliance_gate");

  if (isGateTool) {
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
}
