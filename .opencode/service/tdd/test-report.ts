// service/tdd/test-report.ts — Test report validation logic
// Migrated from lib/safe-test-core.ts (Batch 3)

import * as fs from 'fs';
import * as path from 'path';

// ════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════

export interface SafeTestCoverage {
  lines: number;
  branches: number;
  functions: number;
}

export interface SafeTestReport {
  execution_evidence?: string;
  exit_code?: number;
  coverage?: SafeTestCoverage;
  [key: string]: unknown;
}

export interface SafeTestViolation {
  message: string;
}

export interface SafeTestResult {
  passed: boolean;
  violations: string[];
}

export type SafeTestPhase = 'red' | 'green';

// ════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════

export const COVERAGE_THRESHOLD = 80;
export const REPORT_FILENAME = 'test_report.json';

// ════════════════════════════════════════════════════════════
// PUBLIC: readTestReport
// ════════════════════════════════════════════════════════════

export function readTestReport(taskId: string): {
  report: SafeTestReport | null;
  violations: string[];
} {
  const reportPath = path.join(
    process.cwd(),
    '.task_temp',
    taskId,
    REPORT_FILENAME,
  );
  const violations: string[] = [];

  if (!fs.existsSync(reportPath)) {
    return {
      report: null,
      violations: [`Test report not found: .task_temp/${taskId}/${REPORT_FILENAME}`],
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(reportPath, 'utf8');
  } catch (err) {
    return {
      report: null,
      violations: [`Failed to read test report: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  let report: unknown;
  try {
    report = JSON.parse(raw);
  } catch (err) {
    return {
      report: null,
      violations: [`Malformed JSON in test report: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  if (typeof report !== 'object' || report === null) {
    return { report: null, violations: ['Test report must be a JSON object'] };
  }

  return { report: report as SafeTestReport, violations: [] };
}

// ════════════════════════════════════════════════════════════
// PUBLIC: validateTestReport
// ════════════════════════════════════════════════════════════

export function validateTestReport(
  taskId: string,
  phase: SafeTestPhase,
): SafeTestResult {
  const violations: string[] = [];
  const { report, violations: readViolations } = readTestReport(taskId);
  if (readViolations.length > 0) return { passed: false, violations: readViolations };

  const rep = report!;

  if (
    rep.execution_evidence === undefined ||
    rep.execution_evidence === null ||
    (typeof rep.execution_evidence === 'string' && rep.execution_evidence.trim() === '')
  ) {
    violations.push('execution_evidence field is missing or empty in test report');
  }

  const exitCode = rep.exit_code;
  if (typeof exitCode !== 'number' || isNaN(exitCode)) {
    violations.push('exit_code is missing or not a valid number in test report');
  } else if (phase === 'green' && exitCode !== 0) {
    violations.push(`GREEN phase requires exit_code 0, but got ${exitCode}`);
  } else if (phase === 'red' && exitCode === 0) {
    violations.push('RED phase requires non-zero exit_code, but got 0');
  }

  if (phase === 'green') {
    const covViolations = _validateCoverage(rep);
    violations.push(...covViolations);
  }

  return { passed: violations.length === 0, violations };
}

function _validateCoverage(report: SafeTestReport): string[] {
  const violations: string[] = [];
  const cov = report.coverage;
  if (!cov || typeof cov !== 'object') {
    violations.push('Missing or invalid coverage data in test report');
    return violations;
  }
  const checks: Array<{ key: keyof SafeTestCoverage; label: string }> = [
    { key: 'lines', label: 'Lines' },
    { key: 'branches', label: 'Branches' },
    { key: 'functions', label: 'Functions' },
  ];
  for (const { key, label } of checks) {
    const value = cov[key];
    if (typeof value !== 'number' || isNaN(value)) {
      violations.push(`Coverage threshold check failed: ${label} coverage is missing or not a number`);
    } else if (value < COVERAGE_THRESHOLD) {
      violations.push(`Coverage threshold check failed: ${label} coverage is ${value}% (minimum ${COVERAGE_THRESHOLD}%)`);
    }
  }
  return violations;
}
