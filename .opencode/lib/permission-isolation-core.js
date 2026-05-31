/**
 * permission-isolation-core.ts — Shared Permission Isolation Logic
 * ================================================================
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
// CONSTANTS — Single source of truth
// ════════════════════════════════════════════════════════════
/**
 * Permission profiles for all known agent types.
 * Maps agent type to allowed/denied tools.
 */
export const PERMISSION_PROFILES = {
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
    '@Meta-Planner': {
        agentType: '@Meta-Planner',
        tools: { edit: 'deny', bash: 'deny', task: 'allow' },
    },
    '@Orchestrator': {
        agentType: '@Orchestrator',
        tools: { edit: 'deny', bash: 'deny', task: 'allow' },
    },
};
/**
 * Directory patterns that are denied for ALL agent write operations.
 */
export const DENIED_WRITE_PATTERNS = ['/etc/', 'node_modules'];
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
     */
    async checkPermission(agentType, tool) {
        if (!VALID_TOOLS.has(tool)) {
            throw new Error(`Unknown tool: "${tool}". Valid tools are: edit, bash, task`);
        }
        const profile = PERMISSION_PROFILES[agentType];
        if (!profile) {
            throw new Error(`Unknown agent type: "${agentType}". No permission profile found.`);
        }
        const permission = profile.tools[tool];
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
     */
    async getAgentPermissions(agentType) {
        const profile = PERMISSION_PROFILES[agentType];
        if (!profile) {
            throw new Error(`Unknown agent type: "${agentType}". No permission profile found.`);
        }
        return { ...profile, tools: { ...profile.tools } };
    }
    /**
     * Check whether an agent's write scope allows writing to a file path.
     * Denied patterns always win over allowed patterns.
     */
    async checkWriteScope(agentType, filePath) {
        const matchedPatterns = [];
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
