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
  pluginSelf: () => resolveStatePath(".opencode/lib/gate-core.ts"),
  auditLog: () => resolveStatePath(".task_temp/_global/audit_log.jsonl"),
  /**
   * Read audit JSONL path (Phase 2: DB-only writes, JSONL retained as read-only
   * fallback for historical data per SA-STORAGE-IMPLEMENT-001).
   * @see read-audit.ts
   */
  readAudit: () => resolveStatePath(".opencode/state/read_audit.jsonl"),
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
export function computeFileHash(
  filePath: string,
  computeSHA256Fn: (p: string) => string | null,
): string {
  return computeSHA256Fn(filePath) ?? "";
}

// ── File Classification ──

export function isSourceFile(filePath: string): boolean {
  if (!filePath) return false;
  return /\.(ts|tsx|js|jsx|html|scss|prisma)$/.test(filePath);
}

// Fix D: Unified isBusinessSourceFile — config-extensible framework path/file classification

const CORE_FRAMEWORK_PATH_PREFIXES = [
  ".opencode/",
  "docs/",
  ".task_temp/",
  "node_modules/",
];
const CORE_FRAMEWORK_ROOT_FILES = new Set([
  "opencode.json",
  "AGENTS.md",
  "contract.yaml",
  "Task.DAG.json",
  "TECH_DEBT_REGISTRY.md",
  "WAIVE.md",
  "PROJECT_REFERENCE.md",
  "Project.graph",
]);
// No caching — always re-reads config for live updates.

function getFrameworkPathPrefixes(): string[] {
  try {
    const root = process.env.OPENCODE_ROOT || ".";
    const raw = fs.readFileSync(
      path.join(root, ".opencode", "project.config.json"),
      "utf8",
    );
    const cfg = JSON.parse(raw);
    return (
      cfg?.template_resolution?.framework_path_prefixes ??
      CORE_FRAMEWORK_PATH_PREFIXES
    );
  } catch {
    return CORE_FRAMEWORK_PATH_PREFIXES;
  }
}

function getFrameworkRootFiles(): Set<string> {
  try {
    const root = process.env.OPENCODE_ROOT || ".";
    const raw = fs.readFileSync(
      path.join(root, ".opencode", "project.config.json"),
      "utf8",
    );
    const cfg = JSON.parse(raw);
    const files: string[] = cfg?.template_resolution?.framework_root_files ?? [
      ...CORE_FRAMEWORK_ROOT_FILES,
    ];
    return new Set(files);
  } catch {
    return CORE_FRAMEWORK_ROOT_FILES;
  }
}
const TDD_EXCLUDE_PATTERNS = [
  /\.spec\./,
  /\.test\./,
  /\/test\//,
  /\.config\./,
  /__tests__\//,
];

export function isBusinessSourceFile(fp: string): boolean {
  if (!fp || !isSourceFile(fp)) return false;
  for (const prefix of getFrameworkPathPrefixes()) {
    if (fp.startsWith(prefix)) return false;
  }
  if (getFrameworkRootFiles().has(fp)) return false;
  for (const pat of TDD_EXCLUDE_PATTERNS) {
    if (pat.test(fp)) return false;
  }
  return true;
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

export function filePathMatches(
  args: Record<string, unknown>,
  pattern: string,
): boolean {
  if (!args) return false;
  const fp = ((args.filePath || args.path || "") as string).replace(/\\/g, "/");
  return fp.includes(pattern);
}

// ── Failed Entry TTL Cap ──

export const FAILED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FAILED_MAX_ENTRIES = 100;

export function capFailedEntries(entries: any[]): any[] {
  const cutoff = Date.now() - FAILED_TTL_MS;
  const capped = entries.filter((e) => {
    const ts = e.failedAt || e.timestamp;
    return ts && new Date(ts).getTime() > cutoff;
  });
  return capped.length > FAILED_MAX_ENTRIES
    ? capped.slice(-FAILED_MAX_ENTRIES)
    : capped;
}

// ── TDD Constants (config-extensible) ──

const TDD_AGENTS = new Set(["@Coder-BE", "@Coder-FE", "Coder-BE", "Coder-FE"]);

/**
 * Core TDD tools that MUST always be subject to TDD order enforcement.
 * Cannot be removed via config — defense-in-depth.
 */
const CORE_TDD_MODIFY_TOOLS = new Set(["write", "edit", "safe_edit"]);

function getTddModifyTools(): Set<string> {
  const merged = new Set(CORE_TDD_MODIFY_TOOLS);
  try {
    const root = process.env.OPENCODE_ROOT || ".";
    const raw = fs.readFileSync(
      path.join(root, ".opencode", "project.config.json"),
      "utf8",
    );
    const cfg = JSON.parse(raw);
    const extras: string[] = cfg?.template_resolution?.tdd_modify_tools ?? [];
    for (const t of extras) merged.add(t);
  } catch {
    // Config unreadable → use core set only
  }
  return merged;
}

export function isTddAgent(agent: string): boolean {
  return TDD_AGENTS.has(agent);
}
export function isTddTool(tool: string): boolean {
  return getTddModifyTools().has(tool);
}

// ── Atomic JSON / Text Write ──

export function atomicWriteJson(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Atomic text write using temp+rename.
 * Guarantees the target file is never left in a partial state.
 *
 * @since v2.10.0 — FW-DB-CANONICAL-10 (@Super-Admin 2026-06-26)
 */
export function atomicWriteText(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

// ── Atomic Sub-State Write (P2-A: DB Transaction + JSON Dual-Write) ──

import { writeLog } from "../../lib/log-manager";
import { SUBSTATE_FILES } from "../../lib/substate-manager";
import type { SubStateKey, SubStateMap } from "../../lib/substate-types";
import { dbAtomicWriteSubState } from "../../lib/db-state-manager";

const SRC = "lib-state-utils";

/**
 * Atomic write for sub-state (P2-A Step 8: DB-only).
 * Uses SQLite transaction (dbAtomicWriteSubState) for true atomic
 * read-modify-write, solving G3 (CAS weak validation) and G4 (busy-wait spin).
 */
export function atomicWriteSubState<K extends SubStateKey>(
  subStateKey: K,
  modifyFn: (subState: SubStateMap[K]) => void,
  maxRetries: number = 3,
): boolean {
  const dbOk = dbAtomicWriteSubState(subStateKey as any, modifyFn, maxRetries);
  if (!dbOk) {
    writeLog(SRC, "ERROR", {
      event: "DB-ATOMIC-WRITE-FAILED",
      detail: `key=${subStateKey}`,
    });
    return false;
  }
  return true;
}
