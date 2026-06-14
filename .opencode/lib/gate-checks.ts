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

/**
 * Search Task.DAG.json for a task ID.
 *
 * Two-phase lookup:
 *   1. dag.tasks[] — traditional structure with per-task status objects
 *   2. dag.execution_order — fallback for DAGs where tasks only exist as
 *      string IDs in group arrays; status is inferred as "pending" since
 *      execution_order groups do not carry per-task status metadata.
 *
 * @param taskId — DAG task ID to search for (e.g. "T-014", "FW-REPAIR-01")
 * @returns { found: boolean, status: string, source: "tasks" | "execution_order" | "unknown" }
 *   - source "tasks": found in dag.tasks[] with real status
 *   - source "execution_order": found in execution_order groups; status assumed "pending"
 *   - source "unknown": not found in either location
 *
 * @since FW-FIX-EXECORDER-01 (2026-06-14): Added source tracking + audit logging
 *        for execution_order fallback matches.
 */
export function findTaskInDag(taskId: string): {
  found: boolean;
  status: string;
  source: "tasks" | "execution_order" | "unknown";
} {
  const dag = readJsonFile<any>(STATE_PATHS.dag());
  if (!dag) return { found: false, status: "unknown", source: "unknown" };

  // 1) Search tasks array first (traditional DAG structure with per-task status)
  if (Array.isArray(dag.tasks)) {
    const task = dag.tasks.find((t: any) => t.id === taskId);
    if (task) return { found: true, status: task.status, source: "tasks" };
  }

  // 2) Fallback: scan execution_order groups (flat arrays + nested objects)
  // P2-FIX (2026-06-14): When dag.tasks is empty, tasks are organized in
  // execution_order groups. Each group value can be:
  //   - A flat array: "group_name": ["T001", "T002"]
  //   - A nested object: "group_name": { "sub1": ["T003"], "sub2": ["T004"] }
  //
  // FW-FIX-EXECORDER-01 (2026-06-14): Status is INFERRED as "pending" because
  // execution_order groups only store task ID strings — there is no per-task
  // status metadata. Audit logging added for transparency.
  const eo = dag.execution_order as Record<string, unknown> | undefined;
  if (eo) {
    for (const [groupName, group] of Object.entries(eo)) {
      if (Array.isArray(group)) {
        // Flat array group — check each entry
        if (group.includes(taskId)) {
          writeAuditLogEntry({
            event: "DAG-TASK-FOUND",
            detail: `findTaskInDag: "${taskId}" found in execution_order["${groupName}"] (flat array); status inferred as "pending"`,
            agent: "gate-checks",
            level: "INFO",
          });
          return { found: true, status: "pending", source: "execution_order" };
        }
      } else if (group && typeof group === "object") {
        // Nested object group — recurse into each subgroup array
        for (const [subName, subgroup] of Object.entries(group as Record<string, unknown>)) {
          if (Array.isArray(subgroup) && subgroup.includes(taskId)) {
            writeAuditLogEntry({
              event: "DAG-TASK-FOUND",
              detail: `findTaskInDag: "${taskId}" found in execution_order["${groupName}"]["${subName}"] (nested); status inferred as "pending"`,
              agent: "gate-checks",
              level: "INFO",
            });
            return { found: true, status: "pending", source: "execution_order" };
          }
        }
      }
    }
  }

  return { found: false, status: "unknown", source: "unknown" };
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
