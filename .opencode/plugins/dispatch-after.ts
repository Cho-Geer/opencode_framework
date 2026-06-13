// dispatch-after.ts — "tool.execute.after" plugin: dispatch lifecycle tracking
import * as fs from "node:fs";
import * as path from "node:path";
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent, resolveTaskId, sessionLastDispatched } from "../lib/agent-resolver";

ensureLogDir();
writeLog("dispatch-after", "loaded", { event: "PLUGIN-LOADED", detail: "dispatch-after.ts" });
updateIndex("dispatch-after", "PLUGIN-LOADED");

const PENDING_FILE = ".task_temp/_dispatch/.pending.json";
const FAILED_FILE = ".task_temp/_dispatch/.pending.json.failed";
const STALE_TIMEOUT_MS = 30 * 60 * 1000;
// SA-FIX-PARALLEL-DISPATCH-20260611 (@Super-Admin): TTL cap for .pending.json.failed
// to prevent unbounded growth. Keep only entries from last 7 days, max 100 entries.
const FAILED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILED_MAX_ENTRIES = 100;

function capFailedEntries(entries: any[]): any[] {
  const cutoff = Date.now() - FAILED_TTL_MS;
  const capped = entries.filter((e) => {
    const ts = e.failedAt || e.timestamp;
    return ts && new Date(ts).getTime() > cutoff;
  });
  return capped.length > FAILED_MAX_ENTRIES ? capped.slice(-FAILED_MAX_ENTRIES) : capped;
}

export default (async (_ctx: any) => {
  writeLog("dispatch-after", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.after" });
  return { "tool.execute.after": toolExecuteAfter };
}) as any;

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
  const taskId = resolveTaskId();

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
      // Archive stale entries to failed file
      const ff = path.join(root, FAILED_FILE);
      let failed: any[] = [];
      try { if (fs.existsSync(ff)) failed = JSON.parse(fs.readFileSync(ff, "utf8")); } catch {}
      for (let i = stale.length - 1; i >= 0; i--) {
        failed.push({ ...queue[stale[i]], failedAt: new Date().toISOString(), reason: "stale-timeout" });
        queue.splice(stale[i], 1);
      }
      fs.writeFileSync(pf, JSON.stringify(queue, null, 2), "utf8");
      // SA-FIX-PARALLEL-DISPATCH-20260611: Apply TTL cap before writing failed file
      failed = capFailedEntries(failed);
      fs.writeFileSync(ff, JSON.stringify(failed, null, 2), "utf8");
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
}
