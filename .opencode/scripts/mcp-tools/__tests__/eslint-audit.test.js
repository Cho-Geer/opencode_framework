#!/usr/bin/env node
'use strict';

/**
 * UNIV-001 RED Phase: Test that eslint-audit.js getProjectRoot()
 * throws descriptive errors when project_root is undefined.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const OPENCODE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TEST_CONFIG_PATH = path.join(OPENCODE_ROOT, '.opencode', 'project.config.json');
const TARGET_SCRIPT = path.join(__dirname, '..', 'eslint-audit.js');

// Write a small runner script to a temp file (avoids inline escaping issues)
const RUNNER_PATH = path.join(__dirname, '._runner_eslint.js');

function writeRunner() {
  const runnerCode = `
const m = require(${JSON.stringify(TARGET_SCRIPT)});
if (typeof m.getProjectRoot !== 'function') {
  process.stderr.write('ERR: getProjectRoot not exported');
  process.exit(2);
}
const method = process.argv[2]; // 'test' or 'get'
if (method === 'get') {
  try {
    const result = m.getProjectRoot();
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

// ─── Helpers ───────────────────────────────────────────────
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

// ─── Tests ─────────────────────────────────────────────────
let backup = null;
let exitCode = 0;

try {
  writeRunner();

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

  console.log('\n=== ALL TESTS PASSED (GREEN) ===');

} catch (err) {
  console.error(`\n=== TEST FAILED (RED) ===\n${err.message}`);
  exitCode = 1;
} finally {
  restoreConfig(backup);
  cleanupRunner();
  process.exit(exitCode);
}
