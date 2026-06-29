// scope-after.ts — "tool.execute.after" plugin: post-write state tracking
// Phase 3: Pure middleware — delegates to FileGuardService
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { trackDirtyModule } from "../service/file-guard";

export default withPluginLifecycle("scope-after", {
  "tool.execute.after": toolExecuteAfter,
});

/**
 * after-hook: args live in input.args (before-hook uses output.args)
 * @see docs/official_docs/framework/mistake_precautions/double-hook-trigger-prevention.md
 */
async function toolExecuteAfter(input: any, output: any): Promise<void> {
  trackDirtyModule({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    args: input.args || {},
  });
}
