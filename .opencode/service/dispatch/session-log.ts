// service/dispatch/session-log.ts — Dispatch attempt logging + diagnostic queries
// Source: lib/dispatch-db.ts (attempt/context logging + diagnostic functions split)

import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";
import type { DispatchQueueEntry } from "./queue";

const SRC = "service-dispatch-session-log";

// ── Types ─────────────────────────────────────────────────────────────

export interface DispatchContextEntry {
  id: number;
  dispatch_id: number;
  session_id: string;
  dag_task_id: string;
  agent_type: string;
  domain_id: string | null;
  opened_at: number;
  consumed_at: number | null;
}

export interface DispatchAttemptEntry {
  id: number;
  dispatch_id: number;
  attempt_number: number;
  status: string;
  session_id: string | null;
  error_msg: string | null;
  created_at: number;
}

// ════════════════════════════════════════════════
// CONTEXT (deprecated stub)
// ════════════════════════════════════════════════

/**
 * @deprecated dispatch_context table was dropped in v23 migration.
 * Use session_map DB table for dispatch context lookups instead.
 */
export function dbInsertDispatchContext(
  _dispatchId: number,
  _sessionId: string,
  _dagTaskId: string,
  _agentType: string,
  _domainId?: string,
): number | null {
  writeLog(SRC, "WARN", {
    event: "DISPATCH-CONTEXT-DEPRECATED",
    detail:
      "dbInsertDispatchContext called but dispatch_context table was dropped in v23 (OPT-06). Use session_map instead.",
  });
  return null;
}

// ════════════════════════════════════════════════
// ATTEMPTS
// ════════════════════════════════════════════════

export function dbInsertDispatchAttempt(
  dispatchId: number,
  attemptNumber: number,
  status: string,
  opencodeSessionId?: string,
  errorMsg?: string,
): number | null {
  try {
    const db = getDb();
    const now = Date.now();

    const result = db.run(
      `INSERT INTO dispatch_attempts
         (dispatch_id, attempt_number, status, session_id, error_msg, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        dispatchId,
        attemptNumber,
        status,
        opencodeSessionId || null,
        errorMsg || null,
        now,
      ],
    );

    writeLog(SRC, "INFO", {
      event: "DISPATCH-ATTEMPT-INSERT",
      detail: `dispatchId=${dispatchId} attempt=${attemptNumber} status=${status}`,
    });

    return Number(result.lastInsertRowid);
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-ATTEMPT-FAILED",
      detail: `dispatchId=${dispatchId} err=${e.message}`,
    });
    return null;
  }
}

// ════════════════════════════════════════════════
// DIAGNOSTIC
// ════════════════════════════════════════════════

export function dbGetDispatchQueue(
  status?: string,
  agentType?: string,
  limit: number = 50,
): DispatchQueueEntry[] {
  try {
    const db = getDb();
    let sql = `SELECT id, status, agent_type, dag_task_id, session_id,
                      prompt_ref_id, lease_owner, lease_expiry, created_at, updated_at
               FROM dispatch_queue WHERE 1=1`;
    const params: (string | number)[] = [];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    if (agentType) {
      sql += ` AND agent_type = ?`;
      params.push(agentType);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    return db.query(sql).all(...params) as DispatchQueueEntry[];
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-QUEUE-QUERY-FAILED",
      detail: e.message,
    });
    return [];
  }
}

export function dbGetPendingCount(agentType?: string): number {
  try {
    const db = getDb();
    let sql = `SELECT COUNT(*) AS c FROM dispatch_queue WHERE status = 'pending'`;
    const params: string[] = [];

    if (agentType) {
      sql += ` AND agent_type = ?`;
      params.push(agentType);
    }

    const row = db.query(sql).get(...params) as { c: number } | null;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}
