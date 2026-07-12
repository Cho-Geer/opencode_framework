// service/dispatch/dispatch-validate.ts — Dispatch before-hook validation logic
// Source: dispatch-before.ts plugin (583L → service extraction)
// PLAN-FIRST Layer 1: policy-driven dispatch validation with L0-L4 route chain.

import { writeLog } from "../../lib/log-manager";
import {
  resolveAgent,
  resolveCallerIdentity,
  resolveDomainId,
  resolveTaskId,
} from "../../lib/agent-resolver";
import { shouldBlock } from "../enforcement/rule-disposition";
import { isDagExempt, readDispatchPolicy } from "../../lib/dag-policy";
import {
  isPrivileged,
  isKnowledgeCurator as isKC,
  toDisplayName,
} from "../../lib/agent-identity";
import { findTaskInDag } from "../../lib/gate-checks";
import { incrementAuditCounter } from "../../lib/knowledge-audit";
import {
  readRouteConfig,
  readOpencodeConfig,
  l1_verbCandidates,
  l2_scopeFilter,
  l3_permissionFilter,
  l4_heuristicSelect,
  l4_dagCheck,
  isDispatchRouteExempt,
  inferDispatchPurpose,
  l0_purposeFilter,
} from "../../lib/route-validator";

const SRC = "service-dispatch-validate";

/**
 * Format an agent name with a single @ prefix.
 */
function fmtAgent(raw: string): string {
  const name = toDisplayName(raw);
  return name ? "@" + name : "(unknown)";
}

export function validateDispatchBefore(input: any, output: any): { blocked: boolean; message?: string } {
  if (input.tool !== "dispatch_subagent") return { blocked: false };

  const caller = resolveCallerIdentity(input.sessionID) || "";
  const policy = readDispatchPolicy();
  const target = output?.args?.agent_type || "";
  const dagTaskId = output?.args?.dag_task_id || "";
  const autoPlanRequested = output?.args?.auto_plan === true;

  writeLog(SRC, "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent: caller,
    event: "DISPATCH-BEFORE",
    detail: `enter | caller=${caller} | target=${target} | dag_task_id=${dagTaskId || ""} | auto_plan=${autoPlanRequested} | policy.require_dag_entry=${policy.require_dag_entry} | policy.auto_plan_enabled=${policy.auto_plan_enabled}`,
  });

  // PHASE 0 AUDIT: Hard-warning for unresolved caller identity
  if (caller === "CALLER-IDENTITY-UNRESOLVED") {
    writeLog(SRC, "runtime", {
      sessionID: input.sessionID, agent: caller,
      level: "ERROR", event: "CALLER-IDENTITY-UNRESOLVED",
      detail: `Privileged routing attempted with unresolved caller identity | target=${target || "unknown"} | dag_task_id=${dagTaskId || ""}`,
    });
  }

  // ── M14: Sub-agent dispatch target restriction ──
  let m14ApprovedKC = false;
  {
    const isOrchestratorOrSA = isPrivileged(caller);
    const isKCTarget = isKC(target);
    if (!isOrchestratorOrSA && target && !isKCTarget) {
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent: caller,
        level: "ERROR", event: "DISPATCH-TARGET-RESTRICTED",
        detail: `M14 BLOCKED | caller=${caller} is a sub-agent, only target=Knowledge-Curator is allowed. Attempted target=${target}.`,
      });
      if (shouldBlock("dispatch-dag-missing")) {
        return {
          blocked: true,
          message: `[FW-ENFORCE][M14] Sub-agents may only dispatch to @Knowledge-Curator. Caller "${caller}" attempted to target "${target}". To dispatch to @"${target}", route through @Orchestrator.` + `\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`,
        };
      }
    }
    if (isOrchestratorOrSA && isKCTarget) {
      m14ApprovedKC = true;
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent: caller,
        event: "DISPATCH-BEFORE",
        detail: `M14 pass | caller=${caller} (privileged) dispatching to Knowledge-Curator`,
      });
      try { incrementAuditCounter("total_curator_dispatches"); } catch {}
    }
    if (!isOrchestratorOrSA && isKCTarget) {
      m14ApprovedKC = true;
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent: caller,
        event: "DISPATCH-BEFORE",
        detail: `M14 pass | caller=${caller} (sub-agent) dispatching to Knowledge-Curator (allowed per M14)`,
      });
      try { incrementAuditCounter("total_curator_dispatches"); } catch {}
    }
  }

  // ── ROUTE VALIDATION: four-layer chain (L0→L1→L2→L3→L4) ──
  const routeConfig = readRouteConfig();
  if (m14ApprovedKC) {
    writeLog(SRC, "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent: caller,
      event: "DISPATCH-BEFORE",
      detail: `M14 skip-before-route | KC dispatch pre-approved by M14, bypassing L1-L4 route validation`,
    });
  }

  if (routeConfig?.enforcement?.dispatch === "block") {
    if (!isDispatchRouteExempt(caller, routeConfig) && !m14ApprovedKC) {
      const taskDesc = output?.args?.task_description || "";

      // L0: Purpose Inference
      let l1InputCandidates: string[] = [];
      let purposeOverridden = false;
      const purposeRules = routeConfig?.purpose_to_agent?.rules || [];
      const inferredPurpose = inferDispatchPurpose(taskDesc, purposeRules);
      if (inferredPurpose) {
        const l0Result = l0_purposeFilter(
          l1_verbCandidates(taskDesc, routeConfig.verb_to_agent),
          inferredPurpose, purposeRules,
        );
        l1InputCandidates = l0Result.candidates;
        purposeOverridden = l0Result.overridden;
      } else {
        l1InputCandidates = l1_verbCandidates(taskDesc, routeConfig.verb_to_agent);
      }

      if (l1InputCandidates.length > 0) {
        // L2: Scope filter
        let targetFiles: string[] = [];
        if (dagTaskId) {
          const tc = findTaskInDag(dagTaskId);
          if (tc.found && tc.task?.target_files) {
            targetFiles = tc.task.target_files;
          }
        }
        const l2Candidates = l2_scopeFilter(l1InputCandidates, targetFiles, routeConfig.scope_to_agent);

        // L3: Permission filter
        const opencodeConfig = readOpencodeConfig();
        const l3Candidates = targetFiles.length > 0
          ? l3_permissionFilter(l2Candidates, targetFiles, opencodeConfig)
          : l2Candidates;

        // L4: Heuristic Selection
        const domainId = resolveDomainId(input.sessionID) || "";
        const finalAgent = targetFiles.length > 0
          ? l4_heuristicSelect(l3Candidates, targetFiles, domainId)
          : l4_dagCheck(l3Candidates, dagTaskId, isDagExempt);

        // DAG authoritative override
        let dagAuthoritative = false;
        if (dagTaskId && finalAgent && fmtAgent(target) !== finalAgent) {
          try {
            const dagResult = findTaskInDag(dagTaskId);
            if (dagResult.found && dagResult.task?.agent) {
              const dagAgent = dagResult.task.agent.replace(/^@/, "").toLowerCase();
              const targetNorm = fmtAgent(target).replace(/^@/, "").toLowerCase();
              if (dagAgent === targetNorm) {
                dagAuthoritative = true;
              }
            }
          } catch (_) { /* non-fatal */ }
        }

        if (dagAuthoritative) {
          writeLog(SRC, "runtime", {
            sessionID: input.sessionID, callID: input.callID, agent: caller,
            level: "WARN", event: "DISPATCH-BEFORE",
            detail: `DAG-OVERRIDE-ROUTE | task="${taskDesc.substring(0, 120)}" | dag_task_id=${dagTaskId} | target=${fmtAgent(target)} | keyword_selected=${fmtAgent(finalAgent)} | DAG authoritative — allowing dispatch`,
          });
        } else if (finalAgent && fmtAgent(target) !== finalAgent) {
          // No-DAG bypass: DAG-exempt targets (Super-Admin) are always allowed
          const targetIsDagExempt = isDagExempt(target);
          if (targetIsDagExempt) {
            writeLog(SRC, "runtime", {
              sessionID: input.sessionID, callID: input.callID, agent: caller,
              event: "DISPATCH-NO-DAG-EXEMPT",
              detail: `No-DAG bypass | target=${fmtAgent(target)} is DAG-exempt | route_selected=${fmtAgent(finalAgent)} | allowing dispatch`,
            });
          } else {
            writeLog(SRC, "runtime", {
              sessionID: input.sessionID, callID: input.callID, agent: caller,
              level: "ERROR", event: "DISPATCH-BEFORE",
              detail: `ROUTE-MISMATCH | task="${taskDesc.substring(0, 120)}" | dispatched_to=${fmtAgent(target)} | expected=${fmtAgent(finalAgent)} | L1=[${l1InputCandidates.join(",")}] L2=[${l2Candidates.join(",")}] L3=[${l3Candidates.join(",")}]`,
            });
            if (shouldBlock("dispatch-dag-missing")) {
              return {
                blocked: true,
                message: `[FW-ENFORCE][ROUTE-MISMATCH] Child dispatch to ${fmtAgent(target)} is incorrect. Four-layer route: L1(verb) [${l1InputCandidates.join(",")}] → L2(scope) [${l2Candidates.join(",")}] → L3(permission) [${l3Candidates.join(",")}] → Selected: ${fmtAgent(finalAgent)}. Task: "${taskDesc.substring(0, 100)}..."` + `\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`,
              };
            }
          }
        }
      }
    }
  }

  // ── F5: DAG-exempt bypass (MUST be before GATE-APPROVAL-LOCK) ──
  if (isDagExempt(target)) {
    writeLog(SRC, "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent: caller,
      event: "DISPATCH-BEFORE",
      detail: `exit (pass) | target @${target} is DAG-exempt (pre-lock bypass)`,
    });
    return { blocked: false };
  }

  // ── GATE-APPROVAL-LOCK-v2 ──
  {
    let blockingSessions: string[] = [];
    try {
      const { getDb } = require("../../lib/db-manager");
      const db = getDb();
      if (db) {
        const { readGateStaleThreshold } = require("../../lib/gate-stale");
        const deliveredHours = readGateStaleThreshold("delivered_hours");
        const approvedHours = readGateStaleThreshold("approved_hours");
        const now = Date.now();
        const deliveredCutoff = now - deliveredHours * 3600000;
        const approvedCutoff = now - approvedHours * 3600000;

        const callerSession = input.sessionID;
        const callerTask = resolveTaskId(input.sessionID) || null;
        const callerAgent = caller || null;

        const rows = db.query(`
          SELECT session_id, task_id, agent, status
          FROM gate_sessions
          WHERE status IN ('delivered', 'approved')
            AND consumed_at IS NULL
            AND (
              (status = 'delivered' AND updated_at > ?)
              OR (status = 'approved' AND updated_at > ?)
            )
            AND (
              ? IS NOT NULL AND task_id = ?
              OR ? IS NOT NULL AND agent = ?
              OR ? IS NOT NULL AND session_id = ?
            )
        `).all(
          deliveredCutoff, approvedCutoff,
          callerTask, callerTask,
          callerAgent, callerAgent,
          callerSession, callerSession,
        ) as Array<{ session_id: string; status: string; task_id: string; agent: string }>;

        blockingSessions = rows.map((r: any) => r.session_id);
      }
    } catch (e: any) {
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent: caller,
        level: "ERROR", event: "GATE-APPROVAL-LOCK-QUERY-FAILED",
        detail: e.message?.substring(0, 300),
      });
    }

    if (blockingSessions.length > 0) {
      const msg =
        `[FW-ENFORCE][GATE-APPROVAL-LOCK-v2] Cannot dispatch — ` +
        `${blockingSessions.length} related session(s) awaiting approval: ` +
        `${blockingSessions.join(", ")}. ` +
        `Call compliance_gate_approve_deliverables or compliance_gate_bulk_review_deliverables.\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`;
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent: caller,
        level: "ERROR", event: "GATE-APPROVAL-LOCK",
        detail: `BLOCKED-v2 | scope=related | ${blockingSessions.length} related sessions: ${blockingSessions.join(", ")}`,
      });
      if (shouldBlock("dispatch-dag-missing")) {
        return { blocked: true, message: msg };
      }
    }
  }

  // ── P6/S26: Resume path bypass ──
  if (output?.args?.resume_session_id) {
    writeLog(SRC, "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent: caller,
      event: "DISPATCH-BEFORE",
      detail: `exit (pass) | RESUME dispatch | resume_session_id=${output.args.resume_session_id}`,
    });
    return { blocked: false };
  }

  if (!policy.require_dag_entry) {
    writeLog(SRC, "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent: caller,
      level: "WARN", event: "DISPATCH-BEFORE",
      detail: `exit (pass) | dispatch_policy.require_dag_entry=false (rollout observation mode)`,
    });
    return { blocked: false };
  }

  if (!shouldBlock("dispatch-dag-missing")) {
    if (!dagTaskId) {
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent: caller,
        level: "WARN", event: "DISPATCH-BEFORE",
        detail: `exit (pass, audit-only) | dag_task_id empty but target @${target} is non-exempt`,
      });
    } else {
      const tc = findTaskInDag(dagTaskId);
      if (!tc.found) {
        writeLog(SRC, "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent: caller,
          level: "WARN", event: "DISPATCH-BEFORE",
          detail: `exit (pass, audit-only) | dag_task_id=${dagTaskId} NOT in DAG while dispatch-dag-missing is non-blocking`,
        });
      }
    }
    return { blocked: false };
  }

  // PLAN-FIRST: dag_task_id required
  if (!dagTaskId) {
    writeLog(SRC, "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent: caller,
      level: "ERROR", event: "DISPATCH-BEFORE",
      detail: `BLOCKED | PLAN-FIRST | target @${target} non-exempt, dag_task_id empty`,
    });
    return {
      blocked: true,
      message: `[FW-ENFORCE][PLAN-FIRST][LAYER-1] Child dispatch to ${target} requires a dag_task_id that exists in Task.DAG.json (dispatch_policy.require_dag_entry=true). Either provide a planned DAG ID, or set auto_plan=true to let the framework plan automatically (requires dispatch_policy.auto_plan_enabled=true), or dispatch @plan first to plan the task.` + `\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`,
    };
  }

  const tc = findTaskInDag(dagTaskId);
  if (!tc.found) {
    if (autoPlanRequested && !policy.auto_plan_enabled) {
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent: caller,
        level: "ERROR", event: "DISPATCH-BEFORE",
        detail: `BLOCKED | PLAN-FIRST | auto_plan=true but policy.auto_plan_enabled=false | dag_task_id=${dagTaskId} not in DAG`,
      });
      return {
        blocked: true,
        message: `[FW-ENFORCE][PLAN-FIRST][LAYER-1] auto_plan=true was set but dispatch_policy.auto_plan_enabled=false in project.config.json. Self-healing is blocked during rollout. ACTION: dispatch @plan to add "${dagTaskId}" to Task.DAG.json, then re-dispatch with the same dag_task_id.` + `\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`,
      };
    }
    if (autoPlanRequested && policy.auto_plan_enabled) {
      writeLog(SRC, "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent: caller,
        level: "WARN", event: "DISPATCH-BEFORE",
        detail: `exit (pass, deferring to Layer 2) | dag_task_id=${dagTaskId} NOT in DAG; auto_plan=true requested, Layer 2 will attempt self-healing`,
      });
      return { blocked: false };
    }
    writeLog(SRC, "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent: caller,
      level: "ERROR", event: "DISPATCH-BEFORE",
      detail: `BLOCKED | PLAN-FIRST | dag_task_id=${dagTaskId} not in DAG (searched tasks[] and execution_order)`,
    });
    return {
      blocked: true,
      message: `[FW-ENFORCE][PLAN-FIRST][LAYER-1] dag_task_id "${dagTaskId}" not found in Task.DAG.json (checked both dag.tasks[] and dag.execution_order). Dispatch @plan first to plan the task, or set auto_plan=true (requires dispatch_policy.auto_plan_enabled=true).` + `\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`,
    };
  }

  if (tc.status !== "pending" && tc.status !== "in_progress") {
    writeLog(SRC, "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent: caller,
      level: "ERROR", event: "DISPATCH-BEFORE",
      detail: `BLOCKED | PLAN-FIRST | dag_task_id=${dagTaskId} status=${tc.status} (expected pending/in_progress)`,
    });
    return {
      blocked: true,
      message: `[FW-ENFORCE][PLAN-FIRST][LAYER-1] dag_task_id "${dagTaskId}" has status "${tc.status}"; expected "pending" or "in_progress".` + `\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`,
    };
  }

  writeLog(SRC, "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent: caller,
    event: "DISPATCH-BEFORE",
    detail: `exit (pass) | PLAN-FIRST verified | dag_task_id=${dagTaskId} status=${tc.status} source=${tc.source}`,
  });
  return { blocked: false };
}
