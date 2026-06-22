/**
 * critical-files.ts — Critical infrastructure file detection (git diff + domain-aware auto-generation)
 * ================================================================================================
 *
 * Replaces the old SHA-256 digest system (rule_registry.json + rule-registry-verify.ts)
 * with git-diff-based change detection. Two functions cover the two trigger points:
 *
 *   getStagedCriticalFiles()  → commit-time  (git diff --cached)
 *   getModifiedCriticalFiles() → dispatch-time (git diff HEAD)
 *
 * M10 (2026-06-19): Added domain-aware auto-generation via knowledge_semantic_map:
 *   getCriticalFilesForDomain(domain_id) → auto-generates critical file list from
 *     knowledge_semantic_map.save_path + docs/official_docs/index.json
 *   getCriticalFileSummary() → coverage comparison for quality reference
 *
 * @author @Super-Admin
 * @since 2026-06-15
 * @updated 2026-06-19 — M10: domain-aware auto-generation
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ── Path resolution ──────────────────────────────────────────
// OPENCODE_ROOT is resolved in priority order:
//   1. OPENCODE_ROOT env var (set by dispatch_subagent.ts shell invocation)
//   2. Walk up from this file's directory until we find project.config.json
//      (handles both CJS __dirname and ESM import.meta.url)

function resolveOpenCodeRoot(): string {
  // Priority 1: Explicit env var
  if (process.env.OPENCODE_ROOT) return resolve(process.env.OPENCODE_ROOT);

  // Priority 2: Walk up from module directory
  const modDir =
    typeof __dirname !== "undefined"
      ? resolve(__dirname)
      : resolve(dirname(new URL(import.meta.url).pathname));

  let current = modDir;
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(current, ".opencode", "project.config.json"))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) break; // Reached filesystem root
    current = parent;
  }

  // Priority 3: Fallback to cwd
  let cwd = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(cwd, ".opencode", "project.config.json"))) {
      return cwd;
    }
    const parent = resolve(cwd, "..");
    if (parent === cwd) break;
    cwd = parent;
  }

  // Last resort: 3 levels up from modDir
  return resolve(modDir, "..", "..", "..");
}

const OPENCODE_ROOT = resolveOpenCodeRoot();

const PROJECT_CONFIG_PATH = resolve(
  OPENCODE_ROOT,
  ".opencode",
  "project.config.json",
);
const INDEX_JSON_PATH = resolve(
  OPENCODE_ROOT,
  "docs",
  "official_docs",
  "index.json",
);

// ── Type definitions ─────────────────────────────────────────
interface KnowledgeDomain {
  domain_id: string;
  save_path: string;
  keywords: string[];
  context7_libraries: string[];
  fallback_pattern: string;
  ttl_days: number;
}

interface IndexEntry {
  library_id: string;
  query_topic: string;
  domain: string;
  tags: string[];
  files: Array<{
    path: string;
    source: string;
    sha256?: string;
    [key: string]: unknown;
  }>;
}

interface CriticalFileSummary {
  domain_id: string;
  save_path: string;
  total_critical: number;
  critical_files: string[];
  files_read: string[];
  matched: string[];
  missing: string[];
  coverage_pct: number;
}

/** Files whose modification should trigger the [INFRA] commit marker.
 *
 * FIX-006 (2026-06-21 @Super-Admin): Expanded from 22 to 30 entries.
 * Added hook implementation files, critical-files.ts self-protection,
 * framework scripts, and governance CI workflow.
 * These were previously blind spots — modifications to hook-layers.ts
 * or framework-self-test.ts could bypass critical-file detection.
 */
export const CRITICAL_FILES = [
  ".opencode/rules/common-project.md",
  ".opencode/rules/mcp-compliance-guide.md",
  ".opencode/rules/skill-compliance-guide.md",
  ".opencode/agents/Meta-Planner.md",
  ".opencode/agents/Orchestrator.md",
  ".opencode/agents/Coder-BE.md",
  ".opencode/agents/Coder-FE.md",
  ".opencode/agents/Guardian.md",
  ".opencode/agents/Arbiter.md",
  ".opencode/agents/CI-CD-Agent.md",
  ".opencode/agents/Super-Admin.md",
  ".opencode/agents/Knowledge-Curator.md",
  ".opencode/agents/Architect.md",
  ".opencode/project.config.json",
  // ── FIX-006: Hook implementation files ──
  ".opencode/hooks/lib/hook-layers.ts",
  ".opencode/hooks/lib/hook-commit-msg.ts",
  ".opencode/hooks/lib/hook-critical-files.ts",
  ".opencode/lib/critical-files.ts",
  ".opencode/lib/gate-core.ts",
  ".opencode/lib/dag-policy.ts",
  ".opencode/lib/permission-isolation-core.ts",
  ".opencode/tools/dispatch_subagent.ts",
  ".opencode/hooks/pre-commit",
  ".opencode/hooks/commit-msg",
  // ── FIX-006: Framework scripts ──
  ".opencode/scripts/install-hooks.ts",
  ".opencode/scripts/framework-self-test.ts",
  ".opencode/scripts/framework-doctor.ts",
  // ── FIX-006: Governance CI workflow ──
  ".github/workflows/framework-ci.yml",
  "opencode.json",
  "AGENTS.md",
];

/**
 * Return critical files that are staged for commit.
 * Uses `git diff --cached --name-only` (commit-time check).
 */
export function getStagedCriticalFiles(): string[] {
  const staged = execSync("git diff --cached --name-only", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  return staged.filter((f) => CRITICAL_FILES.includes(f));
}

/**
 * Return critical files that have been modified since HEAD.
 * Uses `git diff HEAD --name-only` (dispatch-time check).
 * Catches uncommitted changes including multi-day accumulation.
 */
export function getModifiedCriticalFiles(): string[] {
  try {
    const modified = execSync("git diff HEAD --name-only", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    return modified.filter((f) => CRITICAL_FILES.includes(f));
  } catch {
    return [];
  }
}

// ── M10: Domain-Aware Critical File Auto-Generation ──────────

/**
 * Lazy-load the knowledge_semantic_map from project.config.json.
 * Cached in module scope after first read.
 */
let _cachedDomains: KnowledgeDomain[] | null = null;
let _cachedEntries: IndexEntry[] | null = null;

function getDomains(): KnowledgeDomain[] {
  if (_cachedDomains) return _cachedDomains;
  try {
    const raw = readFileSync(PROJECT_CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);
    _cachedDomains = config.knowledge_semantic_map?.domains ?? [];
  } catch {
    _cachedDomains = [];
  }
  return _cachedDomains;
}

function getIndexEntries(): IndexEntry[] {
  if (_cachedEntries) return _cachedEntries;
  try {
    if (!existsSync(INDEX_JSON_PATH)) return [];
    const raw = readFileSync(INDEX_JSON_PATH, "utf-8");
    const index = JSON.parse(raw);
    _cachedEntries = index.entries ?? [];
  } catch {
    _cachedEntries = [];
  }
  return _cachedEntries;
}

/**
 * Auto-generate the critical file list for a given knowledge domain.
 *
 * Algorithm:
 *   1. Look up domain_id in knowledge_semantic_map.domains[] → get save_path
 *   2. Scan docs/official_docs/index.json entries
 *   3. Filter entries whose files[].path starts with save_path
 *   4. Return unique file paths relative to docs/official_docs/
 *
 * @param domain_id — Knowledge domain identifier (e.g., 'opencode_framework', 'backend_api')
 * @returns Array of cache file paths (relative to docs/official_docs/)
 *
 * @since 2026-06-19 — M10
 */
export function getCriticalFilesForDomain(domain_id: string): string[] {
  const domains = getDomains();
  const domain = domains.find((d) => d.domain_id === domain_id);
  if (!domain) return [];

  const savePath = domain.save_path;
  const entries = getIndexEntries();

  const matchedPaths = new Set<string>();
  for (const entry of entries) {
    for (const file of entry.files) {
      if (file.path.startsWith(savePath)) {
        matchedPaths.add(file.path);
      }
    }
  }

  return Array.from(matchedPaths).sort();
}

/**
 * Generate a coverage summary comparing files_read against critical files for a domain.
 *
 * Use case: When an agent attests cache_sufficient=true, this function can be called
 * to check whether the agent actually read all domain-relevant cached files.
 * The result is a quality reference (non-blocking).
 *
 * @param domain_id — Knowledge domain identifier
 * @param files_read — Array of cache file paths the agent declared as read
 * @returns CriticalFileSummary with coverage analysis
 *
 * @since 2026-06-19 — M10
 */
export function getCriticalFileSummary(
  domain_id: string,
  files_read: string[] = [],
): CriticalFileSummary {
  const criticalFiles = getCriticalFilesForDomain(domain_id);

  // Normalize paths: strip leading docs/official_docs/ prefix if present
  const normalizedRead = files_read.map((f) =>
    f.startsWith("docs/official_docs/")
      ? f.slice("docs/official_docs/".length)
      : f,
  );

  const matched = criticalFiles.filter((cf) => normalizedRead.includes(cf));
  const missing = criticalFiles.filter((cf) => !normalizedRead.includes(cf));

  const domains = getDomains();
  const domain = domains.find((d) => d.domain_id === domain_id);

  return {
    domain_id,
    save_path: domain?.save_path ?? "",
    total_critical: criticalFiles.length,
    critical_files: criticalFiles,
    files_read: files_read,
    matched,
    missing,
    coverage_pct:
      criticalFiles.length > 0
        ? Math.round((matched.length / criticalFiles.length) * 100)
        : 100,
  };
}

/**
 * Invalidate the module-level caches.
 * Call after project.config.json or index.json is updated.
 *
 * @since 2026-06-19 — M10
 */
export function invalidateCriticalFilesCache(): void {
  _cachedDomains = null;
  _cachedEntries = null;
}

// ── INFRA-POLICY-WIDER-SCOPE: Business code vs Infrastructure ──
// Added 2026-06-22 by @Super-Admin (INFRA-POLICY-WIDER-SCOPE).
// Previously, [INFRA] was required only when specific files in the
// CRITICAL_FILES array were touched. This created blind spots —
// modifications to files like package.json, tsconfig.json, or
// .github/workflows/* that weren't in CRITICAL_FILES could bypass
// the [INFRA] commit-marker requirement.
//
// The new policy: ANY file NOT under booking_system_refactor/ is
// infrastructure and requires [INFRA]. Business code (under
// booking_system_refactor/) is exempt.

/**
 * BUSINESS_CODE_PREFIX — Files under this directory are business code
 * and do NOT require the [INFRA] marker in commit messages.
 * Everything else is infrastructure and requires [INFRA].
 *
 * Business code directories:
 *   - booking_system_refactor/booking-backend/src/**
 *   - booking_system_refactor/booking-frontend/**
 *
 * @since 2026-06-22 — INFRA-POLICY-WIDER-SCOPE
 */
export const BUSINESS_CODE_PREFIX = "booking_system_refactor/";

/**
 * Check if a file path is an infrastructure file (not business code).
 * Infrastructure files require [INFRA] marker in commit messages.
 *
 * @param filePath — Git-tracked file path relative to repo root
 * @returns true if the file is NOT under booking_system_refactor/
 *
 * @since 2026-06-22 — INFRA-POLICY-WIDER-SCOPE
 */
export function isInfrastructureFile(filePath: string): boolean {
  return !filePath.startsWith(BUSINESS_CODE_PREFIX);
}

/**
 * Return infrastructure files that are staged for commit.
 * Infrastructure = files NOT under booking_system_refactor/.
 *
 * Uses `git diff --cached --name-only` (commit-time check).
 *
 * @since 2026-06-22 — INFRA-POLICY-WIDER-SCOPE
 */
export function getStagedInfraFiles(): string[] {
  const staged = execSync("git diff --cached --name-only", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  return staged.filter(isInfrastructureFile);
}

/**
 * Return infrastructure files modified since HEAD.
 * Infrastructure = files NOT under booking_system_refactor/.
 *
 * Uses `git diff HEAD --name-only` (dispatch-time check).
 *
 * @since 2026-06-22 — INFRA-POLICY-WIDER-SCOPE
 */
export function getModifiedInfraFiles(): string[] {
  try {
    const modified = execSync("git diff HEAD --name-only", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    return modified.filter(isInfrastructureFile);
  } catch {
    return [];
  }
}
