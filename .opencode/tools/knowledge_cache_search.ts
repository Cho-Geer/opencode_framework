// tools/knowledge_cache_search.ts — Thin Controller
// Phase 2: Delegates to KnowledgeService.searchCache()
import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { searchCache } from "../service/knowledge/cache-search";

export default tool({
  description:
    "Automated local knowledge cache search. Reads docs/official_docs/index.json, matches entries by domain/tags, records UC7-001 compliance in machine.json.",
  args: {
    domain: tool.schema.string().describe("Domain ID to search for (e.g., backend_api, persistence)"),
    task_id: tool.schema.string().describe("DAG task ID for session tracking"),
  },
  async execute(args, context) {
    return withInterruptGuard("knowledge_cache_search", async () => {
      const agent = (context && context.agent) || "unknown";
      const sessionId = (context as any)?.sessionID;
      return searchCache({
        domain: args.domain,
        taskId: args.task_id,
        agent,
        sessionId,
      });
    });
  },
});
