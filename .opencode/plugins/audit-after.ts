// audit-after.ts — "tool.execute.after" plugin: audit trail management
import * as fs from "node:fs";
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent } from "../lib/agent-resolver";
import { isModifyTool, getModifyPath } from "../lib/tool-scope";
import { isSourceFile, STATE_PATHS } from "../lib/state-utils";

ensureLogDir();
writeLog("audit-after", "loaded", { event: "PLUGIN-LOADED", detail: "audit-after.ts" });
updateIndex("audit-after", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("audit-after", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.after" });
  return { "tool.execute.after": toolExecuteAfter };
}) as any;

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  if (!isModifyTool(input.tool)) return;

  // after-hook: args live in input.args
  const filePath = getModifyPath(input.args || {});
  if (!filePath || !isSourceFile(filePath)) return;

  const agent = resolveAgent(input.sessionID);

  writeLog("audit-after", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-AFTER",
    detail: `audit-track | tool=${input.tool} | file=${filePath}`,
  });

  // Persist write_audit_state to machine.json
  try {
    const mp = STATE_PATHS.machine();
    if (!fs.existsSync(mp)) return;
    const m = JSON.parse(fs.readFileSync(mp, "utf8"));
    m.write_audit_state = m.write_audit_state || { enabled: true, current_session: null, history: [] };
    m.write_audit_state.history = m.write_audit_state.history || [];
    m.write_audit_state.history.push({
      file: filePath,
      tool: input.tool,
      agent,
      sessionID: input.sessionID,
      timestamp: new Date().toISOString(),
    });
    // Keep last 200 entries
    if (m.write_audit_state.history.length > 200) {
      m.write_audit_state.history = m.write_audit_state.history.slice(-200);
    }
    fs.writeFileSync(mp, JSON.stringify(m, null, 2), "utf8");
  } catch (err: any) {
    writeLog("audit-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      level: "ERROR", event: "TOOL-AFTER",
      detail: "audit-state update failed: " + err.message,
    });
  }
}
