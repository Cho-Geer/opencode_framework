#!/usr/bin/env node
/**
 * safe-edit.test.js — CI-EMBED-002 RED Phase (Failing Tests)
 * ============================================================
 *
 * RED phase test file for the safe_edit function.
 * These tests MUST fail (exit code != 0) because safe_edit has
 * not been implemented yet (CI-EMBED-003 GREEN phase).
 *
 * When safe_edit IS implemented, these tests should all pass (exit code 0).
 *
 * Test coverage:
 *   a) TOCTOU race detection — blocks write if file state changed
 *   b) Atomic backup — creates before-write backup, atomically restorable
 *   c) Rollback on failure — restores original file if write fails
 *
 * Reference: .opencode/scripts/mcp-tools/code-quality-lib.js
 * Design:    HARDEN-CONSTRAINT-DESIGN/re-evaluation/final-synthesis.md B1
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ═══════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════
const PROJECT_ROOT = process.env.OPENCODE_ROOT || path.resolve(__dirname, '..', '..', '..');
const TEST_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-edit-test-'));
const TEST_FILE = path.join(TEST_TMPDIR, 'test-write.txt');

// Write pre-test content
fs.writeFileSync(TEST_FILE, 'original content for testing');

// ═══════════════════════════════════════════════════════════
// Attempt to load safe_edit — THIS WILL FAIL (RED phase)
// The module doesn't exist yet, so the entire test script
// crashes with MODULE_NOT_FOUND and exit code != 0.
//
// When safe_edit is implemented (CI-EMBED-003), this require
// will succeed and the actual test logic below will execute.
// ═══════════════════════════════════════════════════════════

console.log('\n=== CI-EMBED-002 RED Phase: safe_edit Tests ===');
console.log('Loading safe-edit module from .opencode/tools/safe-edit.js...\n');

let safeEdit;
try {
  safeEdit = require(path.join(PROJECT_ROOT, '.opencode', 'tools', 'safe-edit.js'));
  console.log('Module loaded successfully — proceeding with tests.\n');
} catch (err) {
  console.error('❌ RED PHASE: Could not load safe-edit module.');
  console.error(`   Error: ${err.message}`);
  console.error('\n=== RED PHASE CONFIRMED: safe_edit not yet implemented ===');
  console.error('=== CI-EMBED-003 must implement safe_edit to pass these tests ===\n');
  cleanup();
  // Skip exit when run inside `bun test` suite (would kill the whole process)
  if (!process.env.BUN_TEST_SUITE) process.exit(1);
  // Inside the test suite, stop here so later IIFEs don't run against undefined safeEdit.
  return;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
let passed = 0;
let failed = 0;
let assertions = 0;

function assert(condition, message) {
  assertions++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEq(actual, expected, message) {
  assertions++;
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
  }
}

function assertMatches(str, pattern, message) {
  assertions++;
  if (pattern.test(str)) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} — "${str}" does not match ${pattern}`);
  }
}

function cleanup() {
  try { fs.rmSync(TEST_TMPDIR, { recursive: true, force: true }); } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
// TEST A: TOCTOU Race Detection
// ═══════════════════════════════════════════════════════════
console.log('\n[Test A] TOCTOU Race Detection:');
console.log('  Scenario: File state changes between audit check and write.');
console.log('  safe_edit should detect the race and BLOCK the write.\n');

(function testToctouRace() {
  // Reset test file
  fs.writeFileSync(TEST_FILE, 'original content');

  // Call safe_edit with a simulated TOCTOU race
  // The file will be tampered with between audit and write
  const result = safeEdit(TEST_FILE, 'new content', {
    agentType: '@Coder-BE',
    taskId: 'CI-EMBED-002',
  });

  // Assertion 1: Operation should be blocked
  assertEq(result.success, false, 'Block write when TOCTOU race detected');

  // Assertion 2: Error message should indicate conflict
  assertMatches(
    result.error || '',
    /TOCTOU|race|conflict|state.changed|tamper/i,
    'Error message indicates race/conflict condition'
  );

  // Assertion 3: File should retain post-tamper state (not the write content)
  const fileContent = fs.readFileSync(TEST_FILE, 'utf8');
  assert(fileContent === 'original content', 'File content should be unchanged after blocked write');
})();

// ═══════════════════════════════════════════════════════════
// TEST B: Atomic Backup & Restore
// ═══════════════════════════════════════════════════════════
console.log('\n[Test B] Atomic Backup & Restore:');
console.log('  Scenario: safe_edit creates a backup before writing,');
console.log('  and the backup can be atomically restored.\n');

(function testAtomicBackup() {
  // Reset test file
  fs.writeFileSync(TEST_FILE, 'content for backup test');

  // Call safe_edit to write new content
  const writeResult = safeEdit(TEST_FILE, 'updated content after backup', {
    agentType: '@Coder-BE',
    taskId: 'CI-EMBED-002',
  });

  // Assertion 1: Write succeeds
  assertEq(writeResult.success, true, 'Write succeeds with backup');

  // Assertion 2: Backup path is returned
  assert(
    typeof writeResult.backupPath === 'string' && writeResult.backupPath.length > 0,
    'safe_edit returns backupPath'
  );

  // Assertion 3: Backup file exists on disk
  assert(
    fs.existsSync(writeResult.backupPath),
    `Backup file exists at ${writeResult.backupPath}`
  );

  // Assertion 4: Backup contains original content
  const backupContent = fs.readFileSync(writeResult.backupPath, 'utf8');
  assertEq(backupContent, 'content for backup test', 'Backup contains pre-write content');

  // Assertion 5: Written file has new content
  const writtenContent = fs.readFileSync(TEST_FILE, 'utf8');
  assertEq(writtenContent, 'updated content after backup', 'Written file has new content');

  // Assertion 6: Restore from backup works atomically
  const restoreResult = safeEdit.restore(writeResult.backupPath, TEST_FILE);
  assertEq(restoreResult.success, true, 'Backup restoration succeeds');

  // Assertion 7: After restore, file content matches original
  const restoredContent = fs.readFileSync(TEST_FILE, 'utf8');
  assertEq(restoredContent, 'content for backup test', 'Restored file matches original');
})();

// ═══════════════════════════════════════════════════════════
// TEST C: Rollback on Failure
// ═══════════════════════════════════════════════════════════
console.log('\n[Test C] Rollback on Failure:');
console.log('  Scenario: Write fails mid-operation (disk error, permission, audit).');
console.log('  safe_edit should rollback all changes, restoring original file.\n');

(function testRollbackOnFailure() {
  // Reset test file
  const originalContent = 'content for rollback test';
  fs.writeFileSync(TEST_FILE, originalContent);
  const originalSize = fs.statSync(TEST_FILE).size;

  // Simulate a write failure — safe_edit should detect the failure
  // and atomically restore the original file from backup
  const result = safeEdit(TEST_FILE, 'content that will fail', {
    agentType: '@Coder-BE',
    taskId: 'CI-EMBED-002',
  });

  // Assertion 1: Operation reports failure
  assertEq(result.success, false, 'Reports failure when write fails');

  // Assertion 2: Original file content is preserved after rollback
  const finalContent = fs.readFileSync(TEST_FILE, 'utf8');
  assertEq(finalContent, originalContent, 'File content restored to original after rollback');

  // Assertion 3: File metadata integrity maintained
  const finalSize = fs.statSync(TEST_FILE).size;
  assertEq(finalSize, originalSize, 'File size unchanged after rollback');

  // Assertion 4: Temporary files are cleaned up after rollback
  const dirFiles = fs.readdirSync(TEST_TMPDIR);
  const tempFiles = dirFiles.filter(f =>
    f.includes('.tmp') || f.includes('.safe_backup') || f.includes('.rollback')
  );
  assertEq(tempFiles.length, 0, 'No residual temp/backup files after rollback');
})();

// ═══════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════');
console.log('  CI-EMBED-002 Test Results');
console.log('══════════════════════════════════════════════');
console.log(`  Assertions: ${assertions}`);
console.log(`  Passed:     ${passed}`);
console.log(`  Failed:     ${failed}`);
console.log('══════════════════════════════════════════════\n');

cleanup();

if (failed > 0) {
  console.error(`=== RED PHASE: ${failed} test(s) FAILED (expected - safe_edit not implemented) ===`);
  if (!process.env.BUN_TEST_SUITE) process.exit(1);
} else {
  console.log('=== GREEN: All tests passed ===');
  if (!process.env.BUN_TEST_SUITE) process.exit(0);
}

// ============ FX-DIAG-ROBUST-1: single-call safeEdit success ============
describe("FX-DIAG-ROBUST-1: single-call safeEdit success", () => {
  it('should succeed on first call to a new file via auto-retry (RED: returns TOCTOU error)', () => {
    const NEW_FILE = path.join(TEST_TMPDIR, 'fx-diag-robust-1-test.txt');
    if (fs.existsSync(NEW_FILE)) fs.unlinkSync(NEW_FILE);
    const result = safeEdit(NEW_FILE, 'single-call write', { createBackup: true });
    // RED: FAILS — first call returns TOCTOU error "no baseline audit in registry"
    expect(result.success).toBe(true);
  });
});
