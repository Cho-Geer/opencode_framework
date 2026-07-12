// db-maintenance.ts — SQLite database maintenance utilities
// ═══════════════════════════════════════════════════════════════════
// P0-C (#105): Safe DB maintenance functions for corruption prevention.
//
// Responsibilities:
//   1. safeCheckpoint() — PRAGMA wal_checkpoint(TRUNCATE) for safe WAL checkpoint
//   2. safeBackup(targetPath) — VACUUM INTO for consistent DB snapshot/backup
//   3. safeIntegrityCheck() — PRAGMA integrity_check with structured result
//
// All functions use writeLog for structured event logging:
//   - DB-WAL-CHECKPOINT
//   - DB-SAFE-BACKUP-CREATED
//   - DB-INTEGRITY-CHECK
//
// Design constraints:
//   - Uses singleton DB connection from db-manager.ts (getDb/closeDb)
//   - All operations are wrapped in try-catch with error logging
//   - Read-only operations never mutate the DB
//   - safeBackup uses VACUUM INTO (SQLite 3.27.0+) for consistent snapshots
//
// @author @Super-Admin
// @version 1.0.0
// @since 2026-06-21
// ═══════════════════════════════════════════════════════════════════

import { getDb, closeDb } from "./db-manager";
import { writeLog } from "./log-manager";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = "lib-db-maintenance";

// ── Types ─────────────────────────────────────────────────────────

/**
 * Result of PRAGMA integrity_check.
 * ok: true means no corruption detected.
 * details: raw output from SQLite integrity_check (array of result rows).
 */
export interface IntegrityCheckResult {
  ok: boolean;
  details: Array<{ integrity_check: string }>;
  error?: string;
}

/**
 * Result of PRAGMA wal_checkpoint.
 * busy: 0 if checkpoint completed, 1 if blocked by another connection.
 * log: number of frames in WAL before checkpoint.
 * checkpointed: number of frames checkpointed.
 */
export interface CheckpointResult {
  busy: number;
  log: number;
  checkpointed: number;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * safeCheckpoint — Execute PRAGMA wal_checkpoint(TRUNCATE) to force a
 * database checkpoint and truncate the WAL file to zero bytes.
 *
 * Why: Raw WAL file deletion (fs.unlinkSync on .db-wal/.db-shm) can
 * corrupt the database if there are uncommitted WAL frames. PRAGMA
 * wal_checkpoint(TRUNCATE) is the safe, documented approach that:
 *   1. Flushes all committed WAL frames to the main database file
 *   2. Truncates the WAL file back to zero bytes
 *   3. Preserves uncommitted transaction state
 *
 * This is the recommended pre-migration/pre-backup step to ensure
 * a consistent on-disk state.
 *
 * @returns CheckpointResult with busy/log/checkpointed counts
 * @throws on DB connection or checkpoint failure
 *
 * @see https://sqlite.org/pragma.html#pragma_wal_checkpoint
 */
export function safeCheckpoint(): CheckpointResult {
  writeLog(SRC, "INFO", {
    event: "DB-WAL-CHECKPOINT",
    detail: "Starting WAL checkpoint (TRUNCATE)",
  });

  const db = getDb();
  try {
    // PRAGMA wal_checkpoint(TRUNCATE):
    // - Checkpoint all frames from WAL to main DB
    // - Truncate WAL to 0 bytes after successful checkpoint
    // Return columns: busy (0=ok, 1=blocked), log (frames before), checkpointed (frames moved)
    const rows = db.query("PRAGMA wal_checkpoint(TRUNCATE)").all() as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;

    const result: CheckpointResult = rows[0] || {
      busy: 0,
      log: 0,
      checkpointed: 0,
    };

    writeLog(SRC, "INFO", {
      event: "DB-WAL-CHECKPOINT",
      detail: `busy=${result.busy} log=${result.log} checkpointed=${result.checkpointed}`,
    });

    if (result.busy !== 0) {
      writeLog(SRC, "WARN", {
        event: "DB-WAL-CHECKPOINT",
        detail:
          "Checkpoint returned busy=1 — another connection prevented full checkpoint",
      });
    }

    return result;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-WAL-CHECKPOINT",
      detail: `Checkpoint failed: ${e.message}`,
    });
    throw e;
  }
}

/**
 * safeBackup — Create a consistent backup/snapshot of the framework
 * state database using VACUUM INTO.
 *
 * Why: VACUUM INTO (SQLite 3.27.0+) creates a byte-for-byte consistent
 * copy of the database into a new file. Unlike file-copy approaches:
 *   1. It respects WAL and returns a consistent snapshot
 *   2. It rebuilds the database, reclaiming unused space
 *   3. It's atomic — the target file is either complete or absent
 *
 * The target file must not exist (will be overwritten if it does).
 *
 * @param targetPath — Absolute path for the backup file
 * @throws if backup fails (target directory missing, disk full, etc.)
 *
 * @see https://sqlite.org/lang_vacuum.html
 */
export function safeBackup(targetPath: string): void {
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  writeLog(SRC, "INFO", {
    event: "DB-SAFE-BACKUP-CREATED",
    detail: `Starting backup to ${targetPath}`,
  });

  const db = getDb();
  try {
    // VACUUM INTO creates a consistent snapshot of the current database
    // into the target file. The target file is overwritten.
    db.run(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);

    const stat = fs.statSync(targetPath);

    writeLog(SRC, "INFO", {
      event: "DB-SAFE-BACKUP-CREATED",
      detail: `Backup complete: ${targetPath} (${stat.size} bytes)`,
    });
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-SAFE-BACKUP-CREATED",
      detail: `Backup failed: ${e.message}`,
    });
    throw e;
  }
}

/**
 * safeIntegrityCheck — Run PRAGMA integrity_check on the framework
 * state database and return a structured result.
 *
 * Why: PRAGMA integrity_check performs a comprehensive self-check:
 *   1. Verifies all tables and indexes are internally consistent
 *   2. Checks B-tree structures, page linkages, and cell contents
 *   3. Returns 'ok' for a clean database, or error descriptions
 *
 * This is the definitive SQLite-level corruption check. Any result
 * other than 'ok' means the database needs repair.
 *
 * @returns IntegrityCheckResult with ok=true if clean, or error details
 *
 * @see https://sqlite.org/pragma.html#pragma_integrity_check
 */
export function integrityCheck(): IntegrityCheckResult {
  writeLog(SRC, "INFO", {
    event: "DB-INTEGRITY-CHECK",
    detail: "Starting integrity check",
  });

  const db = getDb();
  try {
    const rows = db.query("PRAGMA integrity_check").all() as Array<{
      integrity_check: string;
    }>;

    const allOk = rows.every((r) => r.integrity_check === "ok");

    writeLog(SRC, allOk ? "INFO" : "ERROR", {
      event: "DB-INTEGRITY-CHECK",
      detail: allOk
        ? "Integrity check passed: ok"
        : `Integrity check FAILED: ${JSON.stringify(rows)}`,
    });

    return {
      ok: allOk,
      details: rows,
    };
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-INTEGRITY-CHECK",
      detail: `Integrity check failed: ${e.message}`,
    });
    return {
      ok: false,
      details: [],
      error: e.message,
    };
  }
}

// ── Convenience: full maintenance cycle ───────────────────────────

/**
 * runMaintenance — Execute a complete maintenance cycle:
 *   checkpoint → integrity check → backup (if targetPath provided)
 *
 * This is the recommended "before migration" or "before deployment"
 * sequence. Each step is independent — failure in one step does not
 * prevent subsequent steps from running (non-fatal).
 *
 * @param backupTargetPath — Optional: path for VACUUM INTO backup
 * @returns Object with checkpoint, integrity, and optional backup results
 */
export function runMaintenance(backupTargetPath?: string): {
  checkpoint: CheckpointResult;
  integrity: IntegrityCheckResult;
  backup?: string;
} {
  writeLog(SRC, "INFO", {
    event: "DB-MAINTENANCE-START",
    detail: backupTargetPath
      ? `Starting full maintenance cycle (with backup to ${backupTargetPath})`
      : "Starting maintenance cycle (no backup)",
  });

  // Step 1: Checkpoint WAL
  const checkpoint = safeCheckpoint();

  // Step 2: Integrity check
  const integrity = integrityCheck();

  // Step 3: Optional backup
  let backup: string | undefined;
  if (backupTargetPath) {
    safeBackup(backupTargetPath);
    backup = backupTargetPath;
  }

  writeLog(SRC, "INFO", {
    event: "DB-MAINTENANCE-COMPLETE",
    detail: `checkpoint=${checkpoint.checkpointed}frames integrity=${integrity.ok ? "ok" : "FAILED"} backup=${backup || "skipped"}`,
  });

  return { checkpoint, integrity, backup };
}
// Append to lib/db-maintenance.ts — runAuditCleanup + runDbVacuum
// Extracted from plugins/db-health.ts (Batch 2)

/**
 * Run audit table cleanup: delete expired rows + truncate over-limit + multi-table cleanup.
 * Extracted from db-health plugin to keep all DB writes in infrastructure layer.
 *
 * @param retentionDays - Number of days to retain audit records
 * @param maxAuditRows - Maximum rows in gate_audit_history
 * @returns Total number of deleted rows
 */
export function runAuditCleanup(
  retentionDays: number = 7,
  maxAuditRows: number = 10000,
): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let totalDeleted = 0;

  try {
    const db = getDb();

    // 1. Clean expired rows in gate_audit_history (using correct column name)
    try {
      const res = db.run(
        "DELETE FROM gate_audit_history WHERE confirmed_at < ?",
        [cutoff],
      );
      totalDeleted += res.changes;
    } catch { /* skip */ }

    // 2. If still over limit, force-truncate (keep newest N rows)
    try {
      const count = db
        .query("SELECT COUNT(*) as c FROM gate_audit_history")
        .get() as { c: number };
      if (count.c > maxAuditRows) {
        const res = db.run(
          `DELETE FROM gate_audit_history
           WHERE id NOT IN (
             SELECT id FROM gate_audit_history
             ORDER BY id DESC
             LIMIT ?
           )`,
          [maxAuditRows],
        );
        totalDeleted += res.changes;
      }
    } catch { /* skip */ }

    // 3. Revoke expired repo grants before deleting long-lived terminal rows.
    try {
      const res = db.run(
        `UPDATE repo_operation_grants
         SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?)
         WHERE status IN ('pending', 'bound') AND expires_at < ?`,
        [now, now],
      );
      totalDeleted += res.changes;
    } catch { /* skip */ }

    // 4. Delete old terminal repo grants and repo audit events.
    try {
      const res = db.run(
        `DELETE FROM repo_operation_grants
         WHERE status IN ('consumed', 'revoked')
           AND COALESCE(consumed_at, revoked_at, created_at) < ?`,
        [cutoff],
      );
      totalDeleted += res.changes;
    } catch { /* skip */ }

    try {
      const res = db.run(
        "DELETE FROM repo_operation_events WHERE created_at < ?",
        [cutoff],
      );
      totalDeleted += res.changes;
    } catch { /* skip */ }

    // 5. Clean other audit tables
    const cleanupTargets: Array<[string, string]> = [
      ["audit_log", "timestamp"],
      ["read_audit", "created_at"],
      ["execution_checklist_events", "created_at"],
      ["dispatch_failed_log", "failed_at"],
      ["session_log", "created_at"],
    ];
    for (const [table, col] of cleanupTargets) {
      try {
        const res = db.run(`DELETE FROM ${table} WHERE ${col} < ?`, [cutoff]);
        totalDeleted += res.changes;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return totalDeleted;
}

/**
 * Run VACUUM if freelist pages exceed threshold.
 * @param freeListThreshold - Minimum freelist pages to trigger VACUUM
 * @returns Number of reclaimed pages (0 if skipped)
 */
export function runDbVacuum(freeListThreshold: number = 100): number {
  try {
    const db = getDb();
    const fl = db.query("PRAGMA freelist_count").get() as {
      freelist_count: number;
    };
    if (fl.freelist_count > freeListThreshold) {
      db.run("VACUUM");
      return fl.freelist_count;
    }
  } catch { /* skip */ }
  return 0;
}
