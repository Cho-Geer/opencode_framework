// task-after.ts — "tool.execute.after" plugin: task failure recording
import * as fs from "node:fs";
import * as path from "node:path";
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent, resolveTaskId } from "../lib/agent-resolver";

ensureLogDir();
writeLog("task-after", "loaded", { event: "PLUGIN-LOADED", detail: "task-after.ts" });
updateIndex("task-after", "PLUGIN-LOADED");

const FAILED_DIR = ".task_temp/_dispatch";
const FAILED_FILE = ".task_temp/_dispatch/.pending.json.failed";
// SA-FIX-PARALLEL-DISPATCH-20260611 (@Super-Admin): TTL cap for .pending.json.failed
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
  writeLog("task-after", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.after" });
  return { "tool.execute.after": toolExecuteAfter };
}) as any;

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  // Only track Task() dispatch calls
  const isTask = input.tool === "Task" || input.tool === "task";
  if (!isTask) return;

  const agent = resolveAgent(input.sessionID);
  const taskId = resolveTaskId();

  // Record dispatch outcome
  const outcome = output?.error || output?.failed ? "FAILURE" : "SUCCESS";

  writeLog("task-after", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-AFTER",
    detail: `dispatch-outcome | status=${outcome} | taskId=${taskId} | agentType=${input.args?.subagent_type || "?"}`,
  });

  // On failure, append to failed dispatch log
  if (outcome === "FAILURE") {
    try {
      const root = process.env.OPENCODE_ROOT || ".";
      const ff = path.join(root, FAILED_FILE);
      const dir = path.join(root, FAILED_DIR);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let failed: any[] = [];
      try { if (fs.existsSync(ff)) failed = JSON.parse(fs.readFileSync(ff, "utf8")); } catch {}

      failed.push({
        sessionID: input.sessionID,
        agentType: input.args?.subagent_type || "unknown",
        taskId,
        timestamp: new Date().toISOString(),
        error: output?.error || output?.failed || "unknown",
      });

      // SA-FIX-PARALLEL-DISPATCH-20260611: Apply TTL cap before writing failed file
      failed = capFailedEntries(failed);
      fs.writeFileSync(ff, JSON.stringify(failed, null, 2), "utf8");
    } catch (err: any) {
      writeLog("task-after", "runtime", {
        sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
        level: "ERROR", event: "TOOL-AFTER",
        detail: "failure-record failed: " + err.message,
      });
    }
  }
}
