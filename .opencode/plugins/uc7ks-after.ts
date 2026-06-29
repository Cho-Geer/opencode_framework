// uc7ks-after.ts — "tool.execute.after" plugin: knowledge pipeline compliance
// Phase 3: Pure middleware — delegates to KnowledgeService
// Handles: Layer C tool audit, cache read tracking, post-write verification.
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { trackKnowledgeAfter } from "../service/knowledge";

export default withPluginLifecycle("uc7ks-after", {
  "tool.execute.after": toolExecuteAfter,
});

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  trackKnowledgeAfter({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    args: input.args || {},
    output,
  });
}
