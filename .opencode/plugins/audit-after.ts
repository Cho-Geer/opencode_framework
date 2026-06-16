// audit-after.ts — "tool.execute.after" plugin: audit trail management
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { isModifyTool, getModifyPath } from "../lib/tool-scope";
import { isSourceFile } from "../lib/state-utils";
import { atomicWriteMachine } from "../lib/uc7ks-schema";

export default withPluginLifecycle("audit-after", { "tool.execute.after": toolExecuteAfter });

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
    atomicWriteMachine((m) => {
      m.write_audit_state = m.write_audit_state || { enabled: true, current_session: null, history: [] };
      m.write_audit_state.history = m.write_audit_state.history || [];
      m.write_audit_state.history.push({
        file: filePath,
        tool: input.tool,
        agent,
        sessionID: input.sessionID,
        timestamp: new Date().toISOString(),
      });
      if (m.write_audit_state.history.length > 200) {
        m.write_audit_state.history = m.write_audit_state.history.slice(-200);
      }
    });
  } catch (err: any) {
    writeLog("audit-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      level: "ERROR", event: "TOOL-AFTER",
      detail: "audit-state update failed: " + err.message,
    });
  }
}
