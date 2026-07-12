/**
 * permission-isolation-core.ts — Shared Permission Isolation Logic
 * ================================================================
 *
 * DEPRECATED (2026-07-07): PermissionIsolation class with hardcoded per-agent
 * profiles has 0 runtime callers in production code. Phase 3 enforcement
 * slimming replaces per-agent permission profiles with behavior-based checks
 * (tool + path + operation type, independent of agent identity).
 * All runtime permission enforcement flows through service/permission/reader.ts.
 *
 * Extracted from .opencode/tools/permission-isolation.ts.
 * Core permission check logic, scope validation, and audit logging.
 *
 * Exports:
 *   - PermissionIsolation class with checkPermission, getAgentPermissions, checkWriteScope
 *   - PermissionResult, AgentPermissions, ScopeResult interfaces
 *   - PERMISSION_PROFILES constant
 *
 * @author @Architect
 * @version 1.0.0
 */

// ════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

export interface AgentPermissions {
  agentType: string;
  tools: {
    edit: 'allow' | 'deny';
    bash: 'allow' | 'deny';
    task: 'allow' | 'deny';
  };
}

export interface ScopeResult {
  allowed: boolean;
  reason?: string;
  deniedPaths?: string[];
}

// ════════════════════════════════════════════════════════════
// CONSTANTS — Single source of truth
// ════════════════════════════════════════════════════════════

/**
 * Permission profiles for all known agent types.
 * Maps agent type to allowed/denied tools.
 */
export const PERMISSION_PROFILES: Record<string, AgentPermissions> = {
  '@Coder-BE': {
    agentType: '@Coder-BE',
    tools: { edit: 'deny', bash: 'allow', task: 'allow' },
  },
  '@Coder-BE-readonly': {
    agentType: '@Coder-BE-readonly',
    tools: { edit: 'deny', bash: 'deny', task: 'deny' },
  },
  '@Coder-FE': {
    agentType: '@Coder-FE',
    tools: { edit: 'deny', bash: 'deny', task: 'allow' },
  },
  '@Guardian': {
    agentType: '@Guardian',
    tools: { edit: 'deny', bash: 'allow', task: 'deny' },
  },
  '@Architect': {
    agentType: '@Architect',
    tools: { edit: 'allow', bash: 'deny', task: 'deny' },
  },
  '@Arbiter': {
    agentType: '@Arbiter',
    tools: { edit: 'deny', bash: 'deny', task: 'deny' },
  },
  '@CI-CD-Agent': {
    agentType: '@CI-CD-Agent',
    tools: { edit: 'allow', bash: 'allow', task: 'allow' },
  },
  '@Orchestrator': {
    agentType: '@Orchestrator',
    tools: { edit: 'deny', bash: 'deny', task: 'allow' },
  },
  /**
   * @Super-Admin — Emergency framework repair only, human-invoked.
   * Full permissions: bypasses all tool constraints for emergency framework
   * surgery. Edit, bash, and task are all allowed. NOT bypassed: compliance
   * gate lifecycle, audit logging, business code restrictions.
   *
   * @public — Used by PermissionIsolation.checkPermission() for permission verification.
   * @since 2026-06-03 (FW-ENHANCE-A3)
   */
  '@Super-Admin': {
    agentType: '@Super-Admin',
    tools: { edit: 'allow', bash: 'allow', task: 'allow' },
  },
};

/**
 * Directory patterns that are denied for ALL agent write operations.
 */
export const DENIED_WRITE_PATTERNS: string[] = ['/etc/', 'node_modules'];

/**
 * Valid tool names for permission checking.
 */
export const VALID_TOOLS = new Set(['edit', 'bash', 'task']);

// ════════════════════════════════════════════════════════════
// PermissionIsolation Class
// ════════════════════════════════════════════════════════════

export class PermissionIsolation {
  /**
   * Check if a specific agent has permission to use a specific tool.
   *
   * @public — Used by PermissionIsolation plugin tool.execute.before hook.
   */
  async checkPermission(
    agentType: string,
    tool: string,
  ): Promise<PermissionResult> {
    if (!VALID_TOOLS.has(tool)) {
      throw new Error(
        `Unknown tool: "${tool}". Valid tools are: edit, bash, task`,
      );
    }

    const profile = PERMISSION_PROFILES[agentType];
    if (!profile) {
      throw new Error(
        `Unknown agent type: "${agentType}". No permission profile found.`,
      );
    }

    const permission = profile.tools[tool as keyof typeof profile.tools];
    const allowed = permission === 'allow';

    return {
      allowed,
      ...(allowed
        ? {}
        : {
            reason: `Permission denied: ${tool} is ${permission} for ${agentType}`,
          }),
    };
  }

  /**
   * Get the full permission profile for an agent type.
   *
   * @public — Permission profile query; used by framework-enforcer and audit tools.
   */
  async getAgentPermissions(agentType: string): Promise<AgentPermissions> {
    const profile = PERMISSION_PROFILES[agentType];
    if (!profile) {
      throw new Error(
        `Unknown agent type: "${agentType}". No permission profile found.`,
      );
    }

    return { ...profile, tools: { ...profile.tools } };
  }

  /**
   * Check whether an agent's write scope allows writing to a file path.
   * Denied patterns always win over allowed patterns.
   *
   * @public — Global write protection check; used by framework-enforcer.ts.
   */
  async checkWriteScope(
    agentType: string,
    filePath: string,
  ): Promise<ScopeResult> {
    const matchedPatterns: string[] = [];

    for (const pattern of DENIED_WRITE_PATTERNS) {
      if (filePath.includes(pattern)) {
        matchedPatterns.push(pattern);
      }
    }

    if (matchedPatterns.length > 0) {
      return {
        allowed: false,
        reason: `Write scope violation: ${matchedPatterns.join(', ')}`,
        deniedPaths: matchedPatterns,
      };
    }

    return { allowed: true };
  }
}

export default PermissionIsolation;
