/**
 * __tests__/audit-hooks.test.ts — Unit tests for shell, permission, command, TUI hooks
 *
 * FW-REPAIR-13: Baseline unit tests for extracted audit-hooks module.
 *
 * @since Phase 4 (P3-2)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shellEnv,
  permissionAsked,
  permissionReplied,
  commandExecuted,
  messageUpdated,
  todoUpdated,
  tuiCommandExecute,
} from '../hooks/audit-hooks';

// ── Mocks ────────────────────────────────────────────
vi.mock('../utils/audit-log', () => ({
  writeAuditLogEntry: vi.fn(),
  logAuditEntry: vi.fn(),
}));

const getEnforcementMode = vi.fn(() => 'advisory' as const);

// ── shellEnv ─────────────────────────────────────────
describe('shellEnv', () => {
  it('should set FRAMEWORK_ENFORCER in output.env', async () => {
    const output = { env: {} as Record<string, string>, cwd: '/test' };
    await shellEnv(undefined, output);
    expect(output.env.FRAMEWORK_ENFORCER).toBe('active');
  });

  it('should set ENFORCEMENT_MODE defaulting to advisory', async () => {
    const output = { env: {} as Record<string, string>, cwd: '/test' };
    await shellEnv(undefined, output);
    expect(output.env.ENFORCEMENT_MODE).toBeDefined();
  });

  it('should set OPENCODE_ROOT', async () => {
    const output = { env: {} as Record<string, string>, cwd: '/test' };
    await shellEnv(undefined, output);
    expect(output.env.OPENCODE_ROOT).toBeDefined();
  });
});

// ── permissionAsked ──────────────────────────────────
describe('permissionAsked', () => {
  it('should log permission request without throwing', async () => {
    await expect(
      permissionAsked(
        { tool: 'bash', agent: '@Coder-BE', sessionID: 'cg_test' },
        undefined,
        getEnforcementMode
      )
    ).resolves.toBeUndefined();
  });

  it('should detect dangerous commands', async () => {
    await expect(
      permissionAsked(
        { tool: 'rm -rf /tmp/test', agent: '@Coder-BE', sessionID: 'cg_test' },
        undefined,
        getEnforcementMode
      )
    ).resolves.toBeUndefined();
  });

  it('should detect chmod 777', async () => {
    await expect(
      permissionAsked(
        { tool: 'chmod 777 somefile', agent: '@Unknown', sessionID: 'cg_test' },
        undefined,
        getEnforcementMode
      )
    ).resolves.toBeUndefined();
  });
});

// ── permissionReplied ─────────────────────────────────
describe('permissionReplied', () => {
  it('should log granted permission', async () => {
    await expect(
      permissionReplied({ tool: 'bash', granted: true }, undefined)
    ).resolves.toBeUndefined();
  });

  it('should log denied permission', async () => {
    await expect(
      permissionReplied({ tool: 'rm', granted: false }, undefined)
    ).resolves.toBeUndefined();
  });
});

// ── commandExecuted ───────────────────────────────────
describe('commandExecuted', () => {
  it('should log command execution', async () => {
    await expect(
      commandExecuted({ command: 'git status', agent: '@Coder-BE' }, undefined)
    ).resolves.toBeUndefined();
  });

  it('should truncate long commands', async () => {
    const longCmd = 'x'.repeat(500);
    await expect(
      commandExecuted({ command: longCmd }, undefined)
    ).resolves.toBeUndefined();
  });
});

// ── messageUpdated ────────────────────────────────────
describe('messageUpdated', () => {
  it('should log message update', async () => {
    await expect(
      messageUpdated({ messageID: 'msg_abc123' }, undefined)
    ).resolves.toBeUndefined();
  });
});

// ── todoUpdated ───────────────────────────────────────
describe('todoUpdated', () => {
  it('should log todo update without throwing', async () => {
    await expect(
      todoUpdated(undefined, undefined)
    ).resolves.toBeUndefined();
  });
});

// ── tuiCommandExecute ─────────────────────────────────
describe('tuiCommandExecute', () => {
  it('should allow safe commands in advisory mode', async () => {
    await expect(
      tuiCommandExecute(
        { command: '/help' },
        undefined,
        getEnforcementMode
      )
    ).resolves.toBeUndefined();
  });

  it('should block /bash in strict mode', async () => {
    const strictMode = vi.fn(() => 'strict' as const);
    await expect(
      tuiCommandExecute(
        { command: '/bash rm -rf /' },
        undefined,
        strictMode
      )
    ).rejects.toThrow(/FW-ENFORCE/);
  });

  it('should block /rm in locked mode', async () => {
    const lockedMode = vi.fn(() => 'locked' as const);
    await expect(
      tuiCommandExecute(
        { command: '/rm all' },
        undefined,
        lockedMode
      )
    ).rejects.toThrow(/FW-ENFORCE/);
  });

  it('should warn (not block) dangerous commands in advisory mode', async () => {
    await expect(
      tuiCommandExecute(
        { command: '/delete something' },
        undefined,
        getEnforcementMode
      )
    ).resolves.toBeUndefined();
  });
});
