import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { tolerantParse } from "../lib/tolerant-json";
import {
  getDomainEntry,
  updateAgentRollups,
  evictOldAgents,
  normalizeAgentKey,
} from "../lib/uc7ks-schema";
import { atomicWriteSubState } from "../lib/state-utils";
import { withInterruptGuard } from "../lib";
import { resolveDomainId } from "../lib/agent-resolver";
import { dbWriteSessionMap } from "../lib/db-state-manager";
import { writeLog } from "../lib/log-manager";
import { pushAuditEvent } from "../lib/knowledge-audit";
import { getDb } from "../lib/db-manager";

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

      // ── Write to knowledge_cache_state.json via CAS (F2: nested per-task-per-domain) ──
      try {
        var taskId = args.task_id || "unknown";
        var domainName = args.module;
        var agentRef = normalizeAgentKey(agent);

        atomicWriteSubState("knowledge_cache_state", function (kcs: any) {
          kcs.session_access = kcs.session_access || {};
          kcs.compliance = kcs.compliance || {};

          // Write to nested domain entry (F2)
          var domainEntry = getDomainEntry(
            kcs.session_access,
            agentRef,
            taskId,
            domainName,
          );
          domainEntry.pipeline_status = "declared";
          domainEntry.declared_at = new Date().toISOString();
          // Preserve any existing cache_sufficiency from prior calls
          if (
            !domainEntry.cache_sufficiency ||
            domainEntry.cache_sufficiency.status === "undeclared"
          ) {
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

        // ════════════════════════════════════════════════════════════
        // KC-12 + A2 (v13 UPSERT): Normalize into v11 typed tables.
        // After writing domain declaration to knowledge_cache_state,
        // also UPSERT into knowledge_session_access v11 table.
        // Non-fatal: DB failure does NOT block scope declaration.
        //
        // A2: Replaced INSERT OR IGNORE with UPSERT using v13 unique
        // index on (agent, task_id, domain_id). ON CONFLICT DO UPDATE
        // with monotonic guard: never downgrade from 'discovered' or
        // 'attested' back to 'declared'. This preserves the highest
        // pipeline status achieved for each agent+task+domain combo.
        // ════════════════════════════════════════════════════════════
        try {
          var db = getDb();
          var sessionId =
            (typeof context !== "undefined" &&
              (context as any) &&
              (context as any).sessionID) ||
            null;
          var now = Date.now();
          db.run(
            `INSERT INTO knowledge_session_access
             (agent, task_id, domain_id, opencode_session_id, status,
              declared_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'declared', ?, ?, ?)
             ON CONFLICT(agent, task_id, domain_id) DO UPDATE SET
               opencode_session_id = excluded.opencode_session_id,
               status = CASE WHEN knowledge_session_access.status = 'declared'
                         THEN 'declared'
                         ELSE knowledge_session_access.status END,
               declared_at = COALESCE(knowledge_session_access.declared_at, excluded.declared_at),
               updated_at = excluded.updated_at`,
            [agentRef, taskId, domainName, sessionId, now, now, now],
          );
          writeLog("module_scope_declare", "INFO", {
            event: "KC12-DB-NORMALIZE",
            detail: "v11 knowledge_session_access INSERT (scope declared)",
            task_id: taskId,
            domain: domainName,
            agent: agentRef,
            session_id: sessionId,
          });
        } catch (dbErr: any) {
          /* Non-fatal: v11 DB write failure does NOT block scope declare */
          writeLog("module_scope_declare", "WARN", {
            event: "KC12-DB-NORMALIZE-FAILED",
            detail: dbErr.message || String(dbErr),
            task_id: taskId,
            domain: domainName,
          });
        }
      } catch (e) {
        /* non-fatal */
      }

      // KC-02 (2026-06-21): Non-fatal audit event for scope declaration
      try {
        pushAuditEvent({
          event: "KC-DECLARATION",
          agent: agent,
          timestamp: new Date().toISOString(),
          detail: `Module scope declared: ${domainName}`,
          task_id: args.task_id,
          domain: domainName,
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
          var dispatchDomain = resolveDomainId(sessionId);
          if (dispatchDomain && dispatchDomain !== domainName) {
            writeLog("module_scope_declare", "WARN", {
              event: "DOMAIN-OVERRIDE",
              detail: `dispatch domain="${dispatchDomain}" overridden by declare domain="${domainName}"`,
            });
            // Update session_map DB to use agent's actual declared domain
            dbWriteSessionMap(sessionId, agent, undefined, domainName);
          }
        }
      } catch (e) {
        /* Non-fatal: domain update failure should not block task execution */
      }

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
