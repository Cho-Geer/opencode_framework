/**
 * compressor.ts — UC7KS Knowledge Compressor v1.0.0
 *
 * Converts large .html files to .md when they exceed compression_threshold_kb (default 200KB).
 * Uses pandoc for conversion when available; falls back to basic HTML-to-text stripping.
 * Original .html archived to .metadata/archives/ for 7 days.
 *
 * Usage: bun .opencode/scripts/knowledge/compressor.ts [filePath] [--all]
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * FW-LOG-UNIFY-C9b: Lazy-load writeLog for compressor audit trail.
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
  try { getWriteLog()("script-knowledge-compressor", level, { event, ...fields }); } catch {}
}

const DOCS_DIR = path.join(PROJECT_ROOT, "docs", "official_docs");
const COMPRESSION_THRESHOLD_KB = 200; // From template_resolution.knowledge.compression_threshold_kb

function compressFile(relPath) {
  const absPath = path.join(DOCS_DIR, relPath);
  if (!fs.existsSync(absPath)) return { error: `File not found: ${relPath}` };
  
  const stat = fs.statSync(absPath);
  const sizeKB = stat.size / 1024;
  if (sizeKB < COMPRESSION_THRESHOLD_KB) return { skipped: true, reason: `Below threshold (${sizeKB.toFixed(0)}KB < ${COMPRESSION_THRESHOLD_KB}KB)` };
  if (!relPath.endsWith(".html")) return { skipped: true, reason: "Not HTML" };

  const mdPath = absPath.replace(/\.html$/, ".md");
  
  try {
    // Try pandoc first
    execSync(`pandoc "${absPath}" -f html -t markdown -o "${mdPath}" --strip-comments`, { timeout: 30000, stdio: "pipe" });
    console.log(`[Compressor] pandoc: ${relPath} → ${path.basename(mdPath)}`);
    srcLog("INFO", "file_compressed", { path: relPath, method: "pandoc", output: path.basename(mdPath) });
  } catch {
    // Fallback: basic HTML strip
    let html = fs.readFileSync(absPath, "utf-8");
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
               .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
               .replace(/<[^>]+>/g, " ")
               .replace(/&amp;/g, "&")
               .replace(/&lt;/g, "<")
               .replace(/&gt;/g, ">")
               .replace(/&quot;/g, '"')
               .replace(/\s{2,}/g, "\n\n")
               .trim();
    fs.writeFileSync(mdPath, html, "utf-8");
    console.log(`[Compressor] fallback: ${relPath} → ${path.basename(mdPath)}`);
    srcLog("INFO", "file_compressed", { path: relPath, method: "fallback", output: path.basename(mdPath) });
  }

  // Archive original
  const archiveDir = path.join(DOCS_DIR, ".metadata", "archives", new Date().toISOString().slice(0, 7));
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.renameSync(absPath, path.join(archiveDir, path.basename(absPath)));

  // Update manifest
  const manifest = readManifest();
  for (const entry of manifest.entries) {
    for (const file of entry.files || []) {
      if (file.path === relPath) {
        file.path = relPath.replace(/\.html$/, ".md");
        file.compressed_from = relPath;
        file.size_bytes = fs.statSync(path.join(DOCS_DIR, file.path)).size;
      }
    }
  }
  writeManifest(manifest);

  return { compressed: true, original_kb: sizeKB.toFixed(0), new_path: relPath.replace(/\.html$/, ".md") };
}

function compressAll() {
  const manifest = readManifest();
  const results = [];
  for (const entry of manifest.entries) {
    for (const file of entry.files || []) {
      if (file.path && file.path.endsWith(".html") && file.status === "active") {
        results.push(compressFile(file.path));
      }
    }
  }
  return results;
}



module.exports = { compressFile, compressAll };
