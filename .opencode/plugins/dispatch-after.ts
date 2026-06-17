// dispatch-after.ts — "tool.execute.after" plugin: dispatch lifecycle tracking
import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent, resolveTaskId, sessionLastDispatched } from "../lib/agent-resolver";
import { atomicWriteJson } from "../lib/state-utils";
import { dbAppendDispatchFailed } from "../lib/db-state-manager";

const PENDING_FILE = ".task_temp/_dispatch/.pending.json";
const FAILED_FILE = ".task_temp/_dispatch/.pending.json.failed";
const STALE_TIMEOUT_MS = 30 * 60 * 1000;

export default withPluginLifecycle("dispatch-after", { "tool.execute.after": toolExecuteAfter });

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  // Only track Task() dispatch calls
  const isTask = input.tool === "Task" || input.tool === "task";
  if (!isTask) return;

  // ═══════════════════════════════════════════════════════════════
  // P0-7 TASK-IDENTITY CLEANUP: Delete _dispatch_target.json after
  // Task() completes. At this point the sub-agent has finished, so
  // deleting does not affect its agent resolution. Prevents stale
  // dispatch targets from persisting between dispatches or leaking
  // across sessions.
  //
  // Safety: all readers validate run_id against OPENCODE_RUN_ID, so
  // even if cleanup is delayed, stale files are auto-rejected.
  // ═══════════════════════════════════════════════════════════════
  try {
    const dtPath = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch_target.json",
    );
    if (fs.existsSync(dtPath)) fs.unlinkSync(dtPath);
    writeLog("dispatch-after", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent: resolveAgent(input.sessionID),
      agentType: resolveAgent(input.sessionID),
      event: "TOOL-AFTER",
      detail: "TASK-IDENTITY: cleaned up _dispatch_target.json",
    });
  } catch {
    /* non-fatal: stale file will be auto-rejected by run_id check */
  }

  const agent = resolveAgent(input.sessionID);
  const taskId = resolveTaskId(input.sessionID);

  writeLog("dispatch-after", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-AFTER",
    detail: `dispatch-complete | agentType=${input.args?.subagent_type || "?"} | taskId=${taskId}`,
  });

  // Clean up stale pending entries
  const root = process.env.OPENCODE_ROOT || ".";
  const pf = path.join(root, PENDING_FILE);

  try {
    if (!fs.existsSync(pf)) return;
    let queue = JSON.parse(fs.readFileSync(pf, "utf8"));
    if (!Array.isArray(queue) || queue.length === 0) return;

    const now = Date.now();
    const stale: number[] = [];
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].createdAt) {
        const age = now - new Date(queue[i].createdAt).getTime();
        if (age > STALE_TIMEOUT_MS) stale.push(i);
      }
    }

    if (stale.length > 0) {
      // Archive stale entries to dispatch_failed_log DB (replaces .pending.json.failed)
      for (let i = stale.length - 1; i >= 0; i--) {
        const entry = queue[stale[i]];
        dbAppendDispatchFailed({
          dispatchId: entry.dispatchId || entry.filePath || "unknown",
          promptHash: entry.promptHash,
          filePath: entry.filePath,
          agentType: entry.agentType || "unknown",
          dagTaskId: entry.dagTaskId,
          createdAt: new Date(entry.createdAt).getTime(),
          failedAt: Date.now(),
          reason: "stale-timeout",
        });
        queue.splice(stale[i], 1);
      }
      atomicWriteJson(pf, queue);
      writeLog("dispatch-after", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        event: "TOOL-AFTER",
        detail: `stale-drain | removed=${stale.length} | remaining=${queue.length}`,
      });
    }
  } catch (err: any) {
    writeLog("dispatch-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      level: "ERROR", event: "TOOL-AFTER",
      detail: "stale-drain failed: " + err.message,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // DELIVERED STATE TIMEOUT WARNING:
  // Check for gate sessions in 'delivered' state awaiting Orchestrator
  // approval for > 2 hours. Log WARNING to alert Orchestrator.
  // ═══════════════════════════════════════════════════════════════
  try {
    const { dbLoadGateStore } = require("../lib/db-state-manager");
    const store = dbLoadGateStore();
    if (store?.sessions) {
      const now = Date.now();
      const DELIVERED_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
      for (const [sid, ses] of Object.entries(store.sessions)) {
        if (ses.gate_status === "delivered" && ses.submitted_deliverables) {
          const submittedAt = ses.submitted_deliverables[0]?.submitted_at;
          if (submittedAt) {
            const age = now - new Date(submittedAt).getTime();
            if (age > DELIVERED_TIMEOUT_MS) {
              writeLog("dispatch-after", "WARN", {
                sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
                event: "DELIVERED-TIMEOUT",
                detail: `Session ${sid} in 'delivered' state for ${Math.round(age / 3600000)}h (agent: ${ses.agent}). Orchestrator: call compliance_gate_approve_deliverables to approve or reject.`,
              });
            }
          }
        }
      }
    }
  } catch {
    /* non-critical: gate state may not be available */
  }
}
