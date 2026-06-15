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

import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent } from "../lib/agent-resolver";
import { getEnforcementMode } from "../lib/gate-core";
import {
  isDagExempt,
  readDispatchPolicy,
} from "../lib/dag-policy";
import { findTaskInDag } from "../lib/gate-checks";

ensureLogDir();
writeLog("dispatch-before", "loaded", {
  event: "PLUGIN-LOADED",
  detail: "dispatch-before.ts (PLAN-FIRST Layer 1)",
});
updateIndex("dispatch-before", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("dispatch-before", "hooks", {
    event: "HOOK-REGISTERED",
    detail: "tool.execute.before (dispatch_subagent) — PLAN-FIRST Layer 1",
  });
  return { "tool.execute.before": dispatchExecuteBefore };
}) as any;

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
