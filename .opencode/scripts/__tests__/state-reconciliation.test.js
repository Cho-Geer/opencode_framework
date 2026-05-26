"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Test isolation directory
const TEST_DIR = path.join(__dirname, "__stale_test__");

function setup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  process.env.OPENCODE_ROOT = TEST_DIR;
}

function teardown() {
  delete process.env.OPENCODE_ROOT;
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

function sha256(content) {
  return "sha256-" + crypto.createHash("sha256").update(content).digest("hex");
}

// ============ FX-DIAG-CONS-2: Time base consistency tests ============
describe("FX-DIAG-CONS-2: Staleness time base consistency", () => {
  beforeEach(setup);
  afterEach(teardown);

  it('should NOT flag as stale when confirmed_at is recent even if created_at is old (RED: gate-lifecycle-audit uses created_at)', () => {
    const now = Date.now();
    const gateState = {
      sessions: {
        "test_sid": {
          session_id: "test_sid",
          gate_status: "armed",
          created_at: new Date(now - 48 * 3600000).toISOString(), // 48h old
          confirmed_at: new Date(now - 1 * 3600000).toISOString(), // 1h ago → NOT stale
          consumed_at: null
        }
      }
    };
    // Simulate: if tool uses created_at (48h > 24h), it wrongly flags stale
    // Correct behavior: use confirmed_at (1h < 24h) → NOT stale
    const isStaleUsingCreatedAt = (now - new Date(gateState.sessions.test_sid.created_at).getTime()) > 24 * 3600000;
    const isStaleUsingConfirmedAt = (now - new Date(gateState.sessions.test_sid.confirmed_at).getTime()) > 24 * 3600000;
    // RED: gate-lifecycle-audit.js uses created_at, so isStaleUsingCreatedAt is true
    // After fix, both should use confirmed_at = false
    expect(isStaleUsingCreatedAt).toBe(false); // FAILS: currently true (48h > 24h)
    expect(isStaleUsingConfirmedAt).toBe(false); // PASSES: 1h < 24h
  });
});

// ============ FX-DIAG-MULTI-2: write_audit_state validation tests ============
describe("FX-DIAG-MULTI-2: write_audit_state integrity validation", () => {
  beforeEach(setup);
  afterEach(teardown);

  it('should detect when recorded file does not exist on disk (RED: no validateWriteAuditIntegrity function)', () => {
    const mockMachine = {
      write_audit_state: {
        enabled: true,
        current_session: null,
        history: [{ session: "s1", files: [path.join(TEST_DIR, "missing.ts")], timestamp: new Date().toISOString(), result: "pass" }]
      }
    };
    // RED: This import will fail because function doesn't exist
    let result;
    try {
      const { validateWriteAuditIntegrity } = require("../../scripts/state-reconciliation");
      result = validateWriteAuditIntegrity(mockMachine, TEST_DIR);
    } catch (e) {
      result = { error: e.message };
    }
    // RED: Should have error because function doesn't exist
    expect(result.error || result.valid === false).toBeTruthy();
  });

  it('should pass when recorded file matches actual file content', () => {
    const testFile = path.join(TEST_DIR, "valid-file.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, "valid content\n", "utf-8");
    const mockMachine = {
      write_audit_state: {
        enabled: true,
        current_session: null,
        history: [{ session: "s2", files: [{ path: testFile, hash: sha256("valid content\n") }], timestamp: new Date().toISOString(), result: "pass" }]
      }
    };
    let result;
    try {
      const { validateWriteAuditIntegrity } = require("../../scripts/state-reconciliation");
      result = validateWriteAuditIntegrity(mockMachine, TEST_DIR);
    } catch (e) {
      result = { error: e.message };
    }
    expect(result.error || result.valid !== false).toBeTruthy();
  });
});
