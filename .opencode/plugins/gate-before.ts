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
import { isDagExempt } from "../lib/dag-policy";
import { isModifyTool } from "../lib/tool-scope";

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
    const taskId = resolveTaskId();
    // FW-PLAN-FIRST (2026-06-14): Canonical DAG-exempt list in lib/dag-policy.ts.
    // Members: meta-planner, orchestrator, super-admin, knowledge-curator.
    const isExempt = isDagExempt(agent);

    if (taskId && !isExempt) {
      const tc = findTaskInDag(taskId);
      if (!tc.found) {
        writeLog("gate-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "WARN",
          event: "TOOL-BEFORE",
          detail: `BLOCKED | DAG-TASK-NOT-FOUND | task=${taskId} (searched both dag.tasks[] and dag.execution_order)`,
        });
        if (mode === "strict" || mode === "locked") {
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
        writeLog("gate-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "WARN",
          event: "TOOL-BEFORE",
          detail: `BLOCKED | DAG-TASK-STATUS | task=${taskId} status=${tc.status} source=${tc.source}`,
        });
        if (mode === "strict" || mode === "locked") {
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

  writeLog("gate-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-BEFORE",
    detail: "exit (pass)",
  });
}
