// dispatch-db.ts — Bridge → service/dispatch/queue + service/dispatch/session-log
// ═══════════════════════════════════════════════════════════════════════
// Phase 1d: Thin re-export bridge. Original 508L file split into:
//   - service/dispatch/queue.ts    (DB queue ops: enqueue/dequeue/consume/fail/janitor)
//   - service/dispatch/session-log.ts (attempt logging + diagnostic queries)
// All existing import paths remain valid through this bridge.
// ═══════════════════════════════════════════════════════════════════════

// ── Types (from queue) ────────────────────────────────────────────────
export type { DispatchQueueEntry, DispatchPromptRef } from "../service/dispatch/queue";

// ── Types (from session-log) ──────────────────────────────────────────
export type { DispatchContextEntry, DispatchAttemptEntry } from "../service/dispatch/session-log";

// ── Queue operations (from queue) ─────────────────────────────────────
export {
  dbEnqueueDispatch,
  dbDequeueWithLease,
  dbConsumeDispatch,
  dbFailDispatch,
  dbCleanStaleLeases,
  dbFindPendingDispatch,
  dbFindPendingDispatchByHash,
  dbDequeueWithHash,
  dbCheckDuplicateDispatch,
} from "../service/dispatch/queue";

// ── Logging + diagnostics (from session-log) ──────────────────────────
export {
  dbInsertDispatchAttempt,
  dbGetDispatchQueue,
  dbGetPendingCount,
} from "../service/dispatch/session-log";
