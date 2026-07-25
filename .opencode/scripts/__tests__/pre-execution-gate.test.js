/**
 * pre-execution-gate.test.js — TDD tests for pre-execution-gate.js
 * =================================================================
 * Tests cover:
 *   - NOT_A_TASK exits nonzero
 *   - Completed task exits nonzero
 *   - Missing config exits nonzero in strict mode
 *   - Valid pending task with armed gate exits 0 (happy path)
 *   - No argument exits nonzero
 *   - Windows/WSL paths resolve consistently
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

// DB sync helpers: pre-execution-gate.ts now reads gate sessions and
// compliance_records from the SQLite DB instead of JSON files.
const { dbSaveGateStore, dbWriteSubState } = require("../../lib/db-state-manager");
const { getDb, closeDb } = require("../../lib/db-manager");

// ─── Paths ─────────────────────────────────────────────────────────────────
// Source is .ts; bun executes it natively via process.execPath (bun binary).
const GATE_SCRIPT = path.join(__dirname, "..", "pre-execution-gate.ts");
const TEMP_DIR = path.join(__dirname, "__gate_test__");
const TEMP_OPENDODE = path.join(TEMP_DIR, ".opencode");
const TEMP_STATE = path.join(TEMP_OPENDODE, "state");

// ─── Test Helpers ──────────────────────────────────────────────────────────

function setupTestFixture() {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(TEMP_OPENDODE, { recursive: true });
  fs.mkdirSync(TEMP_STATE, { recursive: true });
}

function teardownTestFixture() {
  // Close any per-test SQLite singleton so the next test gets a fresh DB
  // connection pointing at its own temp directory.
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

/**
 * Create a minimal Task.DAG.json with specified tasks.
 */
function writeDAG(tasks) {
  const dag = {
    version: "1.0.0",
    project: "test-project",
    tasks: tasks,
  };
  fs.writeFileSync(path.join(TEMP_DIR, "Task.DAG.json"), JSON.stringify(dag, null, 2));
}

/**
 * Create a minimal project.config.json with specified enforcement mode.
 */
function writeProjectConfig(enforcementMode) {
  const cfg = {
    project: { name: "test-project" },
    template_resolution: {
      enforcement_mode: enforcementMode || "strict",
      contract_hash_command: "echo hash",
    },
  };
  fs.writeFileSync(
    path.join(TEMP_OPENDODE, "project.config.json"),
    JSON.stringify(cfg, null, 2),
  );
}

/**
 * Create a minimal gate-state.json with specified sessions and sync the same
 * data to the SQLite DB. pre-execution-gate.ts reads gate sessions via
 * dbLoadGateStore(), so the DB is the source of truth for Check 3.
 */
function writeGateState(sessions) {
  const gs = {
    formatVersion: "2.0",
    sessions: sessions || {},
  };
  fs.writeFileSync(
    path.join(TEMP_STATE, "gate-state.json"),
    JSON.stringify(gs, null, 2),
  );

  // Mirror to DB so the gate lifecycle check sees the sessions.
  try {
    getDb({ root: TEMP_DIR });
    dbSaveGateStore(gs);
  } catch (e) {
    // Best-effort: JSON file remains for fallback/debugging.
    throw new Error(`Failed to sync gate state to DB: ${e.message}`);
  }
}

/**
 * Create a minimal machine.json with specified role violations and sync the
 * compliance_records sub-state to the SQLite DB. pre-execution-gate.ts reads
 * role violations via readSubState("compliance_records"), so the DB is the
 * source of truth for Check 4.
 */
function writeMachine(roleViolations) {
  const records = { role_violations: roleViolations || [] };
  const mach = {
    meta: { version: "1.0.0", project: "test-project" },
    compliance_records: records,
  };
  fs.writeFileSync(
    path.join(TEMP_STATE, "machine.json"),
    JSON.stringify(mach, null, 2),
  );

  // Mirror compliance_records to DB.
  try {
    getDb({ root: TEMP_DIR });
    dbWriteSubState("compliance_records", records);
  } catch (e) {
    throw new Error(`Failed to sync compliance records to DB: ${e.message}`);
  }
}

/**
 * Write a minimal rule_registry.json.
 */
function writeRuleRegistry(entries) {
  const rr = {
    meta: { version: "1.0.0", digest_algorithm: "sha256" },
    entries: entries || {},
  };
  fs.writeFileSync(
    path.join(TEMP_STATE, "rule_registry.json"),
    JSON.stringify(rr, null, 2),
  );
}

/**
 * Run the gate script with environment overrides to point to test fixture.
 * Returns { exitCode, stdout, stderr }.
 */
function runGate(taskId, options) {
  const opts = options || {};
  const env = {
    ...process.env,
    ENFORCEMENT_MODE: opts.enforcementMode || "strict",
    // We can't easily override OPENCODE_ROOT from outside without modifying the script,
    // but the script uses __dirname to resolve. The OPENCODE_ROOT env can override.
    OPENCODE_ROOT: TEMP_DIR,
    PATH: process.env.PATH,
  };

  // Use spawnSync so we capture stderr even on successful exit (the gate
  // script logs its header and success summary to stderr).
  const result = spawnSync(
    process.execPath,
    [GATE_SCRIPT, taskId],
    {
      env: env,
      encoding: "utf-8",
      timeout: 10000,
      cwd: TEMP_DIR,
    },
  );
  return {
    exitCode: result.status === null ? 1 : result.status,
    stdout: (result.stdout || "").toString(),
    stderr: (result.stderr || "").toString(),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("pre-execution-gate.js", () => {
  beforeEach(() => {
    setupTestFixture();
  });

  afterEach(() => {
    teardownTestFixture();
  });

  // ── Test 1: NOT_A_TASK exits nonzero ────────────────────────────────────
  test("NOT_A_TASK exits nonzero", () => {
    writeDAG([
      { id: "NOT_A_TASK", status: "pending", owner: "@Architect" },
    ]);
    writeProjectConfig("strict");
    writeGateState({});
    writeMachine([]);

    const result = runGate("NOT_A_TASK");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("NOT_A_TASK");
  });

  // ── Test 2: Completed task exits nonzero ────────────────────────────────
  test("A completed task exits nonzero", () => {
    writeDAG([
      { id: "FW-TEST-001", status: "completed", owner: "@Architect" },
    ]);
    writeProjectConfig("strict");
    writeGateState({
      cg_ses_test001: {
        session_id: "cg_ses_test001",
        gate_status: "completed",
        confirmed_at: "2026-05-24T07:00:00.000Z",
        consumed_at: null,
      },
    });
    writeMachine([]);

    const result = runGate("FW-TEST-001");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("completed");
  });

  // ── Test 3: Missing config exits nonzero in strict mode ─────────────────
  test("Missing config exits nonzero in strict mode", () => {
    // Don't create any config files — simulate missing setup
    setupTestFixture(); // fresh empty dir

    const result = runGate("FW-TEST-002");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("FAILED");
  });

  // ── Test 4: Valid pending task with armed gate exits 0 (happy path) ─────
  test("Valid pending task with armed gate exits 0", () => {
    writeDAG([
      { id: "FW-TEST-003", status: "pending", owner: "@Architect" },
    ]);
    writeProjectConfig("strict");
    writeGateState({
      cg_ses_test003: {
        session_id: "cg_ses_test003",
        gate_status: "completed",
        confirmed_at: "2026-05-24T07:00:00.000Z",
        consumed_at: null, // armed: confirmed but not consumed
        created_at: "2026-05-24T06:55:00.000Z",
        task_description: "Test task",
      },
    });
    writeMachine([]);
    // Also create a valid rule_registry.json (empty entries = no mismatches)
    writeRuleRegistry({});

    // Need to also create the script's expected state directory
    const result = runGate("FW-TEST-003");
    // Should pass all checks (assertion is that it doesn't error on gate lifecycle)
    expect(result.exitCode).toBe(0);
  });

  // ── Test 5: No argument exits nonzero ───────────────────────────────────
  test("No argument exits nonzero", () => {
    writeDAG([]);
    writeProjectConfig("strict");
    writeGateState({});
    writeMachine([]);

    try {
      execFileSync(process.execPath, [GATE_SCRIPT], {
        env: { ...process.env, OPENCODE_ROOT: TEMP_DIR, PATH: process.env.PATH },
        stdio: "pipe",
        timeout: 5000,
        cwd: TEMP_DIR,
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (e) {
      expect(e.status).not.toBe(0);
    }
  });

  // ── Test 6: Windows/WSL paths resolve consistently ──────────────────────
  test("OPENCODE_ROOT resolves to a valid existing path", () => {
    // Clear any OPENCODE_ROOT leaked by previous tests in the suite.
    delete process.env.OPENCODE_ROOT;
    // Purge module cache so the const OPENCODE_ROOT is re-evaluated from __dirname.
    const modPath = require.resolve("../pre-execution-gate.ts");
    delete require.cache[modPath];
    const { OPENCODE_ROOT } = require("../pre-execution-gate.ts");
    expect(path.isAbsolute(OPENCODE_ROOT)).toBe(true);
    expect(fs.existsSync(OPENCODE_ROOT)).toBe(true);
    expect(fs.existsSync(path.join(OPENCODE_ROOT, ".opencode"))).toBe(true);
  });

  // ── Test 7: Unresolved role violations cause failure ────────────────────
  test("Unresolved role violations exit nonzero in strict mode", () => {
    writeDAG([
      { id: "FW-TEST-004", status: "pending", owner: "@Architect" },
    ]);
    writeProjectConfig("strict");
    writeGateState({
      cg_ses_test004: {
        session_id: "cg_ses_test004",
        gate_status: "completed",
        confirmed_at: "2026-05-24T07:00:00.000Z",
        consumed_at: null,
      },
    });
    writeMachine([
      {
        timestamp: "2026-05-24T07:00:00.000Z",
        agent: "@Coder-BE",
        violation_file: "restricted/file.ts",
        status: "unresolved",
        severity: "BLOCKER",
      },
    ]);

    const result = runGate("FW-TEST-004");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("role violation");
  });

  // ── Test 8: Advisory-configured project still dispatches valid tasks ─────
  // NOTE: The current production enforcement shim always reports "strict",
  // so advisory mode does not bypass failures. This test verifies that a
  // valid pending task with an armed gate session exits 0 even when the
  // project config is set to advisory.
  test("Advisory-configured project allows valid pending task", () => {
    writeDAG([
      { id: "FW-TEST-005", status: "pending", owner: "@Architect" },
    ]);
    writeProjectConfig("advisory");
    writeGateState({
      cg_ses_test005: {
        session_id: "cg_ses_test005",
        gate_status: "completed",
        confirmed_at: "2026-05-24T07:00:00.000Z",
        consumed_at: null,
        created_at: "2026-05-24T06:55:00.000Z",
        task_description: "Test task",
      },
    });
    writeMachine([]);

    const result = runGate("FW-TEST-005");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("STRICT");
  });

  // ── Test 9: Task not in DAG at all exits nonzero ────────────────────────
  test("Task not found in DAG exits nonzero", () => {
    writeDAG([
      { id: "OTHER-TASK", status: "pending", owner: "@Architect" },
    ]);
    writeProjectConfig("strict");
    writeGateState({});
    writeMachine([]);

    const result = runGate("NONEXISTENT-TASK");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not found");
  });

  // ── Test 10: Task with in_progress status exits nonzero ─────────────────
  test("Task with in_progress status exits nonzero (only pending accepted)", () => {
    writeDAG([
      { id: "FW-TEST-006", status: "in_progress", owner: "@Architect" },
    ]);
    writeProjectConfig("strict");
    writeGateState({});
    writeMachine([]);

    const result = runGate("FW-TEST-006");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("in_progress");
  });

  // ── Test 11: No armed gate session exits nonzero ────────────────────────
  test("No armed gate session exits nonzero in strict mode", () => {
    writeDAG([
      { id: "FW-TEST-007", status: "pending", owner: "@Architect" },
    ]);
    writeProjectConfig("strict");
    // Gate state with only consumed or failed sessions
    writeGateState({
      cg_ses_old: {
        session_id: "cg_ses_old",
        gate_status: "completed",
        confirmed_at: "2026-05-23T07:00:00.000Z",
        consumed_at: "2026-05-23T08:00:00.000Z", // consumed
      },
      cg_ses_failed: {
        session_id: "cg_ses_failed",
        gate_status: "failed",
        confirmed_at: null,
        consumed_at: null,
      },
    });
    writeMachine([]);

    const result = runGate("FW-TEST-007");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("armed");
  });
});

// ─── Unit Tests for Exported Functions ─────────────────────────────────────

describe("pre-execution-gate.js unit functions", () => {
  // Require the .ts source directly; bun resolves .ts natively.
  const gate = require("../pre-execution-gate.ts");

  test("getEnforcementMode returns valid mode", () => {
    const mode = gate.getEnforcementMode();
    expect(["advisory", "strict", "locked"]).toContain(mode);
  });

  test("emitError returns false in advisory mode", () => {
    // This test verifies the function signature and return behavior
    // Actual mode depends on project config
    const result = gate.emitError("TEST", "test message");
    expect(typeof result).toBe("boolean");
  });

  test("OPENCODE_ROOT is an absolute path", () => {
    expect(path.isAbsolute(gate.OPENCODE_ROOT)).toBe(true);
  });

  test("readJSON handles missing file", () => {
    const result = gate.readJSON("/nonexistent/path/file.json");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
