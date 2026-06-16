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
  MAX_AGENTS,
  type CacheSufficiency,
  normalizeAgentKey,
} from "../lib/uc7ks-schema";
const { readSubState } = require("../lib/substate-manager");
import { atomicWriteSubState } from "../lib/state-utils";
import { withInterruptGuard } from "../lib";

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
      var agent = (context && context.agent) || "unknown";
      var projectRoot = process.env.OPENCODE_ROOT || process.cwd();

      // ── Pipeline chain validation (F2: per-domain check) ──
      // Now checks whether THIS domain has been declared for THIS task,
      // not a global agent-level "declared" flag. Multiple domains can
      // coexist for the same task without clobbering each other.
      // P1-B: read knowledge_cache_state via readSubState (split from machine.json)
      var pipelineValid = true;
      try {
        process.stderr.write("[knowledge_cache_search] P1-B: reading knowledge_cache_state via readSubState\n");
        var preKCS = readSubState("knowledge_cache_state");
        var preSA = (preKCS.session_access || {}) as Record<string, any>;
        var preAgent = normalizeAgentKey(agent);
        // Check nested domain declaration
        if (!isPipelineDeclared(preSA, agent, args.task_id || "", args.domain)) {
          // Also check legacy flat for backward compat
          var flat = preSA[preAgent] || preSA[agent] || {};
          if (flat.pipeline_task_id !== args.task_id || flat.pipeline_status !== "declared") {
            pipelineValid = false;
          }
        }
      } catch (e) { /* non-fatal */ }

      if (!pipelineValid && args.task_id) {
        return JSON.stringify({
          cache_available: true,
          error: "Pipeline chain broken: module_scope_declare must be called first with same task_id (" + args.task_id + ") and domain (" + args.domain + ").",
          next_step: "Call module_scope_declare(module: \"" + args.domain + "\", task_id: \"" + args.task_id + "\") first.",
        });
      }

      var indexPath = path.resolve(projectRoot, "docs", "official_docs", "index.json");
      var configPath = path.resolve(projectRoot, ".opencode", "project.config.json");

      if (!fs.existsSync(indexPath)) {
        return JSON.stringify({
          cache_available: false,
          hits: 0,
          next_step: "Cache not initialized. Request @Knowledge-Curator.",
        });
      }

      var index;
      try {
        index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
        if (!index.manifest_version || !Array.isArray(index.entries)) {
          return JSON.stringify({
            cache_available: false,
            hits: 0,
            error: "Malformed index.json",
            next_step: "Rebuild via @Knowledge-Curator.",
          });
        }
      } catch (e) {
        return JSON.stringify({
          cache_available: false,
          hits: 0,
          error: "Read error",
          next_step: "Cannot read index.json.",
        });
      }

      var entries = index.entries || [];
      var domainKeywords: string[] = [];
      try {
        if (fs.existsSync(configPath)) {
          var config = tolerantParse(fs.readFileSync(configPath, "utf8"));
          var domains = (config.knowledge_semantic_map && config.knowledge_semantic_map.domains) || [];
          for (var i = 0; i < domains.length; i++) {
            if (domains[i].domain_id === args.domain) {
              domainKeywords = domains[i].keywords || [];
              break;
            }
          }
        }
      } catch (e) { /* non-fatal */ }

      var hitEntries: Array<{
        library_id: string;
        topic: string;
        tags: string[];
        cached_files: string[];
      }> = [];
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var tags = entry.tags || [];
        var matched = !args.domain;
        if (args.domain) {
          for (var j = 0; j < tags.length; j++) {
            if (domainKeywords.indexOf(tags[j]) !== -1) {
              matched = true;
              break;
            }
          }
        }
        if (matched) {
          hitEntries.push({
            library_id: entry.library_id,
            topic: entry.query_topic,
            tags: tags,
            cached_files: (entry.files || []).map(function (f: any) {
              return f.path;
            }),
          });
        }
      }

      // ── Build cache_sufficiency (F1: included in response) ──
      var filesRead: string[] = [];
      var topicsFound: string[] = [];
      for (var k = 0; k < hitEntries.length; k++) {
        topicsFound.push(hitEntries[k].topic);
        var ef = hitEntries[k].cached_files || [];
        for (var m = 0; m < ef.length; m++) {
          filesRead.push(ef[m]);
        }
      }

      var cacheSufficient = hitEntries.length > 0;
      var sufficiency: CacheSufficiency = {
        status: cacheSufficient ? "sufficient" : "insufficient",
        missing_topics: cacheSufficient
          ? []
          : (domainKeywords.length > 0
              ? domainKeywords.slice(0, 5)
              : ["No domain keywords found for: " + (args.domain || "unknown")]),
        declared_at: new Date().toISOString(),
        reason: cacheSufficient
          ? "Found " + hitEntries.length + " matching cache entries for domain \"" + (args.domain || "all") + "\": " + topicsFound.join("; ")
          : "No matching cache entries for domain \"" + (args.domain || "all") + "\". Cache has " + entries.length + " total entries.",
        files_read: filesRead,
        content_summary: cacheSufficient
          ? hitEntries.length + " entries covering " + filesRead.length + " files: " + topicsFound.slice(0, 3).join(" | ")
          : "No cached content for domain \"" + (args.domain || "all") + "\". Cache has " + entries.length + " total entries.",
      };

      // ── Write to sub-state files via CAS (F2: nested schema + F4: atomic) ──
      var uc7Recorded = false;
      try {
        var taskId = args.task_id || "unknown";
        var domainName = args.domain || "all";
        var agentRef = normalizeAgentKey(agent);

        // Write knowledge_cache_state
        var cacheWriteOk = atomicWriteSubState("knowledge_cache_state", function (kcs: any) {
          kcs.session_access = kcs.session_access || {};
          kcs.compliance = kcs.compliance || {};

          // Ensure agent entry
          var agentKey = agentRef;
          var existing = kcs.session_access[agentRef] || {};
          kcs.session_access[agentRef] = existing;

          // Write to nested domain entry (F2)
          var domainEntry = getDomainEntry(kcs.session_access, agentRef, taskId, domainName);
          domainEntry.pipeline_status = "completed";
          domainEntry.declared_at = new Date().toISOString();
          domainEntry.cache_sufficiency = sufficiency;

          // Update agent rollups (legacy + new)
          updateAgentRollups(kcs.session_access, agentRef);

          // Legacy flat fields (backward compat bridge)
          kcs.session_access[agentRef].pipeline_task_id = taskId;
          kcs.session_access[agentRef].declared_scope = domainName;
          kcs.session_access[agentRef].pipeline_status = "completed";
          kcs.session_access[agentRef].cache_sufficiency = sufficiency;
          kcs.session_access[agentRef].uc7_001_compliant = true;  // UC7-001 flag (read by uc7ks-utils.ts)

          // Cap management (F8: 50 agents)
          evictOldAgents(kcs.session_access);

          // P3/S85-1: Per-agent session_access LRU pruning (max 50 domain entries per agent).
          // Prevents unbounded growth between nightly cleanupStaleSessionAccessStep() runs.
          // Each agent's entries are sorted by accessed_at (declared_at fallback) descending,
          // keeping the 50 most recent.
          const MAX_DOMAINS_PER_AGENT = 50;
          if (kcs.session_access) {
            for (const ak of Object.keys(kcs.session_access)) {
              const agentEntries = kcs.session_access[ak];
              if (!agentEntries || typeof agentEntries !== "object") continue;
              const keys = Object.keys(agentEntries);
              if (keys.length > MAX_DOMAINS_PER_AGENT) {
                const sorted = keys
                  .map((k) => ({
                    key: k,
                    ts: new Date(agentEntries[k]?.last_read_at || agentEntries[k]?.declared_at || 0).getTime() || 0,
                  }))
                  .sort((a, b) => b.ts - a.ts);
                const keep = new Set(sorted.slice(0, MAX_DOMAINS_PER_AGENT).map((x) => x.key));
                for (const k of keys) {
                  if (!keep.has(k)) delete agentEntries[k];
                }
              }
            }
          }

          // Compliance rollup
          kcs.compliance.cache_hits = (kcs.compliance.cache_hits || 0) + hitEntries.length;
        });

        // Write knowledge_state
        var stateWriteOk = atomicWriteSubState("knowledge_state", function (ks: any) {
          var newCount = entries.length;
          var oldCount = ks.total_docs_count || 0;
          if (oldCount < newCount) {
            ks.total_docs_count = newCount;
          }
        });

        uc7Recorded = cacheWriteOk && stateWriteOk;
      } catch (e) {
        /* non-fatal */
      }

      // ── F1: Response includes cache_sufficiency evidence ──
      return JSON.stringify({
        cache_available: true,
        total_entries: entries.length,
        search_domain: args.domain || "all",
        hits: hitEntries.length,
        hit_entries: hitEntries,
        cache_sufficiency: sufficiency,
        uc7_001_recorded: uc7Recorded,
        next_step:
          hitEntries.length > 0
            ? "Cache sufficient. Proceed to compliance_gate_check."
            : "Cache insufficient. Proceed to Step 0c.",
      });
    });
  },
});
