#!/usr/bin/env node
'use strict';

/**
 * UNIV-001 RED Phase: Test keystone-validate.js throws errors
 * when project_root is undefined.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const OPENCODE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TEST_CONFIG_PATH = path.join(OPENCODE_ROOT, '.opencode', 'project.config.json');
const TARGET_SCRIPT = path.join(__dirname, '..', 'keystone-validate.js');
const RUNNER_PATH = path.join(__dirname, '._runner_keystone.js');

function writeRunner() {
  const runnerCode = `
const m = require(${JSON.stringify(TARGET_SCRIPT)});
const method = process.argv[2];
if (method === 'readProjectConfig') {
  if (typeof m.readProjectConfig !== 'function') {
    process.stderr.write('ERR: readProjectConfig not exported'); process.exit(2);
  }
  try {
    const result = m.readProjectConfig();
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  } catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
  }
} else if (method === 'findStateDir') {
  if (typeof m.findStateDir !== 'function') {
    process.stderr.write('ERR: findStateDir not exported'); process.exit(2);
  }
  try {
    const result = m.findStateDir();
    process.stdout.write(result);
    process.exit(0);
  } catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
  }
} else {
  process.stderr.write('Unknown method: ' + method);
  process.exit(3);
}
`;
  fs.writeFileSync(RUNNER_PATH, runnerCode.trimStart());
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

function runModuleTest(method) {
  return execSync(`node "${RUNNER_PATH}" ${method}`, {
    cwd: OPENCODE_ROOT,
    timeout: 5000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

let backup = null;
let exitCode = 0;

try {
  writeRunner();

  // ─── Test 1: readProjectConfig throws when config file is missing ───
  backup = backupConfig();
  deleteConfig();

  let threw = false;
  try {
    runModuleTest('readProjectConfig');
  } catch (e) {
    threw = true;
    const stderr = e.stderr || '';
    assert.ok(
      stderr.includes('project.config.json') || stderr.includes('read') || stderr.includes('config'),
      `Expected error about config file, got: ${stderr}`
    );
  }
  assert.ok(threw, 'Expected readProjectConfig() to throw when config file is missing');
  console.log('PASS: Test 1 — readProjectConfig throws when config file is missing');

  // ─── Test 2: findStateDir throws when project_root is missing ───
  restoreConfig(backup);
  backup = backupConfig();
  writeConfig({ project: { name: 'test' } });

  threw = false;
  try {
    runModuleTest('findStateDir');
  } catch (e) {
    threw = true;
    const stderr = e.stderr || '';
    assert.ok(
      stderr.includes('project_root'),
      `Expected error about project_root, got: ${stderr}`
    );
  }
  assert.ok(threw, 'Expected findStateDir() to throw when project_root is missing');
  console.log('PASS: Test 2 — findStateDir throws when project_root is missing');

  // ─── Test 3: findStateDir works when project_root is defined ───
  restoreConfig(backup);
  backup = backupConfig();
  writeConfig({ project_root: 'booking_system_refactor', project: { name: 'test' } });

  const output = runModuleTest('findStateDir');
  assert.ok(output.includes('.opencode'), `Expected path containing .opencode, got: ${output}`);
  console.log('PASS: Test 3 — findStateDir returns correct path');

  console.log('\n=== ALL TESTS PASSED (GREEN) ===');

} catch (err) {
  console.error(`\n=== TEST FAILED (RED) ===\n${err.message}`);
  exitCode = 1;
} finally {
  restoreConfig(backup);
  cleanupRunner();
  process.exit(exitCode);
}
