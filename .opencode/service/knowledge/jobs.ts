// jobs.ts — Materialization job tracking and retry
// Phase 1f: Split from knowledge-store.ts

import { writeLog } from "../../lib/log-manager";
import { getDb } from "../../lib/db-manager";
import { getIndexPath, acquireMaterializationLock, releaseMaterializationLock } from "./types-paths";
import type { MaterializationJob } from "./types-paths";
import { materializeManifestFromDb } from "./manifest";

const SRC = "service-jobs";

// ═══════════════════════════════════════════════════════════════
// A6: Materialization Job Tracking (KC-15 extend)
// ═══════════════════════════════════════════════════════════════

/**
 * A6: Get all pending or failed materialization jobs.
 * Queries knowledge_materialization_jobs WHERE status IN ('pending', 'failed').
 *
 * @returns Array of pending/failed job rows (empty array if none or DB error)
 */
export function getPendingMaterializationJobs(): MaterializationJob[] {
  try {
    const db = getDb({ skipSchema: true });
    const rows = db
      .query(
        `SELECT * FROM knowledge_materialization_jobs
         WHERE status IN ('pending', 'failed')
         ORDER BY created_at DESC`,
      )
      .all() as MaterializationJob[];
    writeLog(SRC, "INFO", {
      event: "KC-JOBS-QUERIED",
      detail: `pending_failed=${rows.length}`,
    });
    return rows;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "KC-JOBS-QUERY-FAILED",
      detail: err.message || String(err),
    });
    return [];
  }
}

/**
 * A6: Retry all failed materialization jobs.
 * For each job with status='failed' or 'pending':
 *   1. Increments retry_count and sets status='pending'
 *   2. Re-attempts materializeManifestFromDb()
 *   3. On success: materializeManifestFromDb() inserts a new 'written' job row,
 *      and the original row is marked 'superseded'
 *   4. On failure: the job row already gets a new 'failed' row from
 *      materializeManifestFromDb(), and the original remains 'pending'
 *
 * @returns Summary: { attempted, succeeded, failed }
 */
export function retryFailedJobs(): {
  attempted: number;
  succeeded: number;
  failed: number;
} {
  writeLog(SRC, "INFO", {
    event: "KC-MATERIALIZE-REQUESTED",
    detail: "retryFailedJobs invoked",
  });

  // Phase 3: Acquire lock before retrying to avoid concurrent materialization.
  // If lock is busy, return zero-attempted result (do not process the same
  // batch while another materialization is in progress).
  if (!acquireMaterializationLock("retryFailedJobs")) {
    writeLog(SRC, "INFO", {
      event: "KC-JOBS-RETRIED",
      detail:
        "skipped — materialization lock busy (concurrent materialization in progress)",
    });
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  try {
    const jobs = getPendingMaterializationJobs();
    let succeeded = 0;
    let failed = 0;

    for (const job of jobs) {
      try {
        const db = getDb({ skipSchema: true });
        const now = Date.now();

        // Increment retry_count and mark as pending
        db.run(
          `UPDATE knowledge_materialization_jobs
           SET status = 'pending', retry_count = retry_count + 1, updated_at = ?
           WHERE id = ?`,
          [now, job.id],
        );

        // Re-attempt materialization (lock already held by retryFailedJobs,
        // so materializeManifestFromDb's internal lock acquire will see
        // the same PID and reclaim via stale detection)
        const result = materializeManifestFromDb();

        if (result) {
          succeeded++;
          // materializeManifestFromDb() already inserted a new 'written' job row.
          // Mark this original row as superseded.
          db.run(
            `UPDATE knowledge_materialization_jobs
             SET status = 'superseded', updated_at = ?
             WHERE id = ?`,
            [now, job.id],
          );
        } else {
          failed++;
          // materializeManifestFromDb() already inserted a new 'failed' job row.
        }
      } catch (err: any) {
        failed++;
        writeLog(SRC, "ERROR", {
          event: "KC-JOB-RETRY-FAILED",
          detail: `job_id=${job.id} err=${err.message || String(err)}`,
        });
      }
    }

    writeLog(SRC, "INFO", {
      event: "KC-JOBS-RETRIED",
      detail: `attempted=${jobs.length} succeeded=${succeeded} failed=${failed}`,
    });

    return { attempted: jobs.length, succeeded, failed };
  } finally {
    releaseMaterializationLock();
  }
}

// ── Index Path Export (for backward compat) ────────────────────

/** KC-11: Export the index.json path for scripts that need it directly. */
export function getIndexJsonPath(): string {
  return getIndexPath();
}

// ── Re-export for backward compat ──────────────────────────────

/**
 * KC-15: Import manifest file to DB (migration/fallback only).
 * Delegates to db-manager.backfillKnowledgeFromManifest().
 */
export { backfillKnowledgeFromManifest as importManifestFileToDb } from "../../lib/db-manager";
