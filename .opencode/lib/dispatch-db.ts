// dispatch-db.ts — Dispatch Queue DB Canonical Operations
// ═══════════════════════════════════════════════════════════════════════
// A7: Phase 1 — DB-first dispatch queue operations with file fallback.
//
// Replaces file-based dispatch runtime state (.pending.json,
// .auto-dispatch.json, ctx/*.json, .dispatch_ctx) with DB-canonical
// storage. Phase 1 keeps file writes for rollout compatibility.
//
// Public API:
//   - dbEnqueueDispatch()      → INSERT into dispatch_queue + dispatch_prompt_refs
//   - dbDequeueWithLease()     → SELECT+UPDATE with transaction (lease)
//   - dbConsumeDispatch()      → UPDATE status to 'consumed'
//   - dbFailDispatch()         → UPDATE status to 'failed'
//   - dbInsertDispatchContext()→ INSERT dispatch context record
//   - dbInsertDispatchAttempt()→ INSERT attempt record
//   - dbCleanStaleLeases()     → Reclaim expired leases (janitor)
//   - dbGetDispatchQueue()     → Read queue entries (diagnostic)
//   - dbGetPendingCount()      → Count pending entries
//
// Design constraints:
//   - All operations are non-fatal — failures are logged but don't throw.
//   - DB-first with try/catch; callers should fallback to file-based ops.
//   - Lease TTL: 60s (configurable via DISPATCH_LEASE_TTL_MS env).
//   - Transaction boundaries: dequeue uses explicit transaction for
//     SELECT → UPDATE atomicity; all other ops are single-statement.
//
// @author @Super-Admin (A7 dispatch queue DB migration)
// @version 1.0.0
// @since 2026-06-20
// ═══════════════════════════════════════════════════════════════════════

import { getDb } from "./db-manager";
import { writeLog } from "./log-manager";

const SRC = "lib-dispatch-db";

/** Default lease TTL in milliseconds (configurable via env) */
const DEFAULT_LEASE_TTL_MS = parseInt(
  process.env.DISPATCH_LEASE_TTL_MS || "60000",
  10,
);

// ── Types ─────────────────────────────────────────────────────────────

export interface DispatchQueueEntry {
  id: number;
  status: string;
  agent_type: string;
  dag_task_id: string;
  session_id: string | null;
  prompt_ref_id: number | null;
  lease_owner: string | null;
  lease_expiry: number | null;
  created_at: number;
  updated_at: number;
}

export interface DispatchPromptRef {
  id: number;
  file_path: string;
  sha256: string | null;
  size_bytes: number;
  created_at: number;
}

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

// ════════════════════════════════════════════════════════════
// ENQUEUE
// ════════════════════════════════════════════════════════════

/**
 * Insert a new dispatch entry into the queue and reference the prompt file.
 * Called by dispatch-subagent.ts after generating the wrapped prompt.
 *
 * @param agentType  Target sub-agent type (e.g., "Coder-BE")
 * @param dagTaskId  Dispatch-assigned task ID
 * @param filePath   Path to the generated prompt .md file
 * @param sha256     SHA-256 hash of the prompt file
 * @param sizeBytes  Size of the prompt file in bytes
 * @returns The inserted dispatch_queue.id, or null on failure
 */
export function dbEnqueueDispatch(
  agentType: string,
  dagTaskId: string,
  filePath: string,
  sha256: string,
  sizeBytes: number,
): number | null {
  try {
    const db = getDb();
    const now = Date.now();

    // Insert prompt reference first (immutable)
    const refResult = db.run(
      `INSERT INTO dispatch_prompt_refs (file_path, sha256, size_bytes, created_at)
       VALUES (?, ?, ?, ?)`,
      [filePath, sha256, sizeBytes, now],
    );
    const promptRefId = Number(refResult.lastInsertRowid);

    // Insert queue entry
    const queueResult = db.run(
      `INSERT INTO dispatch_queue (status, agent_type, dag_task_id, prompt_ref_id, created_at, updated_at)
       VALUES ('pending', ?, ?, ?, ?, ?)`,
      [agentType, dagTaskId, promptRefId, now, now],
    );
    const queueId = Number(queueResult.lastInsertRowid);

    writeLog(SRC, "INFO", {
      event: "DISPATCH-QUEUE-ENQUEUE",
      detail: `queueId=${queueId} agentType=${agentType} dagTaskId=${dagTaskId} promptRefId=${promptRefId}`,
    });

    return queueId;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-QUEUE-ENQUEUE-FAILED",
      detail: `agentType=${agentType} dagTaskId=${dagTaskId} err=${e.message}`,
    });
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// DEQUEUE WITH LEASE
// ════════════════════════════════════════════════════════════

/**
 * Atomically dequeue the oldest pending entry for a given agent type
 * and acquire a lease on it. Uses a transaction for SELECT → UPDATE
 * atomicity, preventing double-consumption.
 *
 * Called by task-before.ts when a Task() call is intercepted.
 *
 * @param agentType         Target sub-agent type to match
 * @param opencodeSessionId OpenCode session ID (ses_*) of the sub-agent consumer,
 *                          used as lease_owner. NOT a gate session (cg_ses_*).
 * @param leaseTtlMs        Lease TTL in ms (default 60000)
 * @returns The dequeued entry, or null if nothing pending
 */
export function dbDequeueWithLease(
  agentType: string,
  opencodeSessionId: string,
  leaseTtlMs: number = DEFAULT_LEASE_TTL_MS,
): DispatchQueueEntry | null {
  try {
    const db = getDb();
    const now = Date.now();
    const expiry = now + leaseTtlMs;
    let entry: DispatchQueueEntry | null = null;

    const dequeue = db.transaction(() => {
      // SELECT oldest pending entry
      const row = db
        .query(
          `SELECT id, status, agent_type, dag_task_id, session_id,
                  prompt_ref_id, lease_owner, lease_expiry, created_at, updated_at
           FROM dispatch_queue
           WHERE status = 'pending' AND agent_type = ?
           ORDER BY created_at ASC
           LIMIT 1`,
        )
        .get(agentType) as Record<string, unknown> | null;

      if (!row) return;

      // UPDATE with lease
      db.run(
        `UPDATE dispatch_queue
         SET status = 'running', lease_owner = ?, lease_expiry = ?, updated_at = ?
         WHERE id = ?`,
        [opencodeSessionId, expiry, now, row.id],
      );

      entry = {
        id: row.id as number,
        status: "running",
        agent_type: row.agent_type as string,
        dag_task_id: row.dag_task_id as string,
        session_id: (row.session_id as string) || null,
        prompt_ref_id: (row.prompt_ref_id as number) || null,
        lease_owner: opencodeSessionId,
        lease_expiry: expiry,
        created_at: row.created_at as number,
        updated_at: now,
      };
    });

    dequeue();

    if (entry) {
      writeLog(SRC, "INFO", {
        event: "DISPATCH-QUEUE-DEQUEUE",
        detail: `queueId=${entry.id} agentType=${agentType} opencodeSessionId=${opencodeSessionId} leaseExpiry=${entry.lease_expiry}`,
      });
    }

    return entry;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-QUEUE-DEQUEUE-FAILED",
      detail: `agentType=${agentType} opencodeSessionId=${opencodeSessionId} err=${e.message}`,
    });
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// CONSUME
// ════════════════════════════════════════════════════════════

/**
 * Mark a dispatch entry as consumed after successful Task() completion.
 * Called by task-after.ts when a sub-agent dispatch completes successfully.
 *
 * @param queueId            The dispatch_queue.id to mark consumed
 * @param opencodeSessionId  OpenCode session ID (ses_*) of the sub-agent.
 *                           NOT a gate session (cg_ses_*).
 * @returns true on success, false on failure
 */
export function dbConsumeDispatch(
  queueId: number,
  opencodeSessionId: string,
): boolean {
  try {
    const db = getDb();
    const now = Date.now();

    const result = db.run(
      `UPDATE dispatch_queue
       SET status = 'consumed', session_id = ?, updated_at = ?
       WHERE id = ?`,
      [opencodeSessionId, now, queueId],
    );

    if (result.changes > 0) {
      writeLog(SRC, "INFO", {
        event: "DISPATCH-QUEUE-CONSUME",
        detail: `queueId=${queueId} opencodeSessionId=${opencodeSessionId}`,
      });
    } else {
      writeLog(SRC, "WARN", {
        event: "DISPATCH-QUEUE-CONSUME-NO-MATCH",
        detail: `queueId=${queueId} not found — may have been already consumed or drained`,
      });
    }

    return result.changes > 0;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-QUEUE-CONSUME-FAILED",
      detail: `queueId=${queueId} err=${e.message}`,
    });
    return false;
  }
}

/**
 * Mark a dispatch entry as failed after unsuccessful Task() completion.
 *
 * @param queueId            The dispatch_queue.id to mark failed
 * @param opencodeSessionId  OpenCode session ID (ses_*) of the sub-agent
 * @param errorMsg           Error message (optional)
 * @returns true on success, false on failure
 */
export function dbFailDispatch(
  queueId: number,
  opencodeSessionId: string,
  errorMsg?: string,
): boolean {
  try {
    const db = getDb();
    const now = Date.now();

    const result = db.run(
      `UPDATE dispatch_queue
       SET status = 'failed', session_id = ?, updated_at = ?
       WHERE id = ?`,
      [opencodeSessionId, now, queueId],
    );

    if (result.changes > 0) {
      writeLog(SRC, "WARN", {
        event: "DISPATCH-QUEUE-FAILED",
        detail: `queueId=${queueId} opencodeSessionId=${opencodeSessionId} err=${errorMsg || "(none)"}`,
      });
    }

    return result.changes > 0;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-QUEUE-FAILED-RECORD",
      detail: `queueId=${queueId} err=${e.message}`,
    });
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// CONTEXT & ATTEMPTS
// ════════════════════════════════════════════════════════════

/**
 * Insert a dispatch context record linking a dispatch to agent identity
 * and knowledge domain. Called by task-after.ts on successful dispatch.
 *
 * @returns The inserted dispatch_context.id, or null on failure
 */
export function dbInsertDispatchContext(
  dispatchId: number,
  sessionId: string,
  dagTaskId: string,
  agentType: string,
  domainId?: string,
): number | null {
  try {
    const db = getDb();
    const now = Date.now();

    const result = db.run(
      `INSERT INTO dispatch_context
         (dispatch_id, session_id, dag_task_id, agent_type, domain_id, opened_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [dispatchId, sessionId, dagTaskId, agentType, domainId || null, now, now],
    );

    writeLog(SRC, "INFO", {
      event: "DISPATCH-CONTEXT-INSERT",
      detail: `dispatchId=${dispatchId} sessionId=${sessionId} dagTaskId=${dagTaskId} agentType=${agentType} domainId=${domainId || "(none)"}`,
    });

    return Number(result.lastInsertRowid);
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-CONTEXT-FAILED",
      detail: `dispatchId=${dispatchId} err=${e.message}`,
    });
    return null;
  }
}

/**
 * Insert a dispatch attempt record. Called by task-after.ts after
 * every Task() dispatch (both success and failure).
 *
 * @param opencodeSessionId  OpenCode session ID (ses_*) of the sub-agent.
 *                           May be null if session is unknown.
 * @returns The inserted dispatch_attempts.id, or null on failure
 */
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

// ════════════════════════════════════════════════════════════
// JANITOR
// ════════════════════════════════════════════════════════════

/**
 * Reclaim dispatch entries whose lease has expired.
 * Marks entries as 'stale' and clears lease info.
 * Called periodically by the janitor or dispatch-auto plugin.
 *
 * @returns Number of stale entries reclaimed
 */
export function dbCleanStaleLeases(): number {
  try {
    const db = getDb();
    const now = Date.now();

    const result = db.run(
      `UPDATE dispatch_queue
       SET status = 'stale', lease_owner = NULL, lease_expiry = NULL, updated_at = ?
       WHERE status = 'running' AND lease_expiry IS NOT NULL AND lease_expiry < ?`,
      [now, now],
    );

    if (result.changes > 0) {
      writeLog(SRC, "WARN", {
        event: "DISPATCH-QUEUE-LEASE-STALE",
        detail: `Reclaimed ${result.changes} stale dispatch leases`,
      });
    }

    return result.changes;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-QUEUE-LEASE-CLEAN-FAILED",
      detail: (err = e.message),
    });
    return 0;
  }
}

// ════════════════════════════════════════════════════════════
// DIAGNOSTIC
// ════════════════════════════════════════════════════════════

/**
 * Query dispatch queue entries by status and/or agent type.
 * Used by diagnostic tools and framework-self-test.
 */
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
      detail: (err = e.message),
    });
    return [];
  }
}

/**
 * Count pending dispatch entries for a given agent type.
 * Used by task-before.ts to decide whether to try DB or file.
 */
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
