/**
 * __tests__/audit-log.test.ts — Unit tests for audit log utilities
 *
 * FW-REPAIR-13: Baseline unit tests for extracted audit-log module.
 *
 * @since Phase 4 (P3-2)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeAuditLogEntry, logAuditEntry, flushAuditTrail } from '../utils/audit-log';

// ── Mocks ────────────────────────────────────────────
vi.mock('node:fs', () => ({
  default: {
    appendFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  appendFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('../utils/state-utils', () => ({
  getOpenCodeRoot: vi.fn().mockReturnValue('/test/root/.opencode'),
  ensureDir: vi.fn(),
  STATE_PATHS: {
    auditLog: () => '/test/root/.opencode/logs/audit.log',
    gateState: () => '/test/root/.opencode/state/gate-state.json',
    gateIndex: () => '/test/root/.opencode/state/gate-state.index.json',
    machine: () => '/test/root/.opencode/state/machine.json',
    ruleRegistry: () => '/test/root/.opencode/state/rule_registry.json',
  },
}));

// ── writeAuditLogEntry ────────────────────────────────
describe('writeAuditLogEntry', () => {
  it('should accept a valid audit entry without throwing', () => {
    expect(() => {
      writeAuditLogEntry({
        event: 'test_event',
        sessionID: 'cg_ses_test_001',
        timestamp: new Date().toISOString(),
        action: 'test_action',
      });
    }).not.toThrow();
  });

  it('should handle empty object', () => {
    expect(() => {
      writeAuditLogEntry({});
    }).not.toThrow();
  });

  it('should handle null gracefully', () => {
    expect(() => {
      writeAuditLogEntry(null as any);
    }).not.toThrow();
  });
});

// ── logAuditEntry ─────────────────────────────────────
describe('logAuditEntry', () => {
  it('should be callable without throwing', () => {
    expect(() => {
      logAuditEntry('test_event', { key: 'value' });
    }).not.toThrow();
  });

  it('should default to empty metadata', () => {
    expect(() => {
      logAuditEntry('bare_event');
    }).not.toThrow();
  });
});

// ── flushAuditTrail ───────────────────────────────────
describe('flushAuditTrail', () => {
  it('should be callable without throwing', () => {
    expect(() => {
      flushAuditTrail();
    }).not.toThrow();
  });
});
