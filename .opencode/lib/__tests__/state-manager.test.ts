/**
 * state-manager.test.ts — Unit tests for the state-manager module
 *
 * Tests all exported functions, types, and constants.
 * Pure functions (findOldSessions, buildArchiveRef, parseArchiveRef, etc.)
 * use no I/O; I/O functions (countJsonlLines, getFileSize) use temp directories.
 *
 * @since Wave 2.1a (R2)
 */
import {
  getDateKey,
  getTimestampKey,
  findOldSessions,
  buildArchiveRef,
  parseArchiveRef,
  countJsonlLines,
  getFileSize,
  formatFileSize,
  STATE_PATHS,
} from '../state-manager';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('state-manager', () => {
  // ─── getDateKey ───
  describe('getDateKey()', () => {
    it('returns YYYY-MM-DD format string', () => {
      const key = getDateKey(new Date('2026-06-03T12:00:00Z'));
      expect(key).toBe('2026-06-03');
    });

    it('pads single-digit months', () => {
      const key = getDateKey(new Date('2026-01-05T00:00:00Z'));
      expect(key).toBe('2026-01-05');
    });

    it('uses current date when called with no arguments', () => {
      const key = getDateKey();
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // ─── getTimestampKey ───
  describe('getTimestampKey()', () => {
    it('returns YYYYMMDD_HHMMSS format', () => {
      const key = getTimestampKey(new Date('2026-06-03T12:34:56Z'));
      expect(key).toBe('20260603_123456');
    });

    it('handles midnight', () => {
      const key = getTimestampKey(new Date('2026-01-01T00:00:00Z'));
      expect(key).toBe('20260101_000000');
    });
  });

  // ─── findOldSessions ───
  describe('findOldSessions()', () => {
    const sessions = {
      's1': { consumed_at: '2026-05-20T00:00:00Z' },
      's2': { consumed_at: '2026-06-01T00:00:00Z' },
      's3': { consumed_at: '2026-06-05T00:00:00Z' },
      's4': {}, // No consumed_at
      's5': { consumed_at: '2026-05-15T00:00:00Z' },
    };

    it('returns sessions older than cutoff', () => {
      const cutoff = new Date('2026-06-01T00:00:00Z');
      const old = findOldSessions(sessions, cutoff);
      expect(old).toContain('s1');
      expect(old).toContain('s5');
      expect(old).not.toContain('s2');
      expect(old).not.toContain('s3');
      expect(old).not.toContain('s4');
    });

    it('returns empty array when nothing is old', () => {
      const cutoff = new Date('2020-01-01T00:00:00Z');
      expect(findOldSessions(sessions, cutoff)).toEqual([]);
    });

    it('returns all with consumed_at when cutoff is future', () => {
      const cutoff = new Date('2030-01-01T00:00:00Z');
      const old = findOldSessions(sessions, cutoff);
      expect(old.length).toBe(4); // s1,s2,s3,s5 (not s4 — no consumed_at)
    });

    it('skips sessions without consumed_at', () => {
      const cutoff = new Date('2020-01-01T00:00:00Z');
      const old = findOldSessions(sessions, cutoff);
      expect(old).not.toContain('s4');
    });

    it('returns empty array for empty sessions object', () => {
      expect(findOldSessions({}, new Date())).toEqual([]);
    });
  });

  // ─── buildArchiveRef ───
  describe('buildArchiveRef()', () => {
    it('builds correct reference string', () => {
      expect(buildArchiveRef('2026-06-03', 5)).toBe('gate-state.history/2026-06-03.jsonl#5');
    });

    it('handles index 0', () => {
      expect(buildArchiveRef('2026-01-01', 0)).toBe('gate-state.history/2026-01-01.jsonl#0');
    });
  });

  // ─── parseArchiveRef ───
  describe('parseArchiveRef()', () => {
    it('parses valid reference', () => {
      const result = parseArchiveRef('gate-state.history/2026-06-03.jsonl#5');
      expect(result).toEqual({ filename: '2026-06-03.jsonl', lineIndex: 5 });
    });

    it('parses reference with index 0', () => {
      const result = parseArchiveRef('gate-state.history/2026-01-01.jsonl#0');
      expect(result).toEqual({ filename: '2026-01-01.jsonl', lineIndex: 0 });
    });

    it('parses large line index', () => {
      const result = parseArchiveRef('gate-state.history/2026-06-03.jsonl#999');
      expect(result).toEqual({ filename: '2026-06-03.jsonl', lineIndex: 999 });
    });

    it('returns null for empty string', () => {
      expect(parseArchiveRef('')).toBeNull();
    });

    it('returns null for invalid format', () => {
      expect(parseArchiveRef('something/else#1')).toBeNull();
    });

    it('returns null for missing hash', () => {
      expect(parseArchiveRef('gate-state.history/2026-06-03.jsonl')).toBeNull();
    });

    it('returns null for wrong prefix', () => {
      expect(parseArchiveRef('other.history/2026-06-03.jsonl#5')).toBeNull();
    });

    it('round-trips with buildArchiveRef', () => {
      const ref = buildArchiveRef('2026-12-25', 42);
      expect(parseArchiveRef(ref)).toEqual({ filename: '2026-12-25.jsonl', lineIndex: 42 });
    });
  });

  // ─── countJsonlLines ───
  describe('countJsonlLines()', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'state-manager-test-'));
    });

    afterEach(() => {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });

    it('returns accurate count for non-empty file', () => {
      const file = join(tmpDir, 'test.jsonl');
      writeFileSync(file, '{"a":1}\n{"b":2}\n{"c":3}\n');
      expect(countJsonlLines(file)).toBe(3);
    });

    it('returns 0 for non-existent file', () => {
      expect(countJsonlLines(join(tmpDir, 'nonexistent.jsonl'))).toBe(0);
    });

    it('ignores empty lines', () => {
      const file = join(tmpDir, 'test.jsonl');
      writeFileSync(file, '{"a":1}\n\n{"b":2}\n\n\n{"c":3}\n');
      expect(countJsonlLines(file)).toBe(3);
    });

    it('returns 0 for empty file', () => {
      const file = join(tmpDir, 'test.jsonl');
      writeFileSync(file, '');
      expect(countJsonlLines(file)).toBe(0);
    });

    it('returns 0 for whitespace-only file', () => {
      const file = join(tmpDir, 'test.jsonl');
      writeFileSync(file, '  \n  \n');
      expect(countJsonlLines(file)).toBe(0);
    });
  });

  // ─── getFileSize ───
  describe('getFileSize()', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'state-manager-test-'));
    });

    afterEach(() => {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });

    it('returns file size in bytes', () => {
      const file = join(tmpDir, 'test.json');
      writeFileSync(file, 'hello world'); // 11 bytes
      expect(getFileSize(file)).toBe(11);
    });

    it('returns -1 for non-existent file', () => {
      expect(getFileSize(join(tmpDir, 'nonexistent'))).toBe(-1);
    });
  });

  // ─── formatFileSize ───
  describe('formatFileSize()', () => {
    it('formats bytes', () => {
      expect(formatFileSize(500)).toBe('500B');
    });

    it('formats kilobytes', () => {
      expect(formatFileSize(1536)).toBe('1.5KB');
    });

    it('formats megabytes', () => {
      expect(formatFileSize(1048576)).toBe('1.0MB');
    });

    it('returns N/A for negative values', () => {
      expect(formatFileSize(-1)).toBe('N/A');
    });

    it('returns 0B for zero', () => {
      expect(formatFileSize(0)).toBe('0B');
    });
  });

  // ─── STATE_PATHS ───
  describe('STATE_PATHS', () => {
    it('contains all expected path keys', () => {
      expect(STATE_PATHS).toHaveProperty('GATE_STATE_HOT');
      expect(STATE_PATHS).toHaveProperty('GATE_STATE_INDEX');
      expect(STATE_PATHS).toHaveProperty('GATE_STATE_ARCHIVE');
      expect(STATE_PATHS).toHaveProperty('GATE_STATE_HISTORY_DIR');
      expect(STATE_PATHS).toHaveProperty('DAG_HOT');
      expect(STATE_PATHS).toHaveProperty('DAG_VERSIONS_DIR');
      expect(STATE_PATHS).toHaveProperty('DAG_CHANGELOG');
      expect(STATE_PATHS).toHaveProperty('DAG_INDEX');
      expect(STATE_PATHS).toHaveProperty('SAFE_BASH_LOG');
      expect(STATE_PATHS).toHaveProperty('LOG_ARCHIVE_DIR');
    });

    it('is a const object (TypeScript compile-time freeze)', () => {
      // 'as const' assertion is compile-time only, not runtime Object.freeze
      expect(STATE_PATHS.GATE_STATE_HOT).toBeDefined();
    });

    it('points to .opencode/state/ prefix for gate paths', () => {
      expect(STATE_PATHS.GATE_STATE_HOT).toContain('.opencode/state');
      expect(STATE_PATHS.GATE_STATE_INDEX).toContain('.opencode/state');
      expect(STATE_PATHS.GATE_STATE_ARCHIVE).toContain('.opencode/state');
    });
  });
});
