/**
 * advance_checklist_phase.ts — Advance P0 checklist phase (Thin Controller)
 * Delegates to GateService.detectAndAdvancePhase()
 * @see service/gate/checklist-lifecycle.ts
 */

import { tool } from "@opencode-ai/plugin";
import { detectAndAdvancePhase } from "../service/gate/";

export default tool({
  description:
    "Advance the P0 checklist to the next phase. Call this when " +
    "checklist_status shows all current-phase items passed but the " +
    "phase has not automatically advanced. Auto-detects current phase " +
    "and next phase from the checklist run.",

  args: {
    task_id: tool.schema.string().describe("DAG task ID for session tracking"),
  },

  async execute(args: { task_id?: string }, context: any) {
    const { agent, sessionID } = context;
    const taskId = args.task_id || "";

    const result = detectAndAdvancePhase({
      opencode_session_id: sessionID,
      agent: agent || "unknown",
      task_id: taskId,
    });

    return JSON.stringify(result);
  },
});
