/**
 * tsc-gate-locks.ts — TSC Diagnostic Gate v2 DB-canonical state management
 * ═══════════════════════════════════════════════════════════════════════
 * Provides file-level locks and audit event logging for the TSC gate.
 *
 * Design: DB-ONLY & DB-CANONICAL BASED SUBSYSTEM
 * All state is stored in SQLite tables (tsc_gate_locks, tsc_gate_events).
 * No JSON state file I/O — fully DB-canonical.
 *
 * Design: SESSION/SAME-AGENT/DIFFERENT-AGENT/TASK CONCURRENCY SAFE
 * File-level locks prevent concurrent modification collisions.
 * tsc mutex prevents simultaneous tsc processes.
 *
 * @author @Super-Admin
 * @since 2026-06-27 (TSC Diagnostic Gate v2)
 */

import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";

const SRC = "tsc-gate-db";

// ════════════════════════════════════════════════════════════
// FILE-LEVEL LOCKS
// ════════════════════════════════════════════════════════════

/**
 * Acquire a file-level write lock.
 *
 * Concurrency semantics:
 *   - Different files: always succeeds (no interference)
 *   - Same file, same session: succeeds (idempotent)
 *   - Same file, different session: fails if lock not expired
 *   - Expired lock (> lockTimeoutMs): auto-released
 *
 * @param filePath - Absolute path of the file to lock
 * @param sessionId - Session ID of the lock holder
 * @param lockTimeoutMs - Lock timeout in ms (default 60000)
 * @returns true if lock acquired, false if conflict
 */
export function acquireFileLock(
  filePath: string,
  sessionId: string,
  lockTimeoutMs: number = 60000,
): boolean {
  const db = getDb();
  const now = Date.now();
  const expiredThreshold = now - lockTimeoutMs;

  const result = db.transaction(() => {
    // Check existing lock
    const existing = db
      .query(
        "SELECT session_id, locked_at FROM tsc_gate_locks WHERE file_path = ?",
      )
      .get(filePath) as { session_id: string; locked_at: number } | null;

    if (existing) {
      if (existing.session_id === sessionId) {
        // Same session re-acquiring → idempotent
        return true;
      }
      if (existing.locked_at > expiredThreshold) {
        // Lock active and held by different session
        return false;
      }
      // Lock expired → clear it and log TSC-LOCK-TIMEOUT event
      db.run("DELETE FROM tsc_gate_locks WHERE file_path = ?", [filePath]);
      try {
        const eDb = getDb();
        const eId = `tge_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        eDb.run(
          `INSERT INTO tsc_gate_events (event_id, session_id, file_path, event_type, detail, created_at)
           VALUES (?, ?, ?, 'TSC-LOCK-TIMEOUT', ?, ?)`,
          [
            eId,
            sessionId,
            filePath,
            `Expired lock held by ${existing.session_id} since ${new Date(existing.locked_at).toISOString()}`,
            Date.now(),
          ],
        );
      } catch (_) {
        /* non-fatal */
      }
    }

    // Insert new lock
    db.run(
      `INSERT OR REPLACE INTO tsc_gate_locks (file_path, session_id, locked_at, lock_type)
       VALUES (?, ?, ?, 'file_write')`,
      [filePath, sessionId, now],
    );
    return true;
  })();

  writeLog(SRC, "runtime", {
    event: result ? "TSC-LOCK-ACQUIRED" : "TSC-LOCK-CONFLICT",
    detail: `file=${filePath} session=${sessionId}${
      result ? "" : " — locked by another session"
    }`,
  });

  return result;
}

/**
 * Release a file-level write lock.
 * Only the lock holder (matching sessionId) can release it.
 *
 * @param filePath - Absolute path of the file to unlock
 * @param sessionId - Session ID that holds the lock
 * @returns true if lock was released, false if not held
 */
export function releaseFileLock(filePath: string, sessionId: string): boolean {
  const db = getDb();
  const result = db.run(
    "DELETE FROM tsc_gate_locks WHERE file_path = ? AND session_id = ?",
    [filePath, sessionId],
  );

  if (result.changes > 0) {
    writeLog(SRC, "runtime", {
      event: "TSC-LOCK-RELEASED",
      detail: `file=${filePath} session=${sessionId}`,
    });
  }
  return result.changes > 0;
}

/**
 * Release ALL file locks held by a given session.
 * Used in cleanup scenarios (session disconnect, timeout).
 */
export function releaseAllFileLocks(sessionId: string): number {
  const db = getDb();
  const result = db.run("DELETE FROM tsc_gate_locks WHERE session_id = ?", [
    sessionId,
  ]);
  if (result.changes > 0) {
    writeLog(SRC, "runtime", {
      event: "TSC-LOCK-RELEASED-ALL",
      detail: `session=${sessionId} count=${result.changes}`,
    });
  }
  return result.changes;
}

// ════════════════════════════════════════════════════════════
// TSC RUN MUTEX
// ════════════════════════════════════════════════════════════

/**
 * Acquire the global tsc run mutex.
 * Uses file_path = '__TSC_MUTEX__' as a synthetic lock entry.
 * This prevents multiple concurrent tsc --noEmit processes
 * from conflicting on .tsbuildinfo file access.
 */
export function acquireTscMutex(
  sessionId: string,
  lockTimeoutMs: number = 60000,
): boolean {
  const acquired = acquireFileLock("__TSC_MUTEX__", sessionId, lockTimeoutMs);
  if (acquired) {
    try {
      const db = getDb();
      const eventId = `tge_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      db.run(
        `INSERT INTO tsc_gate_events (event_id, session_id, file_path, event_type, detail, created_at)
         VALUES (?, ?, '__TSC_MUTEX__', 'TSC-MUTEX-ACQUIRED', ?, ?)`,
        [eventId, sessionId, `tsc mutex acquired by ${sessionId}`, Date.now()],
      );
    } catch (_) {
      /* non-fatal */
    }
  }
  return acquired;
}

/**
 * Release the global tsc run mutex.
 */
export function releaseTscMutex(sessionId: string): boolean {
  return releaseFileLock("__TSC_MUTEX__", sessionId);
}

// ════════════════════════════════════════════════════════════
// AUDIT EVENTS
// ════════════════════════════════════════════════════════════

/**
 * Record a TSC gate audit event in the tsc_gate_events table.
 *
 * Design: LOG CENTRAL MANAGEMENT SUBSYSTEM
 * All events are logged to both writeLog() and tsc_gate_events table
 * for structured audit querying.
 */
export function logTscGateEvent(input: {
  session_id: string;
  file_path: string;
  event_type: string;
  error_count?: number;
  elapsed_ms?: number;
  detail?: string;
}): void {
  try {
    const db = getDb();
    const eventId = `tge_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    db.run(
      `INSERT INTO tsc_gate_events
       (event_id, session_id, file_path, event_type, error_count, elapsed_ms, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        input.session_id,
        input.file_path,
        input.event_type,
        input.error_count ?? 0,
        input.elapsed_ms ?? null,
        input.detail ?? null,
        Date.now(),
      ],
    );
  } catch (e: any) {
    // Non-fatal: event logging failure must not block the gate
    writeLog(SRC, "WARN", {
      event: "TSC-GATE-EVENT-LOG-FAILED",
      detail: `type=${input.event_type} file=${input.file_path} err=${e.message?.substring(0, 200)}`,
    });
  }
}

/**
 * Reset ALL tsc gate locks — emergency release for all sessions.
 * Used by @Super-Admin via tsc-gate-reset tool when an agent crashes
 * and locks need to be forcibly cleared.
 * @returns Number of locks released
 */
export function resetTscGateLocks(): number {
  try {
    const db = getDb();
    const result = db.run("DELETE FROM tsc_gate_locks", []);
    if (result.changes > 0) {
      writeLog(SRC, "runtime", {
        event: "TSC-LOCK-RESET-ALL",
        detail: `released ${result.changes} lock(s) — emergency reset`,
      });
    }
    return result.changes;
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "TSC-LOCK-RESET-FAILED",
      detail: e.message?.substring(0, 200),
    });
    return 0;
  }
}

/**
 * Clean up expired locks from tsc_gate_locks table.
 * Called during startup and periodically to prevent lock accumulation.
 * @param lockTimeoutMs - Lock timeout in ms
 * @returns Number of expired locks cleaned
 */
export function cleanExpiredLocks(lockTimeoutMs: number = 60000): number {
  try {
    const db = getDb();
    const expiredThreshold = Date.now() - lockTimeoutMs;
    const result = db.run("DELETE FROM tsc_gate_locks WHERE locked_at < ?", [
      expiredThreshold,
    ]);
    if (result.changes > 0) {
      writeLog(SRC, "runtime", {
        event: "TSC-LOCK-CLEANUP",
        detail: `removed ${result.changes} expired lock(s)`,
      });
    }
    return result.changes;
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "TSC-LOCK-CLEANUP-FAILED",
      detail: e.message?.substring(0, 200),
    });
    return 0;
  }
}
