// dispatch-auto.ts — "tool.execute.after" plugin: auto-dispatch marker cleanup
// Phase 3: Pure middleware — delegates to DispatchService
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { reclaimAutoDispatch } from "../service/dispatch";

export default withPluginLifecycle("dispatch-auto", {
  "tool.execute.after": toolExecuteAfter,
});

async function toolExecuteAfter(input: any, _output: any): Promise<void> {
  reclaimAutoDispatch({
    sessionID: input.sessionID,
    callID: input.callID,
  });
}
