// gate-before.ts — "tool.execute.before" plugin: gate & DAG enforcement
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent } from "../lib/agent-resolver";
import { getEnforcementMode, findArmedSession } from "../lib/gate-core";
import { isModifyTool } from "../lib/tool-scope";

ensureLogDir();
writeLog("gate-before", "loaded", { event: "PLUGIN-LOADED", detail: "gate-before.ts" });
updateIndex("gate-before", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("gate-before", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.before" });
  return { "tool.execute.before": toolExecuteBefore };
}) as any;

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const mode = getEnforcementMode();

  writeLog("gate-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-BEFORE",
    detail: `enter | tool=${input.tool} | mode=${mode}`,
  });

  if (mode === "advisory") {
    writeLog("gate-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: "exit (skip) advisory mode",
    });
    return;
  }

  // Gate armed check for modify tools.
  // WHY: Previously used a hardcoded regex that omitted safe_shell, allowing
  // compliance gate bypass. Now uses isModifyTool() from tool-scope.ts which
  // correctly includes all 6 modify tools (write, edit, safe_edit, safe_mkdir,
  // safe_delete, safe_shell). See tdd-integration.md §3 for bug analysis.
  if (isModifyTool(input.tool)) {
    const session = findArmedSession();
    if (!session) {
      const msg = `[FW-ENFORCE][GATE] No armed compliance gate session. Call compliance_gate_check + compliance_gate_confirm first.`;
      writeLog("gate-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR",
        event: "TOOL-BEFORE",
        detail: `BLOCKED | no armed gate`,
      });
      if (mode === "strict" || mode === "locked") throw new Error(msg);
      return;
    }
    writeLog("gate-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: `gate armed | id=${session.sessionId}`,
    });
  }

  writeLog("gate-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-BEFORE",
    detail: "exit (pass)",
  });
}
