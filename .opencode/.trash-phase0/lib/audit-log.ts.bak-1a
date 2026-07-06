/**
 * utils/audit-log.ts — Audit Log Writers (DB-only)
 * Extracted from framework-enforcer.ts (Phase 4 modularization).
 *
 * P2-A Step 8 (2026-06-16): DB-only audit writes.
 * - writeAuditLogEntry: DB INSERT (atomic, solves G6)
 * - flushAuditTrail: DB upsert (atomic, solves G7)
 *
 * JSONL/JSON dual-write removed; DB is single source of truth.
 */
import {
  dbWriteAuditLogEntry,
  dbFlushAuditTrail,
} from "./db-state-manager";

export function writeAuditLogEntry(entry: Record<string, unknown>): void {
  try {
    dbWriteAuditLogEntry({
      session_id: (entry.sessionID as string) || undefined,
      agent: (entry.agent as string) || undefined,
      event_type: (entry.event as string) || (entry.eventType as string) || "audit",
      detail: entry,
      timestamp: entry.timestamp ? Date.parse(entry.timestamp as string) : Date.now(),
    });
  } catch (e: any) {
    // DB write failed — logged internally by db-state-manager
  }
}

export function logAuditEntry(entry: Record<string, unknown>): void {
  writeAuditLogEntry({ timestamp: new Date().toISOString(), ...entry, sessionID: (entry.sessionID as string) || '' });
}

export function flushAuditTrail(sessionID: string): void {
  const newEntry = { sessionID, flushedAt: new Date().toISOString() };

  try {
    dbFlushAuditTrail(sessionID, [newEntry]);
  } catch (e: any) {
    // DB write failed — logged internally by db-state-manager
  }
}
