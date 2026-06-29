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
): number | null {
  try {
    const db = getDb();
    const now = Date.now();
    let queueId: number | null = null;

    const txn = db.transaction(() => {
      const refResult = db.run(
        `INSERT INTO dispatch_prompt_refs (file_path, sha256, size_bytes, created_at)
         VALUES (?, ?, ?, ?)`,
        [filePath, sha256, sizeBytes, now],
      );
      const promptRefId = Number(refResult.lastInsertRowid);

      const queueResult = db.run(
        `INSERT INTO dispatch_queue (status, agent_type, dag_task_id, prompt_ref_id, created_at, updated_at)
         VALUES ('pending', ?, ?, ?, ?, ?)`,
        [agentType, dagTaskId, promptRefId, now, now],
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
                  prompt_ref_id, lease_owner, lease_expiry, created_at, updated_at
           FROM dispatch_queue
           WHERE status = 'pending' AND agent_type = ?
           ORDER BY created_at ASC
           LIMIT 1`,
        )
        .get(agentType) as Record<string, unknown> | null;

      if (!row) return;

      db.run(
        `UPDATE dispatch_queue
         SET status = 'running', lease_owner = ?, lease_expiry = ?, updated_at = ?
         WHERE id = ?`,
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
