// agent-resolver.ts — Agent identity resolution utilities (lib)
import * as fs from "node:fs";
import * as path from "node:path";
import { demoLog } from "./shared-infra";
import { dbReadSessionMap } from "./db-state-manager";

const SESSION_MAP_DIR = ".task_temp/_dispatch";
const SESSION_MAP_FILE = ".session_map.json";

// No caching — resolve fresh every call via sessionID
// Priority: session map (DB) → _dispatch_target.json → ""
// (2026-06-12 swapped: session map is session-specific, no race condition)
// (2026-06-17 S25-v4: session map migrated from JSON file to DB table)

export function getSessionMapPath(): string {
  return path.join(process.env.OPENCODE_ROOT || ".", SESSION_MAP_DIR, SESSION_MAP_FILE);
}

export function resolveAgentFromSessionMap(sessionID: string): string {
  if (!sessionID) return "";
  try {
    const entry = dbReadSessionMap(sessionID);
    if (entry?.agent) {
      demoLog("INFO", `session map hit: ${sessionID} → ${entry.agent}`);
      return entry.agent;
    }
  } catch {}
  return "";
}

export function resolveAgent(sessionID?: string): string {
  // 1) Session map — primary agent (chatMessageHook writes this).
  //    MOVED TO PRIORITY 1 (2026-06-12, @Super-Admin): Session map is
  //    session-specific, so there is NO race condition from parallel
  //    dispatches. Previously _dispatch_target.json was Priority 1, but
  //    it is a SINGLE shared file that gets overwritten by parallel
  //    dispatches (dispatch-before.ts writes, dispatch-after.ts deletes),
  //    causing wrong agent identity to be returned.
  //
  //    P0-4 enforcement gap root cause: When @Super-Admin was dispatched
  //    in parallel with @Coder-BE, _dispatch_target.json ended up with
  //    "@Coder-BE" (last write wins). resolveAgent() returned "@Coder-BE",
  //    so scope-before.ts P0-4 ROUTE-MISMATCH check was SKIPPED
  //    (agentNorm="coder-be", not "super-admin"), and isWriteAllowed()
  //    allowed the write because @Coder-BE has access to booking-backend/src/.
  if (sessionID) {
    const agent = resolveAgentFromSessionMap(sessionID);
    if (agent) {
      demoLog("INFO", `resolveAgent: session map → ${agent}`);
      return agent.startsWith("@") ? agent : `@${agent}`;
    }
  }

  // 2) _dispatch_target.json — fallback. CAUTION: single shared file,
  //    race condition when multiple Task() dispatches run in parallel.
  //    Only used when session map misses (rare — old entries evicted
  //    from 50-entry cap, or chatMessageHook hasn't fired yet).
  try {
    const p = path.join(process.env.OPENCODE_ROOT || ".", ".task_temp", "_dispatch_target.json");
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      const currentRunId = process.env.OPENCODE_RUN_ID || "";
      if (currentRunId) {
        // P0-7: Use run_id comparison when OPENCODE_RUN_ID is available
        if (!d.run_id || d.run_id !== currentRunId) {
          try { fs.unlinkSync(p); } catch {}
          // stale dispatch, fall through
        } else if (d.agent) {
          demoLog("INFO", `resolveAgent: dispatch target → ${d.agent}`);
          return d.agent.startsWith("@") ? d.agent : `@${d.agent}`;
        }
      } else {
        // P0-7 FALLBACK: Timestamp-based staleness when OPENCODE_RUN_ID
        // is unset. _dispatch_target.json older than 30 min → stale.
        const STALE_MS = 30 * 60 * 1000;
        const mtime = fs.statSync(p).mtimeMs;
        if (Date.now() - mtime > STALE_MS) {
          try { fs.unlinkSync(p); } catch {}
          // stale dispatch, fall through
        } else if (d.agent) {
          demoLog("INFO", `resolveAgent: dispatch target → ${d.agent}`);
          return d.agent.startsWith("@") ? d.agent : `@${d.agent}`;
        }
      }
    }
  } catch {}

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
