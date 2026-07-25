/**
 * knowledge-audit.ts — Bounded Aggregate Audit Rollup for UC7KS Pipeline
 * ═══════════════════════════════════════════════════════════════════════
 * KC-02 (2026-06-21): Retain and activate knowledge_audit_state as
 * DB-managed bounded aggregate audit rollup. All writer functions are
 * non-fatal — a failure to write the audit state must NEVER throw or
 * block pipeline operations.
 *
 * Design Principles:
 *   1. Non-fatal: Every function wraps in try-catch; failures → writeLog + return.
 *   2. Bounded: recent_events capped at 100; aggregates capped at Number.MAX_SAFE_INTEGER.
 *   3. DB-only: Written via readSubState/writeSubState (substate_kv SQLite table).
 *      Mutation functions use atomicUpdateKnowledgeAudit() → dbAtomicWriteSubState()
 *      to eliminate read-modify-write race conditions (SQLite transaction wrapping).
 *   4. Idempotent: Repeated calls produce consistent results; counters always increment.
 *
 * @author @Super-Admin
 * @version 2.0.0 — A5: Atomic RMW via dbAtomicWriteSubState (2026-06-21)
 * @since 2026-06-21
 * @see .opencode/state/schemas/knowledge-audit-state.schema.json
 * @see .opencode/lib/substate-types.ts (KnowledgeAuditState interface)
 */
import { writeLog } from "../../lib/log-manager";
import { readSubState, writeSubState } from "../../lib/substate-manager";
import { dbAtomicWriteSubState } from "../../lib/db-state-manager";
import type {
  KnowledgeAuditState,
  KnowledgeAuditAggregate,
  KnowledgeAuditEvent,
} from "../../lib/substate-types";

const SRC = "lib-knowledge-audit";
const MAX_RECENT_EVENTS = 100;

// ── Counter key names (matching KnowledgeAuditAggregate fields) ──
export const AGGREGATE_KEYS = [
  "total_cache_checks",
  "total_cache_hits",
  "total_cache_misses",
  "total_attestations",
  "total_attestation_failures",
  "total_curator_dispatches",
  "total_external_fetches",
  "reverse_orphan_count",
  "last_cleanup_removed_session_entries",
] as const;

export type AggregateKey = (typeof AGGREGATE_KEYS)[number];

// ── Public API ────────────────────────────────────────────────────

/**
 * Return the default (empty) bounded audit state shape.
 * Used as fallback when the DB row does not exist or is corrupted.
 */
export function getDefaultAuditState(): KnowledgeAuditState {
  return {
    enabled: true,
    last_cache_check: null as any,
    last_knowledge_acquisition: null as any,
    aggregate: {
      total_cache_checks: 0,
      total_cache_hits: 0,
      total_cache_misses: 0,
      total_attestations: 0,
      total_attestation_failures: 0,
      total_curator_dispatches: 0,
      total_external_fetches: 0,
      reverse_orphan_count: 0,
      last_cleanup_removed_session_entries: 0,
    },
    recent_events: [],
  };
}

/**
 * Read the knowledge audit state from the DB.
 * Returns the default state on any failure (missing row, corrupt JSON, DB error).
 */
export function readAuditState(): KnowledgeAuditState {
  try {
    const state = readSubState("knowledge_audit_state");
    if (!state || typeof state !== "object") {
      return getDefaultAuditState();
    }
    // Ensure nested objects exist
    if (!state.aggregate) state.aggregate = {};
    if (!state.recent_events || !Array.isArray(state.recent_events)) {
      state.recent_events = [];
    }
    // Ensure enabled is set
    if (state.enabled === undefined || state.enabled === null) {
      state.enabled = true;
    }
    return state as KnowledgeAuditState;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "AUDIT-READ-FAILED",
      detail: `Failed to read knowledge_audit_state: ${e.message}`,
    });
    return getDefaultAuditState();
  }
}

/**
 * Write the knowledge audit state to the DB.
 * Returns true on success, false on failure (non-fatal).
 */
export function writeAuditState(state: KnowledgeAuditState): boolean {
  try {
    // Bounded enforcement: cap recent_events at 100
    if (state.recent_events && state.recent_events.length > MAX_RECENT_EVENTS) {
      state.recent_events = state.recent_events.slice(-MAX_RECENT_EVENTS);
    }
    return writeSubState("knowledge_audit_state", state);
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "AUDIT-WRITE-FAILED",
      detail: `Failed to write knowledge_audit_state: ${e.message}`,
    });
    return false;
  }
}

/**
 * Atomic read-modify-write for knowledge_audit_state.
 * Uses dbAtomicWriteSubState which wraps the entire operation in a
 * SQLite transaction, eliminating the read-modify-write race condition
 * present in the old readAuditState() → modify → writeAuditState() pattern.
 *
 * The mutator receives the current state (initialized with defaults if
 * the DB row is empty) and modifies it in-place. The write happens
 * atomically within the same transaction.
 *
 * Non-fatal: returns false on failure (logged via writeLog), never throws.
 *
 * @param mutator - Function that mutates the state in-place
 * @returns true on success, false on failure
 */
export function atomicUpdateKnowledgeAudit(
  mutator: (state: KnowledgeAuditState) => void,
): boolean {
  try {
    return dbAtomicWriteSubState("knowledge_audit_state", (raw: any) => {
      // Ensure the state has the required shape before mutating
      ensureAuditStateShape(raw);
      mutator(raw as KnowledgeAuditState);
      // Bounded enforcement: cap recent_events at 100 (also done by writeAuditState)
      if (raw.recent_events && raw.recent_events.length > MAX_RECENT_EVENTS) {
        raw.recent_events = raw.recent_events.slice(-MAX_RECENT_EVENTS);
      }
    });
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "AUDIT-ATOMIC-FAILED",
      detail: `atomicUpdateKnowledgeAudit: ${e.message}`,
    });
    return false;
  }
}

/**
 * Ensure the raw DB value has the minimum required shape for KnowledgeAuditState.
 * Called inside the SQLite transaction before the mutator runs.
 * Missing fields are initialized from defaults; the caller's mutator then
 * applies the intended change.
 */
function ensureAuditStateShape(raw: any): void {
  if (raw.enabled === undefined || raw.enabled === null) raw.enabled = true;
  if (!raw.aggregate || typeof raw.aggregate !== "object") raw.aggregate = {};
  if (!raw.recent_events || !Array.isArray(raw.recent_events))
    raw.recent_events = [];
}

/**
 * Increment an aggregate counter by 1.
 * Now uses atomicUpdateKnowledgeAudit() to avoid read-modify-write races.
 * Non-fatal: failure logs an error and returns silently.
 *
 * @param field - Aggregate counter key to increment
 * @param delta - Amount to increment (default 1)
 */
export function incrementAuditCounter(
  field: AggregateKey,
  delta: number = 1,
): void {
  const ok = atomicUpdateKnowledgeAudit((state) => {
    if (!state.aggregate) state.aggregate = {};
    const current = (state.aggregate[field] as number) || 0;
    // Bounded: cap at MAX_SAFE_INTEGER
    state.aggregate[field] = Math.min(current + delta, Number.MAX_SAFE_INTEGER);
  });
  if (!ok) {
    writeLog(SRC, "ERROR", {
      event: "AUDIT-COUNTER-FAILED",
      detail: `Atomic update failed for increment ${field}`,
    });
  }
}

/**
 * Push a single event onto the recent_events ring buffer.
 * Automatically caps at 100 entries (oldest evicted).
 * Non-fatal: failure logs an error and returns silently.
 *
 * @param event - The audit event to record
 */
export function pushAuditEvent(event: KnowledgeAuditEvent): void {
  // Ensure timestamp is set before the atomic write
  if (!event.timestamp) {
    event.timestamp = new Date().toISOString();
  }
  const ok = atomicUpdateKnowledgeAudit((state) => {
    if (!state.recent_events) state.recent_events = [];
    state.recent_events.push(event);
    // Cap at 100 (also enforced by atomicUpdateKnowledgeAudit post-mutator)
    if (state.recent_events.length > MAX_RECENT_EVENTS) {
      state.recent_events = state.recent_events.slice(-MAX_RECENT_EVENTS);
    }
  });
  if (!ok) {
    writeLog(SRC, "ERROR", {
      event: "AUDIT-EVENT-FAILED",
      detail: `Atomic update failed for push event "${event.event}"`,
    });
  }
}

/**
 * Update the last_cache_check timestamp.
 * Non-fatal convenience wrapper.
 */
export function touchCacheCheck(): void {
  const ok = atomicUpdateKnowledgeAudit((state) => {
    state.last_cache_check = new Date().toISOString();
  });
  if (!ok) {
    writeLog(SRC, "ERROR", {
      event: "AUDIT-TOUCH-FAILED",
      detail: "Atomic update failed for touchCacheCheck",
    });
  }
}

/**
 * Update the last_knowledge_acquisition timestamp.
 * Non-fatal convenience wrapper.
 */
export function touchKnowledgeAcquisition(): void {
  const ok = atomicUpdateKnowledgeAudit((state) => {
    state.last_knowledge_acquisition = new Date().toISOString();
  });
  if (!ok) {
    writeLog(SRC, "ERROR", {
      event: "AUDIT-TOUCH-FAILED",
      detail: "Atomic update failed for touchKnowledgeAcquisition",
    });
  }
}
