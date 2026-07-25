// service/gate/gate-validate.ts — Gate before-hook validation logic
// Source: gate-before.ts plugin (377L → service extraction)
// All read-only decision logic for modify-tool gate enforcement,
// DAG task audit, DAG write route validation, and approval context capture.

import { writeLog } from "../../lib/log-manager";
import { resolveAgent, resolveTaskId } from "../../lib/agent-resolver";
import {
  findArmedSession,
  createGateSession,
  armGateSession,
} from "../../lib/gate-core";
import { shouldBlock } from "../enforcement/rule-disposition";
import { findTaskInDag } from "../../lib/gate-checks";
import { isDagExempt, readDispatchPolicy } from "../../lib/dag-policy";
import { isPrivileged } from "../../lib/agent-identity";
import { isModifyTool } from "../../lib/tool-scope";
import {
  readRouteConfig,
  readOpencodeConfig,
  validateDagTaskAgentAssignment,
} from "../../lib/route-validator";

const SRC = "service-gate-validate";

// ════════════════════════════════════════════════
// AUTO-ARM (module-level side effect)
// ════════════════════════════════════════════════

/**
 * Auto-arm gate session on OpenCode startup.
 * WHY: pre-commit hook (hook-layers.ts Layer 0) requires an armed gate
 * session before modify-tool flows run. When OpenCode starts and triggers internal
 * git operations, no session exists yet.
 * Called once by gate-before.ts plugin at import time.
 */
export function autoArmGateSession(): void {
  try {
    const existing = findArmedSession();
    if (!existing.found) {
      const { session } = createGateSession(
        "Auto-armed on OpenCode startup",
        [],
        {},
      );
      armGateSession(
        session.session_id,
        "Auto-armed by gate-before plugin on OpenCode startup",
        "framework",
      );
    }
  } catch {
    // Silent failure — never block OpenCode startup
  }
}

// ════════════════════════════════════════════════
// MAIN VALIDATION
// ════════════════════════════════════════════════

export function validateGateBefore(input: any, output: any): { blocked: boolean; message?: string } {
  const agent = resolveAgent(input.sessionID);

  writeLog(SRC, "runtime", {
    sessionID: input.sessionID, 
    callID: input.callID, 
    agent,
    event: "TOOL-BEFORE", detail: `enter | tool=${input.tool}`,
  });



  // ── Gate armed check for modify tools ──
  if (isModifyTool(input.tool)) {
    const session = findArmedSession();
    if (!session) {
      const msg = `[FW-ENFORCE][GATE] No armed compliance gate session. Call compliance_gate_check + compliance_gate_confirm first.\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`;
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent,
        level: "ERROR", event: "TOOL-BEFORE", detail: `BLOCKED | no armed gate`,
      });
      if (shouldBlock("gate-check-block")) return { blocked: true, message: msg };
      return { blocked: false };
    }
    writeLog(SRC, "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent,
      event: "TOOL-BEFORE", detail: `gate armed | id=${session.gateSessionId}`,
    });
  }

  // ── DELIVERED STATE APPROVAL REMINDER ──
  if (isModifyTool(input.tool) && isPrivileged(agent)) {
    try {
      const { dbLoadGateStore } = require("../../lib/db-state-manager");
      const store = dbLoadGateStore();
      if (store?.sessions) {
        const pendingApproval = Object.entries(store.sessions)
          .filter(([, ses]: [string, any]) => ses.gate_status === "delivered")
          .map(([sid, ses]: [string, any]) => `${sid}(${ses.agent || "?"})`);
        if (pendingApproval.length > 0) {
          writeLog(SRC, "WARN", {
            sessionID: input.sessionID, callID: input.callID, agent,
            event: "DELIVERED-PENDING",
            detail: `${pendingApproval.length} session(s) awaiting Orchestrator approval: ${pendingApproval.join(", ")}. Call compliance_gate_approve_deliverables to approve/reject.`,
          });
        }
      }
    } catch { /* non-critical */ }
  }

  // ── P2-1: DAG Task Existence/Status Audit ──
  if (isModifyTool(input.tool)) {
    const taskId = resolveTaskId(input.sessionID);
    const isExempt = isDagExempt(agent);

    if (taskId && !isExempt) {
      const tc = findTaskInDag(taskId);
      if (!tc.found) {
        const dPolicy = readDispatchPolicy();
        writeLog(SRC, "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent,
          level: dPolicy.require_dag_entry ? "ERROR" : "WARN",
          event: "TOOL-BEFORE",
          detail: `${dPolicy.require_dag_entry ? "BLOCKED" : "ADVISORY"} | DAG-TASK-NOT-FOUND | task=${taskId} | require_dag_entry=${dPolicy.require_dag_entry}`,
        });
        if (dPolicy.require_dag_entry) {
          return {
            blocked: true,
            message: `[FW-ENFORCE][DAG] Task "${taskId}" not found in Task.DAG.json ` +
              `(checked both dag.tasks[] and dag.execution_order — neither contains this ID). ` +
              `The FRAMEWORK_TASK_ID passed to dispatch_subagent is treated as a DAG task ID by this audit. ` +
              `Remediation — pick ONE:\n` +
              `  1. Have @plan add "${taskId}" to Task.DAG.json (tasks[] or execution_order group).\n` +
              `  2. If this is a pure dispatch-session ID (not a real DAG task), re-dispatch without setting dag_task_id, ` +
              `or choose a value that does not collide with a non-existent DAG task.\n` +
              `  3. Use a DAG-exempt agent (@Orchestrator / @plan / @Super-Admin) for this dispatch.\n` +
              `See docs/review/cicd-dag-block/diagnosis.md for the full analysis.\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`,
          };
        }
      } else if (tc.status !== "pending" && tc.status !== "in_progress") {
        const dPolicy2 = readDispatchPolicy();
        writeLog(SRC, "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent,
          level: dPolicy2.require_dag_entry ? "ERROR" : "WARN",
          event: "TOOL-BEFORE",
          detail: `${dPolicy2.require_dag_entry ? "BLOCKED" : "ADVISORY"} | DAG-TASK-STATUS | task=${taskId} status=${tc.status} source=${tc.source} | require_dag_entry=${dPolicy2.require_dag_entry}`,
        });
        if (dPolicy2.require_dag_entry) {
          return {
            blocked: true,
            message: `[FW-ENFORCE][DAG] Task "${taskId}" status is "${tc.status}". Expected "pending" or "in_progress".` + `\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`,
          };
        }
      } else {
        writeLog(SRC, "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent,
          event: "TOOL-BEFORE",
          detail: `DAG task verified | task=${taskId} status=${tc.status} source=${tc.source}`,
        });
      }
    }
  }

  // ── ROUTE VALIDATION: DAG task agent ←→ target_files ──
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

              const taskAgentNorm = (task.agent || "").replace(/^@/, "").toLowerCase();
              const isExempt = exemptAgents.some(
                (e) => e.replace(/^@/, "").toLowerCase() === taskAgentNorm,
              );
              if (isExempt) continue;

              const result = validateDagTaskAgentAssignment(task, scopeRules, opencodeConfig);
              if (!result.valid) {
                const v = result.violations[0];
                writeLog(SRC, "runtime", {
                  sessionID: input.sessionID, callID: input.callID, agent,
                  level: "ERROR", event: "GATE-BEFORE",
                  detail: `ROUTE-MISMATCH | DAG task "${task.id}" | assigned=${v.assigned} | file=${v.file} | expected=${v.expected}`,
                });
                if (shouldBlock("gate-check-block")) {
                  return {
                    blocked: true,
                    message: `[FW-ENFORCE][ROUTE-MISMATCH] Task "${task.id}" assigns @${v.assigned} but target_file "${v.file}" → should be @${v.expected}. Fix the DAG entry before committing.\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`,
                  };
                }
              }
            }
          } catch (e: any) {
            if (e.message?.includes("[FW-ENFORCE]")) throw e;
            writeLog(SRC, "runtime", {
              sessionID: input.sessionID, callID: input.callID, agent,
              level: "WARN", event: "GATE-BEFORE", detail: `DAG parse failed: ${e.message}`,
            });
          }
        }
      }
    }
  }

  // ── READ-BEFORE-APPROVE-P1: Capture approve_deliverables context ──
  if (input.tool === "compliance-gate_compliance_gate_approve_deliverables") {
    try {
      const args = output?.args || {};
      const {
        computeApprovalArgsHash,
        buildApprovalArgsHashInput,
      } = require("../../lib/approval-read-context");
      const argsHash = computeApprovalArgsHash(
        buildApprovalArgsHashInput({
          session_id: args.session_id || "",
          approval_decision: args.approval_decision || "",
          handover_sha256: args.handover_sha256 || "",
          agent_id: args.agent_id || "",
        }),
      );

      const { recordApprovalContext } = require("../../lib/approval-read-context");
      const recorded = recordApprovalContext(
        args.session_id || "unknown",
        input.sessionID,
        input.callID || null,
        agent,
        argsHash,
      );

      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent,
        event: recorded ? "APPROVAL_READ_CONTEXT_RECORDED" : "APPROVAL_READ_CONTEXT_DUPLICATE",
        detail: `approve_deliverables context captured | gate_session=${args.session_id} | args_hash=${argsHash.substring(0, 16)}... | recorded=${recorded}`,
      });
    } catch (ctxErr: any) {
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent,
        level: "ERROR", event: "APPROVAL_READ_CONTEXT_RECORD_FAILED",
        detail: `Failed to capture approve context: ${ctxErr.message}`,
      });
    }
  }

  writeLog(SRC, "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent,
    event: "TOOL-BEFORE", detail: "exit (pass)",
  });
  return { blocked: false };
}
