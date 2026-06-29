// service/gate/index.ts — Unified entry point for GateService
// Re-exports all public API from the gate service modules.

// ── Store & Types ──
export {
  // Types
  type DeliverableEntry,
  type DeliverableEvidence,
  type GateSession,
  type GateFailHistoryEntry,
  type GateCheckItem,
  type GateStore,
  type GateAuditEntry,
  type GateAudit,
  type GateCheckResult,
  type GateConfirmResult,
  type GateCompleteResult,
  type EnforcementMode,
  type EnforcementModeWithSource,
  type FrameworkPaths,
  type DagExistsResult,
  type TaskInDagResult,
  type DagProgressResult,
  type ArmedSessionResult,
  type StaleSessionInfo,
  type StaleSessionsResult,
  type GateIntegrityResult,
  type MachineCleanlinessResult,
  type RegistryMismatch,
  type RuleRegistryResult,
  type WriteScope,
  // Store I/O
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
} from "./store";

// ── Enforcement ──
export {
  getEnforcementMode,
  getEnforcementModeWithSource,
  resolveFrameworkPaths,
  checkDagExists,
  checkTaskInDag,
  checkDagProgress,
  FrameworkEnforcementError,
} from "./enforcement";

// ── Session Management (split from session-crud) ──
export { createGateSession, armGateSession } from "./session-mgmt";
export { completeGateSession, validateTaskArtifacts } from "./session-complete";
export { submitDeliverables, approveDeliverables } from "./deliverables";

// ── Drain ──
export { drainStaleSessions } from "./drain";

// ── Checks ──
export {
  setPluginHooksCount,
  checkPluginIntegrity,
  findTaskInDag,
  isWriteAllowed,
  checkStaleSessions,
  autoDrainStaleSessions,
  checkRuleRegistryIntegrity,
  checkMachineCleanliness,
  checkArmedSession,
  checkStaleSessionsFromState,
  checkGateIntegrity,
  isAgentAllowedToWrite,
} from "./checks";

// ── Stale Thresholds ──
export {
  readGateStaleThresholds,
  readGateStaleThreshold,
  type GateStaleThresholds,
} from "./stale";

// ── Deliverables Templates ──
export {
  APPROVAL_EXEMPT_AGENTS,
  DELIVERABLES_TEMPLATES,
  getDeliverablesTemplate,
  isExemptAgent,
  deliverablesTemplateMarkdown,
  type DeliverableTemplate,
} from "./deliverables";

// ── Approval Context ──
export {
  buildApprovalArgsHashInput,
  computeApprovalArgsHash,
  recordApprovalContext,
  getApprovalContext,
  markApprovalContextConsumed,
  type ApprovalReadContext,
} from "./approval-context";

// ── Checklist ──
export {
  PHASE_ITEMS,
  type CreateChecklistRunInput,
  type MarkChecklistInput,
  type MarkChecklistFailedInput,
  type RequireChecklistPassedInput,
  type RequireChecklistPassedResult,
  type ChecklistBlockerItem,
  type AdvanceChecklistPhaseInput,
  type AdvanceChecklistPhaseResult,
  type ChecklistSummary,
  type DispatchPayloadIntegrityInput,
  type ValidatePayloadInput,
  type ValidatePayloadResult,
} from "./checklist-phase";

export {
  createChecklistRun,
  markChecklistPassed,
  markChecklistFailed,
  advanceChecklistPhase,
  markChecklistRunInterrupted,
  resetChecklistItemToPending,
} from "./checklist-lifecycle";

export {
  recordDispatchPayloadIntegrity,
  validateDispatchPayload,
} from "./checklist-payload";

// Query & summary (split to checklist-query.ts)
export {
  requireChecklistPassed,
  getChecklistSummary,
  detectAndAdvancePhase,
} from "./checklist-query";
export type { DetectAndAdvancePhaseInput, DetectAndAdvancePhaseResult } from "./checklist-query";

// ── Phase 3: Task Completion Tracking (from task-after hook) ──
export { trackTaskComplete, getGateReminderText } from "./task-tracker";

// ── Phase 1 gap: State Machine (extracted from session-crud/store/checks/drain) ──
export {
  type GateStatus,
  INITIAL_STATUS,
  LIVE_STATUSES,
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
  VALID_TRANSITIONS,
  isValidTransition,
  isTerminalStatus,
  isLiveStatus,
  getNextStates,
  validateTransition,
} from "./state-machine";

// ── Phase 3E-1: Gate Before-Hook Validation (from gate-before plugin) ──
export { autoArmGateSession, validateGateBefore } from "./gate-validate";

// ── Phase 3E-2: Write Scope Validation (from scope-before plugin) ──
export { validateWriteScope } from "./scope-validate";

// ── Phase 3E-3: Checklist Validation (from checklist-before plugin) ──
export { validateChecklistBefore } from "./checklist-validate";

// ── Batch 3: Checklist Hooks (from lib/checklist-hooks.ts) ──
export {
  checklistWirePassed,
  checklistWireFailed,
} from "./checklist-hooks";

// ── Phase 4A: MCP Tool Service Layer (extracted from compliance-gate.ts) ──
export {
  retryConfirmGateSession,
  type RetryConfirmResult,
} from "./mcp-retry";

export {
  bulkReviewDeliverables,
} from "./mcp-bulk";

export {
  submitDeliverablesWithCrossCheck,
  approveDeliverablesWithAudit,
  parseFindingsTable,
  type SubmitResult,
  type ApproveResult,
} from "./mcp-deliverables";

export {
  validateDispatchTaskIntegrity,
  checkTaskIdConflict,
  type DispatchIntegrityResult,
} from "./dispatch-integrity";

export {
  checkGateCompliance,
  type GateCheckResult,
  type GateCheckFailedItem,
} from "./mcp-check";

export {
  confirmGateSession,
  type ConfirmResult,
  type DeliverableEntry,
} from "./mcp-confirm";

export {
  completeGateWithRetry,
  type CompleteResult,
} from "./mcp-complete";
