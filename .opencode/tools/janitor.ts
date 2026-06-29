// tools/janitor.ts — Thin Controller
// Phase 2: Delegates to KnowledgeService.runJanitor()
import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { runJanitor } from "../service/knowledge/maintenance";

export default tool({
  description:
    "UC7KS Knowledge Cache Janitor — detect and clean orphan/stale cache entries. Updates knowledge_audit_state counters with non-fatal error handling.",
  args: {
    dry_run: tool.schema.boolean().default(false).describe("If true, only report issues without modifying anything"),
    remove_orphans: tool.schema.boolean().default(false).describe("If true, remove orphan entries from index.json"),
    max_ttl_days: tool.schema.number().default(30).describe("Maximum TTL in days before an entry is considered stale"),
  },
  async execute(args, context) {
    return withInterruptGuard("janitor", async () => {
      return runJanitor({
        dryRun: args.dry_run || false,
        removeOrphans: args.remove_orphans || false,
        maxTtlDays: args.max_ttl_days || 30,
      });
    });
  },
});
