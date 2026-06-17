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
  extractScopePatterns,
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

  // ── ROUTE VALIDATION: four-layer chain (L1 Verb → L2 Scope → L3 Permission → L4 DAG) ──
  const routeConfig = readRouteConfig();
  if (routeConfig?.enforcement?.dispatch === "block") {
    // REVISED: Orchestrator/Meta-Planner/Super-Admin exempt — professional judgment authority
    if (!isDispatchRouteExempt(caller, routeConfig)) {
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

        // L3: Permission → Veto
        const scopes = extractScopePatterns(
          targetFiles.length > 0 ? targetFiles : [taskDesc],
          routeConfig.scope_to_agent.rules,
        );
        const opencodeConfig = readOpencodeConfig();
        const l3Candidates = l3_permissionFilter(l2Candidates, scopes, opencodeConfig);

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
