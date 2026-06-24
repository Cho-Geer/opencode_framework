import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { tolerantParse } from "../lib/tolerant-json";
import { withInterruptGuard } from "../lib";
import { checklistWirePassed } from "../lib/checklist-hooks";
import { resolveDomainId } from "../lib/agent-resolver";
import { dbWriteSessionMap } from "../lib/db-state-manager";
import { writeLog } from "../lib/log-manager";
import { pushAuditEvent } from "../lib/knowledge-audit";

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
    return withInterruptGuard("module_scope_declare", async () => {
      var agent = (context && context.agent) || "unknown";
      var projectRoot = process.env.OPENCODE_ROOT || process.cwd();
      var configPath = path.resolve(
        projectRoot,
        ".opencode",
        "project.config.json",
      );

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

      var domains =
        (config.knowledge_semantic_map &&
          config.knowledge_semantic_map.domains) ||
        [];
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
          available: domains.map(function (d: any) {
            return d.domain_id;
          }),
        });
      }

      // ── DB-Canonical Write (v19 Phase 2): uc7ks_pipeline_state is the sole source.
      // JSON blob (knowledge_cache_state) and v11 typed tables removed.
      try {
        const {
          resolvePipelineId,
          atomicUpsertDiscovery,
        } = require("../lib/uc7ks-pipeline-db");
        const sessionId =
          (typeof context !== "undefined" &&
            (context as any) &&
            (context as any).sessionID) ||
          undefined;
        const pipelineId = resolvePipelineId(args, sessionId);

        /**
         * FW-P0-FIX-F11 (2026-06-25, @Super-Admin):
         * Changed discovery status from "undeclared" to "declared" to fix
         * pipeline chain broken bug. knowledge_cache_search.ts L64 checks
         * discovery_status === "undeclared" and rejects the pipeline as
         * uninitialized. Since nothing else updates this status from
         * "undeclared" to any other value, the pipeline chain was
         * permanently broken. "declared" correctly signals that
         * module_scope_declare has been called and the domain is ready.
         */
        atomicUpsertDiscovery({
          pipelineId,
          agent,
          domainId: args.module,
          sessionId,
          dagTaskId: args.task_id || undefined,
          discovery: {
            status: "declared",
            discovered_files: [],
            missing_topics: [],
            discovered_at: new Date().toISOString(),
          },
        });
      } catch (e) {
        /* non-fatal */
      }

      // KC-02 (2026-06-21): Non-fatal audit event for scope declaration
      try {
        pushAuditEvent({
          event: "KC-DECLARATION",
          agent: agent,
          timestamp: new Date().toISOString(),
          detail: `Module scope declared: ${domainId}`,
          task_id: args.task_id,
          domain: domainId,
        });
      } catch {}

      // ── FW-UC7KS-DOMAIN-001-v3: Detect domain mismatch and update session_map DB ──
      // When the dispatch domain_id (from agent_domain_map) differs from
      // the agent's declared module, update session_map DB to use the agent's
      // actual module. This prevents UC7-001 Path B write blocks caused by
      // domain mismatch between dispatch and agent declaration.
      // Fix 1 for docs/review/framework-refactor/uc7ks-write-block-root-cause.md
      try {
        var sessionId = (context && (context as any).sessionID) || "";
        if (sessionId) {
          var dispatchDomainId = resolveDomainId(sessionId);
          if (dispatchDomainId && dispatchDomainId !== domainId) {
            writeLog("module_scope_declare", "WARN", {
              event: "DOMAIN-OVERRIDE",
              detail: `dispatch domain="${dispatchDomainId}" overridden by declare domain="${domainId}"`,
            });
            // Update session_map DB to use agent's actual declared domain
            dbWriteSessionMap(sessionId, agent, undefined, domainId);
          }
        }
      } catch (e) {
        /* Non-fatal: domain update failure should not block task execution */
      }

      // P0-CHECKLIST: wire scope declaration to checklist (normal success path)
      try {
        checklistWirePassed(
          sessionId || "",
          agent,
          taskId,
          "module_scope_declared",
          `domain=${domainId}`,
        );
      } catch {}

      return JSON.stringify({
        domain: domain.domain_id,
        cache_path: "docs/official_docs/" + domain.save_path,
        context7_libraries: domain.context7_libraries,
        fallback_url: domain.fallback_pattern,
        next_step: "Read docs/official_docs/index.json",
      });
    });
  },
});
