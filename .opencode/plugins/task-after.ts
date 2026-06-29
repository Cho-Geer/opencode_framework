// task-after.ts — "tool.execute.after" plugin: task failure recording
// Phase 3: Pure middleware — delegates to GateService + compaction hook
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { trackTaskComplete, getGateReminderText } from "../service/gate";

export default withPluginLifecycle("task-after", {
  "tool.execute.after": toolExecuteAfter,
  "experimental.session.compacting": compactionHook,
});

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  trackTaskComplete({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    args: input.args || {},
    output,
  });
}

/**
 * Point 3b: push armed gate reminder into compaction context.
 */
async function compactionHook(input: any, output: any): Promise<void> {
  try {
    const text = getGateReminderText();
    if (!text) return;
    if (!output || typeof output.context?.push !== "function") return;
    output.context.push(text);
  } catch {
    // Best-effort
  }
}
