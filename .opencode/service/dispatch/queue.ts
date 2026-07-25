// service/dispatch/queue.ts — Dispatch queue DB operations (enqueue, dequeue, consume, fail, janitor)
// Source: lib/dispatch-db.ts (queue operations split)

import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";

const SRC = "service-dispatch-queue";

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
  dispatch_key: string | null;
  parent_session_id: string | null;
  call_id: string | null;
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

// ════════════════════════════════════════════════
// ENQUEUE
// ════════════════════════════════════════════════

export function dbEnqueueDispatch(
  agentType: string,
  dagTaskId: string,
  filePath: string,
  sha256: string,
  sizeBytes: number,
  dispatchKey?: string,
  parentSessionId?: string,
  callId?: string,
): number | null {
  try {
    const db = getDb();
    const now = Date.now();
    let queueId: number | null = null;

    const effectiveKey = dispatchKey || (parentSessionId ? require("node:crypto").randomUUID() : null);

    const txn = db.transaction(() => {
      const refResult = db.run(
        `INSERT INTO dispatch_prompt_refs (file_path, sha256, size_bytes, created_at)
         VALUES (?, ?, ?, ?)`,
        [filePath, sha256, sizeBytes, now],
      );
      const promptRefId = Number(refResult.lastInsertRowid);

      const queueResult = db.run(
        `INSERT INTO dispatch_queue (status, agent_type, dag_task_id, prompt_ref_id, dispatch_key, parent_session_id, call_id, created_at, updated_at)
         VALUES ('pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [agentType, dagTaskId, promptRefId, effectiveKey, parentSessionId || null, callId || null, now, now],
      );
      queueId = Number(queueResult.lastInsertRowid);
    });

    txn();

    writeLog(SRC, "INFO", {
      event: "DB-ENQUEUE-ATOMIC",
      detail: `queueId=${queueId} agentType=${agentType} dagTaskId=${dagTaskId} — single-transaction enqueue`,
    });

    return queueId;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-ENQUEUE-FAILED",
      detail: `agentType=${agentType} dagTaskId=${dagTaskId} err=${e.message}`,
    });
    return null;
  }
}

// ════════════════════════════════════════════════
// DEQUEUE WITH LEASE
// ════════════════════════════════════════════════

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
      const row = db
        .query(
          `SELECT id, status, agent_type, dag_task_id, session_id,
                  prompt_ref_id, lease_owner, lease_expiry, dispatch_key,
                  parent_session_id, call_id, created_at, updated_at
           FROM dispatch_queue
           WHERE status = 'pending' AND agent_type = ?
           ORDER BY created_at ASC
           LIMIT 1`,
        )
        .get(agentType) as Record<string, unknown> | null;

      if (!row) return;

      const result = db.run(
        `UPDATE dispatch_queue
         SET status = 'running', lease_owner = ?, lease_expiry = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        [opencodeSessionId, expiry, now, row.id as number],
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
        dispatch_key: (row.dispatch_key as string) || null,
        parent_session_id: (row.parent_session_id as string) || null,
        call_id: (row.call_id as string) || null,
        created_at: row.created_at as number,
        updated_at: now,
      };
    });

    dequeue();

    if (entry) {
      writeLog(SRC, "INFO", {
        event: "DISPATCH-QUEUE-DEQUEUE",
        detail: `queueId=${entry.id} agentType=${agentType} opencodeSessionId=${opencodeSessionId} leaseExpiry=${entry.lease_expiry} dispatchKey=${entry.dispatch_key || "(none)"}`,
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

// ════════════════════════════════════════════════
// DEQUEUE WITH EXACT DISPATCH KEY
// ════════════════════════════════════════════════

export function dbDequeueWithExactKey(
  dispatchKey: string,
  opencodeSessionId: string,
  leaseTtlMs: number = DEFAULT_LEASE_TTL_MS,
): DispatchQueueEntry | null {
  try {
    const db = getDb();
    const now = Date.now();
    const expiry = now + leaseTtlMs;
    let entry: DispatchQueueEntry | null = null;

    const dequeue = db.transaction(() => {
      const row = db
        .query(
          `SELECT id, status, agent_type, dag_task_id, session_id,
                  prompt_ref_id, lease_owner, lease_expiry, dispatch_key,
                  parent_session_id, call_id, created_at, updated_at
           FROM dispatch_queue
           WHERE status = 'pending' AND dispatch_key = ?
           LIMIT 1`,
        )
        .get(dispatchKey) as Record<string, unknown> | null;

      if (!row) return;

      db.run(
        `UPDATE dispatch_queue
         SET status = 'running', lease_owner = ?, lease_expiry = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        [opencodeSessionId, expiry, now, row.id as number],
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
        dispatch_key: (row.dispatch_key as string) || null,
        parent_session_id: (row.parent_session_id as string) || null,
        call_id: (row.call_id as string) || null,
        created_at: row.created_at as number,
        updated_at: now,
      };
    });

    dequeue();

    if (entry) {
      writeLog(SRC, "INFO", {
        event: "DISPATCH-QUEUE-DEQUEUE-EXACT",
        detail: `queueId=${entry.id} dispatchKey=${dispatchKey} opencodeSessionId=${opencodeSessionId} leaseExpiry=${entry.lease_expiry}`,
      });
    }

    return entry;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-QUEUE-DEQUEUE-EXACT-FAILED",
      detail: `dispatchKey=${dispatchKey} opencodeSessionId=${opencodeSessionId} err=${e.message}`,
    });
    return null;
  }
}

// ════════════════════════════════════════════════
// CONSUME / FAIL
// ════════════════════════════════════════════════

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
        detail: `queueId=${queueId} not found`,
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

// ════════════════════════════════════════════════
// JANITOR
// ════════════════════════════════════════════════

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
      detail: e.message,
    });
    return 0;
  }
}


// ════════════════════════════════════════════════
// FIND PENDING DISPATCH (DB-canonical)
// ════════════════════════════════════════════════

export function dbFindPendingDispatch(
  agentType: string,
  sessionId?: string
): { queueId: number; filePath: string; sha256?: string } | null {
  try {
    const db = getDb();

    const row = db.query(`
      SELECT dq.id, pr.file_path, pr.sha256, dq.agent_type, dq.dag_task_id
      FROM dispatch_queue dq
      JOIN dispatch_prompt_refs pr ON dq.prompt_ref_id = pr.id
      WHERE dq.status = 'pending' AND dq.agent_type = ?
      ORDER BY dq.created_at ASC
      LIMIT 1
    `).get(agentType) as any;

    return row ? { queueId: row.id, filePath: row.file_path, sha256: row.sha256 } : null;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-FIND-PENDING-FAILED",
      detail: `agentType=${agentType} err=${e.message}`,
    });
    return null;
  }
}

export function dbFindPendingDispatchByHash(
  promptHash: string,
): { queueId: number; filePath: string; sha256?: string; agentType: string } | null {
  try {
    const db = getDb();

    const row = db.query(`
      SELECT dq.id, pr.file_path, pr.sha256, dq.agent_type, dq.dag_task_id
      FROM dispatch_queue dq
      JOIN dispatch_prompt_refs pr ON dq.prompt_ref_id = pr.id
      WHERE dq.status = 'pending' AND pr.sha256 = ?
      ORDER BY dq.created_at ASC
      LIMIT 1
    `).get(promptHash) as any;

    return row
      ? {
          queueId: row.id,
          filePath: row.file_path,
          sha256: row.sha256,
          agentType: row.agent_type,
        }
      : null;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-FIND-PENDING-BY-HASH-FAILED",
      detail: `promptHash=${promptHash.slice(0, 12)} err=${e.message}`,
    });
    return null;
  }
}

export function dbDequeueWithHash(
  promptHash: string,
  opencodeSessionId: string,
  leaseTtlMs: number = DEFAULT_LEASE_TTL_MS,
): DispatchQueueEntry | null {
  try {
    const db = getDb();
    const now = Date.now();
    const expiry = now + leaseTtlMs;
    let entry: DispatchQueueEntry | null = null;

    const dequeue = db.transaction(() => {
      const row = db
        .query(
          `SELECT dq.id, dq.status, dq.agent_type, dq.dag_task_id, dq.session_id,
                  dq.prompt_ref_id, dq.lease_owner, dq.lease_expiry, dq.dispatch_key,
                  dq.parent_session_id, dq.call_id, dq.created_at, dq.updated_at
           FROM dispatch_queue dq
           JOIN dispatch_prompt_refs pr ON dq.prompt_ref_id = pr.id
           WHERE dq.status = 'pending' AND pr.sha256 = ?
           ORDER BY dq.created_at ASC
           LIMIT 1`,
        )
        .get(promptHash) as Record<string, unknown> | null;

      if (!row) return;

      const result = db.run(
        `UPDATE dispatch_queue
         SET status = 'running', lease_owner = ?, lease_expiry = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        [opencodeSessionId, expiry, now, row.id as number],
      );
      if (result.changes <= 0) return;

      entry = {
        id: row.id as number,
        status: "running",
        agent_type: row.agent_type as string,
        dag_task_id: row.dag_task_id as string,
        session_id: (row.session_id as string) || null,
        prompt_ref_id: (row.prompt_ref_id as number) || null,
        lease_owner: opencodeSessionId,
        lease_expiry: expiry,
        dispatch_key: (row.dispatch_key as string) || null,
        parent_session_id: (row.parent_session_id as string) || null,
        call_id: (row.call_id as string) || null,
        created_at: row.created_at as number,
        updated_at: now,
      };
    });

    dequeue();
    return entry;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-QUEUE-DEQUEUE-BY-HASH-FAILED",
      detail: `promptHash=${promptHash.slice(0, 12)} opencodeSessionId=${opencodeSessionId} err=${e.message}`,
    });
    return null;
  }
}

// ════════════════════════════════════════════════
// CHECK DUPLICATE DISPATCH
// ════════════════════════════════════════════════

export function dbCheckDuplicateDispatch(
  agentType: string,
  dagTaskId: string
): boolean {
  try {
    const db = getDb();
    const row = db.query(`
      SELECT 1 FROM dispatch_queue
      WHERE agent_type = ? AND dag_task_id = ? AND status IN ('pending', 'running')
      LIMIT 1
    `).get(agentType, dagTaskId);
    return !!row;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-CHECK-DUPLICATE-FAILED",
      detail: `agentType=${agentType} dagTaskId=${dagTaskId} err=${e.message}`,
    });
    return false;
  }
}
