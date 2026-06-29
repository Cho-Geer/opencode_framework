// service/dispatch/cleanup.ts — Dispatch lifecycle cleanup
// Source: dispatch-after.ts plugin
// Handles: task identity cleanup, stale pending drain, delivered timeout warning.

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import {
  resolveAgent,
  resolveTaskId,
} from "../../lib/agent-resolver";
import { atomicWriteJson } from "../../lib/state-utils";
import { dbAppendDispatchFailed } from "../../lib/db-state-manager";

const SRC = "service-dispatch-cleanup";
const PENDING_FILE = ".task_temp/_dispatch/.pending.json";
const STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Clean up dispatch state after Task() completes.
 * Called by dispatch-after plugin.
 *
 * Steps:
 *   1. Delete _dispatch_target.json (task identity cleanup)
 *   2. Drain stale pending entries (archive to DB)
 *   3. Warn about delivered sessions awaiting approval > 2h
 */
export function cleanupDispatch(params: {
  sessionID: string;
  callID: string;
  tool: string;
  args: Record<string, unknown>;
}): void {
  // Only track Task() dispatch calls
  const isTask = params.tool === "Task" || params.tool === "task";
  if (!isTask) return;

  const agent = resolveAgent(params.sessionID);
  const taskId = resolveTaskId(params.sessionID);

  // ═══════════════════════════════════════════════════════════════
  // P0-7 TASK-IDENTITY CLEANUP: Delete _dispatch_target.json
  // ═══════════════════════════════════════════════════════════════
  try {
    const dtPath = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch_target.json",
    );
    if (fs.existsSync(dtPath)) fs.unlinkSync(dtPath);
    writeLog("dispatch-after", "runtime", {
      sessionID: params.sessionID,
      callID: params.callID,
      agent,
      event: "TOOL-AFTER",
      detail: "TASK-IDENTITY: cleaned up _dispatch_target.json",
    });
  } catch {
    /* non-fatal: stale file will be auto-rejected by run_id check */
  }

  writeLog("dispatch-after", "runtime", {
    sessionID: params.sessionID,
    callID: params.callID,
    agent,
    event: "TOOL-AFTER",
    detail: `dispatch-complete | agentType=${(params.args as any)?.subagent_type || "?"} | taskId=${taskId}`,
  });

  // ── Clean up stale pending entries ──
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
        sessionID: params.sessionID,
        callID: params.callID,
        agent,
        event: "TOOL-AFTER",
        detail: `stale-drain | removed=${stale.length} | remaining=${queue.length}`,
      });
    }
  } catch (err: any) {
    writeLog("dispatch-after", "runtime", {
      sessionID: params.sessionID,
      callID: params.callID,
      agent,
      level: "ERROR",
      event: "TOOL-AFTER",
      detail: "stale-drain failed: " + err.message,
    });
  }

  // ── Delivered state timeout warning ──
  try {
    const { dbLoadGateStore } = require("../../lib/db-state-manager");
    const store = dbLoadGateStore();
    if (store?.sessions) {
      const now = Date.now();
      const DELIVERED_TIMEOUT_MS = 2 * 60 * 60 * 1000;
      for (const [sid, ses] of Object.entries(store.sessions)) {
        if ((ses as any).gate_status === "delivered" && (ses as any).submitted_deliverables) {
          const submittedAt = (ses as any).submitted_deliverables[0]?.submitted_at;
          if (submittedAt) {
            const age = now - new Date(submittedAt).getTime();
            if (age > DELIVERED_TIMEOUT_MS) {
              writeLog("dispatch-after", "WARN", {
                sessionID: params.sessionID,
                callID: params.callID,
                agent,
                event: "DELIVERED-TIMEOUT",
                detail: `Session ${sid} in 'delivered' state for ${Math.round(age / 3600000)}h (agent: ${(ses as any).agent}). Orchestrator: call compliance_gate_approve_deliverables to approve or reject.`,
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
