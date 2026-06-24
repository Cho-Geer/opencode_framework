// audit-after.ts — "tool.execute.after" plugin: audit trail management
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { isModifyTool, getModifyPath } from "../lib/tool-scope";
import { isSourceFile } from "../lib/state-utils";
import { atomicWriteSubState } from "../lib/state-utils";

export default withPluginLifecycle("audit-after", {
  "tool.execute.after": toolExecuteAfter,
});

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  if (!isModifyTool(input.tool)) return;

  // after-hook: args live in input.args
  const filePath = getModifyPath(input.args || {});
  if (!filePath) return;
  if (input.tool !== "safe_delete" && !isSourceFile(filePath)) return;

  const agent = resolveAgent(input.sessionID);

  writeLog("audit-after", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent,
    event: "TOOL-AFTER",
    detail: `audit-track | tool=${input.tool} | file=${filePath}`,
  });

  // Persist write_audit_state to write-audit-state.json (P1-B split)
  try {
    atomicWriteSubState("write_audit_state", (state) => {
      state.enabled = state.enabled ?? true;
      state.current_session = state.current_session ?? null;
      state.history = state.history ?? [];
      state.history.push({
        file: filePath,
        tool: input.tool,
        agent,
        sessionID: input.sessionID,
        timestamp: new Date().toISOString(),
      });
      if (state.history.length > 200) {
        state.history = state.history.slice(-200);
      }
    });
  } catch (err: any) {
    writeLog("audit-after", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      level: "ERROR",
      event: "TOOL-AFTER",
      detail: "audit-state update failed: " + err.message,
    });
  }
}
