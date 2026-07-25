/**
 * Route Validator — L3-L4 Validation Layers (route-validator-l3-l4)
 *
 * L3: Permission-based veto (safe_edit glob matching)
 * L4: Heuristic agent selection (weighted scoring) + DAG validation
 * Plus: dispatch exemption checks and scope-before migration helpers.
 *
 * Split from lib/route-validator.ts for modularity.
 *
 * REVISION NOTES (P2-D v2.1, 2026-06-17):
 *   - L3 now receives actual target_files[] (not extractScopePatterns() route-scope fragments)
 *   - L3 uses pathMatchesGlob() from gate-core.ts (was scope.includes() — pre-existing bug)
 *
 * REVISION NOTES (L4-HEURISTIC, 2026-06-19):
 *   - L4 replaced naive candidates[0] with weighted heuristic scoring
 *   - Scoring: scope_match x 35% + permission_match x 40% + domain_match x 25%
 *
 * REVISION NOTES (SA-FIX-ROUTE-PATHS, 2026-06-19):
 *   - Both l3_permissionFilter() and l4_heuristicSelect() use normalized paths
 *
 * @module route-validator-l3-l4
 */

import { pathMatchesGlob } from "../../lib/gate-core";
import { toDisplayName } from "../../lib/agent-identity";
import { writeLog } from "../../lib/log-manager";
import type { ScopeRule, RouteConfig } from "./route-validator-config";
import {
  readRouteConfig,
  readOpencodeConfig,
  normalizeTargetFilesForPermissionMatch,
  getAgentDomainMap,
} from "./route-validator-config";

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
    const agentKey = toDisplayName(agent);
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

// ═══ Layer 4: Heuristic Agent Selection (L4-HEURISTIC, 2026-06-19) ═══
// Replaces the naive candidates[0] selection with a weighted scoring system:
//   total = scopeScore x 35% + permissionScore x 40% + domainScore x 25%
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
    const agentKey = toDisplayName(agent);
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
// GAP-D-L4-AGENT-VAR (2026-06-27, @Super-Admin):
// Fix: "agent" → "candidates[0]" — was a ReferenceError when no target_files
// exist (dag_task_id not in DAG), causing all non-KC dispatches to crash.
export function l4_dagCheck(
  candidates: string[],
  dagTaskId: string,
  isDagExemptFn: (agent: string) => boolean,
): string {
  if (candidates.length === 0) return "";
  const selected = candidates[0];

  // No DAG: DAG-exempt agents (Super-Admin, etc.) pass through
  if (!dagTaskId) {
    if (isDagExemptFn(selected)) return selected;
    // Non-exempt agents without DAG: return candidate for soft validation
    // (dispatch-validate will allow if target matches this candidate)
    return selected;
  }

  if (selected === "@Orchestrator") return "";
  if (isDagExemptFn(selected)) return selected;
  return selected;
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
