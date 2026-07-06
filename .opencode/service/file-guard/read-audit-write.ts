// service/file-guard/read-audit-write.ts — Read audit recording
// Source: read-audit.ts write functions
// Enhanced 2026-07-01: content_length, file_hash, file_size for full-read verification

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
  contentLength?: number;   // NEW: how many chars the agent received
  fileHash?: string;        // NEW: SHA-256 of file at read time
  fileSize?: number;        // NEW: total file size in chars
}

const MAX_RECORDS = 10000;

// ── Auto-migration: add new columns if missing ──
let _migrated = false;
function ensureMigration(): void {
  if (_migrated) return;
  _migrated = true;
  try {
    const db = getDb();
    try { db.run("ALTER TABLE read_audit ADD COLUMN content_length INTEGER DEFAULT 0"); } catch {}
    try { db.run("ALTER TABLE read_audit ADD COLUMN file_hash TEXT DEFAULT ''"); } catch {}
    try { db.run("ALTER TABLE read_audit ADD COLUMN file_size INTEGER DEFAULT 0"); } catch {}
  } catch {}
}

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
  return [
    eventKey, entry.timestamp, normalizedAgent, normalizedPath,
    entry.sessionId || null, entry.taskId || null, entry.callId || null,
    entry.agent, entry.filePath,
    entry.contentLength || 0,   // NEW
    entry.fileHash || "",       // NEW
    entry.fileSize || 0,        // NEW
    Date.now(),
  ];
}

export function recordRead(entry: ReadAuditEntry): void {
  ensureMigration();
  try {
    const db = getDb();
    db.transaction(() => {
      db.run(
        `INSERT OR IGNORE INTO read_audit
         (event_key, timestamp, agent, file_path, opencode_session_id, task_id, call_id,
          raw_agent, raw_file_path, content_length, file_hash, file_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        toDbBindings(entry),
      );
      db.run(`DELETE FROM read_audit WHERE id NOT IN (SELECT id FROM read_audit ORDER BY id DESC LIMIT ?)`, [MAX_RECORDS]);
    })();
    writeLog("service-read-audit", "INFO", {
      event: "READ_RECORDED", agent: entry.agent, filePath: entry.filePath,
      contentLength: entry.contentLength, fileSize: entry.fileSize, db: true,
    });
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
  contentLength?: number;   // NEW
  fileHash?: string;        // NEW
  fileSize?: number;        // NEW
  agent?: string;           // FW-AGENT-FALLBACK: agent from plugin context
}): void {
  try {
    let agent = "unknown";
    let taskId = "";
    try {
      const { resolveAgent, resolveTaskId } = require("../../lib/agent-resolver");
      // FW-AGENT-FALLBACK: use plugin context agent when session_map lookup fails
      agent = resolveAgent(params.sessionID) || params.agent || "unknown";
      taskId = resolveTaskId(params.sessionID || "");
    } catch {
      agent = params.agent || "unknown";
    }

    recordRead({
      timestamp: new Date().toISOString(),
      agent,
      filePath: params.filePath,
      sessionId: params.sessionID || undefined,
      taskId,
      callId: params.callID || undefined,
      contentLength: params.contentLength,  // NEW
      fileHash: params.fileHash,            // NEW
      fileSize: params.fileSize,            // NEW
    });

    writeLog("read-track-after", "runtime", {
      event: "READ_TRACKED",
      agent,
      filePath: params.filePath,
      sessionId: params.sessionID || "—",
      contentLength: params.contentLength,
      fileSize: params.fileSize,
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
