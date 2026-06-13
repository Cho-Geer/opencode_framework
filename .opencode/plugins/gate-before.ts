// gate-before.ts — "tool.execute.before" plugin: gate & DAG enforcement
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent, resolveTaskId } from "../lib/agent-resolver";
import { getEnforcementMode, findArmedSession } from "../lib/gate-core";
import { findTaskInDag } from "../lib/gate-checks";
import { isModifyTool } from "../lib/tool-scope";

ensureLogDir();
writeLog("gate-before", "loaded", { event: "PLUGIN-LOADED", detail: "gate-before.ts" });
updateIndex("gate-before", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("gate-before", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.before" });
  return { "tool.execute.before": toolExecuteBefore };
}) as any;

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
    const agentNorm = agent.toLowerCase().replace(/^@/, "");
    /**
     * P2-1 FIX (2026-06-12): Added "super-admin" to DAG exemption.
     * @Super-Admin performs framework maintenance (docs/, rules, plugins)
     * outside DAG coverage. Original enforce.ts L1327 exempted SA from
     * ALL checks including DAG — removing the bypass for ROUTE-MISMATCH
     * (P0-4) inadvertently removed the DAG exemption too.
     */
    const isDagCreator =
      agentNorm === "orchestrator" || agentNorm === "meta-planner" || agentNorm === "super-admin";

    if (taskId && !isDagCreator) {
      const tc = findTaskInDag(taskId);
      if (!tc.found) {
        writeLog("gate-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "WARN",
          event: "TOOL-BEFORE",
          detail: `BLOCKED | DAG-TASK-NOT-FOUND | task=${taskId}`,
        });
        if (mode === "strict" || mode === "locked") {
          throw new Error(
            `[FW-ENFORCE][DAG] Task "${taskId}" not found in Task.DAG.json. ` +
            `Ensure @Meta-Planner has planned this task.`,
          );
        }
      } else if (tc.status !== "pending" && tc.status !== "in_progress") {
        writeLog("gate-before", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
          level: "WARN",
          event: "TOOL-BEFORE",
          detail: `BLOCKED | DAG-TASK-STATUS | task=${taskId} status=${tc.status}`,
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
          detail: `DAG task verified | task=${taskId} status=${tc.status}`,
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
