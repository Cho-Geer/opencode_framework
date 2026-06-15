#!/usr/bin/env bun
/**
 * DAG Archival Script — archive-dag-tasks.ts
 *
 * Archives completed tasks older than 14 days from Task.DAG.json
 * to Task.DAG.versions/ snapshots using DAGVersionManager.
 *
 * Intended for @CI-CD-Agent nightly cron or manual compaction.
 *
 * USAGE:
 *   bun .opencode/scripts/archive-dag-tasks.ts
 *   bun .opencode/scripts/archive-dag-tasks.ts --dry-run
 *
 * FW-PLAN-JS-TO-TS: Unified to TypeScript + Bun; removed dist/ dependency.
 * @since P0-3
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = new URL('.', import.meta.url).pathname;
const PROJECT_ROOT = join(__dirname, '../..');
const DAG_HOT = join(PROJECT_ROOT, 'Task.DAG.json');
const DRY_RUN = process.argv.includes('--dry-run');
const RECENT_DAYS = 14;
const { DAGVersionManager } = require(join(PROJECT_ROOT, '.opencode/lib/dag-version-manager.ts'));

function log(msg) { console.log((DRY_RUN ? '[DRY-RUN] ' : '') + msg); }

async function archive() {
  log('=== DAG Task Archival ===');
  log('Mode: ' + (DRY_RUN ? 'DRY-RUN' : 'LIVE'));

  if (!existsSync(DAG_HOT)) {
    log('Task.DAG.json not found. Nothing to archive.');
    return;
  }

  const dag = JSON.parse(readFileSync(DAG_HOT, 'utf8'));
  const allTasks = dag.tasks || [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECENT_DAYS);
  log('Cutoff: ' + cutoff.toISOString().split('T')[0] + ' (' + RECENT_DAYS + ' days)');

  const oldCompleted = allTasks.filter(t =>
    t.status === 'completed' && t.completed_at && new Date(t.completed_at) < cutoff
  );

  if (oldCompleted.length === 0) {
    log('No tasks older than ' + RECENT_DAYS + ' days. Nothing to archive.');
    log('All ' + allTasks.length + ' tasks are recent or pending.');
    return;
  }

  const pendingTasks = allTasks.filter(t => t.status !== 'completed');
  const recentCompleted = allTasks.filter(t =>
    t.status === 'completed' && (!t.completed_at || new Date(t.completed_at) >= cutoff)
  );

  log('Old completed: ' + oldCompleted.length + ' (→ snapshot)');
  log('Pending: ' + pendingTasks.length);
  log('Recent completed: ' + recentCompleted.length);
  log('Hot file: ' + allTasks.length + ' → ' + (pendingTasks.length + recentCompleted.length) + ' tasks');

  if (DRY_RUN) {
    log('\nDRY-RUN: Would archive ' + oldCompleted.length + ' tasks and shrink hot file.');
    return;
  }

  // Use DAGVersionManager to create snapshot and update hot file
  const mgr = new DAGVersionManager();
  const currentVersion = dag.version || '5.4.0';
  const result = await mgr.createVersionSnapshot(
    currentVersion,
    currentVersion,
    'Auto-archived ' + oldCompleted.length + ' tasks > ' + RECENT_DAYS + ' days old'
  );

  log('\n=== Archive Complete ===');
  log('  Tasks archived: ' + result.tasksArchived);
  log('  Tasks remaining in hot: ' + result.tasksRemaining);
  log('  Snapshot: ' + result.snapshotPath);
}

archive().catch(err => {
  console.error('Archive failed:', err.message);
  process.exit(1);
});
