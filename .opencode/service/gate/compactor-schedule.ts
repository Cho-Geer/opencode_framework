/**
 * State Compactor — Scheduling & Triggering Logic (compactor-schedule)
 *
 * Periodic compaction, threshold-based draining, session compaction hooks,
 * archive management, and format migration.
 *
 * Split from lib/state-compactor.ts for modularity.
 * Extends StateCompactorBase from compactor-core.
 *
 * INTEGRATION POINTS:
 * - OpenCode session.compacted event: Triggers onSessionCompacted() hook
 * - compliance_gate_drain_stale: Uses drainStaleSessions() instead of drained_sessions dict
 * - @CI-CD-Agent nightly cron: Calls nightlyCompaction() for batching
 *
 * @module compactor-schedule
 * @since Phase 0 (Foundation)
 */

import { readFileSync, existsSync } from "node:fs";
import type {
  GateStateHot,
  GateStateArchive,
  GateSessionHot,
} from "../../lib/state-manager";
import {
  getDateKey,
  findOldSessions,
} from "../../lib/state-manager";
import { writeLog } from "../../lib/log-manager";
import { atomicWriteJson } from "../../lib/state-utils";
import {
  dbSyncCompactorHot,
  dbMarkSessionArchived,
} from "../../lib/db-state-manager";

import { StateCompactorBase, COMPACTION_CONFIG, SRC } from "./compactor-core";

// ============================================================================
// State Compactor — Scheduling Subclass
// ============================================================================

/**
 * StateCompactor — Full compactor with scheduling/triggering methods.
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
export class StateCompactor extends StateCompactorBase {
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
      atomicWriteJson(this.archiveFile, archive);
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
  // Protected: Format Migration
  // ==========================================================================

  /**
   * In-place migration from v2 format to v3 format.
   * v2 format has all sessions in a single "sessions" property.
   */
  protected migrateV2ToV3(v2Data: Record<string, unknown>): GateStateHot {
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
}
