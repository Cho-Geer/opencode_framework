import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { tolerantParse } from "../lib/tolerant-json";
import {
  getDomainEntry,
  updateAgentRollups,
  atomicWriteMachine,
  evictOldAgents,
  normalizeAgentKey,
} from "../lib/uc7ks-schema";

var VALID_MODULES = [
  "backend_api",
  "persistence",
  "frontend_ui",
  "caching",
  "queue",
  "testing",
  "auth_security",
  "framework_tools",
  "devops_ci",
  "opencode_framework",
  "infrastructure",
  "state_management",
];

export default tool({
  description:
    "Declare the target module scope for the current task. Maps module to knowledge domain, cache paths, and Context7 libraries. Called at task start (Step 0a) per UC7KS pipeline.",
  args: {
    module: tool.schema
      .string()
      .describe(
        "Target knowledge domain from knowledge_semantic_map (e.g., opencode_framework, backend_api)",
      ),
    task_id: tool.schema.string().describe("DAG task ID for session tracking"),
  },
  async execute(args, context) {
    var agent = (context && context.agent) || "unknown";
    var projectRoot = process.env.OPENCODE_ROOT || process.cwd();
    var configPath = path.resolve(projectRoot, ".opencode", "project.config.json");

    if (VALID_MODULES.indexOf(args.module) === -1) {
      return JSON.stringify({
        error: "Invalid module: " + args.module,
        available: VALID_MODULES,
      });
    }

    var config;
    try {
      config = tolerantParse(fs.readFileSync(configPath, "utf8"));
    } catch (e) {
      return JSON.stringify({ error: "Cannot read project.config.json" });
    }

    var domains = (config.knowledge_semantic_map && config.knowledge_semantic_map.domains) || [];
    var domain = null;
    for (var i = 0; i < domains.length; i++) {
      if (domains[i].domain_id === args.module) {
        domain = domains[i];
        break;
      }
    }
    if (!domain) {
      return JSON.stringify({
        error: "Unknown domain: " + args.module,
        available: domains.map(function (d: any) { return d.domain_id; }),
      });
    }

    // ── Write to machine.json via CAS (F2: nested per-task-per-domain) ──
    try {
      var taskId = args.task_id || "unknown";
      var domainName = args.module;
      var agentRef = normalizeAgentKey(agent);

      atomicWriteMachine(function (machine: any) {
        var kcs = machine.knowledge_cache_state = machine.knowledge_cache_state || { session_access: {}, compliance: {} };
        kcs.session_access = kcs.session_access || {};

        // Write to nested domain entry (F2)
        var domainEntry = getDomainEntry(kcs.session_access, agentRef, taskId, domainName);
        domainEntry.pipeline_status = "declared";
        domainEntry.declared_at = new Date().toISOString();
        // Preserve any existing cache_sufficiency from prior calls
        if (!domainEntry.cache_sufficiency || domainEntry.cache_sufficiency.status === "undeclared") {
          domainEntry.cache_sufficiency = domainEntry.cache_sufficiency || {
            status: "undeclared",
            missing_topics: [],
            declared_at: null,
            reason: "",
            files_read: [],
            content_summary: "",
          };
        }

        // Update agent rollups
        updateAgentRollups(kcs.session_access, agentRef);

        // Legacy flat fields (backward compat bridge)
        kcs.session_access[agentRef].pipeline_task_id = taskId;
        kcs.session_access[agentRef].declared_scope = domainName;
        kcs.session_access[agentRef].pipeline_status = "declared";

        // Cap management
        evictOldAgents(kcs.session_access);
      });
    } catch (e) {
      /* non-fatal */
    }

    return JSON.stringify({
      domain: domain.domain_id,
      cache_path: "docs/official_docs/" + domain.save_path,
      context7_libraries: domain.context7_libraries,
      fallback_url: domain.fallback_pattern,
      next_step: "Read docs/official_docs/index.json",
    });
  },
});
