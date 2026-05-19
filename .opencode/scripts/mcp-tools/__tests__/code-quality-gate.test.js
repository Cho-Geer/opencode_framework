#!/usr/bin/env node
'use strict';

/**
 * UNIV-001 RED Phase: Test code-quality-gate.js getProjectRoot()
 * throws descriptive errors when project_root is undefined.
 *
 * UNIV-004 RED Phase: Test getBackendDir() and getFrontendDir()
 * return correct paths from project.config.json.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const OPENCODE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TEST_CONFIG_PATH = path.join(OPENCODE_ROOT, '.opencode', 'project.config.json');
const TARGET_SCRIPT = path.join(__dirname, '..', 'code-quality-gate.js');
const RUNNER_PATH = path.join(__dirname, '._runner_cqg.js');

// ─── Runner for direct module function calls ───
function writeRunner(methods) {
  const methodArrs = JSON.stringify(methods);
  const runnerCode = `
const m = require(${JSON.stringify(TARGET_SCRIPT)});
const methods = ${methodArrs};
const methodMap = { get: 'getProjectRoot' };
const method = process.argv[2];
if (!methods.includes(method)) {
  process.stderr.write('ERR: unknown method: ' + method);
  process.exit(2);
}
const fnName = methodMap[method] || method;
if (typeof m[fnName] !== 'function') {
  process.stderr.write('ERR: ' + fnName + ' not exported as function');
  process.exit(2);
}
try {
  const result = m[fnName]();
  process.stdout.write(result);
  process.exit(0);
} catch (e) {
  process.stderr.write(e.message);
  process.exit(1);
}
`;
  fs.writeFileSync(RUNNER_PATH, runnerCode.trimStart());
}

function runModuleMethod(method) {
  return execSync(`node "${RUNNER_PATH}" ${method}`, {
    cwd: OPENCODE_ROOT,
    timeout: 5000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function cleanupRunner() {
  try { fs.unlinkSync(RUNNER_PATH); } catch {}
}

function backupConfig() {
  if (fs.existsSync(TEST_CONFIG_PATH)) {
    const bak = TEST_CONFIG_PATH + '.bak';
    fs.copyFileSync(TEST_CONFIG_PATH, bak);
    return bak;
  }
  return null;
}
function restoreConfig(bak) {
  if (bak && fs.existsSync(bak)) {
    fs.copyFileSync(bak, TEST_CONFIG_PATH);
    fs.unlinkSync(bak);
  }
}
function writeConfig(data) {
  fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(data, null, 2));
}
function deleteConfig() {
  if (fs.existsSync(TEST_CONFIG_PATH)) fs.unlinkSync(TEST_CONFIG_PATH);
}

function runGetProjectRootTest() {
  return execSync(`node "${RUNNER_PATH}" get`, {
    cwd: OPENCODE_ROOT,
    timeout: 5000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

let backup = null;
let exitCode = 0;

try {
  writeRunner(['get', 'getBackendDir', 'getFrontendDir']);

  // ═══════════════════════════════════════════════════════════
  // UNIV-001 TESTS (existing, preserved)
  // ═══════════════════════════════════════════════════════════

  // ─── Test 1: Throw when project_root is missing ───
  backup = backupConfig();
  writeConfig({ project: { name: 'test' } });

  let threw = false;
  try {
    runGetProjectRootTest();
  } catch (e) {
    threw = true;
    const stderr = e.stderr || '';
    assert.ok(
      stderr.includes('project_root') || stderr.includes('project.config.json'),
      `Expected error about project_root, got: ${stderr}`
    );
  }
  assert.ok(threw, 'Expected getProjectRoot() to throw when project_root is missing');
  console.log('PASS: Test 1 — throws when project_root is missing');

  // ─── Test 2: Throw when config file is missing ───
  restoreConfig(backup);
  backup = backupConfig();
  deleteConfig();

  threw = false;
  try {
    runGetProjectRootTest();
  } catch (e) {
    threw = true;
    const stderr = e.stderr || '';
    assert.ok(
      stderr.includes('project.config.json') || stderr.includes('project_root'),
      `Expected error about missing config, got: ${stderr}`
    );
  }
  assert.ok(threw, 'Expected getProjectRoot() to throw when config file is missing');
  console.log('PASS: Test 2 — throws when config file is missing');

  // ─── Test 3: Returns correct path when project_root is defined ───
  restoreConfig(backup);
  backup = backupConfig();
  writeConfig({ project_root: 'custom_project', project: { name: 'test' } });

  const output = runGetProjectRootTest();
  assert.ok(output.trim().endsWith('custom_project'), `Expected path ending in custom_project, got: ${output.trim()}`);
  console.log('PASS: Test 3 — returns correct path when project_root is defined');

  // ═══════════════════════════════════════════════════════════
  // UNIV-004 TESTS (RED: will fail until getBackendDir/getFrontendDir are implemented)
  // ═══════════════════════════════════════════════════════════

  // ─── Test 4: getBackendDir() returns correct path when config has paths.backend_src ───
  restoreConfig(backup);
  backup = backupConfig();
  writeConfig({
    project_root: 'booking_system_refactor',
    project: { name: 'test' },
    paths: {
      backend_src: 'booking-backend/src/',
      frontend_src: 'booking-frontend/'
    }
  });

  let beDir = '';
  try {
    beDir = runModuleMethod('getBackendDir').trim();
  } catch (e) {
    threw = true;
    console.error(`getBackendDir threw: ${e.stderr || e.message}`);
    throw new Error('UNIV-004-RED: Test 4 — getBackendDir() should not throw with valid config, but it did');
  }
  assert.ok(
    beDir.endsWith('booking-backend'),
    `Expected getBackendDir() to end with 'booking-backend', got: ${beDir}`
  );
  console.log(`PASS: UNIV-004 Test 4 — getBackendDir() returns path ending in 'booking-backend': ${beDir}`);

  // ─── Test 5: getFrontendDir() returns correct path when config has paths.frontend_src ───
  let feDir = '';
  try {
    feDir = runModuleMethod('getFrontendDir').trim();
  } catch (e) {
    threw = true;
    console.error(`getFrontendDir threw: ${e.stderr || e.message}`);
    throw new Error('UNIV-004-RED: Test 5 — getFrontendDir() should not throw with valid config, but it did');
  }
  assert.ok(
    feDir.endsWith('booking-frontend'),
    `Expected getFrontendDir() to end with 'booking-frontend', got: ${feDir}`
  );
  console.log(`PASS: UNIV-004 Test 5 — getFrontendDir() returns path ending in 'booking-frontend': ${feDir}`);

  // ─── Test 6: getBackendDir() throws when paths config is missing ───
  restoreConfig(backup);
  backup = backupConfig();
  writeConfig({
    project_root: 'booking_system_refactor',
    project: { name: 'test' }
    // no paths
  });

  threw = false;
  try {
    runModuleMethod('getBackendDir');
  } catch (e) {
    threw = true;
    const stderr = e.stderr || '';
    assert.ok(
      stderr.includes('paths') || stderr.includes('backend_src'),
      `Expected error about missing paths config, got: ${stderr}`
    );
  }
  assert.ok(threw, 'Expected getBackendDir() to throw when paths config is missing');
  console.log('PASS: UNIV-004 Test 6 — getBackendDir() throws when paths config is missing');

  // ─── Test 7: getFrontendDir() throws when paths config is missing ───
  threw = false;
  try {
    runModuleMethod('getFrontendDir');
  } catch (e) {
    threw = true;
    const stderr = e.stderr || '';
    assert.ok(
      stderr.includes('paths') || stderr.includes('frontend_src'),
      `Expected error about missing paths config, got: ${stderr}`
    );
  }
  assert.ok(threw, 'Expected getFrontendDir() to throw when paths config is missing');
  console.log('PASS: UNIV-004 Test 7 — getFrontendDir() throws when paths config is missing');

  // ═══════════════════════════════════════════════════════════
  // ALL TESTS PASSED
  // ═══════════════════════════════════════════════════════════

  console.log('\n=== ALL TESTS PASSED (GREEN) ===');

} catch (err) {
  console.error(`\n=== TEST FAILED (RED) ===\n${err.message}`);
  exitCode = 1;
} finally {
  restoreConfig(backup);
  cleanupRunner();
  process.exit(exitCode);
}
