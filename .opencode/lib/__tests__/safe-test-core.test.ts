/**
 * safe-test-core.test.ts — TDD RED phase tests
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const {
  readTestReport,
  validateTestReport,
  COVERAGE_THRESHOLD,
  REPORT_FILENAME,
} = require('../safe-test-core');

function createTestReport(taskId: string, data: object): string {
  const dir = path.join(process.cwd(), '.task_temp', taskId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'test_report.json');
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

function removeTestReport(taskId: string): void {
  const dir = path.join(process.cwd(), '.task_temp', taskId);
  try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
}

describe('safe-test-core', () => {
  afterEach(() => {
    const taskDir = path.join(process.cwd(), '.task_temp');
    try { fs.rmSync(taskDir, { recursive: true }); } catch { /* ignore */ }
  });

  describe('constants', () => {
    it('should have COVERAGE_THRESHOLD set to 70', () => {
      expect(COVERAGE_THRESHOLD).toBe(70);
    });

    it('should have REPORT_FILENAME set', () => {
      expect(REPORT_FILENAME).toBe('test_report.json');
    });
  });

  describe('readTestReport', () => {
    it('should return violations for missing report', () => {
      const result = readTestReport('nonexistent-task');
      expect(result.report).toBeNull();
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should parse a valid test report', () => {
      createTestReport('test-task-read', {
        execution_evidence: 'Tests passed',
        exit_code: 0,
      });
      const result = readTestReport('test-task-read');
      expect(result.report).not.toBeNull();
      expect(result.violations.length).toBe(0);
    });
  });

  describe('validateTestReport', () => {
    it('should fail GREEN phase when exit_code is non-zero', () => {
      createTestReport('test-green-fail', {
        execution_evidence: 'some output',
        exit_code: 1,
        coverage: { lines: 80, branches: 80, functions: 80 },
      });
      const result = validateTestReport('test-green-fail', 'green');
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.includes('exit_code'))).toBe(true);
    });

    it('should fail RED phase when exit_code is 0', () => {
      createTestReport('test-red-fail', {
        execution_evidence: 'some output',
        exit_code: 0,
      });
      const result = validateTestReport('test-red-fail', 'red');
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.includes('RED'))).toBe(true);
    });

    it('should pass GREEN phase with valid report and coverage', () => {
      createTestReport('test-green-pass', {
        execution_evidence: 'All tests passed',
        exit_code: 0,
        coverage: { lines: 80, branches: 75, functions: 85 },
      });
      const result = validateTestReport('test-green-pass', 'green');
      expect(result.passed).toBe(true);
    });

    it('should reject missing execution_evidence', () => {
      createTestReport('test-no-evidence', {
        exit_code: 0,
        coverage: { lines: 80, branches: 80, functions: 80 },
      });
      const result = validateTestReport('test-no-evidence', 'green');
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.includes('execution_evidence'))).toBe(true);
    });
  });
});
