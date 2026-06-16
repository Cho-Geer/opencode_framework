/**
 * hook-commit-msg.ts — Commit message validation hook
 * ====================================================
 *
 * Replaces the bash `.opencode/hooks/commit-msg` script.
 * Validates:
 *   - TDD phase ordering ([Red] → [Green] → [Refactor])
 *   - [INFRA] marker when critical files are modified
 *   - commitlint fallback for non-TDD commits
 *
 * @author @Super-Admin
 * @since 2026-06-15
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { getEnforcementMode, getProjectRoot } from '../../lib/gate-core';
import { getStagedCriticalFiles } from './hook-critical-files';

// ── Redirect all output to log file (sync writes for reliable flush before exit) ──
const logFile = '.task_temp/_logs/hook-commit-msg.log';
mkdirSync(dirname(logFile), { recursive: true });
function log(...args: any[]) {
  appendFileSync(logFile, `[${new Date().toISOString()}] ${args.join(' ')}\n`);
}
console.log = log;
console.error = (...args: any[]) => log('ERROR:', ...args);
console.warn = (...args: any[]) => log('WARN:', ...args);

const commitMsgFile = process.argv[2];
if (!commitMsgFile || !existsSync(commitMsgFile)) {
  console.log('⚠️  [commit-msg] no commit message file — skipping');
  process.exit(0);
}

const msg = readFileSync(commitMsgFile, 'utf8').trim();
const root = getProjectRoot();

const mode = getEnforcementMode(root);

// ── Skip merge commits ──
if (/^Merge /i.test(msg)) {
  console.log('✅ [commit-msg] Merge commit — skipping');
  process.exit(0);
}

// ── TDD Marker + Phase Ordering ──
const tddMatch = msg.match(/^\[(Red|Green|Refactor)\]\s+(\S+)/i);
const criticalModified = getStagedCriticalFiles();
const isInfraOnly =
  !tddMatch &&
  msg.includes('[INFRA]') &&
  criticalModified.length > 0;

if (tddMatch) {
  const phase = tddMatch[1].toLowerCase();
  const taskId = tddMatch[2];
  const prevCommits = (() => {
    try {
      return execSync(`git log --oneline --all --grep="${taskId}"`, {
        encoding: 'utf8',
        timeout: 5000,
      });
    } catch {
      return '';
    }
  })();

  if (phase === 'green') {
    const hasRed = prevCommits
      .split('\n')
      .some((l) => new RegExp(`\\[Red\\].*${taskId}`, 'i').test(l));
    if (!hasRed) {
      console.log(`❌ [TDD] [Green] for ${taskId} without preceding [Red]`);
      process.exit(1);
    }
  }
  if (phase === 'refactor') {
    const hasGreen = prevCommits
      .split('\n')
      .some((l) => new RegExp(`\\[Green\\].*${taskId}`, 'i').test(l));
    if (!hasGreen) {
      console.log(
        `❌ [TDD] [Refactor] for ${taskId} without preceding [Green]`,
      );
      process.exit(1);
    }
  }
  console.log(`✅ [TDD] Valid ${phase} commit for ${taskId}`);
} else if (isInfraOnly) {
  console.log(
    `✅ [INFRA] infrastructure-only commit (${criticalModified.length} critical file(s)) — TDD marker not required`,
  );
} else if (mode === 'strict' || mode === 'locked') {
  console.log('❌ [TDD] Commit message must contain [Red], [Green], or [Refactor]');
  process.exit(1);
} else {
  console.log('⚠️  [TDD] Advisory: No TDD marker found');
}

// ── [INFRA] Marker Check (critical files) ──
if (criticalModified.length > 0) {
  if (!msg.includes('[INFRA]')) {
    console.log('═══════════════════════════════════════════════════════');
    console.log(
      '[FW-ENFORCE][INFRA] Critical infrastructure files in this commit:',
    );
    criticalModified.forEach((f) => console.log(`  - ${f}`));
    console.log('\nCommit message must include [INFRA] marker.');
    console.log(
      'Example: git commit -m "[Green][INFRA] update agent permissions"',
    );
    console.log('═══════════════════════════════════════════════════════');
    if (mode !== 'advisory') {
      process.exit(1);
    }
  } else if (!isInfraOnly) {
    // Already acknowledged above when isInfraOnly; skip duplicate message when
    // [INFRA] is paired with a TDD marker (e.g. "[Green][INFRA] ...").
    console.log(
      `✅ [INFRA] ${criticalModified.length} critical file(s) — marker confirmed`,
    );
  }
}

// ── commitlint (fallback for non-TDD commits) ──
if (!tddMatch) {
  const commitlint = join(root, 'node_modules/.bin/commitlint');
  if (existsSync(commitlint)) {
    console.log('🔍 [commitlint] Validating...');
    try {
      execSync(`npx commitlint --edit "${commitMsgFile}"`, {
        encoding: 'utf8',
        stdio: 'inherit',
      });
    } catch {
      console.log('❌ Commit message rejected by commitlint.');
      process.exit(1);
    }
  }
}
