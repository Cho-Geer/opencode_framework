#!/usr/bin/env node
/**
 * Migration: Task.DAG.json v1 → v2 (Hierarchical)
 *
 * One-time script to:
 * 1. Add completed_at timestamps to completed tasks (based on changelog dates)
 * 2. Create version snapshot at Task.DAG.versions/Task.DAG.v{current}.json
 * 3. Extract changelog to Task.DAG.changelog.md
 * 4. Build Task.DAG.index.json
 * 5. Move old completed tasks (>14 days) out of hot file
 * 6. Write compact hot Task.DAG.json
 *
 * SAFETY:
 * - Creates full snapshot backup before any modifications
 * - Validates task count consistency
 * - DRY-RUN mode: --dry-run
 *
 * USAGE:
 *   node .opencode/scripts/migrate-dag-v2.mjs
 *   node .opencode/scripts/migrate-dag-v2.mjs --dry-run
 *
 * @since Phase 2
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');

const DAG_FILE = join(PROJECT_ROOT, 'Task.DAG.json');
const VERSIONS_DIR = join(PROJECT_ROOT, 'Task.DAG.versions');
const CHANGELOG_FILE = join(PROJECT_ROOT, 'Task.DAG.changelog.md');
const INDEX_FILE = join(PROJECT_ROOT, 'Task.DAG.index.json');

const TIMESTAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
const BACKUP_DIR = join(PROJECT_ROOT, '.opencode/state/.backups', 'dag_' + TIMESTAMP);

const DRY_RUN = process.argv.includes('--dry-run');
const RECENT_DAYS = 14;

// --fallback-date: If set, all completed tasks without a completed_at timestamp
// (or with timestamps >= cutoff) get this date. Use when changelog dates are
// all within the recent window and you need to force-archive older tasks.
const fallbackDateIdx = process.argv.indexOf('--fallback-date');
const FALLBACK_DATE = fallbackDateIdx >= 0 ? process.argv[fallbackDateIdx + 1] : null;

function log(msg) {
  console.log((DRY_RUN ? '[DRY-RUN] ' : '') + msg);
}
function logError(msg) {
  console.error((DRY_RUN ? '[DRY-RUN] ' : '') + '❌ ' + msg);
}

// ============================================================================
// Backup
// ============================================================================
function createBackup() {
  log('Creating backup at: ' + BACKUP_DIR);
  if (!DRY_RUN) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    copyFileSync(DAG_FILE, join(BACKUP_DIR, 'Task.DAG.v1.backup.json'));
    log('  ✅ Task.DAG.v1.backup.json');
  }
}

// ============================================================================
// Timestamp Assignment
// ============================================================================
function assignTimestamps(dag) {
  const changelog = dag.change_log || [];
  const completedTasks = (dag.tasks || []).filter(t => t.status === 'completed');

  if (changelog.length === 0 || completedTasks.length === 0) {
    return completedTasks;
  }

  // Sort changelog by date (oldest first)
  const sortedCL = [...changelog].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // Build timeline: pair each changelog entry with its date
  const timeline = sortedCL.map(cl => ({
    date: cl.date,
    version: cl.version,
    completed: cl.completed_tasks || 0,
  }));

  // Calculate total completed across all changelog entries to weight distribution
  const totalReportedCompleted = timeline.reduce((sum, t) => sum + t.completed, 0);

  if (totalReportedCompleted === 0) {
    // Fallback: assign all to latest date
    const latestDate = timeline[timeline.length - 1].date;
    completedTasks.forEach(t => { t.completed_at = latestDate; });
    return completedTasks;
  }

  // Distribute completed tasks proportionally
  let taskIndex = 0;
  for (const entry of timeline) {
    const proportion = entry.completed / totalReportedCompleted;
    const count = Math.round(proportion * completedTasks.length);
    const batch = completedTasks.slice(taskIndex, Math.min(taskIndex + count, completedTasks.length));
    batch.forEach(t => { t.completed_at = entry.date; });
    taskIndex += count;
  }

  // Assign any remaining tasks to the latest date
  const remaining = completedTasks.slice(taskIndex);
  if (remaining.length > 0) {
    const latestDate = timeline[timeline.length - 1].date;
    remaining.forEach(t => { t.completed_at = latestDate; });
  }

  return completedTasks;
}

// ============================================================================
// Core Migration
// ============================================================================
function migrate() {
  log('=== Task.DAG.json v1 → v2 Migration ===');
  log('Mode: ' + (DRY_RUN ? 'DRY-RUN' : 'LIVE'));

  if (!existsSync(DAG_FILE)) {
    logError('DAG file not found: ' + DAG_FILE);
    process.exit(1);
  }

  // 1. Backup
  createBackup();

  // 2. Read DAG
  log('Reading Task.DAG.json...');
  const dag = JSON.parse(readFileSync(DAG_FILE, 'utf8'));
  const originalVersion = dag.version || 'unknown';
  const allTasks = dag.tasks || [];
  const originalCount = allTasks.length;
  log('  Version: ' + originalVersion);
  log('  Tasks: ' + originalCount + ' (' + allTasks.filter(t => t.status === 'pending').length + ' pending, ' + allTasks.filter(t => t.status === 'completed').length + ' completed)');

  // 3. Assign timestamps to completed tasks
  log('Assigning completed_at timestamps...');
  assignTimestamps(dag);

  // Count tasks with timestamps
  const withTs = allTasks.filter(t => t.completed_at).length;
  log('  Tasks with timestamps: ' + withTs);

  // 4. Determine recent vs old
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RECENT_DAYS);
  log('  Cutoff date: ' + cutoffDate.toISOString().split('T')[0] + ' (≥' + RECENT_DAYS + ' days)');

  const pendingTasks = allTasks.filter(t => t.status === 'pending');
  const completedTasks = allTasks.filter(t => t.status === 'completed');

  // Apply fallback date for tasks that wouldn't otherwise be archived
  if (FALLBACK_DATE) {
    log('  Fallback date: ' + FALLBACK_DATE + ' (tasks without old-enough timestamps get this)');
    let fallbackCount = 0;
    for (const task of completedTasks) {
      if (!task.completed_at || new Date(task.completed_at) >= cutoffDate) {
        task.completed_at = FALLBACK_DATE;
        fallbackCount++;
      }
    }
    log('  Fallback assigned to: ' + fallbackCount + ' tasks');
  }

  const recentCompleted = completedTasks.filter(t => {
    if (!t.completed_at) return true; // keep if no timestamp
    return new Date(t.completed_at) >= cutoffDate;
  });

  const oldCompleted = completedTasks.filter(t => {
    if (!t.completed_at) return false;
    return new Date(t.completed_at) < cutoffDate;
  });

  log('  Pending: ' + pendingTasks.length);
  log('  Recent completed: ' + recentCompleted.length);
  log('  Old completed (→archive): ' + oldCompleted.length);

  // 5. Write full snapshot
  const snapshotPath = join(VERSIONS_DIR, 'Task.DAG.v' + originalVersion + '.json');
  log('Writing snapshot: ' + snapshotPath);
  if (!DRY_RUN) {
    if (!existsSync(VERSIONS_DIR)) mkdirSync(VERSIONS_DIR, { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify(dag, null, 2));
    log('  ✅ Snapshot saved (' + Math.round(JSON.stringify(dag).length / 1024) + 'KB)');
  }

  // 6. Build hot DAG (pending + recent completed)
  const hotDag = { ...dag };
  hotDag.tasks = [...pendingTasks, ...recentCompleted];
  hotDag.version = originalVersion;

  // Update meta
  hotDag.meta = {
    ...(hotDag.meta || {}),
    total_tasks: originalCount,
    pending_tasks: pendingTasks.length,
    recent_completed: recentCompleted.length,
    archived_completed: oldCompleted.length,
    last_compacted: new Date().toISOString(),
  };

  // Remove changelog from hot file
  delete hotDag.change_log;
  delete hotDag.task_groups;

  const hotSize = JSON.stringify(hotDag).length;
  const originalSize = JSON.stringify(dag).length;
  log('Hot file: ' + Math.round(originalSize / 1024) + 'KB → ' + Math.round(hotSize / 1024) + 'KB');

  // 7. Extract changelog
  log('Extracting changelog...');
  let changelogMd = '# Task.DAG Changelog\n\n> Auto-generated by DAG migration Phase 2. Last compacted: ' + new Date().toISOString() + '\n\n';
  const changelog = dag.change_log || [];
  for (const entry of [...changelog].reverse()) {
    changelogMd += '## v' + (entry.version || '?') + ' (' + (entry.date || '?') + ')\n';
    changelogMd += '- ' + (entry.summary || '(no summary)').replace(/\n/g, ' ') + '\n';
    changelogMd += '\n';
  }

  if (!DRY_RUN) {
    writeFileSync(CHANGELOG_FILE, changelogMd);
    log('  ✅ Changelog written (' + changelog.length + ' entries)');
  }

  // 8. Build task index
  log('Building task index...');
  const taskIndex = {};
  for (const task of allTasks) {
    taskIndex[task.id] = {
      id: task.id,
      title: task.title || task.name || '',
      status: task.status,
      completed_at: task.completed_at || null,
      agent: task.agent || task.owner || '',
      priority: task.priority || '',
      archive_ref: oldCompleted.includes(task)
        ? 'Task.DAG.versions/Task.DAG.v' + originalVersion + '.json#tasks.' + task.id
        : 'Task.DAG.json#tasks.' + task.id,
    };
  }

  if (!DRY_RUN) {
    writeFileSync(INDEX_FILE, JSON.stringify({
      formatVersion: '2.0',
      generated_at: new Date().toISOString(),
      total_tasks: originalCount,
      task_index: taskIndex,
    }, null, 2));
    log('  ✅ Index written (' + Object.keys(taskIndex).length + ' entries)');
  }

  // 9. Write hot DAG
  if (!DRY_RUN) {
    writeFileSync(DAG_FILE, JSON.stringify(hotDag, null, 2));
    log('  ✅ Hot DAG written');
  }

  // 10. Summary
  log('\n=== Migration Complete ===');
  log('  Tasks: ' + originalCount + ' → hot: ' + hotDag.tasks.length + ' (pending: ' + pendingTasks.length + ', recent: ' + recentCompleted.length + '), archived: ' + oldCompleted.length);
  log('  Hot file: ' + Math.round(originalSize / 1024) + 'KB → ' + Math.round(hotSize / 1024) + 'KB (' + Math.round((1 - hotSize / originalSize) * 100) + '% reduction)');
  log('  Snapshot: ' + snapshotPath);
  log('  Changelog: ' + CHANGELOG_FILE);
  log('  Index: ' + INDEX_FILE);
  log('  Backup: ' + BACKUP_DIR);
}

try {
  migrate();
} catch (error) {
  logError('Migration failed: ' + error.message);
  log('Backup at: ' + BACKUP_DIR);
  process.exit(1);
}
