// agent-resolver.ts — Agent identity resolution utilities (lib)
import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "./log-manager";
import { dbReadSessionMap } from "./db-state-manager";

const SRC = "lib-agent-resolver";
const SESSION_MAP_DIR = ".task_temp/_dispatch";
const SESSION_MAP_FILE = ".session_map.json";

// No caching — resolve fresh every call via sessionID
// Priority: session map (DB) → _dispatch_target.json → ""
// (2026-06-12 swapped: session map is session-specific, no race condition)
// (2026-06-17 S25-v4: session map migrated from JSON file to DB table)

export function getSessionMapPath(): string {
  return path.join(
    process.env.OPENCODE_ROOT || ".",
    SESSION_MAP_DIR,
    SESSION_MAP_FILE,
  );
}

export function resolveAgentFromSessionMap(sessionID: string): string {
  if (!sessionID) return "";
  try {
    const entry = dbReadSessionMap(sessionID);
    if (entry?.agent) {
      writeLog(SRC, "INFO", {
        event: "SESSION-MAP-HIT",
        agent: entry.agent,
        detail: `session map hit: ${sessionID} → ${entry.agent}`,
      });
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
      writeLog(SRC, "INFO", {
        event: "AGENT-RESOLVED",
        agent,
        detail: `resolveAgent: session map → ${agent}`,
      });
      return agent.startsWith("@") ? agent : `@${agent}`;
    }
  }

  // 2) _dispatch_target.json — fallback. CAUTION: single shared file,
  //    race condition when multiple Task() dispatches run in parallel.
  //    Only used when session map misses (rare — old entries evicted
  //    from 50-entry cap, or chatMessageHook hasn't fired yet).
  try {
    const p = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch_target.json",
    );
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      const currentRunId = process.env.OPENCODE_RUN_ID || "";
      if (currentRunId) {
        // P0-7: Use run_id comparison when OPENCODE_RUN_ID is available
        if (!d.run_id || d.run_id !== currentRunId) {
          try {
            fs.unlinkSync(p);
          } catch {}
          // stale dispatch, fall through
        } else if (d.agent) {
          writeLog(SRC, "INFO", {
            event: "AGENT-RESOLVED-DISPATCH",
            agent: d.agent,
            detail: `resolveAgent: dispatch target → ${d.agent}`,
          });
          return d.agent.startsWith("@") ? d.agent : `@${d.agent}`;
        }
      } else {
        // P0-7 FALLBACK: Timestamp-based staleness when OPENCODE_RUN_ID
        // is unset. _dispatch_target.json older than 30 min → stale.
        const STALE_MS = 30 * 60 * 1000;
        const mtime = fs.statSync(p).mtimeMs;
        if (Date.now() - mtime > STALE_MS) {
          try {
            fs.unlinkSync(p);
          } catch {}
          // stale dispatch, fall through
        } else if (d.agent) {
          writeLog(SRC, "INFO", {
            event: "AGENT-RESOLVED-DISPATCH",
            agent: d.agent,
            detail: `resolveAgent: dispatch target → ${d.agent}`,
          });
          return d.agent.startsWith("@") ? d.agent : `@${d.agent}`;
        }
      }
    }
  } catch {}

  return "";
}

/** P0-FIX-BUG-13-IDEM: Idempotency guard for duplicate Task() calls */
export const sessionLastDispatched = new Map<
  string,
  { agentType: string; ts: number }
>();

/** Resolve task ID from session_map DB, .dispatch_ctx, or _dispatch_target.json
 *  FW-DISPATCH-TASKID-IMMUTABLE: session_map DB is now primary (per-session,
 *  immune to concurrent race conditions), .dispatch_ctx is fallback.
 *  FW-CLEANUP-FRAMEWORK-TASK-ID (2026-06-18): FRAMEWORK_TASK_ID env Priority 0 removed.
 *  All dispatch-task-id communication now flows through session_map DB + .dispatch_ctx file.
 */
export function resolveTaskId(sessionId?: string): string {
  // Priority 1: session_map DB (per-session dag_task_id, immune to race)
  if (sessionId) {
    try {
      const entry = dbReadSessionMap(sessionId);
      if (entry?.dag_task_id) {
        writeLog(SRC, "INFO", {
          event: "TASKID-RESOLVED",
          dag_task_id: entry.dag_task_id,
          detail: `resolveTaskId: session_map DB → ${entry.dag_task_id}`,
        });
        return entry.dag_task_id;
      }
    } catch {}
  }

  // Priority 2: .dispatch_ctx file (shared, legacy fallback — has race condition
  // with concurrent dispatches but still used by task-after.ts)
  try {
    const ctxPath = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      ".dispatch_ctx",
    );
    if (fs.existsSync(ctxPath)) {
      const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
      if (ctx && ctx.dagTaskId) return ctx.dagTaskId;
    }
  } catch {}

  // Priority 3: _dispatch_target.json (legacy, no longer written)
  try {
    const p = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch_target.json",
    );
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      if (d.task_id) return d.task_id;
    }
  } catch {}
  return "";
}

/** Resolve domain ID from session_map DB or .dispatch_ctx file.
 *  FW-UC7KS-DOMAIN-001: session_map DB is primary (per-session, immune to
 *  concurrent dispatch race conditions), .dispatch_ctx is legacy fallback.
 *  Returns null if no domain context is available.
 */
export function resolveDomainId(sessionId?: string): string | null {
  // Priority 1: session_map DB (per-session domain_id, immune to race)
  if (sessionId) {
    try {
      const entry = dbReadSessionMap(sessionId);
      if (entry?.domain_id) {
        writeLog(SRC, "INFO", {
          event: "DOMAIN-RESOLVED",
          domain_id: entry.domain_id,
          detail: `resolveDomainId: session_map DB → ${entry.domain_id}`,
        });
        return entry.domain_id;
      }
    } catch {}
  }

  // Priority 2: .dispatch_ctx file (shared, legacy fallback)
  try {
    const ctxPath = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      ".dispatch_ctx",
    );
    if (fs.existsSync(ctxPath)) {
      const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
      if (ctx && ctx.domainId) return ctx.domainId;
    }
  } catch {}

  return null;
}

/**
 * Resolve the most recently dispatched agent from session_map DB.
 * Uses ORDER BY updated_at DESC LIMIT 1 — safe in SQLite WAL mode.
 *
 * This is a best-effort function: if the DB is unavailable, it returns
 * an empty string without throwing. The caller (compliance-gate.ts) treats
 * empty as "unknown agent → no bypass".
 *
 * Design rationale:
 *   - Per-session rows → no shared-state race condition
 *   - ORDER BY updated_at DESC LIMIT 1 → no transaction needed
 *   - SQLite WAL mode → concurrent readers safe
 *   - Agent type filter → only SA/Orch sessions considered for bypass
 *   - taskId parameter → precise dag_task_id lookup before ORDER BY fallback
 *
 * @param taskId - Optional DAG task ID for precise dag_task_id lookup
 * @returns Agent name with "@" prefix (e.g., "@Super-Admin"), or "" if unknown
 */
export function resolveLatestDispatchAgent(taskId?: string): string {
  try {
    const { getDb } = require("./db-manager");
    const db = getDb();
    // Priority 1: taskId → dag_task_id exact match (when available)
    if (taskId) {
      const row = db
        .query(
          `SELECT agent FROM session_map
           WHERE dag_task_id = ?
             AND agent IN ('@Super-Admin','Super-Admin','@Orchestrator','Orchestrator')
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .get() as { agent: string } | null;
      if (row?.agent) {
        return row.agent.startsWith("@") ? row.agent : `@${row.agent}`;
      }
    }
    // Priority 2: latest SA/Orch session (fallback)
    const row = db
      .query(
        `SELECT agent FROM session_map
         WHERE agent IN ('@Super-Admin','Super-Admin','@Orchestrator','Orchestrator')
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get() as { agent: string } | null;
    if (row?.agent) {
      // Normalize: ensure "@" prefix (session_map stores with "@" prefix)
      return row.agent.startsWith("@") ? row.agent : `@${row.agent}`;
    }
  } catch (e: any) {
    // Non-blocking: if DB unavailable, return empty (bypass not applied)
    writeLog(SRC, "ERROR", {
      event: "SESSION-MAP-READ-FAILED",
      detail: `resolveLatestDispatchAgent: ${e.message}`,
    });
  }
  return "";
}
