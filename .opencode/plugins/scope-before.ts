// scope-before.ts — "tool.execute.before" plugin: write scope enforcement
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent } from "../lib/agent-resolver";
import { isModifyTool, getModifyPath, readDispatchAllowedTools, isToolAllowed } from "../lib/tool-scope";
import { getEnforcementMode } from "../lib/gate-core";

ensureLogDir();
writeLog("scope-before", "loaded", { event: "PLUGIN-LOADED", detail: "scope-before.ts" });
updateIndex("scope-before", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("scope-before", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.before" });
  return { "tool.execute.before": toolExecuteBefore };
}) as any;

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const mode = getEnforcementMode();

  writeLog("scope-before", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent,
    agentType: agent,
    event: "TOOL-BEFORE",
    detail: `enter | tool=${input.tool} | mode=${mode}`,
  });

  // Only enforce scope for modify tools
  if (!isModifyTool(input.tool)) {
    writeLog("scope-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: "exit (pass) non-modify tool",
    });
    return;
  }

  const filePath = getModifyPath(output.args || {});
  if (!filePath) {
    writeLog("scope-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: "exit (pass) no file path",
    });
    return;
  }

  // Agent dispatch tool check
  const allowedTools = readDispatchAllowedTools(agent);
  if (!isToolAllowed(allowedTools, input.tool)) {
    const msg = `[FW-ENFORCE] Agent "${agent}" not allowed to use tool "${input.tool}"`;
    writeLog("scope-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      level: "ERROR",
      event: "TOOL-BEFORE",
      detail: `BLOCKED | ${msg}`,
    });
    if (mode === "strict" || mode === "locked") throw new Error(msg);
    return;
  }

  writeLog("scope-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-BEFORE",
    detail: `exit (ok) tool=${input.tool} file=${filePath}`,
  });
}
