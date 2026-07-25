import * as fs from "node:fs";
import * as path from "node:path";
import { normalize, toDisplayName } from "../../lib/agent-identity";

export type NativeExecutor =
  | "plan"
  | "build"
  | "general"
  | "explore"
  | "orchestrator";

interface LegacyRoleDefinition {
  displayName: string;
  nativeExecutor: NativeExecutor;
  profileRelativePath: string;
}

const LEGACY_ROLE_MAP: Record<string, LegacyRoleDefinition> = {
  "meta-planner": {
    displayName: "Meta-Planner",
    nativeExecutor: "plan",
    profileRelativePath: ".opencode/legacy/agent-profiles/Meta-Planner.md",
  },
  architect: {
    displayName: "Architect",
    nativeExecutor: "general",
    profileRelativePath: ".opencode/legacy/agent-profiles/Architect.md",
  },
  "coder-be": {
    displayName: "Coder-BE",
    nativeExecutor: "build",
    profileRelativePath: ".opencode/legacy/agent-profiles/Coder-BE.md",
  },
  "coder-fe": {
    displayName: "Coder-FE",
    nativeExecutor: "build",
    profileRelativePath: ".opencode/legacy/agent-profiles/Coder-FE.md",
  },
  guardian: {
    displayName: "Guardian",
    nativeExecutor: "explore",
    profileRelativePath: ".opencode/legacy/agent-profiles/Guardian.md",
  },
  arbiter: {
    displayName: "Arbiter",
    nativeExecutor: "general",
    profileRelativePath: ".opencode/legacy/agent-profiles/Arbiter.md",
  },
  "ci-cd-agent": {
    displayName: "CI-CD-Agent",
    nativeExecutor: "build",
    profileRelativePath: ".opencode/legacy/agent-profiles/CI-CD-Agent.md",
  },
  "knowledge-curator": {
    displayName: "Knowledge-Curator",
    nativeExecutor: "explore",
    profileRelativePath: ".opencode/legacy/agent-profiles/Knowledge-Curator.md",
  },
  "super-admin": {
    displayName: "Super-Admin",
    nativeExecutor: "build",
    profileRelativePath: ".opencode/legacy/agent-profiles/Super-Admin.md",
  },
};

const NATIVE_EXECUTOR_SET = new Set<string>([
  "plan",
  "build",
  "general",
  "explore",
]);

export interface DispatchTarget {
  requestedAgent: string;
  displayName: string;
  nativeExecutor: NativeExecutor;
  profileRelativePath: string | null;
  profileAbsolutePath: string | null;
  legacyRole: boolean;
  customAgent: boolean;
}

function resolveProfileAbsolutePath(
  profileRelativePath: string | null,
  root: string,
): string | null {
  if (!profileRelativePath) return null;
  const absolutePath = path.join(root, profileRelativePath);
  return fs.existsSync(absolutePath) ? absolutePath : null;
}

export function resolveDispatchTarget(
  agentType: string,
  root: string = process.env.OPENCODE_ROOT || process.cwd(),
): DispatchTarget {
  const normalized = normalize(agentType);
  if (normalized === "scout") {
    throw new Error(`Agent "${agentType}" is retired. Use "explore" for read-only investigation.`);
  }
  if (normalized === "orchestrator") {
    const profileRelativePath = ".opencode/agents/Orchestrator.md";
    return {
      requestedAgent: "Orchestrator",
      displayName: "Orchestrator",
      nativeExecutor: "orchestrator",
      profileRelativePath,
      profileAbsolutePath: resolveProfileAbsolutePath(profileRelativePath, root),
      legacyRole: false,
      customAgent: true,
    };
  }

  const legacyRole = LEGACY_ROLE_MAP[normalized];
  if (legacyRole) {
    return {
      requestedAgent: legacyRole.displayName,
      displayName: legacyRole.displayName,
      nativeExecutor: legacyRole.nativeExecutor,
      profileRelativePath: legacyRole.profileRelativePath,
      profileAbsolutePath: resolveProfileAbsolutePath(
        legacyRole.profileRelativePath,
        root,
      ),
      legacyRole: true,
      customAgent: false,
    };
  }

  if (NATIVE_EXECUTOR_SET.has(normalized)) {
    return {
      requestedAgent: normalized,
      displayName: normalized,
      nativeExecutor: normalized as NativeExecutor,
      profileRelativePath: null,
      profileAbsolutePath: null,
      legacyRole: false,
      customAgent: false,
    };
  }

  const displayName = toDisplayName(agentType) || agentType.replace(/^@/, "");
  return {
    requestedAgent: displayName,
    displayName,
    nativeExecutor: "general",
    profileRelativePath: null,
    profileAbsolutePath: null,
    legacyRole: false,
    customAgent: false,
  };
}

export function resolveAgentProfilePaths(
  agentType: string,
  root: string = process.env.OPENCODE_ROOT || process.cwd(),
): string[] {
  const target = resolveDispatchTarget(agentType, root);
  return target.profileAbsolutePath ? [target.profileAbsolutePath] : [];
}
