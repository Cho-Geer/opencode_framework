#!/usr/bin/env bun
/**
 * nightly-compaction.ts — Trigger nightly state archival
 *
 * Runs nightly compaction for gate-state (compress old history files into archive)
 * and optionally DAG archival (archive completed tasks >14 days old).
 *
 * USAGE:
 *   bun .opencode/scripts/nightly-compaction.ts              # gate-state only
 *   bun .opencode/scripts/nightly-compaction.ts --dag        # gate + DAG
 *   bun .opencode/scripts/nightly-compaction.ts --dry-run
 *   bun .opencode/scripts/nightly-compaction.ts --today YYYY-MM-DD  # override date
 *
 * TRIGGERS:
 *   - @CI-CD-Agent scheduled task (cron: 0 2 * * *)
 *   - Manual: bun .opencode/scripts/nightly-compaction.ts
 *   - Future: session.compacted event in framework-enforcer.ts
 *
 * FW-PLAN-JS-TO-TS: Unified to TypeScript + Bun; removed dist/ fallback.
 * @since Wave 4.1 (R7)
 * @author @Super-Admin
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');
const STATE_DIR = join(PROJECT_ROOT, '.opencode/state');

/**
 * Load StateCompactor and DAGVersionManager from TypeScript source.
 * FW-PLAN-JS-TO-TS: Bun executes .ts directly; no compilation or dist/ fallback needed.
 */
const { StateCompactor } = await import('../lib/state-compactor.ts');
const { DAGVersionManager } = await import('../lib/dag-version-manager.ts');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const WITH_DAG = args.includes('--dag');
const todayArg = args.find((_, i) => args[i - 1] === '--today');
const TODAY = todayArg || new Date().toISOString().split('T')[0];

function log(msg) { console.log((DRY_RUN ? '[DRY-RUN] ' : '') + msg); }

async function compactGateState() {
  log('=== Gate-State Nightly Compaction ===');
  const compactor = new StateCompactor();

  if (DRY_RUN) {
    // Dry-run: show what would be compacted
    const historyDir = join(STATE_DIR, 'gate-state.history');
    if (!existsSync(historyDir)) { log('No history directory. Nothing to compact.'); return; }
    const files = readdirSync(historyDir).filter(f => f.endsWith('.jsonl'));
    const cutoff = new Date(TODAY);
    cutoff.setDate(cutoff.getDate() - 7);
    const oldFiles = files.filter(f => {
      const match = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!match) return false;
      return new Date(match[1]) < cutoff;
    });
    log(`${oldFiles.length} history files >7 days old would be compacted`);
    if (oldFiles.length > 0) log(`Oldest: ${oldFiles[0]}, Newest: ${oldFiles[oldFiles.length-1]}`);
  } else {
    await compactor.nightlyCompaction();
  }
  log('Gate-state compaction complete.');
}

async function archiveOldDAGTasks() {
  log('=== DAG Archival ===');
  const mgr = new DAGVersionManager();
  const dagPath = join(PROJECT_ROOT, 'Task.DAG.json');

  if (!existsSync(dagPath)) { log('No Task.DAG.json found.'); return; }

  const dag = JSON.parse(readFileSync(dagPath, 'utf8'));
  const cutoff = new Date(TODAY);
  cutoff.setDate(cutoff.getDate() - 14);

  const oldCompleted = (dag.tasks || []).filter(t =>
    t.status === 'completed' && t.completed_at && new Date(t.completed_at) < cutoff
  );

  if (oldCompleted.length === 0) {
    log('No tasks >14 days old. Nothing to archive.');
    return;
  }

  if (DRY_RUN) {
    log(`Would archive ${oldCompleted.length} completed tasks >14 days old`);
    log(`Hot file: ${dag.tasks.length} → ${dag.tasks.length - oldCompleted.length} tasks`);
  } else {
    const result = await mgr.createVersionSnapshot(
      dag.version, dag.version,
      `Nightly auto-archival: ${oldCompleted.length} tasks >14 days old`
    );
    log(`Archived ${result.tasksArchived} tasks. ${result.tasksRemaining} remain in hot file.`);
  }
}

// SA-IMPL-BACKUP-LIFECYCLE: Nightly backup cleanup step.
// Uses cleanupStaleBackups() from safe-edit-core.ts to remove backups older than
// TTL (default 7 days) and enforce per-directory count caps (default 20).
async function cleanupStaleBackupsStep() {
  const stepName = 'backup-cleanup';
  try {
    const { cleanupStaleBackups } = await import('../lib/safe-edit-core.ts');
    const ttlDays = 7;
    const maxPerDir = 20;
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;

    if (DRY_RUN) {
      log(`[${stepName}] Would scan all .opencode_backups/ [TTL=${ttlDays}d, cap=${maxPerDir}] — DRY-RUN`);
      return;
    }

    const result = cleanupStaleBackups(PROJECT_ROOT, ttlMs, maxPerDir, true);
    log(`[${stepName}] Scanned ${result.dirs} dirs, ${result.scanned} files, deleted ${result.deleted}`);
  } catch (err) {
    log(`[${stepName}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// SA-IMPL-SELF-CLEANUP (2026-06-11): Nightly cleanup of stale session_access entries.
// Removes agent entries in knowledge_cache_state.session_access that have been
// inactive for more than STALE_DAYS (default 30). Also removes invalid keys
// like "unknown", "", "undefined". Strategy B: periodic global cleanup.
async function cleanupStaleSessionAccessStep() {
  const stepName = 'session-access-cleanup';
  const STALE_DAYS = 30;
  const INVALID_KEYS = ['unknown', '', 'undefined', 'null'];
  try {
    const { readFileSync, writeFileSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const machinePath = join(PROJECT_ROOT, '.opencode', 'state', 'machine.json');
    if (!existsSync(machinePath)) {
      log(`[${stepName}] machine.json not found — skip`);
      return;
    }
    const machine = JSON.parse(readFileSync(machinePath, 'utf-8'));
    const sa = machine?.knowledge_cache_state?.session_access;
    if (!sa || Object.keys(sa).length === 0) {
      log(`[${stepName}] no session_access entries — skip`);
      return;
    }
    const now = Date.now();
    const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const key of Object.keys(sa)) {
      let shouldRemove = false;
      if (INVALID_KEYS.includes(key)) {
        shouldRemove = true;
      } else {
        const lastRead = sa[key]?.last_read_at || sa[key]?.declared_at;
        if (lastRead && (now - new Date(lastRead).getTime() > staleMs)) {
          shouldRemove = true;
        }
      }
      if (shouldRemove) {
        delete sa[key];
        removed++;
      }
    }

    if (removed > 0) {
      writeFileSync(machinePath, JSON.stringify(machine, null, 2), 'utf-8');
      log(`[${stepName}] Cleaned ${removed} stale/invalid session_access entries. ${Object.keys(sa).length} remaining.`);
    } else {
      log(`[${stepName}] All ${Object.keys(sa).length} entries fresh — no cleanup needed.`);
    }
  } catch (err) {
    log(`[${stepName}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  log(`Nightly Compaction — ${TODAY} ${DRY_RUN ? '(DRY-RUN)' : ''}`);
  log('');

  await compactGateState();
  log('');

  if (WITH_DAG) {
    await archiveOldDAGTasks();
    log('');
  }

  // SA-IMPL-BACKUP-LIFECYCLE: Nightly cleanup of stale .opencode_backups/
  await cleanupStaleBackupsStep();
  log('');

  // SA-IMPL-SELF-CLEANUP: Nightly cleanup of stale session_access entries
  await cleanupStaleSessionAccessStep();
  log('');

  log('Nightly compaction complete.');
  // Output metrics
  const hotFile = join(STATE_DIR, 'gate-state.json');
  if (existsSync(hotFile)) {
    const hot = JSON.parse(readFileSync(hotFile, 'utf8'));
    log(`Gate hot file: ${hot.meta?.active_count || 0} active, ${hot.meta?.recent_count || 0} recent`);
  }
}

main().catch(err => { console.error('Compaction failed:', err.message); process.exit(1); });
