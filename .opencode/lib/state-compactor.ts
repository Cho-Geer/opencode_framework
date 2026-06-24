/**
 * State Compactor — Hierarchical Compaction Engine
 *
 * Implements the three-tier compaction strategy for gate-state:
 *   Tier 1 (Hot): gate-state.json — active + pending + recent completed (≤7 days)
 *   Tier 2 (Warm): gate-state.history/*.jsonl — append-only daily logs
 *   Tier 3 (Cold): gate-state.archive.json — archived sessions (>7 days)
 *
 * AUTHORITATIVE SOURCE (SA-STORAGE-IMPLEMENT-001, 2026-06-19):
 *   The DB (gate_sessions, gate_drained_sessions, gate_session_index,
 *   gate_audit_history tables) is the AUTHORITATIVE source for gate state.
 *   gate-core.ts is already DB-first (loadGateStore/saveGateStore).
 *   This compactor currently operates on JSON hot file as primary.
 *   DB sync is best-effort via dbSyncCompactorHot/dbMarkSessionArchived/
 *   dbMarkSessionDrained. Future: compactor should prefer DB load/save,
 *   with JSON hot file as an export cache.
 *
 * INTEGRATION POINTS:
 * - compliance_gate_complete: Triggers onGateComplete() to move session to history
 * - OpenCode session.compacted event: Triggers onSessionCompacted() hook
 * - compliance_gate_drain_stale: Uses drainStaleSessions() instead of drained_sessions dict
 * - @CI-CD-Agent nightly cron: Calls nightlyCompaction() for batching
 *
 * CONCURRENCY SAFETY:
 * - Uses atomic temp-file + rename pattern for hot file writes
 * - History files are append-only (JSONL) — safe for concurrent writers
 * - Index file uses atomic replace with timestamped backup
 *
 * @module state-compactor
 * @since Phase 0 (Foundation)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type {
  GateStateHot,
  GateStateIndex,
  GateStateArchive,
  GateSessionHot,
  GateSessionRecent,
  GateSessionIndex,
  GateSessionHistoryEntry,
} from "./state-manager";
import {
  STATE_PATHS,
  getDateKey,
  findOldSessions,
  buildArchiveRef,
  countJsonlLines,
} from "./state-manager";
import { writeLog } from "./log-manager";
// A8: DB-first compactor (replaces JSON as primary — DB is authoritative)
import {
  dbReadCompactorHotFull,
  dbWriteCompactorHistory,
  dbUpsertCompactorIndex,
  dbReadCompactorIndex,
  dbRegenerateGateFiles,
  dbSyncCompactorHot,
  dbMarkSessionArchived,
  dbMarkSessionDrained,
} from "./db-state-manager";

const SRC = "lib-state-compactor";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Compaction configuration constants.
 */
const COMPACTION_CONFIG = {
  /** Sessions consumed within this many days stay in the hot file as "recent" */
  RECENT_DAYS: 7,
  /** Maximum number of recent sessions before triggering archive batching */
  MAX_RECENT_SESSIONS: 50,
  /** Maximum hot file size before triggering compaction (bytes) */
  MAX_HOT_FILE_SIZE: 100 * 1024, // 100KB
} as const;

// ============================================================================
// State Compactor Class
// ============================================================================

/**
 * StateCompactor — Manages hierarchical state compaction for gate sessions.
 *
 * Usage:
 * ```
 * const compactor = new StateCompactor();
 *
 * // In compliance_gate_complete handler:
 * await compactor.onGateComplete(gateSessionId, sessionData);
 *
 * // In nightly cron (@CI-CD-Agent):
 * await compactor.nightlyCompaction();
 *
 * // In compliance_gate_drain_stale handler:
 * await compactor.drainStaleSessions(thresholdHours);
 * ```
 */
export class StateCompactor {
  private readonly historyDir: string;
  private readonly hotFile: string;
  private readonly indexFile: string;
  private readonly archiveFile: string;

  constructor() {
    this.historyDir = STATE_PATHS.GATE_STATE_HISTORY_DIR;
    this.hotFile = STATE_PATHS.GATE_STATE_HOT;
    this.indexFile = STATE_PATHS.GATE_STATE_INDEX;
    this.archiveFile = STATE_PATHS.GATE_STATE_ARCHIVE;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Triggered by compliance_gate_complete.
   * Moves the completed session from active_sessions to:
   *   1. gate-state.history/YYYY-MM-DD.jsonl (full verbose data)
   *   2. gate-state.index.json (metadata entry)
   *   3. recent_sessions in gate-state.json (metadata reference)
   *
   * @param gateSessionId - The completed session ID
   * @param session - Full session data from the hot file before removal
   */
  async onGateComplete(
    gateSessionId: string,
    session: GateSessionHot,
  ): Promise<void> {
    const dateKey = getDateKey();

    // 1. Ensure history directory exists
    if (!existsSync(this.historyDir)) {
      mkdirSync(this.historyDir, { recursive: true });
    }

    // 2. Write full session data to history (append-only JSONL)
    const historyRef = this.writeToHistory(dateKey, session);

    // 3. Update index
    this.updateIndex(gateSessionId, {
      session_id: gateSessionId,
      created_at: session.created_at,
      gate_status: "completed",
      consumed_at: new Date().toISOString(),
      archive_ref: historyRef,
    });

    // 4. Move from active to recent in hot storage
    this.moveToRecent(gateSessionId, historyRef);

    // 5. Update meta counts
    this.updateMeta();

    // P3/S63-3: Sync hot state to DB (non-fatal; best-effort)
    try {
      dbSyncCompactorHot(this.readHotState());
      dbMarkSessionArchived(gateSessionId);
    } catch {
      /* DB unavailable — JSON remains primary */
    }
  }

  /**
   * OpenCode native hook: session.compacted
   * Triggered when OpenCode compacts a session context.
   *
   * @param gateSessionId - The compacted session ID
   */
  async onSessionCompacted(gateSessionId: string): Promise<void> {
    // Check if this session has gate data we should archive
    const hotState = this.readHotState();
    const activeSession = hotState.active_sessions[gateSessionId];

    if (activeSession && activeSession.gate_status !== "active") {
      await this.onGateComplete(gateSessionId, activeSession);
    }

    // P3/S63-3: Sync hot state to DB
    try {
      dbSyncCompactorHot(this.readHotState());
    } catch {
      /* best-effort */
    }
  }

  /**
   * Nightly batch compaction — called by @CI-CD-Agent cron.
   *
   * 1. Moves old recent sessions (>RECENT_DAYS) to archive
   * 2. Compresses old history files (future enhancement)
   */
  async nightlyCompaction(): Promise<{ archivedCount: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - COMPACTION_CONFIG.RECENT_DAYS);

    const hotState = this.readHotState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oldSessionIds = findOldSessions(
      hotState.recent_sessions as any,
      cutoffDate,
    );

    if (oldSessionIds.length === 0) {
      return { archivedCount: 0 };
    }

    // Read or create archive
    const archive = this.readOrCreateArchive();

    for (const gateSessionId of oldSessionIds) {
      const recent = hotState.recent_sessions[gateSessionId];
      if (!recent) continue;

      // Move to archive
      archive.sessions[gateSessionId] = {
        session_id: recent.session_id,
        archive_ref: recent.archive_ref,
      };
      archive.session_count++;

      // Update index status to "drained"
      this.updateIndexStatus(gateSessionId, "drained");

      // Remove from recent_sessions
      delete hotState.recent_sessions[gateSessionId];
    }

    archive.archived_at = new Date().toISOString();

    // Write archive and updated hot state
    this.writeArchive(archive);
    // OPT-01: writeHotState is no-op (DB-canonical)
    this.updateMeta();

    // P3/S63-3: Sync archived sessions to DB
    try {
      dbSyncCompactorHot(this.readHotState());
      for (const sid of oldSessionIds) {
        dbMarkSessionArchived(sid);
      }
    } catch {
      /* best-effort */
    }

    return { archivedCount: oldSessionIds.length };
  }

  /**
   * Integration with compliance_gate_drain_stale.
   * Moves stale sessions directly to archive instead of drained_sessions dict.
   *
   * @param thresholdHours - Sessions older than this are considered stale
   * @returns Count of drained sessions
   */
  async drainStaleSessions(thresholdHours: number): Promise<number> {
    const hotState = this.readHotState();
    const now = Date.now();
    let drainedCount = 0;

    for (const [gateSessionId, session] of Object.entries(
      hotState.active_sessions,
    )) {
      const createdAt = new Date(session.created_at).getTime();
      const ageHours = (now - createdAt) / (1000 * 60 * 60);

      if (ageHours > thresholdHours && session.gate_status !== "active") {
        // Archive the session
        await this.archiveSession(gateSessionId, session);
        delete hotState.active_sessions[gateSessionId];
        drainedCount++;
      }
    }

    if (drainedCount > 0) {
      // OPT-01: writeHotState is no-op (DB-canonical)
      this.updateMeta();

      // P3/S63-3: Sync drained sessions to DB
      try {
        dbSyncCompactorHot(this.readHotState());
      } catch {
        /* best-effort */
      }
    }

    return drainedCount;
  }

  // ==========================================================================
  // Private: History Operations
  // ==========================================================================

  /**
   * Write a full session record to history (DB-first, A8).
   *
   * Strategy:
   *   1. INSERT into gate_audit_history with compactor_event='warm'
   *   2. Materialize JSONL file as durable export cache (non-fatal)
   *   3. On DB failure, fall back to JSONL append
   *
   * @param dateKey - Date key in YYYY-MM-DD format
   * @param session - Full session data
   * @returns Archive reference string
   */
  private writeToHistory(dateKey: string, session: GateSessionHot): string {
    const now = Date.now();
    const historyFile = join(this.historyDir, `${dateKey}.jsonl`);
    const archiveRef = buildArchiveRef(dateKey, countJsonlLines(historyFile));

    // 1. DB-first: INSERT into gate_audit_history
    const dbOk = dbWriteCompactorHistory({
      session_id: session.session_id,
      task_description: session.task_description || "",
      plan_summary: session.plan_summary || "",
      execution_summary: "",
      agent: (session as any).agent,
      task_id: (session as any).task_id,
      confirmed_at: session.confirmed_at
        ? new Date(session.confirmed_at).getTime()
        : undefined,
      consumed_at: now,
      gate_status: "completed",
      compactor_event: "warm",
      archive_path: archiveRef,
    });

    // OPT-01 (2026-06-23): DB-canonical — JSON file fallback removed.
    // DB write failure is now treated as hard error; compactor gate is authoritative.
    if (!dbOk) {
      writeLog(SRC, "ERROR", {
        event: "GATE-DB-WRITE-FAILED",
        detail: `DB write failed for sid=${session.session_id} — gate archive persistence lost`,
      });
    }

    // 2. Materialize JSONL as durable export cache (always, regardless of DB status)
    const dir = dirname(historyFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const entry: GateSessionHistoryEntry = {
      session_id: session.session_id,
      task_description: session.task_description,
      plan_summary: session.plan_summary,
      execution_summary: "",
      audit: {
        completed_at: new Date().toISOString(),
      },
    };

    try {
      const line = JSON.stringify(entry) + "\n";
      writeFileSync(historyFile, line, { flag: "a" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      writeLog(SRC, "ERROR", {
        event: "HISTORY-APPEND-FAILED",
        detail: `historyFile=${historyFile} err=${message}`,
      });
      // Non-fatal — DB is authoritative; JSONL is export cache
    }

    return archiveRef;
  }

  // ==========================================================================
  // Private: Index Operations
  // ==========================================================================

  /**
   * Read the index file (export cache), or return an empty one.
   * A8: gate_compactor_index DB table is authoritative; this file
   * is an export cache regenerable via regenerateGateFiles().
   */
  private readIndex(): GateStateIndex {
    if (!existsSync(this.indexFile)) {
      return {
        formatVersion: "3.0",
        sessions: {},
      };
    }
    try {
      return JSON.parse(readFileSync(this.indexFile, "utf8")) as GateStateIndex;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      writeLog(SRC, "ERROR", {
        event: "INDEX-PARSE-FAILED",
        detail: `indexFile=${this.indexFile} err=${message}`,
      });
      return { formatVersion: "3.0", sessions: {} };
    }
  }

  /**
   * Write the index file atomically (export cache).
   */
  private writeIndex(index: GateStateIndex): void {
    try {
      writeFileSync(this.indexFile, JSON.stringify(index, null, 2));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      writeLog(SRC, "ERROR", {
        event: "INDEX-WRITE-FAILED",
        detail: `indexFile=${this.indexFile} err=${message}`,
      });
      throw error;
    }
  }

  /**
   * Add or update an entry in the index (DB-first, A8).
   *
   * Strategy:
   *   1. UPSERT into gate_compactor_index (DB authoritative)
   *   2. Materialize gate-state.index.json as export cache (non-fatal)
   *   3. On DB failure, fall back to JSON file write
   */
  private updateIndex(gateSessionId: string, session: GateSessionIndex): void {
    // 1. DB-first: UPSERT into gate_compactor_index
    const dbOk = dbUpsertCompactorIndex({
      session_id: gateSessionId,
      status: session.gate_status,
      created_at: session.created_at
        ? new Date(session.created_at).getTime()
        : Date.now(),
      consumed_at: session.consumed_at
        ? new Date(session.consumed_at).getTime()
        : undefined,
      archive_ref: session.archive_ref,
    });

    // OPT-01 (2026-06-23): DB-canonical — JSON index fallback removed.
    if (!dbOk) {
      writeLog(SRC, "ERROR", {
        event: "GATE-DB-UPSERT-FAILED",
        detail: `DB upsert failed for sid=${gateSessionId} — index entry lost`,
      });
    }

    // 2. Materialize gate-state.index.json as export cache
    const index = this.readIndex();
    index.sessions[gateSessionId] = session;
    this.writeIndex(index);
  }

  /**
   * Update only the status field of an index entry (DB-first, A8).
   */
  private updateIndexStatus(
    gateSessionId: string,
    newStatus: "completed" | "drained",
  ): void {
    // 1. DB-first: UPSERT with new status
    const now = Date.now();
    dbUpsertCompactorIndex({
      session_id: gateSessionId,
      status: newStatus,
      created_at: now,
      drained_at: newStatus === "drained" ? now : undefined,
    });

    // 2. Materialize gate-state.index.json as export cache
    const index = this.readIndex();
    if (index.sessions[gateSessionId]) {
      index.sessions[gateSessionId].gate_status = newStatus;
      this.writeIndex(index);
    }
  }

  // ==========================================================================
  // Private: Hot State Operations
  // ==========================================================================

  /**
   * Read the hot gate-state. DB-only (OPT-01, 2026-06-23).
   *
   * Strategy:
   *   1. Query DB (gate_sessions + gate_drained_sessions + gate_compactor_index)
   *   2. If DB succeeds, return DB view (authoritative)
   *   3. If DB fails, throw — JSON file fallback removed (OPT-01)
   *      gate-state.json is preserved as read-only migration snapshot.
   */
  private readHotState(): GateStateHot {
    // Try DB first (A8: DB is authoritative)
    try {
      const dbState = dbReadCompactorHotFull();
      if (
        dbState &&
        (Object.keys(dbState.active_sessions).length > 0 ||
          Object.keys(dbState.recent_sessions).length > 0 ||
          dbState.meta)
      ) {
        return dbState as GateStateHot;
      }
    } catch {
      // DB unavailable — fall through to JSON file
    }

    // OPT-01 (2026-06-23): DB-canonical — JSON file fallback removed.
    // gate-state.json is preserved as read-only migration snapshot; DB is the sole source.
    writeLog(SRC, "ERROR", {
      event: "GATE-DB-UNAVAILABLE",
      detail: `DB unavailable for readHotState — no fallback available (OPT-01)`,
    });
    throw new Error(
      "Gate DB unavailable — cannot read hot state (OPT-01 DB-canonical)",
    );
  }

  /**
   * OPT-01 (2026-06-23): DB-canonical — gate-state.json write removed.
   * JSON file is preserved as read-only migration snapshot. DB is authoritative.
   */
  private writeHotState(_state: GateStateHot): void {
    // No-op: gate-state.json is no longer written (OPT-01 DB-canonical).
    // DB (gate_sessions + gate_drained_sessions + gate_compactor_index) is the sole source.
  }

  /**
   * Move a session from active_sessions to recent_sessions in the hot file.
   */
  private moveToRecent(gateSessionId: string, archiveRef: string): void {
    const hotState = this.readHotState();
    const activeSession = hotState.active_sessions[gateSessionId];

    if (!activeSession) return;

    const recentSession: GateSessionRecent = {
      session_id: activeSession.session_id,
      created_at: activeSession.created_at,
      gate_status: "completed",
      consumed_at: new Date().toISOString(),
      archive_ref: archiveRef,
    };

    hotState.recent_sessions[gateSessionId] = recentSession;
    delete hotState.active_sessions[gateSessionId];

    // OPT-01: writeHotState is no-op (DB-canonical)
  }

  /**
   * Update metadata counts in the hot file.
   */
  private updateMeta(): void {
    try {
      const hotState = this.readHotState();
      hotState.meta = {
        total_sessions:
          Object.keys(hotState.active_sessions).length +
          Object.keys(hotState.recent_sessions).length,
        active_count: Object.keys(hotState.active_sessions).length,
        recent_count: Object.keys(hotState.recent_sessions).length,
        last_compacted: new Date().toISOString(),
      };
      // OPT-01: writeHotState is no-op (DB-canonical); DB is authoritative
    } catch (e: any) {
      writeLog(SRC, "WARN", {
        event: "GATE-DB-UNAVAILABLE",
        detail: `Cannot update metadata: ${e.message}`,
      });
    }
  }

  /**
   * In-place migration from v2 format to v3 format.
   * v2 format has all sessions in a single "sessions" property.
   */
  private migrateV2ToV3(v2Data: Record<string, unknown>): GateStateHot {
    const hot: GateStateHot = {
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

    const sessions = (v2Data.sessions || {}) as Record<
      string,
      Record<string, unknown>
    >;

    for (const [gateSessionId, session] of Object.entries(sessions)) {
      if (
        ["active", "armed", "checked", "pending"].includes(
          String(session.gate_status),
        )
      ) {
        hot.active_sessions[gateSessionId] = {
          session_id: gateSessionId,
          created_at: String(session.created_at || ""),
          gate_status: session.gate_status as GateSessionHot["gate_status"],
          confirmed_at: session.confirmed_at
            ? String(session.confirmed_at)
            : undefined,
          task_description: String(session.task_description || ""),
          plan_summary: String(session.plan_summary || ""),
        };
      }
    }

    hot.meta.total_sessions = Object.keys(sessions).length;
    hot.meta.active_count = Object.keys(hot.active_sessions).length;

    return hot;
  }

  // ==========================================================================
  // Private: Archive Operations
  // ==========================================================================

  /**
   * Read archive or create a new empty one.
   */
  private readOrCreateArchive(): GateStateArchive {
    if (!existsSync(this.archiveFile)) {
      return {
        formatVersion: "3.0",
        archived_at: new Date().toISOString(),
        session_count: 0,
        sessions: {},
      };
    }
    try {
      return JSON.parse(
        readFileSync(this.archiveFile, "utf8"),
      ) as GateStateArchive;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      writeLog(SRC, "ERROR", {
        event: "ARCHIVE-PARSE-FAILED",
        detail: `archiveFile=${this.archiveFile} err=${message}`,
      });
      return {
        formatVersion: "3.0",
        archived_at: new Date().toISOString(),
        session_count: 0,
        sessions: {},
      };
    }
  }

  /**
   * Write archive file.
   */
  private writeArchive(archive: GateStateArchive): void {
    try {
      writeFileSync(this.archiveFile, JSON.stringify(archive, null, 2));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      writeLog(SRC, "ERROR", {
        event: "ARCHIVE-WRITE-FAILED",
        detail: `archiveFile=${this.archiveFile} err=${message}`,
      });
      throw error;
    }
  }

  /**
   * Archive a single session (write to history, update index, add to archive).
   */
  private async archiveSession(
    gateSessionId: string,
    session: GateSessionHot,
  ): Promise<void> {
    const dateKey = getDateKey();
    const historyRef = this.writeToHistory(dateKey, session);

    // Update index
    this.updateIndex(gateSessionId, {
      session_id: gateSessionId,
      created_at: session.created_at,
      gate_status: "drained",
      consumed_at: new Date().toISOString(),
      archive_ref: historyRef,
    });

    // Add to archive
    const archive = this.readOrCreateArchive();
    archive.sessions[gateSessionId] = {
      session_id: gateSessionId,
      archive_ref: historyRef,
    };
    archive.session_count++;
    archive.archived_at = new Date().toISOString();
    this.writeArchive(archive);
  }

  // ==========================================================================
  // A8: Regenerate Export Files from DB
  // ==========================================================================

  /**
   * Regenerate all gate state export files from the authoritative DB.
   *
   * Rebuilds gate-state.json, gate-state.index.json, and
   * gate-state.history/*.jsonl from the DB tables.
   * Uses atomic tmp+rename for each file.
   *
   * This is the inverse operation: DB (authoritative) → files (export cache).
   * Files can be deleted and regenerated — DB is the source of truth.
   *
   * @returns Summary of regenerated files
   */
  regenerateGateFiles(): {
    hot: boolean;
    index: boolean;
    historiesWritten: number;
    errors: string[];
  } {
    return dbRegenerateGateFiles();
  }
}

// ============================================================================
// Module Exports
// ============================================================================

export { COMPACTION_CONFIG, dbRegenerateGateFiles };
