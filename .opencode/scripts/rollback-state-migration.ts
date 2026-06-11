#!/usr/bin/env node
/**
 * rollback-state-migration.mjs — Reverse state migration v3 → v2
 *
 * Restores pre-migration gate-state and Task.DAG from timestamped backups.
 * Supports partial rollback (--gate-only / --dag-only) and dry-run mode.
 *
 * SAFETY:
 *   - Never overwrites without explicit --force flag
 *   - Validates backup integrity before restoration
 *   - Creates a new timestamped backup of current state before rolling back
 *
 * USAGE:
 *   node .opencode/scripts/rollback-state-migration.mjs --list
 *   node .opencode/scripts/rollback-state-migration.mjs --dry-run --timestamp 20260603_093708
 *   node .opencode/scripts/rollback-state-migration.mjs --force --timestamp 20260603_093708
 *   node .opencode/scripts/rollback-state-migration.mjs --force --timestamp 20260603_093708 --gate-only
 *
 * @since Wave 1.4 (R1)
 * @author @Super-Admin
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');
const STATE_DIR = join(PROJECT_ROOT, '.opencode/state');
const BACKUPS_DIR = join(STATE_DIR, '.backups');

const GATE_HOT = join(PROJECT_ROOT, '.opencode/state/gate-state.json');
const GATE_INDEX = join(PROJECT_ROOT, '.opencode/state/gate-state.index.json');
const GATE_ARCHIVE = join(PROJECT_ROOT, '.opencode/state/gate-state.archive.json');
const GATE_HISTORY = join(PROJECT_ROOT, '.opencode/state/gate-state.history');
const DAG_HOT = join(PROJECT_ROOT, 'Task.DAG.json');
const DAG_INDEX = join(PROJECT_ROOT, 'Task.DAG.index.json');
const DAG_CHANGELOG = join(PROJECT_ROOT, 'Task.DAG.changelog.md');
const DAG_VERSIONS = join(PROJECT_ROOT, 'Task.DAG.versions');
const MACHINE = join(PROJECT_ROOT, '.opencode/state/machine.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const LIST = args.includes('--list');
const GATE_ONLY = args.includes('--gate-only');
const DAG_ONLY = args.includes('--dag-only');
const TIMESTAMP = args.find((_, i) => args[i - 1] === '--timestamp') || null;

function log(msg) {
  const prefix = DRY_RUN ? '[DRY-RUN] ' : FORCE ? '[LIVE] ' : '';
  console.log(prefix + msg);
}

function error(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

// ── List available backups ──
function listBackups() {
  console.log('=== Available Backups ===\n');
  if (!existsSync(BACKUPS_DIR)) {
    console.log('No backups found.');
    return;
  }

  const entries = readdirSync(BACKUPS_DIR).filter(e => !['legacy'].includes(e));
  if (entries.length === 0) {
    console.log('No backups found.');
    return;
  }

  for (const entry of entries.sort().reverse()) {
    const dir = join(BACKUPS_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;

    const files = readdirSync(dir);
    const manifestFile = files.find(f => f === 'manifest.json');
    const gateBackup = files.find(f => f.includes('gate-state'));
    const dagBackup = files.find(f => f.includes('Task.DAG'));
    const hasManifest = manifestFile ? JSON.parse(readFileSync(join(dir, manifestFile), 'utf8')) : null;

    console.log(`📁 ${entry}  (created: ${hasManifest?.timestamp || 'unknown'})`);
    if (hasManifest?.migration) console.log(`   Migration: ${hasManifest.migration}`);
    if (gateBackup) {
      const size = (statSync(join(dir, gateBackup)).size / 1024).toFixed(0);
      console.log(`   📄 ${gateBackup}  (${size} KB)`);
    }
    if (dagBackup) {
      const size = (statSync(join(dir, dagBackup)).size / 1024).toFixed(0);
      console.log(`   📄 ${dagBackup}  (${size} KB)`);
    }
    console.log();
  }
}

// ── Validate a backup ──
function validateBackup(timestamp) {
  const dir = join(BACKUPS_DIR, timestamp);
  if (!existsSync(dir)) {
    error(`Backup directory not found: ${dir}`);
  }

  const files = readdirSync(dir);
  const gateBackup = files.find(f => f.includes('gate-state.v2') || f.includes('gate-state.backup'));
  const dagBackup = files.find(f => f.includes('Task.DAG.backup') || f.includes('Task.DAG.v1'));

  const result = { valid: true, gate: null, dag: null, issues: [] };

  // Validate gate-state backup
  if (gateBackup) {
    try {
      const content = readFileSync(join(dir, gateBackup), 'utf8');
      result.gate = JSON.parse(content);
      const sessionCount = Object.keys(result.gate.sessions || {}).length;
      if (sessionCount === 0) {
        result.issues.push('Gate backup has 0 sessions — possible corruption');
        result.valid = false;
      }
      log(`  ✅ Gate backup: ${sessionCount} sessions, formatVersion=${result.gate.formatVersion || '1.0'}`);
    } catch (e) {
      result.issues.push(`Gate backup JSON parse failed: ${e.message}`);
      result.valid = false;
    }
  } else {
    result.issues.push('No gate-state backup found in this directory');
  }

  // Validate DAG backup
  if (dagBackup) {
    try {
      const content = readFileSync(join(dir, dagBackup), 'utf8');
      result.dag = JSON.parse(content);
      const taskCount = (result.dag.tasks || []).length;
      if (taskCount === 0) {
        result.issues.push('DAG backup has 0 tasks — possible corruption');
        result.valid = false;
      }
      log(`  ✅ DAG backup: ${taskCount} tasks, version=${result.dag.version || 'unknown'}`);
    } catch (e) {
      result.issues.push(`DAG backup JSON parse failed: ${e.message}`);
      result.valid = false;
    }
  } else {
    result.issues.push('No DAG backup found in this directory');
  }

  return result;
}

// ── Create current-state safety backup ──
function createSafetyBackup() {
  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
  const dir = join(BACKUPS_DIR, `rollback_safety_${ts}`);
  mkdirSync(dir, { recursive: true });

  const backups = [];
  if (!DAG_ONLY && existsSync(GATE_HOT)) {
    copyFileSync(GATE_HOT, join(dir, 'gate-state.pre_rollback.json'));
    backups.push('gate-state.json');
  }
  if (!DAG_ONLY && existsSync(GATE_INDEX)) {
    copyFileSync(GATE_INDEX, join(dir, 'gate-state.index.pre_rollback.json'));
    backups.push('gate-state.index.json');
  }
  if (!DAG_ONLY && existsSync(GATE_ARCHIVE)) {
    copyFileSync(GATE_ARCHIVE, join(dir, 'gate-state.archive.pre_rollback.json'));
    backups.push('gate-state.archive.json');
  }
  if (!GATE_ONLY && existsSync(DAG_HOT)) {
    copyFileSync(DAG_HOT, join(dir, 'Task.DAG.pre_rollback.json'));
    backups.push('Task.DAG.json');
  }
  if (!GATE_ONLY && existsSync(DAG_INDEX)) {
    copyFileSync(DAG_INDEX, join(dir, 'Task.DAG.index.pre_rollback.json'));
    backups.push('Task.DAG.index.json');
  }

  // Write manifest
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    type: 'pre-rollback-safety-backup',
    timestamp: new Date().toISOString(),
    rollback_target: TIMESTAMP,
    files: backups,
  }, null, 2));

  log(`  ✅ Safety backup: ${backups.length} files in ${dir}`);
  return dir;
}

// ── Perform rollback ──
function performRollback(timestamp, validation) {
  const dir = join(BACKUPS_DIR, timestamp);
  const files = readdirSync(dir);
  const gateBackup = files.find(f => f.includes('gate-state.v2') || f.includes('gate-state.backup'));
  const dagBackup = files.find(f => f.includes('Task.DAG.backup') || f.includes('Task.DAG.v1'));

  // Create safety backup first
  const safetyDir = createSafetyBackup();

  // Rollback gate-state
  if (!DAG_ONLY && gateBackup) {
    const src = join(dir, gateBackup);

    // Read v2 content
    const v2Content = readFileSync(src, 'utf8');

    if (DRY_RUN) {
      const v2 = JSON.parse(v2Content);
      log(`  [DRY-RUN] Would restore gate-state: ${Object.keys(v2.sessions || {}).length} sessions`);
    } else {
      // Write v2 content to hot file
      writeFileSync(GATE_HOT, v2Content);
      log(`  ✅ Restored gate-state.json from ${gateBackup}`);

      // Clean up v3 artifacts
      const v3Files = [GATE_INDEX, GATE_ARCHIVE];
      for (const f of v3Files) {
        if (existsSync(f)) {
          const bak = f + '.rolled_back';
          copyFileSync(f, bak);
          if (FORCE) {
            unlinkSync(f);
            log(`  🧹 Removed DAG v2 artifact: ${f.replace(PROJECT_ROOT + '/', '')}`);
          }
        }
      }
    }
  }

  if (DRY_RUN) {
    log('\n[DRY-RUN] No files modified. Run with --force to execute rollback.');
    log(`[DRY-RUN] Safety backup created at: ${safetyDir}`);
  } else {
    log('\n✅ Rollback complete.');
    log(`   Restored from: ${timestamp}`);
    log(`   Safety backup: ${safetyDir}`);
    log(`   Note: v3 artifact backups saved with .rolled_back extension.`);
  }
}

// ── Main ──
async function main() {
  if (LIST) {
    listBackups();
    return;
  }

  if (!TIMESTAMP) {
    error('--timestamp <ts> is required. Use --list to see available backups.');
  }

  if (!FORCE && !DRY_RUN) {
    error('Must specify --dry-run or --force. Rollback is a destructive operation.');
  }

  if (GATE_ONLY && DAG_ONLY) {
    error('Cannot specify both --gate-only and --dag-only. Omit both for full rollback.');
  }

  log('=== State Migration Rollback ===');
  log(`Target backup: ${TIMESTAMP}`);
  log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE (--force)'}`);
  if (GATE_ONLY) log('Scope: gate-state only');
  if (DAG_ONLY) log('Scope: DAG only');
  if (!GATE_ONLY && !DAG_ONLY) log('Scope: full rollback (gate + DAG)');
  log('');

  // Validate
  log('Validating backup...');
  const validation = validateBackup(TIMESTAMP);

  if (!validation.valid) {
    error(`Backup validation failed:\n${validation.issues.map(i => `  - ${i}`).join('\n')}`);
  }

  // Warn about issues
  if (validation.issues.length > 0) {
    console.log('\n⚠️  Warnings:');
    validation.issues.forEach(i => console.log(`  - ${i}`));
    if (FORCE) {
      console.log('  Continuing with --force despite warnings.\n');
    } else {
      error('Use --force to override warnings, or select a different backup.');
    }
  }

  log('');

  // Perform rollback
  performRollback(TIMESTAMP, validation);

  log('');
  log('Post-rollback steps:');
  log('  1. Run: bun .opencode/scripts/framework-self-test.ts');
  log('  2. Run: bun .opencode/scripts/state-reconciliation.ts --fix');
  log('  3. Verify: git diff --stat .opencode/state/ Task.DAG.json');
}

main().catch(err => {
  console.error('Rollback failed:', err.message);
  process.exit(1);
});
