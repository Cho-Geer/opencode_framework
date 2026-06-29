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

export { getEnforcementMode, getEnforcementModeWithSource } from "./enforcement";
export { readGateStaleThresholds, readGateStaleThreshold } from "./stale";
export { getChecklistSummary } from "./checklist-query";
export { getApprovalContext } from "./approval-context";
