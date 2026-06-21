// db-state-manager.ts — SQLite CRUD API layer (replaces substate-manager)
// ═══════════════════════════════════════════════════════════════════════
// P2-A: Database migration — Step 1.
//
// Public API (mirrors substate-manager.ts for drop-in replacement):
//   - dbReadSubState(key)         → read from substate_kv.json
//   - dbWriteSubState(key, value) → atomic write to substate_kv
//   - dbAtomicWriteSubState(key, modifyFn, maxRetries?) → read-modify-write
//   - dbReadMachineMeta() / dbWriteMachineMeta(value)
//
// Gate-state-specific (Step 3 wiring):
//   - dbLoadGateStore() / dbSaveGateStore(store)
//
// Audit log (Step 4 wiring):
//   - dbWriteAuditLogEntry(entry) / dbFlushAuditTrail(sessionID)
//
// Design: substate_kv stores full JSON blob. Backward compatibility is
// guaranteed because the blob is the single source of truth; typed tables
// are populated separately as a structured-query optimization layer.
//
// @author @Super-Admin
// @version 1.0.0
// @since 2026-06-16
//
// @see docs/review/framework-refactor/database-migration-plan.md (Step 1)
// ═══════════════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "./log-manager";
import { getDb } from "./db-manager";
import { SUBSTATE_FILES } from "./substate-manager";
import type { SubStateKey, SubStateMap } from "./substate-types";

const SRC = "lib-db-state-manager";

// ════════════════════════════════════════════════════════════
// SUBSTATE KV
// ════════════════════════════════════════════════════════════

/**
 * Read a sub-state from the DB. Returns the parsed JSON blob.
 * Returns null if the row does not exist (caller should fallback to JSON file).
 *
 * Equivalent to: readSubState(key) in substate-manager.ts.
 * Failures are logged and return null.
 */
export function dbReadSubState<K extends SubStateKey>(
  key: K,
): SubStateMap[K] | null {
  try {
    const db = getDb();
    const row = db
      .query("SELECT json FROM substate_kv WHERE key = ?")
      .get(key) as { json: string } | null;

    if (!row) return null;
    return JSON.parse(row.json);
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-READ-SUBSTATE-FAILED",
      detail: `key=${key} err=${e.message}`,
    });
    return null;
  }
}

/**
 * Write a sub-state to the DB atomically (single-row UPSERT).
 *
 * Equivalent to: writeSubState(key, value) in substate-manager.ts.
 *
 * @returns true on success, false on failure.
 */
export function dbWriteSubState<K extends SubStateKey>(
  key: K,
  value: SubStateMap[K],
): boolean {
  try {
    const db = getDb();
    const json = JSON.stringify(value);
    const now = Date.now();

    // Use INSERT OR REPLACE for atomic upsert
    const writeSubState = db.transaction((k: string, j: string, t: number) => {
      db.run(
        "INSERT OR REPLACE INTO substate_kv (key, json, updated_at) VALUES (?, ?, ?)",
        [k, j, t],
      );
    });

    writeSubState(key as string, json, now);
    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-WRITE-SUBSTATE-FAILED",
      detail: `key=${key} err=${e.message}`,
    });
    return false;
  }
}

/**
 * Atomic read-modify-write for a sub-state.
 *
 * Reads current value (or {} if none), invokes modifyFn(currentValue),
 * then writes back. Wrapped in a SQLite transaction for atomicity.
 *
 * Equivalent to: atomicWriteSubState(key, modifyFn) in state-utils.ts.
 *
 * @param key - Sub-state key (from SUBSTATE_FILES)
 * @param modifyFn - Mutates the in-memory value (return void)
 * @param maxRetries - Unused (kept for API compatibility; SQLite handles locking internally)
 * @returns true on success
 */
export function dbAtomicWriteSubState<K extends SubStateKey>(
  key: K,
  modifyFn: (subState: SubStateMap[K]) => void,
  maxRetries: number = 3,
): boolean {
  try {
    const db = getDb();

    const txn = db.transaction((k: string) => {
      const row = db
        .query("SELECT json FROM substate_kv WHERE key = ?")
        .get(k) as { json: string } | null;

      let current: any = row ? JSON.parse(row.json) : {};
      modifyFn(current);

      const json = JSON.stringify(current);
      const now = Date.now();
      db.run(
        "INSERT OR REPLACE INTO substate_kv (key, json, updated_at) VALUES (?, ?, ?)",
        [k, json, now],
      );
    });

    txn(key as string);
    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-ATOMIC-WRITE-FAILED",
      detail: `key=${key} err=${e.message}`,
    });
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// FILE BASELINE (P3/G11: cross-process TOCTOU detection)
// ════════════════════════════════════════════════════════════

export interface FileBaselineSnapshot {
  inode: number;
  size: number;
  mtime: number;
  ctime: number;
  dev: number;
  updated_at: number;
  process_id: number;
}

/**
 * Read a file baseline snapshot from the DB (file_baseline_kv table).
 * Used by writeSafe() / safeDelete() for cross-process TOCTOU detection.
 *
 * @param pathHash - Hex-encoded file path (same key format as acquireLock).
 * @returns The baseline snapshot, or null if not found / DB failure.
 */
export function dbReadFileBaseline(
  pathHash: string,
): FileBaselineSnapshot | null {
  try {
    const db = getDb();
    const row = db
      .query(
        "SELECT inode, size, mtime, ctime, dev, updated_at, process_id FROM file_baseline_kv WHERE path_hash = ?",
      )
      .get(pathHash) as FileBaselineSnapshot | null;
    return row || null;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-READ-FILE-BASELINE-FAILED",
      detail: `pathHash=${pathHash} err=${e.message}`,
    });
    return null;
  }
}

/**
 * Write (or update) a file baseline snapshot in the DB atomically.
 * Called by writeSafe() when populating the baseline for cross-process TOCTOU.
 *
 * @returns true on success, false on failure.
 */
export function dbWriteFileBaseline(
  pathHash: string,
  snapshot: FileBaselineSnapshot,
): boolean {
  try {
    const db = getDb();
    const txn = db.transaction((h: string, s: FileBaselineSnapshot) => {
      db.run(
        "INSERT OR REPLACE INTO file_baseline_kv (path_hash, inode, size, mtime, ctime, dev, updated_at, process_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          h,
          s.inode,
          s.size,
          s.mtime,
          s.ctime,
          s.dev,
          s.updated_at,
          s.process_id,
        ],
      );
    });
    txn(pathHash, snapshot);
    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-WRITE-FILE-BASELINE-FAILED",
      detail: `pathHash=${pathHash} err=${e.message}`,
    });
    return false;
  }
}

/**
 * Delete a file baseline entry from the DB.
 * Called after writeSafe() succeeds (baseline consumed; next write re-establishes).
 *
 * @returns true on success, false on failure.
 */
export function dbDeleteFileBaseline(pathHash: string): boolean {
  try {
    const db = getDb();
    db.run("DELETE FROM file_baseline_kv WHERE path_hash = ?", [pathHash]);
    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-DELETE-FILE-BASELINE-FAILED",
      detail: `pathHash=${pathHash} err=${e.message}`,
    });
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// MACHINE META
// ════════════════════════════════════════════════════════════

/**
 * Read machine.json (meta + contracts) from DB.
 * Returns { meta: {...}, contracts: [...] } shape, matching readMachineMeta().
 */
export function dbReadMachineMeta(): any {
  try {
    const db = getDb();
    const result: any = { meta: {}, contracts: [] };

    // Read meta rows
    const metaRows = db
      .query("SELECT key, value FROM machine_meta")
      .all() as Array<{
      key: string;
      value: string;
    }>;
    for (const row of metaRows) {
      try {
        result.meta[row.key] = JSON.parse(row.value);
      } catch {
        result.meta[row.key] = row.value;
      }
    }

    // Read contracts
    const contractRows = db
      .query("SELECT contract_path FROM machine_contracts")
      .all() as Array<{
      contract_path: string;
    }>;
    result.contracts = contractRows.map((r) => r.contract_path);

    return result;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-READ-MACHINE-META-FAILED",
      detail: e.message,
    });
    return { meta: {}, contracts: [] };
  }
}

/**
 * Write machine.json (meta + contracts) to DB atomically.
 * Matches writeMachineMeta() semantics.
 */
// S2-1 (P3/G2): snake_case legacy fields to exclude when writing machine_meta.
// Only camelCase 'lastUpdated' is canonical; 'last_updated' (3-week-old stale) is filtered.
const LEGACY_META_KEYS = new Set(["last_updated"]);

export function dbWriteMachineMeta(value: any): boolean {
  try {
    const db = getDb();
    const now = Date.now();

    const txn = db.transaction((v: any) => {
      // Clear and re-insert meta (excluding legacy snake_case fields)
      db.run("DELETE FROM machine_meta");
      const meta = v.meta || {};
      for (const [k, val] of Object.entries(meta)) {
        if (LEGACY_META_KEYS.has(k)) continue; // S2-1: filter legacy
        const jsonVal =
          typeof val === "string" ? JSON.stringify(val) : JSON.stringify(val);
        db.run(
          "INSERT OR REPLACE INTO machine_meta (key, value, updated_at) VALUES (?, ?, ?)",
          [k, jsonVal, now],
        );
      }

      // Clear and re-insert contracts
      db.run("DELETE FROM machine_contracts");
      const contracts = v.contracts || [];
      for (const cp of contracts) {
        db.run(
          "INSERT OR REPLACE INTO machine_contracts (contract_path, updated_at) VALUES (?, ?)",
          [cp, now],
        );
      }
    });

    txn(value);
    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-WRITE-MACHINE-META-FAILED",
      detail: e.message,
    });
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// GATE-STATE (Step 3 placeholder — implemented here, wired later)
// ════════════════════════════════════════════════════════════

/**
 * Load GateStore from DB tables (gate_sessions, gate_store_meta, gate_audit_history).
 * Returns a GateStore-compatible shape.
 *
 * Implementation: reconstructs the full GateStore object from normalized tables
 * to maintain drop-in compatibility with gate-core.loadGateStore().
 */
export function dbLoadGateStore(): any {
  try {
    const db = getDb();

    // Read store meta (formatVersion, last_updated)
    const metaRows = db
      .query("SELECT key, value FROM gate_store_meta")
      .all() as Array<{
      key: string;
      value: string;
    }>;
    const meta: Record<string, any> = {};
    for (const row of metaRows) {
      try {
        meta[row.key] = JSON.parse(row.value);
      } catch {
        meta[row.key] = row.value;
      }
    }

    // Read active_sessions (stored as JSON array in meta)
    const activeSessions: string[] = Array.isArray(meta.active_sessions)
      ? meta.active_sessions
      : [];

    // Read all sessions
    const sessionRows = db.query("SELECT * FROM gate_sessions").all() as any[];
    const sessions: Record<string, any> = {};
    for (const row of sessionRows) {
      sessions[row.session_id] = reconstructGateSession(row);
    }

    // Read audit_history
    const auditRows = db
      .query("SELECT * FROM gate_audit_history ORDER BY id ASC")
      .all() as any[];
    const audit_history = auditRows.map(reconstructAuditEntry);

    return {
      formatVersion: meta.formatVersion || "2.0",
      sessions,
      active_sessions: activeSessions,
      audit_history,
      last_updated: meta.last_updated || null,
    };
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-LOAD-GATE-STORE-FAILED",
      detail: e.message,
    });
    return {
      formatVersion: "2.0",
      sessions: {},
      active_sessions: [],
      last_updated: null,
    };
  }
}

/**
 * Save GateStore to DB tables atomically.
 */
export function dbSaveGateStore(store: any): boolean {
  try {
    const db = getDb();
    const now = Date.now();

    const txn = db.transaction((s: any) => {
      // Save meta
      db.run("DELETE FROM gate_store_meta");
      const metaEntries: Array<[string, any]> = [
        ["formatVersion", s.formatVersion || "2.0"],
        ["last_updated", s.last_updated || new Date().toISOString()],
        ["active_sessions", s.active_sessions || []],
      ];
      for (const [k, v] of metaEntries) {
        db.run(
          "INSERT OR REPLACE INTO gate_store_meta (key, value, updated_at) VALUES (?, ?, ?)",
          [k, JSON.stringify(v), now],
        );
      }

      // Replace all sessions
      db.run("DELETE FROM gate_sessions");
      const sessions = s.sessions || {};
      const insertSession = db.prepare(`
        INSERT INTO gate_sessions (
          session_id, task_desc, status, agent, task_id, plan_summary,
          execution_summary, mode, checked_at, armed_at, completed_at, drained_at,
          created_at, consumed_at, expires_at, enforcement_mode, last_check_passed,
          failed_items, missing_artifacts, fail_reason, worktree, audit, updated_at,
          declared_deliverables, submitted_deliverables, deliverables_approved_by,
          deliverables_approved_at, deliverables_approval_note, approval_required
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?
        )
      `);
      for (const [sid, ses] of Object.entries(sessions) as Array<
        [string, any]
      >) {
        insertSession.run(
          sid,
          ses.task_description || "",
          ses.gate_status || "checked",
          ses.agent || null,
          ses.task_id || null,
          ses.plan_summary || null,
          ses.audit?.execution_summary || null,
          ses.enforcement_mode || null,
          parseTs(ses.checked_at || ses.created_at),
          parseTs(ses.confirmed_at),
          parseTs(ses.consumed_at),
          null, // drained_at
          parseTs(ses.created_at) || now,
          parseTs(ses.consumed_at),
          parseTs(ses.expires_at),
          ses.enforcement_mode || null,
          ses.last_check_passed ? 1 : 0,
          JSON.stringify(ses.last_check_failed_items || []),
          JSON.stringify(ses.missing_artifacts || []),
          ses.fail_reason || null,
          ses.worktree || null,
          JSON.stringify(ses.audit || null),
          now,
          // v5: deliverables fields
          ses.declared_deliverables
            ? JSON.stringify(ses.declared_deliverables)
            : null,
          ses.submitted_deliverables
            ? JSON.stringify(ses.submitted_deliverables)
            : null,
          ses.deliverables_approved_by || null,
          parseTs(ses.deliverables_approved_at),
          ses.deliverables_approval_note || null,
          ses.approval_required ? 1 : 0,
        );
      }

      // Update session index
      db.run("DELETE FROM gate_session_index");
      const insertIdx = db.prepare(
        "INSERT INTO gate_session_index (session_id, status, last_updated) VALUES (?, ?, ?)",
      );
      for (const [sid, ses] of Object.entries(sessions) as Array<
        [string, any]
      >) {
        insertIdx.run(sid, ses.gate_status || "checked", now);
      }

      // Replace audit_history (append-only — but GateStore always provides full array)
      db.run("DELETE FROM gate_audit_history");
      const insertAudit = db.prepare(`
        INSERT INTO gate_audit_history (
          session_id, task_description, plan_summary, agent, task_id,
          confirmed_at, consumed_at, execution_summary, gate_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const history = s.audit_history || [];
      for (const entry of history) {
        insertAudit.run(
          entry.session_id,
          entry.task_description || null,
          entry.plan_summary || null,
          entry.agent || null,
          entry.task_id || null,
          parseTs(entry.confirmed_at),
          parseTs(entry.consumed_at),
          entry.execution_summary || null,
          entry.gate_status || null,
        );
      }
    });

    txn(store);
    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-SAVE-GATE-STORE-FAILED",
      detail: e.message,
    });
    return false;
  }
}

/** Parse ISO timestamp string to Unix ms; returns null on failure. */
function parseTs(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  return null;
}

/** Reconstruct GateSession from a DB row. */
function reconstructGateSession(row: any): any {
  return {
    session_id: row.session_id,
    created_at: toIso(row.created_at),
    task_description: row.task_desc || "",
    enforcement_mode: row.enforcement_mode || row.mode,
    gate_status: row.status,
    last_check_passed: row.last_check_passed === 1,
    last_check_failed_items: safeParse(row.failed_items, []),
    plan_summary: row.plan_summary || null,
    confirmed_at: toIso(row.armed_at),
    consumed_at: toIso(row.consumed_at),
    expires_at: toIso(row.expires_at),
    task_id: row.task_id || null,
    agent: row.agent || undefined,
    worktree: row.worktree || undefined,
    audit: safeParse(row.audit, null),
    fail_reason: row.fail_reason || undefined,
    missing_artifacts: safeParse(row.missing_artifacts, []),

    // v5: deliverables hard constraint fields
    declared_deliverables: safeParse(row.declared_deliverables, undefined),
    submitted_deliverables: safeParse(row.submitted_deliverables, undefined),
    deliverables_approved_by: row.deliverables_approved_by || undefined,
    deliverables_approved_at: toIso(row.deliverables_approved_at),
    deliverables_approval_note: row.deliverables_approval_note || undefined,
    approval_required: row.approval_required === 1,
  };
}

function reconstructAuditEntry(row: any): any {
  return {
    session_id: row.session_id,
    task_description: row.task_description || undefined,
    plan_summary: row.plan_summary || null,
    agent: row.agent || undefined,
    task_id: row.task_id || null,
    confirmed_at: toIso(row.confirmed_at),
    consumed_at: toIso(row.consumed_at),
    execution_summary: row.execution_summary || undefined,
    gate_status: row.gate_status || undefined,
  };
}

function toIso(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  return new Date(ms).toISOString();
}

function safeParse<T>(json: string | null, fallback: T): T {
  if (json === null) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// ════════════════════════════════════════════════════════════
// AUDIT LOG (Step 4 placeholder — implemented here, wired later)
// ════════════════════════════════════════════════════════════

/**
 * Append an audit log entry to the audit_log table.
 * Equivalent to: writeAuditLogEntry() in audit-log.ts.
 */
export function dbWriteAuditLogEntry(entry: {
  session_id?: string;
  agent?: string;
  event_type: string;
  detail?: unknown;
  timestamp?: number;
}): void {
  try {
    const db = getDb();
    db.run(
      `INSERT INTO audit_log (session_id, agent, event_type, detail, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entry.session_id || null,
        entry.agent || null,
        entry.event_type,
        entry.detail === undefined
          ? null
          : typeof entry.detail === "string"
            ? entry.detail
            : JSON.stringify(entry.detail),
        entry.timestamp || Date.now(),
      ],
    );
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-AUDIT-WRITE-FAILED",
      detail: e.message,
    });
  }
}

/**
 * Flush audit trail for a session: move pending entries into audit_trail table.
 * Equivalent to: flushAuditTrail(sessionID) in audit-log.ts.
 */
export function dbFlushAuditTrail(sessionID: string, trailData: unknown): void {
  try {
    const db = getDb();
    const now = Date.now();
    const trail =
      typeof trailData === "string" ? trailData : JSON.stringify(trailData);

    const txn = db.transaction((sid: string, data: string, t: number) => {
      db.run(
        "INSERT OR REPLACE INTO audit_trail (session_id, trail_data, updated_at) VALUES (?, ?, ?)",
        [sid, data, t],
      );
    });

    txn(sessionID, trail, now);
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-AUDIT-FLUSH-FAILED",
      detail: `session=${sessionID} err=${e.message}`,
    });
  }
}

// ════════════════════════════════════════════════════════════
// MIGRATION (JSON → DB)
// ════════════════════════════════════════════════════════════

export interface MigrationResult {
  migrated: string[];
  failed: string[];
  skipped: string[];
  total_bytes: number;
}

/**
 * Migrate all JSON sub-state files into the DB (substate_kv table).
 * Idempotent — existing rows are overwritten.
 *
 * Called once during initial rollout. After this, dual-write layer
 * (Step 2) keeps DB and JSON in sync.
 */

// ════════════════════════════════════════════════════════════
// COMPACTOR DB SYNC (P3/S63-3, S63-4)
// ════════════════════════════════════════════════════════════

/**
 * Sync compactor's hot state (active_sessions + recent_sessions) to DB tables.
 * Called by state-compactor after every public method to keep DB consistent.
 *
 * Strategy: Non-fatal on failure. JSON remains primary; DB is shadow for
 * reconciliation and future DB-first migration.
 */
export function dbSyncCompactorHot(hotState: any): boolean {
  try {
    const db = getDb();
    const now = Date.now();
    const txn = db.transaction((hs: any) => {
      // Sync active_sessions → gate_sessions (status='armed'/'checked'/'pending'/'active')
      const active = hs.active_sessions || {};
      for (const [sid, ses] of Object.entries(active) as Array<[string, any]>) {
        db.run(
          `
          INSERT OR REPLACE INTO gate_sessions
            (session_id, task_desc, status, agent, task_id, plan_summary, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            sid,
            ses.task_description || "",
            ses.gate_status || "armed",
            ses.agent || null,
            ses.task_id || null,
            ses.plan_summary || null,
            parseTs(ses.created_at) || now,
            now,
          ],
        );
        db.run(
          "INSERT OR REPLACE INTO gate_session_index (session_id, status, last_updated) VALUES (?, ?, ?)",
          [sid, ses.gate_status || "armed", now],
        );
      }
      // Sync recent_sessions → gate_sessions (status='completed')
      const recent = hs.recent_sessions || {};
      for (const [sid, ses] of Object.entries(recent) as Array<[string, any]>) {
        db.run(
          `
          INSERT OR REPLACE INTO gate_sessions
            (session_id, task_desc, status, created_at, consumed_at, updated_at)
          VALUES (?, ?, 'completed', ?, ?, ?)
        `,
          [
            sid,
            ses.task_description || "",
            parseTs(ses.created_at) || now,
            parseTs(ses.consumed_at),
            now,
          ],
        );
        db.run(
          "INSERT OR REPLACE INTO gate_session_index (session_id, status, last_updated) VALUES (?, 'completed', ?)",
          [sid, now],
        );
      }
    });
    txn(hotState);
    return true;
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-SYNC-COMPACTOR-HOT-FAILED",
      detail: e.message,
    });
    return false;
  }
}

/**
 * Mark a session as 'archived' in DB (S63-3 archive flow).
 * Called by state-compactor.archiveSession() after moving to archive file.
 */
export function dbMarkSessionArchived(sessionId: string): boolean {
  try {
    const db = getDb();
    const now = Date.now();
    db.run(
      "UPDATE gate_sessions SET status = 'archived', updated_at = ? WHERE session_id = ?",
      [now, sessionId],
    );
    db.run(
      "UPDATE gate_session_index SET status = 'archived', last_updated = ? WHERE session_id = ?",
      [now, sessionId],
    );
    return true;
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-MARK-ARCHIVED-FAILED",
      detail: `sid=${sessionId} err=${e.message}`,
    });
    return false;
  }
}

/**
 * Mark a session as 'drained' in DB (S63-3 drain flow).
 * Called by state-compactor.drainStaleSessions().
 */
export function dbMarkSessionDrained(sessionId: string): boolean {
  try {
    const db = getDb();
    const now = Date.now();
    db.run(
      "UPDATE gate_sessions SET status = 'drained', drained_at = ?, updated_at = ? WHERE session_id = ?",
      [now, now, sessionId],
    );
    db.run(
      "UPDATE gate_session_index SET status = 'drained', last_updated = ? WHERE session_id = ?",
      [now, sessionId],
    );
    return true;
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-MARK-DRAINED-FAILED",
      detail: `sid=${sessionId} err=${e.message}`,
    });
    return false;
  }
}

/**
 * Archive a drained gate session to the gate_drained_sessions table.
 * Replaces JSON file archival (writeJsonFile → gate-state.drained_sessions.json).
 * INSERT OR REPLACE ensures idempotency for repeated drain attempts.
 */
export function dbArchiveDrainedSession(
  sessionId: string,
  originalTaskDesc: string,
  drainReason: string,
  drainType: string,
  originalData: string,
): boolean {
  try {
    const db = getDb();
    db.run(
      `INSERT OR REPLACE INTO gate_drained_sessions
        (session_id, original_task_desc, drain_reason, drain_type, drained_at, original_data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        originalTaskDesc,
        drainReason,
        drainType,
        Date.now(),
        originalData,
      ],
    );
    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-ARCHIVE-DRAINED-FAILED",
      detail: `sid=${sessionId} err=${e.message}`,
    });
    return false;
  }
}

/**
 * Count total archived drained sessions in DB.
 */
export function dbCountDrainedSessions(): number {
  try {
    const db = getDb();
    const row = db
      .query("SELECT COUNT(*) AS c FROM gate_drained_sessions")
      .get() as { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Read compactor hot view directly from DB (S63-4: DB-first read).
 * Returns shape compatible with GateStateHot.
 * Falls back to empty hot state if DB unavailable.
 */
export function dbReadCompactorHot(): any {
  try {
    const db = getDb();
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;

    // Active: status in active-like values
    const activeRows = db
      .query(
        `
      SELECT * FROM gate_sessions
      WHERE status IN ('armed', 'checked', 'pending', 'active', 'confirmed')
    `,
      )
      .all() as any[];
    const active_sessions: Record<string, any> = {};
    for (const row of activeRows) {
      active_sessions[row.session_id] = reconstructGateSession(row);
    }

    // Recent: completed within 7 days
    const recentRows = db
      .query(
        `
      SELECT * FROM gate_sessions
      WHERE status = 'completed' AND (consumed_at >= ? OR updated_at >= ?)
    `,
        [sevenDaysAgo, sevenDaysAgo],
      )
      .all() as any[];
    const recent_sessions: Record<string, any> = {};
    for (const row of recentRows) {
      recent_sessions[row.session_id] = reconstructGateSession(row);
    }

    return {
      formatVersion: "3.0",
      active_sessions,
      recent_sessions,
      meta: {
        total_sessions: activeRows.length + recentRows.length,
        active_count: activeRows.length,
        recent_count: recentRows.length,
        last_compacted: new Date().toISOString(),
      },
    };
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-READ-COMPACTOR-HOT-FAILED",
      detail: e.message,
    });
    return {
      formatVersion: "3.0",
      active_sessions: {},
      recent_sessions: {},
      meta: {
        total_sessions: 0,
        active_count: 0,
        recent_count: 0,
        last_compacted: new Date().toISOString(),
      },
    };
  }
}

/**
 * A8: Write compactor history entry to gate_audit_history table.
 * DB-first — INSERT with compactor_event and archive_path.
 * Also materializes JSONL file as durable export cache (non-fatal).
 *
 * @returns true on successful DB write, false otherwise
 */
export function dbWriteCompactorHistory(entry: {
  session_id: string;
  task_description: string;
  plan_summary?: string;
  execution_summary?: string;
  agent?: string;
  task_id?: string;
  confirmed_at?: number;
  consumed_at?: number;
  gate_status?: string;
  compactor_event: string;
  archive_path?: string;
}): boolean {
  try {
    const db = getDb();
    const now = Date.now();
    db.run(
      `
      INSERT INTO gate_audit_history
        (session_id, task_description, plan_summary, execution_summary,
         agent, task_id, confirmed_at, consumed_at, gate_status,
         compactor_event, archive_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        entry.session_id,
        entry.task_description || "",
        entry.plan_summary || null,
        entry.execution_summary || null,
        entry.agent || null,
        entry.task_id || null,
        entry.confirmed_at || null,
        entry.consumed_at || now,
        entry.gate_status || "completed",
        entry.compactor_event || "warm",
        entry.archive_path || null,
      ],
    );
    writeLog(SRC, "INFO", {
      event: "GATE-HISTORY-DB-WRITTEN",
      detail: `sid=${entry.session_id} event=${entry.compactor_event}`,
    });
    return true;
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "GATE-HISTORY-DB-WRITE-FAILED",
      detail: `sid=${entry.session_id} err=${e.message}`,
    });
    return false;
  }
}

/**
 * A8: UPSERT a compactor index entry.
 * DB-first — gate_compactor_index is authoritative.
 * Also materializes gate-state.index.json as export cache (non-fatal).
 *
 * @returns true on successful DB upsert, false otherwise
 */
export function dbUpsertCompactorIndex(entry: {
  session_id: string;
  status: string;
  created_at: number;
  consumed_at?: number;
  drained_at?: number;
  archive_ref?: string;
}): boolean {
  try {
    const db = getDb();
    const now = Date.now();
    db.run(
      `
      INSERT INTO gate_compactor_index
        (session_id, status, created_at, consumed_at, drained_at, archive_ref, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        status = excluded.status,
        consumed_at = COALESCE(excluded.consumed_at, gate_compactor_index.consumed_at),
        drained_at = COALESCE(excluded.drained_at, gate_compactor_index.drained_at),
        archive_ref = COALESCE(excluded.archive_ref, gate_compactor_index.archive_ref),
        updated_at = excluded.updated_at
    `,
      [
        entry.session_id,
        entry.status,
        entry.created_at,
        entry.consumed_at || null,
        entry.drained_at || null,
        entry.archive_ref || null,
        now,
      ],
    );
    writeLog(SRC, "INFO", {
      event: "GATE-COMPACTOR-INDEX-UPDATED",
      detail: `sid=${entry.session_id} status=${entry.status}`,
    });
    return true;
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "GATE-COMPACTOR-INDEX-UPSERT-FAILED",
      detail: `sid=${entry.session_id} err=${e.message}`,
    });
    return false;
  }
}

/**
 * A8: Read all rows from gate_compactor_index.
 * Returns Record<session_id, compactor index entry>.
 */
export function dbReadCompactorIndex(): Record<string, any> {
  try {
    const db = getDb();
    const rows = db.query("SELECT * FROM gate_compactor_index").all() as any[];
    const result: Record<string, any> = {};
    for (const row of rows) {
      result[row.session_id] = {
        session_id: row.session_id,
        status: row.status,
        created_at: toIso(row.created_at),
        consumed_at: toIso(row.consumed_at),
        drained_at: toIso(row.drained_at),
        archive_ref: row.archive_ref,
      };
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * A8: Read compactor hot state from DB (merged view).
 * Joins gate_sessions (active/recent) + gate_drained_sessions (drained).
 * Falls back to empty state on DB failure.
 *
 * @returns GateStateHot-compatible object
 */
export function dbReadCompactorHotFull(): any {
  try {
    const db = getDb();
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;

    // Active: status in active-like values
    const activeRows = db
      .query(
        `
      SELECT * FROM gate_sessions
      WHERE status IN ('armed', 'checked', 'pending', 'active', 'confirmed', 'delivered')
    `,
      )
      .all() as any[];
    const active_sessions: Record<string, any> = {};
    for (const row of activeRows) {
      active_sessions[row.session_id] = reconstructGateSession(row);
    }

    // Recent: completed within 7 days
    const recentRows = db
      .query(
        `
      SELECT * FROM gate_sessions
      WHERE status = 'completed' AND (consumed_at >= ? OR updated_at >= ?)
    `,
        [sevenDaysAgo, sevenDaysAgo],
      )
      .all() as any[];
    const recent_sessions: Record<string, any> = {};
    for (const row of recentRows) {
      recent_sessions[row.session_id] = reconstructGateSession(row);
    }

    return {
      formatVersion: "3.0",
      active_sessions,
      recent_sessions,
      meta: {
        total_sessions: activeRows.length + recentRows.length,
        active_count: activeRows.length,
        recent_count: recentRows.length,
        last_compacted: new Date().toISOString(),
      },
    };
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "DB-READ-COMPACTOR-HOT-FULL-FAILED",
      detail: e.message,
    });
    // Caller should fall back to JSON file
    throw e;
  }
}

/**
 * A8: Regenerate all gate state export files from the DB.
 *
 * Rebuilds gate-state.json, gate-state.index.json, and
 * gate-state.history/*.jsonl from the authoritative DB tables.
 * Uses atomic tmp+rename for each file.
 *
 * Designed to be called:
 *   - After DB recovery (corrupted JSON files)
 *   - On demand for export verification
 *   - By the nightly-compaction cron job
 *
 * @returns Summary of regenerated files
 */
export function dbRegenerateGateFiles(root?: string): {
  hot: boolean;
  index: boolean;
  historiesWritten: number;
  errors: string[];
} {
  const result = {
    hot: false,
    index: false,
    historiesWritten: 0,
    errors: [] as string[],
  };
  try {
    const db = getDb({ root });
    const stateDir = path.join(
      root || process.env.OPENCODE_ROOT || process.cwd(),
      ".opencode",
      "state",
    );

    // ── 1. Regenerate gate-state.json (hot state) ──
    try {
      const hot = dbReadCompactorHotFull();
      // Re-read separately to get included 'delivered' status rows
      const hotWithDelivered = dbReadCompactorHotFull();
      const hotFile = path.join(stateDir, "gate-state.json");
      const hotTmp = hotFile + ".tmp";
      fs.writeFileSync(hotTmp, JSON.stringify(hotWithDelivered, null, 2));
      fs.renameSync(hotTmp, hotFile);
      result.hot = true;
    } catch (e: any) {
      result.errors.push(`gate-state.json: ${e.message}`);
    }

    // ── 2. Regenerate gate-state.index.json ──
    try {
      const indexEntries = dbReadCompactorIndex();
      const indexFile = path.join(stateDir, "gate-state.index.json");
      const indexTmp = indexFile + ".tmp";
      const index = {
        formatVersion: "3.0",
        sessions: indexEntries,
      };
      fs.writeFileSync(indexTmp, JSON.stringify(index, null, 2));
      fs.renameSync(indexTmp, indexFile);
      result.index = true;
    } catch (e: any) {
      result.errors.push(`gate-state.index.json: ${e.message}`);
    }

    // ── 3. Regenerate gate-state.history/*.jsonl ──
    try {
      const auditRows = db
        .query(
          `
        SELECT * FROM gate_audit_history
        WHERE compactor_event IN ('warm', 'hot', 'cold', 'export')
        ORDER BY consumed_at ASC
      `,
        )
        .all() as any[];

      // Group by date
      const byDate: Record<string, any[]> = {};
      for (const row of auditRows) {
        const dateKey = new Date(row.consumed_at || Date.now())
          .toISOString()
          .slice(0, 10);
        if (!byDate[dateKey]) byDate[dateKey] = [];
        byDate[dateKey].push(row);
      }

      const historyDir = path.join(stateDir, "gate-state.history");
      if (!fs.existsSync(historyDir)) {
        fs.mkdirSync(historyDir, { recursive: true });
      }

      for (const [dateKey, rows] of Object.entries(byDate)) {
        const histFile = path.join(historyDir, `${dateKey}.jsonl`);
        const histTmp = histFile + ".tmp";
        const lines =
          rows
            .map((r) => {
              const entry: any = {
                session_id: r.session_id,
                task_description: r.task_description,
                plan_summary: r.plan_summary,
                execution_summary: r.execution_summary || "",
                agent: r.agent,
                task_id: r.task_id,
                gate_status: r.gate_status,
                audit: {
                  completed_at: new Date(
                    r.consumed_at || Date.now(),
                  ).toISOString(),
                  archive_path: r.archive_path,
                },
              };
              if (r.compactor_event) entry.compactor_event = r.compactor_event;
              return JSON.stringify(entry);
            })
            .join("\n") + "\n";
        fs.writeFileSync(histTmp, lines);
        fs.renameSync(histTmp, histFile);
        result.historiesWritten++;
      }
    } catch (e: any) {
      result.errors.push(`gate-state.history: ${e.message}`);
    }

    writeLog(SRC, "INFO", {
      event: "GATE-REGENERATE-COMPLETE",
      detail: `hot=${result.hot} index=${result.index} histories=${result.historiesWritten} errors=${result.errors.length}`,
    });
  } catch (e: any) {
    result.errors.push(`FATAL: ${e.message}`);
  }
  return result;
}

export function migrateJsonToDb(root?: string): MigrationResult {
  const projectRoot = root || process.env.OPENCODE_ROOT || process.cwd();
  const stateDir = path.join(projectRoot, ".opencode", "state");

  const result: MigrationResult = {
    migrated: [],
    failed: [],
    skipped: [],
    total_bytes: 0,
  };

  writeLog(SRC, "INFO", {
    event: "DB-MIGRATION-START",
    detail: `stateDir=${stateDir}`,
  });

  for (const [key, filename] of Object.entries(SUBSTATE_FILES)) {
    const filePath = path.join(stateDir, filename);
    if (!fs.existsSync(filePath)) {
      result.skipped.push(key);
      continue;
    }

    try {
      const raw = fs.readFileSync(filePath, "utf8");
      // Validate JSON
      JSON.parse(raw);
      const ok = dbWriteSubState(key as any, JSON.parse(raw));
      if (ok) {
        result.migrated.push(key);
        result.total_bytes += raw.length;
      } else {
        result.failed.push(key);
      }
    } catch (e: any) {
      writeLog(SRC, "ERROR", {
        event: "DB-MIGRATION-FAILED",
        detail: `key=${key} err=${e.message}`,
      });
      result.failed.push(key);
    }
  }

  // Migrate machine.json (meta + contracts)
  const machinePath = path.join(stateDir, "machine.json");
  if (fs.existsSync(machinePath)) {
    try {
      const machine = JSON.parse(fs.readFileSync(machinePath, "utf8"));
      if (dbWriteMachineMeta(machine)) {
        result.migrated.push("machine_meta");
      } else {
        result.failed.push("machine_meta");
      }
    } catch (e: any) {
      result.failed.push("machine_meta");
    }
  }

  writeLog(SRC, "INFO", {
    event: "DB-MIGRATION-COMPLETE",
    detail: `migrated=${result.migrated.length} failed=${result.failed.length} skipped=${result.skipped.length} bytes=${result.total_bytes}`,
  });

  return result;
}

// ════════════════════════════════════════════════════════════
// v6: SESSION / DISPATCH INFRASTRUCTURE CRUD
// ════════════════════════════════════════════════════════════

/**
 * Append a session_log entry after successful Task() completion.
 * Replaces writing SESSION_ID.md to .task_temp/{taskId}/.
 */
export function dbAppendSessionLog(
  sessionId: string,
  dagTaskId: string,
  agentType: string,
  runId?: string,
): boolean {
  try {
    const db = getDb();
    db.run(
      `INSERT INTO session_log (session_id, dag_task_id, agent_type, run_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, dagTaskId, agentType, runId || null, Date.now()],
    );
    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-SESSION-LOG-APPEND-FAILED",
      detail: e.message,
    });
    return false;
  }
}

/**
 * Query the latest session_id for a given dagTaskId (for resume).
 * Replaces reading SESSION_ID.md from .task_temp/{taskId}/.
 */
export function dbQueryLatestSessionByDagTaskId(
  dagTaskId: string,
): string | null {
  try {
    const db = getDb();
    const row = db
      .query(
        `SELECT session_id FROM session_log WHERE dag_task_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(dagTaskId) as { session_id: string } | null;
    return row?.session_id || null;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-SESSION-LOG-QUERY-FAILED",
      detail: e.message,
    });
    return null;
  }
}

/**
 * Query all session_log entries for a dagTaskId (for audit/diagnostic).
 */
export function dbQueryAllSessionsByDagTaskId(dagTaskId: string): Array<{
  session_id: string;
  agent_type: string;
  run_id: string | null;
  created_at: number;
}> {
  try {
    const db = getDb();
    return db
      .query(
        `SELECT session_id, agent_type, run_id, created_at
       FROM session_log WHERE dag_task_id = ? ORDER BY created_at DESC`,
      )
      .all(dagTaskId) as Array<{
      session_id: string;
      agent_type: string;
      run_id: string | null;
      created_at: number;
    }>;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-SESSION-LOG-QUERY-ALL-FAILED",
      detail: e.message,
    });
    return [];
  }
}

/**
 * Append a dispatch failure record.
 * Replaces writing to .pending.json.failed.
 * Supports two variants:
 *   - Stale drain: dispatchId, promptHash, filePath, dagTaskId, reason="stale-timeout"|"manual-drain-stale"
 *   - Task failure: sessionId, agentType, taskId, error, reason="task-failure"
 */
export function dbAppendDispatchFailed(entry: {
  dispatchId: string;
  promptHash?: string;
  filePath?: string;
  agentType: string;
  dagTaskId?: string;
  sessionId?: string;
  createdAt: number;
  failedAt: number;
  reason: string;
  errorMsg?: string;
}): boolean {
  try {
    const db = getDb();
    db.run(
      `INSERT INTO dispatch_failed_log
        (dispatch_id, prompt_hash, file_path, agent_type, dag_task_id,
         session_id, created_at, failed_at, reason, error_msg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.dispatchId,
        entry.promptHash || null,
        entry.filePath || null,
        entry.agentType,
        entry.dagTaskId || null,
        entry.sessionId || null,
        entry.createdAt,
        entry.failedAt,
        entry.reason,
        entry.errorMsg || null,
      ],
    );
    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-DISPATCH-FAILED-APPEND-FAILED",
      detail: e.message,
    });
    return false;
  }
}

/**
 * Read agent identity + dagTaskId + domainId from session_map by sessionId.
 * Replaces reading .session_map.json.
 * Priority 1 path for P0-4 scope enforcement (resolveAgentFromSessionMap).
 * FW-DISPATCH-TASKID-IMMUTABLE: dag_task_id enables task integrity validation.
 * FW-UC7KS-DOMAIN-001: domain_id enables per-domain UC7KS write check.
 */
export function dbReadSessionMap(sessionId: string): {
  agent: string;
  dag_task_id: string | null;
  domain_id: string | null;
  created_at: number;
  updated_at: number;
} | null {
  try {
    const db = getDb();
    const row = db
      .query(
        `SELECT agent, dag_task_id, domain_id, created_at, updated_at FROM session_map WHERE session_id = ?`,
      )
      .get(sessionId) as {
      agent: string;
      dag_task_id: string | null;
      domain_id: string | null;
      created_at: number;
      updated_at: number;
    } | null;
    return row || null;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-SESSION-MAP-READ-FAILED",
      detail: e.message,
    });
    return null;
  }
}

/**
 * Write/update agent identity in session_map.
 * Replaces writing .session_map.json.
 * Uses INSERT OR REPLACE for upsert semantics with COALESCE preservation.
 * FW-DISPATCH-TASKID-IMMUTABLE: dagTaskId persisted alongside agent identity.
 * FW-UC7KS-DOMAIN-001: domainId persisted for per-domain UC7KS write check.
 *
 * Four SQL paths based on which optional params are provided:
 *   1. dagTaskId + domainId: explicit write for both
 *   2. dagTaskId only: COALESCE preserve domainId
 *   3. domainId only: COALESCE preserve dagTaskId
 *   4. neither: COALESCE preserve both
 */
export function dbWriteSessionMap(
  sessionId: string,
  agent: string,
  dagTaskId?: string,
  domainId?: string,
): boolean {
  try {
    const db = getDb();
    const now = Date.now();

    if (dagTaskId !== undefined && domainId !== undefined) {
      // Path 1: Both provided — explicit write
      db.run(
        `INSERT OR REPLACE INTO session_map (session_id, agent, dag_task_id, domain_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, COALESCE(
           (SELECT created_at FROM session_map WHERE session_id = ?), ?
         ), ?)`,
        [sessionId, agent, dagTaskId, domainId, sessionId, now, now],
      );
    } else if (dagTaskId !== undefined) {
      // Path 2: Only dagTaskId — COALESCE preserve domainId
      db.run(
        `INSERT OR REPLACE INTO session_map (session_id, agent, dag_task_id, domain_id, created_at, updated_at)
         VALUES (?, ?, ?, COALESCE(
           (SELECT domain_id FROM session_map WHERE session_id = ?), NULL
         ), COALESCE(
           (SELECT created_at FROM session_map WHERE session_id = ?), ?
         ), ?)`,
        [sessionId, agent, dagTaskId, sessionId, sessionId, now, now],
      );
    } else if (domainId !== undefined) {
      // Path 3: Only domainId — COALESCE preserve dagTaskId
      db.run(
        `INSERT OR REPLACE INTO session_map (session_id, agent, dag_task_id, domain_id, created_at, updated_at)
         VALUES (?, ?, COALESCE(
           (SELECT dag_task_id FROM session_map WHERE session_id = ?), NULL
         ), ?, COALESCE(
           (SELECT created_at FROM session_map WHERE session_id = ?), ?
         ), ?)`,
        [sessionId, agent, sessionId, domainId, sessionId, now, now],
      );
    } else {
      // Path 4: Neither — COALESCE preserve both
      db.run(
        `INSERT OR REPLACE INTO session_map (session_id, agent, dag_task_id, domain_id, created_at, updated_at)
         VALUES (?, ?, COALESCE(
           (SELECT dag_task_id FROM session_map WHERE session_id = ?), NULL
         ), COALESCE(
           (SELECT domain_id FROM session_map WHERE session_id = ?), NULL
         ), COALESCE(
           (SELECT created_at FROM session_map WHERE session_id = ?), ?
         ), ?)`,
        [sessionId, agent, sessionId, sessionId, sessionId, now, now],
      );
    }
    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-SESSION-MAP-WRITE-FAILED",
      detail: e.message,
    });
    return false;
  }
}

/**
 * FW-DISPATCH-TASKID-IMMUTABLE: Check whether any session_map entry
 * has a given dagTaskId registered. Used by compliance-gate MCP server
 * and gate-core armSession() to validate sub-agent task_id integrity.
 *
 * Returns the list of session_ids that have this dagTaskId, or empty
 * array if none found (meaning the task_id is not a dispatch-registered
 * value — likely fabricated by a sub-agent attempting to bypass gate).
 */
export function dbQuerySessionByDagTaskId(dagTaskId: string): string[] {
  try {
    const db = getDb();
    const rows = db
      .query(`SELECT session_id FROM session_map WHERE dag_task_id = ?`)
      .all(dagTaskId) as { session_id: string }[];
    return rows.map((r) => r.session_id);
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-SESSION-MAP-DAG-QUERY-FAILED",
      detail: e.message,
    });
    return [];
  }
}

/**
 * FW-UC7KS-DOMAIN-001: Check whether any session_map entry has a
 * given domainId registered. Used by scope-before.ts to validate
 * per-domain UC7KS compliance (cache_sufficiency check).
 *
 * Returns the list of session_ids that have this domainId.
 */
export function dbQuerySessionByDomain(domainId: string): string[] {
  try {
    const db = getDb();
    const rows = db
      .query(`SELECT session_id FROM session_map WHERE domain_id = ?`)
      .all(domainId) as { session_id: string }[];
    return rows.map((r) => r.session_id);
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-SESSION-MAP-DOMAIN-QUERY-FAILED",
      detail: e.message,
    });
    return [];
  }
}

/**
 * Cap session_log to 200 entries (keep newest).
 * Called after append if count exceeds threshold.
 */
export function dbCapSessionLog(maxEntries: number = 200): number {
  try {
    const db = getDb();
    const countRow = db
      .query("SELECT COUNT(*) AS c FROM session_log")
      .get() as { c: number } | null;
    const count = countRow?.c ?? 0;
    if (count <= maxEntries) return 0;
    const res = db.run(
      `DELETE FROM session_log WHERE id NOT IN (
        SELECT id FROM session_log ORDER BY created_at DESC LIMIT ?
      )`,
      [maxEntries],
    );
    return res.changes;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-SESSION-LOG-CAP-FAILED",
      detail: e.message,
    });
    return 0;
  }
}
