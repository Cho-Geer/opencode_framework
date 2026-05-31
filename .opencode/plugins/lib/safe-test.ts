#!/usr/bin/env node
/**
 * safe-test.ts — Test Execution Evidence Validation Tool
 * =======================================================
 *
 * Validates test_report.json files against expected schema and phase rules.
 * Used by the CI/CD pipeline and Guardian to verify test execution evidence.
 *
 * Exports:
 *   validateTestReport(taskId, phase) -> SafeTestResult
 *
 * Interfaces:
 *   SafeTestReport, SafeTestCoverage, SafeTestResult, SafeTestViolation
 *   SafeTestPhase ('red' | 'green')
 *
 * Test report schema (test_report.json):
 *   {
 *     "execution_evidence": "<string>",
 *     "exit_code": <number>,
 *     "coverage": {
 *       "lines": <number>,
 *       "branches": <number>,
 *       "functions": <number>
 *     }
 *   }
 *
 * Validation rules:
 *   - GREEN phase: exit_code must be 0, coverage >= 70% for all metrics
 *   - RED phase: exit_code must be non-zero, coverage not checked
 *   - execution_evidence must be present and non-empty for both phases
 *   - Missing file returns graceful { passed: false, violations: [...] }
 *   - Malformed JSON returns graceful { passed: false, violations: [...] }
 */

import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════════
// TYPES / INTERFACES
// ═══════════════════════════════════════════════════════════════════

/** Coverage metrics from a test run */
export interface SafeTestCoverage {
  lines: number;
  branches: number;
  functions: number;
}

/** Schema for test_report.json */
export interface SafeTestReport {
  execution_evidence?: string;
  exit_code?: number;
  coverage?: SafeTestCoverage;
  [key: string]: unknown;
}

/** A single validation violation */
export interface SafeTestViolation {
  message: string;
}

/** Result of validateTestReport */
export interface SafeTestResult {
  passed: boolean;
  violations: string[];
}

/** TDD phase indicator */
export type SafeTestPhase = "red" | "green";

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const COVERAGE_THRESHOLD = 70;
const REPORT_FILENAME = "test_report.json";

// ═══════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Read and parse the test_report.json for a given task.
 * Returns null if the file is missing or malformed.
 */
function _readReport(taskId: string): {
  report: SafeTestReport | null;
  violations: string[];
} {
  const reportPath = path.join(
    process.cwd(),
    ".task_temp",
    taskId,
    REPORT_FILENAME,
  );
  const violations: string[] = [];

  // Check file existence
  if (!fs.existsSync(reportPath)) {
    return {
      report: null,
      violations: [
        `Test report not found: .task_temp/${taskId}/${REPORT_FILENAME}`,
      ],
    };
  }

  // Read file
  let raw: string;
  try {
    raw = fs.readFileSync(reportPath, "utf8");
  } catch (err) {
    return {
      report: null,
      violations: [
        `Failed to read test report: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  // Parse JSON
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

  // Validate it's an object
  if (typeof report !== "object" || report === null) {
    return {
      report: null,
      violations: ["Test report must be a JSON object"],
    };
  }

  return { report: report as SafeTestReport, violations: [] };
}

/**
 * Validate coverage meets the minimum threshold.
 */
function _validateCoverage(report: SafeTestReport): string[] {
  const violations: string[] = [];
  const cov = report.coverage;

  if (!cov || typeof cov !== "object") {
    violations.push("Missing or invalid coverage data in test report");
    return violations;
  }

  const checks: Array<{ key: keyof SafeTestCoverage; label: string }> = [
    { key: "lines", label: "Lines" },
    { key: "branches", label: "Branches" },
    { key: "functions", label: "Functions" },
  ];

  for (const { key, label } of checks) {
    const value = cov[key];
    if (typeof value !== "number" || isNaN(value)) {
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

// ═══════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════

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

  // Read and parse the report
  const { report, violations: readViolations } = _readReport(taskId);
  if (readViolations.length > 0) {
    return { passed: false, violations: readViolations };
  }

  // Guaranteed non-null after the check above
  const rep = report!;

  // ── Check 1: execution_evidence must be present and non-empty ──
  if (
    rep.execution_evidence === undefined ||
    rep.execution_evidence === null ||
    (typeof rep.execution_evidence === "string" &&
      rep.execution_evidence.trim() === "")
  ) {
    violations.push(
      "execution_evidence field is missing or empty in test report",
    );
  }

  // ── Check 2: exit_code validation per phase ──
  const exitCode = rep.exit_code;
  if (typeof exitCode !== "number" || isNaN(exitCode)) {
    violations.push(
      `exit_code is missing or not a valid number in test report`,
    );
  } else if (phase === "green" && exitCode !== 0) {
    violations.push(`GREEN phase requires exit_code 0, but got ${exitCode}`);
  } else if (phase === "red" && exitCode === 0) {
    violations.push("RED phase requires non-zero exit_code, but got 0");
  }

  // ── Check 3: Coverage validation (GREEN phase only) ──
  if (phase === "green") {
    const covViolations = _validateCoverage(rep);
    violations.push(...covViolations);
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CLI ENTRY POINT
// ═══════════════════════════════════════════════════════════════════

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: safe-test.ts <taskId> <phase>");
    process.exit(1);
  }
  const [taskId, phase] = args as [string, SafeTestPhase];
  if (phase !== "red" && phase !== "green") {
    console.error('Phase must be "red" or "green"');
    process.exit(1);
  }
  const result = validateTestReport(taskId, phase);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 1);
}
