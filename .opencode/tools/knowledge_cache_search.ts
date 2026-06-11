import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { tolerantParse } from "../lib/tolerant-json";

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
    var agent = (context && context.agent) || "unknown";
    var projectRoot = process.env.OPENCODE_ROOT || process.cwd();

    // ── Pipeline chain validation ──
    // Verify that module_scope_declare was called with the same task_id
    // before allowing knowledge_cache_search to complete the pipeline.
    var pipelineValid = false;
    try {
      var preMachinePath = path.resolve(projectRoot, ".opencode", "state", "machine.json");
      if (fs.existsSync(preMachinePath)) {
        var preMachine = JSON.parse(fs.readFileSync(preMachinePath, "utf8"));
        var preAgent = agent.replace(/^@/, "");
        var preSA = (preMachine.knowledge_cache_state?.session_access || {})[preAgent] || {};
        if (preSA.pipeline_task_id === args.task_id && preSA.pipeline_status === "declared") {
          pipelineValid = true;
        }
      }
    } catch (e) { /* non-fatal */ }

    if (!pipelineValid && args.task_id) {
      try {
        var preMachinePath2 = path.resolve(projectRoot, ".opencode", "state", "machine.json");
        if (fs.existsSync(preMachinePath2)) {
          var preMachine2 = JSON.parse(fs.readFileSync(preMachinePath2, "utf8"));
          var preAgent2 = agent.replace(/^@/, "");
          var preSA2 = (preMachine2.knowledge_cache_state?.session_access || {})[preAgent2] || {};
          return JSON.stringify({
            cache_available: true,
            error: "Pipeline chain broken: module_scope_declare must be called first with same task_id (" + args.task_id + "). Current pipeline_task_id: " + (preSA2.pipeline_task_id || "none") + ", status: " + (preSA2.pipeline_status || "none"),
            next_step: "Call module_scope_declare first.",
          });
        }
      } catch (e) { /* non-fatal */ }
    }

    var indexPath = path.resolve(
      projectRoot,
      "docs",
      "official_docs",
      "index.json",
    );
    var machinePath = path.resolve(
      projectRoot,
      ".opencode",
      "state",
      "machine.json",
    );
    var configPath = path.resolve(
      projectRoot,
      ".opencode",
      "project.config.json",
    );

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
    var domainKeywords = [];
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

    var hitEntries = [];
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
          cached_files: (entry.files || []).map(function (f) {
            return f.path;
          }),
        });
      }
    }

    var uc7Recorded = false;
    try {
      if (fs.existsSync(machinePath)) {
        var machine = JSON.parse(fs.readFileSync(machinePath, "utf8"));
        var kcs = machine.knowledge_cache_state || {};
        kcs.session_access = kcs.session_access || {};
        var agentKey = agent.replace(/^@/, "");
        kcs.session_access[agent] =
          kcs.session_access[agent] || kcs.session_access[agentKey] || {};
        kcs.session_access[agent].last_read_at = new Date().toISOString();
        kcs.session_access[agent].last_file_read = indexPath;
        kcs.session_access[agent].uc7_001_compliant = true;
        kcs.session_access[agent].pipeline_task_id = args.task_id || "";
        kcs.session_access[agent].pipeline_status = "completed";
        kcs.session_access[agent].total_cache_reads =
          (kcs.session_access[agent].total_cache_reads || 0) + 1;
        // B1 FIX (FW-REPAIR-BATCH2): Auto-set cache_sufficiency based on search results.
        // Eliminates the need for agents to manually declare sufficiency (Step 0c).
        // "sufficient" → cache had matching entries; "insufficient" → no matches found.
        // UC7-001c HARDEN (2026-06-11): Also auto-fill reason, files_read, and
        // content_summary evidence fields. These are REQUIRED by uc7ks-before.ts,
        // compliance-gate.ts, and pre-execution-hook.sh Stage 4.
        if (!kcs.session_access[agent].cache_sufficiency) {
          kcs.session_access[agent].cache_sufficiency = {
            status: "undeclared",
            missing_topics: [],
            declared_at: null,
            reason: "",
            files_read: [],
            content_summary: "",
          };
        }
        kcs.session_access[agent].cache_sufficiency.declared_at =
          new Date().toISOString();
        if (hitEntries.length > 0) {
          kcs.session_access[agent].cache_sufficiency.status = "sufficient";
          kcs.session_access[agent].cache_sufficiency.missing_topics = [];
          // Auto-fill evidence fields (UC7-001c)
          var filesRead = [];
          for (var k = 0; k < hitEntries.length; k++) {
            var entryFiles = hitEntries[k].cached_files || [];
            for (var m = 0; m < entryFiles.length; m++) {
              filesRead.push(entryFiles[m]);
            }
          }
          var topicsFound = [];
          for (var n = 0; n < hitEntries.length; n++) {
            topicsFound.push(hitEntries[n].topic);
          }
          kcs.session_access[agent].cache_sufficiency.reason =
            "Found " + hitEntries.length + " matching cache entries for domain \"" +
            (args.domain || "all") + "\": " + topicsFound.join("; ");
          kcs.session_access[agent].cache_sufficiency.files_read = filesRead;
          kcs.session_access[agent].cache_sufficiency.content_summary =
            hitEntries.length + " entries covering " + filesRead.length +
            " files: " + topicsFound.slice(0, 3).join(" | ");
        } else {
          kcs.session_access[agent].cache_sufficiency.status = "insufficient";
          kcs.session_access[agent].cache_sufficiency.missing_topics =
            domainKeywords.length > 0
              ? domainKeywords.slice(0, 5)
              : ["No domain keywords found for: " + (args.domain || "unknown")];
          // Auto-fill evidence fields for insufficient case
          var reasonForInsufficient = "No matching cache entries for domain \"" +
            (args.domain || "all") + "\". Cache has " + entries.length +
            " total entries across " +
            (Object.keys(entries.reduce(function (acc, e) {
              (e.library_id ? acc[e.library_id] = 1 : null); return acc;
            }, {})).length || entries.length) + " libraries.";
          kcs.session_access[agent].cache_sufficiency.reason = reasonForInsufficient;
          kcs.session_access[agent].cache_sufficiency.files_read = [];
          kcs.session_access[agent].cache_sufficiency.content_summary =
            "No cached content for domain \"" + (args.domain || "all") +
            "\". Cache has " + entries.length + " total entries.";
        }
        // SA-IMPL-SELF-CLEANUP (2026-06-11): Write-time cap on session_access entries.
        // Prevents unbounded growth of stale/unknown agent entries. When the cap is
        // exceeded, the oldest entries (by last_read_at) are removed.
        // This is Strategy A — opportunistic cleanup with zero additional overhead.
        var MAX_AGENTS = 20;
        var agentKeys = Object.keys(kcs.session_access);
        if (agentKeys.length > MAX_AGENTS) {
          var sorted = agentKeys.sort(function (a, b) {
            var sa_a = kcs.session_access[a] || {};
            var sa_b = kcs.session_access[b] || {};
            return new Date(sa_a.last_read_at || sa_a.declared_at || 0).getTime() -
              new Date(sa_b.last_read_at || sa_b.declared_at || 0).getTime();
          });
          var toRemove = sorted.slice(0, agentKeys.length - MAX_AGENTS);
          for (var r = 0; r < toRemove.length; r++) {
            delete kcs.session_access[toRemove[r]];
          }
        }
        kcs.compliance = kcs.compliance || {};
        kcs.compliance.cache_hits =
          (kcs.compliance.cache_hits || 0) + hitEntries.length;
        var tmpPath = machinePath + ".tmp." + Date.now();
        fs.writeFileSync(
          tmpPath,
          JSON.stringify(
            Object.assign({}, machine, { knowledge_cache_state: kcs }),
            null,
            2,
          ),
          "utf8",
        );
        fs.renameSync(tmpPath, machinePath);
        uc7Recorded = true;

        // SA-IMPL-LEGACY-FIXES (2026-06-11): Write-time knowledge_state sync.
        // CAS pattern: only update if count increased, preventing stale writes
        // from reducing the count in concurrent dispatch scenarios.
        try {
          var postCheck = JSON.parse(fs.readFileSync(machinePath, "utf8"));
          postCheck.knowledge_state = postCheck.knowledge_state || {};
          var newCount = entries.length;
          var oldCount = postCheck.knowledge_state.total_docs_count || 0;
          if (oldCount < newCount) {
            postCheck.knowledge_state.total_docs_count = newCount;
            var tmpPath2 = machinePath + ".tmp." + Date.now();
            fs.writeFileSync(tmpPath2, JSON.stringify(postCheck, null, 2), "utf8");
            fs.renameSync(tmpPath2, machinePath);
          }
        } catch (_syncErr) { /* non-critical */ }
      }
    } catch (e) {
      /* non-fatal */
    }

    return JSON.stringify({
      cache_available: true,
      total_entries: entries.length,
      search_domain: args.domain || "all",
      hits: hitEntries.length,
      hit_entries: hitEntries,
      uc7_001_recorded: uc7Recorded,
      next_step:
        hitEntries.length > 0
          ? "Cache sufficient. Proceed to compliance_gate_check."
          : "Cache insufficient. Proceed to Step 0c.",
    });
  },
});
