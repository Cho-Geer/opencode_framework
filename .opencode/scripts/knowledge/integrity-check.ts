#!/usr/bin/env bun
export {};
// safe_bash: allow-write
/**
 * integrity-check.ts — Reverse Orphan Detection & Manifest Integrity v1.1.0
 *
 * Standalone helper extracted from framework-self-test.ts Check 22c (KC-09).
 * Detects files in docs/official_docs/ not represented in index.json (orphans)
 * and inconsistencies between the manifest and filesystem.
 *
 * KC-15 (v1.1.0): Added --auto-index flag for operator-assisted auto-indexing
 * of orphaned docs. When passed, each orphan is read, its sha256/size computed,
 * and an entry is added to index.json via knowledge-store.ts addEntry() with
 * heuristically-derived library_id, domain, and tags.
 *
 * Usage: bun .opencode/scripts/knowledge/integrity-check.ts [options]
 *   (no args)     Basic orphan check, output to stdout
 *   --full        Full integrity report
 *   --json        JSON output (combine with --full, --auto-index)
 *   --docs <path> Custom docs directory
 *   --auto-index  (KC-15) Auto-index orphaned files into index.json.
 *                 Computes sha256/size, guesses library/domain/tags from path,
 *                 adds entries via knowledge-store.ts. Operator-assisted.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const DOCS_DIR = path.join(PROJECT_ROOT, "docs", "official_docs");
const INDEX_PATH = path.join(DOCS_DIR, "index.json");
const KNOWN_NON_DOC_FILES = new Set([".gitkeep", "index.schema.json"]);
const IGNORE_PREFIXES = [".metadata", ".opencode_backups"];

/**
 * KC-15: Lazy-load knowledge-store (ESM) via createRequire for CJS interop.
 * Used by autoIndexOrphans() to add orphaned files to the manifest.
 */
const ksRequire = createRequire(
  path.join(__dirname, "..", "..", "lib", "knowledge-store.ts"),
);
function getKnowledgeStore() {
  return ksRequire("./knowledge-store");
}

// Lazy writeLog import (avoids requiring at module level)
function getWriteLog() {
  try {
    return require("../../lib/log-manager").writeLog;
  } catch {
    return (src, level, fields) => {
      if (level === "ERROR" || level === "WARN")
        console.error(`[${src}] ${level}:`, fields);
    };
  }
}

/**
 * Walk a directory recursively, collecting file paths relative to docsDir.
 */
function walkDir(dir, docsDir, excludePrefixes = []) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(docsDir, full);
    if (entry.isDirectory()) {
      if (!excludePrefixes.some((p) => rel.startsWith(p))) {
        files.push(...walkDir(full, docsDir, excludePrefixes));
      }
    } else if (
      entry.isFile() &&
      !KNOWN_NON_DOC_FILES.has(entry.name) &&
      !rel.endsWith(".safe_backup") &&
      !rel.includes(".opencode_backups")
    ) {
      files.push(rel);
    }
  }
  return files;
}

/**
 * Check for orphaned files (on disk but not in manifest).
 * @param {string} docsRoot - Optional custom docs directory
 * @returns {{ orphanedFiles: Array<{path:string, reason:string}>, totalOrphans: number, totalFilesChecked: number }}
 */
function checkForOrphans(docsRoot) {
  const docsDir = docsRoot || DOCS_DIR;
  const indexPath = path.join(docsDir, "index.json");

  // Read manifest
  let manifest;
  try {
    if (fs.existsSync(indexPath)) {
      manifest = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    } else {
      manifest = { entries: [] };
    }
  } catch {
    manifest = { entries: [] };
  }

  // Collect all file paths from manifest
  const manifestFiles = new Set();
  for (const entry of manifest.entries || []) {
    for (const file of entry.files || []) {
      if (file.path) manifestFiles.add(file.path);
    }
  }

  // Walk disk and find orphans
  const orphanedFiles = [];
  const diskFiles = walkDir(docsDir, docsDir, [
    ".metadata",
    ".opencode_backups",
  ]);

  for (const relPath of diskFiles) {
    if (
      relPath === "index.json" ||
      relPath.startsWith(".metadata") ||
      KNOWN_NON_DOC_FILES.has(path.basename(relPath))
    ) {
      continue;
    }
    const inManifest = Array.from(manifestFiles).some((mf) =>
      relPath.includes(mf),
    );
    if (!inManifest) {
      orphanedFiles.push({ path: relPath, reason: "Not found in index.json" });
    }
  }

  const writeLog = getWriteLog();
  writeLog("integrity-check", orphanedFiles.length > 0 ? "WARN" : "INFO", {
    event: "KC-REVERSE-ORPHAN-CHECK",
    detail: `Found ${orphanedFiles.length} orphan(s) out of ${diskFiles.length} files checked`,
    totalOrphans: orphanedFiles.length,
    totalFilesChecked: diskFiles.length,
  });

  return {
    orphanedFiles,
    totalOrphans: orphanedFiles.length,
    totalFilesChecked: diskFiles.length,
  };
}

/**
 * Generate a full integrity report comparing manifest vs filesystem.
 * @param {string} docsRoot - Optional custom docs directory
 * @returns {{ totalEntries: number, totalFilesInManifest: number, totalFilesOnDisk: number, orphanedFiles: *, manifestVsDisk: { onlyInManifest: string[], onlyOnDisk: string[] }, status: string }}
 */
function generateIntegrityReport(docsRoot) {
  const docsDir = docsRoot || DOCS_DIR;
  const indexPath = path.join(docsDir, "index.json");

  let manifest;
  try {
    if (fs.existsSync(indexPath)) {
      manifest = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    } else {
      manifest = { entries: [] };
    }
  } catch {
    manifest = { entries: [] };
  }

  // Collect manifest paths
  const manifestPaths = new Set();
  for (const entry of manifest.entries || []) {
    for (const file of entry.files || []) {
      if (file.path) manifestPaths.add(file.path);
    }
  }

  // Collect disk paths
  const diskPaths = new Set(
    walkDir(docsDir, docsDir, [
      ".metadata",
      ".opencode_backups",
    ]).filter(
      (p) => p !== "index.json" && !KNOWN_NON_DOC_FILES.has(path.basename(p)),
    ),
  );

  // Find differences
  const onlyInManifest = Array.from(manifestPaths).filter(
    (p) => !diskPaths.has(p),
  );
  const onlyOnDisk = Array.from(diskPaths).filter((p) => !manifestPaths.has(p));

  const orphanResult = checkForOrphans(docsRoot);
  let status = "ok";
  if (orphanResult.totalOrphans > 0 || onlyInManifest.length > 0)
    status = "warnings";
  if (onlyInManifest.length > 5) status = "errors";

  return {
    totalEntries: manifest.entries?.length || 0,
    totalFilesInManifest: manifestPaths.size,
    totalFilesOnDisk: diskPaths.size,
    orphanedFiles: orphanResult,
    manifestVsDisk: { onlyInManifest, onlyOnDisk },
    status,
  };
}

/**
 * Log orphan check result through writeLog.
 */
function logOrphanReport(result) {
  const writeLog = getWriteLog();
  writeLog("integrity-check", result.totalOrphans > 0 ? "WARN" : "INFO", {
    event: "KC-REVERSE-ORPHAN-CHECK",
    detail: `Found ${result.totalOrphans} orphan(s) out of ${result.totalFilesChecked} files checked`,
    totalOrphans: result.totalOrphans,
    totalFilesChecked: result.totalFilesChecked,
    samples: result.orphanedFiles.slice(0, 5).map((f) => f.path),
  });
}

// ── KC-15: Auto-Index Heuristics ──────────────────────────────

/**
 * Path segment → library_id mapping table.
 * First segment of the file path determines the library.
 */
const PATH_TO_LIBRARY = {
  opencode: "opencode-framework",
  framework: "opencode-framework",
  backend: "nestjs",
  nestjs: "nestjs",
  prisma: "prisma",
  frontend: "angular",
  angular: "angular",
  devops: "devops_ci",
  testing: "jest",
  bun: "bun",
  "multi-agent-patterns": "multi-agent-patterns",
  "anthropic-agents": "anthropic-agents",
  "multi-agent-frameworks": "multi-agent-frameworks",
  "google-a2a": "google-a2a",
};

/**
 * Path segment → domain mapping table.
 */
const PATH_TO_DOMAIN = {
  opencode: "opencode",
  framework: "opencode_framework",
  backend: "backend_api",
  nestjs: "backend_api",
  prisma: "persistence",
  frontend: "frontend_ui",
  angular: "frontend_ui",
  devops: "devops_ci",
  testing: "testing",
  bun: "infrastructure",
  "multi-agent-patterns": "opencode_framework",
  "anthropic-agents": "opencode_framework",
  "multi-agent-frameworks": "opencode_framework",
  "google-a2a": "opencode_framework",
};

/**
 * Guess the library_id from the file path segments.
 * Uses the first meaningful directory segment after docs/official_docs/.
 * @param {string[]} pathParts - File path split by "/"
 * @returns {string} Inferred library_id
 */
function guessLibraryId(pathParts) {
  if (pathParts.length === 0) return "fallback";
  const root = pathParts[0].toLowerCase();
  if (PATH_TO_LIBRARY[root]) return PATH_TO_LIBRARY[root];
  // Try second segment (e.g., "framework/mistake_precautions/...")
  if (pathParts.length >= 2) {
    const second = pathParts[1].toLowerCase();
    if (PATH_TO_LIBRARY[second]) return PATH_TO_LIBRARY[second];
  }
  return root.includes("opencode")
    ? "opencode-framework"
    : root.includes("backend") || root.includes("nestjs")
      ? "nestjs"
      : root.includes("frontend") || root.includes("angular")
        ? "angular"
        : "fallback";
}

/**
 * Guess the domain from the file path segments.
 * @param {string[]} pathParts - File path split by "/"
 * @returns {string} Inferred domain
 */
function guessDomain(pathParts) {
  if (pathParts.length === 0) return "fallback";
  const root = pathParts[0].toLowerCase();
  if (PATH_TO_DOMAIN[root]) return PATH_TO_DOMAIN[root];
  if (pathParts.length >= 2) {
    const second = pathParts[1].toLowerCase();
    if (PATH_TO_DOMAIN[second]) return PATH_TO_DOMAIN[second];
  }
  return "fallback";
}

/**
 * Guess a topic from the file's basename.
 * Converts kebab-case to human-readable title.
 * @param {string} basename - File's basename (e.g., "plugins.md")
 * @returns {string} Human-readable topic
 */
function guessTopic(basename) {
  const stem = basename.replace(/\.[^.]+$/, ""); // strip extension
  return stem
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Extract tags from path segments and filename.
 * Combines parent directory name + filename stem for searchability.
 * @param {string[]} pathParts - File path split by "/"
 * @returns {string[]} Inferred tags
 */
function guessTags(pathParts) {
  const tags = new Set();
  const raw = path.basename(pathParts.join("/"));
  const stem = raw.replace(/\.[^.]+$/, "");
  // Add all path segments as tags
  for (const part of pathParts.slice(0, -1)) {
    if (part && part !== "." && part !== "docs" && part !== "official_docs") {
      tags.add(part.toLowerCase());
    }
  }
  // Add stem words
  stem.split(/[-_]/).forEach((w) => {
    const lw = w.toLowerCase();
    if (lw && lw !== "index") tags.add(lw);
  });
  return Array.from(tags).slice(0, 20);
}

/**
 * KC-15: Auto-index orphaned files into the knowledge manifest.
 *
 * When --auto-index is passed, each orphaned file is:
 * 1. Read from disk
 * 2. SHA-256 hash + size computed
 * 3. Library, domain, tags guessed from its path
 * 4. Added to index.json via knowledge-store.ts addEntry() API
 *
 * Only runs when orphans are detected; no-op otherwise.
 * Operator-assisted: requires explicit --auto-index flag.
 *
 * @param {string} docsRoot - Optional custom docs directory
 * @returns {{ indexed: number, errors: Array<{path:string, error:string}>, entries: Array<{path:string, action:string, library_id:string}> }}
 */
function autoIndexOrphans(docsRoot) {
  const docsDir = docsRoot || DOCS_DIR;
  const orphanResult = checkForOrphans(docsDir);

  if (orphanResult.totalOrphans === 0) {
    console.log("[auto-index] ✓ No orphans to index");
    return { indexed: 0, errors: [], entries: [] };
  }

  const knowledgeStore = getKnowledgeStore();
  const writeLog = getWriteLog();
  let indexed = 0;
  const errors = [];
  const entries = [];

  for (const orphan of orphanResult.orphanedFiles) {
    const absPath = path.join(docsDir, orphan.path);
    try {
      // Read file and compute metadata
      const content = fs.readFileSync(absPath, "utf-8");
      const hash = require("node:crypto").createHash("sha256").update(content).digest("hex");
      const sha256 = `sha256:${hash}`;
      const size_bytes = Buffer.byteLength(content, "utf-8");

      // Derive entry metadata from path
      const pathParts = orphan.path
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean);
      const library_id = guessLibraryId(pathParts);
      const domain = guessDomain(pathParts);
      const topic = guessTopic(path.basename(orphan.path));
      const tags = guessTags(pathParts);

      // Add to manifest via knowledge-store API
      const result = knowledgeStore.addEntry({
        library_id,
        query_topic: `${library_id} ${topic.toLowerCase()} documentation`,
        domain,
        tags: [...new Set([...tags, library_id, domain])],
        file: {
          path: orphan.path,
          source: "curated",
          sha256,
          size_bytes,
          created_at: new Date().toISOString(),
          ttl_days: 90,
          access_count: 0,
          last_accessed: null,
          status: "active",
        },
      });

      indexed++;
      entries.push({ path: orphan.path, action: result.action, library_id });

      writeLog("integrity-check", "INFO", {
        event: "KC-AUTO-INDEX",
        detail: `Auto-indexed orphan: ${orphan.path} -> ${library_id} (${result.action})`,
        path: orphan.path,
        library_id,
        action: result.action,
        sha256,
      });

      console.log(
        `[auto-index] + ${orphan.path} → ${library_id} (${result.action})`,
      );
    } catch (e) {
      const errMsg = e.message || String(e);
      errors.push({ path: orphan.path, error: errMsg });
      writeLog("integrity-check", "ERROR", {
        event: "KC-AUTO-INDEX-FAILED",
        detail: `Failed to auto-index: ${orphan.path} — ${errMsg}`,
        path: orphan.path,
        error: errMsg,
      });
      console.error(`[auto-index] ✗ ${orphan.path} — ${errMsg}`);
    }
  }

  writeLog("integrity-check", indexed > 0 ? "INFO" : "WARN", {
    event: "KC-AUTO-INDEX-COMPLETE",
    detail: `Auto-indexed ${indexed}/${orphanResult.totalOrphans} orphans (${errors.length} errors)`,
    totalOrphans: orphanResult.totalOrphans,
    indexed,
    errors: errors.length,
  });

  console.log(
    `[auto-index] Done: ${indexed} indexed, ${errors.length} errors (${orphanResult.totalOrphans} total orphans)`,
  );
  return { indexed, errors, entries };
}

// CLI dispatch
if (require.main === module) {
  const args = process.argv.slice(2);
  const isFull = args.includes("--full");
  const isJson = args.includes("--json");
  const isAutoIndex = args.includes("--auto-index");
  const docsIdx = args.indexOf("--docs");
  const customDocs =
    docsIdx >= 0 && docsIdx + 1 < args.length ? args[docsIdx + 1] : undefined;

  // KC-15: --auto-index mode: index orphans and exit
  if (isAutoIndex) {
    const result = autoIndexOrphans(customDocs);
    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    }
    process.exit(0);
  }

  if (isFull) {
    const report = generateIntegrityReport(customDocs);
    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`=== Manifest Integrity Report ===`);
      console.log(`Status: ${report.status}`);
      console.log(`Entries: ${report.totalEntries}`);
      console.log(`Files in manifest: ${report.totalFilesInManifest}`);
      console.log(`Files on disk: ${report.totalFilesOnDisk}`);
      console.log(`Orphans: ${report.orphanedFiles.totalOrphans}`);
      if (report.orphanedFiles.totalOrphans > 0) {
        console.log(`Orphan files:`);
        report.orphanedFiles.orphanedFiles
          .slice(0, 10)
          .forEach((f) => console.log(`  - ${f.path} (${f.reason})`));
      }
      if (report.manifestVsDisk.onlyInManifest.length > 0) {
        console.log(`In manifest but missing on disk:`);
        report.manifestVsDisk.onlyInManifest
          .slice(0, 5)
          .forEach((p) => console.log(`  - ${p}`));
      }
    }
  } else {
    const result = checkForOrphans(customDocs);
    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.totalOrphans === 0) {
        console.log(
          `✓ No orphans found (${result.totalFilesChecked} files checked)`,
        );
      } else {
        console.log(
          `⚠ Found ${result.totalOrphans} orphan(s) (${result.totalFilesChecked} files checked):`,
        );
        result.orphanedFiles
          .slice(0, 10)
          .forEach((f) => console.log(`  - ${f.path} (${f.reason})`));
        if (result.totalOrphans > 10) {
          console.log(`  ... and ${result.totalOrphans - 10} more`);
        }
      }
    }
  }
}

module.exports = {
  checkForOrphans,
  generateIntegrityReport,
  logOrphanReport,
  autoIndexOrphans,
};
