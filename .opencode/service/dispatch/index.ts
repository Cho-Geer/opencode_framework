// service/dispatch/index.ts — Unified entry point for DispatchService
// Re-exports all public API from the dispatch service modules.

// ── DAG Policy ──
export {
  DAG_EXEMPT_AGENTS,
  isDagExempt,
  DEFAULT_DISPATCH_POLICY,
  readDispatchPolicy,
  resetDispatchPolicyCache,
  countAutoPlanAttempts,
  synthesizePlanningPrompt,
  autoPlan,
  type DispatchPolicy,
  type AutoPlanRecord,
  type AutoPlanOptions,
} from "./dag-policy";

// ── Queue Operations ──
export {
  dbEnqueueDispatch,
  dbDequeueWithLease,
  dbConsumeDispatch,
  dbFailDispatch,
  dbCleanStaleLeases,
  type DispatchQueueEntry,
  type DispatchPromptRef,
} from "./queue";

// ── Session Log & Diagnostics ──
export {
  dbInsertDispatchContext,
  dbInsertDispatchAttempt,
  dbGetDispatchQueue,
  dbGetPendingCount,
  type DispatchContextEntry,
  type DispatchAttemptEntry,
} from "./session-log";

// ── Route Validation ──
// Phase 2: dispatch router (replaces validateDispatchRoute)
export { dispatch } from "./router";
export type { DispatchInput, DispatchResult } from "./router";

// ── Phase 3: Dispatch Cleanup (from dispatch-after hook) ──
export { cleanupDispatch } from "./cleanup";

// ── Phase 3: Auto-Dispatch Cleanup (from dispatch-auto hook) ──
export { reclaimAutoDispatch } from "./auto-cleanup";

// ── Phase 3: Dispatch Marker Consumption (from task-before hook) ──
export { consumeDispatchMarker } from "./marker-consume";
export type { MarkerConsumeResult } from "./marker-consume";

// ── Phase 3E-4: Dispatch Before-Hook Validation (from dispatch-before plugin) ──
export { validateDispatchBefore } from "./dispatch-validate";
