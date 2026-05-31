/**
 * safe-test-core.ts — Shared Test Report Validation Logic
 * =======================================================
 *
 * Extracted from .opencode/tools/safe-test.ts and .opencode/tools/safe-test.js.
 * Validates test_report.json files against expected schema and TDD phase rules.
 *
 * Exports:
 *   - validateTestReport(taskId, phase): SafeTestResult
 *   - readTestReport(taskId): { report, violations }
 *   - SafeTestReport, SafeTestCoverage, SafeTestResult
 *   - SafeTestViolation, SafeTestPhase
 *
 * @author @Architect
 * @version 1.0.0
 */

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

export const COVERAGE_THRESHOLD = 70;
export const REPORT_FILENAME = 'test_report.json';

// ════════════════════════════════════════════════════════════
// PUBLIC: readTestReport
// ════════════════════════════════════════════════════════════

/**
 * Read and parse the test_report.json for a given task.
 * Returns the parsed report and any read/parse violations.
 */
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
      violations: [
        `Test report not found: .task_temp/${taskId}/${REPORT_FILENAME}`,
      ],
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(reportPath, 'utf8');
  } catch (err) {
    return {
      report: null,
      violations: [
        `Failed to read test report: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  let report: unknown;
  try {
    report = JSON.parse(raw);
  } catch (err) {
    return {
      report: null,
      violations: [
        `Malformed JSON in test report: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  if (typeof report !== 'object' || report === null) {
    return {
      report: null,
      violations: ['Test report must be a JSON object'],
    };
  }

  return { report: report as SafeTestReport, violations: [] };
}

// ════════════════════════════════════════════════════════════
// PUBLIC: validateTestReport
// ════════════════════════════════════════════════════════════

/**
 * Validate a test report for a given task and TDD phase.
 *
 * @param taskId - The task identifier (directory under .task_temp/)
 * @param phase  - The TDD phase: 'red' or 'green'
 * @returns SafeTestResult with passed flag and list of violations
 */
export function validateTestReport(
  taskId: string,
  phase: SafeTestPhase,
): SafeTestResult {
  const violations: string[] = [];

  const { report, violations: readViolations } = readTestReport(taskId);
  if (readViolations.length > 0) {
    return { passed: false, violations: readViolations };
  }

  const rep = report!;

  // Check 1: execution_evidence must be present and non-empty
  if (
    rep.execution_evidence === undefined ||
    rep.execution_evidence === null ||
    (typeof rep.execution_evidence === 'string' &&
      rep.execution_evidence.trim() === '')
  ) {
    violations.push(
      'execution_evidence field is missing or empty in test report',
    );
  }

  // Check 2: exit_code validation per phase
  const exitCode = rep.exit_code;
  if (typeof exitCode !== 'number' || isNaN(exitCode)) {
    violations.push('exit_code is missing or not a valid number in test report');
  } else if (phase === 'green' && exitCode !== 0) {
    violations.push(`GREEN phase requires exit_code 0, but got ${exitCode}`);
  } else if (phase === 'red' && exitCode === 0) {
    violations.push('RED phase requires non-zero exit_code, but got 0');
  }

  // Check 3: Coverage validation (GREEN phase only)
  if (phase === 'green') {
    const covViolations = _validateCoverage(rep);
    violations.push(...covViolations);
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

// ════════════════════════════════════════════════════════════
// INTERNAL: _validateCoverage
// ════════════════════════════════════════════════════════════

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
      violations.push(
        `Coverage threshold check failed: ${label} coverage is missing or not a number`,
      );
    } else if (value < COVERAGE_THRESHOLD) {
      violations.push(
        `Coverage threshold check failed: ${label} coverage is ${value}% (minimum ${COVERAGE_THRESHOLD}%)`,
      );
    }
  }

  return violations;
}
