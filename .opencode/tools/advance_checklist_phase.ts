/**
 * advance_checklist_phase.ts — OpenCode custom tool: advance P0 checklist phase
 * ═══════════════════════════════════════════════════════════════════
 * Advances the DB-canonical P0 checklist to the next phase when all
 * current-phase blocking items are passed.
 *
 * F-A FIX (2026-06-22): advanceChecklistPhase() has existed in
 * execution-checklist.ts since the DB-canonical migration, but was
 * never exposed as an OpenCode custom tool. In strict/locked mode,
 * sub-agents deadlock after dispatch — checklist_status returns
 * next_action="Call advanceChecklistPhase(...)" but no tool exists
 * to call it. This tool bridges that gap.
 *
 * The auto-advance in checklist-before.ts:283-307 only fires when a
 * modify/Task/gate tool is called. That's insufficient for the
 * dispatch_payload → preflight → read_attest transition, where the
 * agent is just calling read-only checkpoint tools.
 *
 * Auto-detects current_phase + next_phase from the checklist run
 * (no need for agent to know PHASE_ITEMS order).
 *
 * Usage:
 *   advance_checklist_phase({ task_id: "T-014" })
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-22
 * @see docs/review/framework-refactor/sa-unresolved-findings-root-cause-analysis.md §3 F-A
 */

import { tool } from "@opencode-ai/plugin";
import {
  createChecklistRun,
  getChecklistSummary,
  advanceChecklistPhase,
  PHASE_ITEMS,
} from "../lib/execution-checklist";
import { writeLog } from "../lib/log-manager";

const SRC = "tool-advance-checklist-phase";

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
    const agentType = agent || "unknown";

    // ── Resolve the checklist run for this session ──
    const run = createChecklistRun({
      opencode_session_id: sessionID,
      agent: agentType,
      task_id: taskId,
    });

    // ── Get current phase ──
    const summary = getChecklistSummary({ run_id: run.run_id });
    const currentPhase = summary.phase;

    // ── Determine next phase from PHASE_ITEMS key order ──
    const phases = Object.keys(PHASE_ITEMS);
    const idx = phases.indexOf(currentPhase);
    if (idx === -1) {
      const msg = `Unknown phase: ${currentPhase}`;
      writeLog(SRC, "ERROR", {
        event: "ADVANCE-CHECKLIST-PHASE-UNKNOWN",
        detail: msg,
        sessionID,
        agent: agentType,
      });
      return JSON.stringify({
        advanced: false,
        error: msg,
        current_phase: currentPhase,
        hint: "Run checklist_status(task_id) to see current state.",
      });
    }
    if (idx >= phases.length - 1) {
      writeLog(SRC, "WARN", {
        event: "ADVANCE-CHECKLIST-PHASE-FINAL",
        detail: `Already at final phase "${currentPhase}"`,
        sessionID,
        agent: agentType,
      });
      return JSON.stringify({
        advanced: false,
        error: `Already at final phase (${currentPhase}). No next phase to advance to.`,
        current_phase: currentPhase,
        hint: "All phases complete. Call compliance_gate_complete to close.",
      });
    }

    const nextPhase = phases[idx + 1];

    writeLog(SRC, "runtime", {
      event: "ADVANCE-CHECKLIST-PHASE",
      detail: `run_id=${run.run_id} from=${currentPhase} to=${nextPhase} agent=${agentType}`,
      sessionID,
      agent: agentType,
    });

    // ── Advance the phase ──
    const result = advanceChecklistPhase({
      run_id: run.run_id,
      current_phase: currentPhase,
      next_phase: nextPhase,
    });

    if (!result.advanced) {
      writeLog(SRC, "WARN", {
        event: "ADVANCE-CHECKLIST-PHASE-BLOCKED",
        detail: `run_id=${run.run_id} phase=${currentPhase} blockers=${result.blockers.map((b) => b.item_key).join(",")}`,
        sessionID,
        agent: agentType,
      });
    }

    return JSON.stringify({
      advanced: result.advanced,
      from_phase: currentPhase,
      to_phase: result.new_phase || nextPhase,
      blockers: result.blockers.map((b) => b.item_key),
      ...(result.blockers.length > 0 && {
        hint: "Some phase items are still blocking. Call checklist_status(task_id) for details.",
      }),
    });
  },
});
