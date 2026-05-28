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
export declare class PermissionIsolation {
    checkPermission(agentType: string, tool: string): Promise<PermissionResult>;
    getAgentPermissions(agentType: string): Promise<AgentPermissions>;
    checkWriteScope(agentType: string, filePath: string): Promise<ScopeResult>;
}
export default PermissionIsolation;
