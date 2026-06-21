// safe_bash: allow-write
/**
 * size-reporter.ts — UC7KS Knowledge Size Reporter v2.0.0 (KC-11 DB-canonical)
 *
 * Generates .metadata/size_report.json with per-domain size breakdown.
 * Called by the Janitor after each cycle and can be run standalone.
 *
 * v2.0.0 (KC-11): Routes stats through knowledge-store.ts API instead
 *   of direct indexer.ts calls. knowledge-store operates on v11 DB
 *   tables as canonical source.
 *
 * Usage: bun .opencode/scripts/knowledge/size-reporter.ts
 */

const path = require("path");
const { createRequire } = require("node:module");
const fs = require("fs");

/**
 * KC-11: Load knowledge-store (ESM) via createRequire for CJS interop.
 * Replaces direct indexer.ts dependency — stats now come from
 * knowledge-store which operates on v11 DB tables as canonical source.
 */
const ksRequire = createRequire(
  path.join(__dirname, "..", "..", "lib", "knowledge-store.ts"),
);
const knowledgeStore = ksRequire("./knowledge-store");

/**
 * FW-LOG-UNIFY-P4 (2026-06-12, @Super-Admin): Persist size reports to
 * centralized log-manager for audit trail.
 */
const { writeLog } = require("../../lib/log-manager");

const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const REPORT_PATH = path.join(
  PROJECT_ROOT,
  "docs",
  "official_docs",
  ".metadata",
  "size_report.json",
);

function generate() {
  /**
   * KC-11: Get stats through knowledge-store (v11 DB-canonical)
   * instead of direct indexer.getStats().
   */
  const stats = knowledgeStore.getStats();
  const report = {
    generated_at: new Date().toISOString(),
    total_size_bytes: stats.total_size_bytes,
    total_size_mb: stats.total_size_mb,
    max_total_mb: 50,
    total_files: stats.total_files,
    total_entries: stats.total_entries,
    per_domain: stats.per_domain,
    thresholds: {
      max_file_bytes: 524288, // 500KB
      max_total_bytes: 52428800, // 50MB
      compression_kb: 200,
    },
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
  console.log(
    `[SizeReporter] Report generated: ${report.total_size_mb}MB / 50MB (${report.total_files} files)`,
  );
  writeLog("script-knowledge-size-reporter", "INFO", {
    event: "report_generated",
    total_mb: report.total_size_mb,
    files: report.total_files,
  });
  return report;
}

if (require.main === module) {
  generate();
}

module.exports = { generate };
