/**
 * checklist_status.ts — P0 checklist status query (Thin Controller)
 * Delegates to GateService: createChecklistRun + getChecklistSummary
 * @see service/gate/checklist-lifecycle.ts
 */

import { tool } from "@opencode-ai/plugin";
import {
  createChecklistRun,
  getChecklistSummary,
} from "../service/gate/";

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

    const run = createChecklistRun({
      opencode_session_id: sessionID,
      agent: agent || "unknown",
      task_id: taskId,
    });

    const summary = getChecklistSummary(run.run_id);

    return JSON.stringify({
      run_id: summary.run_id,
      phase: summary.phase,
      status: summary.status,
      pending_blockers: summary.pending_blockers,
      next_action: summary.next_action,
    });
  },
});
