// gate-before.ts — "tool.execute.before" plugin: gate & DAG enforcement
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent, resolveTaskId } from "../lib/agent-resolver";
import {
  getEnforcementMode,
  findArmedSession,
  createSession,
  armSession,
} from "../lib/gate-core";
import { findTaskInDag } from "../lib/gate-checks";
import { isDagExempt, readDispatchPolicy } from "../lib/dag-policy";
import { isModifyTool } from "../lib/tool-scope";
import {
  readRouteConfig,
  readOpencodeConfig,
  validateDagTaskAgentAssignment,
} from "../lib/route-validator";

// ── Solution 2: Auto-arm gate session on OpenCode startup ──
// WHY: The pre-commit hook (hook-layers.ts Layer 0) requires an armed gate
// session in strict/locked mode. When OpenCode starts and triggers internal
// git operations, no session exists yet. This module-top-level code runs at
// import time (before any hooks fire), ensuring a session is always available.
try {
  const existing = findArmedSession();
  if (!existing.found) {
    const mode = getEnforcementMode();
    const { session } = createSession(
      "Auto-armed on OpenCode startup",
      [],
      {},
      mode,
    );
    armSession(
      session.session_id,
      "Auto-armed by gate-before plugin on OpenCode startup",
      "framework",
    );
  }
} catch {
  // Silent failure — never block OpenCode startup
}

export default withPluginLifecycle("gate-before", { "tool.execute.before": toolExecuteBefore });

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const mode = getEnforcementMode();

  writeLog("gate-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-BEFORE",
    detail: `enter | tool=${input.tool} | mode=${mode}`,
  });

  if (mode === "advisory") {
    writeLog("gate-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: "exit (skip) advisory mode",
    });
    return;
  }

  // Gate armed check for modify tools.
  // WHY: Previously used a hardcoded regex that omitted safe_shell, allowing
  // compliance gate bypass. Now uses isModifyTool() from tool-scope.ts which
  // correctly includes all 6 modify tools (write, edit, safe_edit, safe_mkdir,
  // safe_delete, safe_shell). See tdd-integration.md §3 for bug analysis.
  if (isModifyTool(input.tool)) {
    const session = findArmedSession();
    if (!session) {
      const msg = `[FW-ENFORCE][GATE] No armed compliance gate session. Call compliance_gate_check + compliance_gate_confirm first.`;
      writeLog("gate-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR",
        event: "TOOL-BEFORE",
        detail: `BLOCKED | no armed gate`,
      });
      if (mode === "strict" || mode === "locked") throw new Error(msg);
      return;
    }
    writeLog("gate-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: `gate armed | id=${session.sessionId}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // DELIVERED STATE APPROVAL REMINDER:
  // When Orchestrator uses modify tools and there are gate sessions
  // in 'delivered' state, warn about pending approvals.
  // ═══════════════════════════════════════════════════════════════
  if (isModifyTool(input.tool) && (agent === "Orchestrator" || agent === "@Orchestrator")) {
    try {
      const { dbLoadGateStore } = require("../lib/db-state-manager");
      const store = dbLoadGateStore();
      if (store?.sessions) {
        const pendingApproval = Object.entries(store.sessions)
          .filter(([, ses]: [string, any]) => ses.gate_status === "delivered")
          .map(([sid, ses]: [string, any]) => `${sid}(${ses.agent || "?"})`);
        if (pendingApproval.length > 0) {
          writeLog("gate-before", "WARN", {
            sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
            event: "DELIVERED-PENDING",
            detail: `${pendingApproval.length} session(s) awaiting Orchestrator approval: ${pendingApproval.join(", ")}. Call compliance_gate_approve_deliverables to approve/reject.`,
          });
        }
      }
    } catch {
      /* non-critical */
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // P2-1: DAG Task Existence/Status Audit
  // Migrated from enforce.ts L1331–1356
  //
  // Verifies that the current task ID exists in Task.DAG.json and
  // has a valid status (pending or in_progress).
  //
  // Exempt: @Meta-Planner (creates DAG), @Orchestrator (manages DAG).
  // Scoped: isModifyTool() only — read operations exempt per
  // FW-FIX-DAG-SCOPE-01.
  // ═══════════════════════════════════════════════════════════════
  if (isModifyTool(input.tool)) {
    const taskId = resolveTaskId(input.sessionID);
    // FW-PLAN-FIRST (2026-06-14): Canonical DAG-exempt list in lib/dag-policy.ts.
    // Members: meta-planner, orchestrator, super-admin, knowledge-curator.
    const isExempt = isDagExempt(agent);

    if (taskId && !isExempt) {
      const tc = findTaskInDag(taskId);
      if (!tc.found) {
        /**
         * FW-FIX-CONFIG-DAG-02: Read dispatch_policy.require_dag_entry instead of
         * hardcoded enforcement mode checks. This allows the DAG audit to be
         * independently controlled via project.config.json regardless of the
         * enforcement mode. Aligns with dispatch-before.ts and dispatch_subagent.ts
         * which already use readDispatchPolicy().require_dag_entry.
         */
        const dPolicy = readDispatchPolicy();
        writeLog("gate-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: dPolicy.require_dag_entry ? "ERROR" : "WARN",
          event: "TOOL-BEFORE",
          detail: `${dPolicy.require_dag_entry ? "BLOCKED" : "ADVISORY"} | DAG-TASK-NOT-FOUND | task=${taskId} | require_dag_entry=${dPolicy.require_dag_entry}`,
        });
        if (dPolicy.require_dag_entry) {
          throw new Error(
            `[FW-ENFORCE][DAG] Task "${taskId}" not found in Task.DAG.json ` +
              `(checked both dag.tasks[] and dag.execution_order — neither contains this ID). ` +
              `The FRAMEWORK_TASK_ID passed to dispatch_subagent is treated as a DAG task ID by this audit. ` +
              `Remediation — pick ONE:\n` +
              `  1. Have @Meta-Planner add "${taskId}" to Task.DAG.json (tasks[] or execution_order group).\n` +
              `  2. If this is a pure dispatch-session ID (not a real DAG task), re-dispatch without setting dag_task_id, ` +
              `or choose a value that does not collide with a non-existent DAG task.\n` +
              `  3. Use a DAG-exempt agent (@Orchestrator / @Meta-Planner / @Super-Admin) for this dispatch.\n` +
              `See docs/review/cicd-dag-block/diagnosis.md for the full analysis.`,
          );
        }
      } else if (tc.status !== "pending" && tc.status !== "in_progress") {
        const dPolicy2 = readDispatchPolicy();
        writeLog("gate-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: dPolicy2.require_dag_entry ? "ERROR" : "WARN",
          event: "TOOL-BEFORE",
          detail: `${dPolicy2.require_dag_entry ? "BLOCKED" : "ADVISORY"} | DAG-TASK-STATUS | task=${taskId} status=${tc.status} source=${tc.source} | require_dag_entry=${dPolicy2.require_dag_entry}`,
        });
        if (dPolicy2.require_dag_entry) {
          throw new Error(
            `[FW-ENFORCE][DAG] Task "${taskId}" status is "${tc.status}". ` +
            `Expected "pending" or "in_progress".`,
          );
        }
      } else {
        writeLog("gate-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          event: "TOOL-BEFORE",
          detail: `DAG task verified | task=${taskId} status=${tc.status} source=${tc.source}`,
        });
      }
    }
  }

  // ── ROUTE VALIDATION: DAG task agent ←→ target_files (L2 Scope + L3 Permission) ──
  // Validates that Task.DAG.json task.agent assignments match scope_to_agent rules.
  // Only runs when a modify tool is writing to Task.DAG.json.
  if (isModifyTool(input.tool)) {
    const filePath = output?.args?.file_path || output?.args?.path || "";
    if (filePath === "Task.DAG.json" || filePath.endsWith("/Task.DAG.json")) {
      const routeConfig = readRouteConfig();
      if (routeConfig?.enforcement?.dag_write === "block") {
        const contentAfter = output?.args?.content || output?.args?.new_content || "";
        const contentBefore = output?.args?.old_content || "";
        const dagContent = contentAfter || contentBefore;

        if (dagContent) {
          try {
            const dag = JSON.parse(dagContent);
            const scopeRules = routeConfig.scope_to_agent.rules;
            const opencodeConfig = readOpencodeConfig();
            const exemptAgents = routeConfig.dispatch_exempt_agents || [];

            for (const task of dag.tasks || []) {
              if (task.status === "completed" || task.status === "skipped") continue;
              if (!task.agent || !task.target_files?.length) continue;

              // Skip validation for DAG-exempt agents' own tasks
              const taskAgentNorm = (task.agent || "").replace(/^@/, "").toLowerCase();
              const isExempt = exemptAgents.some((e) =>
                e.replace(/^@/, "").toLowerCase() === taskAgentNorm
              );
              if (isExempt) continue;

              const result = validateDagTaskAgentAssignment(task, scopeRules, opencodeConfig);
              if (!result.valid) {
                const v = result.violations[0];
                writeLog("gate-before", "runtime", {
                  sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
                  level: "ERROR", event: "GATE-BEFORE",
                  detail:
                    `ROUTE-MISMATCH | DAG task "${task.id}" | ` +
                    `assigned=${v.assigned} | file=${v.file} | expected=${v.expected}`,
                });
                if (mode === "strict" || mode === "locked") {
                  throw new Error(
                    `[FW-ENFORCE][ROUTE-MISMATCH] Task "${task.id}" assigns ` +
                    `@${v.assigned} but target_file "${v.file}" → should be @${v.expected}. ` +
                    `Fix the DAG entry before committing.`,
                  );
                }
              }
            }
          } catch (e) {
            if (e.message?.includes("[FW-ENFORCE]")) throw e;
            writeLog("gate-before", "runtime", {
              sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
              level: "WARN", event: "GATE-BEFORE",
              detail: `DAG parse failed: ${e.message}`,
            });
          }
        }
      }
    }
  }

  writeLog("gate-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-BEFORE",
    detail: "exit (pass)",
  });
}
