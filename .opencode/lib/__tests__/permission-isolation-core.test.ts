/**
 * permission-isolation-core.test.ts — TDD RED phase tests
 */

const {
  PermissionIsolation,
  PERMISSION_PROFILES,
  DENIED_WRITE_PATTERNS,
  VALID_TOOLS,
} = require('../permission-isolation-core');

describe('permission-isolation-core', () => {
  let pi: any;

  beforeEach(() => {
    pi = new PermissionIsolation();
  });

  describe('PERMISSION_PROFILES', () => {
    it('should have profiles for all known agents', () => {
      expect(PERMISSION_PROFILES['@Coder-BE']).toBeDefined();
      expect(PERMISSION_PROFILES['@Coder-FE']).toBeDefined();
      expect(PERMISSION_PROFILES['@Architect']).toBeDefined();
      expect(PERMISSION_PROFILES['@Guardian']).toBeDefined();
      expect(PERMISSION_PROFILES['@Arbiter']).toBeDefined();
      expect(PERMISSION_PROFILES['@CI-CD-Agent']).toBeDefined();
      expect(PERMISSION_PROFILES['@Meta-Planner']).toBeDefined();
      expect(PERMISSION_PROFILES['@Orchestrator']).toBeDefined();
    });

    it('should define tool permissions for each agent', () => {
      for (const [name, profile] of Object.entries(PERMISSION_PROFILES)) {
        expect((profile as any).tools.edit).toMatch(/^(allow|deny)$/);
        expect((profile as any).tools.bash).toMatch(/^(allow|deny)$/);
        expect((profile as any).tools.task).toMatch(/^(allow|deny)$/);
      }
    });
  });

  describe('DENIED_WRITE_PATTERNS', () => {
    it('should block /etc/ paths', () => {
      expect(DENIED_WRITE_PATTERNS).toContain('/etc/');
    });

    it('should block node_modules paths', () => {
      expect(DENIED_WRITE_PATTERNS).toContain('node_modules');
    });
  });

  describe('VALID_TOOLS', () => {
    it('should contain edit, bash, task', () => {
      expect(VALID_TOOLS.has('edit')).toBe(true);
      expect(VALID_TOOLS.has('bash')).toBe(true);
      expect(VALID_TOOLS.has('task')).toBe(true);
    });
  });

  describe('checkPermission', () => {
    it('should throw for unknown agent type', async () => {
      await expect(pi.checkPermission('@Unknown', 'edit')).rejects.toThrow('Unknown agent type');
    });

    it('should throw for unknown tool', async () => {
      await expect(pi.checkPermission('@Coder-BE', 'unknown-tool')).rejects.toThrow('Unknown tool');
    });

    it('should deny edit for @Coder-BE', async () => {
      const result = await pi.checkPermission('@Coder-BE', 'edit');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('denied');
    });

    it('should allow bash for @Coder-BE', async () => {
      const result = await pi.checkPermission('@Coder-BE', 'bash');
      expect(result.allowed).toBe(true);
    });

    it('should allow edit for @Architect', async () => {
      const result = await pi.checkPermission('@Architect', 'edit');
      expect(result.allowed).toBe(true);
    });
  });

  describe('getAgentPermissions', () => {
    it('should return a copy of the permission profile', async () => {
      const profile = await pi.getAgentPermissions('@Coder-BE');
      expect(profile.agentType).toBe('@Coder-BE');
      expect((profile as any).tools.edit).toBe('deny');
    });

    it('should throw for unknown agent', async () => {
      await expect(pi.getAgentPermissions('@Unknown')).rejects.toThrow('Unknown agent type');
    });
  });

  describe('checkWriteScope', () => {
    it('should allow writing to safe paths', async () => {
      const result = await pi.checkWriteScope('@Coder-BE', '/tmp/test.ts');
      expect(result.allowed).toBe(true);
    });

    it('should deny writing to /etc/ paths', async () => {
      const result = await pi.checkWriteScope('@Coder-BE', '/etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Write scope violation');
    });

    it('should deny writing to node_modules paths', async () => {
      const result = await pi.checkWriteScope('@Coder-BE', '/project/node_modules/pkg/index.ts');
      expect(result.allowed).toBe(false);
    });
  });
});
