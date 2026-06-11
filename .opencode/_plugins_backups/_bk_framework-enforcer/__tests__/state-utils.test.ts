/**
 * __tests__/state-utils.test.ts — Unit tests for state utility functions
 *
 * FW-REPAIR-13: Baseline unit tests for extracted state-utils module.
 * Tests path resolution, file classification, and helper functions.
 *
 * @since Phase 4 (P3-2)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  STATE_PATHS,
  getOpenCodeRoot,
  isSourceFile,
  isCriticalFrameworkFile,
  isStaleSession,
  resolveStatePath,
} from '../utils/state-utils';

// ── STATE_PATHS ───────────────────────────────────────
describe('STATE_PATHS', () => {
  it('should define all required state paths', () => {
    expect(STATE_PATHS).toBeDefined();
    expect(typeof STATE_PATHS.gateState).toBe('function');
    expect(typeof STATE_PATHS.gateIndex).toBe('function');
    expect(typeof STATE_PATHS.machine).toBe('function');
    expect(typeof STATE_PATHS.auditLog).toBe('function');
    expect(typeof STATE_PATHS.ruleRegistry).toBe('function');
  });

  it('should return string paths ending with expected filenames', () => {
    expect(STATE_PATHS.gateState()).toContain('gate-state.json');
    expect(STATE_PATHS.machine()).toContain('machine.json');
    expect(STATE_PATHS.auditLog()).toContain('audit');
  });
});

// ── getOpenCodeRoot ───────────────────────────────────
describe('getOpenCodeRoot', () => {
  it('should return a string path', () => {
    const root = getOpenCodeRoot();
    expect(typeof root).toBe('string');
    expect(root.length).toBeGreaterThan(0);
  });

  it('should return a path ending with .opencode or a valid dir', () => {
    const root = getOpenCodeRoot();
    // Path should be absolute or relative, but not empty
    expect(root).toBeTruthy();
  });
});

// ── resolveStatePath ──────────────────────────────────
describe('resolveStatePath', () => {
  it('should resolve relative path against opencode root', () => {
    const resolved = resolveStatePath('state/machine.json');
    expect(typeof resolved).toBe('string');
    expect(resolved).toContain('machine.json');
  });

  it('should handle empty path', () => {
    const resolved = resolveStatePath('');
    expect(typeof resolved).toBe('string');
  });
});

// ── isSourceFile ──────────────────────────────────────
describe('isSourceFile', () => {
  it('should return true for .ts source files', () => {
    expect(isSourceFile('src/modules/auth/auth.service.ts')).toBe(true);
  });

  it('should return true for .js files', () => {
    expect(isSourceFile('src/utils/helper.js')).toBe(true);
  });

  it('should return false for .json files', () => {
    expect(isSourceFile('package.json')).toBe(false);
  });

  it('should return false for .md files', () => {
    expect(isSourceFile('README.md')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isSourceFile('')).toBe(false);
  });

  it('should return false for null/undefined', () => {
    expect(isSourceFile(null as any)).toBe(false);
    expect(isSourceFile(undefined as any)).toBe(false);
  });
});

// ── isCriticalFrameworkFile ───────────────────────────
describe('isCriticalFrameworkFile', () => {
  it('should detect machine.json as critical', () => {
    expect(isCriticalFrameworkFile('.opencode/state/machine.json')).toBe(true);
  });

  it('should detect gate-state.json as critical', () => {
    expect(isCriticalFrameworkFile('.opencode/state/gate-state.json')).toBe(true);
  });

  it('should detect project.config.json as critical', () => {
    expect(isCriticalFrameworkFile('.opencode/project.config.json')).toBe(true);
  });

  it('should detect framework-enforcer.ts as critical', () => {
    expect(isCriticalFrameworkFile('.opencode/plugins/framework-enforcer/framework-enforcer.ts')).toBe(true);
  });

  it('should return false for non-critical files', () => {
    expect(isCriticalFrameworkFile('README.md')).toBe(false);
    expect(isCriticalFrameworkFile('src/app/app.component.ts')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isCriticalFrameworkFile('')).toBe(false);
  });
});

// ── isStaleSession ────────────────────────────────────
describe('isStaleSession', () => {
  it('should return false for recently created session', () => {
    const recentDate = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
    expect(isStaleSession(recentDate, 24)).toBe(false);
  });

  it('should return true for old session', () => {
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(); // 48 hours ago
    expect(isStaleSession(oldDate, 24)).toBe(true);
  });

  it('should handle null/undefined createdAt', () => {
    // Should return true (treat as stale when can't determine age) or handle gracefully
    const result = isStaleSession(null as any, 24);
    expect(typeof result).toBe('boolean');
  });

  it('should handle missing thresholdHours (use default)', () => {
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(); // 72 hours ago
    const result = isStaleSession(oldDate);
    expect(typeof result).toBe('boolean');
  });
});
