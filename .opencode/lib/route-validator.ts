// ── route-validator.ts ──
// Four-layer agent routing validation chain: Verb → Scope → Permission → DAG
// Used by: dispatch-before.ts (dispatch-time), gate-before.ts (DAG-write-time)
//          scope-before.ts P0-3/P0-4 (migrated from hardcoded checks)
//
// REVISION NOTES (2026-06-17):
//   - L2 scope input: Task.DAG.json target_files[] (not task_description text)
//   - L3 opencode.json path: opencodeConfig.agent[agentName].permission.safe_edit
//   - L4 is selection step (not filtering); actual DAG validation by PLAN-FIRST
//   - Orchestrator/Meta-Planner/Super-Admin dispatches exempt from route validation

import * as fs from "node:fs";
import * as path from "node:path";

interface VerbRule {
  keywords: string[];
  agents: string[];
}
interface ScopeRule {
  scope: string;
  agent: string;
  priority: number;
  desc: string;
}
interface RouteConfig {
  enforcement: { dispatch: string; dag_write: string };
  dispatch_exempt_agents?: string[];
  verb_to_agent: Record<string, VerbRule>;
  scope_to_agent: {
    rules: ScopeRule[];
    cross_domain: { agent: string };
    no_scope_match: { behavior: string };
    scope_priority_over_l1?: boolean;
  };
}

// ── Config reader ──

const ROOT = process.env.OPENCODE_ROOT || process.cwd();
let _routeConfig: RouteConfig | null = null;

export function readRouteConfig(): RouteConfig | null {
  if (_routeConfig) return _routeConfig;
  try {
    const cfgPath = path.join(ROOT, ".opencode", "project.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    _routeConfig = cfg.route_rules || null;
  } catch {
    _routeConfig = null;
  }
  return _routeConfig;
}

export function resetRouteConfigCache(): void {
  _routeConfig = null;
}

// ── opencode.json reader ──

let _opencodeConfig: any = null;

export function readOpencodeConfig(): any {
  if (_opencodeConfig) return _opencodeConfig;
  try {
    const cfgPath = path.join(ROOT, "opencode.json");
    _opencodeConfig = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    _opencodeConfig = null;
  }
  return _opencodeConfig;
}

// ═══ Layer 1: Verb → Candidate Pool ═══

export function l1_verbCandidates(
  taskDescription: string,
  verbRules: Record<string, VerbRule>,
): string[] {
  const lower = taskDescription.toLowerCase();
  const agents = new Set<string>();

  for (const rule of Object.values(verbRules)) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        rule.agents.forEach((a) => agents.add(a));
        break;
      }
    }
  }

  if (agents.size === 0) {
    return [
      "@Meta-Planner", "@Orchestrator", "@Architect", "@Coder-BE", "@Coder-FE",
      "@Guardian", "@Arbiter", "@CI-CD-Agent", "@Super-Admin", "@Knowledge-Curator",
    ];
  }
  return [...agents];
}

// ═══ Layer 2: Scope → Filter (REVISED: target_files[] input) ═══

export function l2_scopeFilter(
  candidates: string[],
  targetFiles: string[],
  scopeConfig: RouteConfig["scope_to_agent"],
): string[] {
  const sorted = [...scopeConfig.rules].sort((a, b) => a.priority - b.priority);

  const matchedAgents = new Set<string>();
  const matchedScopes: string[] = [];
  for (const file of targetFiles) {
    for (const rule of sorted) {
      if (file.includes(rule.scope)) {
        matchedAgents.add(rule.agent);
        matchedScopes.push(rule.scope);
        break;
      }
    }
  }

  if (matchedAgents.size === 0) {
    return candidates;
  }

  const bizScopes = new Set(["booking-backend/src/", "booking-frontend/"]);
  const fwScopes = new Set([".opencode/", "opencode.json", "AGENTS.md"]);
  const hasBizScope = matchedScopes.some((s) => bizScopes.has(s));
  const hasFwScope = matchedScopes.some((s) => fwScopes.has(s));

  if (hasBizScope && hasFwScope) {
    return [scopeConfig.cross_domain.agent];
  }

  const intersection = candidates.filter((a) => matchedAgents.has(a));

  if (intersection.length > 0) {
    return intersection;
  }

  if (scopeConfig.scope_priority_over_l1) {
    return [...matchedAgents];
  }

  return candidates;
}

// ═══ Layer 3: Permission → Veto (REVISED: correct opencode.json path) ═══

export function l3_permissionFilter(
  candidates: string[],
  targetScopes: string[],
  opencodeConfig: any,
): string[] {
  if (candidates.length === 0) return [];

  const allowed: string[] = [];

  for (const agent of candidates) {
    const agentKey = agent.replace(/^@/, "");
    const agentPerms = opencodeConfig?.agent?.[agentKey]?.permission?.safe_edit;

    if (!agentPerms) {
      allowed.push(agent);
      continue;
    }

    let blocked = false;
    for (const scope of targetScopes) {
      for (const [pattern, action] of Object.entries(agentPerms)) {
        if (action === "deny" && scope.includes(pattern)) {
          blocked = true;
          break;
        }
      }
      if (blocked) break;
    }

    if (!blocked) allowed.push(agent);
  }

  if (allowed.length === 0 && candidates.length > 0) {
    throw new Error(
      `[FW-ENFORCE][ROUTE-MISMATCH] No authorized agent found. ` +
      `Candidates ${candidates.join(",")} all have safe_edit deny for ` +
      `scopes: ${targetScopes.join(", ")}`,
    );
  }

  if (allowed.length > 1) {
    allowed.sort((a, b) => {
      const aKey = a.replace(/^@/, "");
      const bKey = b.replace(/^@/, "");
      const aPerms = opencodeConfig?.agent?.[aKey]?.permission?.safe_edit || {};
      const bPerms = opencodeConfig?.agent?.[bKey]?.permission?.safe_edit || {};
      const aCount = Object.keys(aPerms).filter((k) => aPerms[k] === "allow").length;
      const bCount = Object.keys(bPerms).filter((k) => bPerms[k] === "allow").length;
      return aCount - bCount;
    });
  }

  return allowed;
}

// ═══ Extract scopes from target_files[] ═══

export function extractScopePatterns(
  targetFiles: string[],
  rules: ScopeRule[],
): string[] {
  const scopes: string[] = [];
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const file of targetFiles) {
    for (const rule of sorted) {
      if (file.includes(rule.scope)) {
        scopes.push(rule.scope);
        break;
      }
    }
  }
  return scopes;
}

// ═══ DAG-Validation (L2 Scope + L3 Permission only) ═══

export function findScopeAgent(
  file: string,
  rules: ScopeRule[],
): string | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (file.includes(rule.scope)) return rule.agent;
  }
  return null;
}

export function validateDagTaskAgentAssignment(
  task: { id: string; agent: string; target_files: string[] },
  scopeRules: ScopeRule[],
  opencodeConfig: any,
): { valid: boolean; violations: Array<{ file: string; assigned: string; expected: string }> } {
  const violations: Array<{ file: string; assigned: string; expected: string }> = [];

  for (const file of task.target_files) {
    const expected = findScopeAgent(file, scopeRules);
    if (!expected) continue;
    if (expected === task.agent) continue;

    const l3 = l3_permissionFilter([expected], [file], opencodeConfig);
    if (l3.length === 0) continue;

    violations.push({ file, assigned: task.agent, expected: l3[0] });
  }
  return { valid: violations.length === 0, violations };
}

// ═══ Layer 4: DAG → Existence Check (selection step) ═══

export function l4_dagCheck(
  candidates: string[],
  dagTaskId: string,
  isDagExemptFn: (agent: string) => boolean,
): string {
  if (candidates.length === 0) return "";

  const agent = candidates[0];

  if (agent === "@Orchestrator") return "";
  if (isDagExemptFn(agent)) return agent;
  return agent;
}

// ═══ Dispatch exemption check ═══

export function isDispatchRouteExempt(
  caller: string,
  config: RouteConfig | null,
): boolean {
  if (!config?.dispatch_exempt_agents) return false;
  const callerNorm = caller.replace(/^@/, "").toLowerCase();
  return config.dispatch_exempt_agents.some((e) =>
    e.replace(/^@/, "").toLowerCase() === callerNorm
  );
}

// ═══ scope-before.ts P0-3/P0-4 migration helpers ═══

export function isFrameworkInfraFile(filePath: string): boolean {
  const norm = filePath.toLowerCase();
  return norm.includes(".opencode/")
    || norm === "opencode.json"
    || norm.endsWith("agents.md")
    || norm.endsWith("project.config.json")
    || norm.endsWith("project_reference.md");
}

export function isBusinessCodeFile(filePath: string): boolean {
  const norm = filePath.toLowerCase();
  return norm.includes("booking-backend/src/")
    || norm.includes("booking-frontend/src/")
    || norm.includes("schema.prisma");
}

export function findRouteAgentForFile(
  filePath: string,
  scopeRules: ScopeRule[],
): string | null {
  return findScopeAgent(filePath, scopeRules);
}
