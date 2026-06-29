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
): void {
  try {
    dbWriteSessionMap(sessionID, agent, dagTaskId, domainId);
    writeLog(SRC, "INFO", {
      sessionID,
      agent,
      event: "SESSION-MAP-UPSERT",
      detail: `upserted: agent=${agent}, dag=${dagTaskId || "-"}, domain=${domainId || "-"}`,
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

    const candidates = db.query(
      `SELECT session_id FROM session_map
       WHERE session_id NOT IN (
         SELECT DISTINCT session_id FROM session_log WHERE session_id IS NOT NULL
       )`,
    ).all() as { session_id: string }[];

    const txn = db.transaction(() => {
      const result = db.run(
        `DELETE FROM session_map
         WHERE session_id NOT IN (
           SELECT DISTINCT session_id FROM session_log WHERE session_id IS NOT NULL
         )`,
      );
      return result.changes;
    });
    const cleaned = txn();

    if (cleaned > 0) {
      writeLog(SRC, "INFO", {
        event: "SESSION-MAP-ORPHAN-CLEANUP",
        detail: `${cleaned} orphan session_map entries removed`,
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

export function normalizeAgent(agent: string): string {
  return agent.startsWith("@") ? agent : `@${agent}`;
}
