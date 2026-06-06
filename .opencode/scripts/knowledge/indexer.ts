// safe_bash: allow-write
/**
 * indexer.js — UC7KS Knowledge Indexer v1.0.0
 *
 * Maintains docs/official_docs/index.json as a searchable manifest.
 * Provides atomic read/update functions with SHA-256 dedup integration.
 * Enforces UC7-007: atomic index.json updates.
 *
 * Usage: node .opencode/scripts/knowledge/indexer.js [command]
 *   add <path> <source> <sha256> <size_bytes> <library_id> <topic>
 *   search <keyword>
 *   stats
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const INDEX_PATH = path.join(PROJECT_ROOT, "docs", "official_docs", "index.json");

function readManifest() {
  if (!fs.existsSync(INDEX_PATH)) {
    return { manifest_version: "1.2.0", last_updated: null, total_entries: 0, entries: [] };
  }
  return JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
}

function writeManifest(manifest) {
  manifest.last_updated = new Date().toISOString();
  manifest.total_entries = (manifest.entries || []).length;
  const tmp = INDEX_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf-8");
  fs.renameSync(tmp, INDEX_PATH); // Atomic rename (UC7-007)
}

/**
 * Add or update a knowledge entry.
 * Returns: { action: "added"|"updated"|"dedup", entry: object }
 */
function addEntry({ library_id, query_topic, domain, tags, file }) {
  const manifest = readManifest();
  
  // Dedup check: same SHA-256?
  const existingByHash = manifest.entries.find(e =>
    e.files && e.files.some(f => f.sha256 === file.sha256)
  );
  if (existingByHash) {
    // Update access stats, don't create new file
    const ef = existingByHash.files.find(f => f.sha256 === file.sha256);
    if (ef) {
      ef.access_count = (ef.access_count || 0) + 1;
      ef.last_accessed = new Date().toISOString();
    }
    // Add tags as aliases
    if (Array.isArray(tags)) {
      existingByHash.tags = [...new Set([...(existingByHash.tags || []), ...tags])];
    }
    writeManifest(manifest);
    return { action: "dedup", entry: existingByHash };
  }

  // Check if library+query already exists
  let entry = manifest.entries.find(e => e.library_id === library_id && e.query_topic === query_topic);
  if (entry) {
    entry.files.push({ ...file, created_at: file.created_at || new Date().toISOString() });
    if (Array.isArray(tags)) entry.tags = [...new Set([...(entry.tags || []), ...tags])];
    writeManifest(manifest);
    return { action: "updated", entry };
  }

  // New entry
  entry = {
    library_id,
    query_topic,
    domain: domain || "fallback",
    tags: Array.isArray(tags) ? tags : [],
    files: [{ ...file, created_at: file.created_at || new Date().toISOString(), access_count: 0, status: "active" }],
  };
  manifest.entries.push(entry);
  writeManifest(manifest);
  return { action: "added", entry };
}

function searchEntries(keyword) {
  const manifest = readManifest();
  const kw = keyword.toLowerCase();
  return manifest.entries.filter(e =>
    (e.library_id || "").toLowerCase().includes(kw) ||
    (e.query_topic || "").toLowerCase().includes(kw) ||
    (e.tags || []).some(t => t.toLowerCase().includes(kw))
  );
}

function getStats() {
  const manifest = readManifest();
  let totalSize = 0;
  let totalFiles = 0;
  const perDomain = {};
  for (const entry of manifest.entries) {
    for (const file of entry.files || []) {
      totalSize += file.size_bytes || 0;
      totalFiles++;
      const d = entry.domain || "unknown";
      if (!perDomain[d]) perDomain[d] = { size_bytes: 0, file_count: 0 };
      perDomain[d].size_bytes += file.size_bytes || 0;
      perDomain[d].file_count++;
    }
  }
  return {
    manifest_version: manifest.manifest_version,
    total_entries: manifest.total_entries,
    total_files: totalFiles,
    total_size_bytes: totalSize,
    total_size_mb: (totalSize / 1048576).toFixed(1),
    per_domain: perDomain,
  };
}

// CLI
if (require.main === module) {
  const [,, cmd, ...args] = process.argv;
  switch (cmd) {
    case "add": {
      const [filePath, source, sha256, sizeBytes, libId, topic] = args;
      const result = addEntry({
        library_id: libId || "web-fallback",
        query_topic: topic || "unnamed",
        file: {
          path: filePath,
          source: source || "webfetch",
          sha256: sha256 || `sha256:${crypto.randomBytes(32).toString("hex")}`,
          size_bytes: parseInt(sizeBytes) || 0,
          ttl_days: 30,
        },
      });
      console.log(JSON.stringify(result));
      break;
    }
    case "search": {
      const results = searchEntries(args[0] || "");
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    case "stats": {
      console.log(JSON.stringify(getStats(), null, 2));
      break;
    }
    default:
      console.log("UC7KS Indexer v1.0.0\nCommands: add, search, stats");
  }
}

module.exports = { readManifest, writeManifest, addEntry, searchEntries, getStats, INDEX_PATH };
