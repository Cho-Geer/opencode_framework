/**
 * janitor.js — UC7KS Knowledge Janitor v1.0.0
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
 * Usage: node .opencode/scripts/knowledge/janitor.js [--dry-run] [--force]
 */

const fs = require("fs");
const path = require("path");
const { readManifest, writeManifest, INDEX_PATH } = require("./indexer");

const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
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
        if (!DRY_RUN) {
          const absPath = path.join(DOCS_DIR, file.path);
          try { if (fs.existsSync(absPath)) fs.unlinkSync(absPath); } catch (e) { console.error(`  Failed: ${e.message}`); }
        }
        purged++;
      } else if (age > ttl) {
        // TTL expired: archive
        console.log(`[Janitor] ARCHIVE: ${file.path} (age: ${age.toFixed(0)}d, TTL: ${ttl}d)`);
        if (!DRY_RUN) {
          const dateDir = path.join(ARCHIVE_DIR, new Date().toISOString().slice(0, 10));
          fs.mkdirSync(dateDir, { recursive: true });
          const absPath = path.join(DOCS_DIR, file.path);
          const archivePath = path.join(dateDir, path.basename(file.path));
          try { if (fs.existsSync(absPath)) fs.renameSync(absPath, archivePath); } catch (e) { console.error(`  Failed: ${e.message}`); }
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

    // Update machine.json knowledge_state
    try {
      const machinePath = path.join(PROJECT_ROOT, ".opencode", "state", "machine.json");
      const machine = JSON.parse(fs.readFileSync(machinePath, "utf-8"));
      if (machine.knowledge_state) {
        machine.knowledge_state.last_janitor_run = now();
        machine.knowledge_state.total_docs_count = manifest.entries.length;
        machine.knowledge_state.total_size_bytes = totalSizeAfter;
        fs.writeFileSync(machinePath, JSON.stringify(machine, null, 2), "utf-8");
      }
    } catch (e) { console.error(`[Janitor] Failed to update machine.json: ${e.message}`); }

    // Generate size report
    const indexer = require("./indexer");
    const stats = indexer.getStats();
    fs.writeFileSync(SIZE_REPORT_PATH, JSON.stringify({
      generated_at: now(),
      total_size_bytes: totalSizeAfter,
      total_size_mb: (totalSizeAfter / 1048576).toFixed(1),
      max_total_mb: 50,
      entries: manifest.entries.length,
      ...stats,
    }, null, 2), "utf-8");
  }

  const result = {
    purged, archived, lru_evicted: lruEvicted,
    total_size_before_mb: (totalSizeBefore / 1048576).toFixed(1),
    total_size_after_mb: (totalSizeAfter / 1048576).toFixed(1),
    entries_remaining: manifest.entries.length,
    dry_run: DRY_RUN,
  };
  console.log(`[Janitor] Cycle complete: ${JSON.stringify(result)}`);
  return result;
}

if (require.main === module) {
  run();
}

module.exports = { run };
