// dispatch-after.ts — "tool.execute.after" plugin: dispatch lifecycle tracking
// Phase 3: Pure middleware — delegates to DispatchService
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { cleanupDispatch } from "../service/dispatch";

export default withPluginLifecycle("dispatch-after", {
  "tool.execute.after": toolExecuteAfter,
});

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  cleanupDispatch({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    args: input.args || {},
  });
}
