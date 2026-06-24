/**
 * checklist_status.ts — OpenCode custom tool: P0 checklist status query
 * ═══════════════════════════════════════════════════════════════════
 * Returns the current P0 checklist execution status for the active session.
 * Agents call this at the start of every task to learn their current phase,
 * pending blocking items, and remediation steps.
 *
 * This custom tool is READ-ONLY. It queries the execution_checklist tables
 * via execution-checklist.ts and returns a structured JSON summary.
 *
 * Usage:
 *   checklist_status({ task_id: "T-014" })
 *
 * Return format (JSON):
 *   {
 *     "run_id": "ecr_...",
 *     "phase": "read_attest",
 *     "status": "blocked",
 *     "pending_blockers": [
 *       {
 *         "item_key": "config_read_attested",
 *         "phase": "read_attest",
 *         "remediation": "Read agent config, opencode.json, project.config.json, then call config_read_attest(task_id)."
 *       }
 *     ],
 *     "next_action": "Complete blocking items above in order, then re-call checklist_status."
 *   }
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-22
 * @see docs/review/framework-refactor/db-canonical-p0-checklist-optimization-plan.md §4 Step 4
 */

import { tool } from "@opencode-ai/plugin";
import {
  createChecklistRun,
  getChecklistSummary,
  requireChecklistPassed,
} from "../lib/execution-checklist";

export default tool({
  description:
    "Query the current P0 checklist execution status. " +
    "Returns current phase, pending blocking items with remediation steps, " +
    "and the next required action. Agents MUST call this at task start " +
    "to learn what pre-flight items need completion.",

  args: {
    task_id: tool.schema
      .string()
      .describe("DAG task ID for checklist run lookup"),
  },

  async execute(args: { task_id?: string }, context: any) {
    const { agent, sessionID } = context;
    const taskId = args.task_id || "";
    const agentType = agent || "unknown";

    // Create or reuse checklist run for this session
    const run = createChecklistRun({
      opencode_session_id: sessionID,
      agent: agentType,
      task_id: taskId,
    });

    // Get current summary
    const summary = getChecklistSummary({ run_id: run.run_id });

    return JSON.stringify({
      run_id: summary.run_id,
      phase: summary.phase,
      status: summary.status,
      pending_blockers: summary.pending_blockers,
      next_action: summary.next_action,
    });
  },
});
