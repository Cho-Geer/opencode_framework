/**
 * safe-test.test.ts — CI-UNIFY-001 RED Phase (Failing Tests)
 * =================================================================
 *
 * RED phase test file for the safe-test.ts test report validation tool.
 * These tests MUST fail initially (exit code != 0) because the
 * implementation has not been written yet.
 *
 * When safe-test.ts IS implemented, these tests should all pass (exit code 0).
 *
 * Test coverage:
 *   1) Valid GREEN report passes
 *   2) Valid RED report passes (exit_code != 0)
 *   3) Missing execution_evidence fails
 *   4) Wrong exit_code for phase fails
 *   5) Below-threshold coverage fails
 *   6) Malformed JSON fails
 *   7) Missing file returns graceful error
 */

import { validateTestReport, SafeTestResult } from "../safe-test-core";
import * as fs from "fs";
import * as path from "path";

const TASK_ID = "__test_ci_unify_001__";
const TASK_TEMP_DIR = path.join(process.cwd(), ".task_temp", TASK_ID);

// ═══════════════════════════════════════════════════════════════════════════════
// Test Utilities
// ═══════════════════════════════════════════════════════════════════════════════

function writeTestReport(data: unknown): string {
  const reportPath = path.join(TASK_TEMP_DIR, "test_report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(data, null, 2), "utf8");
  return reportPath;
}

function removeTestReport(): void {
  const reportPath = path.join(TASK_TEMP_DIR, "test_report.json");
  if (fs.existsSync(reportPath)) {
    fs.unlinkSync(reportPath);
  }
  // Try to remove the directory if empty
  try {
    fs.rmdirSync(TASK_TEMP_DIR);
  } catch (_) {
    /* ignore */
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite: validateTestReport
// ═══════════════════════════════════════════════════════════════════════════════

describe("validateTestReport", () => {
  // Cleanup before and after each test to ensure isolation
  beforeEach(() => {
    removeTestReport();
  });

  afterAll(() => {
    removeTestReport();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Valid GREEN report passes
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Valid GREEN report", () => {
    it("should pass when exit_code is 0 and coverage meets threshold", () => {
      writeTestReport({
        execution_evidence: "All 42 tests passed (12.3s)",
        exit_code: 0,
        coverage: {
          lines: 85.5,
          branches: 78.2,
          functions: 91.0,
        },
      });

      const result: SafeTestResult = validateTestReport(TASK_ID, "green");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should pass when coverage exactly meets the 70% threshold", () => {
      writeTestReport({
        execution_evidence: "All tests passed",
        exit_code: 0,
        coverage: {
          lines: 70.0,
          branches: 70.0,
          functions: 70.0,
        },
      });

      const result: SafeTestResult = validateTestReport(TASK_ID, "green");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Valid RED report passes
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Valid RED report", () => {
    it("should pass when exit_code is non-zero (RED phase)", () => {
      writeTestReport({
        execution_evidence: "5 tests failed as expected (RED phase)",
        exit_code: 1,
      });

      const result: SafeTestResult = validateTestReport(TASK_ID, "red");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should pass even without coverage data in RED phase", () => {
      writeTestReport({
        execution_evidence: "Tests failed intentionally",
        exit_code: 2,
      });

      const result: SafeTestResult = validateTestReport(TASK_ID, "red");

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: Missing execution_evidence fails
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Missing execution_evidence", () => {
    it("should fail when execution_evidence field is missing", () => {
      writeTestReport({
        exit_code: 0,
        coverage: { lines: 90, branches: 85, functions: 88 },
      });

      const result: SafeTestResult = validateTestReport(TASK_ID, "green");

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(
        result.violations.some((v: string) =>
          v.toLowerCase().includes("execution_evidence"),
        ),
      ).toBe(true);
    });

    it("should fail when execution_evidence is empty string", () => {
      writeTestReport({
        execution_evidence: "",
        exit_code: 0,
        coverage: { lines: 90, branches: 85, functions: 88 },
      });

      const result: SafeTestResult = validateTestReport(TASK_ID, "green");

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("should fail when execution_evidence is null", () => {
      writeTestReport({
        execution_evidence: null,
        exit_code: 0,
      });

      const result: SafeTestResult = validateTestReport(TASK_ID, "green");

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4: Wrong exit_code for phase fails
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Wrong exit_code for phase", () => {
    it("should fail for GREEN phase when exit_code is non-zero", () => {
      writeTestReport({
        execution_evidence: "Some tests failed",
        exit_code: 1,
        coverage: { lines: 85, branches: 80, functions: 90 },
      });

      const result: SafeTestResult = validateTestReport(TASK_ID, "green");

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(
        result.violations.some((v: string) =>
          v.toLowerCase().includes("exit_code"),
        ),
      ).toBe(true);
    });

    it("should fail for RED phase when exit_code is 0", () => {
      writeTestReport({
        execution_evidence: "All tests passed unexpectedly",
        exit_code: 0,
      });

      const result: SafeTestResult = validateTestReport(TASK_ID, "red");

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(
        result.violations.some((v: string) =>
          v.toLowerCase().includes("exit_code"),
        ),
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 5: Below-threshold coverage fails (GREEN phase only)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Below-threshold coverage", () => {
    it("should fail when lines coverage is below 70%", () => {
      writeTestReport({
        execution_evidence: "Tests passed but coverage low",
        exit_code: 0,
        coverage: {
          lines: 55.0,
          branches: 80.0,
          functions: 85.0,
        },
      });

      const result: SafeTestResult = validateTestReport(TASK_ID, "green");

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(
        result.violations.some((v: string) =>
          v.toLowerCase().includes("coverage"),
        ),
      ).toBe(true);
    });

    it("should fail when branches coverage is below 70%", () => {
      writeTestReport({
        execution_evidence: "Tests passed but branch coverage low",
        exit_code: 0,
        coverage: {
          lines: 85.0,
          branches: 45.0,
          functions: 90.0,
        },
      });

      const result: SafeTestResult = validateTestReport(TASK_ID, "green");

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("should fail when functions coverage is below 70%", () => {
      writeTestReport({
        execution_evidence: "Tests passed but func coverage low",
        exit_code: 0,
        coverage: {
          lines: 90.0,
          branches: 85.0,
          functions: 30.0,
        },
      });

      const result: SafeTestResult = validateTestReport(TASK_ID, "green");

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 6: Malformed JSON fails
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Malformed JSON", () => {
    it("should fail gracefully when test_report.json contains invalid JSON", () => {
      const reportPath = path.join(TASK_TEMP_DIR, "test_report.json");
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, "{ this is not valid json }", "utf8");

      const result: SafeTestResult = validateTestReport(TASK_ID, "green");

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 7: Missing file returns graceful error
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Missing file", () => {
    it("should return violations (not throw) when test_report.json does not exist", () => {
      // Ensure no file exists
      removeTestReport();

      const result: SafeTestResult = validateTestReport(
        "nonexistent-task-id",
        "green",
      );

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("should return violations (not throw) when task directory does not exist", () => {
      const result: SafeTestResult = validateTestReport(
        "__nonexistent_dir_12345__",
        "green",
      );

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });
});
