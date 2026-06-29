// service/gate/checklist-query.ts — Checklist query, summary, and phase auto-detection
// Split from checklist-lifecycle.ts to stay under file size limits.
// Source: execution-checklist.ts (require*, getSummary, detectAndAdvance)

import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";
import {
  PHASE_ITEMS,
  type RequireChecklistPassedInput,
  type RequireChecklistPassedResult,
  type ChecklistBlockerItem,
  type ChecklistSummary,
} from "./checklist-phase";
import {
  createChecklistRun,
  getChecklistSummary,
  advanceChecklistPhase,
} from "./checklist-lifecycle";

const SRC = "execution-checklist";

// ════════════════════════════════════════════════
// requireChecklistPassed
// ════════════════════════════════════════════════

export function requireChecklistPassed(
  input: RequireChecklistPassedInput,
): RequireChecklistPassedResult {
  const db = getDb();

  try {
    let query = `SELECT item_key, phase, remediation, fail_reason
       FROM execution_checklist_items
       WHERE run_id = ? AND status != 'passed'`;
    const params: any[] = [input.run_id];

    if (input.phase) {
      query += ` AND phase = ?`;
      params.push(input.phase);
    }
    if (input.item_key) {
      query += ` AND item_key = ?`;
      params.push(input.item_key);
    }

    const blockers = db.query(query).all(...params) as ChecklistBlockerItem[];

    return {
      passed: blockers.length === 0,
      blockers,
    };
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "CHECKLIST-REQUIRE-FAILED",
      detail: `run_id=${input.run_id} err=${e.message}`,
    });
    return {
      passed: false,
      blockers: [
        {
          item_key: "__error__",
          phase: "unknown",
          remediation: `Checklist query failed: ${e.message}`,
        },
      ],
    };
  }
}

// ════════════════════════════════════════════════
// getChecklistSummary
// ════════════════════════════════════════════════

export function getChecklistSummary(runId: string): ChecklistSummary | null {
  const db = getDb();

  try {
    const run = db
      .query(
        `SELECT phase, status FROM execution_checklist_runs WHERE run_id = ?`,
      )
      .get(runId) as { phase: string; status: string } | null;

    if (!run) return null;

    const blockers = db
      .query(
        `SELECT item_key, phase, remediation, fail_reason
         FROM execution_checklist_items
         WHERE run_id = ? AND status != 'passed'
         ORDER BY phase, item_key`,
      )
      .all(runId) as ChecklistBlockerItem[];

    let nextAction = "All items passed";
    if (blockers.length > 0) {
      const first = blockers[0];
      nextAction = first.remediation || `Resolve ${first.item_key}`;
    }

    return {
      run_id: runId,
      phase: run.phase,
      status: run.status,
      pending_blockers: blockers,
      next_action: nextAction,
    };
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "CHECKLIST-SUMMARY-FAILED",
      detail: `run_id=${runId} err=${e.message}`,
    });
    return null;
  }
}

// ════════════════════════════════════════════════
// detectAndAdvancePhase
// ════════════════════════════════════════════════

export interface DetectAndAdvancePhaseInput {
  opencode_session_id: string;
  agent: string;
  task_id: string;
}

export interface DetectAndAdvancePhaseResult {
  advanced: boolean;
  from_phase: string;
  to_phase: string;
  blockers: string[];
  error?: string;
  hint?: string;
}

/**
 * Create/reuse checklist run, detect current phase, determine next phase, advance.
 * Convenience wrapper for the advance_checklist_phase tool.
 */
export function detectAndAdvancePhase(
  input: DetectAndAdvancePhaseInput,
): DetectAndAdvancePhaseResult {
  const run = createChecklistRun({
    opencode_session_id: input.opencode_session_id,
    agent: input.agent,
    task_id: input.task_id,
  });

  const summary = getChecklistSummary(run.run_id);
  if (!summary) {
    return {
      advanced: false,
      from_phase: "unknown",
      to_phase: "unknown",
      blockers: [],
      error: "Failed to get checklist summary",
    };
  }

  const currentPhase = summary.phase;
  const phases = Object.keys(PHASE_ITEMS);
  const idx = phases.indexOf(currentPhase);

  if (idx === -1) {
    writeLog(SRC, "ERROR", {
      event: "ADVANCE-CHECKLIST-PHASE-UNKNOWN",
      detail: `Unknown phase: ${currentPhase}`,
    });
    return {
      advanced: false,
      from_phase: currentPhase,
      to_phase: currentPhase,
      blockers: [],
      error: `Unknown phase: ${currentPhase}`,
      hint: "Run checklist_status(task_id) to see current state.",
    };
  }

  if (idx >= phases.length - 1) {
    writeLog(SRC, "WARN", {
      event: "ADVANCE-CHECKLIST-PHASE-FINAL",
      detail: `Already at final phase "${currentPhase}"`,
    });
    return {
      advanced: false,
      from_phase: currentPhase,
      to_phase: currentPhase,
      blockers: [],
      error: `Already at final phase (${currentPhase}). No next phase to advance to.`,
      hint: "All phases complete. Call compliance_gate_complete to close.",
    };
  }

  const nextPhase = phases[idx + 1];

  writeLog(SRC, "runtime", {
    event: "ADVANCE-CHECKLIST-PHASE",
    detail: `run_id=${run.run_id} from=${currentPhase} to=${nextPhase} agent=${input.agent}`,
  });

  const result = advanceChecklistPhase({
    run_id: run.run_id,
    current_phase: currentPhase,
    next_phase: nextPhase,
  });

  if (!result.advanced) {
    writeLog(SRC, "WARN", {
      event: "ADVANCE-CHECKLIST-PHASE-BLOCKED",
      detail: `run_id=${run.run_id} phase=${currentPhase} blockers=${result.blockers.map((b) => b.item_key).join(",")}`,
    });
  }

  return {
    advanced: result.advanced,
    from_phase: currentPhase,
    to_phase: result.new_phase || nextPhase,
    blockers: result.blockers.map((b) => b.item_key),
    ...(result.blockers.length > 0
      ? { hint: "Some phase items are still blocking. Call checklist_status(task_id) for details." }
      : {}),
  };
}
