#!/usr/bin/env node
/**
 * nightly-compaction.mjs — Trigger nightly state archival
 *
 * Runs nightly compaction for gate-state (compress old history files into archive)
 * and optionally DAG archival (archive completed tasks >14 days old).
 *
 * USAGE:
 *   node .opencode/scripts/nightly-compaction.mjs              # gate-state only
 *   node .opencode/scripts/nightly-compaction.mjs --dag        # gate + DAG
 *   node .opencode/scripts/nightly-compaction.mjs --dry-run
 *   node .opencode/scripts/nightly-compaction.mjs --today YYYY-MM-DD  # override date
 *
 * TRIGGERS:
 *   - @CI-CD-Agent scheduled task (cron: 0 2 * * *)
 *   - Manual: node .opencode/scripts/nightly-compaction.mjs
 *   - Future: session.compacted event in framework-enforcer.ts
 *
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
 * Load StateCompactor — prefers tsx source import, falls back to compiled dist/.
 * FW-REPAIR-14: Eliminates brittle dist/ dependency; uses top-level await for .mjs ESM.
 *
 * When invoked via `npx tsx`, dynamic import of .ts source works natively.
 * When invoked via plain `node`, falls back to require() of pre-compiled dist/ JS.
 */
let StateCompactor, DAGVersionManager;
try {
  const srcModule = await import('../lib/state-compactor.ts');
  StateCompactor = srcModule.StateCompactor;
} catch {
  // Fallback: compiled dist/ (plain node without tsx)
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  StateCompactor = require(join(PROJECT_ROOT, '.opencode/lib/dist/state-compactor')).StateCompactor;
}
try {
  const dagModule = await import('../lib/dag-version-manager.ts');
  DAGVersionManager = dagModule.DAGVersionManager;
} catch {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  DAGVersionManager = require(join(PROJECT_ROOT, '.opencode/lib/dist/dag-version-manager')).DAGVersionManager;
}

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

async function main() {
  log(`Nightly Compaction — ${TODAY} ${DRY_RUN ? '(DRY-RUN)' : ''}`);
  log('');

  await compactGateState();
  log('');

  if (WITH_DAG) {
    await archiveOldDAGTasks();
    log('');
  }

  log('Nightly compaction complete.');
  // Output metrics
  const hotFile = join(STATE_DIR, 'gate-state.json');
  if (existsSync(hotFile)) {
    const hot = JSON.parse(readFileSync(hotFile, 'utf8'));
    log(`Gate hot file: ${hot.meta?.active_count || 0} active, ${hot.meta?.recent_count || 0} recent`);
  }
}

main().catch(err => { console.error('Compaction failed:', err.message); process.exit(1); });
