import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { tolerantParse } from "../lib/tolerant-json";
import {
  readCacheSufficiency,
  isPipelineDeclared,
  MAX_AGENTS,
  type CacheSufficiency,
  type CacheDiscovery,
} from "../lib/uc7ks-schema";
import {
  readManifest,
  searchByTags,
  searchByDomain,
  type KnowledgeManifest,
} from "../lib/knowledge-store";
import { writeLog } from "../lib/log-manager";
const { readSubState } = require("../lib/substate-manager");
import { withInterruptGuard } from "../lib";
import { incrementAuditCounter, touchCacheCheck } from "../lib/knowledge-audit";
import { checklistWirePassed } from "../lib/checklist-hooks";
import {
  resolvePipelineId,
  atomicUpsertDiscovery,
} from "../lib/uc7ks-pipeline-db";

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
      } else {
        // P1-2 FIX: unconditional domain-first search (no longer gated by domainKeywords length)
        var seenEntries: Record<string, boolean> = {};
        if (args.domain) {
          try {
            var domainResults = searchByDomain(args.domain);
            for (var i = 0; i < domainResults.length; i++) {
              var e = domainResults[i];
              var key = e.library_id + "|" + e.query_topic;
              if (!seenEntries[key]) {
                seenEntries[key] = true;
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
          } catch {
            /* non-fatal */
          }
        }
        // Domain filter with keywords — use store-based tag search (fallback)
        var results = searchByTags(domainKeywords);
        for (var i = 0; i < results.length; i++) {
          var e = results[i];
          var key = e.library_id + "|" + e.query_topic;
          if (!seenEntries[key]) {
            seenEntries[key] = true;
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

      // FW-FIX-CHECK35 (2026-06-23, @Super-Admin): cache_sufficiency.status
      // is now "pending_attestation" (not "sufficient") when discovery finds
      // hits. This prevents stale pre-HARDEN entries: if attestation fails,
      // the entry stays "pending_attestation" (not "sufficient" with empty
      // evidence), so Check 35's hasValidEvidence() correctly skips it.
      // knowledge_cache_attest promotes status to "sufficient" on success.
      // discovery.status remains "sufficient" (machine-generated, accurate).
      var sufficiency: CacheSufficiency = {
        status: cacheSufficient ? "pending_attestation" : "insufficient",
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

      // ════════════════════════════════════════════════════════════
      // DB-Canonical Write (v19 — uc7ks_pipeline_state, Phase 2: DB-only)
      // The uc7ks_pipeline_state table is the sole writable data source.
      // JSON blob (knowledge_cache_state) and v11 typed tables
      // (knowledge_session_access, knowledge_discovery) are frozen
      // as read-only historical snapshots.
      // ════════════════════════════════════════════════════════════
      var uc7Recorded = false;
      try {
        const sessionId =
          (typeof context !== "undefined" &&
            (context as any) &&
            (context as any).sessionID) ||
          undefined;
        const pipelineId = resolvePipelineId(args, sessionId);
        const dagTaskId = args.task_id || undefined;
        const domainIdForDb = args.domain || "all";

        uc7Recorded = atomicUpsertDiscovery({
          pipelineId,
          agent,
          domainId: domainIdForDb,
          sessionId,
          dagTaskId,
          discovery: {
            status: (sufficiency.discovery?.status || sufficiency.status) as
              | "sufficient"
              | "insufficient",
            discovered_files: discoveredFiles,
            missing_topics: [],
            discovered_at: new Date().toISOString(),
          },
        });
      } catch (e: any) {
        writeLog("knowledge_cache_search", "WARN", {
          event: "UC7KS-DB-CANONICAL-WRITE-FAILED",
          detail: `DB-canonical discovery write failed (non-fatal): ${e.message}`,
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

      // P0-CHECKLIST: wire cache search success to checklist
      try {
        checklistWirePassed(
          (context as any)?.sessionID || "",
          agent,
          args.task_id || "",
          "knowledge_search_completed",
          `domain=${args.domain || "all"} hits=${hitEntries.length}`,
        );
      } catch {}

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
