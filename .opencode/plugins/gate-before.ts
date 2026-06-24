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
import { isPrivileged } from "../lib/agent-identity";
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

export default withPluginLifecycle("gate-before", {
  "tool.execute.before": toolExecuteBefore,
});

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const mode = getEnforcementMode();

  writeLog("gate-before", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent,
    agentType: agent,
    event: "TOOL-BEFORE",
    detail: `enter | tool=${input.tool} | mode=${mode}`,
  });

  if (mode === "advisory") {
    writeLog("gate-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      agentType: agent,
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
        sessionID: input.sessionID,
        callID: input.callID,
        agent,
        agentType: agent,
        level: "ERROR",
        event: "TOOL-BEFORE",
        detail: `BLOCKED | no armed gate`,
      });
      if (mode === "strict" || mode === "locked") throw new Error(msg);
      return;
    }
    writeLog("gate-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      agentType: agent,
      event: "TOOL-BEFORE",
      detail: `gate armed | id=${session.gateSessionId}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // DELIVERED STATE APPROVAL REMINDER:
  // When Orchestrator uses modify tools and there are gate sessions
  // in 'delivered' state, warn about pending approvals.
  // ═══════════════════════════════════════════════════════════════
  if (isModifyTool(input.tool) && isPrivileged(agent)) {
    try {
      const { dbLoadGateStore } = require("../lib/db-state-manager");
      const store = dbLoadGateStore();
      if (store?.sessions) {
        const pendingApproval = Object.entries(store.sessions)
          .filter(([, ses]: [string, any]) => ses.gate_status === "delivered")
          .map(([sid, ses]: [string, any]) => `${sid}(${ses.agent || "?"})`);
        if (pendingApproval.length > 0) {
          writeLog("gate-before", "WARN", {
            sessionID: input.sessionID,
            callID: input.callID,
            agent,
            agentType: agent,
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
          sessionID: input.sessionID,
          callID: input.callID,
          agent,
          agentType: agent,
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
          sessionID: input.sessionID,
          callID: input.callID,
          agent,
          agentType: agent,
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
          sessionID: input.sessionID,
          callID: input.callID,
          agent,
          agentType: agent,
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
        const contentAfter =
          output?.args?.content || output?.args?.new_content || "";
        const contentBefore = output?.args?.old_content || "";
        const dagContent = contentAfter || contentBefore;

        if (dagContent) {
          try {
            const dag = JSON.parse(dagContent);
            const scopeRules = routeConfig.scope_to_agent.rules;
            const opencodeConfig = readOpencodeConfig();
            const exemptAgents = routeConfig.dispatch_exempt_agents || [];

            for (const task of dag.tasks || []) {
              if (task.status === "completed" || task.status === "skipped")
                continue;
              if (!task.agent || !task.target_files?.length) continue;

              // Skip validation for DAG-exempt agents' own tasks
              const taskAgentNorm = (task.agent || "")
                .replace(/^@/, "")
                .toLowerCase();
              const isExempt = exemptAgents.some(
                (e) => e.replace(/^@/, "").toLowerCase() === taskAgentNorm,
              );
              if (isExempt) continue;

              const result = validateDagTaskAgentAssignment(
                task,
                scopeRules,
                opencodeConfig,
              );
              if (!result.valid) {
                const v = result.violations[0];
                writeLog("gate-before", "runtime", {
                  sessionID: input.sessionID,
                  callID: input.callID,
                  agent,
                  agentType: agent,
                  level: "ERROR",
                  event: "GATE-BEFORE",
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
              sessionID: input.sessionID,
              callID: input.callID,
              agent,
              agentType: agent,
              level: "WARN",
              event: "GATE-BEFORE",
              detail: `DAG parse failed: ${e.message}`,
            });
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // READ-BEFORE-APPROVE-P1: Capture approve_deliverables context
  //
  // Problem: compliance_gate_approve_deliverables is an MCP tool.
  //   The MCP server-side function only receives the compliance gate
  //   session_id (cg_ses_*), NOT the OpenCode sessionID (ses_*).
  //   read_audit records are keyed by opencode_session_id, making
  //   session-bound read verification impossible from the MCP side.
  //
  // Solution: This before-hook captures the approve MCP call at
  //   plugin time (where input.sessionID is available), computes
  //   a stable args_hash, and writes the mapping to the
  //   approval_read_context DB table via approval-read-context.ts.
  //   The MCP side then looks up the context by (gate_session_id,
  //   args_hash) to retrieve the opencode_session_id.
  //
  // Security: Does NOT trust caller-provided agent_id in args.
  //   Uses input.sessionID (set by OpenCode framework, not user).
  //
  // @see approval-read-context.ts
  // @see docs/review/framework-refactor/read-before-approve-e2e-findings.md §8
  // ═══════════════════════════════════════════════════════════════
  if (input.tool === "compliance-gate_compliance_gate_approve_deliverables") {
    try {
      const args = output?.args || {};
      // Compute stable args_hash from the approve parameters
      // Uses the same stable JSON serialization as approval-read-context.ts
      const {
        computeApprovalArgsHash,
      } = require("../lib/approval-read-context");
      const argsHash = computeApprovalArgsHash({
        session_id: args.session_id || "",
        approval_decision: args.approval_decision || "",
        handover_sha256: args.handover_sha256 || "",
        agent_id: args.agent_id || "",
      });

      const { recordApprovalContext } = require("../lib/approval-read-context");
      const recorded = recordApprovalContext(
        args.session_id || "unknown",
        input.sessionID, // OpenCode session ID — authoritative
        input.callID || null,
        agent, // Resolved agent identity
        argsHash,
      );

      writeLog("gate-before", "runtime", {
        sessionID: input.sessionID,
        callID: input.callID,
        agent,
        agentType: agent,
        event: recorded
          ? "APPROVAL_READ_CONTEXT_RECORDED"
          : "APPROVAL_READ_CONTEXT_DUPLICATE",
        detail: `approve_deliverables context captured | gate_session=${args.session_id} | args_hash=${argsHash.substring(0, 16)}... | recorded=${recorded}`,
      });
    } catch (ctxErr: any) {
      // Best-effort: failure here means approve will fall back to
      // session-unbound verification (agent + path + time window).
      // strict/locked mode fail-closed is enforced on the MCP side.
      writeLog("gate-before", "runtime", {
        sessionID: input.sessionID,
        callID: input.callID,
        agent,
        agentType: agent,
        level: "ERROR",
        event: "APPROVAL_READ_CONTEXT_RECORD_FAILED",
        detail: `Failed to capture approve context: ${ctxErr.message}`,
      });
    }
  }

  writeLog("gate-before", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent,
    agentType: agent,
    event: "TOOL-BEFORE",
    detail: "exit (pass)",
  });
}
