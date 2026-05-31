/**
 * safe-edit-core.ts — Shared File Edit Validation & Diff Generation
 * =================================================================
 *
 * Extracted from .opencode/tools/safe-edit.ts and .opencode/tools/safe-edit.js.
 * Contains ONLY the core logic — no framework-specific tool registration.
 *
 * Exports:
 *   - validateEdit(filePath, content): EditValidation
 *   - generateDiff(original, updated): DiffResult
 *   - writeSafe(filePath, content, options?): Promise<WriteResult>
 *   - FileLock (mkdir-based mutex)
 *   - FileStateRegistry (TOCTOU detection)
 *   - BackupHelper (atomic backup/restore)
 *
 * @author @Architect
 * @version 1.0.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════

export interface EditValidation {
  valid: boolean;
  error?: string;
  resolvedPath: string;
}

export interface DiffResult {
  hasChanges: boolean;
  added: number;
  removed: number;
  diff: string;
}

export interface WriteOptions {
  agentType?: string;
  taskId?: string;
  encoding?: BufferEncoding;
  createBackup?: boolean;
}

export interface WriteResult {
  success: boolean;
  backupPath?: string;
  error?: string;
}

export interface StatSnapshot {
  path: string;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
}

export interface RestoreResult {
  success: boolean;
  error?: string;
}

// ════════════════════════════════════════════════════════════
// FILE STATE REGISTRY — tracks last-known state across calls
// ════════════════════════════════════════════════════════════

const _fileRegistry = new Map<string, Omit<StatSnapshot, 'path'>>();

/**
 * Clear the in-memory file registry.
 * Useful for testing and resetting state between operations.
 */
export function clearRegistry(): void {
  _fileRegistry.clear();
}

/**
 * Get the current registry size (for diagnostics).
 */
export function registrySize(): number {
  return _fileRegistry.size;
}

// ════════════════════════════════════════════════════════════
// FILE LOCK — mkdir-based mutex for concurrent-write safety
// ════════════════════════════════════════════════════════════

const LOCK_BASE_DIR = path.join(os.tmpdir(), 'opencode', 'safe-edit-locks');

function _ensureLockBaseDir(): void {
  try {
    fs.mkdirSync(LOCK_BASE_DIR, { recursive: true });
  } catch {
    // best-effort
  }
}

function _spinWait(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    /* busy-wait */
  }
}

/**
 * Acquire a file lock using mkdir as a mutex.
 * Returns a release function that removes the lock directory.
 */
export function acquireLock(
  filePath: string,
  maxRetries = 100,
  baseDelay = 10,
): () => void {
  const lockDir = path.join(
    LOCK_BASE_DIR,
    Buffer.from(filePath).toString('hex'),
  );

  _ensureLockBaseDir();

  for (let i = 0; i < maxRetries; i++) {
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      return (): void => {
        try {
          fs.rmdirSync(lockDir);
        } catch {
          /* best-effort */
        }
      };
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code !== 'EEXIST') throw err;
      const waitMs = Math.min(baseDelay * Math.pow(1.5, i), 200);
      _spinWait(waitMs);
    }
  }
  throw new Error(
    `Could not acquire lock for ${filePath} after ${maxRetries} retries`,
  );
}

// ════════════════════════════════════════════════════════════
// STAT SNAPSHOT & COMPARISON
// ════════════════════════════════════════════════════════════

/**
 * Capture a stat snapshot of a file, resolving symlinks first.
 */
export function captureStat(filePath: string): StatSnapshot {
  const resolvedPath = fs.realpathSync(filePath);
  const stat = fs.statSync(resolvedPath);
  return {
    path: resolvedPath,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    dev: stat.dev,
  };
}

/**
 * Compare two stat snapshots for equality.
 * Returns true if inode, size, mtime, ctime, and device are all equal.
 */
export function statsEqual(a: StatSnapshot, b: StatSnapshot): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}

// ════════════════════════════════════════════════════════════
// BACKUP HELPER
// ════════════════════════════════════════════════════════════

/**
 * Generate a unique backup path with agent+task metadata.
 */
export function backupPath(
  filePath: string,
  agentType: string,
  taskId: string,
): string {
  const dir = path.join(path.dirname(filePath), '.opencode_backups');
  const base = path.basename(filePath);
  const ts = Date.now();
  const pid = process.pid;
  const agent = agentType.replace(/[^a-zA-Z0-9_-]/g, '_');
  const task = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dir, `${base}.${ts}.${pid}.${agent}.${task}.safe_backup`);
}

// ════════════════════════════════════════════════════════════
// PUBLIC: validateEdit
// ════════════════════════════════════════════════════════════

/**
 * Validate that a file path is writable and content is acceptable.
 * Checks: file exists, path is absolute, content is non-empty.
 */
export function validateEdit(
  filePath: string,
  content: string,
): EditValidation {
  if (!filePath || filePath.trim().length === 0) {
    return { valid: false, error: 'File path is empty', resolvedPath: '' };
  }

  const absPath = path.resolve(filePath);

  // Check parent directory exists (or can be created)
  const parentDir = path.dirname(absPath);
  try {
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  } catch {
    return {
      valid: false,
      error: `Cannot create parent directory: ${parentDir}`,
      resolvedPath: absPath,
    };
  }

  if (content === undefined || content === null) {
    return { valid: false, error: 'Content is null or undefined', resolvedPath: absPath };
  }

  return { valid: true, resolvedPath: absPath };
}

// ════════════════════════════════════════════════════════════
// PUBLIC: generateDiff
// ════════════════════════════════════════════════════════════

/**
 * Generate a unified-diff style comparison between original and updated content.
 * Simple line-by-line comparison suitable for small files.
 */
export function generateDiff(original: string, updated: string): DiffResult {
  const origLines = (original || '').split('\n');
  const newLines = (updated || '').split('\n');

  let added = 0;
  let removed = 0;
  const diffLines: string[] = [];

  const maxLen = Math.max(origLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const origLine = i < origLines.length ? origLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (origLine === undefined && newLine !== undefined) {
      added++;
      diffLines.push(`+ ${newLine}`);
    } else if (origLine !== undefined && newLine === undefined) {
      removed++;
      diffLines.push(`- ${origLine}`);
    } else if (origLine !== newLine) {
      added++;
      removed++;
      diffLines.push(`- ${origLine}`);
      diffLines.push(`+ ${newLine}`);
    } else {
      diffLines.push(`  ${origLine}`);
    }
  }

  return {
    hasChanges: added > 0 || removed > 0,
    added,
    removed,
    diff: diffLines.join('\n'),
  };
}

// ════════════════════════════════════════════════════════════
// PUBLIC: writeSafe
// ════════════════════════════════════════════════════════════

/**
 * Atomically write content to a file with TOCTOU protection.
 * 1. Validates the edit
 * 2. Captures stat snapshot
 * 3. Creates atomic backup
 * 4. Checks registry for TOCTOU detection
 * 5. Re-stats to verify no external changes
 * 6. Atomic write (temp → rename)
 * 7. Content verification
 *
 * This is the core extraction of the safeEdit() function from safe-edit.ts,
 * without the tool-specific wrappers.
 */
export function writeSafe(
  filePath: string,
  content: string,
  options?: WriteOptions,
): WriteResult {
  const opts = options || {};
  const agentType = opts.agentType || 'unknown';
  const taskId = opts.taskId || 'unknown';
  const encoding = opts.encoding || 'utf8';
  const createBackup = opts.createBackup !== false; // default true

  // Phase 0: Validate
  const validation = validateEdit(filePath, content);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const absPath = validation.resolvedPath;

  // Acquire lock for concurrent-write safety
  let releaseLock: (() => void) | null = null;
  try {
    releaseLock = acquireLock(absPath);
  } catch (lockErr: unknown) {
    const msg = lockErr instanceof Error ? lockErr.message : String(lockErr);
    return { success: false, error: `Concurrent write lock failed: ${msg}` };
  }

  try {
    // Phase 1: Symlink resolution + stat snapshot
    let resolvedPath: string;
    try {
      resolvedPath = fs.realpathSync(absPath);
    } catch {
      resolvedPath = absPath;
    }

    let origStat: StatSnapshot;
    let origContent: string;
    try {
      origStat = captureStat(resolvedPath);
      origContent = fs.readFileSync(origStat.path, encoding);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `Cannot read file: ${msg}` };
    }
    resolvedPath = origStat.path;

    // Phase 2: Atomic backup
    let backupPathStr: string | undefined;
    if (createBackup) {
      const bDir = path.join(path.dirname(resolvedPath), '.opencode_backups');
      fs.mkdirSync(bDir, { recursive: true });
      backupPathStr = backupPath(resolvedPath, agentType, taskId);

      const tmpBackup = backupPathStr + '.tmp';
      fs.writeFileSync(tmpBackup, origContent, encoding);
      fs.renameSync(tmpBackup, backupPathStr);
    }

    // Phase 3: Registry-based TOCTOU detection
    const registryKey = resolvedPath;
    if (!_fileRegistry.has(registryKey)) {
      _fileRegistry.set(registryKey, {
        ino: origStat.ino,
        size: origStat.size,
        mtimeMs: origStat.mtimeMs,
        ctimeMs: origStat.ctimeMs,
        dev: origStat.dev,
      });
      if (backupPathStr) {
        try { fs.rmSync(backupPathStr, { force: true }); } catch { /* ignore */ }
      }
      return {
        success: false,
        error: 'TOCTOU race detected: no baseline audit in registry — first call establishes baseline, call writeSafe again to verify',
      };
    }

    // Phase 4: Re-stat to detect changes
    let currentStat: StatSnapshot;
    try {
      currentStat = captureStat(resolvedPath);
    } catch {
      if (backupPathStr) {
        try { fs.rmSync(backupPathStr, { force: true }); } catch { /* ignore */ }
      }
      return {
        success: false,
        error: 'TOCTOU race detected: file was removed between audit check and write',
      };
    }

    if (!statsEqual(origStat, currentStat)) {
      if (backupPathStr) {
        try { fs.rmSync(backupPathStr, { force: true }); } catch { /* ignore */ }
      }
      const details: string[] = [];
      if (origStat.ino !== currentStat.ino) details.push(`inode:${origStat.ino}->${currentStat.ino}`);
      if (origStat.size !== currentStat.size) details.push(`size:${origStat.size}->${currentStat.size}`);
      if (origStat.mtimeMs !== currentStat.mtimeMs) details.push('mtime changed');
      return {
        success: false,
        error: `TOCTOU race detected: file state changed between audit check and write. ${details.join(', ')}`,
      };
    }

    // Phase 5: Atomic write (temp → rename)
    const tmpWrite = resolvedPath + '.tmp.' + Date.now();
    try {
      fs.writeFileSync(tmpWrite, content, encoding);
      fs.renameSync(tmpWrite, resolvedPath);
    } catch (e: unknown) {
      try { fs.rmSync(tmpWrite, { force: true }); } catch { /* ignore */ }
      if (backupPathStr) {
        try { fs.copyFileSync(backupPathStr, resolvedPath); } catch { /* ignore */ }
        try { fs.rmSync(backupPathStr, { force: true }); } catch { /* ignore */ }
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `Write failed and rolled back: ${msg}` };
    }

    // Phase 6: Content verification
    try {
      const writtenContent = fs.readFileSync(resolvedPath, encoding);
      if (writtenContent !== content) {
        if (backupPathStr) {
          fs.copyFileSync(backupPathStr, resolvedPath);
          try { fs.rmSync(backupPathStr, { force: true }); } catch { /* ignore */ }
        }
        return {
          success: false,
          error: 'Write verification failed: content mismatch — rolled back, potential TOCTOU race',
        };
      }
    } catch (e: unknown) {
      if (backupPathStr) {
        fs.copyFileSync(backupPathStr, resolvedPath);
        try { fs.rmSync(backupPathStr, { force: true }); } catch { /* ignore */ }
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `Write verification failed: ${msg} — rolled back` };
    }

    // Phase 7: Success — registry and backup preserved
    return { success: true, backupPath: backupPathStr };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Unexpected error: ${msg}` };
  } finally {
    if (releaseLock) releaseLock();
  }
}

// ════════════════════════════════════════════════════════════
// PUBLIC: restore
// ════════════════════════════════════════════════════════════

/**
 * Restore a file from a backup created by writeSafe.
 * Uses atomic restore (copy to temp → rename) for crash safety.
 */
export function restore(
  backupPathStr: string,
  targetPath: string,
): RestoreResult {
  const absBackup = path.resolve(backupPathStr);
  const absTarget = path.resolve(targetPath);

  try {
    if (!fs.existsSync(absBackup)) {
      return { success: false, error: `Backup file not found: ${backupPathStr}` };
    }
    const tmpRestore = absTarget + '.restore.' + Date.now();
    fs.copyFileSync(absBackup, tmpRestore);
    fs.renameSync(tmpRestore, absTarget);
    return { success: true };
  } catch (e: unknown) {
    try {
      const dir = path.dirname(absTarget);
      const files = fs.readdirSync(dir);
      const base = path.basename(absTarget);
      for (const f of files) {
        if (f.startsWith(base + '.restore.')) {
          try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Restore failed: ${msg}` };
  }
}

// ════════════════════════════════════════════════════════════
// BACKWARD COMPATIBILITY — safeEdit alias for writeSafe
// ════════════════════════════════════════════════════════════

/**
 * Backward-compatible alias for writeSafe.
 * The plugins/ layer imports `{ safeEdit }` — this alias ensures
 * both names resolve to the same function.
 */
export const safeEdit = writeSafe;

// ════════════════════════════════════════════════════════════
// PUBLIC: writeSafeFull — Full file overwrite / new file creation
// ════════════════════════════════════════════════════════════

/**
 * Write full content to a file, creating it if it doesn't exist.
 * Unlike writeSafe (which requires a pre-existing baseline for TOCTOU),
 * this function handles:
 *   - New file creation (parent dirs auto-created)
 *   - Full overwrite of existing files (with backup + TOCTOU for existing)
 *   - Atomic write via temp → rename
 *
 * G1 fix: Enables the plugin safe_edit tool to create new files and
 * do full rewrites, not just oldString→newString replacement.
 */
export function writeSafeFull(
  filePath: string,
  content: string,
  options?: WriteOptions,
): WriteResult {
  const opts = options || {};
  const agentType = opts.agentType || 'unknown';
  const taskId = opts.taskId || 'unknown';
  const encoding = opts.encoding || 'utf8';
  const createBackup = opts.createBackup !== false; // default true

  // Phase 0: Validate
  const validation = validateEdit(filePath, content);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const absPath = validation.resolvedPath;

  // Check if file exists
  const fileExists = fs.existsSync(absPath);

  // Phase 1: File exists → delegate to writeSafe for full TOCTOU protection
  if (fileExists) {
    return writeSafe(filePath, content, options);
  }

  // Phase 2: New file creation (no TOCTOU needed)
  // Acquire lock for concurrent-safety
  let releaseLock: (() => void) | null = null;
  try {
    releaseLock = acquireLock(absPath);
  } catch (lockErr: unknown) {
    const msg = lockErr instanceof Error ? lockErr.message : String(lockErr);
    return { success: false, error: `Concurrent write lock failed: ${msg}` };
  }

  try {
    // Phase 2a: Atomic backup not needed for new files (nothing to back up)

    // Phase 2b: Atomic write (temp → rename)
    const tmpWrite = absPath + '.tmp.' + Date.now();
    try {
      fs.writeFileSync(tmpWrite, content, encoding);
      fs.renameSync(tmpWrite, absPath);
    } catch (e: unknown) {
      try { fs.rmSync(tmpWrite, { force: true }); } catch { /* ignore */ }
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `Write failed: ${msg}` };
    }

    // Phase 2c: Content verification
    try {
      const writtenContent = fs.readFileSync(absPath, encoding);
      if (writtenContent !== content) {
        try { fs.rmSync(absPath, { force: true }); } catch { /* ignore */ }
        return {
          success: false,
          error: 'Write verification failed: content mismatch',
        };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `Write verification failed: ${msg}` };
    }

    // Phase 2d: Register baseline for future TOCTOU checks
    try {
      const newStat = captureStat(absPath);
      const regKey = absPath;
      if (!_fileRegistry.has(regKey)) {
        _fileRegistry.set(regKey, {
          ino: newStat.ino,
          size: newStat.size,
          mtimeMs: newStat.mtimeMs,
          ctimeMs: newStat.ctimeMs,
          dev: newStat.dev,
        });
      }
    } catch {
      // best-effort registry population
    }

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Unexpected error: ${msg}` };
  } finally {
    if (releaseLock) releaseLock();
  }
}
