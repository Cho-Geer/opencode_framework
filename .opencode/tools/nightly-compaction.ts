// tools/nightly-compaction.ts — Thin Controller
// Phase 2: Delegates to KnowledgeService.nightlyCompaction()
import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { nightlyCompaction } from "../service/knowledge/maintenance";

export default tool({
  description:
    "UC7KS Nightly Compaction — scheduled maintenance for knowledge cache. Runs janitor cleanup, prunes stale session_access entries, and updates knowledge_audit_state aggregate counters.",
  args: {
    compact_index: tool.schema.boolean().default(true).describe("If true, compact index.json by removing stale/duplicate entries"),
    prune_sessions: tool.schema.boolean().default(true).describe("If true, prune stale session_access entries from knowledge_cache_state"),
    max_session_age_days: tool.schema.number().default(30).describe("Maximum age of session_access entries before pruning"),
  },
  async execute(args, context) {
    return withInterruptGuard("nightly-compaction", async () => {
      return nightlyCompaction({
        compactIndex: args.compact_index !== false,
        pruneSessions: args.prune_sessions !== false,
        maxSessionAgeDays: args.max_session_age_days || 30,
      });
    });
  },
});
