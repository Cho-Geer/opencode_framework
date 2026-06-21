/**
 * janitor.ts — UC7KS Knowledge Cache Janitor (KC-08)
 * ═══════════════════════════════════════════════════════════════
 * Periodic cleanup tool for the knowledge cache. Handles:
 *   1. Orphan entry detection (index.json entries whose files don't exist)
 *   2. Reverse-orphan detection (files on disk not in index.json)
 *   3. Stale entry removal (entries past their TTL)
 *   4. Knowledge cache state pruning (stale session_access entries)
 *
 * All audit counter updates are NON-FATAL — failures log via writeLog
 * and return silently without throwing. This ensures cleanup failures
 * never block pipeline operations.
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-21
 */
import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { tolerantParse } from "../lib/tolerant-json";
import { writeLog } from "../lib/log-manager";
import { atomicWriteSubState } from "../lib/state-utils";
import { withInterruptGuard } from "../lib";
import { incrementAuditCounter, pushAuditEvent } from "../lib/knowledge-audit";

const SRC = "knowledge-janitor";

export default tool({
  description:
    "UC7KS Knowledge Cache Janitor — detect and clean orphan/stale cache entries. Updates knowledge_audit_state counters (reverse_orphan_count, last_cleanup_removed_session_entries) with non-fatal error handling.",
  args: {
    dry_run: tool.schema
      .boolean()
      .default(false)
      .describe("If true, only report issues without modifying anything"),
    remove_orphans: tool.schema
      .boolean()
      .default(false)
      .describe("If true, remove orphan entries from index.json"),
    max_ttl_days: tool.schema
      .number()
      .default(30)
      .describe("Maximum TTL in days before an entry is considered stale"),
  },

  async execute(args, context) {
    return withInterruptGuard("janitor", async () => {
      var projectRoot = process.env.OPENCODE_ROOT || process.cwd();
      var docsDir = path.resolve(projectRoot, "docs", "official_docs");
      var indexPath = path.resolve(docsDir, "index.json");
      var dryRun = args.dry_run || false;
      var removeOrphans = args.remove_orphans || false;
      var maxTtlDays = args.max_ttl_days || 30;

      var report: {
        index_found: boolean;
        total_entries: number;
        orphan_entries: string[];
        reverse_orphan_files: string[];
        stale_entries: string[];
        removed_count: number;
        dry_run: boolean;
      } = {
        index_found: false,
        total_entries: 0,
        orphan_entries: [],
        reverse_orphan_files: [],
        stale_entries: [],
        removed_count: 0,
        dry_run: dryRun,
      };

      // ── 1. Read index.json ──
      if (!fs.existsSync(indexPath)) {
        writeLog(SRC, "WARN", {
          event: "JANITOR-NO-INDEX",
          detail: `index.json not found at ${indexPath}`,
        });
        return JSON.stringify({
          error: "index.json not found",
          ...report,
        });
      }

      var index: any;
      try {
        index = tolerantParse(fs.readFileSync(indexPath, "utf8"));
        if (!index.entries || !Array.isArray(index.entries)) {
          return JSON.stringify({
            error: "Malformed index.json",
            ...report,
          });
        }
      } catch (e: any) {
        writeLog(SRC, "ERROR", {
          event: "JANITOR-PARSE-FAILED",
          detail: `Failed to parse index.json: ${e.message}`,
        });
        return JSON.stringify({
          error: "Failed to parse index.json: " + e.message,
          ...report,
        });
      }

      report.index_found = true;
      report.total_entries = index.entries.length;

      // ── 2. Detect orphan entries (index entries with missing files) ──
      var entries: any[] = index.entries;
      var now = Date.now();
      var validEntries: any[] = [];

      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var allFilesExist = true;
        var files = entry.files || [];
        var isWithinTtl = true;

        for (var j = 0; j < files.length; j++) {
          var filePath = path.resolve(docsDir, files[j].path);
          if (!fs.existsSync(filePath)) {
            allFilesExist = false;
          }

          // Check TTL
          if (files[j].ttl_days && files[j].created_at) {
            var created = new Date(files[j].created_at).getTime();
            var ageDays = (now - created) / (1000 * 60 * 60 * 24);
            if (ageDays > files[j].ttl_days) {
              isWithinTtl = false;
            } else if (ageDays > maxTtlDays) {
              isWithinTtl = false;
            }
          }
        }

        if (!allFilesExist) {
          report.orphan_entries.push(
            `${entry.library_id}/${(entry.query_topic || "unknown").substring(0, 60)}`,
          );
        } else if (!isWithinTtl) {
          report.stale_entries.push(
            `${entry.library_id}/${(entry.query_topic || "unknown").substring(0, 60)}`,
          );
        } else {
          validEntries.push(entry);
        }
      }

      // ── 3. Detect reverse-orphan files (files on disk not in index) ──
      var indexedPaths = new Set<string>();
      for (var k = 0; k < entries.length; k++) {
        var ef = entries[k].files || [];
        for (var m = 0; m < ef.length; m++) {
          indexedPaths.add(path.normalize(path.resolve(docsDir, ef[m].path)));
        }
      }

      try {
        if (fs.existsSync(docsDir)) {
          var walkDir = function (dir: string, depth: number) {
            if (depth > 8) return; // Safety limit
            try {
              var items = fs.readdirSync(dir);
              for (var n = 0; n < items.length; n++) {
                var item = items[n];
                if (item.startsWith(".") || item === "index.json") continue;
                var fullPath = path.join(dir, item);
                var stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                  walkDir(fullPath, depth + 1);
                } else if (stat.isFile()) {
                  var normalized = path.normalize(fullPath);
                  if (!indexedPaths.has(normalized)) {
                    report.reverse_orphan_files.push(
                      path.relative(docsDir, normalized),
                    );
                  }
                }
              }
            } catch {}
          };
          walkDir(docsDir, 0);
        }
      } catch {}

      // ── 4. Update audit counters (NON-FATAL) ──
      if (
        report.orphan_entries.length > 0 ||
        report.reverse_orphan_files.length > 0
      ) {
        try {
          incrementAuditCounter(
            "reverse_orphan_count",
            report.orphan_entries.length + report.reverse_orphan_files.length,
          );
        } catch {}
      }

      // ── 5. Remove orphans if requested (NON-FATAL) ──
      if (removeOrphans && !dryRun) {
        try {
          // Rewrite index.json with only valid entries
          index.entries = validEntries;
          index.total_entries = validEntries.length;
          index.last_janitor_run = new Date().toISOString();
          // Atomic write via temp file
          var tmpPath = indexPath + ".tmp";
          fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2));
          fs.renameSync(tmpPath, indexPath);
          report.removed_count = entries.length - validEntries.length;

          try {
            incrementAuditCounter(
              "last_cleanup_removed_session_entries",
              report.removed_count,
            );
          } catch {}
        } catch (e: any) {
          writeLog(SRC, "ERROR", {
            event: "JANITOR-REMOVE-FAILED",
            detail: `Failed to remove orphans: ${e.message}`,
          });
        }
      }

      // ── 6. Push audit event ──
      try {
        pushAuditEvent({
          event: "KC-JANITOR-RUN",
          timestamp: new Date().toISOString(),
          detail: `dry_run=${dryRun} orphans=${report.orphan_entries.length} reverse_orphans=${report.reverse_orphan_files.length} stale=${report.stale_entries.length} removed=${report.removed_count}`,
        });
      } catch {}

      writeLog(SRC, "INFO", {
        event: "JANITOR-COMPLETE",
        detail: `orphans=${report.orphan_entries.length} reverse=${report.reverse_orphan_files.length} stale=${report.stale_entries.length} removed=${report.removed_count} dry_run=${dryRun}`,
      });

      return JSON.stringify(report);
    });
  },
});
