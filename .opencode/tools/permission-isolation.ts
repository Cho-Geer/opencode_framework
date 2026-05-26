/**
 * permission-isolation.ts — CI-STRENGTHEN-004 GREEN Phase Implementation
 * ===================================================================
 *
 * Permission isolation system for multi-agent security.
 * Enforces tool-level permissions (edit, bash, task) per agent identity,
 * plus write-scope restrictions for denied directory patterns.
 */

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

const PERMISSION_PROFILES: Record<string, AgentPermissions> = {
  '@Coder-BE': { agentType: '@Coder-BE', tools: { edit: 'deny', bash: 'allow', task: 'allow' } },
  '@Coder-BE-readonly': { agentType: '@Coder-BE-readonly', tools: { edit: 'deny', bash: 'deny', task: 'deny' } },
  '@Coder-FE': { agentType: '@Coder-FE', tools: { edit: 'deny', bash: 'deny', task: 'allow' } },
  '@Guardian': { agentType: '@Guardian', tools: { edit: 'deny', bash: 'allow', task: 'deny' } },
  '@Architect': { agentType: '@Architect', tools: { edit: 'allow', bash: 'deny', task: 'deny' } },
  '@Arbiter': { agentType: '@Arbiter', tools: { edit: 'deny', bash: 'deny', task: 'deny' } },
  '@CI-CD-Agent': { agentType: '@CI-CD-Agent', tools: { edit: 'allow', bash: 'allow', task: 'allow' } },
  '@Meta-Planner': { agentType: '@Meta-Planner', tools: { edit: 'deny', bash: 'deny', task: 'allow' } },
  '@Orchestrator': { agentType: '@Orchestrator', tools: { edit: 'deny', bash: 'deny', task: 'allow' } },
};

const DENIED_WRITE_PATTERNS: string[] = ['/etc/', 'node_modules'];
const VALID_TOOLS = new Set(['edit', 'bash', 'task']);

export class PermissionIsolation {
  async checkPermission(agentType: string, tool: string): Promise<PermissionResult> {
    if (!VALID_TOOLS.has(tool)) {
      throw new Error(`Unknown tool: "${tool}". Valid tools are: edit, bash, task`);
    }
    const profile = PERMISSION_PROFILES[agentType];
    if (!profile) {
      throw new Error(`Unknown agent type: "${agentType}". No permission profile found.`);
    }
    const permission = profile.tools[tool as keyof typeof profile.tools];
    const allowed = permission === 'allow';
    return {
      allowed,
      ...(allowed ? {} : { reason: `Permission denied: ${tool} is ${permission} for ${agentType}` }),
    };
  }

  async getAgentPermissions(agentType: string): Promise<AgentPermissions> {
    const profile = PERMISSION_PROFILES[agentType];
    if (!profile) {
      throw new Error(`Unknown agent type: "${agentType}". No permission profile found.`);
    }
    return { ...profile, tools: { ...profile.tools } };
  }

  async checkWriteScope(agentType: string, filePath: string): Promise<ScopeResult> {
    const matchedPatterns: string[] = [];
    for (const pattern of DENIED_WRITE_PATTERNS) {
      if (filePath.includes(pattern)) matchedPatterns.push(pattern);
    }
    if (matchedPatterns.length > 0) {
      return { allowed: false, reason: `Write scope violation: ${matchedPatterns.join(', ')}`, deniedPaths: matchedPatterns };
    }
    return { allowed: true };
  }
}

export default PermissionIsolation;
