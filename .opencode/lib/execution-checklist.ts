// execution-checklist.ts — BRIDGE → service/gate/checklist-*.ts
// Phase 1b migration: all logic moved to service/gate/checklist-phase.ts,
// checklist-lifecycle.ts, checklist-payload.ts

// ── Types & constants from checklist-phase.ts ──
export {
  PHASE_ITEMS,
} from "../service/gate/checklist-phase";

export type {
  CreateChecklistRunInput,
  MarkChecklistInput,
  MarkChecklistFailedInput,
  RequireChecklistPassedInput,
  ChecklistBlockerItem,
  RequireChecklistPassedResult,
  AdvanceChecklistPhaseInput,
  AdvanceChecklistPhaseResult,
  ChecklistSummary,
  DispatchPayloadIntegrityInput,
  ValidatePayloadInput,
  ValidatePayloadResult,
} from "../service/gate/checklist-phase";

// ── Lifecycle functions from checklist-lifecycle.ts ──
export {
  createChecklistRun,
  markChecklistPassed,
  markChecklistFailed,
  // requireChecklistPassed moved to checklist-query.ts
  advanceChecklistPhase,
  // getChecklistSummary moved to checklist-query.ts
  markChecklistRunInterrupted,
  resetChecklistItemToPending,
} from "../service/gate/checklist-lifecycle";
// ── Query functions from checklist-query.ts ──
export { getChecklistSummary, requireChecklistPassed } from "../service/gate/checklist-query";

// ── Payload functions from checklist-payload.ts ──
export {
  recordDispatchPayloadIntegrity,
  validateDispatchPayload,
} from "../service/gate/checklist-payload";
