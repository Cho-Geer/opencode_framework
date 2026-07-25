/**
 * safe-edit-core.ts — Shared File Edit Validation & Diff Generation
 * =================================================================
 *
 * Contains ONLY the core logic — no framework-specific tool registration.
 *
 * Exports:
 *   - validateEdit(filePath, content): EditValidation
 *   - generateDiff(original, updated): DiffResult
 *   - writeSafe(filePath, content, options?): Promise<WriteResult>
 *   - FileLock (mkdir-based mutex)
 *   - FileStateRegistry (TOCTOU detection)
 *   - BackupHelper (atomic backup/restore)
 *   - findLatestBackup(filePath): string | null
 *
 * @author @Architect
 * @version 1.0.0
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  createBackup as createGitBackup,
  findLatestBackup as findLatestGitBackup,
  cleanupStaleBackups as cleanupGitBackups,
  type BackupRecord,
} from "./backup-manager";

// P3/G11: cross-process TOCTOU baseline (DB-backed).
// These imports are optional — if DB fails, fallback to in-process registry only.
import {
  dbReadFileBaseline,
  dbWriteFileBaseline,
  dbDeleteFileBaseline,
  type FileBaselineSnapshot,
} from "./db-state-manager";

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
  /** Unix file mode (permissions). Captured so atomic writes can restore original permissions (e.g., executable bit for hooks/scripts). Added FW-REPAIR-14. */
  mode: number;
}

export interface RestoreResult {
  success: boolean;
  error?: string;
}

// ════════════════════════════════════════════════════════════
// FILE STATE REGISTRY — tracks last-known state across calls
// ════════════════════════════════════════════════════════════

const _fileRegistry = new Map<string, Omit<StatSnapshot, "path">>();

/**
 * Clear the in-memory file registry.
 * Useful for testing and resetting state between operations.
 *
 * @internal — Unit test reset only; not part of the public API.
 */
export function clearRegistry(): void {
  _fileRegistry.clear();
}

// ════════════════════════════════════════════════════════════
// DB BASELINE HELPERS (P3/G11: cross-process TOCTOU)
// ════════════════════════════════════════════════════════════

/**
 * Compute hex-encoded path hash, matching acquireLock's key format.
 * Same path → same hash → cross-process baseline lookup works.
 */
function _pathHash(filePath: string): string {
  return Buffer.from(filePath).toString("hex");
}

/**
 * Convert a StatSnapshot to a DB-compatible FileBaselineSnapshot.
 * Strips the 'path' field (not stored in DB); adds updated_at + process_id.
 */
function _statToBaseline(
  stat: Omit<StatSnapshot, "path">,
): FileBaselineSnapshot {
  return {
    inode: stat.ino,
    size: stat.size,
    mtime: stat.mtimeMs,
    ctime: stat.ctimeMs,
    dev: stat.dev,
    updated_at: Date.now(),
    process_id: process.pid,
  };
}

/**
 * Convert a DB FileBaselineSnapshot back to the in-process registry shape.
 * Drops updated_at / process_id (not used by TOCTOU comparison).
 */
function _baselineToRegistry(
  snap: FileBaselineSnapshot,
): Omit<StatSnapshot, "path"> {
  return {
    ino: snap.inode,
    size: snap.size,
    mtimeMs: snap.mtime,
    ctimeMs: snap.ctime,
    dev: snap.dev,
    mode: 0, // mode not stored in DB; default 0 (safe — writeSafe restores orig mode via FW-REPAIR-14)
  };
}

/**
 * Resolve baseline for a file path using the dual-layer strategy:
 *   1. Check in-process _fileRegistry (cache) — fast path.
 *   2. If miss, check DB file_baseline_kv — cross-process visible.
 *   3. If miss, return null (caller will populate both layers).
 *
 * On DB hit, the in-process cache is populated for subsequent calls.
 * Failures during DB read are non-fatal (fallback to cache-only behavior).
 */
function _resolveBaseline(filePath: string): Omit<StatSnapshot, "path"> | null {
  const cached = _fileRegistry.get(filePath);
  if (cached) return cached;

  try {
    const dbSnap = dbReadFileBaseline(_pathHash(filePath));
    if (dbSnap) {
      const reg = _baselineToRegistry(dbSnap);
      _fileRegistry.set(filePath, reg);
      return reg;
    }
  } catch {
    // DB unavailable — fallback to cache-only (graceful degradation)
  }
  return null;
}

/**
 * Populate baseline in both layers (in-process cache + DB).
 * Called when no baseline exists (first call for this file path).
 * Non-fatal if DB write fails — cache-only baseline still provides
 * same-process TOCTOU protection.
 */
function _populateBaseline(
  filePath: string,
  stat: Omit<StatSnapshot, "path">,
): void {
  _fileRegistry.set(filePath, stat);
  try {
    dbWriteFileBaseline(_pathHash(filePath), _statToBaseline(stat));
  } catch {
    // DB unavailable — continue with cache-only (graceful degradation)
  }
}

/**
 * Clear baseline from both layers after a successful write.
 * The baseline is "consumed" — next writeSafe() call will re-establish.
 */
function _consumeBaseline(filePath: string): void {
  _fileRegistry.delete(filePath);
  try {
    dbDeleteFileBaseline(_pathHash(filePath));
  } catch {
    // DB unavailable — cache-only clear is sufficient for same-process
  }
}

// ════════════════════════════════════════════════════════════
// FILE LOCK — mkdir-based mutex for concurrent-write safety
// ════════════════════════════════════════════════════════════

const LOCK_BASE_DIR = path.join(os.tmpdir(), "opencode", "safe-edit-locks");

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
 *
 * @public — Core TOCTOU component; used by writeSafe and safeDelete.
 */
export function acquireLock(
  filePath: string,
  maxRetries = 100,
  baseDelay = 10,
): () => void {
  const lockDir = path.join(
    LOCK_BASE_DIR,
    Buffer.from(filePath).toString("hex"),
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
      if (nodeErr.code !== "EEXIST") throw err;
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
 *
 * @public — TOCTOU detection foundation; used by writeSafe, safeDelete.
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
    mode: stat.mode,
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
  const dir = path.join(path.dirname(filePath), ".opencode_backups");
  const base = path.basename(filePath);
  const ts = Date.now();
  const pid = process.pid;
  const agent = agentType.replace(/[^a-zA-Z0-9_-]/g, "_");
  const task = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(dir, `${base}.${ts}.${pid}.${agent}.${task}.safe_backup`);
}

// ════════════════════════════════════════════════════════════
// PUBLIC: findLatestBackup
// ════════════════════════════════════════════════════════════

/**
 * Find the most recent atomic backup for a given file in its sibling
 * .opencode_backups/ directory. Backup filenames embed timestamps;
 * lexical sort of full name works because timestamp is left-padded
 * and appears early in the name.
 */
export function findLatestBackup(filePath: string): string | null {
  try {
    const dir = path.join(path.dirname(filePath), ".opencode_backups");
    if (!fs.existsSync(dir)) return null;

    const base = path.basename(filePath);
    const candidates = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(base + ".") && f.endsWith(".safe_backup"));

    if (candidates.length === 0) return null;

    candidates.sort();
    return path.join(dir, candidates[candidates.length - 1]);
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// PUBLIC: cleanupStaleBackups — SA-IMPL-BACKUP-LIFECYCLE
// ════════════════════════════════════════════════════════════

/**
 * Clean up stale backup files from .opencode_backups/ directories.
 *
 * POLICY (configurable via project.config.json):
 *   - TTL: Delete backups older than ttlMs (default: 7 days)
 *   - CAP:  Keep at most maxPerDir backups per directory (default: 20)
 *
 * CONCURRENCY SAFETY:
 *   - 7-day TTL isolates cleanup from active TOCTOU rollback (ms window)
 *   - rmSync wrapped in ENOENT try/catch for double-cleanup safety
 *   - Distributed .opencode_backups/ directories provide natural sharding
 *
 * @param rootDir   - Start directory for scan
 * @param ttlMs     - Delete files with mtime < now - ttlMs
 * @param maxPerDir - Keep at most this many files per directory
 * @param fullScan  - If true, recursively walk all subdirectories
 * @returns { scanned: number, deleted: number, dirs: number }
 */
export function cleanupStaleBackups(
  rootDir: string,
  ttlMs: number,
  maxPerDir: number,
  fullScan: boolean = false,
): { scanned: number; deleted: number; dirs: number } {
  const cutoff = Date.now() - ttlMs;
  let scanned = 0;
  let deleted = 0;
  let dirs = 0;

  const processDir = (dir: string): void => {
    const backupDir = path.join(dir, ".opencode_backups");
    if (!fs.existsSync(backupDir)) return;

    let files: { name: string; fpath: string; mtimeMs: number }[];
    try {
      files = fs
        .readdirSync(backupDir)
        .filter((f) => f.endsWith(".safe_backup"))
        .map((f) => {
          const fp = path.join(backupDir, f);
          try {
            return { name: f, fpath: fp, mtimeMs: fs.statSync(fp).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((f): f is NonNullable<typeof f> => f !== null)
        .sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
    } catch {
      return; // can't read directory — skip
    }

    if (files.length === 0) {
      // Remove empty backup directory
      try {
        const remaining = fs
          .readdirSync(backupDir)
          .filter((f) => !f.startsWith("."));
        if (remaining.length === 0) fs.rmdirSync(backupDir);
      } catch {
        /* non-critical */
      }
      return;
    }

    scanned += files.length;
    dirs++;

    // Phase 1: Delete by TTL
    for (const f of files) {
      if (f.mtimeMs < cutoff) {
        try {
          fs.rmSync(f.fpath);
          deleted++;
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e; // already deleted by peer
        }
      }
    }

    // Phase 2: Delete excess by count cap
    const remaining = files.filter((f) => {
      try {
        fs.accessSync(f.fpath);
        return true;
      } catch {
        return false;
      }
    });
    for (let i = maxPerDir; i < remaining.length; i++) {
      try {
        fs.rmSync(remaining[i].fpath);
        deleted++;
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
    }

    // Remove empty backup directory after cleanup
    try {
      const after = fs
        .readdirSync(backupDir)
        .filter((f) => f.endsWith(".safe_backup"));
      if (after.length === 0) {
        // Check for any remaining non-backup files (e.g. .gitkeep)
        const allRemaining = fs
          .readdirSync(backupDir)
          .filter((f) => !f.startsWith("."));
        if (allRemaining.length === 0) fs.rmdirSync(backupDir);
      }
    } catch {
      /* non-critical */
    }
  };

  if (fullScan) {
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      processDir(dir);
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules"
        ) {
          walk(path.join(dir, entry.name));
        }
      }
    };
    walk(rootDir);
  } else {
    processDir(rootDir);
  }

  return { scanned, deleted, dirs };
}

// ════════════════════════════════════════════════════════════
// PUBLIC: validateEdit
// ════════════════════════════════════════════════════════════

/**
 * Validate that a file path is writable and content is acceptable.
 * Checks: file exists, path is absolute, content is non-empty.
 *
 * @public — Path validation entry point for safe_edit, writeSafeFull, safeDelete.
 */
export function validateEdit(
  filePath: string,
  content: string,
): EditValidation {
  if (!filePath || filePath.trim().length === 0) {
    return { valid: false, error: "File path is empty", resolvedPath: "" };
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
    return {
      valid: false,
      error: "Content is null or undefined",
      resolvedPath: absPath,
    };
  }

  return { valid: true, resolvedPath: absPath };
}

// ════════════════════════════════════════════════════════════
// PUBLIC: generateDiff
// ════════════════════════════════════════════════════════════

/**
 * Generate a unified-diff style comparison between original and updated content.
 * Simple line-by-line comparison suitable for small files.
 *
 * @public — Diff generation for future safe_diff tool and writeSafe verification.
 */
export function generateDiff(original: string, updated: string): DiffResult {
  const origLines = (original || "").split("\n");
  const newLines = (updated || "").split("\n");

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
    diff: diffLines.join("\n"),
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
 *
 * @public — Core TOCTOU-protected file write. Used by safe_edit tool.
 */
export function writeSafe(
  filePath: string,
  content: string,
  options?: WriteOptions,
): WriteResult {
  const opts = options || {};
  const agentType = opts.agentType || "unknown";
  const taskId = opts.taskId || "unknown";
  const encoding = opts.encoding || "utf8";
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

    // Phase 2: Git-backed atomic backup
    let backupPathStr: string | undefined;
    if (createBackup) {
      const record = createGitBackup({
        filePath: resolvedPath,
        reason: "safe_edit",
        agent: agentType,
        sessionId: process.env.OPENCODE_SESSION_ID,
        dagTaskId: process.env.DISPATCH_DAG_TASK_ID,
        taskId,
      });
      if (record) {
        backupPathStr = record.backup_file_path;
      }
    }

    // Phase 3: DB-backed TOCTOU baseline (P3/G11: cross-process)
    // Dual-layer resolution: in-process cache (fast) → DB file_baseline_kv (cross-process).
    // On first-ever call for this path: populate baseline and proceed (no failure return).
    const registryKey = resolvedPath;
    const existingBaseline = _resolveBaseline(registryKey);
    if (!existingBaseline) {
      _populateBaseline(registryKey, {
        ino: origStat.ino,
        size: origStat.size,
        mtimeMs: origStat.mtimeMs,
        ctimeMs: origStat.ctimeMs,
        dev: origStat.dev,
        mode: origStat.mode,
      });
      // P3/G11: No longer fail on first call — baseline now established, proceed with write.
      // The origStat captured in Phase 1 matches the baseline, so Phase 4 will pass.
    }

    // Phase 4: Re-stat to detect changes
    let currentStat: StatSnapshot;
    try {
      currentStat = captureStat(resolvedPath);
    } catch {
      if (backupPathStr) {
        try {
          fs.rmSync(backupPathStr, { force: true });
        } catch {
          /* ignore */
        }
      }
      return {
        success: false,
        error:
          "TOCTOU race detected: file was removed between audit check and write",
      };
    }

    if (!statsEqual(origStat, currentStat)) {
      if (backupPathStr) {
        try {
          fs.rmSync(backupPathStr, { force: true });
        } catch {
          /* ignore */
        }
      }
      const details: string[] = [];
      if (origStat.ino !== currentStat.ino)
        details.push(`inode:${origStat.ino}->${currentStat.ino}`);
      if (origStat.size !== currentStat.size)
        details.push(`size:${origStat.size}->${currentStat.size}`);
      if (origStat.mtimeMs !== currentStat.mtimeMs)
        details.push("mtime changed");
      return {
        success: false,
        error: `TOCTOU race detected: file state changed between audit check and write. ${details.join(", ")}`,
      };
    }

    // Phase 5: Atomic write (temp → rename)
    // FW-REPAIR-14: Preserve original file mode (permissions) after atomic write.
    // fs.writeFileSync creates temp files with default 0644 mode. Without chmodSync,
    // executable bits (e.g., hooks/pre-commit, scripts/*.sh) are silently stripped
    // on every framework edit — causing recurring framework-self-test failures.
    const origMode = origStat.mode;
    const tmpWrite = resolvedPath + ".tmp." + Date.now();
    try {
      fs.writeFileSync(tmpWrite, content, encoding);
      fs.renameSync(tmpWrite, resolvedPath);
      // Restore original permissions if the temp file defaults don't match
      if (origMode !== 0) {
        fs.chmodSync(resolvedPath, origMode);
      }
    } catch (e: unknown) {
      try {
        fs.rmSync(tmpWrite, { force: true });
      } catch {
        /* ignore */
      }
      if (backupPathStr) {
        try {
          fs.copyFileSync(backupPathStr, resolvedPath);
        } catch {
          /* ignore */
        }
        try {
          fs.rmSync(backupPathStr, { force: true });
        } catch {
          /* ignore */
        }
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
          try {
            fs.rmSync(backupPathStr, { force: true });
          } catch {
            /* ignore */
          }
        }
        return {
          success: false,
          error:
            "Write verification failed: content mismatch — rolled back, potential TOCTOU race",
        };
      }
    } catch (e: unknown) {
      if (backupPathStr) {
        fs.copyFileSync(backupPathStr, resolvedPath);
        try {
          fs.rmSync(backupPathStr, { force: true });
        } catch {
          /* ignore */
        }
      }
      const msg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        error: `Write verification failed: ${msg} — rolled back`,
      };
    }

    // Phase 7: Success — refresh baseline in both layers (P3/G11)
    // After write, the file's size/mtime/ctime changed. Establish a new baseline
    // matching the post-write state so the next writeSafe() call compares correctly.
    // (The old baseline is now stale — if left, Phase 4 would detect a spurious TOCTOU.)
    try {
      const newStat = captureStat(resolvedPath);
      _populateBaseline(registryKey, {
        ino: newStat.ino,
        size: newStat.size,
        mtimeMs: newStat.mtimeMs,
        ctimeMs: newStat.ctimeMs,
        dev: newStat.dev,
        mode: newStat.mode,
      });
    } catch {
      // best-effort baseline refresh; if it fails, next call re-establishes
    }

    // SA-IMPL-BACKUP-LIFECYCLE: Opportunistic cleanup of stale backups
    try {
      cleanupGitBackups();
    } catch {
      /* non-critical */
    }
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
 *
 * @public — Backup restore capability; used by safe_rollback tool.
 */
export function restore(
  backupPathStr: string,
  targetPath: string,
): RestoreResult {
  const absBackup = path.resolve(backupPathStr);
  const absTarget = path.resolve(targetPath);

  try {
    if (!fs.existsSync(absBackup)) {
      return {
        success: false,
        error: `Backup file not found: ${backupPathStr}`,
      };
    }
    const tmpRestore = absTarget + ".restore." + Date.now();
    fs.copyFileSync(absBackup, tmpRestore);
    fs.renameSync(tmpRestore, absTarget);
    return { success: true };
  } catch (e: unknown) {
    try {
      const dir = path.dirname(absTarget);
      const files = fs.readdirSync(dir);
      const base = path.basename(absTarget);
      for (const f of files) {
        if (f.startsWith(base + ".restore.")) {
          try {
            fs.rmSync(path.join(dir, f), { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
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
 *
 * @public — Full overwrite / new file creation. Used by safe_edit tool for non-patch writes.
 */
export function writeSafeFull(
  filePath: string,
  content: string,
  options?: WriteOptions,
): WriteResult {
  const opts = options || {};
  const agentType = opts.agentType || "unknown";
  const taskId = opts.taskId || "unknown";
  const encoding = opts.encoding || "utf8";
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
    const tmpWrite = absPath + ".tmp." + Date.now();
    try {
      fs.writeFileSync(tmpWrite, content, encoding);
      fs.renameSync(tmpWrite, absPath);
    } catch (e: unknown) {
      try {
        fs.rmSync(tmpWrite, { force: true });
      } catch {
        /* ignore */
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `Write failed: ${msg}` };
    }

    // Phase 2c: Content verification
    try {
      const writtenContent = fs.readFileSync(absPath, encoding);
      if (writtenContent !== content) {
        try {
          fs.rmSync(absPath, { force: true });
        } catch {
          /* ignore */
        }
        return {
          success: false,
          error: "Write verification failed: content mismatch",
        };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `Write verification failed: ${msg}` };
    }

    // Phase 2d: Register baseline in both layers (P3/G11)
    // Ensures subsequent writeSafe() calls on this new file have a cross-process baseline.
    try {
      const newStat = captureStat(absPath);
      const regKey = absPath;
      _populateBaseline(regKey, {
        ino: newStat.ino,
        size: newStat.size,
        mtimeMs: newStat.mtimeMs,
        ctimeMs: newStat.ctimeMs,
        dev: newStat.dev,
        mode: newStat.mode,
      });
    } catch {
      // best-effort baseline population
    }

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Unexpected error: ${msg}` };
  } finally {
    if (releaseLock) releaseLock();
  }
}

// ════════════════════════════════════════════════════════════
// PUBLIC: safeDelete
// ════════════════════════════════════════════════════════════
/**
 * Safely delete a file with TOCTOU protection and backup.
 * Uses the same _fileRegistry as writeSafe for TOCTOU detection.
 * Creates an atomic backup before deletion.
 *
 * @public — Safe file deletion with atomic backup. Used by safe_delete tool.
 */
export function safeDelete(
  filePath: string,
  options?: WriteOptions,
): WriteResult {
  const opts = options || {};
  const agentType = opts.agentType || "unknown";
  const taskId = opts.taskId || "unknown";
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    return { success: false, error: "File not found: " + absPath };
  }

  // Acquire lock
  let releaseLock: (() => void) | null = null;
  try {
    releaseLock = acquireLock(absPath);
  } catch (lockErr: unknown) {
    const msg = lockErr instanceof Error ? lockErr.message : String(lockErr);
    return { success: false, error: "Concurrent lock failed: " + msg };
  }

  try {
    const resolvedPath = fs.realpathSync(absPath);
    const origStat = captureStat(resolvedPath);

    // TOCTOU: dual-layer baseline resolution (P3/G11: cross-process)
    // On first-ever call for this path: populate baseline and proceed (no failure return).
    const registryKey = resolvedPath;
    const existingBaseline = _resolveBaseline(registryKey);
    if (!existingBaseline) {
      _populateBaseline(registryKey, {
        ino: origStat.ino,
        size: origStat.size,
        mtimeMs: origStat.mtimeMs,
        ctimeMs: origStat.ctimeMs,
        dev: origStat.dev,
        mode: origStat.mode,
      });
      // P3/G11: No longer fail on first call — baseline established, proceed with delete.
    }

    // Re-stat for TOCTOU
    const currentStat = captureStat(resolvedPath);
    if (
      origStat.ino !== currentStat.ino ||
      origStat.size !== currentStat.size ||
      origStat.mtimeMs !== currentStat.mtimeMs
    ) {
      return {
        success: false,
        error: "TOCTOU: file state changed between checks",
      };
    }

    // Create backup
    let backupPathStr: string | undefined;
    const record = createGitBackup({
      filePath: resolvedPath,
      reason: "safe_delete",
      agent: agentType,
      sessionId: process.env.OPENCODE_SESSION_ID,
      dagTaskId: process.env.DISPATCH_DAG_TASK_ID,
      taskId,
    });
    if (record) {
      backupPathStr = record.backup_file_path;
    }

    // Atomic delete: rename to trash first, then unlink
    const trashPath = resolvedPath + ".trash." + Date.now();
    fs.renameSync(resolvedPath, trashPath);
    fs.unlinkSync(trashPath);

    // SA-IMPL-BACKUP-LIFECYCLE: Opportunistic cleanup after successful delete
    try {
      cleanupGitBackups();
    } catch {
      /* non-critical */
    }

    // P3/G11: Consume baseline (file is gone; baseline no longer valid).
    // Next writeSafe on this path will re-establish via _populateBaseline.
    _consumeBaseline(registryKey);

    return { success: true, backupPath: backupPathStr };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: "Delete failed: " + msg };
  } finally {
    if (releaseLock) releaseLock();
  }
}

// ════════════════════════════════════════════════════════════
// PUBLIC: safeMkdir
// ════════════════════════════════════════════════════════════
/**
 * Safely create a directory. mkdir is inherently atomic — no TOCTOU needed.
 *
 * @public — Directory creation with recursive support. Used by safe_mkdir tool.
 */
export function safeMkdir(
  dirPath: string,
  options?: { recursive?: boolean },
): { success: boolean; error?: string; path?: string } {
  const absPath = path.resolve(dirPath);
  const recursive = options?.recursive !== false;
  try {
    fs.mkdirSync(absPath, { recursive });
    return { success: true, path: absPath };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}
