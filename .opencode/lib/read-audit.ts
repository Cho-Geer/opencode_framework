/**
 * read-audit.ts — Read event audit trail for READ-BEFORE-APPROVE enforcement
 * ═══════════════════════════════════════════════════════════════════════
 * Records every `read` tool invocation (via read-track-after.ts plugin) to
 * a SQLite DB (primary) with JSONL fallback (Phase 1).
 *
 * Phase 1 (current): DB-first writes + reads with JSONL fallback.
 * Phase 2 (future):   DB-only, JSONL archived.
 *
 * Consumers:
 *   - read-track-after.ts  → recordRead() on every read tool invocation
 *   - compliance-gate.ts   → verifyRead() for READ-BEFORE-APPROVE
 *   - knowledge_cache_attest.ts → getReadEventsForSession() for UC7KS attestation
 *
 * @author @Super-Admin
 * @version 2.0.0 — DB-first migration (Phase 1)
 * @since 2026-06-18
 *
 * @see docs/review/framework-refactor/read-audit-db-migration-plan.md
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "./log-manager";
import { getDb } from "./db-manager";

// ── Types ──────────────────────────────────────────────────────

export interface ReadAuditEntry {
  /** ISO 8601 timestamp of the read event */
  timestamp: string;
  /** Agent identity (e.g. "Orchestrator", "@Super-Admin") */
  agent: string;
  /** Absolute or relative file path that was read */
  filePath: string;
  /** OpenCode session ID (ses_*) — NOT compliance gate session (cg_ses_*) */
  sessionId?: string;
  /** DAG task ID for context */
  taskId?: string;
  /** Read tool invocation ID (from OpenCode callID) */
  callId?: string;
}

export interface ReadVerifyResult {
  verified: boolean;
  reason: string;
  matchedEntry?: ReadAuditEntry;
}

// ── Configuration ──────────────────────────────────────────────

/** Maximum age of a read event to be considered valid for approval (5 min) */
const READ_MAX_AGE_MS = 5 * 60 * 1000;

/** Maximum records to keep (DB + JSONL). Applied atomically in DB, RMW in JSONL. */
const MAX_RECORDS = 10000;

/**
 * File path for read audit JSONL (Phase 1 fallback).
 * Resolved relative to OPENCODE_ROOT.
 */
function getReadAuditPath(): string {
  const root = process.env.OPENCODE_ROOT || ".";
  return path.resolve(root, ".opencode", "state", "read_audit.jsonl");
}

// ── Path & Agent Normalization ─────────────────────────────────

/**
 * Normalize a read audit file path for comparison and indexing.
 * Resolves to absolute, lowercased, trailing-slash-stripped.
 */
export function normalizeReadAuditPath(filePath: string): string {
  const root = process.env.OPENCODE_ROOT || ".";
  const resolved = filePath.startsWith("/") ? filePath : path.resolve(root, filePath);
  return path.normalize(resolved).replace(/\/+$/, "").toLowerCase();
}

/**
 * Normalize agent identity: strip @ prefix, lowercase.
 */
export function normalizeAgent(agent: string): string {
  return (agent || "").replace(/^@/, "").toLowerCase();
}

/**
 * Generate a deterministic event_key for idempotent DB writes.
 * Uses SHA-256 of all record fields joined by U+001F (unit separator).
 */
export function makeEventKey(entry: ReadAuditEntry): string {
  const parts = [
    entry.timestamp || "",
    normalizeAgent(entry.agent),
    normalizeReadAuditPath(entry.filePath || ""),
    entry.sessionId || "",
    entry.taskId || "",
    entry.callId || "",
  ];
  return crypto.createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

// ── DB Helpers ─────────────────────────────────────────────────

function toDbBindings(entry: ReadAuditEntry): any[] {
  const eventKey = makeEventKey(entry);
  const normalizedAgent = normalizeAgent(entry.agent);
  const normalizedPath = normalizeReadAuditPath(entry.filePath || "");
  const now = Date.now();
  return [
    eventKey,
    entry.timestamp,
    normalizedAgent,
    normalizedPath,
    entry.sessionId || null,
    entry.taskId || null,
    entry.callId || null,
    entry.agent,
    entry.filePath,
    now,
  ];
}

function dbEntryToReadAuditEntry(row: any): ReadAuditEntry {
  return {
    timestamp: row.timestamp,
    agent: row.raw_agent || row.agent,
    filePath: row.raw_file_path || row.file_path,
    sessionId: row.opencode_session_id || undefined,
    taskId: row.task_id || undefined,
    callId: row.call_id || undefined,
  };
}

// ── recordRead — DB-first with JSONL fallback ──────────────────

/**
 * Record a read event. DB INSERT first, JSONL append regardless (Phase 1 dual-write).
 * DB and JSONL writes are in SEPARATE try/catch blocks so DB failure
 * never prevents JSONL write (evidence preservation).
 */
export function recordRead(entry: ReadAuditEntry): void {
  let dbOk = false;
  let jsonlOk = false;

  // ── DB write ──
  try {
    const db = getDb();
    db.transaction(() => {
      db.run(
        `INSERT OR IGNORE INTO read_audit
         (event_key, timestamp, agent, file_path, opencode_session_id, task_id, call_id, raw_agent, raw_file_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        toDbBindings(entry),
      );
      // Capacity control: keep only last MAX_RECORDS
      db.run(
        `DELETE FROM read_audit
         WHERE id NOT IN (SELECT id FROM read_audit ORDER BY id DESC LIMIT ?)`,
        [MAX_RECORDS],
      );
    })();
    dbOk = true;
  } catch (err: any) {
    writeLog("lib-read-audit", "ERROR", {
      event: "READ_AUDIT_DB_WRITE_FAILED",
      detail: err.message,
    });
  }

  // ── JSONL fallback write (always, for Phase 1 dual-write) ──
  try {
    appendReadAuditJsonl(entry);
    cleanupOldRecordsJsonl();
    jsonlOk = true;
  } catch (err: any) {
    writeLog("lib-read-audit", "ERROR", {
      event: "READ_AUDIT_JSONL_WRITE_FAILED",
      detail: err.message,
    });
  }

  if (!dbOk && !jsonlOk) {
    writeLog("lib-read-audit", "ERROR", {
      event: "READ_AUDIT_WRITE_FAILED_BOTH",
      agent: entry.agent,
      filePath: entry.filePath,
    });
  } else {
    writeLog("lib-read-audit", "INFO", {
      event: "READ_RECORDED",
      agent: entry.agent,
      filePath: entry.filePath,
      db: dbOk,
      jsonl: jsonlOk,
    });
  }
}

// ── JSONL Helpers (Phase 1 fallback) ───────────────────────────

function appendReadAuditJsonl(entry: ReadAuditEntry): void {
  const auditPath = getReadAuditPath();
  const dir = path.dirname(auditPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(auditPath, line, "utf8");
}

function cleanupOldRecordsJsonl(): void {
  try {
    const auditPath = getReadAuditPath();
    if (!fs.existsSync(auditPath)) return;
    const content = fs.readFileSync(auditPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length <= MAX_RECORDS) return;
    const kept = lines.slice(-MAX_RECORDS);
    fs.writeFileSync(auditPath, kept.join("\n") + "\n", "utf8");
    writeLog("lib-read-audit", "INFO", {
      event: "READ_AUDIT_CLEANUP",
      pruned: lines.length - kept.length,
      remaining: kept.length,
    });
  } catch {
    // Non-critical
  }
}

function readAllJsonlEntries(): ReadAuditEntry[] {
  try {
    const auditPath = getReadAuditPath();
    if (!fs.existsSync(auditPath)) return [];
    const content = fs.readFileSync(auditPath, "utf8");
    return content.trim().split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean) as ReadAuditEntry[];
  } catch {
    return [];
  }
}

// ── verifyRead — DB-first with JSONL fallback ──────────────────

/**
 * Verify that an agent has read a specific file within the valid time window.
 * DB query first; falls back to JSONL scan on DB error.
 *
 * @param agent - Agent identity (e.g. "Orchestrator")
 * @param filePath - File path that must have been read
 * @param sessionId - Optional OpenCode session ID (ses_*).
 *                    Do NOT pass compliance gate session (cg_ses_*).
 *                    compliance-gate.ts does NOT pass this parameter.
 */
export function verifyRead(
  agent: string,
  filePath: string,
  sessionId?: string,
): ReadVerifyResult {
  const normalizedAgent = normalizeAgent(agent);
  const normalizedPath = normalizeReadAuditPath(filePath);
  const cutoff = Date.now() - READ_MAX_AGE_MS;
  const cutoffIso = new Date(cutoff).toISOString();

  // ── DB-first ──
  try {
    const db = getDb();
    let row: any = null;
    if (sessionId) {
      row = db.query(
        `SELECT timestamp, raw_agent, raw_file_path, opencode_session_id, task_id, call_id
         FROM read_audit
         WHERE agent = ? AND file_path = ? AND opencode_session_id = ? AND timestamp >= ?
         ORDER BY timestamp DESC LIMIT 1`,
      ).get(normalizedAgent, normalizedPath, sessionId, cutoffIso);
    } else {
      row = db.query(
        `SELECT timestamp, raw_agent, raw_file_path, opencode_session_id, task_id, call_id
         FROM read_audit
         WHERE agent = ? AND file_path = ? AND timestamp >= ?
         ORDER BY timestamp DESC LIMIT 1`,
      ).get(normalizedAgent, normalizedPath, cutoffIso);
    }

    if (row) {
      const matchedEntry = dbEntryToReadAuditEntry(row);
      return {
        verified: true,
        reason: `Agent "${matchedEntry.agent}" read "${matchedEntry.filePath}" at ${matchedEntry.timestamp}`,
        matchedEntry,
      };
    }

    // DB says no — check JSONL as fallback before final negative
    const jsonlResult = verifyReadJsonl(normalizedAgent, normalizedPath, sessionId, cutoff);
    if (jsonlResult.verified) return jsonlResult;

    const absPath = path.resolve(process.env.OPENCODE_ROOT || ".", filePath);
    return {
      verified: false,
      reason:
        `Agent "@${normalizedAgent}" has NOT read "${filePath}" via the \`read\` tool ` +
        `within the last ${READ_MAX_AGE_MS / 60000} minutes. ` +
        `You MUST use the \`read\` tool to open and review HANDOVER.md before approving. ` +
        `Compute hash manually: sha256sum ${absPath}`,
    };
  } catch (err: any) {
    writeLog("lib-read-audit", "ERROR", {
      event: "VERIFY_READ_DB_FAILED",
      error: err.message,
    });
    // Fallback to JSONL
    return verifyReadJsonl(normalizedAgent, normalizedPath, sessionId, cutoff);
  }
}

function verifyReadJsonl(
  normalizedAgent: string,
  normalizedPath: string,
  sessionId: string | undefined,
  cutoff: number,
): ReadVerifyResult {
  try {
    const entries = readAllJsonlEntries();
    const now = Date.now();

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const entryTime = new Date(entry.timestamp).getTime();
      if (entryTime < cutoff) break;

      const entryAgent = normalizeAgent(entry.agent);
      if (entryAgent !== normalizedAgent) continue;

      if (pathsMatch(entry.filePath, normalizedPath)) {
        if (sessionId && entry.sessionId && entry.sessionId !== sessionId) {
          continue;
        }
        return {
          verified: true,
          reason: `[JSONL] Agent "${entry.agent}" read "${entry.filePath}" at ${entry.timestamp}`,
          matchedEntry: entry,
        };
      }
    }

    return {
      verified: false,
      reason: `Agent "@${normalizedAgent}" has NOT read the file within the time window (checked DB + JSONL).`,
    };
  } catch (err: any) {
    return {
      verified: false,
      reason: `Read audit verification failed: ${err.message}`,
    };
  }
}

// ── pathsMatch (JSONL fallback helper) ─────────────────────────

function pathsMatch(p1: string, p2: string): boolean {
  const root = process.env.OPENCODE_ROOT || ".";
  const normalize = (p: string): string => {
    const resolved = p.startsWith("/") ? p : path.resolve(root, p);
    return path.normalize(resolved).replace(/\/+$/, "").toLowerCase();
  };
  try {
    return normalize(p1) === normalize(p2);
  } catch {
    return p1.toLowerCase() === p2.toLowerCase();
  }
}

// ── getReadEventsForSession — DB-first with JSONL fallback ─────

/**
 * Get all read events for a specific agent and OpenCode session.
 * DB query first; falls back to JSONL scan on DB error.
 *
 * @param agent - Agent identity (e.g., "@Coder-BE")
 * @param sessionId - OpenCode session ID (e.g., "ses_126bd8762...")
 *                    This is NOT a compliance gate session (cg_ses_*).
 * @returns Array of matching read audit entries, newest first
 */
export function getReadEventsForSession(
  agent: string,
  sessionId: string,
): ReadAuditEntry[] {
  const normalizedAgent = normalizeAgent(agent);

  // ── DB-first ──
  try {
    const db = getDb();
    const rows = db.query(
      `SELECT timestamp, raw_agent, raw_file_path, opencode_session_id, task_id, call_id
       FROM read_audit
       WHERE opencode_session_id = ? AND agent = ?
       ORDER BY timestamp DESC`,
    ).all(sessionId, normalizedAgent) as any[];

    if (rows.length > 0) {
      return rows.map(dbEntryToReadAuditEntry);
    }
    // DB empty — check JSONL fallback
    return getReadEventsForSessionJsonl(normalizedAgent, sessionId);
  } catch (err: any) {
    writeLog("lib-read-audit", "ERROR", {
      event: "GET_READ_EVENTS_DB_FAILED",
      error: err.message,
    });
    return getReadEventsForSessionJsonl(normalizedAgent, sessionId);
  }
}

function getReadEventsForSessionJsonl(
  normalizedAgent: string,
  sessionId: string,
): ReadAuditEntry[] {
  try {
    const entries = readAllJsonlEntries();
    const results: ReadAuditEntry[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const entryAgent = normalizeAgent(entry.agent);
      if (entryAgent === normalizedAgent && entry.sessionId === sessionId) {
        results.push(entry);
      }
    }
    return results;
  } catch (err: any) {
    writeLog("lib-read-audit", "ERROR", {
      event: "GET_READ_EVENTS_FAILED",
      error: err.message,
    });
    return [];
  }
}

// ── Re-export constants ────────────────────────────────────────

export { READ_MAX_AGE_MS, MAX_RECORDS };
