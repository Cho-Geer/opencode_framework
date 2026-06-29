// service/gate/dispatch-integrity.ts — Dispatch task_id integrity validation
// ═══════════════════════════════════════════════════════════════
// Extracted from scripts/mcp-tools/compliance-gate.ts (runGateCheck L860-1020)
// Validates that sub-agents use the correct task_id assigned by Orchestrator.
// Prevents fabrication of task_ids to bypass gate mutual exclusion.
// ═══════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { getProjectRoot, loadGateStore } from "./store-crud";

const SRC = "service-gate-dispatch-integrity";

export interface DispatchIntegrityResult {
  hasDispatchContext: boolean;
  dispatchAssignedTaskIds: string[];
  resolvedTaskId: string | null;
  integrityViolation: boolean;
  violationReason?: string;
  conflictSessionId?: string;
  conflictReason?: string;
}

/**
 * Validate dispatch task_id integrity.
 *
 * Uses session_map DB (per-session dag_task_id records) to verify that
 * the sub-agent's task_id matches what Orchestrator assigned.
 *
 * Also checks for mutual exclusion: if an active gate session already
 * exists for this task_id, the agent must use it rather than create a new one.
 *
 * @param taskId - The task_id provided by the caller (may be undefined)
 * @returns DispatchIntegrityResult with validation results
 */
export function validateDispatchTaskIntegrity(
  taskId?: string | null,
): DispatchIntegrityResult {
  const result: DispatchIntegrityResult = {
    hasDispatchContext: false,
    dispatchAssignedTaskIds: [],
    resolvedTaskId: taskId || null,
    integrityViolation: false,
  };

  try {
    if (taskId) {
      // Check if taskId matches a registered dispatch in session_map
      const sessions = dbQuerySessionByDagTaskId(taskId);
      if (sessions.length > 0) {
        result.hasDispatchContext = true;
        result.dispatchAssignedTaskIds = [taskId];
      } else {
        // taskId not found — check if ANY dispatch context exists
        try {
          const { getDb } = require("../../lib/db-manager");
          const db = getDb();
          const anyRegistered = db
            .query(
              `SELECT DISTINCT dag_task_id FROM session_map WHERE dag_task_id IS NOT NULL`,
            )
            .all() as { dag_task_id: string }[];
          if (anyRegistered.length > 0) {
            result.hasDispatchContext = true;
            result.dispatchAssignedTaskIds = anyRegistered.map(
              (r) => r.dag_task_id,
            );
          }
        } catch {
          // DB query failure — fall through to no dispatch context
        }
      }
    } else {
      // No taskId provided — check ctx/ directory for dispatch context
      const ctxDir = path.join(
        getProjectRoot(),
        ".task_temp",
        "_dispatch",
        "ctx",
      );
      try {
        if (fs.existsSync(ctxDir)) {
          const files = fs.readdirSync(ctxDir).filter((f) => f.endsWith(".json"));
          if (files.length > 0) {
            const latest = files.reduce((a, b) => {
              const sa = fs.statSync(path.join(ctxDir, a));
              const sb = fs.statSync(path.join(ctxDir, b));
              return sa.mtimeMs > sb.mtimeMs ? a : b;
            });
            const ctx = JSON.parse(
              fs.readFileSync(path.join(ctxDir, latest), "utf8"),
            );
            if (ctx?.dagTaskId) {
              result.dispatchAssignedTaskIds = [ctx.dagTaskId];
              result.hasDispatchContext = true;
            }
          }
        }
      } catch {
        // ctx/ scan failed — no dispatch context
      }
    }
  } catch {
    // DB query failure — fall through to no dispatch context
  }

  // ── Integrity violation check ──
  if (
    result.hasDispatchContext &&
    taskId &&
    result.dispatchAssignedTaskIds.length > 0 &&
    !result.dispatchAssignedTaskIds.includes(taskId)
  ) {
    result.integrityViolation = true;
    result.violationReason =
      `DISPATCH-INTEGRITY: task_id "${taskId}" is not registered in any dispatch session. ` +
      `Registered task_ids: ${result.dispatchAssignedTaskIds.join(", ")}. ` +
      `The dispatch-assigned task_id is immutable — you cannot fabricate a different one. ` +
      `If the gate is stuck (existing armed session for a registered task_id), call compliance_gate_drain_stale ` +
      `to drain the stale session, then retry with the correct task_id.`;

    writeLog(SRC, "ERROR", {
      event: "DISPATCH_TASKID_TAMPER",
      provided_task_id: taskId,
      dispatch_registered_task_ids: result.dispatchAssignedTaskIds,
      detail: `sub-agent attempted to use task_id "${taskId}" not registered in any dispatch — fabricated task_id to bypass gate mutual exclusion.`,
    });
  }

  // ── Normalize: use dispatch-assigned value if no taskId provided ──
  if (!taskId && result.dispatchAssignedTaskIds.length === 1) {
    result.resolvedTaskId = result.dispatchAssignedTaskIds[0];
  }

  return result;
}

/**
 * Check for mutual exclusion conflict: if an active gate session already
 * exists for this task_id, return the conflict info.
 *
 * @param taskId - The task_id to check
 * @returns Conflict info or null if no conflict
 */
export function checkTaskIdConflict(
  taskId: string | null,
): { sessionId: string; reason: string } | null {
  if (!taskId) return null;

  const store = loadGateStore();
  const conflictSid = Object.keys(store.sessions || {}).find((sid) => {
    const s = store.sessions[sid];
    return (
      s.task_id === taskId &&
      (s.gate_status === "armed" || s.gate_status === "recoverable") &&
      !s.consumed_at
    );
  });

  if (conflictSid) {
    const cs = store.sessions[conflictSid];
    return {
      sessionId: conflictSid,
      reason:
        `Task "${taskId}" has active gate ${conflictSid} (status=${cs.gate_status}, retry=${cs.retry_count || 0}). ` +
        `Complete the existing gate or drain it before starting a new one. ` +
        `session_id=${conflictSid} task_id=${taskId} status=${cs.gate_status}.`,
    };
  }

  return null;
}

// ── Internal helper ──
function dbQuerySessionByDagTaskId(taskId: string): any[] {
  try {
    const { getDb } = require("../../lib/db-manager");
    const db = getDb();
    return db
      .query(
        `SELECT * FROM session_map WHERE dag_task_id = ?`,
      )
      .all(taskId) as any[];
  } catch {
    return [];
  }
}
