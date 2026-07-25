/**
 * knowledge_gap_report.ts — Knowledge coverage gap analysis (Thin Controller)
 * Delegates to KnowledgeService.gapReport()
 * @see service/knowledge/gap-report.ts
 */

import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { gapReport } from "../service/knowledge/";

export default tool({
  description:
    "Analyze knowledge cache coverage across all semantic domains. " +
    "Compare knowledge_semantic_map domains against index.json entries to identify gaps.",
  args: {},
  async execute(args, context) {
    return withInterruptGuard("knowledge_gap_report", async () => {
      const result = gapReport();
      return JSON.stringify(result);
    });
  },
});
