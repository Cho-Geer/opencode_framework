/**
 * permission-isolation.test.ts — CI-STRENGTHEN-004 RED Phase (Failing Tests)
 * ============================================================================
 *
 * RED phase test file for the PermissionIsolation module.
 * These tests MUST fail (exit code != 0) because the PermissionIsolation
 * module has not been implemented yet (CI-STRENGTHEN-005 GREEN phase).
 *
 * When PermissionIsolation IS implemented, these tests should all pass (exit code 0).
 *
 * Test coverage:
 *   1) edit:deny enforcement         — permission.edit === 'deny' blocks writes
 *   2) bash:deny enforcement         — permission.bash === 'deny' blocks shell exec
 *   3) task:deny enforcement         — permission.task === 'deny' blocks task spawning
 *   4) Mixed permissions             — one deny does not affect other tools
 *   5) Agent identity isolation      — different agent types get different profiles
 *   6) Write scope enforcement       — denied directory paths reject writes
 *   7) Role-based access pattern     — correct agent gets correct tool perms
 *
 * Design: CI-STRENGTHEN-004 / permission-isolation spec
 */

import { PermissionIsolation, PermissionResult, AgentPermissions, ScopeResult } from '../permission-isolation';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite: PermissionIsolation
// ═══════════════════════════════════════════════════════════════════════════════

describe('PermissionIsolation', () => {
  let permissionIsolation: PermissionIsolation;

  beforeAll(() => {
    // Instantiate the PermissionIsolation module.
    // In RED phase this import will already throw MODULE_NOT_FOUND,
    // but Jest will report the failure as intended.
    permissionIsolation = new PermissionIsolation();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: edit:deny enforcement
  // ─────────────────────────────────────────────────────────────────────────────
  describe('edit:deny enforcement', () => {
    it('should block write/edit operations when permission.edit is "deny"', async () => {
      const result: PermissionResult = await permissionIsolation.checkPermission('@Coder-BE-readonly', 'edit');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason!.toLowerCase()).toMatch(/denied|blocked|not.allowed|forbidden/i);
    });

    it('should return a non-empty reason when edit is denied', async () => {
      const result: PermissionResult = await permissionIsolation.checkPermission('@Coder-BE-readonly', 'edit');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeTruthy();
      expect(result.reason!.length).toBeGreaterThan(0);
    });

    it('should allow edit when permission.edit is "allow"', async () => {
      const result: PermissionResult = await permissionIsolation.checkPermission('@Coder-BE', 'edit');

      expect(result.allowed).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: bash:deny enforcement
  // ─────────────────────────────────────────────────────────────────────────────
  describe('bash:deny enforcement', () => {
    it('should block shell execution when permission.bash is "deny"', async () => {
      const result: PermissionResult = await permissionIsolation.checkPermission('@Coder-BE-readonly', 'bash');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason!.toLowerCase()).toMatch(/denied|blocked|not.allowed|forbidden/i);
    });

    it('should allow shell execution when permission.bash is "allow"', async () => {
      const result: PermissionResult = await permissionIsolation.checkPermission('@Coder-BE', 'bash');

      expect(result.allowed).toBe(true);
    });

    it('should reject unknown tool names with a clear error', async () => {
      await expect(
        permissionIsolation.checkPermission('@Coder-BE', 'unknown-tool' as any),
      ).rejects.toThrow(/unknown|invalid|not.recognized/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: task:deny enforcement
  // ─────────────────────────────────────────────────────────────────────────────
  describe('task:deny enforcement', () => {
    it('should block task spawning when permission.task is "deny"', async () => {
      const result: PermissionResult = await permissionIsolation.checkPermission('@Coder-BE-readonly', 'task');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason!.toLowerCase()).toMatch(/denied|blocked|not.allowed|forbidden/i);
    });

    it('should allow task spawning when permission.task is "allow"', async () => {
      const result: PermissionResult = await permissionIsolation.checkPermission('@Coder-BE', 'task');

      expect(result.allowed).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4: Mixed permissions — one deny does not block other tools
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Mixed permissions', () => {
    it('should allow edit even when bash is denied', async () => {
      // Agent with bash:deny but edit:allow
      const bashResult = await permissionIsolation.checkPermission('@Coder-FE', 'bash');
      const editResult = await permissionIsolation.checkPermission('@Coder-FE', 'edit');

      // bash should be denied
      expect(bashResult.allowed).toBe(false);
      // edit should still be allowed
      expect(editResult.allowed).toBe(true);
    });

    it('should allow bash even when task is denied', async () => {
      // Agent with task:deny but bash:allow
      const taskResult = await permissionIsolation.checkPermission('@Guardian', 'task');
      const bashResult = await permissionIsolation.checkPermission('@Guardian', 'bash');

      expect(taskResult.allowed).toBe(false);
      expect(bashResult.allowed).toBe(true);
    });

    it('should not leak denied status across different tool checks', async () => {
      const results = await Promise.all([
        permissionIsolation.checkPermission('@Coder-BE-readonly', 'edit'),
        permissionIsolation.checkPermission('@Coder-BE-readonly', 'bash'),
        permissionIsolation.checkPermission('@Coder-BE-readonly', 'task'),
      ]);

      // All three tools should be denied for read-only agent
      results.forEach((result: PermissionResult) => {
        expect(result.allowed).toBe(false);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 5: Agent identity isolation
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Agent identity isolation', () => {
    it('should return different permission profiles for different agent types', async () => {
      const [bePerms, fePerms, archPerms]: AgentPermissions[] = await Promise.all([
        permissionIsolation.getAgentPermissions('@Coder-BE'),
        permissionIsolation.getAgentPermissions('@Coder-FE'),
        permissionIsolation.getAgentPermissions('@Architect'),
      ]);

      // Agent types should be correctly reflected
      expect(bePerms.agentType).toBe('@Coder-BE');
      expect(fePerms.agentType).toBe('@Coder-FE');
      expect(archPerms.agentType).toBe('@Architect');

      // Profiles should differ — at minimum one tool permission differs
      const allSameEdit = bePerms.tools.edit === fePerms.tools.edit
                        && fePerms.tools.edit === archPerms.tools.edit;
      const allSameBash = bePerms.tools.bash === fePerms.tools.bash
                        && fePerms.tools.bash === archPerms.tools.bash;
      const allSameTask = bePerms.tools.task === fePerms.tools.task
                        && fePerms.tools.task === archPerms.tools.task;

      // At least one permission dimension should differ between roles
      expect(allSameEdit && allSameBash && allSameTask).toBe(false);
    });

    it('should fail with a descriptive error for unknown agent types', async () => {
      await expect(
        permissionIsolation.getAgentPermissions('@Unknown-Agent'),
      ).rejects.toThrow(/unknown|invalid|not.found|unrecognized/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 6: Write scope enforcement
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Write scope enforcement', () => {
    it('should reject write attempts to denied directories', async () => {
      const result: ScopeResult = await permissionIsolation.checkWriteScope(
        '@Coder-BE',
        '/etc/passwd',
      );

      expect(result.allowed).toBe(false);
      expect(result.deniedPaths).toBeDefined();
      expect(result.deniedPaths!.length).toBeGreaterThan(0);
    });

    it('should allow write attempts to permitted directories', async () => {
      const result: ScopeResult = await permissionIsolation.checkWriteScope(
        '@Coder-BE',
        '/home/zhaoge/workspace/opencode/work-one/.opencode/tools/test-output.txt',
      );

      expect(result.allowed).toBe(true);
    });

    it('should correctly handle paths matching deny patterns', async () => {
      // Paths containing "node_modules" should be denied for writes
      const result: ScopeResult = await permissionIsolation.checkWriteScope(
        '@Coder-BE',
        '/home/zhaoge/workspace/opencode/work-one/node_modules/some-patch.txt',
      );

      expect(result.allowed).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 7: Role-based access pattern
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Role-based access pattern', () => {
    it('should provide correct tool permissions for @Coder-BE (edit+ allow, no restrictions)', async () => {
      const perms: AgentPermissions = await permissionIsolation.getAgentPermissions('@Coder-BE');

      expect(perms.agentType).toBe('@Coder-BE');
      expect(perms.tools.edit).toBe('allow');
      expect(perms.tools.bash).toBe('allow');
      expect(perms.tools.task).toBe('allow');
    });

    it('should provide read-only permissions for @Coder-BE-readonly', async () => {
      const perms: AgentPermissions = await permissionIsolation.getAgentPermissions('@Coder-BE-readonly');

      expect(perms.agentType).toBe('@Coder-BE-readonly');
      expect(perms.tools.edit).toBe('deny');
      expect(perms.tools.bash).toBe('deny');
      expect(perms.tools.task).toBe('deny');
    });

    it('should provide restricted bash for @Coder-FE (edit:allow, bash:deny, task:allow)', async () => {
      const perms: AgentPermissions = await permissionIsolation.getAgentPermissions('@Coder-FE');

      expect(perms.agentType).toBe('@Coder-FE');
      expect(perms.tools.edit).toBe('allow');
      expect(perms.tools.bash).toBe('deny');
      expect(perms.tools.task).toBe('allow');
    });

    it('should provide restricted task for @Guardian (edit:deny, bash:allow, task:deny)', async () => {
      const perms: AgentPermissions = await permissionIsolation.getAgentPermissions('@Guardian');

      expect(perms.agentType).toBe('@Guardian');
      expect(perms.tools.edit).toBe('deny');
      expect(perms.tools.bash).toBe('allow');
      expect(perms.tools.task).toBe('deny');
    });

    it('should return a comprehensive permission profile with all required fields', async () => {
      const perms: AgentPermissions = await permissionIsolation.getAgentPermissions('@Coder-BE');

      // Verify all expected fields are present
      expect(perms).toHaveProperty('agentType');
      expect(perms).toHaveProperty('tools');
      expect(perms.tools).toHaveProperty('edit');
      expect(perms.tools).toHaveProperty('bash');
      expect(perms.tools).toHaveProperty('task');

      // Verify enum values
      expect(['allow', 'deny']).toContain(perms.tools.edit);
      expect(['allow', 'deny']).toContain(perms.tools.bash);
      expect(['allow', 'deny']).toContain(perms.tools.task);
    });
  });
});
