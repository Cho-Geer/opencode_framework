// service/tdd/index.ts — TddService 统一入口
// 所有 DB 写入的唯一入口

// 状态管理
export {
  checkTddEnforcement,
  updateTddState,
  _diffSummary,
} from "./enforcement";
export type {
  TddDiffEvidence,
  TddSessionState,
  TddEnforcementState,
} from "./enforcement";

// Diff 验证
export {
  verifyTddWrite,
  isTestFile,
  hasOnlyShallowTests,
} from "./diff-verify";

// ── Batch 3: Test Report Validation (from lib/safe-test-core.ts) ──
export {
  validateTestReport,
  readTestReport,
  COVERAGE_THRESHOLD,
  REPORT_FILENAME,
} from "./test-report";
export type {
  SafeTestResult,
  SafeTestReport,
  SafeTestCoverage,
  SafeTestViolation,
  SafeTestPhase,
} from "./test-report";

// 只读查询
export * as query from "./query";
