/**
 * log-rotator.test.ts — Unit tests for the log-rotator module
 *
 * Tests rotation, compression, lock semantics, and convenience functions.
 * Uses temp directories for all file I/O.
 *
 * @since Wave 2.1b (R2)
 */
import { LogRotator, rotateSafeBashLogIfNeeded, ROTATION_CONFIG } from '../log-rotator';
import { writeFileSync, existsSync, readFileSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('log-rotator', () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'log-rotator-test-'));
    logPath = join(tmpDir, 'test.log');
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // ─── Constructor ───
  describe('LogRotator constructor', () => {
    it('creates with default config', () => {
      const r = new LogRotator();
      expect(r).toBeInstanceOf(LogRotator);
    });

    it('accepts custom config', () => {
      const r = new LogRotator({ MAX_SIZE: 500, MAX_ROTATED_FILES: 3 });
      const status = r.getStatus(logPath);
      expect(status.needsRotation).toBe(false); // file doesn't exist
    });
  });

  // ─── getStatus ───
  describe('getStatus()', () => {
    it('reports file does not exist', () => {
      const r = new LogRotator();
      const status = r.getStatus(join(tmpDir, 'nonexistent.log'));
      expect(status.size).toBe(-1);
      expect(status.needsRotation).toBe(false);
    });

    it('reports file size and rotation need', () => {
      const r = new LogRotator({ MAX_SIZE: 10 });
      writeFileSync(logPath, 'x'.repeat(50));
      const status = r.getStatus(logPath);
      expect(status.size).toBe(50);
      expect(status.needsRotation).toBe(true);
    });

    it('formats size correctly', () => {
      const r = new LogRotator();
      writeFileSync(logPath, 'x'.repeat(2048));
      const status = r.getStatus(logPath);
      expect(status.sizeFormatted).toBe('2.0KB');
    });
  });

  // ─── rotateIfNeeded ───
  describe('rotateIfNeeded()', () => {
    it('does nothing when file does not exist', async () => {
      const r = new LogRotator();
      const result = await r.rotateIfNeeded(join(tmpDir, 'nonexistent.log'));
      expect(result.rotated).toBe(false);
      expect(result.summary).toContain('does not exist');
    });

    it('does nothing when file is under size limit', async () => {
      const r = new LogRotator();
      writeFileSync(logPath, 'small log');
      const result = await r.rotateIfNeeded(logPath);
      expect(result.rotated).toBe(false);
      expect(result.summary).toContain('within limit');
    });

    it('rotates when file exceeds size limit', async () => {
      const r = new LogRotator({ MAX_SIZE: 10 });
      writeFileSync(logPath, 'x'.repeat(200)); // 200 bytes > 10 limit
      const result = await r.rotateIfNeeded(logPath);
      expect(result.rotated).toBe(true);
      expect(result.rotatedCount).toBe(1);
      // Old content moves to .1
      expect(existsSync(logPath + '.1')).toBe(true);
      const rotated = readFileSync(logPath + '.1', 'utf8');
      expect(rotated).toBe('x'.repeat(200));
      // Current log is empty
      const current = readFileSync(logPath, 'utf8');
      expect(current).toBe('');
    });

    it('shifts existing rotated files upward', async () => {
      const r = new LogRotator({ MAX_SIZE: 10 });
      // Create existing rotated files
      writeFileSync(logPath + '.1', 'first');
      writeFileSync(logPath + '.2', 'second');
      // Create large current log
      writeFileSync(logPath, 'x'.repeat(200));
      await r.rotateIfNeeded(logPath);
      // .1 becomes .2, old .2 becomes .3, current becomes .1
      expect(existsSync(logPath + '.1')).toBe(true);
      expect(readFileSync(logPath + '.1', 'utf8')).toBe('x'.repeat(200));
      expect(readFileSync(logPath + '.2', 'utf8')).toBe('first');
      expect(readFileSync(logPath + '.3', 'utf8')).toBe('second');
    });
  });

  // ─── dailyRotation ───
  describe('dailyRotation()', () => {
    it('processes multiple log paths', async () => {
      const r = new LogRotator({ MAX_SIZE: 10 });
      const log1 = join(tmpDir, 'a.log');
      const log2 = join(tmpDir, 'b.log');
      writeFileSync(log1, 'x'.repeat(200));
      writeFileSync(log2, 'x'.repeat(300));
      const result = await r.dailyRotation([log1, log2]);
      expect(result.rotated).toBe(true);
      expect(result.rotatedCount).toBe(2);
    });

    it('handles empty log paths array', async () => {
      const r = new LogRotator();
      const result = await r.dailyRotation([]);
      expect(result.rotated).toBe(false);
      expect(result.rotatedCount).toBe(0);
    });
  });

  // ─── Lock semantics ───
  describe('lock handling', () => {
    it('skips rotation when lock is active', async () => {
      const r = new LogRotator({ MAX_SIZE: 10 });
      writeFileSync(logPath, 'x'.repeat(200));
      // Create an active lock
      writeFileSync(logPath + '.lock', String(Date.now()));
      const result = await r.rotateIfNeeded(logPath);
      expect(result.rotated).toBe(false);
      expect(result.summary).toContain('lock held');
    });

    it('ignores expired lock', async () => {
      const r = new LogRotator({ MAX_SIZE: 10 });
      writeFileSync(logPath, 'x'.repeat(200));
      // Create a stale lock (old mtime)
      writeFileSync(logPath + '.lock', String(Date.now() - 10000));
      // Touch mtime back
      const { utimesSync } = require('fs');
      utimesSync(logPath + '.lock', new Date(), new Date(Date.now() - 10000));
      const result = await r.rotateIfNeeded(logPath);
      // Lock is expired, rotation should proceed
      expect(result.rotated).toBe(true);
    });

    it('cleans up lock after rotation', async () => {
      const r = new LogRotator({ MAX_SIZE: 10 });
      writeFileSync(logPath, 'x'.repeat(200));
      await r.rotateIfNeeded(logPath);
      expect(existsSync(logPath + '.lock')).toBe(false);
    });
  });

  // ─── rotateSafeBashLogIfNeeded ───
  describe('rotateSafeBashLogIfNeeded()', () => {
    it('returns RotationResult on non-existent log', async () => {
      const result = await rotateSafeBashLogIfNeeded();
      expect(result).toHaveProperty('rotated');
      expect(result).toHaveProperty('rotatedCount');
      expect(result).toHaveProperty('summary');
    });
  });

  // ─── ROTATION_CONFIG ───
  describe('ROTATION_CONFIG', () => {
    it('has expected defaults', () => {
      expect(ROTATION_CONFIG.MAX_SIZE).toBe(100 * 1024);
      expect(ROTATION_CONFIG.MAX_ROTATED_FILES).toBe(3);
      expect(ROTATION_CONFIG.COMPRESS_AFTER_DAYS).toBe(3);
      expect(ROTATION_CONFIG.ARCHIVE_AFTER_DAYS).toBe(30);
      expect(ROTATION_CONFIG.LOCK_TIMEOUT_MS).toBe(5000);
    });
  });
});
