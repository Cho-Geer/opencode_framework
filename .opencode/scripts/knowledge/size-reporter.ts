// safe_bash: allow-write
/**
 * size-reporter.js — UC7KS Knowledge Size Reporter v1.0.0
 *
 * Generates .metadata/size_report.json with per-domain size breakdown.
 * Called by the Janitor after each cycle and can be run standalone.
 *
 * Usage: bun .opencode/scripts/knowledge/size-reporter.ts
 */

const fs = require("fs");
const path = require("path");
const { getStats } = require("./indexer");
/**
 * FW-LOG-UNIFY-P4 (2026-06-12, @Super-Admin): Persist size reports to
 * centralized log-manager for audit trail.
 */
const { writeLog } = require("../../lib/log-manager");

const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const REPORT_PATH = path.join(PROJECT_ROOT, "docs", "official_docs", ".metadata", "size_report.json");

function generate() {
  const stats = getStats();
  const report = {
    generated_at: new Date().toISOString(),
    total_size_bytes: stats.total_size_bytes,
    total_size_mb: stats.total_size_mb,
    max_total_mb: 50,
    total_files: stats.total_files,
    total_entries: stats.total_entries,
    per_domain: stats.per_domain,
    thresholds: {
      max_file_bytes: 524288,   // 500KB
      max_total_bytes: 52428800, // 50MB
      compression_kb: 200,
    },
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
  console.log(`[SizeReporter] Report generated: ${(report.total_size_mb)}MB / 50MB (${report.total_files} files)`);
  writeLog("script-knowledge-size-reporter", "INFO", {
    event: "report_generated", total_mb: report.total_size_mb, files: report.total_files,
  });
  return report;
}

if (require.main === module) {
  generate();
}

module.exports = { generate };
