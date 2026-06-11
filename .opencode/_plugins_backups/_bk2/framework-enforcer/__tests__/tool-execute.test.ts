/**
 * __tests__/tool-execute.test.ts — Unit tests for tool execution hooks
 *
 * FW-REPAIR-13: Baseline unit tests for extracted tool-execute module.
 * The toolExecuteBefore/After hooks are the core enforcement engine.
 *
 * @since Phase 4 (P3-2)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolExecuteBefore, toolExecuteAfter } from '../hooks/tool-execute';

// ── Mocks ────────────────────────────────────────────
vi.mock('node:fs', () => ({
  default: { existsSync: vi.fn().mockReturnValue(true), readFileSync: vi.fn().mockReturnValue('{}'), statSync: vi.fn(() => ({ size: 100 })) },
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('{}'),
  statSync: vi.fn(() => ({ size: 100 })),
}));

vi.mock('node:path', () => ({
  default: { join: (...args: string[]) => args.join('/'), dirname: (p: string) => p.split('/').slice(0, -1).join('/'), resolve: (...args: string[]) => args.join('/') },
  join: (...args: string[]) => args.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  resolve: (...args: string[]) => args.join('/'),
}));

vi.mock('node:crypto', () => ({
  default: { createHash: vi.fn(() => ({ update: vi.fn().mockReturnThis(), digest: vi.fn().mockReturnValue('abc') })) },
  createHash: vi.fn(() => ({ update: vi.fn().mockReturnThis(), digest: vi.fn().mockReturnValue('abc') })),
}));

vi.mock('node:module', () => ({
  createRequire: vi.fn(() => vi.fn()),
}));

vi.mock('../../../lib/permission-isolation-core', () => ({
  PermissionIsolation: class {
    isWriteAllowed = vi.fn().mockReturnValue(true);
    checkScope = vi.fn().mockReturnValue({ allowed: true });
  },
}));

vi.mock('../../../lib/gate-core', () => ({
  readJsonFile: vi.fn().mockReturnValue({}),
  findArmedSession: vi.fn().mockReturnValue(null),
  findAnyGateSession: vi.fn().mockReturnValue(null),
  getEnforcementMode: vi.fn(() => 'advisory'),
  computeSHA256: vi.fn(() => 'mock_hash'),
}));

vi.mock('../utils/state-utils', () => ({
  getOpenCodeRoot: vi.fn(() => '/test/.opencode'),
  STATE_PATHS: {
    gateState: () => '/test/.opencode/state/gate-state.json',
    gateIndex: () => '/test/.opencode/state/gate-state.index.json',
    machine: () => '/test/.opencode/state/machine.json',
    auditLog: () => '/test/.opencode/logs/audit.log',
    ruleRegistry: () => '/test/.opencode/state/rule_registry.json',
  },
  isSourceFile: vi.fn(() => false),
  isStaleSession: vi.fn(() => false),
  isCriticalFrameworkFile: vi.fn(() => false),
}));

vi.mock('../utils/audit-log', () => ({
  writeAuditLogEntry: vi.fn(),
  logAuditEntry: vi.fn(),
}));

vi.mock('../checks/gate-checks', () => ({
  checkPluginIntegrity: vi.fn(() => ({})),
  findTaskInDag: vi.fn(() => null),
  isWriteAllowed: vi.fn(() => ({ allowed: true, reason: 'test' })),
  checkStaleSessions: vi.fn(() => 0),
  autoDrainStaleSessions: vi.fn(),
  checkRuleRegistryIntegrity: vi.fn(() => ({})),
  checkMachineCleanliness: vi.fn(() => ({})),
}));

// ── toolExecuteBefore ─────────────────────────────────
describe('toolExecuteBefore', () => {
  const baseInput = {
    tool: 'safe_edit',
    sessionID: 'cg_ses_test_001',
    callID: 'call_001',
  };
  const baseOutput = { args: {} as Record<string, unknown> };

  it('should not throw for valid tool execution', async () => {
    await expect(
      toolExecuteBefore(baseInput, baseOutput)
    ).resolves.toBeUndefined();
  });

  it('should handle dispatch_subagent tool', async () => {
    await expect(
      toolExecuteBefore(
        { ...baseInput, tool: 'dispatch_subagent' },
        { args: { agent_type: 'Architect', task_description: 'test' } }
      )
    ).resolves.toBeUndefined();
  });

  it('should handle compliance_gate_check tool', async () => {
    await expect(
      toolExecuteBefore(
        { ...baseInput, tool: 'compliance_gate_check' },
        { args: { task_description: 'test task' } }
      )
    ).resolves.toBeUndefined();
  });

  it('should not throw for unknown tool', async () => {
    await expect(
      toolExecuteBefore(
        { ...baseInput, tool: 'unknown_tool' },
        baseOutput
      )
    ).resolves.toBeUndefined();
  });

  it('should handle empty args', async () => {
    await expect(
      toolExecuteBefore(baseInput, { args: {} })
    ).resolves.toBeUndefined();
  });
});

// ── toolExecuteAfter ──────────────────────────────────
describe('toolExecuteAfter', () => {
  it('should not throw for valid post-execution audit', async () => {
    await expect(
      toolExecuteAfter(
        { tool: 'safe_edit', sessionID: 'cg_test', callID: 'call_001' },
        { result: { success: true } }
      )
    ).resolves.toBeUndefined();
  });

  it('should handle failed tool execution', async () => {
    await expect(
      toolExecuteAfter(
        { tool: 'safe_edit', sessionID: 'cg_test', callID: 'call_001' },
        { result: { success: false, error: 'test error' } }
      )
    ).resolves.toBeUndefined();
  });

  it('should handle empty result', async () => {
    await expect(
      toolExecuteAfter(
        { tool: 'unknown', sessionID: 'cg_test', callID: 'call_001' },
        { result: {} }
      )
    ).resolves.toBeUndefined();
  });
});
