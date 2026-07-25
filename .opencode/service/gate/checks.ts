// service/gate/checks.ts — Gate & integrity checks (read-only validation functions)
// Source: gate-core.ts (validation functions) + gate-checks.ts (plugin/DAG/write checks)

import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { readSubState } from "../../lib/substate-manager";
import { writeLog } from "../../lib/log-manager";
import {
  STATE_PATHS,
  isStaleSession,
  CRITICAL_PATTERNS,
} from "../../lib/state-utils";
import { writeAuditLogEntry } from "../../lib/audit-log";
import {
  getProjectRoot,
  readJsonFile,
  fileExists,
  loadGateStore,
  pathMatchesGlob,
  type ArmedSessionResult,
  type StaleSessionsResult,
  type StaleSessionInfo,
  type GateIntegrityResult,
  type MachineCleanlinessResult,
  type RuleRegistryResult,
  type RegistryMismatch,
  type WriteScope,
} from "./store";

// ════════════════════════════════════════════════
// PLUGIN INTEGRITY (from gate-checks.ts)
// ════════════════════════════════════════════════

let _pluginHash = "";
let _pluginHooksCount = 0;
let _pluginHooksCountSet = false;

export function setPluginHooksCount(count: number): void {
  _pluginHooksCount = count;
  _pluginHooksCountSet = true;
}

function computeFileHash(p: string): string | null {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch {
    return null;
  }
}

export function checkPluginIntegrity(): { valid: boolean; detail: string } {
  const pluginPath = STATE_PATHS.pluginSelf();
  const currentHash = computeFileHash(pluginPath);
  if (!_pluginHash) {
    _pluginHash = currentHash ?? "";
    return { valid: true, detail: "Plugin initialized" };
  }
  if (currentHash !== _pluginHash)
    return {
      valid: false,
      detail:
        "Plugin hash changed: expected " + _pluginHash + ", got " + currentHash,
    };
  if (_pluginHooksCountSet && _pluginHooksCount < 2)
    return {
      valid: false,
      detail:
        "Only " + _pluginHooksCount + " hooks registered, expected at least 2",
    };
  return { valid: true, detail: "Plugin integrity verified" };
}

// ════════════════════════════════════════════════
// DAG TASK LOOKUP (from gate-checks.ts)
// ════════════════════════════════════════════════

export function findTaskInDag(taskId: string): {
  found: boolean;
  status: string;
  source: "tasks" | "execution_order" | "unknown";
  task?: any;
} {
  const dag = readJsonFile<any>(STATE_PATHS.dag());
  if (!dag) return { found: false, status: "unknown", source: "unknown" };

  if (Array.isArray(dag.tasks)) {
    const task = dag.tasks.find((t: any) => t.id === taskId);
    if (task)
      return { found: true, status: task.status, source: "tasks", task };
  }

  const eo = dag.execution_order as Record<string, unknown> | undefined;
  if (eo) {
    for (const [groupName, group] of Object.entries(eo)) {
      if (Array.isArray(group)) {
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
        for (const [subName, subgroup] of Object.entries(
          group as Record<string, unknown>,
        )) {
          if (Array.isArray(subgroup) && subgroup.includes(taskId)) {
            writeAuditLogEntry({
              event: "DAG-TASK-FOUND",
              detail: `findTaskInDag: "${taskId}" found in execution_order["${groupName}"]["${subName}"] (nested); status inferred as "pending"`,
              agent: "gate-checks",
              level: "INFO",
            });
            return {
              found: true,
              status: "pending",
              source: "execution_order",
            };
          }
        }
      }
    }
  }

  return { found: false, status: "unknown", source: "unknown" };
}
// ════════════════════════════════════════════════
// STALE SESSIONS (from gate-checks.ts)
// ════════════════════════════════════════════════

export function checkStaleSessions(paths: typeof STATE_PATHS): {
  count: number;
} {
  try {
    const { dbLoadGateStore } = require("../../lib/db-state-manager");
    const store = dbLoadGateStore();
    if (!store?.sessions) return { count: 0 };
    return {
      count: Object.values(store.sessions).filter((s) => isStaleSession(s as any))
        .length,
    };
  } catch {
    return { count: 0 };
  }
}

export function autoDrainStaleSessions(paths: typeof STATE_PATHS): number {
  try {
    const {
      dbLoadGateStore,
      dbSaveGateStore,
      dbArchiveDrainedSession,
    } = require("../../lib/db-state-manager");
    const store = dbLoadGateStore();
    if (!store?.sessions) return 0;
    const staleEntries = Object.entries(store.sessions).filter(([, s]) =>
      isStaleSession(s as any),
    );
    if (staleEntries.length === 0) return 0;
    const drainedAt = new Date().toISOString();
    for (const [sid, session] of staleEntries) {
      dbArchiveDrainedSession(sid, "auto-drain", {
        ...(session as any),
        drained_at: drainedAt,
        drain_reason: "auto-drain",
      });
      delete store.sessions[sid];
    }
    store.active_sessions = (store.active_sessions || []).filter(
      (sid: string) =>
        store.sessions[sid] && store.sessions[sid].gate_status === "armed",
    );
    dbSaveGateStore(store);
    return staleEntries.length;
  } catch {
    return 0;
  }
}

// ════════════════════════════════════════════════
// RULE REGISTRY INTEGRITY (from gate-checks.ts + gate-core.ts)
// ════════════════════════════════════════════════

export function checkRuleRegistryIntegrity(
  paths?: typeof STATE_PATHS,
): RuleRegistryResult {
  try {
    const { getModifiedCriticalFiles } = require("../../lib/critical-files");
    const modified = getModifiedCriticalFiles();
    const mismatches: RegistryMismatch[] = modified.map((f: string) => ({
      file: f,
      severity: "HIGH" as const,
    }));
    return {
      valid: mismatches.length === 0,
      mismatches,
    };
  } catch {
    return { valid: true, mismatches: [] };
  }
}

// ════════════════════════════════════════════════
// MACHINE CLEANLINESS (from gate-checks.ts + gate-core.ts)
// ════════════════════════════════════════════════

export function checkMachineCleanliness(
  paths?: typeof STATE_PATHS,
): MachineCleanlinessResult {
  const dirty: string[] = [];

  try {
    const eslintAgg = readSubState("eslint_state")?.aggregate;
    if (eslintAgg?.dirty_modules && eslintAgg.dirty_modules.length > 0) {
      dirty.push(
        `eslint_state: ${eslintAgg.dirty_modules.length} dirty module(s) — ${eslintAgg.dirty_modules.join(", ")}`,
      );
    }

    const diagState = readSubState("diagnostic_state");
    const dsFiles = diagState?.files || {};
    const dsErrorCount = Object.entries(dsFiles).filter(
      ([_, d]: [string, any]) =>
        Array.isArray(d?.errors) && d.errors.length > 0,
    ).length;
    if (dsErrorCount > 0) {
      dirty.push(
        `diagnostic_state: ${dsErrorCount} file(s) with TypeScript errors`,
      );
    }

    const ds = readSubState("dependency_state");
    if (ds?.status && ds.status !== "clean") {
      dirty.push(
        `dependency_state: status=${ds.status}, ${(ds.violations || []).length} violation(s)`,
      );
    }

    const fs2 = readSubState("format_state");
    if (fs2?.status && fs2.status !== "clean") {
      dirty.push(
        `format_state: status=${fs2.status}, ${(fs2.unformatted_files || []).length} unformatted file(s)`,
      );
    }
  } catch {
    // Non-blocking
  }

  return { clean: dirty.length === 0, dirty };
}

// ════════════════════════════════════════════════
// GATE STATE VALIDATION (from gate-core.ts)
// ════════════════════════════════════════════════

export function checkArmedSession(gateState: {
  sessions?: Record<
    string,
    { gate_status?: string; consumed_at?: string | null; session_id?: string }
  >;
}): ArmedSessionResult {
  if (!gateState || !gateState.sessions) {
    return { found: false, gateSessionId: null };
  }
  const sessions = Object.values(gateState.sessions);
  const armed = sessions.find(
    (s) => s.gate_status === "armed" && s.consumed_at === null,
  );
  return armed
    ? { found: true, gateSessionId: armed.session_id || null }
    : { found: false, gateSessionId: null };
}

export function checkStaleSessionsFromState(
  gateState: {
    sessions?: Record<
      string,
      {
        session_id?: string;
        gate_session_id?: string;
        created_at?: string;
        confirmed_at?: string | null;
        gate_status?: string;
      }
    >;
  },
  thresholdHours?: number,
): StaleSessionsResult {
  const now = Date.now();
  const stale: StaleSessionInfo[] = [];
  if (!gateState || !gateState.sessions) return { stale, count: 0 };
  const THRESHOLD = (thresholdHours ?? 48) * 60 * 60 * 1000;

  for (const s of Object.values(gateState.sessions)) {
    const createdAt = s.created_at ? new Date(s.created_at).getTime() : 0;
    if (!createdAt) continue;
    const ageHours = (now - createdAt) / (60 * 60 * 1000);
    if (s.gate_status === "drained" && ageHours * 60 * 60 * 1000 > THRESHOLD) {
      stale.push({
        id: s.gate_session_id || s.session_id || "",
        age: Math.round(ageHours * 10) / 10,
      });
      continue;
    }
    if (
      s.gate_status === "checked" &&
      !s.confirmed_at &&
      ageHours * 60 * 60 * 1000 > THRESHOLD
    ) {
      stale.push({
        id: s.gate_session_id || s.session_id || "",
        age: Math.round(ageHours * 10) / 10,
      });
    }
  }
  return { stale, count: stale.length };
}

export function checkGateIntegrity(gateState: {
  formatVersion?: string;
  sessions?: Record<
    string,
    { session_id?: string; gate_session_id?: string; gate_status?: string }
  >;
  active_sessions?: unknown[];
}): GateIntegrityResult {
  const issues: string[] = [];
  if (!gateState) {
    issues.push("gate-state.json exists but cannot be parsed as JSON");
    return { valid: false, issues };
  }
  if (!gateState.formatVersion) {
    issues.push("gate-state.json missing formatVersion field");
  }
  if (!gateState.sessions || typeof gateState.sessions !== "object") {
    issues.push("gate-state.json missing 'sessions' object");
  } else {
    const sessions = Object.values(gateState.sessions);
    if (
      sessions.length === 0 &&
      Array.isArray(gateState.active_sessions) &&
      gateState.active_sessions.length > 0
    ) {
      issues.push(
        "gate-state.json: active_sessions non-empty but sessions object is empty",
      );
    }
    for (const s of sessions) {
      if (!s.gate_session_id) {
        issues.push("gate-state.json: session entry missing session_id");
      }
      if (
        s.gate_status &&
        !["checked", "armed", "completed", "failed", "drained"].includes(
          s.gate_status,
        )
      ) {
        issues.push(
          `gate-state.json: unknown gate_status '${s.gate_status}' in session ${s.gate_session_id || "(unknown)"}`,
        );
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

// ════════════════════════════════════════════════
// PERMISSION ISOLATION (from gate-core.ts)
// ════════════════════════════════════════════════

export function isAgentAllowedToWrite(
  agentType: string,
  filePath: string,
  permissionProfiles: Record<string, WriteScope>,
): boolean {
  const scopes = permissionProfiles?.[agentType];
  if (!scopes) return true;

  for (const pattern of scopes.denied || []) {
    if (pathMatchesGlob(filePath, pattern)) return false;
  }
  for (const pattern of scopes.allowed || []) {
    if (pathMatchesGlob(filePath, pattern)) return true;
  }
  return false;
}
