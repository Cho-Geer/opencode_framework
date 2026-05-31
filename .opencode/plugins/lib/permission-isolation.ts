/**
 * permission-isolation.ts — Permission Isolation for Multi-Agent Security
 * =========================================================================
 *
 * Reads the SINGLE authority source (opencode.json) for agent permissions.
 * Previously hardcoded permission profiles have been removed in favor of
 * runtime resolution from the centralized config.
 *
 * Uses: PermissionIsolation class for programmatic permission checks
 * within the framework-enforcer plugin hooks.
 *
 * @author  @Architect
 * @version 2.0.0 — centralized config reader
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

export interface AgentPermissions {
  agentType: string;
  edit: "allow" | "deny";
  bash: "allow" | "deny";
  task: "allow" | "deny";
}

export interface ScopeResult {
  allowed: boolean;
  reason?: string;
  deniedPaths?: string[];
}

interface OpenCodeConfig {
  agent?: Record<string, {
    permission?: Record<string, unknown>;
  }>;
}

// ═══════════════════════════════════════════════════════════════════
// CONFIG READER — single source: opencode.json
// ═══════════════════════════════════════════════════════════════════

function readOpenCodeConfig(): OpenCodeConfig | null {
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const configPath = path.join(root, "opencode.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as OpenCodeConfig;
  } catch {
    return null;
  }
}

function resolvePermission(
  permissionValue: unknown,
): "allow" | "deny" {
  if (typeof permissionValue === "string") {
    return permissionValue === "allow" ? "allow" : "deny";
  }
  if (typeof permissionValue === "object" && permissionValue !== null) {
    // Path-level permissions: treat as "allow" if any path is allow
    return "allow";
  }
  return "deny";
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC CLASS
// ═══════════════════════════════════════════════════════════════════

export class PermissionIsolation {
  /**
   * Check whether an agent is allowed to use a given tool.
   * Reads permissions from opencode.json at runtime.
   */
  async checkPermission(
    agentType: string,
    tool: string,
  ): Promise<PermissionResult> {
    const config = readOpenCodeConfig();
    if (!config?.agent) {
      return { allowed: false, reason: "opencode.json not found or invalid" };
    }

    // Normalize agent name: @Coder-BE → Coder-BE
    const agentKey = agentType.startsWith("@")
      ? agentType.slice(1)
      : agentType;

    const agentConfig = config.agent[agentKey];
    if (!agentConfig?.permission) {
      return {
        allowed: false,
        reason: `Agent "${agentType}" not found in opencode.json agent permissions`,
      };
    }

    const perm = agentConfig.permission[tool];
    if (perm === undefined) {
      return {
        allowed: false,
        reason: `Tool "${tool}" not configured for agent "${agentType}"`,
      };
    }

    const effective = resolvePermission(perm);
    return {
      allowed: effective === "allow",
      ...(effective !== "allow"
        ? {
            reason: `Permission denied: ${tool} is ${effective} for ${agentType}`,
          }
        : {}),
    };
  }

  /**
   * Get the effective permissions for an agent from opencode.json.
   */
  async getAgentPermissions(
    agentType: string,
  ): Promise<AgentPermissions> {
    const config = readOpenCodeConfig();
    const agentKey = agentType.startsWith("@")
      ? agentType.slice(1)
      : agentType;

    if (!config?.agent?.[agentKey]?.permission) {
      throw new Error(
        `Unknown agent type: "${agentType}". No permission config found in opencode.json.`,
      );
    }

    const perm = config.agent[agentKey].permission;
    return {
      agentType,
      edit: resolvePermission(perm.edit),
      bash: resolvePermission(perm.bash),
      task: resolvePermission(perm.task),
    };
  }

  /**
   * Check if a file path falls within denied write scopes.
   */
  async checkWriteScope(
    _agentType: string,
    filePath: string,
  ): Promise<ScopeResult> {
    // Denied patterns are now defined in opencode.json permissions
    // (safe_edit path-level restrictions). Scope enforcement is handled
    // at the OpenCode runtime level, not duplicated here.
    const deniedPatterns = ["/etc/", "node_modules"];
    const matched: string[] = [];
    for (const pattern of deniedPatterns) {
      if (filePath.includes(pattern)) matched.push(pattern);
    }
    if (matched.length > 0) {
      return {
        allowed: false,
        reason: `Write scope violation: ${matched.join(", ")}`,
        deniedPaths: matched,
      };
    }
    return { allowed: true };
  }
}

export default PermissionIsolation;
