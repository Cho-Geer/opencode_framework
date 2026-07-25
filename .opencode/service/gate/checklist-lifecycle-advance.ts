// service/gate/checklist-lifecycle-advance.ts — Checklist phase advancement
// Split from: checklist-lifecycle.ts
// Source: execution-checklist.ts (advanceChecklistPhase)

import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";
import {
  now,
  type ChecklistBlockerItem,
  type AdvanceChecklistPhaseInput,
  type AdvanceChecklistPhaseResult,
} from "./checklist-phase";

const SRC = "execution-checklist";

// ════════════════════════════════════════════════
// advanceChecklistPhase
// ════════════════════════════════════════════════

export function advanceChecklistPhase(
  input: AdvanceChecklistPhaseInput,
): AdvanceChecklistPhaseResult {
  const db = getDb();
  const ts = now();

  // Check all items in current phase are passed
  const blockers = db
    .query(
      `SELECT item_key, phase, remediation, fail_reason
       FROM execution_checklist_items
       WHERE run_id = ? AND phase = ? AND status != 'passed'`,
    )
    .all(input.run_id, input.current_phase) as ChecklistBlockerItem[];

  if (blockers.length > 0) {
    writeLog(SRC, "runtime", {
      event: "CHECKLIST-PHASE-ADVANCE-BLOCKED",
      detail: `run_id=${input.run_id} phase=${input.current_phase} blockers=${blockers.length}`,
    });
    return { advanced: false, blockers };
  }

  db.run(
    `UPDATE execution_checklist_runs
     SET phase = ?, updated_at = ?
     WHERE run_id = ?`,
    [input.next_phase, ts, input.run_id],
  );

  writeLog(SRC, "runtime", {
    event: "CHECKLIST-PHASE-ADVANCED",
    detail: `run_id=${input.run_id} ${input.current_phase} → ${input.next_phase}`,
  });

  return { advanced: true, blockers: [], new_phase: input.next_phase };
}
