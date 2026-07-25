/**
 * lib/safe-test-core.ts — BRIDGE (Batch 3)
 * Logic migrated to service/tdd/test-report.ts
 * This file re-exports for backward compatibility.
 */
export {
  validateTestReport,
  readTestReport,
  COVERAGE_THRESHOLD,
  REPORT_FILENAME,
} from "../service/tdd/test-report";
export type {
  SafeTestResult,
  SafeTestReport,
  SafeTestCoverage,
  SafeTestViolation,
  SafeTestPhase,
} from "../service/tdd/test-report";
