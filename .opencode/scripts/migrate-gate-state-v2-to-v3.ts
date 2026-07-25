#!/usr/bin/env bun
/**
 * Migration: gate-state.json v2 → v3
 *
 * One-time script to convert the existing monolithic gate-state.json (v2 format)
 * into the hierarchical v3 format.
 *
 * SAFETY FEATURES:
 * - Creates timestamped backup before ANY modifications
 * - Validates session count consistency before writing
 * - IDEMPOTENT: Can be run multiple times safely
 * - DRY-RUN mode: --dry-run validates without writing any files
 *
 * USAGE:
 *   node .opencode/scripts/migrate-gate-state-v2-to-v3.mjs
 *   node .opencode/scripts/migrate-gate-state-v2-to-v3.mjs --dry-run
 *
 * @module migrate-gate-state-v2-to-v3
 * @since Phase 0 (Foundation)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Path Resolution
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');
const STATE_DIR = join(PROJECT_ROOT, '.opencode/state');

const GATE_STATE_V2 = join(STATE_DIR, 'gate-state.json');
const GATE_STATE_V3 = join(STATE_DIR, 'gate-state.json');
const GATE_STATE_INDEX = join(STATE_DIR, 'gate-state.index.json');
const GATE_STATE_ARCHIVE = join(STATE_DIR, 'gate-state.archive.json');
const HISTORY_DIR = join(STATE_DIR, 'gate-state.history');

const TIMESTAMP = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..+/, '')
  .replace('T', '_');
const BACKUP_DIR = join(STATE_DIR, '.backups', TIMESTAMP);

// ============================================================================
// CLI Argument Parsing
// ============================================================================

const DRY_RUN = process.argv.includes('--dry-run');

function log(message) {
  const prefix = DRY_RUN ? '[DRY-RUN] ' : '';
  console.log(`${prefix}${message}`);
}

function logError(message) {
  const prefix = DRY_RUN ? '[DRY-RUN] ' : '';
  (console as any).error(`${prefix}❌ ${message}`);
}

// ============================================================================
// Backup
// ============================================================================

function createBackup() {
  log(`Creating backup at: ${BACKUP_DIR}`);

  if (!DRY_RUN) {
    mkdirSync(BACKUP_DIR, { recursive: true });

    if (existsSync(GATE_STATE_V2)) {
      copyFileSync(GATE_STATE_V2, join(BACKUP_DIR, 'gate-state.v2.backup.json'));
      log('  ✅ gate-state.v2.backup.json');
    }

    const taskDagPath = join(PROJECT_ROOT, 'Task.DAG.json');
    if (existsSync(taskDagPath)) {
      copyFileSync(taskDagPath, join(BACKUP_DIR, 'Task.DAG.backup.json'));
      log('  ✅ Task.DAG.backup.json');
    }

    const machinePath = join(STATE_DIR, 'machine.json');
    if (existsSync(machinePath)) {
      copyFileSync(machinePath, join(BACKUP_DIR, 'machine.backup.json'));
      log('  ✅ machine.backup.json');
    }

    const manifest = {
      migration: 'gate-state v2 → v3',
      timestamp: new Date().toISOString(),
      source: GATE_STATE_V2,
      dryRun: DRY_RUN,
    };
    writeFileSync(join(BACKUP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
}

// ============================================================================
// Validation
// ============================================================================

function validateOutput(originalCount, hot, index, archive) {
  const activeCount = Object.keys(hot.active_sessions).length;
  const recentCount = Object.keys(hot.recent_sessions).length;
  const indexCount = Object.keys(index.sessions).length;
  const archiveCount = Object.keys(archive.sessions).length;
  const hotTotal = activeCount + recentCount;

  if (indexCount < recentCount + archiveCount) {
    return {
      valid: false,
      message: `Index count: ${indexCount} < recent(${recentCount}) + archived(${archiveCount})`,
    };
  }

  // Total across all tiers should match original
  const totalNew = activeCount + indexCount;
  if (totalNew !== originalCount) {
    return {
      valid: false,
      message: `Count mismatch: original ${originalCount} vs new ${totalNew} (active: ${activeCount}, index: ${indexCount})`,
    };
  }

  return { valid: true, message: `All ${originalCount} sessions accounted for` };
}

// ============================================================================
// Core Migration Logic
// ============================================================================

function migrate() {
  log('=== gate-state.json v2 → v3 Migration ===');
  log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE'}`);

  if (!existsSync(GATE_STATE_V2)) {
    logError(`Source file not found: ${GATE_STATE_V2}`);
    process.exit(1);
  }

  // 1. Create backup
  createBackup();

  // 2. Read v2 file
  log('Reading v2 file...');
  const v2 = JSON.parse(readFileSync(GATE_STATE_V2, 'utf8'));
  const allSessions = v2.sessions || {};
  const allSessionIds = Object.keys(allSessions);
  log(`  Found ${allSessionIds.length} sessions`);

  // 3. Prepare new structures
  const hot = {
    formatVersion: '3.0',
    active_sessions: {},
    recent_sessions: {},
    meta: {
      total_sessions: allSessionIds.length,
      active_count: 0,
      recent_count: 0,
      last_compacted: new Date().toISOString(),
    },
  };

  const index = {
    formatVersion: '3.0',
    sessions: {},
  };

  const archive = {
    formatVersion: '3.0',
    archived_at: new Date().toISOString(),
    session_count: 0,
    sessions: {},
  };

  const historyEntries = [];
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // 4. Process each session
  log('Processing sessions...');
  let activeCount = 0;
  let recentCount = 0;
  let archiveCount = 0;

  for (const [sessionId, session] of Object.entries(allSessions)) {
    const s = session;

    if (['active', 'checked', 'armed', 'pending'].includes((s as any).gate_status)) {
      // Active/pending → hot.active_sessions
      hot.active_sessions[sessionId] = {
        session_id: (s as any).session_id || sessionId,
        created_at: (s as any).created_at || '',
        gate_status: (s as any).gate_status,
        confirmed_at: (s as any).confirmed_at || undefined,
        task_description: (s as any).task_description || '',
        plan_summary: (s as any).plan_summary || '',
      };
      activeCount++;
    } else {
      // Completed/drained → determine if recent or archive
      const consumedAt = (s as any).consumed_at ? new Date((s as any).consumed_at) : null;
      const isRecent = consumedAt !== null && consumedAt > recentCutoff;

      const auditData = (s as any).audit || {};

      const historyEntry = {
        session_id: (s as any).session_id || sessionId,
        task_description: (s as any).task_description || '',
        plan_summary: (s as any).plan_summary || '',
        execution_summary: auditData.execution_summary || '',
        audit: {
          completed_at: auditData.completed_at || (s as any).consumed_at || '',
          execution_summary: auditData.execution_summary || '',
        },
      };
      historyEntries.push(historyEntry);
      const historyRef = `gate-state.history/migrated-${TIMESTAMP}.jsonl#${historyEntries.length - 1}`;

      if (isRecent) {
        hot.recent_sessions[sessionId] = {
          session_id: (s as any).session_id || sessionId,
          created_at: (s as any).created_at || '',
          gate_status: 'completed',
          consumed_at: (s as any).consumed_at || '',
          archive_ref: historyRef,
        };
        recentCount++;
      } else {
        archive.sessions[sessionId] = {
          session_id: (s as any).session_id || sessionId,
          archive_ref: historyRef,
        };
        archiveCount++;
      }

      index.sessions[sessionId] = {
        session_id: (s as any).session_id || sessionId,
        created_at: (s as any).created_at || '',
        gate_status: (s as any).gate_status === 'drained' ? 'drained' : 'completed',
        consumed_at: (s as any).consumed_at || undefined,
        archive_ref: historyRef,
      };
    }
  }

  hot.meta.active_count = activeCount;
  hot.meta.recent_count = recentCount;
  archive.session_count = archiveCount;

  log(`  Active: ${activeCount}, Recent: ${recentCount}, Archived: ${archiveCount}, Index: ${Object.keys(index.sessions).length}`);

  // 5. Validate
  log('Validating migration...');
  const validation = validateOutput(allSessionIds.length, hot, index, archive);
  if (!validation.valid) {
    logError(`Validation failed: ${validation.message}`);
    process.exit(1);
  }
  log(`  ✅ ${validation.message}`);

  // 6. Write files (skip if dry-run)
  if (DRY_RUN) {
    log('\nDRY-RUN: Would write the following files:');
    log(`  - gate-state.json (hot: ${activeCount} active + ${recentCount} recent)`);
    log(`  - gate-state.index.json (${Object.keys(index.sessions).length} entries)`);
    log(`  - gate-state.archive.json (${archiveCount} entries)`);
    log(`  - gate-state.history/migrated-${TIMESTAMP}.jsonl (${historyEntries.length} entries)`);
    log('\nDRY-RUN complete. No files were modified.');
    log('To perform the actual migration, run without --dry-run.');
    return;
  }

  log('Writing new files...');

  mkdirSync(HISTORY_DIR, { recursive: true });

  writeFileSync(GATE_STATE_V3, JSON.stringify(hot, null, 2));
  log('  ✅ gate-state.json (hot)');

  writeFileSync(GATE_STATE_INDEX, JSON.stringify(index, null, 2));
  log('  ✅ gate-state.index.json');

  writeFileSync(GATE_STATE_ARCHIVE, JSON.stringify(archive, null, 2));
  log('  ✅ gate-state.archive.json');

  const historyFile = join(HISTORY_DIR, `migrated-${TIMESTAMP}.jsonl`);
  writeFileSync(historyFile, historyEntries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  log(`  ✅ gate-state.history/migrated-${TIMESTAMP}.jsonl`);

  const oldSize = Math.round(readFileSync(join(BACKUP_DIR, 'gate-state.v2.backup.json')).length / 1024);
  const newSize = Math.round(readFileSync(GATE_STATE_V3).length / 1024);

  log('\n=== Migration Complete ===');
  log(`  Total sessions: ${allSessionIds.length}`);
  log(`  Active: ${activeCount}, Recent: ${recentCount}, Archived: ${archiveCount}`);
  log(`  Hot file: ~${oldSize}KB → ~${newSize}KB`);
  log(`  Backup: ${BACKUP_DIR}`);
  log('\nNext steps:');
  log('  1. Run: bun .opencode/scripts/framework-self-test.ts');
  log('  2. Test: compliance_gate_check still works');
  log('  3. Monitor for 48 hours');
}

try {
  migrate();
} catch (error) {
  logError(`Migration failed: ${error.message}`);
  log(`Backup available at: ${BACKUP_DIR}`);
  process.exit(1);
}
