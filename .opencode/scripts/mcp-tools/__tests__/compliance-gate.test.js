#!/usr/bin/env node
'use strict';

/**
 * CI-UNIFY-003 Test Suite: compliance_gate_complete HANDOVER/TASK_LOG validation.
 *
 * Tests that runGateComplete validates HANDOVER.md and TASK_LOG.md existence
 * under .task_temp/{taskId}/ before allowing completion.
 *
 * TDD: RED phase -- tests should FAIL because implementation is not yet added.
 * TDD: GREEN phase -- tests should PASS after compliance-gate.js is modified.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const OPENCODE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TARGET_SCRIPT = path.join(__dirname, '..', 'compliance-gate.js');
const RUNNER_PATH = path.join(__dirname, '._runner_cg_unify003.js');

// ---- Runner for calling runGateComplete with various artifact scenarios ----
function writeRunner() {
  const runnerCode = [
    '#!/usr/bin/env node',
    "'use strict';",
    'const path = require("path");',
    'const fs = require("fs");',
    'const os = require("os");',
    'const OPENCODE_ROOT = process.env.OPENCODE_ROOT || ".";',
    'const TARGET = path.join(__dirname, "..", "compliance-gate.js");',
    '',
    'const scenario = process.argv[2] || "all-present";',
    'const taskId = "CI-UNIFY-003-TEST";',
    '',
    'const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-test-"));',
    'process.env.GATE_STATE_PATH = path.join(tmpDir, "gate-state.json");',
    '',
    'const m = require(TARGET);',
    '',
    'const checkResult = m.runGateCheck("CI-UNIFY-003 test task");',
    'if (!checkResult.session_id) { process.stderr.write("FAIL: no session_id"); process.exit(99); }',
    'const sessionId = checkResult.session_id;',
    '',
    'let confirmResult;',
    'if (scenario === "no-taskid") {',
    '  confirmResult = m.runGateConfirm(sessionId, "test plan summary CI-UNIFY-003", "test-agent");',
    '} else {',
    '  confirmResult = m.runGateConfirm(sessionId, "test plan summary CI-UNIFY-003", "test-agent", taskId);',
    '}',
    'if (confirmResult.status !== "armed") {',
    '  process.stderr.write("FAIL: confirm failed: " + JSON.stringify(confirmResult));',
    '  process.exit(99);',
    '}',
    '',
    'const useTaskId = (scenario === "no-taskid") ? "NO-TASK-ID" : taskId;',
    'const taskTempDir = path.join(OPENCODE_ROOT, ".task_temp", useTaskId);',
    'fs.mkdirSync(taskTempDir, { recursive: true });',
    '',
    'function wf(p, c) { fs.writeFileSync(p, c); }',
    'function rf(p) { try { fs.unlinkSync(p); } catch(e) {} }',
    '',
    'if (scenario === "all-present") {',
    '  wf(path.join(taskTempDir, "HANDOVER.md"), "# HANDOVER\\n");',
    '  wf(path.join(taskTempDir, "TASK_LOG.md"), "# TASK_LOG\\n");',
    '} else if (scenario === "missing-handover") {',
    '  rf(path.join(taskTempDir, "HANDOVER.md"));',
    '  wf(path.join(taskTempDir, "TASK_LOG.md"), "# TASK_LOG\\n");',
    '} else if (scenario === "missing-tasklog") {',
    '  wf(path.join(taskTempDir, "HANDOVER.md"), "# HANDOVER\\n");',
    '  rf(path.join(taskTempDir, "TASK_LOG.md"));',
    '} else if (scenario === "both-missing") {',
    '  rf(path.join(taskTempDir, "HANDOVER.md"));',
    '  rf(path.join(taskTempDir, "TASK_LOG.md"));',
    '} else if (scenario === "no-taskid") {',
    '  wf(path.join(taskTempDir, "HANDOVER.md"), "# HANDOVER\\n");',
    '  wf(path.join(taskTempDir, "TASK_LOG.md"), "# TASK_LOG\\n");',
    '}',
    '',
    'const result = m.runGateComplete(sessionId, "test execution summary CI-UNIFY-003");',
    '',
    'try { fs.rmSync(tmpDir, { recursive: true }); } catch(e) {}',
    'try { fs.rmSync(taskTempDir, { recursive: true }); } catch(e) {}',
    '',
    'process.stdout.write(JSON.stringify(result));',
    'process.exit(result.status === "completed" ? 0 : 1);',
  ].join('\n');
  fs.writeFileSync(RUNNER_PATH, runnerCode);
  fs.chmodSync(RUNNER_PATH, 0o755);
}

function runScenario(scenario) {
  return execSync('node "' + RUNNER_PATH + '" ' + scenario, {
    cwd: OPENCODE_ROOT,
    timeout: 15000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function cleanupRunner() {
  try { fs.unlinkSync(RUNNER_PATH); } catch(e) {}
}

// ---- Run Tests ----
let exitCode = 0;

try {
  writeRunner();

  // ============================================================
  // Test 1: All artifacts present -- should pass
  // ============================================================
  const output1 = runScenario('all-present');
  const result1 = JSON.parse(output1);
  assert.strictEqual(result1.status, 'completed',
    'Expected completed, got: ' + result1.status + '. Output: ' + output1);
  console.log('PASS: Test 1 -- all artifacts present returns completed');

  // ============================================================
  // Test 2: Missing HANDOVER.md -- should fail
  // ============================================================
  let result2;
  let threw2 = false;
  try {
    const output2 = runScenario('missing-handover');
    result2 = JSON.parse(output2);
  } catch (e) {
    threw2 = true;
    try { result2 = JSON.parse(e.stdout); } catch(e2) { result2 = { status: 'unknown' }; }
  }
  assert.ok(
    threw2 || result2.status === 'failed',
    'Expected failure for missing HANDOVER.md, got: ' + JSON.stringify(result2)
  );
  if (result2.missing_artifacts) {
    assert.ok(
      result2.missing_artifacts.indexOf('HANDOVER.md') !== -1,
      'Expected HANDOVER.md in missing_artifacts, got: ' + JSON.stringify(result2.missing_artifacts)
    );
  }
  console.log('PASS: Test 2 -- missing HANDOVER.md fails');

  // ============================================================
  // Test 3: Missing TASK_LOG.md -- should fail
  // ============================================================
  let result3;
  let threw3 = false;
  try {
    const output3 = runScenario('missing-tasklog');
    result3 = JSON.parse(output3);
  } catch (e) {
    threw3 = true;
    try { result3 = JSON.parse(e.stdout); } catch(e2) { result3 = { status: 'unknown' }; }
  }
  assert.ok(
    threw3 || result3.status === 'failed',
    'Expected failure for missing TASK_LOG.md, got: ' + JSON.stringify(result3)
  );
  if (result3.missing_artifacts) {
    assert.ok(
      result3.missing_artifacts.indexOf('TASK_LOG.md') !== -1,
      'Expected TASK_LOG.md in missing_artifacts, got: ' + JSON.stringify(result3.missing_artifacts)
    );
  }
  console.log('PASS: Test 3 -- missing TASK_LOG.md fails');

  // ============================================================
  // Test 4: Both missing -- should fail with both listed
  // ============================================================
  let result4;
  let threw4 = false;
  try {
    const output4 = runScenario('both-missing');
    result4 = JSON.parse(output4);
  } catch (e) {
    threw4 = true;
    try { result4 = JSON.parse(e.stdout); } catch(e2) { result4 = { status: 'unknown' }; }
  }
  assert.ok(
    threw4 || result4.status === 'failed',
    'Expected failure for both missing, got: ' + JSON.stringify(result4)
  );
  if (result4.missing_artifacts) {
    assert.strictEqual(
      result4.missing_artifacts.length, 2,
      'Expected 2 missing artifacts, got: ' + JSON.stringify(result4.missing_artifacts)
    );
    assert.ok(result4.missing_artifacts.indexOf('HANDOVER.md') !== -1);
    assert.ok(result4.missing_artifacts.indexOf('TASK_LOG.md') !== -1);
  }
  console.log('PASS: Test 4 -- both missing reports both artifacts');

  // ============================================================
  // Test 5: Unknown taskId -- skip validation, should pass
  // ============================================================
  const output5 = runScenario('no-taskid');
  const result5 = JSON.parse(output5);
  assert.strictEqual(result5.status, 'completed',
    'Expected completed for unknown taskId, got: ' + result5.status + '. Output: ' + output5);
  console.log('PASS: Test 5 -- unknown taskId skips validation');

  // ============================================================
  // ALL TESTS PASSED
  // ============================================================
  console.log('\n=== ALL TESTS PASSED (GREEN) ===');

} catch (err) {
  console.error('\n=== TEST FAILED (RED) ===\n' + err.message);
  exitCode = 1;
} finally {
  cleanupRunner();
  process.exit(exitCode);
}
