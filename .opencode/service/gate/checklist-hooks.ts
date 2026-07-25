// service/gate/checklist-hooks.ts — Lightweight wiring for tools → checklist items
// Migrated from lib/checklist-hooks.ts (Batch 3)

import {
  createChecklistRun,
  markChecklistPassed,
  markChecklistFailed,
} from "./checklist-lifecycle";
import { writeLog } from "../../lib/log-manager";

const SRC = "checklist-hooks";

/**
 * Mark a checklist item as passed for the given session.
 * Non-fatal: if no run exists or DB is unavailable, just logs a warning.
 */
export function checklistWirePassed(
  sessionID: string,
  agent: string,
  taskId: string | null,
  itemKey: string,
  evidence?: string,
): void {
  try {
    const run = createChecklistRun({
      opencode_session_id: sessionID,
      agent,
      task_id: taskId,
    });
    markChecklistPassed({
      run_id: run.run_id,
      item_key: itemKey,
      evidence_ref: evidence || null,
      actor: agent,
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "CHECKLIST-WIRE-FAILED",
      detail: `Cannot mark ${itemKey} passed: ${e.message}`,
    });
  }
}

/**
 * Mark a checklist item as failed for the given session.
 * Non-fatal: the enforcement plugin will block subsequent operations.
 */
export function checklistWireFailed(
  sessionID: string,
  agent: string,
  taskId: string | null,
  itemKey: string,
  reason: string,
  remediation?: string,
): void {
  try {
    const run = createChecklistRun({
      opencode_session_id: sessionID,
      agent,
      task_id: taskId,
    });
    markChecklistFailed({
      run_id: run.run_id,
      item_key: itemKey,
      fail_reason: reason,
      remediation: remediation || null,
      actor: agent,
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "CHECKLIST-WIRE-FAILED",
      detail: `Cannot mark ${itemKey} failed: ${e.message}`,
    });
  }
}
