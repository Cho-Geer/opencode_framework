// service/dispatch/framework-maintenance-policy.ts — Framework maintenance grant policy
// Provides default paths, blocked paths, and write budget for framework_maintenance grants.

import * as fs from "node:fs";
import * as path from "node:path";

const POLICY_VERSION = "framework-maintenance-v1";

const DEFAULT_POLICY = {
  ttlMinutes: 45,
  defaultMaxWrites: 8,
  hardMaxWrites: 20,
  defaultAllowedPaths: [".opencode/**", "opencode.json", "AGENTS.md"],
  blockedPaths: [
    ".opencode/state/**",
    ".opencode/state.db",
    ".opencode/_test_framework/**",
    ".task_temp/**",
    "node_modules/**",
    ".git/**",
  ],
  requirePlan: true,
  requireCodeGraph: true,
};

export interface FrameworkMaintenancePolicy {
  ttlMinutes: number;
  defaultMaxWrites: number;
  hardMaxWrites: number;
  defaultAllowedPaths: string[];
  blockedPaths: string[];
  requirePlan: boolean;
  requireCodeGraph: boolean;
  policyVersion: string;
}

let cachedPolicy: FrameworkMaintenancePolicy | null = null;

function loadRawConfig(): any {
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const configPath = path.join(root, ".opencode", "project.config.json");
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function getFrameworkMaintenancePolicy(): FrameworkMaintenancePolicy {
  if (cachedPolicy) return cachedPolicy;

  const cfg = loadRawConfig();
  const policy = cfg.dispatch_privilege?.framework_maintenance || {};

  const defaultAllowedPaths: string[] = policy.default_allowed_paths ?? DEFAULT_POLICY.defaultAllowedPaths;
  const blockedPaths: string[] = policy.blocked_paths ?? DEFAULT_POLICY.blockedPaths;

  const hardMaxWrites = clamp(policy.hard_max_writes, 1, 1000, DEFAULT_POLICY.hardMaxWrites);
  const result: FrameworkMaintenancePolicy = {
    ttlMinutes: clamp(policy.ttl_minutes, 1, 120, DEFAULT_POLICY.ttlMinutes),
    defaultMaxWrites: clamp(policy.default_max_writes, 1, hardMaxWrites, DEFAULT_POLICY.defaultMaxWrites),
    hardMaxWrites,
    defaultAllowedPaths: normalizePatterns(defaultAllowedPaths),
    blockedPaths: normalizePatterns(blockedPaths),
    requirePlan: policy.require_plan ?? DEFAULT_POLICY.requirePlan,
    requireCodeGraph: policy.require_codegraph ?? DEFAULT_POLICY.requireCodeGraph,
    policyVersion: POLICY_VERSION,
  };

  cachedPolicy = result;
  return result;
}

export function clearFrameworkMaintenancePolicyCache(): void {
  cachedPolicy = null;
}

export function normalizeFrameworkPath(inputPath: string, root?: string): string {
  const repoRoot = root || process.cwd();
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("[FRAMEWORK-PATH] Path must be a non-empty string");
  }

  const cleaned = inputPath.replace(/\\/g, "/").trim();

  if (path.isAbsolute(cleaned)) {
    const rel = path.relative(repoRoot, cleaned).replace(/\\/g, "/");
    if (rel.startsWith("..") || rel === cleaned) {
      throw new Error(`[FRAMEWORK-PATH] Absolute path outside repo is not allowed: ${inputPath}`);
    }
    return normalizeFrameworkPath(rel, repoRoot);
  }

  if (cleaned.startsWith("../") || cleaned.startsWith("..\\") || cleaned.includes("/../")) {
    throw new Error(`[FRAMEWORK-PATH] Path traversal is not allowed: ${inputPath}`);
  }

  return cleaned.replace(/^\.\/+/, "").replace(/\/+$/, "");
}

export function isFrameworkPathAllowed(
  filePath: string,
  allowed: string[],
  blocked: string[],
): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (isBlockedPath(normalized, blocked)) return false;
  return allowed.some((p) => matchPattern(normalized, p));
}

export function resolveGrantAllowedPaths(inputAllowedPaths?: string[]): string[] {
  const policy = getFrameworkMaintenancePolicy();
  const allowed = [...policy.defaultAllowedPaths];

  if (!inputAllowedPaths || inputAllowedPaths.length === 0) {
    return allowed;
  }

  const narrowed = inputAllowedPaths
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => !policy.blockedPaths.some((b) => matchPattern(p, b) || matchPattern(b, p)));

  return narrowed.length > 0 ? normalizePatterns(narrowed) : allowed;
}

export function resolveGrantMaxWrites(inputMaxWrites?: number): number {
  const policy = getFrameworkMaintenancePolicy();
  if (inputMaxWrites === undefined || inputMaxWrites === null) {
    return policy.defaultMaxWrites;
  }
  return clamp(inputMaxWrites, 1, policy.hardMaxWrites, policy.defaultMaxWrites);
}

// Internal helpers
function clamp(value: any, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizePatterns(patterns: string[]): string[] {
  return patterns.map((p) => p.replace(/\\/g, "/"));
}

function isBlockedPath(filePath: string, blocked: string[]): boolean {
  for (const b of blocked) {
    if (matchPattern(filePath, b)) return true;
  }
  return false;
}

function matchPattern(filePath: string, pattern: string): boolean {
  const p = pattern.replace(/\\/g, "/");
  if (p.endsWith("/**")) {
    const prefix = p.slice(0, -3);
    return filePath === prefix || filePath.startsWith(prefix + "/");
  }
  if (p.endsWith("/*")) {
    const prefix = p.slice(0, -2);
    return filePath.startsWith(prefix + "/") && !filePath.slice(prefix.length + 1).includes("/");
  }
  return filePath === p;
}
