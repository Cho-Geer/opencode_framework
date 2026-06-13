/**
 * checks/gate-checks.ts — Gate & Integrity Checks
 * Extracted from framework-enforcer.ts (lines ~184-459)
 * STATUS: ✅ EXTRACTED — 7 functions live
 * @since Wave 3.1 (R5)
 */
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import {
  STATE_PATHS,
  isStaleSession,
  resolveStatePath,
  CRITICAL_PATTERNS,
} from "./state-utils";
import { writeAuditLogEntry } from "./audit-log";
// Module-level state (extracted from monolith)
let _pluginHash = "";
let _pluginHooksCount = 0;
let _pluginHooksCountSet = false; // P1-FIX-QUAD-01: tracks whether setPluginHooksCount was called

/**
 * P1-FIX-QUAD-01: Register the actual number of hooks from the plugin entry point.
 * index.ts calls this after registering all hooks. Replaces hardcoded "14".
 * When set, checkPluginIntegrity() uses this value; when not set, falls back to
 * hash-only check (backward compatible with plugins that don't call this).
 */
export function setPluginHooksCount(count: number): void {
  _pluginHooksCount = count;
  _pluginHooksCountSet = true;
}

// readJsonFile and computeFileHash inlined — initDeps() was never called, causing undefined at runtime
function readJsonFile<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as T; }
  catch { return null; }
}
function computeFileHash(p: string): string | null {
  try { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }
  catch { return null; }
}

export function checkPluginIntegrity(): { valid: boolean; detail: string } {
  const pluginPath = STATE_PATHS.pluginSelf();
  const currentHash = computeFileHash(pluginPath);
  if (!_pluginHash) {
    _pluginHash = currentHash;
    // P1-FIX-QUAD-01: If setPluginHooksCount() was called (dynamic), use that value.
    // If not (legacy), keep 0; the < 2 check is gated on _pluginHooksCountSet.
    return { valid: true, detail: "Plugin initialized" };
  }
  if (currentHash !== _pluginHash)
    return {
      valid: false,
      detail:
        "Plugin hash changed: expected " + _pluginHash + ", got " + currentHash,
    };
  // P1-FIX-QUAD-01: Only check hook count if explicitly set by index.ts.
  // Previously this was dead code (hardcoded 14 never triggered < 2).
  if (_pluginHooksCountSet && _pluginHooksCount < 2)
    return {
      valid: false,
      detail:
        "Only " + _pluginHooksCount + " hooks registered, expected at least 2",
    };
  return { valid: true, detail: "Plugin integrity verified" };
}

export function findTaskInDag(taskId: string): {
  found: boolean;
  status: string;
} {
  const dag = readJsonFile<any>(STATE_PATHS.dag());
  if (!dag || !Array.isArray(dag.tasks))
    return { found: false, status: "unknown" };
  const task = dag.tasks.find((t: any) => t.id === taskId);
  return task
    ? { found: true, status: task.status }
    : { found: false, status: "unknown" };
}

function matchGlob(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");
  const regexStr = pat
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp("^" + regexStr + "$").test(normalized);
}

export function isWriteAllowed(agentType: string, filePath: string): boolean {
  const config = readJsonFile<any>(STATE_PATHS.projectConfig());
  const scopes = config?.agent_write_scopes?.[agentType];
  if (!scopes) return true;
  // Normalize absolute paths to relative (strip OPENCODE_ROOT prefix)
  // P0-3/4/5-FIX: Fallback to process.cwd() when OPENCODE_ROOT is unset.
  // Previously used `|| ""` which made relPath==absolute path when unset,
  // causing glob patterns like ".opencode/**" to never match absolute paths.
  const root = process.env.OPENCODE_ROOT || process.cwd();
  const relPath =
    root && filePath.startsWith(root + "/")
      ? filePath.slice(root.length + 1)
      : filePath;
  for (const pattern of scopes.denied || []) {
    if (matchGlob(relPath, pattern)) return false;
  }
  for (const pattern of scopes.allowed || []) {
    if (matchGlob(relPath, pattern)) return true;
  }
  return false;
}

export function checkStaleSessions(paths: typeof STATE_PATHS): {
  count: number;
} {
  try {
    const gate = readJsonFile<any>(paths.gateState());
    if (!gate?.sessions) return { count: 0 };
    return {
      count: Object.values(gate.sessions).filter(isStaleSession).length,
    };
  } catch {
    return { count: 0 };
  }
}

export function autoDrainStaleSessions(paths: typeof STATE_PATHS): number {
  try {
    const gatePath = paths.gateState();
    const gate = readJsonFile<any>(gatePath);
    if (!gate?.sessions) return 0;
    const staleEntries = Object.entries(gate.sessions).filter(([, s]) =>
      isStaleSession(s as any),
    );
    if (staleEntries.length === 0) return 0;
    // P0-FIX-QUAD-02: drained_sessions uses canonical Record<string, ...> (object) format.
    // Previously array; mismatched gate-lifecycle-audit.ts (object) and gate-core.ts type.
    (gate as any).drained_sessions = (gate as any).drained_sessions || {};
    for (const [sid, session] of staleEntries) {
      (gate as any).drained_sessions[sid] = {
        ...session,
        drained_at: new Date().toISOString(),
        drain_reason: "auto-drain",
      };
      delete gate.sessions[sid];
    }
    gate.active_sessions = (gate.active_sessions || []).filter(
      (sid: string) =>
        gate.sessions[sid] && gate.sessions[sid].gate_status === "armed",
    );
    fs.writeFileSync(gatePath, JSON.stringify(gate, null, 2), "utf8");
    return staleEntries.length;
  } catch {
    return 0;
  }
}

export function checkRuleRegistryIntegrity(paths: typeof STATE_PATHS): {
  valid: boolean;
  mismatches: Array<{ file: string; error?: string }>;
} {
  try {
    const registry = readJsonFile<any>(
      resolveStatePath(".opencode/state/rule_registry.json"),
    );
    if (!registry) return { valid: true, mismatches: [] };
    const entries = registry.entries || registry.files || [];
    const mismatches: Array<{ file: string; error?: string }> = [];
    for (const entry of entries) {
      const relPath = entry.file || entry.path || "";
      if (!relPath) continue;
      try {
        const content = fs.readFileSync(resolveStatePath(relPath), "utf8");
        const hash = crypto.createHash("sha256").update(content).digest("hex");
        const expectedHash = entry.sha256 || entry.digest || "";
        if (hash !== expectedHash) mismatches.push({ file: relPath });
      } catch {
        mismatches.push({ file: relPath, error: "file_not_found" });
      }
    }
    return { valid: mismatches.length === 0, mismatches };
  } catch {
    return { valid: true, mismatches: [] };
  }
}

export function checkMachineCleanliness(paths: typeof STATE_PATHS): {
  clean: boolean;
  dirty: string[];
} {
  try {
    const machine = readJsonFile<any>(paths.machine());
    if (!machine) return { clean: true, dirty: [] };
    const dirty: string[] = [];
    dirty.push(
      ...(machine?.eslint_state?.aggregate?.dirty_modules || []).map(
        (f: string) => "eslint:" + f,
      ),
    );
    dirty.push(
      ...(machine?.type_check_state?.dirty_files || []).map(
        (f: string) => "tsc:" + f,
      ),
    );
    dirty.push(
      ...(machine?.format_state?.unformatted_files || []).map(
        (f: string) => "format:" + f,
      ),
    );
    return { clean: dirty.length === 0, dirty };
  } catch {
    return { clean: true, dirty: [] };
  }
}
