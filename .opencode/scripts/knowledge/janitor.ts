// safe_bash: allow-write
/**
 * janitor.ts — UC7KS Knowledge Janitor v1.0.0
 *
 * Enforces UC7-005 (size caps) and UC7-006 (TTL enforcement).
 * Scheduled to run every janitor_interval_hours (default 24h) by @CI-CD-Agent.
 *
 * Actions:
 *  1. Scan index.json for expired entries (age > ttl_days)
 *  2. Archive expired entries (move to .metadata/archives/)
 *  3. Delete double-TTL entries (age > ttl_days * 2)
 *  4. LRU eviction when total size exceeds max_total_size
 *  5. Generate size_report.json
 *
 * Usage: bun .opencode/scripts/knowledge/janitor.ts [--dry-run] [--force]
 */

const fs = require("fs");
const path = require("path");
const { atomicWriteSubState, atomicWriteJson } = require("../../lib/state-utils");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * FW-LOG-UNIFY-C9a: Lazy-load writeLog for janitor audit trail.
 */
let _writeLog = null;
function getWriteLog() {
  if (!_writeLog) {
    try {
      const lm = require(path.join(__dirname, "..", "..", "lib", "log-manager"));
      _writeLog = lm.writeLog;
    } catch { _writeLog = () => {}; }
  }
  return _writeLog;
}
function srcLog(level, event, fields) {
  try { getWriteLog()("script-knowledge-janitor", level, { event, ...fields }); } catch {}
}

const DOCS_DIR = path.join(PROJECT_ROOT, "docs", "official_docs");
const ARCHIVE_DIR = path.join(DOCS_DIR, ".metadata", "archives");
const SIZE_REPORT_PATH = path.join(DOCS_DIR, ".metadata", "size_report.json");

const MAX_TOTAL_SIZE = 52428800;  // 50MB (UC7-005)
const MAX_FILE_SIZE = 524288;     // 500KB
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

function now() { return new Date().toISOString(); }

function daysSince(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Run janitor cycle.
 * Returns: { purged, archived, lru_evicted, total_size_before, total_size_after }
 */
function run() {
  console.log(`[Janitor] Starting cycle at ${now()}${DRY_RUN ? " (DRY RUN)" : ""}`);
  srcLog("INFO", "cycle_start", { dryRun: DRY_RUN, timestamp: now() });
  const manifest = readManifest();
  let purged = 0, archived = 0, lruEvicted = 0;
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
        console.log(`[Janitor] PURGE${isScout ? " [Scout]" : ""}: ${file.path} (age: ${age.toFixed(0)}d, TTL: ${ttl}d, double-TTL: ${ttl * 2}d${isScout ? ", source: scout" : ""})`);
        srcLog("INFO", "file_purged", { path: file.path, ageDays: Math.floor(age), ttlDays: ttl });
        if (!DRY_RUN) {
          const absPath = path.join(DOCS_DIR, file.path);
          try { if (fs.existsSync(absPath)) fs.unlinkSync(absPath); } catch (e) { console.error(`  Failed: ${e.message}`); srcLog("ERROR", "purge_failed", { path: file.path, error: e.message }); }
        }
        purged++;
      } else if (age > ttl) {
        // TTL expired: archive
        console.log(`[Janitor] ARCHIVE: ${file.path} (age: ${age.toFixed(0)}d, TTL: ${ttl}d)`);
        srcLog("INFO", "file_archived", { path: file.path, ageDays: Math.floor(age), ttlDays: ttl });
        if (!DRY_RUN) {
          const dateDir = path.join(ARCHIVE_DIR, new Date().toISOString().slice(0, 10));
          fs.mkdirSync(dateDir, { recursive: true });
          const absPath = path.join(DOCS_DIR, file.path);
          const archivePath = path.join(dateDir, path.basename(file.path));
          try { if (fs.existsSync(absPath)) fs.renameSync(absPath, archivePath); } catch (e) { console.error(`  Failed: ${e.message}`); srcLog("ERROR", "archive_failed", { path: file.path, error: e.message }); }
          file.status = "archived";
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
  let totalSizeAfter = activeEntries.reduce((sum, e) => sum + (e.files || []).reduce((s, f) => s + (f.size_bytes || 0), 0), 0);
  if (totalSizeAfter > MAX_TOTAL_SIZE) {
    console.log(`[Janitor] Size cap exceeded: ${(totalSizeAfter / 1048576).toFixed(1)}MB > 50MB. Starting LRU eviction...`);
    srcLog("WARN", "size_cap_exceeded", { totalSizeMB: (totalSizeAfter / 1048576).toFixed(1) });
    // Sort all files by last_accessed (oldest first)
    const allFiles = [];
    for (const entry of activeEntries) {
      for (const file of entry.files || []) {
        allFiles.push({ entry, file, lastAccess: new Date(file.last_accessed || file.created_at).getTime() });
      }
    }
    allFiles.sort((a, b) => a.lastAccess - b.lastAccess);

    while (totalSizeAfter > MAX_TOTAL_SIZE && allFiles.length > 0) {
      const { file } = allFiles.shift();
      console.log(`[Janitor] LRU EVICT: ${file.path}`);
      srcLog("INFO", "lru_evicted", { path: file.path });
      if (!DRY_RUN) {
        const absPath = path.join(DOCS_DIR, file.path);
        try { if (fs.existsSync(absPath)) fs.unlinkSync(absPath); } catch (_) {}
        file.status = "evicted";
      }
      totalSizeAfter -= file.size_bytes || 0;
      lruEvicted++;
    }
  }

  if (!DRY_RUN) {
    writeManifest(manifest);

    // Update knowledge-state.json
    try {
      const ok = atomicWriteSubState("knowledge_state", (ks) => {
        ks.last_janitor_run = now();
        ks.total_docs_count = manifest.entries.length;
        ks.total_size_bytes = totalSizeAfter;
      });
      if (!ok) {
        console.error("[Janitor] CAS write to knowledge_state failed after 3 retries");
      }
    } catch (e) { console.error(`[Janitor] Failed to update knowledge_state: ${e.message}`); }

    // Generate size report
    const indexer = require("./indexer");
    const stats = indexer.getStats();
    atomicWriteJson(SIZE_REPORT_PATH, {
      generated_at: now(),
      total_size_bytes: totalSizeAfter,
      total_size_mb: (totalSizeAfter / 1048576).toFixed(1),
      max_total_mb: 50,
      entries: manifest.entries.length,
      ...stats,
    });
  }

  
}

if (require.main === module) {
  run();
}

module.exports = { run };
