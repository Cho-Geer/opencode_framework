/**
 * Route Validator — Configuration Reading (route-validator-config)
 *
 * Configuration readers, shared interfaces, and path normalization utilities
 * for the four-layer agent routing validation chain.
 *
 * Split from lib/route-validator.ts for modularity.
 *
 * @module route-validator-config
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";

// ============================================================================
// Shared Interfaces
// ============================================================================

export interface VerbRule {
  keywords: string[];
  agents: string[];
}

export interface ScopeRule {
  scope: string;
  agent: string;
  priority: number;
  desc: string;
}

/**
 * FIX-G1-ROUTE-PURPOSE-v1 (2026-06-27, @Super-Admin):
 * PurposeRule maps a canonical dispatch purpose to an agent.
 * Purposes are inferred from task description by inferDispatchPurpose()
 * and provide a more reliable signal than keyword-based verb matching.
 */
export interface PurposeRule {
  /** Canonical purpose identifier (e.g., "repair", "review", "implement_backend") */
  purpose: string;
  /** Primary agent for this purpose */
  agent: string;
  /** Priority keywords that strongly indicate this purpose */
  keywords: string[];
  /**
   * Priority within purpose matching (lower = higher priority).
   * When multiple purposes match, the one with the lowest priority wins.
   */
  priority: number;
}

export interface RouteConfig {
  enforcement: { dispatch: string; dag_write: string };
  dispatch_exempt_agents?: string[];
  verb_to_agent: Record<string, VerbRule>;
  /** FIX-G1-ROUTE-PURPOSE-v1: L0 purpose-to-agent mapping */
  purpose_to_agent?: { rules: PurposeRule[]; $description?: string };
  scope_to_agent: {
    rules: ScopeRule[];
    cross_domain: { agent: string };
    no_scope_match: { behavior: string };
    scope_priority_over_l1?: boolean;
  };
}

export interface AgentDomainMap {
  [agentName: string]: string;
}

// ============================================================================
// Config Readers
// ============================================================================

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

// ============================================================================
// Path Normalization: short paths → long paths for permission matching
// ============================================================================
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
export function buildShortToLongPathMapping(): Array<{
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

// ============================================================================
// Agent Domain Map Reader
// ============================================================================

export function getAgentDomainMap(): AgentDomainMap {
  try {
    const cfgPath = path.join(ROOT, ".opencode", "project.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    return cfg?.agent_domain_map || {};
  } catch {
    return {};
  }
}
