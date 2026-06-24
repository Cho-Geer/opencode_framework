// gate-after.ts — "tool.execute.after" plugin: compliance gate lifecycle
import * as fs from "node:fs";
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { autoDrainStaleSessions } from "../lib/gate-checks";
import { STATE_PATHS } from "../lib/state-utils";

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
      const stale = autoDrainStaleSessions(STATE_PATHS);
      if (stale > 0) {
        writeLog("gate-after", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent,
          event: "TOOL-AFTER",
          detail: `stale-drain | drained=${stale}`,
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
