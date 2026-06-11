/**
 * utils/state-utils.ts — State Utility Functions
 *
 * Extracted from framework-enforcer.ts (Phase 4 modularization).
 * Provides path resolution, file classification, and helper functions
 * used across hooks and checks.
 *
 * EXTRACTED FROM:
 *   - getOpenCodeRoot()        (line ~130)
 *   - resolveStatePath()       (line ~134)
 *   - STATE_PATHS              (line ~138)
 *   - ensureDir()              (line ~161)
 *   - computeFileHash()        (line ~176)
 *   - isSourceFile()           (line ~298)
 *   - isCriticalFrameworkFile()(line ~311)
 *   - isStaleSession()         (line ~323)
 *   - filePathMatches()        (line ~333)
 *   - CRITICAL_PATTERNS        (line ~117)
 *
 * STATUS: ✅ EXTRACTED — functions copied from framework-enforcer.ts
 * @since Wave 3.1 (R5)
 */
import * as path from "node:path";
import * as fs from "node:fs";
// computeSHA256 is imported at the framework-enforcer level and passed through
// import { computeSHA256 } from "../../../lib/gate-core";

// ── Constants ──

export const CRITICAL_PATTERNS: string[] = [
  ".opencode/lib/gate-core.ts",
  ".opencode/hooks/pre-commit",
  ".opencode/hooks/commit-msg",
  ".opencode/project.config.json",
  "opencode.json",
  ".opencode/state/",
];

// ── Path Resolution ──

export function getOpenCodeRoot(): string {
  return process.env.OPENCODE_ROOT || process.cwd();
}

export function resolveStatePath(relativePath: string): string {
  return path.resolve(getOpenCodeRoot(), relativePath);
}

export const STATE_PATHS = {
  dag: () => resolveStatePath("Task.DAG.json"),
  gateState: () => resolveStatePath(".opencode/state/gate-state.json"),
  machine: () => resolveStatePath(".opencode/state/machine.json"),
  projectConfig: () => resolveStatePath(".opencode/project.config.json"),
  // Flat architecture: 13 independent plugins. Reference gate-core.ts as
  // the canonical entry for checkPluginIntegrity() hash verification.
  pluginSelf: () =>
    resolveStatePath(
      ".opencode/lib/gate-core.ts",
    ),
  auditLog: () => resolveStatePath(".task_temp/_global/audit_log.jsonl"),
};

// ── File System Helpers ──

export function ensureDir(dirPath: string): void {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore if already exists
  }
}

/**
 * Compute SHA-256 hash of a file.
 * Wraps computeSHA256 from lib/gate-core.
 * Gate-core returns null on failure; wrapper returns "" for backward compat.
 */
export function computeFileHash(filePath: string, computeSHA256Fn: (p: string) => string | null): string {
  return computeSHA256Fn(filePath) ?? "";
}

// ── File Classification ──

export function isSourceFile(filePath: string): boolean {
  if (!filePath) return false;
  return /\.(ts|tsx|js|jsx|html|scss|prisma)$/.test(filePath);
}
export function isBusinessSourceFile(filePath: string): boolean {
  if (!filePath) return false;
  // Only business code in booking-*/src/ is subject to TDD enforcement
  if (filePath.includes(".opencode/") ||
      filePath.includes("docs/") ||
      filePath.includes(".task_temp/") ||
      filePath.includes("node_modules/") ||
      filePath.includes("/test/") ||
      filePath.includes(".spec.") ||
      filePath.includes(".test.") ||
      filePath.endsWith("opencode.json") ||
      filePath.endsWith("contract.yaml") ||
      filePath.endsWith("Task.DAG.json") ||
      filePath.endsWith("AGENTS.md")) return false;
  return /\.(ts|tsx|js|jsx|html|scss|prisma)$/.test(filePath);
}


export function isCriticalFrameworkFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return CRITICAL_PATTERNS.some((pattern) => {
    if (pattern.endsWith("/")) {
      return (
        normalized.startsWith(pattern) || normalized.includes("/" + pattern)
      );
    }
    return normalized.endsWith(pattern) || normalized.includes("/" + pattern);
  });
}

export function isStaleSession(session: {
  confirmed_at?: string | null;
  consumed_at?: string | null;
}): boolean {
  if (!session.confirmed_at || session.consumed_at) return false;
  const confirmed = new Date(session.confirmed_at).getTime();
  const hoursElapsed = (Date.now() - confirmed) / 3600000;
  return hoursElapsed > 24;
}

export function filePathMatches(args: Record<string, unknown>, pattern: string): boolean {
  if (!args) return false;
  const fp = ((args.filePath || args.path || "") as string).replace(/\\/g, "/");
  return fp.includes(pattern);
}
