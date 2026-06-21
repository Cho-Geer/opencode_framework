import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { tolerantParse } from "../lib/tolerant-json";
import {
  getDomainEntry,
  updateAgentRollups,
  readCacheSufficiency,
  isPipelineDeclared,
  evictOldAgents,
  pruneSessionAccess,
  MAX_AGENTS,
  type CacheSufficiency,
  type CacheDiscovery,
  type PruneOptions,
  normalizeAgentKey,
  writeCacheDiscovery,
} from "../lib/uc7ks-schema";
import {
  readManifest,
  searchByTags,
  type KnowledgeManifest,
} from "../lib/knowledge-store";
import { writeLog } from "../lib/log-manager";
const { readSubState } = require("../lib/substate-manager");
import { atomicWriteSubState } from "../lib/state-utils";
import { withInterruptGuard } from "../lib";
import { incrementAuditCounter, touchCacheCheck } from "../lib/knowledge-audit";
import { getDb } from "../lib/db-manager";

export default tool({
  description:
    "Automated local knowledge cache search. Reads docs/official_docs/index.json, matches entries by domain/tags, records UC7-001 compliance in machine.json.",
  args: {
    domain: tool.schema
      .string()
      .describe("Domain ID to search for (e.g., backend_api, persistence)"),
    task_id: tool.schema.string().describe("DAG task ID for session tracking"),
  },
  async execute(args, context) {
    return withInterruptGuard("knowledge_cache_search", async () => {
      // ── BUG 2 FIX (2026-06-18): READ-ONLY FRAMEWORK_TASK_ID policy ──
      // This tool must NEVER set process.env.FRAMEWORK_TASK_ID. It only READS
      // the env var (via args.task_id passed by the caller) for UC7-001
      // compliance recording. Setting it here would pollute the environment
      // and cause gate-before P2-1 DAG checks to block on stale task IDs.
      // The dispatcher (dispatch_subagent.ts) is the sole owner of
      // FRAMEWORK_TASK_ID lifecycle — it saves, sets, and restores the env var.
      var agent = (context && context.agent) || "unknown";
      var projectRoot = process.env.OPENCODE_ROOT || process.cwd();

      // ── Pipeline chain validation (F2: per-domain check) ──
      // Now checks whether THIS domain has been declared for THIS task,
      // not a global agent-level "declared" flag. Multiple domains can
      // coexist for the same task without clobbering each other.
      // P1-B: read knowledge_cache_state via readSubState (split from machine.json)
      var pipelineValid = true;
      try {
        writeLog("knowledge_cache_search", "DEBUG", {
          event: "P1B-READ-KCS",
          detail: "reading knowledge_cache_state via readSubState",
        });
        var preKCS = readSubState("knowledge_cache_state");
        var preSA = (preKCS.session_access || {}) as Record<string, any>;
        var preAgent = normalizeAgentKey(agent);
        // Check nested domain declaration
        if (
          !isPipelineDeclared(preSA, agent, args.task_id || "", args.domain)
        ) {
          // Also check legacy flat for backward compat
          var flat = preSA[preAgent] || preSA[agent] || {};
          if (
            flat.pipeline_task_id !== args.task_id ||
            flat.pipeline_status !== "declared"
          ) {
            pipelineValid = false;
          }
        }
      } catch (e) {
        /* non-fatal */
      }

      if (!pipelineValid && args.task_id) {
        return JSON.stringify({
          cache_available: true,
          error:
            "Pipeline chain broken: module_scope_declare must be called first with same task_id (" +
            args.task_id +
            ") and domain (" +
            args.domain +
            ").",
          next_step:
            'Call module_scope_declare(module: "' +
            args.domain +
            '", task_id: "' +
            args.task_id +
            '") first.',
        });
      }

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

      /**
       * KC-06 (2026-06-21 @Super-Admin): Migrated from direct
       * fs.readFileSync + JSON.parse to knowledgeStore.readManifest().
       * This preserves UC7-007 atomic update semantics via indexer.ts
       * and provides typed KnowledgeEntry[] for tag-based search.
       * Backward compat: file existence check retained for error message
       * quality; total_entries < 1 treated as "not initialized".
       */
      if (!fs.existsSync(indexPath)) {
        return JSON.stringify({
          cache_available: false,
          hits: 0,
          next_step: "Cache not initialized. Request @Knowledge-Curator.",
        });
      }

      var manifest: KnowledgeManifest;
      try {
        manifest = readManifest();
        if (!manifest || !Array.isArray(manifest.entries)) {
          return JSON.stringify({
            cache_available: false,
            hits: 0,
            error: "Malformed index.json (via knowledge-store)",
            next_step: "Rebuild via @Knowledge-Curator.",
          });
        }
      } catch (e) {
        return JSON.stringify({
          cache_available: false,
          hits: 0,
          error: "Read error (via knowledge-store)",
          next_step: "Cannot read index.json.",
        });
      }

      var entries = manifest.entries;
      var totalEntries = manifest.total_entries;
      var domainKeywords: string[] = [];
      try {
        if (fs.existsSync(configPath)) {
          var config = tolerantParse(fs.readFileSync(configPath, "utf8"));
          var domains =
            (config.knowledge_semantic_map &&
              config.knowledge_semantic_map.domains) ||
            [];
          for (var i = 0; i < domains.length; i++) {
            if (domains[i].domain_id === args.domain) {
              domainKeywords = domains[i].keywords || [];
              break;
            }
          }
        }
      } catch (e) {
        /* non-fatal */
      }

      /**
       * KC-06 + KC-16 (2026-06-21 @Super-Admin): Migrated from
       * knowledgeStore.searchManifest({ tags }) to the
       * knowledgeStore.searchByTags() convenience wrapper.
       * searchByTags is a thin wrapper that delegates to
       * searchManifest({ tags }), providing a cleaner semantic API.
       * Phase 1 of knowledge-store-api-integration-plan.
       */
      writeLog("knowledge_cache_search", "INFO", {
        event: "KC-SEARCH-VIA-STORE",
        detail: `store-based search domain=${args.domain || "all"} tags=[${domainKeywords.join(",")}]`,
        task_id: args.task_id,
        domain: args.domain,
      });

      var hitEntries: Array<{
        library_id: string;
        topic: string;
        tags: string[];
        cached_files: string[];
      }> = [];
      if (!args.domain) {
        // No domain filter — return all entries
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          hitEntries.push({
            library_id: e.library_id,
            topic: e.query_topic,
            tags: e.tags || [],
            cached_files: (e.files || []).map(function (f: any) {
              return f.path;
            }),
          });
        }
      } else if (domainKeywords.length > 0) {
        // Domain filter with keywords — use store-based tag search
        var results = searchByTags(domainKeywords);
        for (var i = 0; i < results.length; i++) {
          var e = results[i];
          hitEntries.push({
            library_id: e.library_id,
            topic: e.query_topic,
            tags: e.tags || [],
            cached_files: (e.files || []).map(function (f: any) {
              return f.path;
            }),
          });
        }
      }
      // else: domainKeywords empty AND args.domain set → no hits
      // (preserves pre-KC-06 behavior — domain unknown = empty result)

      // ── Build cache_sufficiency (F1: included in response) ──
      // Phase 0 (2026-06-18): discovery is machine-generated by this tool.
      // attestation is separate — agent must call knowledge_cache_attest to
      // prove actual read. Legacy reason/files_read/content_summary are kept
      // for backward compat display ONLY — they are NOT authoritative evidence.
      var discoveredFiles: string[] = [];
      var topicsFound: string[] = [];
      for (var k = 0; k < hitEntries.length; k++) {
        topicsFound.push(hitEntries[k].topic);
        var ef = hitEntries[k].cached_files || [];
        for (var m = 0; m < ef.length; m++) {
          discoveredFiles.push(ef[m]);
        }
      }

      var cacheSufficient = hitEntries.length > 0;
      var discoveredAt = new Date().toISOString();
      var discovery: CacheDiscovery = {
        status: cacheSufficient ? "sufficient" : "insufficient",
        missing_topics: cacheSufficient
          ? []
          : domainKeywords.length > 0
            ? domainKeywords.slice(0, 5)
            : ["No domain keywords found for: " + (args.domain || "unknown")],
        discovered_files: discoveredFiles,
        discovered_at: discoveredAt,
      };

      // Legacy cache_sufficiency for backward compat display only.
      // reason/files_read/content_summary are EMPTY — must come from
      // knowledge_cache_attest agent-submitted verification.
      // status/missing_topics/declared_at synced from discovery for compat.
      var sufficiency: CacheSufficiency = {
        status: cacheSufficient ? "sufficient" : "insufficient",
        missing_topics: cacheSufficient
          ? []
          : domainKeywords.length > 0
            ? domainKeywords.slice(0, 5)
            : ["No domain keywords found for: " + (args.domain || "unknown")],
        declared_at: discoveredAt,
        reason:
          "[DEPRECATED] Auto-generated from index.json — NOT authoritative. Use knowledge_cache_attest for verified read evidence.",
        files_read: [],
        content_summary:
          "[DEPRECATED] Auto-generated from index.json — NOT authoritative. Use knowledge_cache_attest for verified read evidence.",
        discovery: discovery,
      };

      // ── Write to sub-state files via CAS (F2: nested schema + F4: atomic) ──
      var uc7Recorded = false;
      try {
        var taskId = args.task_id || "unknown";
        var domainName = args.domain || "all";
        var agentRef = normalizeAgentKey(agent);

        // Write knowledge_cache_state
        var cacheWriteOk = atomicWriteSubState(
          "knowledge_cache_state",
          function (kcs: any) {
            kcs.session_access = kcs.session_access || {};
            kcs.compliance = kcs.compliance || {};

            // Ensure agent entry
            var agentKey = agentRef;
            var existing = kcs.session_access[agentRef] || {};
            kcs.session_access[agentRef] = existing;

            // Phase 0 (2026-06-18): Write discovery via helper.
            // This writes discovery fields to the nested domain entry.
            // Legacy sufficiency is synced for backward compat display only.
            // uc7_001_compliant global flag is NOT set — attestation is now
            // the authoritative write-block evidence (see uc7ks-utils.ts).
            var domainEntry = getDomainEntry(
              kcs.session_access,
              agentRef,
              taskId,
              domainName,
            );
            domainEntry.pipeline_status = "completed";
            domainEntry.declared_at = new Date().toISOString();
            domainEntry.cache_sufficiency = sufficiency;
            // Also write discovery explicitly via helper (ensures schema compliance)
            writeCacheDiscovery(
              kcs.session_access,
              agentRef,
              taskId,
              domainName,
              discovery,
            );

            // Update agent rollups (legacy + new)
            updateAgentRollups(kcs.session_access, agentRef);

            // Legacy flat fields (backward compat bridge)
            kcs.session_access[agentRef].pipeline_task_id = taskId;
            kcs.session_access[agentRef].declared_scope = domainName;
            kcs.session_access[agentRef].pipeline_status = "completed";
            kcs.session_access[agentRef].cache_sufficiency = sufficiency;
            // Phase 0: uc7_001_compliant is no longer set by cache_search alone.
            // Attestation via knowledge_cache_attest is now required for write-block
            // pass in strict/locked mode. Advisory mode still accepts legacy sufficient.

            // Cap management (F8: 50 agents)
            evictOldAgents(kcs.session_access);

            // P3/S85-1 + KC-03: Per-agent nested session_access pruning.
            // Replaces broken inline LRU (which only pruned top-level agentEntries keys,
            // missing the nested tasks[task_id].domains[domain_id] structure).
            // Uses shared pruneSessionAccess() from uc7ks-schema.ts.
            // Reads config thresholds from project.config.json template_resolution.
            // KC-03 (2026-06-20): @Super-Admin — replaced inline LRU with shared helper.
            const pruneOpts: PruneOptions = {
              session_access_ttl_days:
                config?.template_resolution?.[
                  "knowledge.session_access_ttl_days"
                ] || 30,
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
              // KC-14: Archive pruned DB rows before deletion.
              // Inline prune (during search) only prunes in-memory;
              // DB-level archiving is handled by nightly-compaction.
              archive_enabled: false,
            };
            const pruneResult = pruneSessionAccess(
              kcs.session_access,
              pruneOpts,
              taskId,
              domainName,
            );
            if (
              pruneResult.removedTaskEntries > 0 ||
              pruneResult.removedDomainEntries > 0 ||
              pruneResult.removedStaleAgents > 0
            ) {
              writeLog("knowledge-cache-prune", "INFO", {
                event: "KC-SESSION-ACCESS-PRUNED",
                detail: `tasks=${pruneResult.removedTaskEntries} domains=${pruneResult.removedDomainEntries} agents=${pruneResult.removedStaleAgents}`,
                task_id: taskId,
                domain: domainName,
              });
            }

            // Compliance rollup
            kcs.compliance.cache_hits =
              (kcs.compliance.cache_hits || 0) + hitEntries.length;
          },
        );

        // Write knowledge_state
        var stateWriteOk = atomicWriteSubState(
          "knowledge_state",
          function (ks: any) {
            var newCount = totalEntries;
            var oldCount = ks.total_docs_count || 0;
            if (oldCount < newCount) {
              ks.total_docs_count = newCount;
            }
          },
        );

        uc7Recorded = cacheWriteOk && stateWriteOk;
      } catch (e) {
        /* non-fatal */
      }

      // ════════════════════════════════════════════════════════════
      // KC-12 (2026-06-21): Normalize into v11 typed tables.
      // After writing session_access to knowledge_cache_state,
      // also INSERT into knowledge_session_access and
      // knowledge_discovery v11 typed tables.
      // Non-fatal: DB failures do NOT block the search response.
      // Uses INSERT OR IGNORE for idempotency across re-runs.
      // ════════════════════════════════════════════════════════════
      try {
        var db = getDb();
        var sessionId =
          (typeof context !== "undefined" &&
            (context as any) &&
            (context as any).sessionID) ||
          null;
        var now = Date.now();
        // A2 (v13 UPSERT): Replace INSERT OR IGNORE with UPSERT using
        // the unique indexes added in db-manager.ts v13 migration.
        // Monotonic status guard: status only upgraded declared→discovered.
        // ON CONFLICT with DO UPDATE replaces silent ignore with idempotent
        // row creation + monotonic field updates.
        // Note: domainName is already defined above (line ~275)
        db.run(
          `INSERT INTO knowledge_session_access
           (agent, task_id, domain_id, opencode_session_id, status,
            discovered_at, declared_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'discovered', ?, ?, ?, ?)
           ON CONFLICT(agent, task_id, domain_id) DO UPDATE SET
             opencode_session_id = excluded.opencode_session_id,
             status = CASE WHEN knowledge_session_access.status = 'declared'
                       THEN 'discovered'
                       ELSE knowledge_session_access.status END,
             discovered_at = CASE WHEN knowledge_session_access.discovered_at IS NULL
                            THEN excluded.discovered_at
                            ELSE knowledge_session_access.discovered_at END,
             updated_at = excluded.updated_at`,
          [agentRef, taskId, domainName, sessionId, now, now, now, now],
        );
        db.run(
          `INSERT INTO knowledge_discovery
           (session_id, agent, task_id, domain_id, result_status,
            matched_entries, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(agent, task_id, domain_id) DO UPDATE SET
             session_id = excluded.session_id,
             result_status = excluded.result_status,
             matched_entries = excluded.matched_entries,
             created_at = excluded.created_at`,
          [
            sessionId,
            agentRef,
            taskId,
            domainName,
            cacheSufficient ? "sufficient" : "insufficient",
            hitEntries.length,
            now,
          ],
        );
        writeLog("knowledge_cache_search", "INFO", {
          event: "KC12-DB-NORMALIZE",
          detail: "v11 knowledge_session_access + knowledge_discovery INSERTs",
          task_id: taskId,
          domain: domainName,
          agent: agentRef,
          session_id: sessionId,
          hits: hitEntries.length,
        });
      } catch (dbErr: any) {
        /* Non-fatal: v11 DB write failure does NOT block cache search */
        writeLog("knowledge_cache_search", "WARN", {
          event: "KC12-DB-NORMALIZE-FAILED",
          detail: dbErr.message || String(dbErr),
          task_id: args.task_id,
          domain: args.domain,
        });
      }

      // ── KC-02 (2026-06-21): Non-fatal audit rollup ──
      try {
        incrementAuditCounter("total_cache_checks");
      } catch {}
      try {
        touchCacheCheck();
      } catch {}
      if (hitEntries.length > 0) {
        try {
          incrementAuditCounter("total_cache_hits");
        } catch {}
      } else {
        try {
          incrementAuditCounter("total_cache_misses");
        } catch {}
      }

      // ── F1: Response includes cache_sufficiency evidence ──
      // Phase 0 (2026-06-18): Response includes discovery (machine-generated)
      // AND legacy cache_sufficiency (display compat). Attestation is separate:
      // agent must call knowledge_cache_attest after reading cache files.
      return JSON.stringify({
        cache_available: true,
        total_entries: totalEntries,
        search_domain: args.domain || "all",
        hits: hitEntries.length,
        hit_entries: hitEntries,
        discovery: discovery,
        cache_sufficiency: sufficiency,
        uc7_001_recorded: uc7Recorded,
        next_step:
          hitEntries.length > 0
            ? "Cache sufficient — NOW: (1) read cache files with 'read' tool, (2) call knowledge_cache_attest to verify read evidence before writing."
            : "Cache insufficient. Proceed to Step 0c — request @Knowledge-Curator dispatch.",
      });
    });
  },
});
