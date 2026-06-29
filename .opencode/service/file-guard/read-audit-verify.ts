// service/file-guard/read-audit-verify.ts — Read audit verification
// Source: read-audit.ts verify functions

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { getDb } from "../../lib/db-manager";
import { STATE_PATHS } from "../../lib/state-utils";
import { normalizeReadAuditPath, normalizeAgent, type ReadAuditEntry } from "./read-audit-write";

export interface ReadVerifyResult {
  verified: boolean;
  reason: string;
  matchedEntry?: ReadAuditEntry;
}

const READ_MAX_AGE_MS_DEFAULT = 5 * 60 * 1000;

function getReadMaxAgeMs(): number {
  try {
    const configPath = path.resolve(process.env.OPENCODE_ROOT || ".", ".opencode/project.config.json");
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    const configured = config?.template_resolution?.read_max_age_ms;
    if (typeof configured === "number" && configured > 0 && configured < 3600000) return configured;
  } catch { /* fallback */ }
  return READ_MAX_AGE_MS_DEFAULT;
}

function dbEntryToReadAuditEntry(row: any): ReadAuditEntry {
  return {
    timestamp: row.timestamp, agent: row.raw_agent || row.agent,
    filePath: row.raw_file_path || row.file_path,
    sessionId: row.opencode_session_id || undefined,
    taskId: row.task_id || undefined, callId: row.call_id || undefined,
  };
}

export function verifyRead(agent: string, filePath: string, sessionId?: string): ReadVerifyResult {
  const normalizedAgent = normalizeAgent(agent);
  const normalizedPath = normalizeReadAuditPath(filePath);
  const readMaxAgeMs = getReadMaxAgeMs();
  const cutoff = Date.now() - readMaxAgeMs;
  const cutoffIso = new Date(cutoff).toISOString();

  try {
    const db = getDb();
    let row: any = null;
    if (sessionId) {
      row = db.query(`SELECT timestamp, raw_agent, raw_file_path, opencode_session_id, task_id, call_id FROM read_audit WHERE agent = ? AND file_path = ? AND opencode_session_id = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT 1`).get(normalizedAgent, normalizedPath, sessionId, cutoffIso);
    } else {
      row = db.query(`SELECT timestamp, raw_agent, raw_file_path, opencode_session_id, task_id, call_id FROM read_audit WHERE agent = ? AND file_path = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT 1`).get(normalizedAgent, normalizedPath, cutoffIso);
    }
    if (row) {
      const matchedEntry = dbEntryToReadAuditEntry(row);
      return { verified: true, reason: `Agent "${matchedEntry.agent}" read "${matchedEntry.filePath}" at ${matchedEntry.timestamp}`, matchedEntry };
    }
    const absPath = path.resolve(process.env.OPENCODE_ROOT || ".", filePath);
    return { verified: false, reason: `Agent "@${normalizedAgent}" has NOT read "${filePath}" via the \`read\` tool within the last ${readMaxAgeMs / 60000} minutes. You MUST use the \`read\` tool to open and review HANDOVER.md before approving. Compute hash manually: sha256sum ${absPath}` };
  } catch (err: any) {
    writeLog("service-read-audit", "ERROR", { event: "VERIFY_READ_DB_FAILED", error: err.message });
    return { verified: false, reason: `Read audit DB query failed: ${err.message}.` };
  }
}

export function verifyNonEmptyReadSet(input: { agent: string; sessionId?: string; filePaths: string[]; windowMs?: number }): { verified: boolean; reason: string; emptyTargets: boolean; notRead: string[] } {
  if (!input.filePaths || input.filePaths.length === 0 || input.filePaths.every(p => !p || p.trim() === "")) {
    writeLog("service-read-audit", "WARN", { event: "READ_BEFORE_APPROVE_FAILED_EMPTY_TARGETS", agent: input.agent });
    return { verified: false, reason: "Empty target file list", emptyTargets: true, notRead: [] };
  }
  const notRead: string[] = [];
  for (const fp of input.filePaths) {
    if (!fp || fp.trim() === "") continue;
    const result = verifyRead(input.agent, fp, input.sessionId);
    if (!result.verified) notRead.push(fp);
  }
  if (notRead.length > 0) {
    writeLog("service-read-audit", "WARN", { event: "READ_BEFORE_APPROVE_FAILED_NOT_READ", agent: input.agent, notReadCount: notRead.length });
    return { verified: false, reason: `Agent "${input.agent}" has not read ${notRead.length} of ${input.filePaths.length} deliverables: ${notRead.slice(0, 5).join(", ")}${notRead.length > 5 ? ` (+${notRead.length - 5} more)` : ""}`, emptyTargets: false, notRead };
  }
  return { verified: true, reason: `All ${input.filePaths.length} deliverables verified`, emptyTargets: false, notRead: [] };
}

export function getReadEventsForSession(agent: string, sessionId: string): ReadAuditEntry[] {
  const normalizedAgent = normalizeAgent(agent);
  try {
    const db = getDb();
    const rows = db.query(`SELECT timestamp, raw_agent, raw_file_path, opencode_session_id, task_id, call_id FROM read_audit WHERE opencode_session_id = ? AND agent = ? ORDER BY timestamp DESC`).all(sessionId, normalizedAgent) as any[];
    if (rows.length > 0) return rows.map(dbEntryToReadAuditEntry);
    return [];
  } catch (err: any) {
    writeLog("service-read-audit", "ERROR", { event: "GET_READ_EVENTS_DB_FAILED", error: err.message });
    return [];
  }
}

export { getReadMaxAgeMs, READ_MAX_AGE_MS_DEFAULT as READ_MAX_AGE_MS };
