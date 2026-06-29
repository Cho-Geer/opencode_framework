/**
 * execute.ts — FileGuard Service: Core File Operations (Phase 1a)
 * 7-phase TOCTOU-protected write pipeline, validation, diff, restore.
 * Dependencies: ./lock, ./baseline, ./backup
 * @version 2.0.0 (FileGuard migration)
 */

import * as fs from "fs";
import * as path from "path";
import { acquireLock } from "./lock";
import {
  captureStat,
  statsEqual,
  resolveBaseline,
  populateBaseline,
  consumeBaseline,
  type StatSnapshot,
} from "./baseline";
import {
  createBackup as createGitBackup,
  findLatestBackup as findLatestGitBackup,
  cleanupStaleBackups as cleanupGitBackups,
} from "./backup";

export type { StatSnapshot };

// ── Types ──────────────────────────────────────────────────

export interface EditValidation { valid: boolean; error?: string; resolvedPath: string; }
export interface DiffResult { hasChanges: boolean; added: number; removed: number; diff: string; }
export interface WriteOptions { agentType?: string; taskId?: string; encoding?: BufferEncoding; createBackup?: boolean; }
export interface WriteResult { success: boolean; backupPath?: string; error?: string; }
export interface RestoreResult { success: boolean; error?: string; }

// ── validateEdit ───────────────────────────────────────────
/** Validate that a file path is writable and content is acceptable. */
export function validateEdit(filePath: string, content: string): EditValidation {
  if (!filePath || filePath.trim().length === 0) {
    return { valid: false, error: "File path is empty", resolvedPath: "" };
  }
  const absPath = path.resolve(filePath);
  const parentDir = path.dirname(absPath);
  try {
    if (!fs.existsSync(parentDir)) { fs.mkdirSync(parentDir, { recursive: true }); }
  } catch {
    return { valid: false, error: `Cannot create parent directory: ${parentDir}`, resolvedPath: absPath };
  }
  if (content === undefined || content === null) {
    return { valid: false, error: "Content is null or undefined", resolvedPath: absPath };
  }
  return { valid: true, resolvedPath: absPath };
}

// ── generateDiff ───────────────────────────────────────────
/** Generate a unified-diff style comparison between original and updated content. */
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
  return { hasChanges: added > 0 || removed > 0, added, removed, diff: diffLines.join("\n") };
}

// ── writeSafe — 7-phase TOCTOU-protected atomic write ──────
/**
 * Atomically write content to a file with TOCTOU protection.
 * Phases: 0-Validate 1-Symlink+stat 2-Backup 3-Baseline 4-Re-stat
 * 5-Atomic write (FW-REPAIR-14 perms) 6-Verify 7-Refresh baseline+cleanup
 */
export function writeSafe(filePath: string, content: string, options?: WriteOptions): WriteResult {
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
    try { resolvedPath = fs.realpathSync(absPath); } catch { resolvedPath = absPath; }

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
      if (record) { backupPathStr = record.backup_file_path; }
    }

    // Phase 3: DB-backed TOCTOU baseline (P3/G11: cross-process)
    // On first-ever call for this path: populate baseline and proceed.
    const registryKey = resolvedPath;
    const existingBaseline = resolveBaseline(registryKey);
    if (!existingBaseline) {
      populateBaseline(registryKey, {
        ino: origStat.ino, size: origStat.size,
        mtimeMs: origStat.mtimeMs, ctimeMs: origStat.ctimeMs,
        dev: origStat.dev, mode: origStat.mode,
      });
    }

    // Phase 4: Re-stat to detect changes
    let currentStat: StatSnapshot;
    try {
      currentStat = captureStat(resolvedPath);
    } catch {
      if (backupPathStr) { try { fs.rmSync(backupPathStr, { force: true }); } catch { /* ignore */ } }
      return { success: false, error: "TOCTOU race detected: file was removed between audit check and write" };
    }

    if (!statsEqual(origStat, currentStat)) {
      if (backupPathStr) { try { fs.rmSync(backupPathStr, { force: true }); } catch { /* ignore */ } }
      const details: string[] = [];
      if (origStat.ino !== currentStat.ino) details.push(`inode:${origStat.ino}->${currentStat.ino}`);
      if (origStat.size !== currentStat.size) details.push(`size:${origStat.size}->${currentStat.size}`);
      if (origStat.mtimeMs !== currentStat.mtimeMs) details.push("mtime changed");
      return {
        success: false,
        error: `TOCTOU race detected: file state changed between audit check and write. ${details.join(", ")}`,
      };
    }

    // Phase 5: Atomic write (temp → rename)
    // FW-REPAIR-14: Preserve original file mode (permissions) after atomic write.
    const origMode = origStat.mode;
    const tmpWrite = resolvedPath + ".tmp." + Date.now();
    try {
      fs.writeFileSync(tmpWrite, content, encoding);
      fs.renameSync(tmpWrite, resolvedPath);
      if (origMode !== 0) { fs.chmodSync(resolvedPath, origMode); }
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
        return { success: false, error: "Write verification failed: content mismatch — rolled back, potential TOCTOU race" };
      }
    } catch (e: unknown) {
      if (backupPathStr) {
        fs.copyFileSync(backupPathStr, resolvedPath);
        try { fs.rmSync(backupPathStr, { force: true }); } catch { /* ignore */ }
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `Write verification failed: ${msg} — rolled back` };
    }

    // Phase 7: Success — refresh baseline + opportunistic cleanup
    try {
      const newStat = captureStat(resolvedPath);
      populateBaseline(registryKey, {
        ino: newStat.ino, size: newStat.size,
        mtimeMs: newStat.mtimeMs, ctimeMs: newStat.ctimeMs,
        dev: newStat.dev, mode: newStat.mode,
      });
    } catch { /* best-effort baseline refresh */ }

    try { cleanupGitBackups(); } catch { /* non-critical */ }
    return { success: true, backupPath: backupPathStr };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Unexpected error: ${msg}` };
  } finally {
    if (releaseLock) releaseLock();
  }
}

// ── writeSafeFull — Full file overwrite / new file creation ─
/** Write full content to a file, creating it if it doesn't exist. Delegates to writeSafe if file exists. */
export function writeSafeFull(filePath: string, content: string, options?: WriteOptions): WriteResult {
  const opts = options || {};
  const encoding = opts.encoding || "utf8";
  const validation = validateEdit(filePath, content);
  if (!validation.valid) { return { success: false, error: validation.error }; }
  const absPath = validation.resolvedPath;
  // File exists → delegate to writeSafe for full TOCTOU protection
  if (fs.existsSync(absPath)) { return writeSafe(filePath, content, options); }
  // New file creation (no TOCTOU needed)
  let releaseLock: (() => void) | null = null;
  try { releaseLock = acquireLock(absPath); } catch (lockErr: unknown) {
    const msg = lockErr instanceof Error ? lockErr.message : String(lockErr);
    return { success: false, error: `Concurrent write lock failed: ${msg}` };
  }

  try {
    const tmpWrite = absPath + ".tmp." + Date.now();
    try {
      fs.writeFileSync(tmpWrite, content, encoding);
      fs.renameSync(tmpWrite, absPath);
    } catch (e: unknown) {
      try { fs.rmSync(tmpWrite, { force: true }); } catch { /* ignore */ }
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `Write failed: ${msg}` };
    }

    // Content verification
    try {
      const writtenContent = fs.readFileSync(absPath, encoding);
      if (writtenContent !== content) {
        try { fs.rmSync(absPath, { force: true }); } catch { /* ignore */ }
        return { success: false, error: "Write verification failed: content mismatch" };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: `Write verification failed: ${msg}` };
    }

    // Register baseline (P3/G11)
    try {
      const newStat = captureStat(absPath);
      populateBaseline(absPath, {
        ino: newStat.ino, size: newStat.size,
        mtimeMs: newStat.mtimeMs, ctimeMs: newStat.ctimeMs,
        dev: newStat.dev, mode: newStat.mode,
      });
    } catch { /* best-effort */ }

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Unexpected error: ${msg}` };
  } finally {
    if (releaseLock) releaseLock();
  }
}

// ── safeDelete ─────────────────────────────────────────────
/** Safely delete a file with TOCTOU protection and backup. */
export function safeDelete(filePath: string, options?: WriteOptions): WriteResult {
  const opts = options || {};
  const agentType = opts.agentType || "unknown";
  const taskId = opts.taskId || "unknown";
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) { return { success: false, error: "File not found: " + absPath }; }

  let releaseLock: (() => void) | null = null;
  try { releaseLock = acquireLock(absPath); } catch (lockErr: unknown) {
    const msg = lockErr instanceof Error ? lockErr.message : String(lockErr);
    return { success: false, error: "Concurrent lock failed: " + msg };
  }

  try {
    const resolvedPath = fs.realpathSync(absPath);
    const origStat = captureStat(resolvedPath);

    // TOCTOU: dual-layer baseline resolution (P3/G11)
    const registryKey = resolvedPath;
    const existingBaseline = resolveBaseline(registryKey);
    if (!existingBaseline) {
      populateBaseline(registryKey, {
        ino: origStat.ino, size: origStat.size,
        mtimeMs: origStat.mtimeMs, ctimeMs: origStat.ctimeMs,
        dev: origStat.dev, mode: origStat.mode,
      });
    }

    // Re-stat for TOCTOU
    const currentStat = captureStat(resolvedPath);
    if (origStat.ino !== currentStat.ino || origStat.size !== currentStat.size || origStat.mtimeMs !== currentStat.mtimeMs) {
      return { success: false, error: "TOCTOU: file state changed between checks" };
    }

    // Create backup
    let backupPathStr: string | undefined;
    const record = createGitBackup({
      filePath: resolvedPath, reason: "safe_delete", agent: agentType,
      sessionId: process.env.OPENCODE_SESSION_ID,
      dagTaskId: process.env.DISPATCH_DAG_TASK_ID, taskId,
    });
    if (record) { backupPathStr = record.backup_file_path; }

    // Atomic delete: rename to trash first, then unlink
    const trashPath = resolvedPath + ".trash." + Date.now();
    fs.renameSync(resolvedPath, trashPath);
    fs.unlinkSync(trashPath);

    try { cleanupGitBackups(); } catch { /* non-critical */ }
    consumeBaseline(registryKey);

    return { success: true, backupPath: backupPathStr };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: "Delete failed: " + msg };
  } finally {
    if (releaseLock) releaseLock();
  }
}

// ── safeMkdir ──────────────────────────────────────────────
/** Safely create a directory. mkdir is inherently atomic — no TOCTOU needed. */
export function safeMkdir(dirPath: string, options?: { recursive?: boolean }): { success: boolean; error?: string; path?: string } {
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

// ── restore ────────────────────────────────────────────────
/** Restore a file from a backup created by writeSafe. Atomic restore (copy → temp → rename). */
export function restore(backupPathStr: string, targetPath: string): RestoreResult {
  const absBackup = path.resolve(backupPathStr);
  const absTarget = path.resolve(targetPath);
  try {
    if (!fs.existsSync(absBackup)) {
      return { success: false, error: `Backup file not found: ${backupPathStr}` };
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
          try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Restore failed: ${msg}` };
  }
}

// ── Backward compatibility ─────────────────────────────────
/** Backward-compatible alias for writeSafe. */
export const safeEdit = writeSafe;
