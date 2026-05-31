/**
 * install-hooks.test.js — FX-DIAG-ROBUST-5-RED
 * RED phase: install-hooks.js should verify jq is available on PATH
 * and emit a warning when jq is missing.
 * Current code has NO jq dependency check, but state-machine-reset.sh
 * requires jq to function.
 *
 * TDD: RED → this test MUST FAIL on current implementation.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");

// ── Temp directory for test isolation ──
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "ih-red-test-"));
const HOOKS_DIR = path.join(TMPDIR, ".opencode", "hooks");

// Track whether 'which jq' was called
let whichJqCalled = false;
let whichJqResult = null; // null = not configured, { status, stdout, stderr }

// Capture console.log output
let capturedLogs = [];
const originalLog = console.log;
const originalExit = process.exit;

beforeAll(() => {
  // Create hooks directory with required hooks
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  // Create a minimal pre-commit hook (required)
  fs.writeFileSync(path.join(HOOKS_DIR, "pre-commit"), "#!/bin/sh\necho 'mock pre-commit'\n", { mode: 0o755 });
  // Create a minimal commit-msg hook (required)
  fs.writeFileSync(path.join(HOOKS_DIR, "commit-msg"), "#!/bin/sh\necho 'mock commit-msg'\n", { mode: 0o755 });
});

afterAll(() => {
  fs.rmSync(TMPDIR, { recursive: true, force: true });
});

beforeEach(() => {
  capturedLogs = [];
  whichJqCalled = false;
  whichJqResult = null;

  // Mock process.exit to prevent test runner from crashing
  process.exit = jest.fn();

  // Mock console.log to capture output
  console.log = jest.fn((...args) => {
    capturedLogs.push(args.join(" "));
  });

  // Mock process.cwd to point to TMPDIR
  const originalCwd = process.cwd;
  process.cwd = jest.fn(() => TMPDIR);
});

afterEach(() => {
  process.exit = originalExit;
  console.log = originalLog;
  jest.resetModules();
  // Restore any mocked modules
  jest.unmock("child_process");
  jest.unmock("fs");
});

describe("FX-DIAG-ROBUST-5: jq dependency check in install-hooks", () => {
  test("install-hooks should call 'which jq' to verify jq availability (RED: no jq check exists)", () => {
    // Mock child_process.spawnSync to handle git commands normally
    // but record if 'which jq' is ever called
    jest.mock("child_process", () => ({
      spawnSync: jest.fn((cmd, args) => {
        // Check if this is a 'which jq' call
        if (cmd === "which" && args && args[0] === "jq") {
          whichJqCalled = true;
          return { status: 1, stdout: "", stderr: "jq not found", pid: 0, output: [] };
        }
        // Handle git config get — return hooksPath
        if (cmd === "git" && args && args[0] === "config" && args.includes("core.hooksPath")) {
          return { status: 0, stdout: ".opencode/hooks\n", stderr: "", pid: 0, output: [] };
        }
        // Handle git config set
        if (cmd === "git" && args && args[0] === "config" && args[1] === "core.hooksPath") {
          return { status: 0, stdout: "", stderr: "", pid: 0, output: [] };
        }
        // Default: command not found
        return { status: 1, stdout: "", stderr: "command not found", pid: 0, output: [] };
      }),
    }));

    // Need to re-require after mocking — but jest.mock is hoisted,
    // so the mock applies when require is called in the test.
    // We use jest.isolateModules or dynamic require after the mock is set up.
    let capturedOutput = null;
    try {
      // Use jest.isolateModules to get a fresh require with mock applied
      jest.isolateModules(() => {
        try {
          require("../../install-hooks");
        } catch (e) {
          // Module may throw in RED phase
        }
      });
    } catch (e) {
      // Expected during RED phase
    }

    // RED: 'which jq' should have been called — currently NOT called
    // by install-hooks.js, so this assertion FAILS.
    expect(whichJqCalled).toBe(true);
  });

  test("install-hooks should emit warning when jq is not found on PATH (RED: no jq check exists)", () => {
    jest.mock("child_process", () => ({
      spawnSync: jest.fn((cmd, args) => {
        // Record 'which jq' call
        if (cmd === "which" && args && args[0] === "jq") {
          whichJqCalled = true;
          whichJqResult = { status: 1, stdout: "", stderr: "jq not found", pid: 0, output: [] };
          return { status: 1, stdout: "", stderr: "jq not found", pid: 0, output: [] };
        }
        // Handle git commands normally
        if (cmd === "git" && args && args[0] === "config") {
          return { status: 0, stdout: ".opencode/hooks\n", stderr: "", pid: 0, output: [] };
        }
        return { status: 1, stdout: "", stderr: "not found", pid: 0, output: [] };
      }),
    }));

    try {
      jest.isolateModules(() => {
        try {
          require("../../install-hooks");
        } catch (e) {
          // Expected during RED phase
        }
      });
    } catch (e) {
      // Expected during RED phase
    }

    // Parsing captured output to find jq-related message
    const outputText = capturedLogs.join(" ");
    // RED: asserts output should mention jq — currently NO jq check exists,
    // so this assertion FAILS on current code.
    expect(outputText.toLowerCase()).toContain("jq");
  });

  test("install-hooks should pass when jq is available on PATH (future GREEN: happy path)", () => {
    jest.mock("child_process", () => ({
      spawnSync: jest.fn((cmd, args) => {
        // jq found successfully
        if (cmd === "which" && args && args[0] === "jq") {
          whichJqCalled = true;
          return { status: 0, stdout: "/usr/bin/jq\n", stderr: "", pid: 0, output: [] };
        }
        // Handle git commands normally
        if (cmd === "git" && args && args[0] === "config") {
          return { status: 0, stdout: ".opencode/hooks\n", stderr: "", pid: 0, output: [] };
        }
        return { status: 1, stdout: "", stderr: "not found", pid: 0, output: [] };
      }),
    }));

    try {
      jest.isolateModules(() => {
        try {
          require("../../install-hooks");
        } catch (e) {
          // Expected during RED phase
        }
      });
    } catch (e) {
      // Expected during RED phase
    }

    // RED: asserts jq was checked — currently NOT checked,
    // so this assertion FAILS.
    expect(whichJqCalled).toBe(true);

    // When jq IS found, no warning should be emitted about it
    const jqWarnings = capturedLogs.filter(
      l => l.toLowerCase().includes("jq") && l.toLowerCase().includes("warn")
    );
    // jq is available, so no warning — this is an expectation for GREEN phase
    // but for RED, `whichJqCalled` being false already causes failure.
  });

  test("install-hooks should document jq dependency in install summary (RED: jq not mentioned)", () => {
    jest.mock("child_process", () => ({
      spawnSync: jest.fn((cmd, args) => {
        if (cmd === "which" && args && args[0] === "jq") {
          whichJqCalled = true;
          return { status: 1, stdout: "", stderr: "not found", pid: 0, output: [] };
        }
        if (cmd === "git" && args && args[0] === "config") {
          return { status: 0, stdout: ".opencode/hooks\n", stderr: "", pid: 0, output: [] };
        }
        return { status: 1, stdout: "", stderr: "not found", pid: 0, output: [] };
      }),
    }));

    try {
      jest.isolateModules(() => {
        try {
          require("../../install-hooks");
        } catch (e) {
          // Expected during RED phase
        }
      });
    } catch (e) {
      // Expected during RED phase
    }

    // RED: The install-hooks output should contain a summary or note
    // about jq being required by state-machine-reset.sh.
    // Currently install-hooks has NO jq mention, so this FAILS.
    const outputText = capturedLogs.join(" ");
    expect(outputText.toLowerCase()).toContain("jq");
  });
});
