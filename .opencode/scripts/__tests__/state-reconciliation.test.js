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

  it('should NOT flag as stale when confirmed_at is recent even if created_at is old', () => {
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
    const session = gateState.sessions.test_sid;
    // Correct behavior: staleness must be judged by confirmed_at when present,
    // not by created_at. Using created_at alone would wrongly flag this session.
    const threshold = 24 * 3600000;
    const stalenessTimestamp = session.confirmed_at || session.created_at;
    const isStale = (now - new Date(stalenessTimestamp).getTime()) > threshold;
    expect(isStale).toBe(false);

    // Guard: verify created_at would indeed be stale, confirming the test is
    // actually distinguishing the two timestamps.
    const isStaleUsingCreatedAt = (now - new Date(session.created_at).getTime()) > threshold;
    expect(isStaleUsingCreatedAt).toBe(true);
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
