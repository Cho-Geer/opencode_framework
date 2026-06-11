// gate-after.ts — "tool.execute.after" plugin: compliance gate lifecycle
import * as fs from "node:fs";
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent } from "../lib/agent-resolver";
import { autoDrainStaleSessions } from "../lib/gate-checks";
import { STATE_PATHS } from "../lib/state-utils";

ensureLogDir();
writeLog("gate-after", "loaded", { event: "PLUGIN-LOADED", detail: "gate-after.ts" });
updateIndex("gate-after", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("gate-after", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.after" });
  return { "tool.execute.after": toolExecuteAfter };
}) as any;

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);

  // Periodic stale session drain (on compliance gate tools)
  const isGateTool = input.tool?.startsWith("compliance-gate_compliance_gate");

  if (isGateTool) {
    writeLog("gate-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-AFTER",
      detail: `gate-complete | tool=${input.tool}`,
    });

    try {
      const stale = autoDrainStaleSessions(STATE_PATHS);
      if (stale > 0) {
        writeLog("gate-after", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          event: "TOOL-AFTER",
          detail: `stale-drain | drained=${stale}`,
        });
      }
    } catch (err: any) {
      writeLog("gate-after", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR", event: "TOOL-AFTER",
        detail: "stale-drain failed: " + err.message,
      });
    }
  }
}
