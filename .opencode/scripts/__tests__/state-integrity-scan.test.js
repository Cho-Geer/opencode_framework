/**
 * state-integrity-scan.test.js — FX-DIAG-ROBUST-4-RED
 * RED phase: missing optional files (rule_registry.json, Task.DAG.json)
 * on a new project should produce INFO not HIGH violations.
 * Current code treats ALL missing files as HIGH (line 31).
 *
 * TDD: RED → this test MUST FAIL on current implementation.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");

// ── Temp directory for test isolation ──
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "sis-red-test-"));
const ORIG_OPENCODE_ROOT = process.env.OPENCODE_ROOT;

// Capture console.log output
let capturedLogs = [];
const originalLog = console.log;
const originalExit = process.exit;
const originalCwd = process.cwd;

beforeAll(() => {
  // Create minimal required files (simulating a new project)
  fs.mkdirSync(path.join(TMPDIR, ".opencode", "state"), { recursive: true });

  // machine.json — required, exists
  fs.writeFileSync(
    path.join(TMPDIR, ".opencode", "state", "machine.json"),
    JSON.stringify({
      meta: { version: "1.0.0", project: "test", revision: 0 },
      eslint_state: {
        last_full_scan: null,
        modules: {},
        aggregate: {
          total_violations: 0,
          dirty_modules: [],
          waived_modules: [],
        },
      },
      diagnostic_state: { files: {}, last_updated: "" }, // replaces type_check_state (2026-06-26)
      dependency_state: {
        status: "clean",
        violations: [],
        last_check: null,
        forbidden_rules_applied: 0,
      },
      format_state: {
        status: "clean",
        unformatted_files: [],
        last_run: "",
        auto_fix_count: 0,
      },
      write_audit_state: { enabled: true, current_session: null, history: [] },
      compliance_records: {
        role_violations: [],
        gate_violations: [],
        tdd_violations: [],
      },
      tdd_enforcement_state: {
        enabled: true,
        violations: [],
        current_session: null,
        history: [],
      },
      contracts: ["contract.yaml"],
      keystone_hashes: {},
    }),
  );

  // project.config.json — required, exists
  fs.writeFileSync(
    path.join(TMPDIR, ".opencode", "project.config.json"),
    JSON.stringify({
      project: { name: "test", version: "1.0.0" },
      paths: {},
      tech_stack: {},
    }),
  );

  // Optional files intentionally NOT created:
  //   rule_registry.json — should be INFO when missing (new project)
  //   Task.DAG.json — should be INFO when missing (new project)
  //   gate-state.json — should be INFO when missing (new project)
});

afterAll(() => {
  fs.rmSync(TMPDIR, { recursive: true, force: true });
});

beforeEach(() => {
  capturedLogs = [];
  // Mock process.exit to prevent test runner from crashing
  process.exit = jest.fn();
  // Mock process.cwd to return temp dir
  process.cwd = jest.fn(() => TMPDIR);
  // Mock console.log to capture output
  console.log = jest.fn((...args) => {
    capturedLogs.push(args.join(" "));
  });
});

afterEach(() => {
  process.exit = originalExit;
  process.cwd = originalCwd;
  console.log = originalLog;
  jest.resetModules();
});

describe("FX-DIAG-ROBUST-4: Missing optional files produce INFO not HIGH", () => {
  test("missing rule_registry.json on new project should produce INFO severity (RED: currently HIGH)", () => {
    // Require the module under test — main() references process.cwd()
    // which we have mocked to point to TMPDIR
    let result;
    try {
      const sis = require("../../state-integrity-scan");
      sis.main();
    } catch (e) {
      // Module may throw due to missing files or other issues in this RED phase
    }

    // Parse the last captured log as JSON (main() outputs JSON via console.log)
    const jsonOutput =
      capturedLogs.length > 0
        ? JSON.parse(capturedLogs[capturedLogs.length - 1])
        : null;

    // RED ASSERTION: This will FAIL on current code because:
    // state-integrity-scan.js line 31 emits HIGH for ALL missing files.
    // After fix (GREEN), missing rule_registry.json should emit INFO.
    expect(jsonOutput).not.toBeNull();
    if (jsonOutput && jsonOutput.inconsistencies) {
      const ruleRegistryIssue = jsonOutput.inconsistencies.find(
        (i) => i.file === "rule_registry.json" && i.issue === "file_missing",
      );
      // RED: currently severity is "HIGH" — this assertion expects "INFO"
      // which will FAIL, proving the test is valid.
      expect(ruleRegistryIssue).toBeDefined();
      if (ruleRegistryIssue) {
        expect(ruleRegistryIssue.severity).toBe("INFO");
      }
    }
  });

  test("missing Task.DAG.json on new project should produce INFO severity (RED: currently HIGH)", () => {
    let result;
    try {
      // Reset modules to clear any cached require
      jest.resetModules();
      const sis = require("../../state-integrity-scan");
      sis.main();
    } catch (e) {
      // Expected to possibly throw during RED phase
    }

    const jsonOutput =
      capturedLogs.length > 0
        ? JSON.parse(capturedLogs[capturedLogs.length - 1])
        : null;

    // RED: asserts INFO severity for missing Task.DAG.json
    // Currently FAILS because code emits HIGH
    expect(jsonOutput).not.toBeNull();
    if (jsonOutput && jsonOutput.inconsistencies) {
      const dagIssue = jsonOutput.inconsistencies.find(
        (i) => i.file === "Task.DAG.json" && i.issue === "file_missing",
      );
      expect(dagIssue).toBeDefined();
      if (dagIssue) {
        expect(dagIssue.severity).toBe("INFO");
      }
    }
  });

  test("missing machine.json on new project should still be HIGH (required file)", () => {
    // This test verifies that required files remain HIGH.
    // machine.json IS created in beforeAll, so this test structure
    // tests that when ONLY optional files are missing, required files
    // are present and no HIGH is emitted for them.
    let result;
    try {
      jest.resetModules();
      const sis = require("../../state-integrity-scan");
      sis.main();
    } catch (e) {
      // Expected to possibly throw during RED phase
    }

    const jsonOutput =
      capturedLogs.length > 0
        ? JSON.parse(capturedLogs[capturedLogs.length - 1])
        : null;

    expect(jsonOutput).not.toBeNull();
    if (jsonOutput && jsonOutput.inconsistencies) {
      const machineIssue = jsonOutput.inconsistencies.find(
        (i) => i.file === "machine.json",
      );
      // machine.json exists in test setup, so no missing issue expected
      expect(machineIssue).toBeUndefined();
    }
  });

  test("gate-state.json missing on new project should produce INFO (optional file) (RED: currently HIGH)", () => {
    let result;
    try {
      jest.resetModules();
      const sis = require("../../state-integrity-scan");
      sis.main();
    } catch (e) {
      // Expected to possibly throw during RED phase
    }

    const jsonOutput =
      capturedLogs.length > 0
        ? JSON.parse(capturedLogs[capturedLogs.length - 1])
        : null;

    expect(jsonOutput).not.toBeNull();
    if (jsonOutput && jsonOutput.inconsistencies) {
      const gateStateIssue = jsonOutput.inconsistencies.find(
        (i) => i.file === "gate-state.json" && i.issue === "file_missing",
      );
      expect(gateStateIssue).toBeDefined();
      if (gateStateIssue) {
        // RED: expects INFO, but current code emits HIGH → test FAILS
        expect(gateStateIssue.severity).toBe("INFO");
      }
    }
  });
});
