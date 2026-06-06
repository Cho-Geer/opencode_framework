/**
 * archiver.js — UC7KS Knowledge Archiver v1.0.0
 *
 * Manages the .metadata/archives/ directory rotation.
 * Archives older than 7 days are permanently deleted.
 * Archives are organized by date: .metadata/archives/YYYY-MM-DD/
 *
 * Usage: node .opencode/scripts/knowledge/archiver.js [--prune] [--dry-run]
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const ARCHIVE_DIR = path.join(PROJECT_ROOT, "docs", "official_docs", ".metadata", "archives");
const ARCHIVE_RETENTION_DAYS = 7;
const DRY_RUN = process.argv.includes("--dry-run");

function run() {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    console.log("[Archiver] No archives directory found");
    return { pruned: 0, remaining: 0 };
  }

  const cutoff = Date.now() - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let pruned = 0;
  let remainingDirs = 0;

  const entries = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Archive dirs are named YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;

    const dirPath = path.join(ARCHIVE_DIR, entry.name);
    const stat = fs.statSync(dirPath);

    if (stat.mtimeMs < cutoff) {
      console.log(`[Archiver] Pruning: ${entry.name}`);
      if (!DRY_RUN) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
      pruned++;
    } else {
      remainingDirs++;
    }
  }

  console.log(`[Archiver] Complete: ${pruned} pruned, ${remainingDirs} remaining`);
  return { pruned, remaining: remainingDirs };
}

if (require.main === module) {
  run();
}

module.exports = { run };
