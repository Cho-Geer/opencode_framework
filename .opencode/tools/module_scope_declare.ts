/**
 * module_scope_declare.ts — Declare target module scope (Thin Controller)
 * Delegates to KnowledgeService.declareModuleScope()
 * @see service/knowledge/declare-scope.ts
 */

import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { declareModuleScope } from "../service/knowledge/";

export default tool({
  description:
    "Declare the target module scope for the current task. Maps module to knowledge domain, cache paths, and Context7 libraries. Called at task start (Step 0a) per UC7KS pipeline.",
  args: {
    module: tool.schema
      .string()
      .describe(
        "Target knowledge domain from knowledge_semantic_map (e.g., opencode_framework, backend_api)",
      ),
    task_id: tool.schema.string().describe("DAG task ID for session tracking"),
  },
  async execute(args, context) {
    return withInterruptGuard("module_scope_declare", async () => {
      const result = declareModuleScope({
        module: args.module,
        agent: context?.agent || "unknown",
        sessionID: context?.sessionID || "",
        taskId: args.task_id || "",
      });

      return JSON.stringify(result);
    });
  },
});
