// service/file-guard/read-audit-write.ts — Read audit recording
// Source: read-audit.ts write functions

import * as crypto from "node:crypto";
import { writeLog } from "../../lib/log-manager";
import { getDb } from "../../lib/db-manager";
import { normalize } from "../../lib/agent-identity";

export interface ReadAuditEntry {
  timestamp: string;
  agent: string;
  filePath: string;
  sessionId?: string;
  taskId?: string;
  callId?: string;
}

const MAX_RECORDS = 10000;

export function normalizeReadAuditPath(filePath: string): string {
  const root = process.env.OPENCODE_ROOT || ".";
  const resolved = filePath.startsWith("/") ? filePath : require("node:path").resolve(root, filePath);
  return require("node:path").normalize(resolved).replace(/\/+$/, "").toLowerCase();
}

export function normalizeAgent(agent: string): string { return normalize(agent); }

export function makeEventKey(entry: ReadAuditEntry): string {
  const parts = [entry.timestamp || "", normalizeAgent(entry.agent), normalizeReadAuditPath(entry.filePath || ""), entry.sessionId || "", entry.taskId || "", entry.callId || ""];
  return crypto.createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function toDbBindings(entry: ReadAuditEntry): any[] {
  const eventKey = makeEventKey(entry);
  const normalizedAgent = normalizeAgent(entry.agent);
  const normalizedPath = normalizeReadAuditPath(entry.filePath || "");
  return [eventKey, entry.timestamp, normalizedAgent, normalizedPath, entry.sessionId || null, entry.taskId || null, entry.callId || null, entry.agent, entry.filePath, Date.now()];
}

export function recordRead(entry: ReadAuditEntry): void {
  try {
    const db = getDb();
    db.transaction(() => {
      db.run(`INSERT OR IGNORE INTO read_audit (event_key, timestamp, agent, file_path, opencode_session_id, task_id, call_id, raw_agent, raw_file_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, toDbBindings(entry));
      db.run(`DELETE FROM read_audit WHERE id NOT IN (SELECT id FROM read_audit ORDER BY id DESC LIMIT ?)`, [MAX_RECORDS]);
    })();
    writeLog("service-read-audit", "INFO", { event: "READ_RECORDED", agent: entry.agent, filePath: entry.filePath, db: true });
  } catch (err: any) {
    writeLog("service-read-audit", "ERROR", { event: "READ_AUDIT_DB_WRITE_FAILED", detail: err.message });
  }
}

// ── Read Track Event (from read-track-after hook) ─────────────
// Wrapper for recordRead() with logging. Called by read-track-after plugin.

export function trackReadEvent(params: {
  sessionID: string;
  callID: string;
  filePath: string;
}): void {
  try {
    let agent = "unknown";
    let taskId = "";
    try {
      const { resolveAgent, resolveTaskId } = require("../../lib/agent-resolver");
      agent = resolveAgent(params.sessionID);
      taskId = resolveTaskId(params.sessionID || "");
    } catch {}

    recordRead({
      timestamp: new Date().toISOString(),
      agent,
      filePath: params.filePath,
      sessionId: params.sessionID || undefined,
      taskId,
      callId: params.callID || undefined,
    });

    writeLog("read-track-after", "runtime", {
      event: "READ_TRACKED",
      agent,
      filePath: params.filePath,
      sessionId: params.sessionID || "—",
      detail: `Read tracked: ${params.filePath}`,
    });
  } catch (err: any) {
    writeLog("read-track-after", "ERROR", {
      event: "READ_TRACK_FAILED",
      error: err.message,
      detail: `Read track failed: ${err.message}`,
    });
  }
}
