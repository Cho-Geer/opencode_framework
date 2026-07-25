// service/gate/query.ts — Read-only query interface (re-exports for external consumers)
// Cross-service queries that don't modify state.

export {
  loadGateStore,
  findArmedSession,
  findAnyGateSession,
  getGateStatePath,
  getMachinePath,
  readJsonFile,
  fileExists,
  computeSHA256,
} from "./store";

// DEPRECATED-COMPAT: legacy mode-compat shims retained ONLY for protected files
// (hook-layers.ts, legacy/scripts/pre-execution-gate.ts). Do not add new callers.
export { getEnforcementMode, getEnforcementModeWithSource } from "./enforcement";
// Phase 3 T3.1: Per-rule disposition
export { getRuleDisposition, shouldBlock } from "../enforcement/rule-disposition";
export { readGateStaleThresholds, readGateStaleThreshold } from "./stale";
export { getChecklistSummary } from "./checklist-query";
export { getApprovalContext } from "./approval-context";
