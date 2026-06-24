/**
 * nightly-compaction.ts — UC7KS Nightly Compaction Tool (KC-08)
 * ═══════════════════════════════════════════════════════════════
 * Scheduled maintenance tool for the knowledge cache. Called by
 * @CI-CD-Agent nightly cron or manually for ad-hoc maintenance.
 *
 * Performs:
 *   1. Janitor run (orphan/stale detection via janitor tool logic)
 *   2. Knowledge cache state session_access pruning
 *   3. Knowledge audit state aggregate counter updates
 *   4. Index.json size check and compaction reporting
 *
 * All audit counter updates are NON-FATAL. The tool uses the
 * shared pruneSessionAccess() from uc7ks-schema.ts for consistent
 * pruning behavior across the pipeline.
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
import { readSubState, writeSubState } from "../lib/substate-manager";
import { atomicWriteSubState } from "../lib/state-utils";
import { withInterruptGuard } from "../lib";
import {
  pruneSessionAccess,
  normalizeAgentKey,
  type PruneOptions,
} from "../lib/uc7ks-schema";
import {
  incrementAuditCounter,
  pushAuditEvent,
  touchKnowledgeAcquisition,
} from "../lib/knowledge-audit";

const SRC = "nightly-compaction";

export default tool({
  description:
    "UC7KS Nightly Compaction — scheduled maintenance for knowledge cache. Runs janitor cleanup, prunes stale session_access entries, and updates knowledge_audit_state aggregate counters with non-fatal error handling.",
  args: {
    compact_index: tool.schema
      .boolean()
      .default(true)
      .describe(
        "If true, compact index.json by removing stale/duplicate entries",
      ),
    prune_sessions: tool.schema
      .boolean()
      .default(true)
      .describe(
        "If true, prune stale session_access entries from knowledge_cache_state",
      ),
    max_session_age_days: tool.schema
      .number()
      .default(30)
      .describe("Maximum age of session_access entries before pruning"),
  },

  async execute(args, context) {
    return withInterruptGuard("nightly-compaction", async () => {
      var projectRoot = process.env.OPENCODE_ROOT || process.cwd();
      var indexPath = path.resolve(
        projectRoot,
        "docs",
        "official_docs",
        "index.json",
      );
      var configPath = path.resolve(
        projectRoot,
        ".opencode",
        "project.config.json",
      );
      var compactIndex = args.compact_index !== false;
      var pruneSessions = args.prune_sessions !== false;
      var maxSessionAgeDays = args.max_session_age_days || 30;

      var report: {
        compaction_run_at: string;
        index_size_bytes: number;
        index_entries_before: number;
        index_entries_after: number;
        index_compacted: boolean;
        sessions_pruned: boolean;
        prune_stats: {
          removed_agent_entries: number;
          removed_task_entries: number;
          removed_domain_entries: number;
          removed_stale_agents: number;
        };
      } = {
        compaction_run_at: new Date().toISOString(),
        index_size_bytes: 0,
        index_entries_before: 0,
        index_entries_after: 0,
        index_compacted: false,
        sessions_pruned: false,
        prune_stats: {
          removed_agent_entries: 0,
          removed_task_entries: 0,
          removed_domain_entries: 0,
          removed_stale_agents: 0,
        },
      };

      // ── 1. Index compaction ──
      if (compactIndex && fs.existsSync(indexPath)) {
        try {
          var index = tolerantParse(fs.readFileSync(indexPath, "utf8"));
          report.index_size_bytes = fs.statSync(indexPath).size;
          report.index_entries_before = (index.entries || []).length;

          var entries = index.entries || [];
          var now = Date.now();
          var validEntries: any[] = [];
          var removedBecauseStale = 0;

          for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var files = entry.files || [];
            var allFilesExist = true;
            var isStale = false;

            for (var j = 0; j < files.length; j++) {
              var fp = path.resolve(
                projectRoot,
                "docs",
                "official_docs",
                files[j].path,
              );
              if (!fs.existsSync(fp)) {
                allFilesExist = false;
              }
              if (files[j].ttl_days && files[j].created_at) {
                var created = new Date(files[j].created_at).getTime();
                var ageDays = (now - created) / (1000 * 60 * 60 * 24);
                if (
                  ageDays > Math.min(files[j].ttl_days, maxSessionAgeDays * 2)
                ) {
                  isStale = true;
                }
              }
            }

            if (allFilesExist && !isStale) {
              validEntries.push(entry);
            } else {
              removedBecauseStale++;
            }
          }

          if (validEntries.length < entries.length) {
            index.entries = validEntries;
            index.total_entries = validEntries.length;
            index.last_compaction = new Date().toISOString();
            var tmpPath = indexPath + ".tmp";
            fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2));
            fs.renameSync(tmpPath, indexPath);
            report.index_compacted = true;
            report.index_entries_after = validEntries.length;

            // KC-08: Non-fatal audit counter for cleanup
            try {
              incrementAuditCounter(
                "last_cleanup_removed_session_entries",
                removedBecauseStale,
              );
            } catch {}
          } else {
            report.index_entries_after = entries.length;
          }
        } catch (e: any) {
          writeLog(SRC, "ERROR", {
            event: "COMPACTION-INDEX-FAILED",
            detail: `Index compaction failed: ${e.message}`,
          });
        }
      }

      // ── 2. Session access pruning ──
      if (pruneSessions) {
        try {
          var config: any = {};
          try {
            if (fs.existsSync(configPath)) {
              config = tolerantParse(fs.readFileSync(configPath, "utf8"));
            }
          } catch {}

          // Phase 2 (v19): JSON blob is frozen read-only snapshot.
          // Pruning is now a best-effort cleanup of the frozen blob.
          // Future: migrate pruning logic to uc7ks_pipeline_state DB table.
          var kcs: any = {};
          try {
            kcs = readSubState("knowledge_cache_state");
          } catch {
            /* non-fatal — frozen blob may not exist */
          }
          var sa = kcs?.session_access || {};

          var pruneOpts: PruneOptions = {
            session_access_ttl_days:
              config?.template_resolution?.[
                "knowledge.session_access_ttl_days"
              ] || maxSessionAgeDays,
            session_access_max_tasks_per_agent:
              config?.template_resolution?.[
                "knowledge.session_access_max_tasks_per_agent"
              ] || 50,
            session_access_max_domains_per_task:
              config?.template_resolution?.[
                "knowledge.session_access_max_domains_per_task"
              ] || 8,
            session_access_preserve_attested_days:
              config?.template_resolution?.[
                "knowledge.session_access_preserve_attested_days"
              ] || 90,
          };

          var pruneResult = pruneSessionAccess(sa, pruneOpts);
          if (
            pruneResult.removedTaskEntries > 0 ||
            pruneResult.removedDomainEntries > 0 ||
            pruneResult.removedAgentEntries > 0 ||
            pruneResult.removedStaleAgents > 0
          ) {
            // Write pruned state back
            try {
              writeSubState("knowledge_cache_state", kcs);
            } catch {}
            report.sessions_pruned = true;
            report.prune_stats = {
              removed_agent_entries: pruneResult.removedAgentEntries,
              removed_task_entries: pruneResult.removedTaskEntries,
              removed_domain_entries: pruneResult.removedDomainEntries,
              removed_stale_agents: pruneResult.removedStaleAgents,
            };

            // KC-08: Non-fatal audit counter
            var totalRemoved =
              (pruneResult.removedTaskEntries || 0) +
              (pruneResult.removedDomainEntries || 0) +
              (pruneResult.removedStaleAgents || 0);
            if (totalRemoved > 0) {
              try {
                incrementAuditCounter(
                  "last_cleanup_removed_session_entries",
                  totalRemoved,
                );
              } catch {}
            }
          }
        } catch (e: any) {
          writeLog(SRC, "ERROR", {
            event: "COMPACTION-PRUNE-FAILED",
            detail: `Session pruning failed: ${e.message}`,
          });
        }
      }

      // ── 3. Update audit timestamps ──
      try {
        touchKnowledgeAcquisition();
      } catch {}

      // ── 4. Push audit event ──
      try {
        pushAuditEvent({
          event: "KC-NIGHTLY-COMPACTION",
          timestamp: new Date().toISOString(),
          detail: `index_before=${report.index_entries_before} index_after=${report.index_entries_after} prune=${JSON.stringify(report.prune_stats)}`,
        });
      } catch {}

      writeLog(SRC, "INFO", {
        event: "NIGHTLY-COMPACTION-COMPLETE",
        detail: `compacted=${report.index_compacted} pruned=${report.sessions_pruned} removed_index=${report.index_entries_before - report.index_entries_after}`,
      });

      return JSON.stringify(report);
    });
  },
});
