// dispatch-before.ts — "tool.execute.before" plugin: PLAN-FIRST Layer 1
// =======================================================================
// Intercepts dispatch_subagent tool calls and enforces the PLAN-FIRST
// dispatch policy defined in project.config.json.dispatch_policy.
//
// FW-PLAN-FIRST (2026-06-14): Layer 1 of a 3-layer defense-in-depth stack:
//   Layer 1 — this plugin (policy-driven; rejects non-compliant dispatches
//             BEFORE the tool runs; can be relaxed by config).
//   Layer 2 — dispatch_subagent.ts pre-flight (unconditional code; runs
//             findTaskInDag() regardless of config; triggers auto_plan
//             if requested).
//   Layer 3 — gate-before.ts P2-1 DAG audit at modify-tool time (unchanged;
//             remains the authoritative backstop).
//
// Any one layer is sufficient; three make the constraint robust against
// future changes in any single component.
//
// @author @Super-Admin (framework architect)
// @since 2026-06-14

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { getEnforcementMode } from "../lib/gate-core";
import {
  isDagExempt,
  readDispatchPolicy,
} from "../lib/dag-policy";
import { findTaskInDag } from "../lib/gate-checks";
import {
  readRouteConfig,
  readOpencodeConfig,
  l1_verbCandidates,
  l2_scopeFilter,
  l3_permissionFilter,
  l4_dagCheck,
  isDispatchRouteExempt,
} from "../lib/route-validator";

export default withPluginLifecycle("dispatch-before", { "tool.execute.before": dispatchExecuteBefore });

async function dispatchExecuteBefore(input: any, output: any): Promise<void> {
  if (input.tool !== "dispatch_subagent") return;

  const caller = resolveAgent(input.sessionID) || "";
  const mode = getEnforcementMode();
  const policy = readDispatchPolicy();
  const target = output?.args?.agent_type || "";
  const dagTaskId = output?.args?.dag_task_id || "";
  const autoPlanRequested = output?.args?.auto_plan === true;

  writeLog("dispatch-before", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent: caller,
    agentType: caller,
    event: "DISPATCH-BEFORE",
    detail:
      `enter | caller=${caller} | target=${target} ` +
      `| dag_task_id=${dagTaskId || ""} ` +
      `| auto_plan=${autoPlanRequested} | mode=${mode} ` +
      `| policy.require_dag_entry=${policy.require_dag_entry} ` +
      `| policy.auto_plan_enabled=${policy.auto_plan_enabled}`,
  });

  // ── M14: Sub-agent dispatch target restriction ──────────────────
  // Sub-agents (non-Orchestrator, non-Super-Admin) may only target
  // @Knowledge-Curator for direct knowledge acquisition without routing
  // through @Orchestrator. This enables the UC7KS cache-insufficiency
  // self-healing flow (M9 → M14).
  // @since 2026-06-19 — M14
  //
  // FW-FIX-M14-ROUTE-BYPASS-001 (2026-06-19): m14ApprovedKC flag tracks
  // whether M14 has already approved a Knowledge-Curator dispatch. When
  // set, the downstream L1-L4 route validation is skipped to prevent
  // ROUTE-MISMATCH from overriding M14's approval. Without this fix,
  // M14 says "M14 pass" but then route validation selects a different
  // agent (e.g. @Architect) and throws ROUTE-MISMATCH.
  let m14ApprovedKC = false;
  {
    const isOrchestratorOrSA = (
      caller === "Orchestrator" || caller === "@Orchestrator" ||
      caller === "Super-Admin" || caller === "@Super-Admin"
    );
    const isKCTarget = (
      target === "Knowledge-Curator" || target === "@Knowledge-Curator"
    );
    if (!isOrchestratorOrSA && target && !isKCTarget) {
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID,
        agent: caller, agentType: caller,
        level: "ERROR",
        event: "DISPATCH-TARGET-RESTRICTED",
        detail: `M14 BLOCKED | caller=${caller} is a sub-agent, only target=Knowledge-Curator is allowed. Attempted target=${target}.`,
      });
      if (mode === "strict" || mode === "locked") {
        throw new Error(
          `[FW-ENFORCE][M14] Sub-agents may only dispatch to @Knowledge-Curator. ` +
          `Caller "${caller}" attempted to target "${target}". ` +
          `To dispatch to @"${target}", route through @Orchestrator.`,
        );
      }
    }
    if (isOrchestratorOrSA && isKCTarget) {
      m14ApprovedKC = true;
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID,
        agent: caller, agentType: caller,
        event: "DISPATCH-BEFORE",
        detail: `M14 pass | caller=${caller} (privileged) dispatching to Knowledge-Curator`,
      });
    }
    if (!isOrchestratorOrSA && isKCTarget) {
      m14ApprovedKC = true;
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID,
        agent: caller, agentType: caller,
        event: "DISPATCH-BEFORE",
        detail: `M14 pass | caller=${caller} (sub-agent) dispatching to Knowledge-Curator (allowed per M14)`,
      });
    }
  }

  // ── ROUTE VALIDATION: four-layer chain (L1 Verb → L2 Scope → L3 Permission → L4 DAG) ──
  // FW-FIX-M14-ROUTE-BYPASS-001: when M14 has already approved a Knowledge-Curator
  // dispatch, skip L1-L4 route validation entirely. M14 is the higher-authority
  // approval — route validation must not override it with ROUTE-MISMATCH.
  const routeConfig = readRouteConfig();
  if (m14ApprovedKC) {
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID,
      agent: caller, agentType: caller,
      event: "DISPATCH-BEFORE",
      detail: `M14 skip-before-route | KC dispatch pre-approved by M14, bypassing L1-L4 route validation`,
    });
  }
  if (routeConfig?.enforcement?.dispatch === "block") {
    // REVISED: Orchestrator/Meta-Planner/Super-Admin exempt — professional judgment authority
    // FW-FIX-M14-ROUTE-BYPASS-001: also skip route when M14 has approved the KC dispatch
    if (!isDispatchRouteExempt(caller, routeConfig) && !m14ApprovedKC) {
      const taskDesc = output?.args?.task_description || "";

      // L1: Verb → Candidate Pool
      const l1Candidates = l1_verbCandidates(taskDesc, routeConfig.verb_to_agent);
      if (l1Candidates.length > 0) {
        // REVISED: L2 uses Task.DAG.json target_files[] when dag_task_id available
        let targetFiles: string[] = [];
        if (dagTaskId) {
          const tc = findTaskInDag(dagTaskId);
          if (tc.found && tc.task?.target_files) {
            targetFiles = tc.task.target_files;
          }
        }

        const l2Candidates = l2_scopeFilter(l1Candidates, targetFiles, routeConfig.scope_to_agent);

        // L3: Permission → Veto (P2-D v2.1: real target_files + pathMatchesGlob)
        // L3 receives concrete target files (not route-scope fragments) and applies
        // safe_edit glob matching via pathMatchesGlob(). If no concrete files are
        // available, skip L3 veto and rely on PLAN-FIRST/DAG enforcement.
        const opencodeConfig = readOpencodeConfig();
        const l3Candidates = targetFiles.length > 0
          ? l3_permissionFilter(l2Candidates, targetFiles, opencodeConfig)
          : l2Candidates; // no concrete files: skip L3 veto, rely on PLAN-FIRST/DAG

        // L4: DAG (selection step)
        const finalAgent = l4_dagCheck(l3Candidates, dagTaskId, isDagExempt);

        if (finalAgent && target !== finalAgent) {
          writeLog("dispatch-before", "runtime", {
            sessionID: input.sessionID, callID: input.callID,
            agent: caller, agentType: caller,
            level: "ERROR",
            event: "DISPATCH-BEFORE",
            detail:
              `ROUTE-MISMATCH | task="${taskDesc.substring(0, 120)}" | ` +
              `dispatched_to=${target} | expected=${finalAgent} | ` +
              `L1=[${l1Candidates.join(",")}] L2=[${l2Candidates.join(",")}] ` +
              `L3=[${l3Candidates.join(",")}]`,
          });
          if (mode === "strict" || mode === "locked") {
            throw new Error(
              `[FW-ENFORCE][ROUTE-MISMATCH] dispatch_subagent to @${target} is incorrect. ` +
              `Four-layer route: L1(verb) [${l1Candidates.join(",")}] → ` +
              `L2(scope) [${l2Candidates.join(",")}] → ` +
              `L3(permission) [${l3Candidates.join(",")}] → ` +
              `Selected: @${finalAgent}. ` +
              `Task: "${taskDesc.substring(0, 100)}..."`,
            );
          }
        }
      }
    }
  }

  // ── GATE-APPROVAL-LOCK: Block new dispatches if unapproved sessions exist ──
  // Queries the gate_sessions DB table (not gate-state.json — sessions are now
  // stored in SQLite DB as of v6 migration). Prevents Orchestrator from
  // dispatching when previously delivered sessions await approval.
  {
    let deliveredSessions: string[] = [];
    try {
      const { getDb } = require("../lib/db-manager");
      const db = getDb();
      if (db) {
        const rows = db.query(
          "SELECT session_id FROM gate_sessions WHERE status = ?"
        ).all("delivered") as Array<{ session_id: string }>;
        deliveredSessions = rows.map((r: any) => r.session_id);
      }
    } catch {}

    if (deliveredSessions.length > 0) {
      const msg =
        `[FW-ENFORCE][GATE-APPROVAL-LOCK] Cannot dispatch new sub-agent — ` +
        `${deliveredSessions.length} session(s) awaiting deliverables approval: ` +
        `${deliveredSessions.join(", ")}. ` +
        `Call compliance_gate_approve_deliverables(session_id, "approve") first.`;
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID,
        agent: caller, agentType: caller,
        level: "ERROR",
        event: "GATE-APPROVAL-LOCK",
        detail: `BLOCKED | ${deliveredSessions.length} unapproved sessions: ${deliveredSessions.join(", ")}`,
      });
      if (mode === "strict" || mode === "locked") {
        throw new Error(msg);
      }
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID, callID: input.callID,
        agent: caller, agentType: caller,
        level: "WARN",
        event: "GATE-APPROVAL-LOCK",
        detail: `advisory mode — ${deliveredSessions.length} unapproved but allowed`,
      });
    }
  }

  if (isDagExempt(target)) {
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent: caller,
      agentType: caller,
      event: "DISPATCH-BEFORE",
      detail: `exit (pass) | target @${target} is DAG-exempt`,
    });
    return;
  }

  // ── P6/S26: Resume path bypass ──
  // When resume_session_id is provided, this is a resume dispatch (not a new task).
  // Skip DAG existence check — the task was already planned in the original session.
  if (output?.args?.resume_session_id) {
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent: caller,
      agentType: caller,
      event: "DISPATCH-BEFORE",
      detail: `exit (pass) | RESUME dispatch | resume_session_id=${output.args.resume_session_id}`,
    });
    return;
  }

  if (!policy.require_dag_entry) {
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent: caller,
      agentType: caller,
      level: "WARN",
      event: "DISPATCH-BEFORE",
      detail:
        `exit (pass) | dispatch_policy.require_dag_entry=false (rollout observation mode)`,
    });
    return;
  }

  if (mode === "advisory") {
    if (!dagTaskId) {
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID,
        callID: input.callID,
        agent: caller,
        agentType: caller,
        level: "WARN",
        event: "DISPATCH-BEFORE",
        detail: `exit (pass, advisory) | dag_task_id empty but target @${target} is non-exempt`,
      });
    } else {
      const tc = findTaskInDag(dagTaskId);
      if (!tc.found) {
        writeLog("dispatch-before", "runtime", {
          sessionID: input.sessionID,
          callID: input.callID,
          agent: caller,
          agentType: caller,
          level: "WARN",
          event: "DISPATCH-BEFORE",
          detail:
            `exit (pass, advisory) | dag_task_id=${dagTaskId} NOT in DAG (would block in strict/locked)`,
        });
      }
    }
    return;
  }

  if (!dagTaskId) {
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent: caller,
      agentType: caller,
      level: "ERROR",
      event: "DISPATCH-BEFORE",
      detail: `BLOCKED | PLAN-FIRST | target @${target} non-exempt, dag_task_id empty`,
    });
    throw new Error(
      `[FW-ENFORCE][PLAN-FIRST][LAYER-1] dispatch_subagent to ${target} ` +
        `requires a dag_task_id that exists in Task.DAG.json ` +
        `(dispatch_policy.require_dag_entry=true, mode=${mode}). ` +
        `Either provide a planned DAG ID, or set auto_plan=true to let the ` +
        `framework plan automatically (requires dispatch_policy.auto_plan_enabled=true), ` +
        `or dispatch @Meta-Planner first to plan the task.`,
    );
  }

  const tc = findTaskInDag(dagTaskId);
  if (!tc.found) {
    if (autoPlanRequested && !policy.auto_plan_enabled) {
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID,
        callID: input.callID,
        agent: caller,
        agentType: caller,
        level: "ERROR",
        event: "DISPATCH-BEFORE",
        detail:
          `BLOCKED | PLAN-FIRST | auto_plan=true but policy.auto_plan_enabled=false | ` +
          `dag_task_id=${dagTaskId} not in DAG`,
      });
      throw new Error(
        `[FW-ENFORCE][PLAN-FIRST][LAYER-1] auto_plan=true was set but ` +
          `dispatch_policy.auto_plan_enabled=false in project.config.json. ` +
          `Self-healing is blocked during rollout. ` +
          `ACTION: dispatch @Meta-Planner to add "${dagTaskId}" to Task.DAG.json, ` +
          `then re-dispatch with the same dag_task_id.`,
      );
    }
    if (autoPlanRequested && policy.auto_plan_enabled) {
      writeLog("dispatch-before", "runtime", {
        sessionID: input.sessionID,
        callID: input.callID,
        agent: caller,
        agentType: caller,
        level: "WARN",
        event: "DISPATCH-BEFORE",
        detail:
          `exit (pass, deferring to Layer 2) | dag_task_id=${dagTaskId} NOT in DAG; ` +
          `auto_plan=true requested, Layer 2 will attempt self-healing`,
      });
      return;
    }
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent: caller,
      agentType: caller,
      level: "ERROR",
      event: "DISPATCH-BEFORE",
      detail:
        `BLOCKED | PLAN-FIRST | dag_task_id=${dagTaskId} not in DAG (searched tasks[] and execution_order)`,
    });
    throw new Error(
      `[FW-ENFORCE][PLAN-FIRST][LAYER-1] dag_task_id "${dagTaskId}" not found ` +
        `in Task.DAG.json (checked both dag.tasks[] and dag.execution_order). ` +
        `Dispatch @Meta-Planner first to plan the task, or set auto_plan=true ` +
        `(requires dispatch_policy.auto_plan_enabled=true).`,
    );
  }

  if (tc.status !== "pending" && tc.status !== "in_progress") {
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent: caller,
      agentType: caller,
      level: "ERROR",
      event: "DISPATCH-BEFORE",
      detail:
        `BLOCKED | PLAN-FIRST | dag_task_id=${dagTaskId} status=${tc.status} (expected pending/in_progress)`,
    });
    throw new Error(
      `[FW-ENFORCE][PLAN-FIRST][LAYER-1] dag_task_id "${dagTaskId}" has status ` +
        `"${tc.status}"; expected "pending" or "in_progress".`,
    );
  }

  writeLog("dispatch-before", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent: caller,
    agentType: caller,
    event: "DISPATCH-BEFORE",
    detail:
      `exit (pass) | PLAN-FIRST verified | dag_task_id=${dagTaskId} ` +
      `status=${tc.status} source=${tc.source}`,
  });
}
