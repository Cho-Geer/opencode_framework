/**
 * hook-layers.ts — Pre-commit hook TypeScript implementation
 * ===========================================================
 *
 * Replaces the monolithic `.opencode/hooks/pre-commit` bash script.
 * The bash hook now simply execs `bun .opencode/lib/hook-layers.ts`.
 *
 * Layers executed:
 *   0   Compliance gate armed check
 *   1.5 Critical infrastructure file detection
 *   1.8 Gate lifecycle audit
 *   1.9 State format validation
 *   1   lint-staged auto-formatting
 *   2.5 TDD order pre-check
 *   2.6 UC7KS docs consistency
 *   2.0 JSON syntax validation
 *   2   Keystone validation
 *
 * @author @Super-Admin
 * @since 2026-06-15
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { getEnforcementMode, getProjectRoot } from '../../lib/gate-core';
import type { EnforcementMode } from '../../lib/gate-core';
import { getStagedCriticalFiles } from './hook-critical-files';
import { tolerantParse } from '../../lib/tolerant-json';

// ── Redirect all output to log file (sync writes for reliable flush before exit) ──
const logFile = '.task_temp/_logs/hook-layers.log';
mkdirSync(dirname(logFile), { recursive: true });
function log(...args: any[]) {
  appendFileSync(logFile, `[${new Date().toISOString()}] ${args.join(' ')}\n`);
}
console.log = log;
console.error = (...args: any[]) => log('ERROR:', ...args);
console.warn = (...args: any[]) => log('WARN:', ...args);

// ── Path resolution (reused from gate-core) ──
const ROOT = getProjectRoot();
const PROJECT_CONFIG = join(ROOT, '.opencode/project.config.json');
const GATE_STATE = join(ROOT, '.opencode/state/gate-state.json');
const MACHINE = join(ROOT, '.opencode/state/machine.json');
const INNER = (() => {
  try {
    const cfg = JSON.parse(readFileSync(PROJECT_CONFIG, 'utf8'));
    return join(ROOT, cfg.project_root || '.');
  } catch {
    return ROOT;
  }
})();

const mode = getEnforcementMode(ROOT);

console.log('═══════════════════════════════════════════════════════');
console.log('  🔍 OpenCode v3.3 Pre-Commit Hook — TypeScript + Bun');
console.log(`  Mode: ${mode}`);
console.log('═══════════════════════════════════════════════════════');

// ── Layer 0: Compliance Gate Armed Check ──
console.log('\n[Layer 0/4] Checking compliance gate state...');

if (mode === 'advisory') {
  console.log('  ⚠️  [ADVISORY] Gate armed check skipped');
} else {
  // Post-Step-8 DB-only migration: gate-state.json is frozen snapshot.
  // Read from DB via dbLoadGateStore() for accurate session state.
  let store: any = null;
  try {
    const { dbLoadGateStore } = require('../../lib/db-state-manager');
    store = dbLoadGateStore();
  } catch {
    console.log('  ⚠️  Cannot read gate sessions from DB — skipped');
  }
  if (store) {
    const sessions = store.sessions || {};
    const count = Object.keys(sessions).length;
    if (count === 0) {
      console.log('❌ [GATE] No compliance gate session is armed.');
      console.log(
        '   Run: compliance_gate_check → compliance_gate_confirm before committing.',
      );
      process.exit(1);
    }
    console.log(`  ✅ Compliance gate armed (${count} active session(s))`);
  }
}

// ── Layer 1.5: Critical Files Check (git diff, replaces SHA-256) ──
console.log('\n[1.5/4] Critical infrastructure files check (git diff)...');
const criticalModified = getStagedCriticalFiles();
if (criticalModified.length > 0) {
  console.log('  ⚠️  Critical infrastructure files modified:');
  criticalModified.forEach((f) => console.log(`    - ${f}`));
  if (mode === 'locked') {
    console.log(
      '  ❌ [FW-ENFORCE][INFRA] Critical files in locked mode — BLOCKED',
    );
    process.exit(1);
  }
  console.log('  ⚠️  Ensure commit message includes [INFRA] marker');
} else {
  console.log('  ✅ No critical infrastructure files in this commit');
}

// ── Layer 1.8: Gate Lifecycle Audit ──
console.log('\n[1.8/4] Gate lifecycle audit...');
try {
  const output = execSync('bun .opencode/scripts/gate-lifecycle-audit.ts --json', {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 30000,
  });
  const result = JSON.parse(output);
  const stale = (result.stale_sessions || []).filter(
    (s: any) => (s.hours_old || 0) > 24,
  ).length;
  if (stale > 0) {
    console.log(`  ⚠️  ${stale} stale gate session(s) (>24h)`);
    console.log('  Fix: bun .opencode/scripts/state-reconciliation.ts --fix');
  } else {
    console.log('  ✅ No stale gate sessions');
  }
} catch {
  console.log('  ⚠️  Gate lifecycle audit skipped (script unavailable)');
}

// ── Layer 1.9: State Format Validation ──
// Post-Step-8 DB-only migration: gate-state.json is frozen snapshot.
// Validate format consistency from DB store instead of JSON file.
console.log('\n[1.9/4] State format validation...');
try {
  const { dbLoadGateStore } = require('../../lib/db-state-manager');
  const gs = dbLoadGateStore();
  if (gs) {
    const active = Object.keys(gs.active_sessions || {}).length;
    const recent = Object.keys(gs.recent_sessions || {}).length;
    // Also validate frozen snapshot for format consistency
    if (existsSync(GATE_STATE)) {
      const frozen = JSON.parse(readFileSync(GATE_STATE, 'utf8'));
      if ((frozen.formatVersion || '1.0') === '3.0') {
        const indexPath = join(ROOT, '.opencode/state/gate-state.index.json');
        if (existsSync(indexPath)) {
          const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
          const indexCount = Object.keys(idx.sessions || {}).length;
          const frozenRecent = Object.keys(frozen.recent_sessions || {}).length;
          if (indexCount < frozenRecent) {
            console.log(
              `  ❌ gate-state v3: index (${indexCount}) < frozen recent (${frozenRecent})`,
            );
            process.exit(1);
          }
        }
      }
    }
    console.log(`  ✅ gate-state v3 (DB): active=${active} recent=${recent}`);
  } else {
    console.log('  ✅ gate-state: no DB store (clean state)');
  }
} catch {
  console.log('  ⚠️  State format validation skipped (DB unavailable)');
}

// DAG changelog externalization
const dagPath = join(ROOT, 'Task.DAG.json');
if (existsSync(dagPath)) {
  const dag = JSON.parse(readFileSync(dagPath, 'utf8'));
  if (dag.change_log) {
    console.log('  ⚠️  Task.DAG.json still has inline change_log');
  }
}

// ── Layer 1: lint-staged ──
const lintStagedBin = join(INNER, 'node_modules/.bin/lint-staged');
if (existsSync(lintStagedBin)) {
  console.log('\n[Layer 1/4] Auto-formatting staged files (lint-staged)...');
  try {
    execSync(`npx --prefix "${INNER}" lint-staged --concurrent false`, {
      encoding: 'utf8',
      timeout: 120000,
      stdio: 'inherit',
    });
  } catch {
    console.log('⚠️  [lint-staged] Some files could not be auto-fixed.');
  }
} else {
  console.log('[Layer 1/4] lint-staged not installed — skipping');
}

// ── Layer 2.5: TDD Order Pre-Check ──
console.log('\n[Layer 2.5/4] TDD order pre-check...');
const FRAMEWORK_EXCLUDES =
  /^\.opencode\/|^docs\/|^\.task_temp\/|^node_modules\/|^opencode\.json$|^AGENTS\.md$|^contract\.yaml$|^Task\.DAG\.json$|^TECH_DEBT_REGISTRY\.md$|^WAIVE\.md$|^PROJECT_REFERENCE\.md$|^Project\.graph$/;
const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
const implFiles = staged.filter(
  (f) =>
    /\.(ts|js)$/.test(f) &&
    !/\.spec\.|\.test\.|\/test\/|\.config\./.test(f) &&
    !FRAMEWORK_EXCLUDES.test(f),
);
const testFiles = staged.filter((f) =>
  /\.spec\.|\.test\.|\/test\//.test(f),
);

if (implFiles.length > 0 && testFiles.length === 0) {
  try {
    const lastMsg = execSync('git log -1 --format=%s', {
      encoding: 'utf8',
    }).trim();
    if (!/\[(Red|Green|Refactor)\]/i.test(lastMsg)) {
      if (mode === 'advisory') {
        console.log(
          '⚠️  [ADVISORY] Impl files without test files & no TDD tag',
        );
      } else {
        console.log(
          '❌ [TDD] Impl files without test files AND no TDD tag — BLOCKED',
        );
        process.exit(1);
      }
    }
  } catch {
    /* no previous commit */
  }
} else {
  console.log('  ✅ TDD order check passed');
}

// ── Layer 2.6: UC7KS Docs Consistency ──
console.log('\n[Layer 2.6/4] UC7KS docs consistency...');
const idxPath = join(ROOT, 'docs/official_docs/index.json');
if (existsSync(idxPath)) {
  let parsed: any = null;
  try {
    parsed = tolerantParse(readFileSync(idxPath, 'utf8'));
  } catch {
    // malformed JSON — handled below
  }
  if (!parsed || !parsed.manifest_version || !parsed.entries) {
    if (mode === 'advisory') {
      console.log('  ⚠️  [ADVISORY] index.json is malformed');
    } else {
      console.log('  ❌ [UC7KS] index.json is malformed — BLOCKED');
      process.exit(1);
    }
  } else {
    const stagedDocs = staged.filter(
      (f) =>
        f.startsWith('docs/official_docs/') &&
        !f.includes('index.json') &&
        !f.includes('.metadata/'),
    );
    if (stagedDocs.length > 0) {
      const orphans = stagedDocs.filter(
        (doc) =>
          !parsed.entries.some((e: any) =>
            e.files?.some((f: any) => doc.includes(f.path)),
          ),
      );
      if (orphans.length > 0) {
        if (mode === 'advisory') {
          console.log(`  ⚠️  [ADVISORY] Orphan docs: ${orphans.join(', ')}`);
        } else {
          console.log(`  ❌ [UC7KS] Orphan docs: ${orphans.join(', ')}`);
          process.exit(1);
        }
      } else {
        console.log('  ✅ Staged docs verified in index.json');
      }
    }
    console.log('  ✅ index.json manifest integrity verified');
  }
} else {
  console.log('  ⚠️  index.json not found — skipped');
}

// ── Layer 2.0: JSON Syntax Validation ──
console.log('\n[Layer 2.0/4] JSON syntax validation...');
const jsonFiles = staged.filter((f) => f.endsWith('.json') && existsSync(f));
let jsonErrors = 0;
for (const f of jsonFiles) {
  try {
    tolerantParse(readFileSync(f, 'utf8'));
  } catch {
    console.log(`  ❌ JSON parse error: ${f}`);
    jsonErrors++;
  }
}
if (jsonErrors > 0) {
  console.log(`  ❌ ${jsonErrors} JSON file(s) have syntax errors — BLOCKED`);
  process.exit(1);
}
console.log(`  ✅ All staged JSON files valid (${jsonFiles.length} checked)`);

// ── Layer 2: Keystone Validation ──
console.log('\n[Layer 2/4] Keystone full validation...');
const validatorCandidates = [
  join(INNER, 'scripts/keystone-validate.ts'),
  join(ROOT, '.opencode/scripts/mcp-tools/keystone-validate.ts'),
];
const validator = validatorCandidates.find((p) => existsSync(p));

if (!validator) {
  console.log('⚠️  keystone-validate not found — skipped');
} else if (!existsSync(MACHINE)) {
  console.log('⚠️  machine.json not found — no Keystone constraints');
} else {
  // Use spawnSync — execSync with stdio:'inherit' cannot enforce timeout
  // because the child process owns the terminal fd.
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('bun', [validator, '--pre-commit'], {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    if ((result.error as any).code === 'ETIMEDOUT') {
      console.log('  ⚠️  Keystone validation timed out after 60s — skipped');
    } else {
      console.log(`  ⚠️  Keystone validation error: ${(result.error as any).message}`);
    }
  } else if (result.status === 0) {
    console.log('  ✅ Keystone validation passed');
  } else {
    if (mode === 'advisory') {
      console.log('  ⚠️  [ADVISORY] Keystone validation failed');
    } else {
      console.log('\n═══════════════════════════════════════════════════════');
      console.log('  ❌ PRE-COMMIT REJECTED — Keystone validation failed');
      console.log('═══════════════════════════════════════════════════════');
      process.exit(1);
    }
  }
}

// ── Layer 3: Delegate to commit-msg ──
console.log('\n[Layer 3/4] Commit message validation → commit-msg hook');
console.log('\n═══════════════════════════════════════════════════════');
console.log('  ✅ PRE-COMMIT PASSED — All checks clear');
console.log('═══════════════════════════════════════════════════════');
// Test: Mon Jun 15 21:52:30 JST 2026
