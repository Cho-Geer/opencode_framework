// agent-resolver.ts — Agent identity resolution utilities (lib)
import * as fs from "node:fs";
import * as path from "node:path";
import { demoLog } from "./shared-infra";

const SESSION_MAP_DIR = ".task_temp/_dispatch";
const SESSION_MAP_FILE = ".session_map.json";

// No caching — resolve fresh every call via sessionID
// Priority: _dispatch_target.json → session map → ""

export function getSessionMapPath(): string {
  return path.join(process.env.OPENCODE_ROOT || ".", SESSION_MAP_DIR, SESSION_MAP_FILE);
}

export function resolveAgentFromSessionMap(sessionID: string): string {
  if (!sessionID) return "";
  try {
    const mp = getSessionMapPath();
    if (!fs.existsSync(mp)) return "";
    const map = JSON.parse(fs.readFileSync(mp, "utf8"));
    const entry = map?.[sessionID];
    if (entry?.agent) {
      demoLog("INFO", `session map hit: ${sessionID} → ${entry.agent}`);
      return entry.agent;
    }
  } catch {}
  return "";
}

export function resolveAgent(sessionID?: string): string {
  // 1) _dispatch_target.json — sub-agent dispatched via dispatch_subagent
  try {
    const p = path.join(process.env.OPENCODE_ROOT || ".", ".task_temp", "_dispatch_target.json");
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      const currentRunId = process.env.OPENCODE_RUN_ID || "";
      if (currentRunId && (!d.run_id || d.run_id !== currentRunId)) {
        try { fs.unlinkSync(p); } catch {}
        // stale dispatch, fall through
      } else if (d.agent) {
        demoLog("INFO", `resolveAgent: dispatch target → ${d.agent}`);
        return d.agent;
      }
    }
  } catch {}

  // 2) Session map — primary agent (chatMessageHook writes this)
  if (sessionID) {
    const agent = resolveAgentFromSessionMap(sessionID);
    if (agent) {
      demoLog("INFO", `resolveAgent: session map → ${agent}`);
      return agent;
    }
  }

  return "";
}

/** P0-FIX-BUG-13-IDEM: Idempotency guard for duplicate Task() calls */
export const sessionLastDispatched = new Map<string, { agentType: string; ts: number }>();

/** Resolve task ID from env var or _dispatch_target.json */
export function resolveTaskId(): string {
  const envId = process.env.FRAMEWORK_TASK_ID || "";
  if (envId) return envId;
  try {
    const p = path.join(process.env.OPENCODE_ROOT || ".", ".task_temp", "_dispatch_target.json");
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      if (d.task_id) return d.task_id;
    }
  } catch {}
  return "";
}
