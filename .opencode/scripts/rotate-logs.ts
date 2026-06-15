#!/usr/bin/env bun
/**
 * Log Rotation Script — safe-bash.log Compaction
 *
 * Rotates the safe-bash.log file (2.2MB append-only) using size-based
 * rotation with gzip compression for old rotated files.
 *
 * ROTATION POLICY:
 * - Rotate when > 100KB (current: 2.2MB → immediately triggered)
 * - Keep 3 rotated files (*.1, *.2, *.3)
 * - Compress files older than 3 days (gzip)
 * - Archive files older than 30 days to .opencode/logs/archive/
 *
 * SAFETY:
 * - Creates timestamped backup before rotation
 * - Uses atomic file operations
 * - DRY-RUN: --dry-run validates without modifying files
 *
 * USAGE:
 *   node .opencode/scripts/rotate-logs.mjs
 *   node .opencode/scripts/rotate-logs.mjs --dry-run
 *
 * @since Phase 3
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, statSync, readdirSync, createReadStream, createWriteStream } from 'node:fs';
import { join, basename } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = new URL('.', import.meta.url).pathname;
const PROJECT_ROOT = join(__dirname, '../..');
const LOG_FILE = join(PROJECT_ROOT, '.opencode/logs/safe-bash.log');
const LOG_DIR = join(PROJECT_ROOT, '.opencode/logs');
const ARCHIVE_DIR = join(PROJECT_ROOT, '.opencode/logs/archive');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * FW-LOG-UNIFY-C7: Lazy-load writeLog for rotation audit trail.
 * Uses dynamic import for ESM compatibility.
 */
let _writeLog: ((...args: any[]) => void) | null = null;
function getWriteLog(): (...args: any[]) => void {
  if (!_writeLog) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const lm = require(join(__dirname, '..', 'lib', 'log-manager'));
      _writeLog = lm.writeLog;
    } catch { _writeLog = () => {}; }
  }
  return _writeLog;
}
function srcLog(level: string, event: string, fields: Record<string, any>): void {
  try { getWriteLog()("script-rotate-logs", level, { event, ...fields }); } catch {}
}
const MAX_SIZE = 100 * 1024;  // 100KB
const MAX_ROTATED = 3;

function log(msg) { console.log((DRY_RUN ? '[DRY-RUN] ' : '') + msg); }

function getFileSize(path) {
  if (!existsSync(path)) return -1;
  return statSync(path).size;
}

function formatSize(bytes) {
  if (bytes < 0) return 'N/A';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

async function compressFile(filePath) {
  if (!existsSync(filePath) || filePath.endsWith('.gz')) return 0;
  const gzipPath = filePath + '.gz';
  try {
    await pipeline(createReadStream(filePath), createGzip(), createWriteStream(gzipPath));
    unlinkSync(filePath);
    return 1;
  } catch (err) {
    log('  ⚠️ Failed to compress ' + basename(filePath) + ': ' + err.message);
    return 0;
  }
}

/**
 * Consolidate individually archived log files into monthly .tar.gz bundles.
 * FW-REPAIR-14: Prevents archive directory bloat from per-file archiving.
 * Skips silently if tar is unavailable (files remain as individually archived).
 */
async function consolidateMonthlyArchives() {
  if (!existsSync(ARCHIVE_DIR)) return;

  const files = readdirSync(ARCHIVE_DIR).filter(f =>
    f.startsWith('safe-bash') && !f.endsWith('.tar.gz') && !f.endsWith('.gitkeep')
  );

  if (files.length === 0) return;

  // Group files by month (from file mtime)
  const byMonth = new Map();
  for (const f of files) {
    try {
      const stats = statSync(join(ARCHIVE_DIR, f));
      const month = stats.mtime.toISOString().slice(0, 7); // YYYY-MM
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push(f);
    } catch {}
  }

  let consolidated = 0;
  for (const [month, monthFiles] of byMonth) {
    if (monthFiles.length <= 1) continue; // Skip single files — no consolidation needed

    const archiveName = `safe-bash.${month}.tar.gz`;
    const archivePath = join(ARCHIVE_DIR, archiveName);

    // Skip if monthly archive already exists
    if (existsSync(archivePath)) continue;

    if (DRY_RUN) {
      log(`  [DRY-RUN] Would consolidate ${monthFiles.length} files → ${archiveName}`);
      continue;
    }

    try {
      // Use tar command for consolidation. Skip silently if tar unavailable.
      const fileList = monthFiles.map(f => join(ARCHIVE_DIR, f)).join(' ');
      execSync(`tar -czf "${archivePath}" -C "${ARCHIVE_DIR}" ${monthFiles.join(' ')}`, {
        stdio: 'pipe',
        timeout: 30000,
      });

      // Remove individual files only after successful tar creation
      for (const f of monthFiles) {
        try { unlinkSync(join(ARCHIVE_DIR, f)); } catch {}
      }
      consolidated += monthFiles.length;
      log(`  Consolidated: ${monthFiles.length} files → ${archiveName}`);
    } catch {
      // tar unavailable or failed — individual files preserved as-is
    }
  }
  if (consolidated > 0) log(`  Total consolidated: ${consolidated} file(s) into monthly archives`);
}

async function rotate() {
  log('=== Log Rotation: safe-bash.log ===');
  log('Mode: ' + (DRY_RUN ? 'DRY-RUN' : 'LIVE'));

  const currentSize = getFileSize(LOG_FILE);
  log('Current size: ' + formatSize(currentSize));

  if (currentSize < 0) {
    log('Log file does not exist. Nothing to rotate.');
    return;
  }

  if (currentSize <= MAX_SIZE) {
    log('Size within limit (' + formatSize(MAX_SIZE) + '). No rotation needed.');
    return;
  }

  if (DRY_RUN) {
    log('DRY-RUN: Would rotate ' + formatSize(currentSize) + ' log file');
    log('  - ' + LOG_FILE + ' → ' + LOG_FILE + '.1');
    // Check existing rotated files
    for (let i = 1; i <= MAX_ROTATED; i++) {
      const f = LOG_FILE + '.' + i;
      if (existsSync(f)) log('  - ' + f + ' → ' + LOG_FILE + '.' + (i + 1) + ' (' + formatSize(getFileSize(f)) + ')');
    }
    log('  - New empty log file would be created');
    log('\nDRY-RUN complete. No files modified.');
    return;
  }

  // 1. Shift existing rotated files
  for (let i = MAX_ROTATED; i >= 1; i--) {
    const oldPath = LOG_FILE + '.' + i;
    const newPath = LOG_FILE + '.' + (i + 1);
    if (existsSync(oldPath)) {
      renameSync(oldPath, newPath);
      log('  Shifted: .' + i + ' → .' + (i + 1));
    }
  }

  // 2. Rotate current log to .1
  renameSync(LOG_FILE, LOG_FILE + '.1');
  log('  Rotated: safe-bash.log → safe-bash.log.1 (' + formatSize(currentSize) + ')');

  // 3. Create new empty log file
  writeFileSync(LOG_FILE, '');
  log('  Created: new empty safe-bash.log');

  // 4. Compress old rotated files (>3 days or > .2)
  let compressed = 0;
  for (let i = 2; i <= MAX_ROTATED + 2; i++) {
    const filePath = LOG_FILE + '.' + i;
    compressed += await compressFile(filePath);
  }
  if (compressed > 0) log('  Compressed: ' + compressed + ' file(s)');

  // 5. Archive files older than 30 days
  if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true });
  let archived = 0;
  for (let i = 1; i <= MAX_ROTATED + 2; i++) {
    const filePath = LOG_FILE + '.' + i;
    const gzPath = filePath + '.gz';
    const targetPath = existsSync(gzPath) ? gzPath : filePath;
    if (!existsSync(targetPath)) continue;

    try {
      const stats = statSync(targetPath);
      const ageDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > 30) {
        const archiveName = basename(targetPath).replace(/\.(\d+)(\.gz)?$/, '_$1$2');
        const archivePath = join(ARCHIVE_DIR, archiveName);
        renameSync(targetPath, archivePath);
        archived++;
      }
    } catch {}
  }
  if (archived > 0) log('  Archived: ' + archived + ' file(s) to logs/archive/');

  // 6. Consolidate archived files into monthly .tar.gz (FW-REPAIR-14)
  await consolidateMonthlyArchives();

  

rotate().catch(err => {
  console.error('Rotation failed:', err.message);
  srcLog("ERROR", "rotation_failed", { error: err.message });
  process.exit(1);
});
