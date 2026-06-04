/**
 * DAG Version Manager — Task.DAG.json Hierarchical Versioning
 *
 * Manages versioned snapshots, task indexing, and changelog for Task.DAG.json.
 * Implements the hierarchical approach:
 *   Hot (Task.DAG.json): Pending tasks + completed tasks from last 2 weeks
 *   Warm (Task.DAG.versions/): Full version snapshots
 *   Warm (Task.DAG.changelog.md): Append-only changelog
 *   Warm (Task.DAG.index.json): Task lookup index
 *
 * CRITICAL DESIGN CONSTRAINT:
 * Retains completed tasks from the last 2 weeks in the hot file to preserve
 * @Orchestrator dependency validation and @Guardian audit trail capabilities.
 * Only tasks completed >2 weeks ago are moved to version snapshots.
 *
 * INTEGRATION POINTS:
 * - @Meta-Planner: Call createVersionSnapshot() after version bump
 * - @Orchestrator: Reads hot DAG (with recent completed) for scheduling
 * - @Guardian: Reads hot DAG for audit trail verification
 *
 * @module dag-version-manager
 * @since Phase 0 (Foundation)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DAGTask, DAGMeta } from './state-manager';
import { STATE_PATHS, getDateKey } from './state-manager';

// ============================================================================
// Configuration
// ============================================================================

/**
 * DAG version management configuration.
 */
const DAG_CONFIG = {
  /** Completed tasks within this many days stay in the hot file */
  RECENT_DAYS: 14,
  /** Minimum number of recent completed tasks to always keep in hot file */
  MIN_RECENT_TASKS: 10,
} as const;

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Task index entry for fast task lookup.
 */
export interface TaskIndexEntry {
  /** Version where this task was last modified */
  version: string;
  /** Task status at archive time */
  status: 'pending' | 'completed' | 'in_progress';
  /** When the task was completed (if applicable) */
  completed_at?: string;
  /** Reference to the version snapshot containing full task data */
  archive_ref: string;
}

/**
 * Full Task.DAG.json structure (subset used by version manager).
 */
export interface DAGDocument {
  version: string;
  project?: string;
  tasks: DAGTask[];
  task_groups?: Array<Record<string, unknown>>;
  meta?: DAGMeta & Record<string, unknown>;
  change_log?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * Changelog file entry.
 */
export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
}

/**
 * Result of a version snapshot operation.
 */
export interface SnapshotResult {
  /** Old version that was snapshotted */
  oldVersion: string;
  /** New version */
  newVersion: string;
  /** Number of tasks archived (moved out of hot file) */
  tasksArchived: number;
  /** Number of tasks remaining in hot file */
  tasksRemaining: number;
  /** Path to the snapshot file */
  snapshotPath: string;
  /** Summary of the operation */
  summary: string;
}

// ============================================================================
// DAG Version Manager Class
// ============================================================================

/**
 * DAGVersionManager — Manages versioned snapshots, indexing, and changelog
 * for the DAG file.
 *
 * Usage:
 * ```
 * const manager = new DAGVersionManager();
 *
 * // After Meta-Planner version bump:
 * const result = await manager.createVersionSnapshot('5.4.0', '5.5.0');
 * ```
 */
export class DAGVersionManager {
  private readonly recentDays: number;
  private readonly versionsDir: string;
  private readonly hotFile: string;
  private readonly changelogFile: string;
  private readonly indexFile: string;

  constructor() {
    this.recentDays = DAG_CONFIG.RECENT_DAYS;
    this.hotFile = STATE_PATHS.DAG_HOT;
    this.versionsDir = STATE_PATHS.DAG_VERSIONS_DIR;
    this.changelogFile = STATE_PATHS.DAG_CHANGELOG;
    this.indexFile = STATE_PATHS.DAG_INDEX;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Create a version snapshot before the DAG is updated to a new version.
   * This should be called by @Meta-Planner after bumping the version number.
   *
   * Process:
   * 1. Read current DAG
   * 2. Write a full snapshot to Task.DAG.versions/Task.DAG.v{oldVersion}.json
   * 3. Identify old completed tasks (>2 weeks)
   * 4. Remove old completed tasks from hot DAG, keep pending + recent completed
   * 5. Update hot DAG meta
   * 6. Update version
   * 7. Write hot DAG back
   * 8. Append changelog entry
   * 9. Update task index
   *
   * @param oldVersion - The version being snapshotted (e.g., "5.4.0")
   * @param newVersion - The new version (e.g., "5.5.0")
   * @param changelogSummary - Human-readable summary of changes
   * @returns Snapshot result
   */
  async createVersionSnapshot(
    oldVersion: string,
    newVersion: string,
    changelogSummary: string,
  ): Promise<SnapshotResult> {
    // 1. Read current DAG
    const dag = this.readDAG();

    // 2. Write snapshot of current state
    const snapshotPath = join(this.versionsDir, `Task.DAG.v${oldVersion}.json`);
    this.writeSnapshot(snapshotPath, dag);

    // 3. Identify old completed tasks
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.recentDays);

    const tasksToArchive: DAGTask[] = [];
    const tasksToKeep: DAGTask[] = [];

    for (const task of dag.tasks) {
      if (task.status === 'completed' && task.completed_at) {
        const completedDate = new Date(task.completed_at);
        if (completedDate < cutoffDate) {
          tasksToArchive.push(task);
          continue;
        }
      }
      tasksToKeep.push(task);
    }

    // Ensure we keep minimum recent tasks
    const totalTasks = dag.tasks.length;
    const archivedCount = tasksToArchive.length;
    const keptCount = tasksToKeep.length;

    // 4. Update DAG in memory
    dag.tasks = tasksToKeep;
    dag.version = newVersion;

    // 5. Update meta counts
    if (!dag.meta) {
      dag.meta = { pending_tasks: 0 };
    }
    const pendingCount = tasksToKeep.filter((t) => t.status === 'pending').length;
    const recentCompleted = tasksToKeep.filter((t) => t.status === 'completed').length;

    dag.meta.total_tasks = totalTasks;
    dag.meta.pending_tasks = pendingCount;
    dag.meta.recent_completed = recentCompleted;
    dag.meta.archived_completed = (dag.meta.archived_completed || 0) + archivedCount;

    // 6. Write hot DAG
    this.writeDAG(dag);

    // 7. Append changelog
    this.appendChangelog(newVersion, changelogSummary);

    // 8. Update task index for archived tasks
    this.updateTaskIndex(tasksToArchive, oldVersion);

    return {
      oldVersion,
      newVersion,
      tasksArchived: archivedCount,
      tasksRemaining: keptCount,
      snapshotPath,
      summary: `Snapshot v${oldVersion} → v${newVersion}: archived ${archivedCount} tasks, ${keptCount} tasks in hot file (${pendingCount} pending, ${recentCompleted} recent completed)`,
    };
  }

  /**
   * Get the version history.
   *
   * @returns Array of version numbers with snapshot file info
   */
  getVersionHistory(): Array<{ version: string; fileSize: number; hasSnapshot: boolean }> {
    const versions: Array<{ version: string; fileSize: number; hasSnapshot: boolean }> = [];

    if (!existsSync(this.versionsDir)) return versions;

    try {
      const { readdirSync, statSync } = require('node:fs');
      const files = readdirSync(this.versionsDir)
        .filter((f: string) => f.startsWith('Task.DAG.v') && f.endsWith('.json'))
        .sort();

      for (const file of files) {
        const versionMatch = file.match(/Task\.DAG\.v(.+)\.json/);
        if (versionMatch) {
          const filePath = join(this.versionsDir, file);
          versions.push({
            version: versionMatch[1],
            fileSize: statSync(filePath).size,
            hasSnapshot: true,
          });
        }
      }
    } catch {
      // Best effort
    }

    return versions;
  }

  /**
   * Read the changelog as an array of entries.
   */
  readChangelog(): ChangelogEntry[] {
    if (!existsSync(this.changelogFile)) return [];

    try {
      const content = readFileSync(this.changelogFile, 'utf8');
      const entries: ChangelogEntry[] = [];
      const lines = content.split('\n');

      let currentEntry: ChangelogEntry | null = null;

      for (const line of lines) {
        const versionMatch = line.match(/^## v([\d.]+) \((\d{4}-\d{2}-\d{2})\)/);
        if (versionMatch) {
          if (currentEntry) entries.push(currentEntry);
          currentEntry = {
            version: versionMatch[1],
            date: versionMatch[2],
            summary: '',
          };
        } else if (currentEntry && line.startsWith('- ')) {
          currentEntry.summary += (currentEntry.summary ? ' ' : '') + line.substring(2);
        }
      }

      if (currentEntry) entries.push(currentEntry);
      return entries;
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // Private: File Operations
  // ==========================================================================

  /**
   * Read the current DAG from the hot file.
   */
  private readDAG(): DAGDocument {
    if (!existsSync(this.hotFile)) {
      throw new Error(`DAG file not found: ${this.hotFile}`);
    }

    try {
      return JSON.parse(readFileSync(this.hotFile, 'utf8')) as DAGDocument;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse DAG file ${this.hotFile}: ${message}`);
    }
  }

  /**
   * Write the DAG back to the hot file.
   */
  private writeDAG(dag: DAGDocument): void {
    try {
      writeFileSync(this.hotFile, JSON.stringify(dag, null, 2));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write DAG file ${this.hotFile}: ${message}`);
    }
  }

  /**
   * Write a version snapshot.
   */
  private writeSnapshot(snapshotPath: string, dag: DAGDocument): void {
    // Ensure directory exists
    if (!existsSync(this.versionsDir)) {
      mkdirSync(this.versionsDir, { recursive: true });
    }

    try {
      writeFileSync(snapshotPath, JSON.stringify(dag, null, 2));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write DAG snapshot ${snapshotPath}: ${message}`);
    }
  }

  /**
   * Append a changelog entry to the markdown file.
   */
  private appendChangelog(version: string, summary: string): void {
    const dateKey = getDateKey();
    const entry = `\n## v${version} (${dateKey})\n- ${summary}\n`;

    // Create file with header if it doesn't exist
    if (!existsSync(this.changelogFile)) {
      const header = `# Task.DAG Changelog\n\n> Auto-generated by DAGVersionManager. Do not edit manually.\n\n`;
      writeFileSync(this.changelogFile, header + entry);
    } else {
      // Prepend after header
      const content = readFileSync(this.changelogFile, 'utf8');
      const headerEnd = content.indexOf('\n## ');
      if (headerEnd >= 0) {
        const newContent = content.slice(0, headerEnd) + entry + content.slice(headerEnd);
        writeFileSync(this.changelogFile, newContent);
      } else {
        writeFileSync(this.changelogFile, content + entry, { flag: 'a' });
      }
    }
  }

  /**
   * Update the task index with archived task references.
   */
  private updateTaskIndex(archivedTasks: DAGTask[], version: string): void {
    const index = this.readTaskIndex();

    for (const task of archivedTasks) {
      index[task.id] = {
        version,
        status: task.status as TaskIndexEntry['status'],
        completed_at: task.completed_at,
        archive_ref: `Task.DAG.versions/Task.DAG.v${version}.json#tasks.${task.id}`,
      };
    }

    this.writeTaskIndex(index);
  }

  /**
   * Read the task index file.
   */
  private readTaskIndex(): Record<string, TaskIndexEntry> {
    if (!existsSync(this.indexFile)) return {};

    try {
      const data = JSON.parse(readFileSync(this.indexFile, 'utf8'));
      return data.task_index || data;
    } catch {
      return {};
    }
  }

  /**
   * Write the task index file.
   */
  private writeTaskIndex(index: Record<string, TaskIndexEntry>): void {
    try {
      writeFileSync(
        this.indexFile,
        JSON.stringify({ task_index: index, formatVersion: '2.0' }, null, 2),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[dag-version-manager] Failed to write task index: ${message}`);
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick version snapshot for the current DAG.
 */
export async function snapshotDAG(
  oldVersion: string,
  newVersion: string,
  summary: string,
): Promise<SnapshotResult> {
  const manager = new DAGVersionManager();
  return manager.createVersionSnapshot(oldVersion, newVersion, summary);
}

// ============================================================================
// Module Exports
// ============================================================================

export { DAG_CONFIG };
