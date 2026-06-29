// cache-after.ts — "tool.execute.after" plugin: knowledge cache sync
// Phase 3: Pure middleware — delegates to KnowledgeService
// KC-08: Handles BOTH reads (index.json monitoring) AND writes (external fetches).
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { syncCacheState } from "../service/knowledge";

export default withPluginLifecycle("cache-after", {
  "tool.execute.after": toolExecuteAfter,
});

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  const filePath = (input.args as any)?.filePath || "";
  syncCacheState({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    filePath,
  });
}
