// service/session/session-map.ts — Session map DB operations
// Core session_map table read/write + basic agent resolution
// Source: agent-resolver.ts (session-map part) + session.ts (dbWriteSessionMap)

import { writeLog } from "../../lib/log-manager";
import { dbReadSessionMap, dbWriteSessionMap } from "../../lib/db-state-manager";

const SRC = "service-session-map";

// ── Read operations ────────────────────────────────────────────────

export function readSessionMapEntry(sessionID: string): any | null {
  if (!sessionID) return null;
  try {
    return dbReadSessionMap(sessionID) || null;
  } catch {
    return null;
  }
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

// ── Write operations ───────────────────────────────────────────────

export function upsertSessionMap(
  sessionID: string,
  agent: string,
  dagTaskId?: string,
  domainId?: string,
  parentId?: string,
): void {
  try {
    // FW-AGENT-IMMUTABLE: detect and log attempted agent overwrites
    const existing = dbReadSessionMap(sessionID);
    if (existing?.agent && normalizeAgent(existing.agent) !== normalizeAgent(agent)) {
      writeLog(SRC, "WARN", {
        sessionID,
        event: "AGENT-IMMUTABLE-PRESERVED",
        existing_agent: existing.agent,
        attempted_agent: agent,
        detail: `agent identity preserved: existing=${existing.agent}, attempted=${agent} (SQL COALESCE will ignore attempted value)`,
      });
    }

    dbWriteSessionMap(sessionID, agent, dagTaskId, domainId, parentId);

    // Phase 4 dual-write: session_registry (v33 table)
    try {
      const { getDb } = require("../../lib/db-manager");
      const db = getDb();
      const now = Date.now();
      db.run(
        `INSERT OR REPLACE INTO session_registry
         (session_id, parent_session_id, agent, agent_alias, native_executor, dag_task_id, domain_id, status, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, 'active', ?, ?)`,
        [sessionID, parentId || null, agent, dagTaskId || null, domainId || null, now, now]
      );
    } catch (e: any) {
      writeLog(SRC, "WARN", { event: "SESSION-REGISTRY-DUAL-WRITE-FAILED", sessionID, detail: e.message });
    }

    writeLog(SRC, "INFO", {
      sessionID,
      agent,
      event: "SESSION-MAP-UPSERT",
      detail: `upserted: agent=${agent}, dag=${dagTaskId || "-"}, domain=${domainId || "-"}, parent=${parentId || "-"}`,
    });
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      sessionID,
      agent,
      event: "SESSION-MAP-UPSERT-FAILED",
      detail: e.message,
    });
  }
}

export function removeSessionMap(sessionID: string): void {
  try {
    const { getDb } = require("../../lib/db-manager");
    const db = getDb();
    db.run("DELETE FROM session_map WHERE session_id = ?", [sessionID]);
    writeLog(SRC, "INFO", {
      sessionID,
      event: "SESSION-MAP-REMOVE",
      detail: `removed session map entry: ${sessionID}`,
    });
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      sessionID,
      event: "SESSION-MAP-REMOVE-FAILED",
      detail: e.message,
    });
  }
}

export function cleanOrphanSessionMaps(): number {
  try {
    const { getDb } = require("../../lib/db-manager");
    const db = getDb();
    if (!db) return 0;

    // FW-SESSION-ORPHAN-SAFE: 只清理 24h 前的条目
    // session_log 仅在 task-after 写入，不经过 dispatch 的 session（如 Orchestrator）
    // 永远不会进入 session_log，所以不能用它作为唯一验证源
    // 加时间窗口保护近期 session 不被误删
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

    const candidates = db.query(
      `SELECT session_id FROM session_map
       WHERE session_id NOT IN (
         SELECT DISTINCT session_id FROM session_log WHERE session_id IS NOT NULL
       )
       AND updated_at < ?
       AND session_id NOT LIKE 'dispatch:%'`,
    ).all(twentyFourHoursAgo) as { session_id: string }[];

    if (candidates.length === 0) return 0;

    const txn = db.transaction(() => {
      const result = db.run(
        `DELETE FROM session_map
         WHERE session_id NOT IN (
           SELECT DISTINCT session_id FROM session_log WHERE session_id IS NOT NULL
         )
         AND updated_at < ?
         AND session_id NOT LIKE 'dispatch:%'`,
        [twentyFourHoursAgo],
      );
      return result.changes;
    });
    const cleaned = txn();

    if (cleaned > 0) {
      writeLog(SRC, "INFO", {
        event: "SESSION-MAP-ORPHAN-CLEANUP",
        detail: `${cleaned} orphan session_map entries removed (>24h, not in session_log)`,
        deletedSessionIds: candidates.map((c) => c.session_id).slice(0, 20),
        totalCandidates: candidates.length,
      });
    }
    return cleaned;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "SESSION-MAP-CLEANUP-FAILED",
      detail: e.message,
    });
    return 0;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

// FW-SESSION-NORMALIZE-V2: 去 @ 前缀，保留 PascalCase（与 SDK session.agent 一致）
// 注意：agent-identity.ts:normalize() 用于内部比较（小写），此函数用于存储
export function normalizeAgent(agent: string): string {
  return agent.replace(/^@/, "");
}
