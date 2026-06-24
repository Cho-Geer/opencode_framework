/**
 * Hierarchical State Manager — Core Module
 *
 * Provides type definitions and atomic read/write helpers for the
 * three-tier state management architecture:
 *   Tier 1 (Hot): Actively accessed JSON files (gate-state.json, Task.DAG.json)
 *   Tier 2 (Warm): Append-only JSONL history files
 *   Tier 3 (Cold): Archive files for long-term retention
 *
 * Integrates with safe-edit-core.ts for TOCTOU-safe I/O and
 * OpenCode's built-in safe_edit/safe_shell patterns.
 *
 * @module state-manager
 * @since Phase 0 (Foundation)
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { writeLog } from "./log-manager";

const SRC = "lib-state-manager";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Gate session stored in the hot file (active/pending).
 */
export interface GateSessionHot {
  /** Unique session identifier (e.g., cg_ses_1779323731637) */
  session_id: string;
  /** ISO 8601 timestamp of session creation */
  created_at: string;
  /** Current gate status */
  gate_status: "checked" | "active" | "armed" | "pending";
  /** ISO 8601 timestamp of user confirmation */
  confirmed_at?: string;
  /** Original task description from compliance_gate_check */
  task_description: string;
  /** Plan summary from compliance_gate_confirm */
  plan_summary: string;
}

/**
 * Gate session stored in the hot file (recently completed, ≤7 days).
 * Verbose data (execution_summary) is offloaded to history files.
 */
export interface GateSessionRecent {
  /** Unique session identifier */
  session_id: string;
  /** ISO 8601 timestamp of session creation */
  created_at: string;
  /** Always "completed" for recent sessions */
  gate_status: "completed";
  /** ISO 8601 timestamp of completion (compliance_gate_complete) */
  consumed_at: string;
  /** Reference to full session data: "gate-state.history/YYYY-MM-DD.jsonl#N" */
  archive_ref: string;
}

/**
 * Gate session entry in the index file (all completed/drained sessions).
 */
export interface GateSessionIndex {
  /** Unique session identifier */
  session_id: string;
  /** ISO 8601 timestamp of session creation */
  created_at: string;
  /** Completed or drained status */
  gate_status: "completed" | "drained";
  /** ISO 8601 timestamp of completion */
  consumed_at?: string;
  /** Reference to full session data */
  archive_ref: string;
}

/**
 * Full audit trail for a completed session, stored in JSONL history files.
 */
export interface GateSessionHistoryEntry {
  /** Unique session identifier */
  session_id: string;
  /** Original task description */
  task_description: string;
  /** Plan summary */
  plan_summary: string;
  /** Execution summary */
  execution_summary: string;
  /** Audit metadata */
  audit: {
    /** ISO 8601 timestamp of completion */
    completed_at: string;
    /** Optional execution summary (redundant with top-level field during migration) */
    execution_summary?: string;
  };
}

/**
 * Metadata for the hot gate-state.json file.
 */
export interface GateStateMeta {
  /** Total sessions across all tiers */
  total_sessions: number;
  /** Count of active + pending sessions */
  active_count: number;
  /** Count of recently completed sessions (≤7 days) */
  recent_count: number;
  /** ISO 8601 timestamp of last compaction run */
  last_compacted: string;
}

/**
 * Full hot gate-state.json structure (v3 format).
 */
export interface GateStateHot {
  /** Format version — always "3.0" */
  formatVersion: "3.0";
  /** Active and pending sessions */
  active_sessions: Record<string, GateSessionHot>;
  /** Recently completed sessions (≤7 days) */
  recent_sessions: Record<string, GateSessionRecent>;
  /** Store metadata */
  meta: GateStateMeta;
}

/**
 * Full gate-state.index.json structure.
 */
export interface GateStateIndex {
  /** Format version */
  formatVersion: "3.0";
  /** All completed/drained sessions, keyed by session_id */
  sessions: Record<string, GateSessionIndex>;
}

/**
 * Full gate-state.archive.json structure.
 */
export interface GateStateArchive {
  /** Format version */
  formatVersion: "3.0";
  /** ISO 8601 timestamp of archive creation */
  archived_at: string;
  /** Number of sessions in this archive */
  session_count: number;
  /** Archived session references, keyed by session_id */
  sessions: Record<string, { session_id: string; archive_ref: string }>;
}

/**
 * DAG task entry (subset used by DAG version manager).
 */
export interface DAGTask {
  id: string;
  status: "pending" | "in_progress" | "completed";
  completed_at?: string;
  [key: string]: unknown;
}

/**
 * DAG metadata used by version manager.
 */
export interface DAGMeta {
  total_tasks?: number;
  pending_tasks: number;
  recent_completed?: number;
  archived_completed?: number;
  [key: string]: unknown;
}

// ============================================================================
// Path Constants
// ============================================================================

/**
 * Resolved paths for the state management subsystem.
 * Uses relative paths from project root for portability.
 */
export const STATE_PATHS = {
  /** Hot gate-state.json — active + recent sessions */
  GATE_STATE_HOT: ".opencode/state/gate-state.json",
  /** Session metadata index */
  GATE_STATE_INDEX: ".opencode/state/gate-state.index.json",
  /** Archived sessions (cold storage) */
  GATE_STATE_ARCHIVE: ".opencode/state/gate-state.archive.json",
  /** Append-only history directory */
  GATE_STATE_HISTORY_DIR: ".opencode/state/gate-state.history",
  /** Hot Task.DAG.json — pending + recent completed */
  DAG_HOT: "Task.DAG.json",
  /** Version snapshots directory */
  DAG_VERSIONS_DIR: "Task.DAG.versions",
  /** Append-only changelog */
  DAG_CHANGELOG: "Task.DAG.changelog.md",
  /** Task lookup index */
  DAG_INDEX: "Task.DAG.index.json",
  /** Current safe-bash log */
  SAFE_BASH_LOG: ".opencode/logs/safe-bash.log",
  /** Log archive directory */
  LOG_ARCHIVE_DIR: ".opencode/logs/archive",
} as const;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a date key for history files (YYYY-MM-DD format).
 */
export function getDateKey(date: Date = new Date()): string {
  return date.toISOString().split("T")[0];
}

/**
 * Generate a timestamp key for backup directories (YYYYMMDD_HHMMSS format).
 */
export function getTimestampKey(date: Date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "_");
}

/**
 * Find sessions older than a cutoff date from a session record.
 * Returns session IDs that have consumed_at older than the cutoff.
 *
 * @param sessions - Record of sessions keyed by ID
 * @param cutoffDate - Sessions consumed before this date are considered "old"
 * @returns Array of session IDs older than the cutoff
 */
export function findOldSessions(
  sessions: Record<string, { consumed_at?: string; [key: string]: unknown }>,
  cutoffDate: Date,
): string[] {
  const cutoff = cutoffDate.getTime();
  const oldIds: string[] = [];

  for (const [gateSessionId, session] of Object.entries(sessions)) {
    if (session.consumed_at) {
      const consumedTime = new Date(session.consumed_at).getTime();
      if (consumedTime < cutoff) {
        oldIds.push(gateSessionId);
      }
    }
  }

  return oldIds;
}

/**
 * Build a history file reference string.
 *
 * @param dateKey - Date in YYYY-MM-DD format
 * @param entryIndex - 0-based line index in the JSONL file
 * @returns Reference string like "gate-state.history/2026-06-03.jsonl#5"
 */
export function buildArchiveRef(dateKey: string, entryIndex: number): string {
  return `gate-state.history/${dateKey}.jsonl#${entryIndex}`;
}

/**
 * Parse an archive reference string into its components.
 *
 * @param ref - Reference string like "gate-state.history/2026-06-03.jsonl#5"
 * @returns Parsed reference or null if format is invalid
 */
export function parseArchiveRef(
  ref: string,
): { filename: string; lineIndex: number } | null {
  const match = ref.match(
    /^gate-state\.history\/(\d{4}-\d{2}-\d{2}\.jsonl)#(\d+)$/,
  );
  if (!match) return null;
  return {
    filename: match[1],
    lineIndex: parseInt(match[2], 10),
  };
}

/**
 * Count lines in a JSONL file (non-empty lines only).
 *
 * @param filePath - Path to the JSONL file
 * @returns Number of non-empty lines, or 0 if file doesn't exist
 */
export function countJsonlLines(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  try {
    const content = readFileSync(filePath, "utf8");
    return content.split("\n").filter((line) => line.trim().length > 0).length;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    writeLog(SRC, "ERROR", {
      event: "JSONL-LINE-COUNT-FAILED",
      detail: `filePath=${filePath} err=${message}`,
    });
    return 0;
  }
}

/**
 * Get file size in bytes. Returns -1 if file doesn't exist.
 */
export function getFileSize(filePath: string): number {
  if (!existsSync(filePath)) return -1;
  return statSync(filePath).size;
}

/**
 * Get human-readable file size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 0) return "N/A";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
