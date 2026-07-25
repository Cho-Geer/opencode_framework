#!/usr/bin/env bun
"use strict";
/**
 * service/notification/mcp-notify.ts
 * 
 * Notification service layer — business logic + DB persistence for notifications.
 * MCP server (notify-server.ts) delegates here. Bridge reads via SQLite directly.
 * 
 * Convention: service layer is the ONLY module that writes to DB.
 * Logging via writeLog() from lib/log-manager.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";
import { writeLog } from "../../lib/log-manager";

const SRC = "service-notification";

// ── DB Access (singleton, read-only for session_map, read-write for notifications) ──
let fwDb: Database | null = null;

function getDb(): Database {
  if (!fwDb) {
    const root = process.env.OPENCODE_ROOT || ".";
    const dbPath = join(root, ".opencode", "state", "framework-state.db");
    fwDb = new Database(dbPath);
    fwDb.run("PRAGMA journal_mode = WAL");
    fwDb.run("PRAGMA synchronous = NORMAL");
    fwDb.run("PRAGMA busy_timeout = 5000");
  }
  return fwDb;
}

export function closeDb(): void {
  if (fwDb) { fwDb.close(); fwDb = null; }
}

// ── Agent name normalization (consistent with session-map.ts) ──
function normalizeAgent(agent: string): string {
  return agent.replace(/^@/, "");
}

// ── Session resolution ──
export interface ResolveResult {
  session_id: string;
  parent_id: string;
  resolved: boolean;
}

export function resolveSession(agent: string, taskId?: string): ResolveResult {
  const db = getDb();
  const normalized = normalizeAgent(agent);

  // Strategy 1: match dag_task_id (most precise)
  if (taskId) {
    const row = db.query(
      "SELECT session_id, parent_id FROM session_map WHERE dag_task_id = ? LIMIT 1"
    ).get(taskId) as any;
    if (row?.session_id) {
      return { session_id: row.session_id, parent_id: row.parent_id || "", resolved: true };
    }
  }

  // Strategy 2: match agent name, most recent session
  const row = db.query(
    "SELECT session_id, parent_id FROM session_map WHERE agent = ? ORDER BY created_at DESC LIMIT 1"
  ).get(normalized) as any;
  if (row?.session_id) {
    return { session_id: row.session_id, parent_id: row.parent_id || "", resolved: true };
  }

  return { session_id: "", parent_id: "", resolved: false };
}

// ── Write notification ──
interface WriteNotificationParams {
  agent: string;
  task_id?: string;
  event_type: string;
  data?: Record<string, any>;
}

interface WriteNotificationResult {
  ok: boolean;
  seq: number;
  resolved: boolean;
  session_id: string;
  error?: string;
}

export function writeNotification(params: WriteNotificationParams): WriteNotificationResult {
  const db = getDb();
  const normalized = normalizeAgent(params.agent);

  try {
    const { session_id, parent_id, resolved } = resolveSession(params.agent, params.task_id || undefined);
    // Use transaction for atomic seq generation + insert
    const insertFn = db.transaction(() => {
      // Get next seq atomically
      const maxRow = db.query("SELECT COALESCE(MAX(seq), 0) as m FROM notifications").get() as any;
      const seq = (maxRow?.m || 0) + 1;

      db.run(
        `INSERT INTO notifications (seq, created_at, agent, dag_task_id, session_id, parent_id, event_type, data, resolved)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          seq,
          Date.now(),
          normalized,
          params.task_id || "",
          session_id,
          parent_id,
          params.event_type,
          JSON.stringify(params.data || {}),
          resolved ? 1 : 0,
        ]
      );

      return seq;
    });

    const seq = insertFn();

    writeLog(SRC, "runtime", {
      level: "INFO",
      event: "NOTIFY-WRITE",
      agent: normalized,
      detail: `seq=${seq} type=${params.event_type} resolved=${resolved} session=${session_id || "none"}`,
      task_id: params.task_id,
    });

    return { ok: true, seq, resolved, session_id };
  } catch (err: any) {
    writeLog(SRC, "runtime", {
      level: "ERROR",
      event: "NOTIFY-WRITE-FAIL",
      agent: normalized,
      detail: `error=${err.message}`,
    });
    return { ok: false, seq: 0, resolved: false, session_id: "", error: err?.message || String(err) };
  }
}

// ── Read notifications (for acp-bridge) ──
interface ReadNotificationsParams {
  reader_id: string;
  limit?: number;
}

interface ReadNotificationsResult {
  events: any[];
  count: number;
  last_seq: number;
}

export function readNotifications(params: ReadNotificationsParams): ReadNotificationsResult {
  const db = getDb();
  const limit = params.limit || 50;

  // Get last read seq for this reader
  const cursorRow = db.query(
    "SELECT last_seq FROM notification_readers WHERE reader_id = ?"
  ).get(params.reader_id) as any;
  const lastSeq = cursorRow?.last_seq || 0;

  // Read new events
  const events = db.query(
    "SELECT seq, created_at, agent, dag_task_id, session_id, parent_id, event_type, data, resolved FROM notifications WHERE seq > ? ORDER BY seq ASC LIMIT ?"
  ).all(lastSeq, limit) as any[];

  // Update cursor
  if (events.length > 0) {
    const maxSeq = Math.max(...events.map((e: any) => e.seq));
    db.run(
      "INSERT OR REPLACE INTO notification_readers (reader_id, last_seq, updated_at) VALUES (?, ?, ?)",
      [params.reader_id, maxSeq, Date.now()]
    );
  }

  // Parse data JSON for each event
  const parsed = events.map((e: any) => ({
    ...e,
    data: safeJsonParse(e.data),
    resolved: e.resolved === 1,
  }));

  return { events: parsed, count: parsed.length, last_seq: lastSeq };
}

function safeJsonParse(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}

// ── Cleanup old notifications ──
export function cleanupNotifications(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): number {
  const db = getDb();
  const cutoff = Date.now() - olderThanMs;
  const result = db.run("DELETE FROM notifications WHERE created_at < ?", [cutoff]);
  const deleted = result.changes || 0;

  if (deleted > 0) {
    writeLog(SRC, "runtime", {
      level: "INFO",
      event: "NOTIFY-CLEANUP",
      detail: `deleted=${deleted} older_than=${olderThanMs}ms`,
    });
  }

  return deleted;
}
