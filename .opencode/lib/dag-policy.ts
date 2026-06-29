// dag-policy.ts — Bridge → service/dispatch/dag-policy
// ═══════════════════════════════════════════════════════════════════════
// Phase 1d: Thin re-export bridge. Original file moved to service layer.
// All existing import paths remain valid through this bridge.
// ═══════════════════════════════════════════════════════════════════════

// ── Re-export canonical DAG-exempt list ───────────────────────────────
export { DAG_EXEMPT_AGENTS, isDagExempt } from "../service/dispatch/dag-policy";

// ── Types ─────────────────────────────────────────────────────────────
export type {
  DispatchPolicy,
  AutoPlanRecord,
  AutoPlanOptions,
} from "../service/dispatch/dag-policy";

// ── Functions ─────────────────────────────────────────────────────────
export {
  DEFAULT_DISPATCH_POLICY,
  readDispatchPolicy,
  resetDispatchPolicyCache,
  countAutoPlanAttempts,
  synthesizePlanningPrompt,
  autoPlan,
} from "../service/dispatch/dag-policy";
