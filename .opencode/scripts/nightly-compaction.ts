#!/usr/bin/env bun
/**
 * nightly-compaction.ts — Trigger nightly state archival
 *
 * Runs nightly compaction for gate-state (compress old history files into archive)
 * and optionally DAG archival (archive completed tasks >14 days old).
 *
 * USAGE:
 *   bun .opencode/scripts/nightly-compaction.ts              # gate-state only
 *   bun .opencode/scripts/nightly-compaction.ts --dag        # gate + DAG
 *   bun .opencode/scripts/nightly-compaction.ts --dry-run
 *   bun .opencode/scripts/nightly-compaction.ts --today YYYY-MM-DD  # override date
 *
 * TRIGGERS:
 *   - @CI-CD-Agent scheduled task (cron: 0 2 * * *)
 *   - Manual: bun .opencode/scripts/nightly-compaction.ts
 *   - Future: session.compacted event in framework-enforcer.ts
 *
 * FW-PLAN-JS-TO-TS: Unified to TypeScript + Bun; removed dist/ fallback.
 * @since Wave 4.1 (R7)
 * @author @Super-Admin
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  renameSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteSubState } from "../lib/state-utils";
// P3/S63-1 + S63-5: DB maintenance (stale cleanup + WAL checkpoint + weekly vacuum)
import { dbCleanStaleEntries, getDb, dbVacuum } from "../lib/db-manager";
// P3/S11-6: Stale baseline cleanup (from Phase 2 safe-edit-core additions)
import { writeLog } from "../lib/log-manager";
// KC-03: Nested session_access pruning via shared helper
import {
  pruneSessionAccess,
  pruneSessionAccessFromDB,
  type PruneOptions,
} from "../lib/uc7ks-schema";

const NC_SRC = "scripts-nightly-compaction";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "../..");
const STATE_DIR = join(PROJECT_ROOT, ".opencode/state");

/**
 * Load StateCompactor and DAGVersionManager from TypeScript source.
 * FW-PLAN-JS-TO-TS: Bun executes .ts directly; no compilation or dist/ fallback needed.
 */
const { StateCompactor } = await import("../lib/state-compactor.ts");
const { DAGVersionManager } = await import("../lib/dag-version-manager.ts");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const WITH_DAG = args.includes("--dag");
const todayArg = args.find((_, i) => args[i - 1] === "--today");
const TODAY = todayArg || new Date().toISOString().split("T")[0];

function log(msg) {
  console.log((DRY_RUN ? "[DRY-RUN] " : "") + msg);
}

async function compactGateState() {
  log("=== Gate-State Nightly Compaction ===");
  const compactor = new StateCompactor();

  if (DRY_RUN) {
    // Dry-run: show what would be compacted
    const historyDir = join(STATE_DIR, "gate-state.history");
    if (!existsSync(historyDir)) {
      log("No history directory. Nothing to compact.");
      return;
    }
    const files = readdirSync(historyDir).filter((f) => f.endsWith(".jsonl"));
    const cutoff = new Date(TODAY);
    cutoff.setDate(cutoff.getDate() - 7);
    const oldFiles = files.filter((f) => {
      const match = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!match) return false;
      return new Date(match[1]) < cutoff;
    });
    log(`${oldFiles.length} history files >7 days old would be compacted`);
    if (oldFiles.length > 0)
      log(`Oldest: ${oldFiles[0]}, Newest: ${oldFiles[oldFiles.length - 1]}`);
  } else {
    await compactor.nightlyCompaction();
  }
  log("Gate-state compaction complete.");
}

async function archiveOldDAGTasks() {
  log("=== DAG Archival ===");
  const mgr = new DAGVersionManager();
  const dagPath = join(PROJECT_ROOT, "Task.DAG.json");

  if (!existsSync(dagPath)) {
    log("No Task.DAG.json found.");
    return;
  }

  const dag = JSON.parse(readFileSync(dagPath, "utf8"));
  const cutoff = new Date(TODAY);
  cutoff.setDate(cutoff.getDate() - 14);

  const oldCompleted = (dag.tasks || []).filter(
    (t) =>
      t.status === "completed" &&
      t.completed_at &&
      new Date(t.completed_at) < cutoff,
  );

  if (oldCompleted.length === 0) {
    log("No tasks >14 days old. Nothing to archive.");
    return;
  }

  if (DRY_RUN) {
    log(`Would archive ${oldCompleted.length} completed tasks >14 days old`);
    log(
      `Hot file: ${dag.tasks.length} → ${dag.tasks.length - oldCompleted.length} tasks`,
    );
  } else {
    const result = await mgr.createVersionSnapshot(
      dag.version,
      dag.version,
      `Nightly auto-archival: ${oldCompleted.length} tasks >14 days old`,
    );
    log(
      `Archived ${result.tasksArchived} tasks. ${result.tasksRemaining} remain in hot file.`,
    );
  }
}

// SA-IMPL-BACKUP-LIFECYCLE: Nightly backup cleanup step.
// Uses backup-manager.ts to remove backups older than TTL (default 7 days).
// No count cap — TTL-only cleanup.
async function cleanupStaleBackupsStep() {
  const stepName = "backup-cleanup";
  try {
    const { cleanupStaleBackups } = await import("../lib/backup-manager");
    const ttlDays = 7;
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;

    if (DRY_RUN) {
      log(
        `[${stepName}] Would scan backup_log table [TTL=${ttlDays}d] — DRY-RUN`,
      );
      return;
    }

    const result = cleanupStaleBackups(ttlMs);
    log(
      `[${stepName}] Scanned ${result.scanned} records, deleted ${result.deleted}`,
    );
  } catch (err) {
    log(
      `[${stepName}] ERROR: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// SA-IMPL-SELF-CLEANUP + KC-03 (2026-06-20): Nightly cleanup of stale session_access.
// KC-03 REPLACEMENT: Previously only removed whole agent entries (top-level keys).
// Now uses shared pruneSessionAccess() from uc7ks-schema.ts which handles nested
// tasks[task_id].domains[domain_id] pruning with per-domain staleness detection.
async function cleanupStaleSessionAccessStep() {
  const stepName = "session-access-cleanup";
  const INVALID_KEYS = ["unknown", "", "undefined", "null"];
  try {
    const { existsSync } = await import("fs");
    const machinePath = join(
      PROJECT_ROOT,
      ".opencode",
      "state",
      "machine.json",
    );
    if (!existsSync(machinePath)) {
      log(`[${stepName}] machine.json not found — skip`);
      return;
    }
    if (DRY_RUN) {
      log(
        `[${stepName}] Would prune nested session_access via pruneSessionAccess() — DRY-RUN`,
      );
      return;
    }

    let invalidRemoved = 0;
    let pruneResult: any = {
      pruned_tasks: 0,
      pruned_domains: 0,
      pruned_agents: 0,
    };

    const ok = atomicWriteSubState("knowledge_cache_state", (kcs) => {
      const sa = kcs?.session_access;
      if (!sa || Object.keys(sa).length === 0) return;

      // Step 1: Remove invalid keys (preserved from original)
      for (const key of Object.keys(sa)) {
        if (INVALID_KEYS.includes(key)) {
          delete sa[key];
          invalidRemoved++;
        }
      }

      // Step 2: KC-03 — Read prune thresholds from project.config.json
      const configPath = join(PROJECT_ROOT, ".opencode", "project.config.json");
      let config: any = {};
      try {
        if (existsSync(configPath)) {
          config = JSON.parse(readFileSync(configPath, "utf8"));
        }
      } catch {
        /* keep defaults */
      }

      const pruneOpts: PruneOptions = {
        cutoff_ms: Date.now() - ((config?.template_resolution?.["knowledge.session_access_ttl_days"] || 30) * 24 * 60 * 60 * 1000),
      };

      // Step 3: KC-03 — Nested pruning via shared helper (in-memory SessionAccess)
      pruneResult = pruneSessionAccess(sa as any, pruneOpts);

      // Step 3b: KC-14 — DB-level pruning with optional archiving
      try {
        const dbPruneResult = pruneSessionAccessFromDB(pruneOpts);
        if ((dbPruneResult as any).archivedRows && (dbPruneResult as any).archivedRows > 0) {
          writeLog(NC_SRC, "INFO", {
            event: "KC-SESSION-ACCESS-ARCHIVED-NIGHTLY",
            detail: `rows=${(dbPruneResult as any).archivedRows} archived to knowledge_session_access_archive`,
          });
        }
        if (dbPruneResult.pruned_tasks > 0) {
          writeLog(NC_SRC, "INFO", {
            event: "KC-SESSION-ACCESS-DB-PRUNED-NIGHTLY",
            detail: `rows=${dbPruneResult.pruned_tasks} pruned from knowledge_session_access`,
          });
        }
      } catch (dbPruneErr) {
        writeLog(NC_SRC, "WARN", {
          event: "KC-SESSION-ACCESS-DB-PRUNE-FAILED",
          detail: `DB-level prune failed: ${dbPruneErr instanceof Error ? dbPruneErr.message : String(dbPruneErr)}`,
        });
      }
    });

    if (invalidRemoved > 0 && ok) {
      log(
        `[${stepName}] Removed ${invalidRemoved} invalid session_access entries.`,
      );
    }
    const totalPruned =
      pruneResult.pruned_tasks +
      pruneResult.pruned_domains +
      pruneResult.pruned_agents;
    if (totalPruned > 0 && ok) {
      log(
        `[${stepName}] KC-03 pruneSessionAccess: tasks=${pruneResult.pruned_tasks} domains=${pruneResult.pruned_domains} agents=${pruneResult.pruned_agents}`,
      );
      writeLog(NC_SRC, "INFO", {
        event: "KC-SESSION-ACCESS-PRUNED-NIGHTLY",
        detail: `tasks=${pruneResult.pruned_tasks} domains=${pruneResult.pruned_domains} agents=${pruneResult.pruned_agents}`,
        source: "nightly-compaction",
      });
    } else if (ok) {
      log(`[${stepName}] All entries fresh — no cleanup needed.`);
    } else {
      log(`[${stepName}] CAS write failed after 3 retries`);
    }
  } catch (err) {
    log(
      `[${stepName}] ERROR: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// P3/S63-1 + S63-2 + S63-5: Nightly DB maintenance.
// - dbCleanStaleEntries(): delete audit/WAL rows >7 days old (S63-1)
// - PRAGMA wal_checkpoint(TRUNCATE): reclaim WAL space (S63-1)
// - dbVacuum(): weekly reclaim free pages (Sundays only) (S63-5)
async function dbMaintenanceStep() {
  const stepName = "db-maintenance";
  if (DRY_RUN) {
    log(
      `[${stepName}] Would clean stale audit entries (>7d), WAL checkpoint (TRUNCATE), and vacuum (Sundays) — DRY-RUN`,
    );
    return;
  }
  try {
    // 1. Clean stale audit rows (db-manager handles all 4 tables internally)
    const deleted = dbCleanStaleEntries();
    log(`[${stepName}] Cleaned ${deleted} stale audit/WAL rows (>7 days)`);
    writeLog(NC_SRC, "INFO", {
      event: "DB-CLEAN-STALE",
      detail: `deleted=${deleted}`,
    });

    // 2. WAL checkpoint + truncate (reclaim WAL space)
    const db = getDb();
    db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    log(`[${stepName}] WAL checkpoint (TRUNCATE) complete`);
    writeLog(NC_SRC, "INFO", {
      event: "DB-WAL-CHECKPOINT",
      detail: "TRUNCATE",
    });

    // 3. Weekly vacuum (Sundays only — VACUUM is expensive, ~1-2s)
    const dayOfWeek = new Date().getDay();
    if (dayOfWeek === 0) {
      const vacOk = dbVacuum();
      log(
        `[${stepName}] Sunday VACUUM: ${vacOk ? "complete" : "failed (see log)"}`,
      );
      if (vacOk)
        writeLog(NC_SRC, "INFO", {
          event: "DB-VACUUM",
          detail: "Sunday maintenance",
        });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[${stepName}] ERROR: ${msg}`);
    writeLog(NC_SRC, "ERROR", { event: "DB-MAINTENANCE-FAILED", detail: msg });
  }
}

/**
 * OPT-10 (2026-06-23): Nightly log archiving.
 * Archives log files older than 7 days or larger than 10MB
 * to .task_temp/_logs/archive/{YYYY-MM-DD}/.
 */
async function logArchiveStep(): Promise<void> {
  const stepName = "Log Archive";
  const LOG_DIR = join(process.env.OPENCODE_ROOT || ".", ".opencode", "logs");
  const TEMP_LOG_DIR = join(
    process.env.OPENCODE_ROOT || ".",
    ".task_temp",
    "_logs",
  );
  const ARCHIVE_ROOT = join(
    process.env.OPENCODE_ROOT || ".",
    ".task_temp",
    "_logs",
    "archive",
  );
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_SIZE_BYTES = 10 * 1024 * 1024;
  const now = Date.now();

  try {
    const today = new Date().toISOString().slice(0, 10);
    const archiveDir = join(ARCHIVE_ROOT, today);
    let archivedCount = 0;

    for (const logDir of [LOG_DIR, TEMP_LOG_DIR]) {
      if (!existsSync(logDir)) continue;
      try {
        for (const entry of readdirSync(logDir)) {
          if (!entry.endsWith(".log")) continue;
          const fullPath = join(logDir, entry);
          try {
            const st = statSync(fullPath);
            const age = now - st.mtimeMs;
            if (age > MAX_AGE_MS || st.size > MAX_SIZE_BYTES) {
              if (!existsSync(archiveDir))
                mkdirSync(archiveDir, { recursive: true });
              const archivePath = join(archiveDir, entry);
              renameSync(fullPath, archivePath);
              archivedCount++;
              writeLog(NC_SRC, "INFO", {
                event: "LOG-ARCHIVED",
                detail: `${entry} → archive/${today}/${entry} (age=${Math.round(age / 86400000)}d, size=${Math.round(st.size / 1024)}KB)`,
              });
            }
          } catch {
            /* skip unreadable files */
          }
        }
      } catch {
        /* skip unreadable dirs */
      }
    }
    log(`[${stepName}] ${archivedCount} log files archived to ${today}/`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[${stepName}] ERROR: ${msg}`);
    writeLog(NC_SRC, "ERROR", { event: "LOG-ARCHIVE-FAILED", detail: msg });
  }
}

/**
 * OPT-P1 (2026-06-24): Cleanup stale ctx/ files from .task_temp/_dispatch/ctx/.
 * Removes per-dispatch context files older than 24 hours that were left behind
 * by task-after.ts when sub-agents failed or checklist blocked cleanup.
 */
async function cleanupStaleCtxFiles(): Promise<void> {
  const stepName = "Ctx Cleanup";
  const CTX_DIR = join(
    process.env.OPENCODE_ROOT || ".",
    ".task_temp",
    "_dispatch",
    "ctx",
  );
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  let removedCount = 0;

  try {
    if (!existsSync(CTX_DIR)) return;
    for (const entry of readdirSync(CTX_DIR)) {
      if (!entry.endsWith(".json")) continue;
      const fullPath = join(CTX_DIR, entry);
      try {
        const st = statSync(fullPath);
        if (now - st.mtimeMs > MAX_AGE_MS) {
          rmSync(fullPath);
          removedCount++;
          writeLog(NC_SRC, "INFO", {
            event: "CTX-CLEANUP",
            detail: `${entry} removed (age=${Math.round((now - st.mtimeMs) / 3600000)}h)`,
          });
        }
      } catch {
        /* skip */
      }
    }
    log(`[${stepName}] ${removedCount} stale ctx/ files removed`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[${stepName}] ERROR: ${msg}`);
    writeLog(NC_SRC, "ERROR", { event: "CTX-CLEANUP-FAILED", detail: msg });
  }
}

const hotFile = join(STATE_DIR, "gate-state.hot.json");

async function main() {
  log(`Nightly Compaction — ${TODAY} ${DRY_RUN ? "(DRY-RUN)" : ""}`);
  log("");

  await compactGateState();
  log("");

  if (WITH_DAG) {
    await archiveOldDAGTasks();
    log("");
  }

  // SA-IMPL-BACKUP-LIFECYCLE: Nightly cleanup of stale .opencode_backups/
  await cleanupStaleBackupsStep();
  log("");

  // SA-IMPL-SELF-CLEANUP: Nightly cleanup of stale session_access entries
  await cleanupStaleSessionAccessStep();
  log("");

  // P3/S63-1: Nightly DB maintenance (stale cleanup + WAL checkpoint + weekly vacuum)
  await dbMaintenanceStep();
  log("");

  // OPT-10 (2026-06-23): Nightly log archiving — auto-archive logs >7 days or >10MB.
  await logArchiveStep();
  log("");

  // OPT-P1 (2026-06-24): Cleanup stale per-dispatch ctx/ files (>24h)
  await cleanupStaleCtxFiles();
  log("");

  log("Nightly compaction complete.");
  if (existsSync(hotFile)) {
    const hot = JSON.parse(readFileSync(hotFile, "utf8"));
    log(
      `Gate hot file: ${hot.meta?.active_count || 0} active, ${hot.meta?.recent_count || 0} recent`,
    );
  }
}

main().catch((err) => {
  console.error("Compaction failed:", err.message);
  process.exit(1);
});
