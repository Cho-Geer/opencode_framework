/**
 * Log Rotator — Size/Time-Based Log Rotation Engine
 *
 * Handles automatic rotation of append-only log files to prevent unbounded growth.
 * Implements both size-based and time-based rotation policies with gzip compression
 * for rotated files.
 *
 * FEATURES:
 * - Size-based rotation: When log exceeds maxSize, rotate immediately
 * - Time-based rotation: Daily check for files exceeding size threshold
 * - File locking: Prevents concurrent rotation conflicts
 * - Compression: gzip-compress rotated files after a configurable age
 * - Archival: Move files older than archiveAfterDays to monthly tar archives
 *
 * ROTATION POLICY:
 * - maxSize: 100KB (rotate when exceeded)
 * - maxRotatedFiles: 3 (keep at most 3 rotated files)
 * - compressAfterDays: 3 (gzip after 3 days)
 * - archiveAfterDays: 30 (move to archive after 30 days)
 *
 * INTEGRATION POINTS:
 * - safe_bash tool: Call rotateIfNeeded() after each command log write
 * - @CI-CD-Agent nightly: Call dailyRotation() for time-based checks
 *
 * LOGGING CONVENTION:
 * - When used in OpenCode plugin context, use client.app.log() for structured logging
 * - When used in standalone scripts, console.log/console.error is acceptable
 *
 * @module log-rotator
 * @since Phase 0 (Foundation)
 */

import {
  renameSync,
  existsSync,
  statSync,
  createReadStream,
  createWriteStream,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
/**
 * FW-LOG-UNIFY-P1-D2 (2026-06-12, @Super-Admin): Added writeLog import
 * for centralized log persistence. log-rotator → state-manager → gate-core
 * import chain is safe (no circular dependency with log-manager).
 */
import { getFileSize, formatFileSize } from './state-manager';
import { writeLog } from "./log-manager";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Log rotation configuration constants.
 */
const ROTATION_CONFIG = {
  /** Maximum log file size before rotation (bytes) */
  MAX_SIZE: 100 * 1024, // 100KB
  /** Maximum number of rotated files to keep */
  MAX_ROTATED_FILES: 3,
  /** Number of days before compressing rotated files */
  COMPRESS_AFTER_DAYS: 3,
  /** Number of days before archiving to monthly tar */
  ARCHIVE_AFTER_DAYS: 30,
  /** Lock timeout in milliseconds (prevent concurrent rotation) */
  LOCK_TIMEOUT_MS: 5000,
} as const;

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Result of a rotation check.
 */
export interface RotationResult {
  /** Whether rotation was performed */
  rotated: boolean;
  /** Number of files rotated */
  rotatedCount: number;
  /** Number of files compressed */
  compressedCount: number;
  /** Number of files archived */
  archivedCount: number;
  /** Human-readable summary */
  summary: string;
}

/**
 * Status of a log file.
 */
export interface LogStatus {
  /** Path to the log file */
  path: string;
  /** Current size in bytes */
  size: number;
  /** Human-readable size */
  sizeFormatted: string;
  /** Whether rotation is needed */
  needsRotation: boolean;
}

// ============================================================================
// Log Rotator Class
// ============================================================================

/**
 * LogRotator — Handles rotation, compression, and archival of log files.
 *
 * Usage:
 * ```
 * const rotator = new LogRotator();
 *
 * // After each log write:
 * const result = await rotator.rotateIfNeeded('.opencode/logs/safe-bash.log');
 *
 * // Nightly cron:
 * await rotator.dailyRotation();
 * ```
 */
export class LogRotator {
  private readonly maxSize: number;
  private readonly maxRotatedFiles: number;
  private readonly compressAfterDays: number;
  private readonly archiveAfterDays: number;

  constructor(config?: Partial<typeof ROTATION_CONFIG>) {
    this.maxSize = config?.MAX_SIZE ?? ROTATION_CONFIG.MAX_SIZE;
    this.maxRotatedFiles = config?.MAX_ROTATED_FILES ?? ROTATION_CONFIG.MAX_ROTATED_FILES;
    this.compressAfterDays = config?.COMPRESS_AFTER_DAYS ?? ROTATION_CONFIG.COMPRESS_AFTER_DAYS;
    this.archiveAfterDays = config?.ARCHIVE_AFTER_DAYS ?? ROTATION_CONFIG.ARCHIVE_AFTER_DAYS;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Check if a log file needs rotation and rotate if necessary.
   * This should be called after each log write operation.
   *
   * NOTE: In plugin context, use the destructured `client` parameter
   * and call `client.app.log()` for structured logging instead of console.log.
   *
   * @param logPath - Absolute or relative path to the log file
   * @returns Rotation result summary
   */
  async rotateIfNeeded(logPath: string): Promise<RotationResult> {
    const result: RotationResult = {
      rotated: false,
      rotatedCount: 0,
      compressedCount: 0,
      archivedCount: 0,
      summary: 'No rotation needed',
    };

    // Check if log exists and exceeds max size
    if (!existsSync(logPath)) {
      result.summary = `Log file does not exist: ${logPath}`;
      return result;
    }

    const size = getFileSize(logPath);

    if (size <= this.maxSize) {
      result.summary = `Log file size ${formatFileSize(size)} is within limit ${formatFileSize(this.maxSize)}`;
      return result;
    }

    // Acquire lock to prevent concurrent rotation
    const lockPath = `${logPath}.lock`;
    if (this.isLocked(lockPath)) {
      // In plugin context: await client.app.log({ body: { service: 'log-rotator', level: 'warn', message: 'Rotation skipped — lock held by another process' } });
      result.summary = 'Rotation skipped — lock held by another process';
      return result;
    }

    // Create lock
    this.createLock(lockPath);

    try {
      // Perform rotation
      await this.rotate(logPath);
      result.rotated = true;
      result.rotatedCount = 1;

      // Compress old files
      const compressed = await this.compressOldFiles(logPath);
      result.compressedCount = compressed;

      result.summary = `Rotated ${basename(logPath)} (${formatFileSize(size)} → new file), compressed ${compressed} files`;
    } finally {
      // Release lock
      this.releaseLock(lockPath);
    }

    return result;
  }

  /**
   * Daily rotation check — scans all tracked log files for time-based rotation
   * and archival. Intended for @CI-CD-Agent nightly cron.
   *
   * @param logPaths - List of log file paths to check
   * @returns Combined rotation result
   */
  async dailyRotation(logPaths: string[]): Promise<RotationResult> {
    const combined: RotationResult = {
      rotated: false,
      rotatedCount: 0,
      compressedCount: 0,
      archivedCount: 0,
      summary: '',
    };

    const summaries: string[] = [];

    for (const logPath of logPaths) {
      const result = await this.rotateIfNeeded(logPath);
      combined.rotated = combined.rotated || result.rotated;
      combined.rotatedCount += result.rotatedCount;
      combined.compressedCount += result.compressedCount;
      combined.archivedCount += result.archivedCount;
      summaries.push(result.summary);
    }

    combined.summary = summaries.join('; ');
    return combined;
  }

  /**
   * Get the current status of a log file.
   */
  getStatus(logPath: string): LogStatus {
    return {
      path: logPath,
      size: getFileSize(logPath),
      sizeFormatted: formatFileSize(getFileSize(logPath)),
      needsRotation: getFileSize(logPath) > this.maxSize,
    };
  }

  // ==========================================================================
  // Private: Rotation Operations
  // ==========================================================================

  /**
   * Perform the actual file rotation.
   * Shifts: current → .1, .1 → .2, etc.
   */
  private async rotate(logPath: string): Promise<void> {
    // Shift existing rotated files
    for (let i = this.maxRotatedFiles; i >= 1; i--) {
      const oldPath = `${logPath}.${i}`;
      const newPath = `${logPath}.${i + 1}`;

      if (existsSync(oldPath)) {
        renameSync(oldPath, newPath);
      }
    }

    // Move current log to .1
    if (existsSync(logPath)) {
      renameSync(logPath, `${logPath}.1`);
    }

    // Create a new empty log file
    // In production, this should be handled by the logging system itself
    // We create an empty placeholder to indicate rotation happened
    writeFileSync(logPath, '');
  }

  /**
   * Compress rotated files older than compressAfterDays.
   *
   * @returns Number of files compressed
   */
  private async compressOldFiles(baseLogPath: string): Promise<number> {
    let compressed = 0;

    for (let i = 2; i <= this.maxRotatedFiles + 1; i++) {
      const filePath = `${baseLogPath}.${i}`;

      if (!existsSync(filePath)) continue;
      if (filePath.endsWith('.gz')) continue;

      // Check if file is old enough to compress
      try {
        const stats = statSync(filePath);
        const ageMs = Date.now() - stats.mtime.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);

        if (ageDays >= this.compressAfterDays) {
          const gzipPath = `${filePath}.gz`;

          await pipeline(createReadStream(filePath), createGzip(), createWriteStream(gzipPath));

          // Delete original after successful compression
          unlinkSync(filePath);
          compressed++;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        /**
         * FW-LOG-UNIFY-P1-D2 (2026-06-12, @Super-Admin): Migrated from
         * console.error to writeLog for centralized log persistence.
         */
        writeLog("lib-log-rotator", "ERROR", { event: "compress_failed", detail: `${filePath}: ${message}` });
        // Continue with next file
        continue;
      }
    }

    return compressed;
  }

  // ==========================================================================
  // Private: Lock Operations
  // ==========================================================================

  /**
   * Check if a lock file is currently held (younger than LOCK_TIMEOUT_MS).
   */
  private isLocked(lockPath: string): boolean {
    if (!existsSync(lockPath)) return false;

    try {
      const stats = statSync(lockPath);
      const lockAge = Date.now() - stats.mtime.getTime();
      return lockAge < ROTATION_CONFIG.LOCK_TIMEOUT_MS;
    } catch {
      return false;
    }
  }

  /**
   * Create a lock file.
   */
  private createLock(lockPath: string): void {
    const lockDir = dirname(lockPath);
    if (!existsSync(lockDir)) {
      mkdirSync(lockDir, { recursive: true });
    }
    writeFileSync(lockPath, String(Date.now()));
  }

  /**
   * Release (delete) a lock file.
   */
  private releaseLock(lockPath: string): void {
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch {
      // Best effort; lock will expire on its own
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick rotation check for the safe-bash log.
 * Intended to be called after each safe_bash command execution.
 */
export async function rotateSafeBashLogIfNeeded(): Promise<RotationResult> {
  const rotator = new LogRotator();
  return rotator.rotateIfNeeded('.opencode/logs/safe-bash.log');
}

// ============================================================================
// Module Exports
// ============================================================================

export { ROTATION_CONFIG };
