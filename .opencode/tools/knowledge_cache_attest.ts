// tools/knowledge_cache_attest.ts — Thin Controller
// Phase 2: Delegates to KnowledgeService.attestCache()
import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { attestCache } from "../service/knowledge/cache-attest";

export default tool({
  description:
    "Agent-submitted read evidence attestation with self-declared cache sufficiency (M9). Verifies that the agent actually read the declared cache files (via read tool + read_audit cross-check). Prefix reason with '[INSUFFICIENT]' to declare cache insufficiency and BLOCK writes.",
  args: {
    domain: tool.schema.string().describe("Domain ID to attest (e.g., 'opencode_framework', 'backend_api')"),
    task_id: tool.schema.string().describe("DAG task ID for session tracking"),
    reason: tool.schema.string().describe("Agent-written reason: prefix with '[INSUFFICIENT]' to block writes. Default = sufficient."),
    files_read: tool.schema.array(tool.schema.string()).describe("NON-EMPTY list of cache file paths the agent ACTUALLY read."),
    content_summary: tool.schema.string().describe("Agent-written summary: WHAT was learned from the read files"),
  },
  async execute(args, context) {
    return withInterruptGuard("knowledge_cache_attest", async () => {
      const agent = (context && context.agent) || "unknown";
      const sessionId = (context && context.sessionID) || "";
      return attestCache({
        agent,
        sessionId,
        domain: args.domain,
        taskId: args.task_id || "",
        reason: args.reason || "",
        filesRead: args.files_read || [],
        contentSummary: args.content_summary || "",
      });
    });
  },
});
