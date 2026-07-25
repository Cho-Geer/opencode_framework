// service/file-guard/index.ts — FileGuard Service 统一入口
// 所有文件操作 DB 写入的唯一入口

// 文件锁
export { acquireLock } from "./lock";

// TOCTOU 基线
export {
  captureStat,
  statsEqual,
  resolveBaseline,
  populateBaseline,
  consumeBaseline,
  clearRegistry,
} from "./baseline";
export type { StatSnapshot } from "./baseline";

// 备份管理
export {
  createBackup,
  getBackup,
  findLatestBackup,
  getBackupsByFile,
  getBackupsByAgent,
  getBackupsBySession,
  getBackupsByDagTask,
  restoreBackup,
  cleanupStaleBackups,
} from "./backup";
export type { BackupCreateInput, BackupRecord } from "./backup";

// 文件操作
export {
  writeSafe,
  writeSafeFull,
  safeDelete,
  safeMkdir,
  restore,
  validateEdit,
  generateDiff,
  safeEdit,
} from "./execute";
export type {
  EditValidation,
  DiffResult,
  WriteOptions,
  WriteResult,
  RestoreResult,
} from "./execute";

// Shell 守卫
export { safeBashTool, isAllowed, isDangerous, _scriptContainsFileWrite, _isScriptInAllowedPath } from "./shell-guard";
export { matchGlob, getAllowlist, resetSafeShellConfigCache, _hasAgentDangerousBypass, _loadSafeShellConfig, _getConfigList, _getConfigMap } from "./shell-config";
export type { SafeBashResult, SafeBashOptions } from "./shell-guard";
export {
  DEFAULT_ALLOWLIST,
  AGENT_ALLOWLISTS,
  DANGEROUS_PATTERNS,
  ALLOWED_SCRIPT_PATHS,
  AGENT_ALLOWED_SCRIPTS,
  WRITE_PATTERNS,
} from "./shell-config";

// 审计
export { writeAuditLogEntry } from "./audit";

// 读审计
export { recordRead, normalizeReadAuditPath, makeEventKey } from "./read-audit-write";
export type { ReadAuditEntry } from "./read-audit-write";
export { verifyRead, verifyNonEmptyReadSet, getReadEventsForSession, getRequiredReadRatio, computeFileHash, getFileSize } from "./read-audit-verify";
export type { ReadVerifyResult } from "./read-audit-verify";

// TSC 诊断基线
export {
  captureBaseline,
  parseTscBaseline,
  hashTscOutput,
  compareWithBaseline,
  recordBaselineDrift,
} from "./diagnostic-baseline";

// 只读查询
export * as query from "./query";

// TSC gate lock management
export {
  resetAllTscGateLocks,
  acquireFileLock,
  releaseFileLock,
  releaseAllFileLocks,
  acquireTscMutex,
  releaseTscMutex,
  logTscGateEvent,
  resetTscGateLocks,
  cleanExpiredLocks,
} from "./tsc-gate";

// TSC 诊断
export {
  runTscDiagnostic,
  parseAllTscOutput,
  parseTscOutput,
} from "./tsc-diagnostic";
export type {
  TscDiagnosticResult,
  TscDiagnosticError,
} from "./tsc-diagnostic";

// TSC 配置
export { getTscGateConfig } from "./tsc-gate-config";
export type { TscGateConfig } from "./tsc-gate-config";

// ── Phase 3: Write Audit Trail ──
export { recordWriteAudit } from "./audit";

// ── Phase 3: Dirty Module Tracking ──
export { trackDirtyModule } from "./dirty-tracker";

// ── Phase 3: Read Track Event ──
export { trackReadEvent } from "./read-audit-write";

// ── Phase 3D: TSC Diagnostic Tracking ──
export { updateDiagnosticState } from "./diagnostic-tracker";

// ── B-4C: ESLint Runner (from eslint-audit.ts extraction) ──
export {
  getProjectRoot,
  getStateDir,
  extractModule,
  generateTierRules,
  runESLint,
  updateEslintState,
} from "./eslint-runner";
export type {
  TierRules,
  EslintViolation,
  EslintRunResult,
  StateUpdateResult,
} from "./eslint-runner";

// ── B-4C: Quality Checks (from code-quality-lib.ts extraction) ──
export {
  runScopeCheck,
  runPrettierCheck,
  runDepCruiserCheck,
  runEslintAudit,
  runTddOrderCheck,
  runTddSpecCheck,
  firstPathSegment,
} from "./quality-checks";
export type {
  CheckResult,
  CheckViolation,
  WriteScopes,
  TddState,
  TddOrderResult,
} from "./quality-checks";

// ── B-4C: Quality Batch Runners ──
export {
  runAllChecks,
  runFullScan,
} from "./quality-batch";
export type {
  RunAllChecksOptions,
  RunAllChecksResult,
  FullScanResult,
} from "./quality-batch";
