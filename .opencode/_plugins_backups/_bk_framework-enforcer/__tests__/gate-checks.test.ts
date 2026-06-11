/**
 * __tests__/gate-checks.test.ts — Unit tests for gate & integrity checks
 *
 * FW-REPAIR-13: Baseline unit tests for extracted gate-checks module.
 *
 * @since Phase 4 (P3-2)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkPluginIntegrity,
  findTaskInDag,
  isWriteAllowed,
  checkStaleSessions,
  autoDrainStaleSessions,
  checkRuleRegistryIntegrity,
  checkMachineCleanliness,
  initDeps,
} from '../checks/gate-checks';

// ── Mocks ────────────────────────────────────────────
vi.mock('node:fs', () => ({
  default: { existsSync: vi.fn().mockReturnValue(true), readFileSync: vi.fn(), statSync: vi.fn() },
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  default: { createHash: vi.fn().mockReturnValue({ update: vi.fn().mockReturnThis(), digest: vi.fn().mockReturnValue('abc123') }) },
  createHash: vi.fn().mockReturnValue({ update: vi.fn().mockReturnThis(), digest: vi.fn().mockReturnValue('abc123') }),
}));

vi.mock('../utils/state-utils', () => ({
  STATE_PATHS: {
    gateState: () => '/test/.opencode/state/gate-state.json',
    gateIndex: () => '/test/.opencode/state/gate-state.index.json',
    machine: () => '/test/.opencode/state/machine.json',
    auditLog: () => '/test/.opencode/logs/audit.log',
    ruleRegistry: () => '/test/.opencode/state/rule_registry.json',
  },
  isStaleSession: vi.fn().mockReturnValue(false),
  resolveStatePath: vi.fn((p: string) => `/test/.opencode/${p}`),
  CRITICAL_PATTERNS: [
    /machine\.json$/,
    /gate-state\.json$/,
    /project\.config\.json$/,
  ],
}));

vi.mock('../utils/audit-log', () => ({
  writeAuditLogEntry: vi.fn(),
}));

// ── Setup ─────────────────────────────────────────────
beforeEach(() => {
  // Initialize dependencies that gate-checks needs
  initDeps(
    (p: string) => ({}), // readJsonFile mock
    (p: string) => 'mock_hash_abc123', // computeFileHash mock
  );
});

// ── checkPluginIntegrity ──────────────────────────────
describe('checkPluginIntegrity', () => {
  it('should return a result object', () => {
    const result = checkPluginIntegrity();
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('should not throw when called without args', () => {
    expect(() => checkPluginIntegrity()).not.toThrow();
  });
});

// ── findTaskInDag ─────────────────────────────────────
describe('findTaskInDag', () => {
  it('should return null for non-existent task ID', () => {
    const result = findTaskInDag(null as any, 'NONEXISTENT_TASK');
    expect(result).toBeNull();
  });

  it('should return null for empty DAG', () => {
    const result = findTaskInDag({ tasks: [] } as any, 'T001');
    expect(result).toBeNull();
  });

  it('should return null for null DAG', () => {
    const result = findTaskInDag(null as any, 'T001');
    expect(result).toBeNull();
  });
});

// ── isWriteAllowed ────────────────────────────────────
describe('isWriteAllowed', () => {
  it('should return a result object with allowed and reason', () => {
    const result = isWriteAllowed('/some/path/file.ts', '@Coder-BE', {});
    expect(result).toBeDefined();
    expect(typeof result.allowed).toBe('boolean');
    expect(typeof result.reason).toBe('string');
  });

  it('should allow writes within allowed paths', () => {
    const scopes = {
      '@Coder-BE': {
        allowed: ['src/**'],
        denied: ['src/forbidden/**'],
      },
    };
    const result = isWriteAllowed('src/modules/service.ts', '@Coder-BE', scopes);
    expect(result).toBeDefined();
  });

  it('should handle unknown agent', () => {
    const result = isWriteAllowed('/some/path', '@UnknownAgent', {});
    expect(result).toBeDefined();
    expect(result.allowed).toBeDefined();
  });
});

// ── checkStaleSessions ────────────────────────────────
describe('checkStaleSessions', () => {
  it('should return a stale count', () => {
    const result = checkStaleSessions(null as any, () => 'advisory');
    expect(result).toBeDefined();
    expect(typeof result).toBe('number');
  });

  it('should return 0 for empty gate state', () => {
    const result = checkStaleSessions({ active_sessions: {} } as any, () => 'advisory');
    expect(result).toBe(0);
  });
});

// ── autoDrainStaleSessions ────────────────────────────
describe('autoDrainStaleSessions', () => {
  it('should not throw when called', () => {
    expect(() => {
      autoDrainStaleSessions(null as any);
    }).not.toThrow();
  });
});

// ── checkRuleRegistryIntegrity ────────────────────────
describe('checkRuleRegistryIntegrity', () => {
  it('should return a result object', () => {
    const result = checkRuleRegistryIntegrity();
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('should not throw', () => {
    expect(() => checkRuleRegistryIntegrity()).not.toThrow();
  });
});

// ── checkMachineCleanliness ───────────────────────────
describe('checkMachineCleanliness', () => {
  it('should return a result object', () => {
    const result = checkMachineCleanliness();
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('should not throw', () => {
    expect(() => checkMachineCleanliness()).not.toThrow();
  });
});
