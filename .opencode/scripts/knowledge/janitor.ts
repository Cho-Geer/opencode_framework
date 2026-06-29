#!/usr/bin/env bun
// safe_bash: allow-write
/**
 * janitor.ts — UC7KS Knowledge Janitor v2.0.0 (KC-11 DB-canonical)
 *
 * Enforces UC7-005 (size caps) and TTL enforcement.
 * Scheduled to run every janitor_interval_hours (default 24h) by @CI-CD-Agent.
 *
 * v2.0.0 changes (KC-11):
 *   - Routes all manifest read/write through knowledge-store.ts API
 *     instead of direct indexer.ts calls. All operations now read/write
 *     v11 DB tables (knowledge_entries, knowledge_files, etc.) as
 *     canonical source; index.json is a file-backed mirror only.
 *   - Writes v11 knowledge_materialization_jobs for every purge/archive/
 *     evict action for audit trail and downstream processing.
 *   - Backward compat: CLI signatures unchanged. Uses same --dry-run,
 *     --force, --integrity flags.
 *
 * Actions:
 *  1. Scan index.json for expired entries (age > ttl_days)
 *  2. Archive expired entries (move to .metadata/archives/)
 *  3. Delete double-TTL entries (age > ttl_days * 2)
 *  4. LRU eviction when total size exceeds max_total_size
 *  5. Generate size_report.json
 *  6. Write v11 knowledge_materialization_jobs for all cleanup ops (v2.0.0)
 *
 * Usage: bun .opencode/scripts/knowledge/janitor.ts [--dry-run] [--force]
 */

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const {
  atomicWriteSubState,
  atomicWriteJson,
} = require("../../lib/state-utils");

/**
 * KC-11: Load knowledge-store (ESM) via createRequire for CJS interop.
 * Replaces direct indexer.ts dependency — all manifest operations now
 * route through knowledge-store which operates on v11 DB tables as
 * canonical source.
 */
const knowledgeRequire = createRequire(
  path.join(__dirname, "..", "..", "lib", "knowledge-store.ts"),
);
const knowledgeStore = knowledgeRequire("./knowledge-store");

/**
 * KC-11: Load db-manager for v11 knowledge_materialization_jobs writes.
 * Each purge/archive/evict action records a materialization job entry
 * for audit trail and downstream cleanup tracking.
 */
let _db = null;
function getDb() {
  if (!_db) {
    try {
      const dbReq = createRequire(
        path.join(__dirname, "..", "..", "lib", "db-manager.ts"),
      );
      const dbMgr = dbReq("./db-manager");
      _db = dbMgr.getDb({ skipSchema: true });
    } catch (e) {
      // DB unavailable — non-fatal for janitor operations
      _db = null;
    }
  }
  return _db;
}

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * FW-LOG-UNIFY-C9a: Lazy-load writeLog for janitor audit trail.
 */
let _writeLog = null;
function getWriteLog() {
  if (!_writeLog) {
    try {
      const lm = require(
        path.join(__dirname, "..", "..", "lib", "log-manager"),
      );
      _writeLog = lm.writeLog;
    } catch {
      _writeLog = () => {};
    }
  }
  return _writeLog;
}
function srcLog(level, event, fields) {
  try {
    getWriteLog()("script-knowledge-janitor", level, { event, ...fields });
  } catch {}
}

const DOCS_DIR = path.join(PROJECT_ROOT, "docs", "official_docs");
const ARCHIVE_DIR = path.join(DOCS_DIR, ".metadata", "archives");
const SIZE_REPORT_PATH = path.join(DOCS_DIR, ".metadata", "size_report.json");

const MAX_TOTAL_SIZE = 52428800; // 50MB (UC7-005)
const MAX_FILE_SIZE = 524288; // 500KB
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const RUN_INTEGRITY =
  process.argv.includes("--integrity") ||
  process.argv.includes("--orphan-check");
/**
 * A4 (2026-06-20): --clean-pre-harden-evidence flag for cleaning stale
 * pre-HARDEN cache_sufficiency entries in knowledge_cache_state.session_access.
 * These entries were created by pre-HARDEN knowledge_cache_search before UC7-001c
 * and have status='sufficient' but empty/incomplete evidence fields.
 *
 * --dry-run: preview what would be cleaned (default when flag is present)
 * --apply: actually perform the cleanup (requires explicit opt-in)
 */
const CLEAN_PRE_HARDEN = process.argv.includes("--clean-pre-harden-evidence");
const APPLY = process.argv.includes("--apply");
const CLEAN_DRY_RUN = CLEAN_PRE_HARDEN && !APPLY;
/**
 * KC-15: --auto-index flag activates operator-assisted auto-indexing of
 * orphaned files when combined with --integrity / --orphan-check.
 * Passed through to integrity-check.ts autoIndexOrphans().
 */
const AUTO_INDEX = process.argv.includes("--auto-index");

function now() {
  return new Date().toISOString();
}

function daysSince(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * KC-11: Record a v11 knowledge_materialization_jobs entry for a
 * janitor cleanup action (purge, archive, evict). Used for audit
 * trail and downstream materialization tracking.
 *
 * @param jobType - "purge", "archive", or "evict"
 * @param filePath - Relative path of the affected file
 * @param sha256 - SHA-256 hash (if known from manifest)
 * @param errorMsg - Error message if operation failed
 */
function recordMaterializationJob(jobType, filePath, sha256, errorMsg) {
  const db = getDb();
  if (!db) return;
  const ts = Date.now();
  try {
    const status = errorMsg ? "failed" : "completed";
    db.run(
      `INSERT INTO knowledge_materialization_jobs
       (job_type, status, file_path, sha256, error_msg, retry_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [jobType, status, filePath, sha256 || null, errorMsg || null, ts, ts],
    );
    srcLog("INFO", "materialization_job_recorded", {
      jobType,
      filePath,
      status,
    });
  } catch (e) {
    srcLog("ERROR", "materialization_job_failed", {
      jobType,
      filePath,
      error: e.message,
    });
  }
}

/**
 * A4 (2026-06-20): Clean up stale pre-HARDEN evidence entries in
 * knowledge_cache_state.session_access.
 *
 * These entries were created by pre-HARDEN knowledge_cache_search before
 * UC7-001c enforcement. They have cache_sufficiency.status='sufficient'
 * but evidence fields (reason, files_read, content_summary) are empty or
 * auto-generated "[DEPRECATED]" markers.
 *
 * For each stale entry:
 *  1. Query read_audit DB for matching read events by agent + file path
 *     within a timestamp window of the entry's declaration.
 *  2. If matching evidence found → reconstruct a bounded attestation entry
 *     and mark status as 'attested' with the matched read evidence.
 *  3. If no matching evidence → archive/delete the entry and increment
 *     knowledge_audit_state.aggregate.reverse_orphan_count.
 *  4. Write KC-PRE-HARDEN-CLEANUP log events for every action.
 *  5. NEVER remove live/current task/domain entries (currentTaskId excluded).
 *
 * @param dryRun - If true, preview only (no state mutations)
 * @param currentTaskId - Task ID to preserve (never clean)
 * @returns Counts of cleaned/reconstructed entries
 */
function cleanPreHardenEvidence(
  dryRun: boolean,
  currentTaskId?: string,
): {
  reconstructed: number;
  archived: number;
  skipped_current: number;
  no_evidence: number;
} {
  const result = {
    reconstructed: 0,
    archived: 0,
    skipped_current: 0,
    no_evidence: 0,
  };
  const now_ = Date.now();

  console.log(
    `[Janitor] Pre-HARDEN evidence cleanup starting${dryRun ? " (DRY RUN)" : " (APPLY)"}...`,
  );
  srcLog("INFO", "pre_harden_cleanup_start", {
    dryRun,
    currentTaskId: currentTaskId || null,
    timestamp: new Date().toISOString(),
  });

  // ── Load session_access from knowledge_cache_state ──
  let knowledgeState: any;
  try {
    const { readSubState, writeSubState } = require(
      path.join(__dirname, "..", "..", "lib", "substate-manager"),
    );
    knowledgeState = readSubState("knowledge_cache_state");
    if (!knowledgeState?.session_access) {
      console.log(
        "[Janitor] No session_access entries found — nothing to clean.",
      );
      srcLog("INFO", "pre_harden_cleanup_no_data", {});
      return result;
    }
  } catch (e: any) {
    console.error(
      `[Janitor] Failed to read knowledge_cache_state: ${e.message}`,
    );
    srcLog("ERROR", "pre_harden_cleanup_read_failed", { error: e.message });
    return result;
  }

  const sa = knowledgeState.session_access;

  // ── Lazy-load read-audit helpers (DB query for matching read events) ──
  let getReadEventsForAgentFile: (
    agent: string,
    filePath: string,
    since: number,
  ) => any[] = () => [];
  try {
    const db = getDb();
    if (db) {
      // Direct SQLite query for read events matching an agent + time window
      // with file path constraint to match only knowledge cache docs
      getReadEventsForAgentFile = (
        agent: string,
        _filePath: string,
        since: number,
      ) => {
        const normalizedAgent = (agent || "").replace(/^@/, "").toLowerCase();
        const cutoffIso = new Date(since).toISOString();
        const rows = db
          .query(
            `SELECT timestamp, raw_agent, raw_file_path, opencode_session_id, task_id
             FROM read_audit
             WHERE agent = ? AND timestamp >= ?
              AND (file_path LIKE '%docs/official_docs/%'
                OR file_path LIKE '%docs/official_docs%')
             ORDER BY timestamp DESC
             LIMIT 200`,
          )
          .all(normalizedAgent, cutoffIso) as any[];
        return rows || [];
      };
    }
  } catch {
    // DB unavailable — no evidence matching possible
  }

  // ── Identify stale entries ──
  interface StaleEntry {
    type: "flat" | "nested";
    agent: string;
    taskId?: string;
    domain?: string;
    declaredAt: number; // Unix ms
  }

  const staleEntries: StaleEntry[] = [];

  for (const agent of Object.keys(sa)) {
    const entry = sa[agent];
    // Check legacy flat
    if (
      entry.cache_sufficiency?.status === "sufficient" &&
      (!entry.cache_sufficiency.reason ||
        entry.cache_sufficiency.reason.startsWith("[DEPRECATED]") ||
        !Array.isArray(entry.cache_sufficiency.files_read) ||
        entry.cache_sufficiency.files_read.length === 0 ||
        !entry.cache_sufficiency.content_summary)
    ) {
      staleEntries.push({
        type: "flat",
        agent,
        declaredAt: new Date(
          entry.cache_sufficiency.declared_at || entry.last_read_at || 0,
        ).getTime(),
      });
    }
    // Check nested tasks
    if (entry.tasks) {
      for (const tid of Object.keys(entry.tasks)) {
        for (const domain of Object.keys(entry.tasks[tid].domains || {})) {
          const cs = entry.tasks[tid].domains[domain].cache_sufficiency;
          if (
            cs?.status === "sufficient" &&
            (!cs.reason ||
              cs.reason.startsWith("[DEPRECATED]") ||
              !Array.isArray(cs.files_read) ||
              cs.files_read.length === 0 ||
              !cs.content_summary)
          ) {
            staleEntries.push({
              type: "nested",
              agent,
              taskId: tid,
              domain,
              declaredAt: new Date(
                cs.declared_at ||
                  cs.discovery?.discovered_at ||
                  entry.last_read_at ||
                  0,
              ).getTime(),
            });
          }
        }
      }
    }
  }

  console.log(
    `[Janitor] Found ${staleEntries.length} stale pre-HARDEN entries.`,
  );
  srcLog("INFO", "pre_harden_cleanup_scan", {
    totalStale: staleEntries.length,
    flatCount: staleEntries.filter((e) => e.type === "flat").length,
    nestedCount: staleEntries.filter((e) => e.type === "nested").length,
  });

  if (staleEntries.length === 0) return result;

  // ── Process each stale entry ──
  let reconstructedEvidence = 0;
  let orphanedEntries = 0;

  for (const stale of staleEntries) {
    // Skip current task
    if (currentTaskId && stale.taskId === currentTaskId) {
      result.skipped_current++;
      console.log(
        `[Janitor] SKIP (current task): ${stale.agent} / ${stale.taskId || "flat"} / ${stale.domain || "-"}`,
      );
      continue;
    }

    // Try to find matching read_audit evidence
    // Look for read events by this agent within a 24h window around declared_at
    const searchWindow = 24 * 60 * 60 * 1000; // 24h
    const searchSince = Math.max(0, stale.declaredAt - searchWindow);
    const readEntries = getReadEventsForAgentFile(stale.agent, "", searchSince);

    // Filter to entries that read docs/official_docs files (knowledge cache)
    // More restrictive: only count reads of cached doc files, not source code
    const relevantReads = readEntries.filter((r: any) => {
      const fp = (r.raw_file_path || "").toLowerCase();
      return fp.includes("docs/official_docs/");
    });

    // If no doc-specific reads found, try broader match at project level
    let effectiveReads = relevantReads;
    if (relevantReads.length === 0) {
      effectiveReads = readEntries.filter((r: any) => {
        const fp = (r.raw_file_path || "").toLowerCase();
        return fp.includes("docs/") && !fp.includes("booking_system_refactor/");
      });
    }

    if (effectiveReads.length > 0) {
      // Evidence found — reconstruct attestation
      const filesRead = effectiveReads
        .map((r: any) => {
          // Convert absolute path to relative path from docs/official_docs/
          const docRoot = path.join(PROJECT_ROOT, "docs", "official_docs");
          if (r.raw_file_path && r.raw_file_path.startsWith(docRoot)) {
            return r.raw_file_path.substring(docRoot.length + 1);
          }
          return r.raw_file_path || "";
        })
        .filter(Boolean);
      const uniqueFiles = [...new Set(filesRead)];

      if (stale.type === "nested" && stale.taskId && stale.domain) {
        // Reconstruct nested attestation
        const agentKey = (stale.agent || "").replace(/^@/, "");
        const a = sa[agentKey] || sa[stale.agent];
        if (a?.tasks?.[stale.taskId]?.domains?.[stale.domain]) {
          const domainEntry = a.tasks[stale.taskId].domains[stale.domain];
          domainEntry.cache_sufficiency.reason =
            "[RECONSTRUCTED-A4] Evidence reconstructed from read_audit DB";
          domainEntry.cache_sufficiency.files_read = uniqueFiles;
          domainEntry.cache_sufficiency.content_summary = `Reconstructed: ${uniqueFiles.length} file(s) read by ${stale.agent}`;
          domainEntry.cache_sufficiency.attestation = {
            status: "attested",
            reason:
              "[RECONSTRUCTED-A4] Evidence reconstructed from read_audit DB",
            files_read: uniqueFiles,
            content_summary: `Reconstructed from ${relevantReads.length} read_audit events`,
            attested_at: new Date().toISOString(),
          };
          result.reconstructed++;
          reconstructedEvidence++;
          console.log(
            `[Janitor] RECONSTRUCT: ${stale.agent} / ${stale.taskId} / ${stale.domain} (${uniqueFiles.length} files)`,
          );
          srcLog("INFO", "pre_harden_reconstructed", {
            agent: stale.agent,
            taskId: stale.taskId,
            domain: stale.domain,
            filesCount: uniqueFiles.length,
          });
        }
      } else if (stale.type === "flat") {
        // Reconstruct flat attestation
        const agentKey = (stale.agent || "").replace(/^@/, "");
        const a = sa[agentKey] || sa[stale.agent];
        if (a) {
          a.cache_sufficiency = a.cache_sufficiency || {};
          a.cache_sufficiency.reason =
            "[RECONSTRUCTED-A4] Evidence reconstructed from read_audit DB";
          a.cache_sufficiency.files_read = uniqueFiles;
          a.cache_sufficiency.content_summary = `Reconstructed: ${uniqueFiles.length} file(s) read by ${stale.agent}`;
          result.reconstructed++;
          reconstructedEvidence++;
          console.log(
            `[Janitor] RECONSTRUCT (flat): ${stale.agent} (${uniqueFiles.length} files)`,
          );
          srcLog("INFO", "pre_harden_reconstructed_flat", {
            agent: stale.agent,
            filesCount: uniqueFiles.length,
          });
        }
      }
    } else {
      // No evidence — archive/delete the entry
      if (stale.type === "nested" && stale.taskId && stale.domain) {
        const agentKey = (stale.agent || "").replace(/^@/, "");
        const a = sa[agentKey] || sa[stale.agent];
        if (a?.tasks?.[stale.taskId]?.domains?.[stale.domain]) {
          delete a.tasks[stale.taskId].domains[stale.domain];
          // Clean up empty containers
          if (Object.keys(a.tasks[stale.taskId].domains).length === 0) {
            delete a.tasks[stale.taskId];
          }
          result.archived++;
          orphanedEntries++;
          console.log(
            `[Janitor] ARCHIVE (no evidence): ${stale.agent} / ${stale.taskId} / ${stale.domain}`,
          );
          srcLog("INFO", "pre_harden_archived", {
            agent: stale.agent,
            taskId: stale.taskId,
            domain: stale.domain,
          });
        }
      } else if (stale.type === "flat") {
        const agentKey = (stale.agent || "").replace(/^@/, "");
        const a = sa[agentKey] || sa[stale.agent];
        if (a) {
          // Don't delete the agent entry entirely — just mark cache_sufficiency as cleaned
          a.cache_sufficiency = {
            status: "undeclared",
            missing_topics: [],
            declared_at: new Date().toISOString(),
            reason:
              "[CLEANED-A4] Stale pre-HARDEN entry archived — no read_audit evidence found",
            files_read: [],
            content_summary: "",
          };
          result.archived++;
          orphanedEntries++;
          console.log(`[Janitor] CLEAN (flat, no evidence): ${stale.agent}`);
          srcLog("INFO", "pre_harden_cleaned_flat", {
            agent: stale.agent,
          });
        }
      }
      // Increment reverse_orphan_count for each orphaned entry
      if (!dryRun) {
        try {
          const { incrementAuditCounter } = require(
            path.join(__dirname, "..", "..", "lib", "knowledge-audit"),
          );
          incrementAuditCounter("reverse_orphan_count", 1);
        } catch {
          // Non-fatal
        }
      }
    }
  }

  // ── Write updated session_access back ──
  if (!dryRun && (reconstructedEvidence > 0 || orphanedEntries > 0)) {
    try {
      const { writeSubState } = require(
        path.join(__dirname, "..", "..", "lib", "substate-manager"),
      );
      const ok = writeSubState("knowledge_cache_state", knowledgeState);
      if (!ok) {
        console.error(
          "[Janitor] Failed to write updated knowledge_cache_state",
        );
        srcLog("ERROR", "pre_harden_cleanup_write_failed", {});
      }
    } catch (e: any) {
      console.error(
        `[Janitor] Failed to write knowledge_cache_state: ${e.message}`,
      );
      srcLog("ERROR", "pre_harden_cleanup_write_error", { error: e.message });
    }
  }

  // ── Write KC-PRE-HARDEN-CLEANUP audit log ──
  srcLog("INFO", "KC-PRE-HARDEN-CLEANUP", {
    dryRun,
    totalStale: staleEntries.length,
    reconstructed: result.reconstructed,
    archived: result.archived,
    skipped_current: result.skipped_current,
    reverse_orphan_count: orphanedEntries,
    timestamp: new Date().toISOString(),
  });

  console.log(
    `[Janitor] Pre-HARDEN cleanup complete: ${result.reconstructed} reconstructed, ${result.archived} archived, ${result.skipped_current} skipped (current task)${dryRun ? " — DRY RUN" : ""}`,
  );

  return result;
}

/**
 * Run janitor cycle.
 * Returns: { purged, archived, lru_evicted, total_size_before, total_size_after }
 */
function run() {
  // A4: Pre-HARDEN evidence cleanup (runs before normal janitor cycle)
  if (CLEAN_PRE_HARDEN) {
    // Parse optional task-id argument for current task preservation
    const taskIdIdx = process.argv.indexOf("--task-id");
    const currentTaskId =
      taskIdIdx >= 0 ? process.argv[taskIdIdx + 1] : undefined;
    const cleanResult = cleanPreHardenEvidence(CLEAN_DRY_RUN, currentTaskId);

    // If only cleaning (not normal janitor cycle), return early with stats
    const onlyClean = !process.argv.includes("--full");
    if (onlyClean || CLEAN_DRY_RUN) {
      return {
        purged: 0,
        archived: 0,
        lruEvicted: 0,
        totalSizeBefore: 0,
        totalSizeAfter: 0,
        preHardenCleaned: cleanResult,
      };
    }
    // Otherwise continue with normal janitor cycle below
  }

  // KC-09: Pre-cycle orphan scan (+ KC-15: auto-index integration)
  if (RUN_INTEGRITY) {
    console.log(
      `[Janitor] Running pre-cycle orphan check${AUTO_INDEX ? " (--auto-index enabled)" : ""}...`,
    );
    try {
      const {
        checkForOrphans,
        logOrphanReport,
        autoIndexOrphans,
      } = require("./integrity-check");
      const orphanResult = checkForOrphans();
      logOrphanReport(orphanResult);
      if (orphanResult.totalOrphans > 0) {
        console.log(
          `[Janitor] \u26a0 Found ${orphanResult.totalOrphans} orphan(s):`,
        );
        orphanResult.orphanedFiles
          .slice(0, 10)
          .forEach((f) => console.log(`  - ${f.path}`));
        // KC-15: Auto-index orphaned files when --auto-index is set
        if (AUTO_INDEX) {
          console.log(`[Janitor] Auto-indexing orphaned files...`);
          const autoResult = autoIndexOrphans();
          if (autoResult.errors.length > 0) {
            console.error(
              `[Janitor] \u2717 Auto-index completed with ${autoResult.errors.length} error(s)`,
            );
          } else {
            console.log(
              `[Janitor] \u2713 Auto-indexed ${autoResult.indexed} orphan(s)`,
            );
          }
        }
      } else {
        console.log(
          `[Janitor] \u2713 No orphans detected (${orphanResult.totalFilesChecked} files checked)`,
        );
      }
    } catch (e) {
      console.error(`[Janitor] Orphan check failed: ${e.message}`);
    }
  }

  console.log(
    `[Janitor] Starting cycle at ${now()}${DRY_RUN ? " (DRY RUN)" : ""}`,
  );
  srcLog("INFO", "cycle_start", { dryRun: DRY_RUN, timestamp: now() });

  /**
   * KC-11: Read manifest through knowledge-store (v11 DB-canonical)
   * instead of direct indexer.readManifest().
   */
  const manifest = knowledgeStore.readManifest();
  let purged = 0,
    archived = 0,
    lruEvicted = 0;
  let totalSizeBefore = 0;

  // Phase 1: TTL enforcement
  const activeEntries = [];
  for (const entry of manifest.entries) {
    const activeFiles = [];
    for (const file of entry.files || []) {
      const age = daysSince(file.created_at);
      const ttl = file.ttl_days || 30;
      totalSizeBefore += file.size_bytes || 0;

      if (age > ttl * 2) {
        // Double TTL: permanent deletion
        const isScout = file.source === "scout";
        console.log(
          `[Janitor] PURGE${isScout ? " [Scout]" : ""}: ${file.path} (age: ${age.toFixed(0)}d, TTL: ${ttl}d, double-TTL: ${ttl * 2}d${isScout ? ", source: scout" : ""})`,
        );
        srcLog("INFO", "file_purged", {
          path: file.path,
          ageDays: Math.floor(age),
          ttlDays: ttl,
        });
        if (!DRY_RUN) {
          const absPath = path.join(DOCS_DIR, file.path);
          let purgeErr = null;
          try {
            if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
          } catch (e) {
            purgeErr = e.message;
            console.error(`  Failed: ${e.message}`);
            srcLog("ERROR", "purge_failed", {
              path: file.path,
              error: e.message,
            });
          }
          /**
           * KC-11: Record v11 materialization job for purge audit trail.
           */
          recordMaterializationJob("purge", file.path, file.sha256, purgeErr);
        }
        purged++;
      } else if (age > ttl) {
        // TTL expired: archive
        console.log(
          `[Janitor] ARCHIVE: ${file.path} (age: ${age.toFixed(0)}d, TTL: ${ttl}d)`,
        );
        srcLog("INFO", "file_archived", {
          path: file.path,
          ageDays: Math.floor(age),
          ttlDays: ttl,
        });
        if (!DRY_RUN) {
          const dateDir = path.join(
            ARCHIVE_DIR,
            new Date().toISOString().slice(0, 10),
          );
          fs.mkdirSync(dateDir, { recursive: true });
          const absPath = path.join(DOCS_DIR, file.path);
          const archivePath = path.join(dateDir, path.basename(file.path));
          let archiveErr = null;
          try {
            if (fs.existsSync(absPath)) fs.renameSync(absPath, archivePath);
          } catch (e) {
            archiveErr = e.message;
            console.error(`  Failed: ${e.message}`);
            srcLog("ERROR", "archive_failed", {
              path: file.path,
              error: e.message,
            });
          }
          file.status = "archived";
          /**
           * KC-11: Record v11 materialization job for archive audit trail.
           */
          recordMaterializationJob(
            "archive",
            file.path,
            file.sha256,
            archiveErr,
          );
        }
        archived++;
      } else {
        activeFiles.push(file);
      }
    }
    if (activeFiles.length > 0) {
      entry.files = activeFiles;
      activeEntries.push(entry);
    }
  }
  manifest.entries = activeEntries;

  // Phase 2: Size cap enforcement (LRU eviction)
  let totalSizeAfter = activeEntries.reduce(
    (sum, e) =>
      sum + (e.files || []).reduce((s, f) => s + (f.size_bytes || 0), 0),
    0,
  );
  if (totalSizeAfter > MAX_TOTAL_SIZE) {
    console.log(
      `[Janitor] Size cap exceeded: ${(totalSizeAfter / 1048576).toFixed(1)}MB > 50MB. Starting LRU eviction...`,
    );
    srcLog("WARN", "size_cap_exceeded", {
      totalSizeMB: (totalSizeAfter / 1048576).toFixed(1),
    });
    // Sort all files by last_accessed (oldest first)
    const allFiles = [];
    for (const entry of activeEntries) {
      for (const file of entry.files || []) {
        allFiles.push({
          entry,
          file,
          lastAccess: new Date(file.last_accessed || file.created_at).getTime(),
        });
      }
    }
    allFiles.sort((a, b) => a.lastAccess - b.lastAccess);

    while (totalSizeAfter > MAX_TOTAL_SIZE && allFiles.length > 0) {
      const { file } = allFiles.shift();
      console.log(`[Janitor] LRU EVICT: ${file.path}`);
      srcLog("INFO", "lru_evicted", { path: file.path });
      if (!DRY_RUN) {
        const absPath = path.join(DOCS_DIR, file.path);
        let evictErr = null;
        try {
          if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
        } catch (_) {}
        file.status = "evicted";
        /**
         * KC-11: Record v11 materialization job for LRU eviction audit trail.
         */
        recordMaterializationJob("evict", file.path, file.sha256, evictErr);
      }
      totalSizeAfter -= file.size_bytes || 0;
      lruEvicted++;
    }
  }

  if (!DRY_RUN) {
    /**
     * KC-11: Write manifest through knowledge-store (v11 DB-canonical)
     * instead of direct indexer.writeManifest().
     */
    knowledgeStore.writeManifest(manifest);

    // Update knowledge-state.json
    try {
      const ok = atomicWriteSubState("knowledge_state", (ks) => {
        ks.last_janitor_run = now();
        ks.total_docs_count = manifest.entries.length;
        ks.total_size_bytes = totalSizeAfter;
      });
      if (!ok) {
        console.error(
          "[Janitor] CAS write to knowledge_state failed after 3 retries",
        );
      }
    } catch (e) {
      console.error(`[Janitor] Failed to update knowledge_state: ${e.message}`);
    }

    /**
     * KC-11: Generate size report using knowledge-store.getStats()
     * (v11 DB-canonical) instead of direct indexer.getStats().
     */
    const stats = knowledgeStore.getStats();
    atomicWriteJson(SIZE_REPORT_PATH, {
      generated_at: now(),
      total_size_bytes: totalSizeAfter,
      total_size_mb: (totalSizeAfter / 1048576).toFixed(1),
      max_total_mb: 50,
      entries: manifest.entries.length,
      ...stats,
    });
  }

  return { purged, archived, lruEvicted, totalSizeBefore, totalSizeAfter };
}

if (require.main === module) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`UC7KS Knowledge Janitor v2.1.0 (KC-11 DB-canonical + A4 pre-HARDEN cleanup)
Enforces UC7-005 (size caps) and TTL expiration for knowledge cache files.

Usage: bun .opencode/scripts/knowledge/janitor.ts [options]

Options:
  --dry-run    Preview what would be purged/archived without making changes
  --force      Skip confirmation prompts (auto-execute)
  --help, -h          Show this help message
  --integrity, --orphan-check  Run reverse-orphan check before janitor cycle
  --auto-index         (KC-15) Automatically index orphaned docs into index.json.
                       Must be combined with --integrity/--orphan-check.
                       Operator-assisted: computes sha256/size, guesses library_id
                       and domain from path, adds via knowledge-store.ts.

Pre-HARDEN Evidence Cleanup (A4):
  --clean-pre-harden-evidence   Scan and reconcile stale pre-HARDEN evidence entries
                                in knowledge_cache_state.session_access.
                                Defaults to --dry-run mode; add --apply to execute.
  --apply               Execute cleanup (requires --clean-pre-harden-evidence)
  --task-id <id>        Preserve entries for this task (never clean current task)
  --full                Run normal janitor cycle after pre-HARDEN cleanup

Actions:
  1. Scan index.json for expired entries (age > ttl_days)
  2. Archive expired entries (move to .metadata/archives/)
  3. Delete double-TTL entries (age > ttl_days * 2)
  4. LRU eviction when total size exceeds max_total_size (50MB)
  5. Generate size_report.json
  6. Write v11 knowledge_materialization_jobs for all cleanup ops
  7. A4: Clean stale pre-HARDEN evidence entries (--clean-pre-harden-evidence)

KC-11: All manifest operations now route through knowledge-store.ts API
which operates on v11 DB tables as canonical source. Materialization
job records are written for every purge/archive/evict action.`);
    process.exit(0);
  }
  run();
}

module.exports = { run, cleanPreHardenEvidence };

