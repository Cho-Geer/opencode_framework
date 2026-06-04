/**
 * dag-version-manager.test.ts — Unit tests for dag-version-manager
 *
 * Tests version snapshots, changelog reading, index management, and edge cases.
 * Uses temp directories with synthetic DAG files — never touches real state.
 *
 * @since Wave 2.1c (R2)
 */
import { DAGVersionManager, snapshotDAG, DAG_CONFIG } from '../dag-version-manager';
import { writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Helper to override instance paths for testing in a temp directory */
function overridePaths(manager: DAGVersionManager, dir: string) {
  (manager as any).hotFile = join(dir, 'Task.DAG.json');
  (manager as any).versionsDir = join(dir, 'Task.DAG.versions');
  (manager as any).changelogFile = join(dir, 'Task.DAG.changelog.md');
  (manager as any).indexFile = join(dir, 'Task.DAG.index.json');
}

/** Create a minimal synthetic DAG */
function createDAG(dir: string, tasks: Array<{id: string; status: string; completed_at?: string}>, version = '1.0.0') {
  const dag = { version, tasks, meta: { total_tasks: tasks.length, pending_tasks: tasks.filter(t=>t.status==='pending').length } };
  writeFileSync(join(dir, 'Task.DAG.json'), JSON.stringify(dag, null, 2));
  return dag;
}

describe('dag-version-manager', () => {
  let tmpDir: string;
  let mgr: DAGVersionManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dag-test-'));
    mkdirSync(join(tmpDir, 'Task.DAG.versions'), { recursive: true });
    mgr = new DAGVersionManager();
    overridePaths(mgr, tmpDir);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // ─── getVersionHistory ───
  describe('getVersionHistory()', () => {
    it('returns empty array when no snapshots exist', () => {
      const history = mgr.getVersionHistory();
      expect(history).toEqual([]);
    });
  });

  // ─── readChangelog ───
  describe('readChangelog()', () => {
    it('returns empty array when no changelog exists', () => {
      const entries = mgr.readChangelog();
      expect(entries).toEqual([]);
    });

    it('parses changelog entries correctly', () => {
      writeFileSync(join(tmpDir, 'Task.DAG.changelog.md'),
        '# Task.DAG Changelog\n\n' +
        '## v2.0.0 (2026-05-20)\n- Fixed bug A\n- Added feature B\n\n' +
        '## v1.0.0 (2026-05-10)\n- Initial version\n'
      );
      const entries = mgr.readChangelog();
      expect(entries.length).toBe(2);
      expect(entries[0].version).toBe('2.0.0');
      expect(entries[0].date).toBe('2026-05-20');
      expect(entries[0].summary).toContain('Fixed bug A');
      expect(entries[1].version).toBe('1.0.0');
    });
  });

  // ─── createVersionSnapshot ───
  describe('createVersionSnapshot()', () => {
    it('keeps pending tasks in hot file after archival', async () => {
      createDAG(tmpDir, [
        { id: 'T1', status: 'pending' },
        { id: 'T2', status: 'completed', completed_at: '2026-01-01T00:00:00Z' }, // old
      ]);
      const result = await mgr.createVersionSnapshot('1.0.0', '2.0.0', 'Test snapshot');
      expect(result.tasksArchived).toBe(1);
      expect(result.tasksRemaining).toBe(1);
    });

    it('keeps recent completed tasks (within 14 days)', async () => {
      const today = new Date();
      const recent = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
      createDAG(tmpDir, [
        { id: 'T1', status: 'completed', completed_at: recent },
      ]);
      const result = await mgr.createVersionSnapshot('1.0.0', '2.0.0', 'Snapshot');
      expect(result.tasksArchived).toBe(0);
      expect(result.tasksRemaining).toBe(1);
    });

    it('updates version in hot file', async () => {
      createDAG(tmpDir, [{ id: 'T1', status: 'pending' }], '1.0.0');
      await mgr.createVersionSnapshot('1.0.0', '2.1.0', 'Bump');
      const dag = JSON.parse(readFileSync(join(tmpDir, 'Task.DAG.json'), 'utf8'));
      expect(dag.version).toBe('2.1.0');
    });

    it('writes version snapshot', async () => {
      createDAG(tmpDir, [{ id: 'T1', status: 'pending' }], '3.0.0');
      await mgr.createVersionSnapshot('3.0.0', '4.0.0', 'Major bump');
      expect(existsSync(join(tmpDir, 'Task.DAG.versions/Task.DAG.v3.0.0.json'))).toBe(true);
    });

    it('appends changelog entry', async () => {
      createDAG(tmpDir, [{ id: 'T1', status: 'completed', completed_at: '2026-01-01T00:00:00Z' }]);
      await mgr.createVersionSnapshot('1.0.0', '1.1.0', 'Archived old task');
      const changelog = readFileSync(join(tmpDir, 'Task.DAG.changelog.md'), 'utf8');
      expect(changelog).toContain('v1.1.0');
      expect(changelog).toContain('Archived old task');
    });

    it('preserves task_groups and other metadata', async () => {
      const dag = {
        version: '1.0.0',
        tasks: [{ id: 'T1', status: 'pending' }],
        task_groups: [{ name: 'Group 1', tasks: ['T1'] }],
        feature: 'test-feature',
      };
      writeFileSync(join(tmpDir, 'Task.DAG.json'), JSON.stringify(dag, null, 2));
      await mgr.createVersionSnapshot('1.0.0', '1.0.1', 'Snapshot');
      const hot = JSON.parse(readFileSync(join(tmpDir, 'Task.DAG.json'), 'utf8'));
      expect(hot.task_groups).toBeDefined();
      expect(hot.feature).toBe('test-feature');
    });
  });

  // ─── DAG_CONFIG ───
  describe('DAG_CONFIG', () => {
    it('has RECENT_DAYS=14 and MIN_RECENT_TASKS=10', () => {
      expect(DAG_CONFIG.RECENT_DAYS).toBe(14);
      expect(DAG_CONFIG.MIN_RECENT_TASKS).toBe(10);
    });
  });
});
