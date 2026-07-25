/**
 * safe-edit-core.test.ts — TDD RED phase tests
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const {
  validateEdit,
  generateDiff,
  writeSafe,
  acquireLock,
  captureStat,
  statsEqual,
  clearRegistry,
  restore,
} = require('../safe-edit-core');

describe('safe-edit-core', () => {
  describe('validateEdit', () => {
    it('should reject empty file path', () => {
      const result = validateEdit('', 'content');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should accept valid file path and content', () => {
      const tmpFile = path.join(os.tmpdir(), 'test-' + Date.now() + '.ts');
      const result = validateEdit(tmpFile, 'content');
      expect(result.valid).toBe(true);
      expect(result.resolvedPath).toBe(path.resolve(tmpFile));
    });

    it('should reject null content', () => {
      const result = validateEdit('/tmp/test.ts', null as unknown as string);
      expect(result.valid).toBe(false);
    });
  });

  describe('generateDiff', () => {
    it('should detect no changes for identical content', () => {
      const result = generateDiff('hello\nworld', 'hello\nworld');
      expect(result.hasChanges).toBe(false);
      expect(result.added).toBe(0);
      expect(result.removed).toBe(0);
    });

    it('should detect added lines', () => {
      const result = generateDiff('line1', 'line1\nline2');
      expect(result.hasChanges).toBe(true);
      expect(result.added).toBeGreaterThan(0);
    });

    it('should detect removed lines', () => {
      const result = generateDiff('line1\nline2', 'line1');
      expect(result.hasChanges).toBe(true);
      expect(result.removed).toBeGreaterThan(0);
    });
  });

  describe('acquireLock', () => {
    it('should acquire and release a lock', () => {
      const tmpFile = path.join(os.tmpdir(), 'lock-test-' + Date.now() + '.ts');
      const release = acquireLock(tmpFile);
      expect(typeof release).toBe('function');
      expect(release).not.toThrow();
    });
  });

  describe('writeSafe backup', () => {
    const backupRoot = path.join(os.tmpdir(), 'safe-edit-backup-test-' + Date.now());

    beforeAll(() => {
      process.env.OPENCODE_ROOT = backupRoot;
      fs.mkdirSync(backupRoot, { recursive: true });
    });

    afterAll(() => {
      try { fs.rmSync(backupRoot, { recursive: true, force: true }); } catch {}
    });

    it('should return a git-based backup path on success', () => {
      const tmpFile = path.join(os.tmpdir(), 'backup-test-' + Date.now() + '.ts');
      fs.writeFileSync(tmpFile, 'original');
      clearRegistry();
      const result = writeSafe(tmpFile, 'updated');
      expect(result.success).toBe(true);
      expect(result.backupPath).toBeTruthy();
      try { fs.rmSync(tmpFile); } catch {}
    });
  });

  describe('captureStat and statsEqual', () => {
    it('should capture stat for an existing file', () => {
      const tmpFile = path.join(os.tmpdir(), 'stat-test-' + Date.now() + '.ts');
      fs.writeFileSync(tmpFile, 'test');
      const stat = captureStat(tmpFile);
      expect(stat.ino).toBeGreaterThan(0);
      expect(stat.size).toBeGreaterThan(0);
      fs.rmSync(tmpFile);
    });
  });

  describe('writeSafe', () => {
    it('should fail for non-existent directory without creating it', () => {
      clearRegistry();
      const result = writeSafe('/nonexistent_dir_12345/test.ts', 'content');
      expect(result.success).toBe(false);
    });

    it('should populate baseline and succeed on first call (no TOCTOU false positive)', () => {
      clearRegistry();
      const tmpFile = path.join(os.tmpdir(), 'toctou-test-' + Date.now() + '.ts');
      fs.writeFileSync(tmpFile, 'original');
      // New writeSafe populates the baseline on first call and proceeds.
      const result = writeSafe(tmpFile, 'updated', { createBackup: false });
      expect(result.success).toBe(true);
      fs.rmSync(tmpFile);
    });
  });

});
