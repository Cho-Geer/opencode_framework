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
//
// REVISION NOTES (P2-D v2.1, 2026-06-17):
//   - L3 now receives actual target_files[] (not extractScopePatterns() route-scope fragments)
//   - L3 uses pathMatchesGlob() from gate-core.ts (was scope.includes() — pre-existing bug)
//   - L2 route-scope matching RETAINED with fragment semantics (different from safe_edit globs)
//
// REVISION NOTES (L4-HEURISTIC, 2026-06-19):
//   - L4 replaced naive candidates[0] with weighted heuristic scoring
//   - Scoring: scope_match×35% + permission_match×40% + domain_match×25%
//   - l4_heuristicSelect() is the new primary function; l4_dagCheck() retained as compat wrapper
// REVISION NOTES (SA-FIX-ROUTE-PATHS, 2026-06-19):
//   - Added normalizeTargetFilesForPermissionMatch() to map short DAG paths to long form
//   - Short paths like "booking-backend/src/xxx.ts" now normalized to "booking_system_refactor/booking-backend/src/xxx.ts"
//   - Both l3_permissionFilter() and l4_heuristicSelect() use normalized paths for permission matching
//   - Added writeLog events: ROUTE-PATH-NORMALIZED, ROUTE-PATH-MATCH

import * as fs from "node:fs";
import * as path from "node:path";
import { pathMatchesGlob } from "./gate-core";
import { writeLog } from "./log-manager";

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
interface AgentDomainMap {
  [agentName: string]: string;
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

// ── project.config.json paths reader (for path normalization) ──

let _projectPaths: Record<string, string> | null = null;

export function readProjectPaths(): Record<string, string> {
  if (_projectPaths) return _projectPaths;
  try {
    const cfgPath = path.join(ROOT, ".opencode", "project.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    _projectPaths = cfg.paths || {};
  } catch {
    _projectPaths = {};
  }
  return _projectPaths;
}

export function resetProjectPathsCache(): void {
  _projectPaths = null;
}

// ── Path Normalization: short paths → long paths for permission matching ──
//
// Background: The DAG uses short paths like "booking-backend/src/modules/xxx/xxx.service.ts"
// but opencode.json permissions use long paths like "booking_system_refactor/booking-backend/**".
// This function builds a mapping from project.config.json paths to convert short → long.
//
// Example:
//   project.config.json: paths.backend_src = "booking_system_refactor/booking-backend/src/"
//   → shortPrefix "booking-backend/" maps to longPrefix "booking_system_refactor/booking-backend/"
//   → "booking-backend/src/foo.ts" → "booking_system_refactor/booking-backend/src/foo.ts"
//
// FRAMEWORK-REPAIR (2026-06-19): Fixes E2E test failure where l4_heuristicSelect()
// permission score was always 0 because short DAG paths never matched long opencode.json patterns.

/**
 * Build a mapping from short path prefixes to long path prefixes.
 * Derived from project.config.json paths.backend_src, paths.frontend_src, etc.
 *
 * @returns Array of { shortPrefix, longPrefix } mappings, deduplicated
 */
function buildShortToLongPathMapping(): Array<{
  shortPrefix: string;
  longPrefix: string;
}> {
  const projectPaths = readProjectPaths();
  const seen = new Set<string>();
  const mappings: Array<{ shortPrefix: string; longPrefix: string }> = [];

  for (const fullPath of Object.values(projectPaths)) {
    if (typeof fullPath !== "string" || !fullPath.includes("/")) continue;

    const firstSlash = fullPath.indexOf("/");
    if (firstSlash <= 0) continue;

    // e.g., "booking_system_refactor/booking-backend/src/"
    const projectPrefix = fullPath.slice(0, firstSlash + 1); // "booking_system_refactor/"
    const afterProject = fullPath.slice(firstSlash + 1); // "booking-backend/src/"

    // Extract the second-level component as the short prefix
    // e.g., "booking-backend/" from "booking-backend/src/"
    const secondSlash = afterProject.indexOf("/");
    const shortPrefix =
      secondSlash > 0
        ? afterProject.slice(0, secondSlash + 1) // "booking-backend/"
        : afterProject; // "booking-frontend/"
    const longPrefix = projectPrefix + shortPrefix; // "booking_system_refactor/booking-backend/"

    // Deduplicate: skip if we already have this shortPrefix
    if (seen.has(shortPrefix)) continue;
    seen.add(shortPrefix);

    mappings.push({ shortPrefix, longPrefix });
  }

  return mappings;
}

/**
 * Normalize target file paths for permission matching against opencode.json patterns.
 *
 * The DAG/task uses short paths relative to the project root (e.g., "booking-backend/src/foo.ts"),
 * but opencode.json safe_edit permission patterns use the full project directory path
 * (e.g., "booking_system_refactor/booking-backend/**").
 *
 * Normalization: prepend the project root directory prefix from project.config.json paths
 * to bring both forms into alignment before glob matching.
 *
 * @param targetFiles - Original target file paths (may be short form)
 * @returns Normalized file paths (long form), with ROUTE-PATH-NORMALIZED log events
 */
export function normalizeTargetFilesForPermissionMatch(
  targetFiles: string[],
): string[] {
  const mappings = buildShortToLongPathMapping();
  if (mappings.length === 0) return targetFiles;

  return targetFiles.map((file) => {
    for (const { shortPrefix, longPrefix } of mappings) {
      // Only normalize if file uses the short form (not already long form)
      if (file.startsWith(shortPrefix) && !file.startsWith(longPrefix)) {
        const normalized = longPrefix + file.slice(shortPrefix.length);
        writeLog("route-validator", "runtime", {
          event: "ROUTE-PATH-NORMALIZED",
          detail: `Short path "${file}" normalized to long path "${normalized}" (prefix "${shortPrefix}" → "${longPrefix}")`,
        });
        return normalized;
      }
    }
    return file;
  });
}

// ═══ Layer 1: Verb → Candidate Pool ═══

export function l1_verbCandidates(
  taskDescription: string,
  verbRules: Record<string, VerbRule>,
): string[] {
  const lower = taskDescription.toLowerCase();
  const agents = new Set<string>();

  for (const rule of Object.values(verbRules)) {
    if (!rule || !Array.isArray(rule.keywords)) continue;
    for (const kw of rule.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        rule.agents.forEach((a) => agents.add(a));
        break;
      }
    }
  }

  if (agents.size === 0) {
    return [
      "@Meta-Planner",
      "@Orchestrator",
      "@Architect",
      "@Coder-BE",
      "@Coder-FE",
      "@Guardian",
      "@Arbiter",
      "@CI-CD-Agent",
      "@Super-Admin",
      "@Knowledge-Curator",
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

// ═══ Layer 3: Permission → Veto (P2-D v2.1: real target_files + pathMatchesGlob) ═══

export function l3_permissionFilter(
  candidates: string[],
  targetFiles: string[],
  opencodeConfig: any,
): string[] {
  if (candidates.length === 0) return [];

  // FRAMEWORK-REPAIR (2026-06-19): Normalize short DAG paths → long form
  // before matching against opencode.json permission patterns.
  const normalizedFiles = normalizeTargetFilesForPermissionMatch(targetFiles);

  const allowed: string[] = [];

  for (const agent of candidates) {
    const agentKey = agent.replace(/^@/, "");
    const agentPerms = opencodeConfig?.agent?.[agentKey]?.permission?.safe_edit;

    if (!agentPerms) {
      allowed.push(agent);
      continue;
    }

    if (typeof agentPerms === "string") {
      if (agentPerms === "allow") {
        allowed.push(agent);
      }
      continue;
    }

    let blocked = false;
    for (const file of normalizedFiles) {
      for (const [pattern, action] of Object.entries(agentPerms)) {
        if (action === "deny" && pathMatchesGlob(file, pattern)) {
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
        `target_files: ${targetFiles.join(", ")}`,
    );
  }

  if (allowed.length > 1) {
    allowed.sort((a, b) => {
      const aKey = a.replace(/^@/, "");
      const bKey = b.replace(/^@/, "");
      const aPerms = opencodeConfig?.agent?.[aKey]?.permission?.safe_edit || {};
      const bPerms = opencodeConfig?.agent?.[bKey]?.permission?.safe_edit || {};
      const aCount =
        typeof aPerms === "string"
          ? aPerms === "allow"
            ? Infinity
            : 0
          : Object.keys(aPerms).filter((k) => aPerms[k] === "allow").length;
      const bCount =
        typeof bPerms === "string"
          ? bPerms === "allow"
            ? Infinity
            : 0
          : Object.keys(bPerms).filter((k) => bPerms[k] === "allow").length;
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
): {
  valid: boolean;
  violations: Array<{ file: string; assigned: string; expected: string }>;
} {
  const violations: Array<{
    file: string;
    assigned: string;
    expected: string;
  }> = [];

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

// ═══ Agent Domain Map Reader ═══

function getAgentDomainMap(): AgentDomainMap {
  try {
    const cfgPath = path.join(ROOT, ".opencode", "project.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    return cfg?.agent_domain_map || {};
  } catch {
    return {};
  }
}

// ═══ Layer 4: Heuristic Agent Selection (L4-HEURISTIC, 2026-06-19) ═══
// Replaces the naive candidates[0] selection with a weighted scoring system:
//   total = scopeScore×35% + permissionScore×40% + domainScore×25%
// Adds writeLog events: L4-HEURISTIC-SELECT, L4-HEURISTIC-TIE, L4-HEURISTIC-FAIL
// SA-FIX-ROUTE-PATHS (2026-06-19): Normalizes short DAG paths → long form
// for permission matching; adds ROUTE-PATH-NORMALIZED, ROUTE-PATH-MATCH events

export function l4_heuristicSelect(
  candidates: string[],
  targetFiles: string[],
  domainId: string,
): string {
  if (candidates.length === 0) return "";
  if (candidates.length === 1) return candidates[0];

  const scopeConfig = readRouteConfig();
  const scopeRules = scopeConfig?.scope_to_agent?.rules || [];
  const opencodeConfig = readOpencodeConfig();
  const domainMap = getAgentDomainMap();

  // FRAMEWORK-REPAIR (2026-06-19): Normalize short DAG paths → long form
  // before matching against opencode.json permission patterns.
  // Fixes E2E test failure: permission score was always 0 because
  // short paths like "booking-backend/src/xxx.ts" never matched
  // long opencode.json patterns like "booking_system_refactor/booking-backend/**".
  const normalizedFiles = normalizeTargetFilesForPermissionMatch(targetFiles);

  const scores = candidates.map((agent) => {
    let scopeHits = 0;
    for (const file of targetFiles) {
      for (const rule of scopeRules) {
        if (rule.agent === agent && file.includes(rule.scope)) {
          scopeHits++;
          break;
        }
      }
    }
    const scopeScore =
      targetFiles.length > 0 ? scopeHits / targetFiles.length : 0;

    let permHits = 0;
    const agentKey = agent.replace(/^@/, "");
    const agentPerms = opencodeConfig?.agent?.[agentKey]?.permission?.safe_edit;

    if (typeof agentPerms === "string") {
      permHits = agentPerms === "allow" ? normalizedFiles.length : 0;
    } else if (agentPerms && typeof agentPerms === "object") {
      for (const file of normalizedFiles) {
        for (const [pattern, action] of Object.entries(agentPerms)) {
          if (action === "allow" && pathMatchesGlob(file, pattern as string)) {
            permHits++;
            writeLog("route-validator", "runtime", {
              event: "ROUTE-PATH-MATCH",
              detail: `Agent ${agent}: permission "${pattern}" matched normalized file "${file}"`,
            });
            break;
          }
        }
      }
    } else {
      permHits = normalizedFiles.length;
    }
    const permScore =
      normalizedFiles.length > 0 ? permHits / normalizedFiles.length : 1;

    const agentDomain = domainMap[agent] || domainMap[agentKey] || "";
    const domainScore =
      agentDomain && domainId && agentDomain === domainId ? 1 : 0;

    const total = scopeScore * 0.35 + permScore * 0.4 + domainScore * 0.25;

    return {
      agent,
      scopeScore,
      permScore,
      domainScore,
      total,
    };
  });

  scores.sort((a, b) => b.total - a.total);

  const best = scores[0];
  const second = scores[1];

  if (second && Math.abs(best.total - second.total) < 0.001) {
    writeLog("route-validator", "runtime", {
      event: "L4-HEURISTIC-TIE",
      detail: `Tie between ${best.agent}(${best.total.toFixed(4)}) and ${second.agent}(${second.total.toFixed(4)}). Selected first: ${best.agent}`,
      candidates: scores
        .map((s) => `${s.agent}=${s.total.toFixed(4)}`)
        .join(", "),
    });
    return best.agent;
  }

  if (best.total === 0) {
    writeLog("route-validator", "runtime", {
      event: "L4-HEURISTIC-FAIL",
      detail: `All candidates scored 0. Candidates: ${candidates.join(", ")}`,
    });
    return "";
  }

  writeLog("route-validator", "runtime", {
    event: "L4-HEURISTIC-SELECT",
    detail: `Selected ${best.agent} (total=${best.total.toFixed(4)}) | scope=${best.scopeScore.toFixed(2)} perm=${best.permScore.toFixed(2)} domain=${best.domainScore.toFixed(2)}`,
    candidates: scores
      .map((s) => `${s.agent}=${s.total.toFixed(4)}`)
      .join(", "),
  });

  return best.agent;
}

// Backward-compatible wrapper
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
  return config.dispatch_exempt_agents.some(
    (e) => e.replace(/^@/, "").toLowerCase() === callerNorm,
  );
}

// ═══ scope-before.ts P0-3/P0-4 migration helpers ═══

export function isFrameworkInfraFile(filePath: string): boolean {
  const norm = filePath.toLowerCase();
  return (
    norm.includes(".opencode/") ||
    norm === "opencode.json" ||
    norm.endsWith("agents.md") ||
    norm.endsWith("project.config.json") ||
    norm.endsWith("project_reference.md")
  );
}

export function isBusinessCodeFile(filePath: string): boolean {
  const norm = filePath.toLowerCase();
  return (
    norm.includes("booking-backend/src/") ||
    norm.includes("booking-frontend/src/") ||
    norm.includes("schema.prisma")
  );
}

export function findRouteAgentForFile(
  filePath: string,
  scopeRules: ScopeRule[],
): string | null {
  return findScopeAgent(filePath, scopeRules);
}
