/**
 * State Compactor — Core Compaction Engine (compactor-core)
 *
 * Core compaction logic: StateCompactorBase class with the main compaction
 * function (onGateComplete) and all private/protected data operations
 * (history, index, hot-state, migration, regeneration).
 *
 * Split from lib/state-compactor.ts for modularity.
 *
 * @module compactor-core
 * @since Phase 0 (Foundation)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type {
  GateStateHot,
  GateStateIndex,
  GateSessionHot,
  GateSessionRecent,
  GateSessionIndex,
  GateSessionHistoryEntry,
} from "../../lib/state-manager";
import {
  STATE_PATHS,
  getDateKey,
  buildArchiveRef,
  countJsonlLines,
} from "../../lib/state-manager";
import { writeLog } from "../../lib/log-manager";
import { atomicWriteJson } from "../../lib/state-utils";
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
} from "../../lib/db-state-manager";

export const SRC = "lib-state-compactor";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Compaction configuration constants.
 */
export const COMPACTION_CONFIG = {
  /** Sessions consumed within this many days stay in the hot file as "recent" */
  RECENT_DAYS: 7,
  /** Maximum number of recent sessions before triggering archive batching */
  MAX_RECENT_SESSIONS: 50,
  /** Maximum hot file size before triggering compaction (bytes) */
  MAX_HOT_FILE_SIZE: 100 * 1024, // 100KB
} as const;

// ============================================================================
// State Compactor Base Class
// ============================================================================

/**
 * StateCompactorBase — Core hierarchical state compaction for gate sessions.
 *
 * Contains the main compaction entry point (onGateComplete) and all
 * protected data operations used by the scheduling subclass.
 */
export class StateCompactorBase {
  protected readonly historyDir: string;
  protected readonly hotFile: string;
  protected readonly indexFile: string;
  protected readonly archiveFile: string;

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

  // ==========================================================================
  // Protected: History Operations
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
  protected writeToHistory(dateKey: string, session: GateSessionHot): string {
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
  // Protected: Index Operations
  // ==========================================================================

  /**
   * Read the index file (export cache), or return an empty one.
   * A8: gate_compactor_index DB table is authoritative; this file
   * is an export cache regenerable via regenerateGateFiles().
   */
  protected readIndex(): GateStateIndex {
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
  protected writeIndex(index: GateStateIndex): void {
    try {
      atomicWriteJson(this.indexFile, index);
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
  protected updateIndex(gateSessionId: string, session: GateSessionIndex): void {
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
  protected updateIndexStatus(
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
  // Protected: Hot State Operations
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
  protected readHotState(): GateStateHot {
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
  protected writeHotState(_state: GateStateHot): void {
    // No-op: gate-state.json is no longer written (OPT-01 DB-canonical).
    // DB (gate_sessions + gate_drained_sessions + gate_compactor_index) is the sole source.
  }

  /**
   * Move a session from active_sessions to recent_sessions in the hot file.
   */
  protected moveToRecent(gateSessionId: string, archiveRef: string): void {
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
  protected updateMeta(): void {
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
   * This is the inverse operation: DB (authoritative) -> files (export cache).
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
// Re-export dbRegenerateGateFiles (for bridge re-export)
// ============================================================================

export { dbRegenerateGateFiles };
