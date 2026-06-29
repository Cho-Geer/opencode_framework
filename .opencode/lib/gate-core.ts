// gate-core.ts — BRIDGE → service/gate/
// Phase 1b migration: all logic moved to service/gate/*.ts
// This file preserves all existing import paths via re-exports.

// ── From store.ts ──
export {
  getProjectRoot,
  resolveStateDir,
  readJsonFile,
  fileExists,
  computeSHA256,
  getGateStatePath,
  getMachinePath,
  createFreshStore,
  loadGateStore,
  saveGateStore,
  findArmedSession,
  findAnyGateSession,
  logGateStatusTransition,
  generateGateSessionId,
  computeDigest,
  extractSemver,
  pathMatchesGlob,
} from "../service/gate/store";

export type {
  DeliverableEntry,
  DeliverableEvidence,
  GateSession,
  GateFailHistoryEntry,
  GateCheckItem,
  GateStore,
  GateAuditEntry,
  GateAudit,
  GateCheckResult,
  GateConfirmResult,
  GateCompleteResult,
  EnforcementMode,
  EnforcementModeWithSource,
  FrameworkPaths,
  DagExistsResult,
  TaskInDagResult,
  DagProgressResult,
  ArmedSessionResult,
  StaleSessionInfo,
  StaleSessionsResult,
  GateIntegrityResult,
  MachineCleanlinessResult,
  RegistryMismatch,
  RuleRegistryResult,
  WriteScope,
} from "../service/gate/store";

// ── From enforcement.ts ──
export {
  getEnforcementMode,
  getEnforcementModeWithSource,
  resolveFrameworkPaths,
  checkDagExists,
  checkTaskInDag,
  checkDagProgress,
  FrameworkEnforcementError,
} from "../service/gate/enforcement";

// ── From session-crud (split into 3 modules) ──
export { createGateSession, armGateSession } from "../service/gate/session-mgmt";
export { completeGateSession, validateTaskArtifacts } from "../service/gate/session-complete";
export { submitDeliverables, approveDeliverables } from "../service/gate/deliverables";

// ── From drain.ts ──
export { drainStaleSessions } from "../service/gate/drain";

// ── From checks.ts ──
export {
  checkArmedSession,
  checkStaleSessionsFromState,
  checkGateIntegrity,
  checkMachineCleanliness,
  checkRuleRegistryIntegrity,
  isAgentAllowedToWrite,
} from "../service/gate/checks";
