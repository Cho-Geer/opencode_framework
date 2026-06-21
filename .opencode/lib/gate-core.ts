/**
 * gate-core.ts — Shared Compliance Gate Core Logic
 * =================================================
 * BUN-CACHE-VERSION: 2026-06-11-SA-UNIFY-005 (diagnostic + enforcement fix)
 *
 * SINGLE SOURCE OF TRUTH for compliance gate state operations.
 * Currently duplicated across:
 *   - .opencode/scripts/mcp-tools/compliance-gate.ts (1261 lines)
 *   - .opencode/plugins/lib/gate-lifecycle.ts (504 lines)
 *
 * Both will import from this file after consolidation.
 *
 * Core responsibilities:
 *   1. State file operations (gate-state.json, machine.json)
 *   2. Session management (create, validate, close sessions)
 *   3. Validation logic (compliance checks, evidence verification)
 *   4. Enforcement mode reading (from project.config.json)
 *
 * @author @Architect
 * @version 1.1.0
 * @since 2026-05-25
 *
 * @module gate-core
 * @public — All exported functions are public API for framework consumers
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { readSubState } from "./substate-manager";
import {
  dbLoadGateStore,
  dbSaveGateStore,
  dbArchiveDrainedSession,
  dbCountDrainedSessions,
} from "./db-state-manager";

const SRC = "lib-gate-core";

let _writeLog:
  | ((src: string, level: string, payload: Record<string, unknown>) => void)
  | null = null;
function writeLogSafe(
  src: string,
  level: string,
  payload: Record<string, unknown>,
): void {
  try {
    if (!_writeLog) {
      _writeLog = require("./log-manager").writeLog;
    }
    _writeLog!(src, level, payload);
  } catch {
    // Circular dependency or module unavailable — swallow silently
  }
}

// ════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════

/**
 * Deliverable entry declared at confirm phase.
 * Each entry represents a specific artifact the sub-agent commits to producing.
 */
export interface DeliverableEntry {
  name: string;
  description: string;
  artifact_path?: string; // Template variable {taskId} replaced at dispatch
  required: boolean;
}

/**
 * Evidence submitted when sub-agent calls submit_deliverables.
 * Each entry provides proof that a declared deliverable was produced.
 */
export interface DeliverableEvidence {
  name: string;
  artifact_path?: string;
  content_summary?: string;
  submitted_at?: string;
}

export interface GateSession {
  session_id: string;
  created_at: string;
  task_description?: string;
  enforcement_mode?: string;
  gate_status:
    | "checked"
    | "armed"
    | "delivered"
    | "approved"
    | "completed"
    | "failed"
    | "recoverable"
    | "drained";
  last_check_passed?: boolean;
  last_check_failed_items?: GateCheckItem[];
  plan_summary?: string | null;
  confirmed_at?: string | null;
  consumed_at?: string | null;
  expires_at?: string | null;
  task_id?: string | null;
  agent?: string;
  worktree?: string;
  audit?: GateAudit | null;
  fail_reason?: string;
  missing_artifacts?: string[];

  // Deliverables hard constraint fields (P3/RC2 fix)
  declared_deliverables?: DeliverableEntry[];
  submitted_deliverables?: DeliverableEvidence[];
  deliverables_approved_by?: string;
  deliverables_approved_at?: string;
  deliverables_approval_note?: string;
  approval_required?: boolean; // true = sub-agent needs Orchestrator approval; false = exempt (Orchestrator/Super-Admin)
}

export interface GateCheckItem {
  id: string;
  desc: string;
  severity: "HIGH" | "WARNING" | "INFO";
}

export interface GateStore {
  formatVersion: string;
  active_sessions: string[];
  sessions: Record<string, GateSession>;
  audit_history?: GateAuditEntry[];
  last_updated?: string;
}

export interface GateAuditEntry {
  session_id: string;
  task_description?: string;
  plan_summary?: string | null;
  agent?: string;
  task_id?: string | null;
  confirmed_at?: string | null;
  consumed_at?: string;
  execution_summary?: string;
  gate_status?: string;
}

export interface GateAudit {
  execution_summary: string;
  completed_at: string;
}

export interface GateCheckResult {
  passed: boolean;
  session_id: string;
  enforcement_mode: string;
  failed_items: GateCheckItem[];
  rule_status: Record<string, string>;
}

export interface GateConfirmResult {
  status: "armed" | "rejected";
  reason?: string;
  session_id?: string;
  confirmed_at?: string;
  expires_at?: string;
  plan_summary?: string;
}

export interface GateCompleteResult {
  status: "completed" | "failed" | "rejected";
  reason?: string;
  audit?: {
    session_id: string;
    task_description?: string;
    plan_summary?: string | null;
    confirmed_at?: string | null;
    consumed_at?: string;
    execution_summary?: string;
    audit_history_count?: number;
  };
  dirty_modules?: string[];
  missing_artifacts?: string[];
}

export type EnforcementMode = "advisory" | "strict" | "locked";

// ════════════════════════════════════════════════════════════
// PATH RESOLUTION
// ════════════════════════════════════════════════════════════

/**
 * Get the project root directory.
 * Priority: OPENCODE_ROOT env var > process.cwd()
 * @public — Foundation API used by all state path resolvers
 */
export function getProjectRoot(): string {
  return process.env.OPENCODE_ROOT || process.cwd();
}

/**
 * Resolve the state directory path.
 * Handles project_root nesting (e.g., booking_system_refactor/).
 * @public — Primary state directory resolver for framework consumers
 */
export function resolveStateDir(root?: string): string {
  const projectRoot = root || getProjectRoot();
  const cfgPath = path.join(projectRoot, ".opencode", "project.config.json");
  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const pr = cfg.project_root;
      if (pr && pr !== ".") {
        const stateDir = path.join(projectRoot, pr, ".opencode", "state");
        if (fs.existsSync(stateDir)) return stateDir;
      }
    }
  } catch {
    // fall through
  }
  return path.join(projectRoot, ".opencode", "state");
}

// ════════════════════════════════════════════════════════════
// FILE OPERATIONS
// ════════════════════════════════════════════════════════════

/**
 * Read and parse a JSON file. Returns null on any failure.
 * @internal — Low-level file I/O utility, not intended for external consumption
 */
export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Check if a file exists at the given path.
 * @internal — Low-level file I/O utility, not intended for external consumption
 */
export function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Compute SHA-256 hex digest of a file's content.
 * Returns hex string or null on failure.
 * @internal — Low-level crypto utility, not intended for external consumption
 */
export function computeSHA256(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256");
    hash.update(content);
    return hash.digest("hex");
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// ENFORCEMENT MODE
// ════════════════════════════════════════════════════════════

const VALID_MODES: ReadonlySet<string> = new Set([
  "advisory",
  "strict",
  "locked",
]);

/**
 * Determine whether enforcement-mode diagnostic logging is enabled.
 *
 * Debug sources (checked in order):
 *   1. `DEBUG` env var contains "enforcement" or "gate-core"
 *   2. `OPENCODE_ENFORCEMENT_DEBUG=1`
 *   3. `project.config.json` `template_resolution.logs.level` is "DEBUG"
 *
 * This stays consistent with log-manager.ts level semantics without
 * creating a circular import (log-manager imports getEnforcementMode).
 */
function isEnforcementDebugEnabled(root?: string): boolean {
  const debug = process.env.DEBUG || "";
  if (debug.includes("enforcement") || debug.includes("gate-core")) {
    return true;
  }
  if (process.env.OPENCODE_ENFORCEMENT_DEBUG === "1") {
    return true;
  }
  try {
    const projectRoot = root || getProjectRoot();
    const cfgPath = path.join(projectRoot, ".opencode", "project.config.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      const level = cfg?.template_resolution?.["logs.level"];
      if (typeof level === "string" && level.toUpperCase() === "DEBUG") {
        return true;
      }
    }
  } catch {
    // Config unreadable — default to quiet
  }
  return false;
}

/**
 * Determine the current enforcement mode from the project configuration.
 *
 * Reads the two-tier enforcement mode keys introduced in project.config.json v2:
 *   - `develop_enforcement_mode`: Used during local development (agent execution)
 *   - `runtime_enforcement_mode`: Used in CI/production environments
 *
 * Priority:
 *   1. ENFORCEMENT_MODE env var (runtime override)
 *   2. project.config.json `develop_enforcement_mode` (primary)
 *   3. project.config.json `runtime_enforcement_mode` (fallback)
 *   4. Default: "advisory"
 *
 * **Why this change**: The old key `template_resolution.enforcement_mode` was
 * replaced by the two-tier `develop_enforcement_mode` / `runtime_enforcement_mode`
 * in FW-HARNESS-P6. All consumers must use the new keys.
 *
 * @public
 */
export function getEnforcementMode(root?: string): EnforcementMode {
  const envMode = process.env.ENFORCEMENT_MODE;
  const projectRoot = root || getProjectRoot();

  // Read from project.config.json
  const cfgPath = path.join(projectRoot, ".opencode", "project.config.json");
  let configMode: EnforcementMode = "advisory";

  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      const tr = cfg.template_resolution;
      // Two-tier enforcement: prefer develop mode, fall back to runtime mode
      const mode = tr?.develop_enforcement_mode || tr?.runtime_enforcement_mode;
      if (mode && VALID_MODES.has(mode)) {
        configMode = mode;
      }
    }
  } catch {
    // use default
  }

  // ── Diagnostic logging (SA-UNIFY-005, 2026-06-11) ──
  // Available when DEBUG contains "enforcement"/"gate-core",
  // OPENCODE_ENFORCEMENT_DEBUG=1, or logs.level=DEBUG.
  // Gated to prevent UI flooding on every hook/tool call.
  if (isEnforcementDebugEnabled(projectRoot)) {
    try {
      const cfgExists = fs.existsSync(cfgPath);
      const devMode = (() => {
        if (cfgExists) {
          const c = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
          return c?.template_resolution?.develop_enforcement_mode || "(unset)";
        }
        return "(cfg not found)";
      })();
      const runMode = (() => {
        if (cfgExists) {
          const c = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
          return c?.template_resolution?.runtime_enforcement_mode || "(unset)";
        }
        return "(cfg not found)";
      })();
      const resolvedMode =
        envMode && VALID_MODES.has(envMode)
          ? configMode === "locked"
            ? "locked"
            : envMode
          : configMode;
      /**
       * FW-LOG-UNIFY-P1-D3 (2026-06-12, @Super-Admin): Migrated from
       * console.error to direct appendFileSync to avoid circular import
       * (log-manager imports gate-core, so gate-core cannot import log-manager).
       */
    } catch (_diagErr) {
      // Diagnostic failure is non-blocking
    }
  }

  // Environment variable override (locked mode is protected)
  if (envMode && VALID_MODES.has(envMode)) {
    if (configMode === "locked") return "locked"; // locked cannot be overridden
    return envMode as EnforcementMode;
  }

  return configMode;
}

/**
 * Source-aware enforcement mode resolution result.
 * Provides full visibility into how the final mode was determined:
 *   - configMode: value from project.config.json `develop_enforcement_mode`
 *   - envMode: value from ENFORCEMENT_MODE env var (null if not set)
 *   - finalMode: the mode actually used (same as getEnforcementMode())
 *   - downgraded: true if envMode is LESS strict than configMode
 *   - downgradeReason: human-readable explanation (null if not downgraded)
 *
 * Strictness ordering (least → most): advisory < strict < locked
 * A downgrade occurs when the env override reduces strictness.
 *
 * **FIX-003**: This function provides source-aware resolution without
 * duplicating getEnforcementMode() logic. It reads the same config sources
 * but decomposes the result for diagnostic and enforcement purposes.
 *
 * @public — Used by pre-commit hooks to detect and block env downgrades
 * @since 2026-06-21 — FIX-003 source-aware mode resolution
 */
export interface EnforcementModeWithSource {
  configMode: EnforcementMode;
  envMode: EnforcementMode | null;
  finalMode: EnforcementMode;
  downgraded: boolean;
  downgradeReason: string | null;
}

const STRICTNESS_ORDER: Readonly<Record<EnforcementMode, number>> = {
  advisory: 0,
  strict: 1,
  locked: 2,
};

/**
 * Get enforcement mode with full source-aware breakdown.
 *
 * Reads project.config.json `develop_enforcement_mode` as configMode
 * and ENFORCEMENT_MODE env var as envMode. Computes finalMode using
 * the same priority as getEnforcementMode(). Detects whether the
 * environment variable is downgrading enforcement strictness.
 *
 * @public — FIX-003: Source-aware mode resolution for hook integrity checks
 */
export function getEnforcementModeWithSource(
  root?: string,
): EnforcementModeWithSource {
  const envModeRaw = process.env.ENFORCEMENT_MODE;
  const projectRoot = root || getProjectRoot();

  // Read config mode from project.config.json
  let configMode: EnforcementMode = "advisory";
  const cfgPath = path.join(projectRoot, ".opencode", "project.config.json");
  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      const tr = cfg.template_resolution;
      const mode = tr?.develop_enforcement_mode || tr?.runtime_enforcement_mode;
      if (mode && VALID_MODES.has(mode)) {
        configMode = mode as EnforcementMode;
      }
    }
  } catch {
    // use default
  }

  // Validate env mode
  const envMode: EnforcementMode | null =
    envModeRaw && VALID_MODES.has(envModeRaw)
      ? (envModeRaw as EnforcementMode)
      : null;

  // Determine final mode (same logic as getEnforcementMode)
  let finalMode = configMode;
  let downgraded = false;
  let downgradeReason: string | null = null;

  if (envMode) {
    if (configMode === "locked") {
      // locked mode cannot be overridden by env
      finalMode = "locked";
    } else {
      finalMode = envMode;
    }
  }

  // Detect downgrade: env mode less strict than config mode
  if (envMode && configMode !== "locked") {
    const envStrictness = STRICTNESS_ORDER[envMode];
    const cfgStrictness = STRICTNESS_ORDER[configMode];
    if (envStrictness < cfgStrictness) {
      downgraded = true;
      downgradeReason =
        `ENFORCEMENT_MODE env var (${envMode}) is less strict than ` +
        `project.config.json develop_enforcement_mode (${configMode}). ` +
        `Expected at least "${configMode}" but got "${envMode}".`;
    }
  }

  return { configMode, envMode, finalMode, downgraded, downgradeReason };
}

// ════════════════════════════════════════════════════════════
// GATE STORE I/O
// ════════════════════════════════════════════════════════════

/** @public — Primary gate state file path resolver */
export function getGateStatePath(root?: string): string {
  const stateDir = resolveStateDir(root);
  return process.env.GATE_STATE_PATH || path.join(stateDir, "gate-state.json");
}

/** @public — Machine state file path resolver */
export function getMachinePath(root?: string): string {
  const stateDir = resolveStateDir(root);
  return path.join(stateDir, "machine.json");
}

/**
 * Create a fresh gate store with default values.
 * @internal — Utility function; external consumers should use loadGateStore()
 */
export function createFreshStore(): GateStore {
  return {
    formatVersion: "2.0",
    sessions: {},
    active_sessions: [],
    last_updated: null as unknown as string,
  };
}

/**
 * Load the gate store from the JSON file on disk (internal helper).
 * P2-A Step 3: renamed from loadGateStore; used as DB fallback during transition.
 */
function loadGateStoreJson(root?: string): GateStore {
  const gateFile = getGateStatePath(root);
  const s = readJsonFile<GateStore>(gateFile);

  if (
    s &&
    s.formatVersion === "2.0" &&
    s.sessions &&
    typeof s.sessions === "object"
  ) {
    if (!Array.isArray(s.active_sessions)) {
      s.active_sessions = [];
    }
    // Ensure last_updated
    if (!s.last_updated) {
      s.last_updated = new Date().toISOString();
    }
    return s;
  }

  return createFreshStore();
}

/**
 * Apply active_sessions reconciliation to a GateStore in-place.
 * Extracted from the former loadGateStore so both DB and JSON paths
 * apply the same invariant enforcement.
 *
 * @returns true if the store was modified (caller should persist)
 */
function reconcileGateStore(s: GateStore): boolean {
  let reconciled = false;

  // Remove completed/failed/drained sessions from active_sessions
  s.active_sessions = s.active_sessions.filter((sid) => {
    const ses = s.sessions[sid];
    if (!ses) {
      reconciled = true;
      return false;
    }
    if (
      ses.gate_status === "completed" ||
      ses.gate_status === "failed" ||
      ses.gate_status === "drained"
    ) {
      reconciled = true;
      return false;
    }
    if (ses.consumed_at) {
      reconciled = true;
      return false;
    }
    return true;
  });

  // Remove stale armed sessions (>24h since confirmation)
  const STALE_MS = 24 * 60 * 60 * 1000;
  const nowTs = Date.now();
  s.active_sessions = s.active_sessions.filter((sid) => {
    const ses = s.sessions[sid];
    if (!ses) return false;
    if (ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at) {
      const age = nowTs - new Date(ses.confirmed_at).getTime();
      if (age > STALE_MS) {
        reconciled = true;
        return false;
      }
    }
    return true;
  });

  // Add armed/delivered/approved sessions missing from active_sessions
  const LIVE_STATUSES = ["armed", "delivered", "approved"];
  for (const [sid, ses] of Object.entries(s.sessions)) {
    if (
      LIVE_STATUSES.includes(ses.gate_status) &&
      !ses.consumed_at &&
      !s.active_sessions.includes(sid)
    ) {
      s.active_sessions.push(sid);
      reconciled = true;
    }
  }

  if (reconciled) {
    s.last_updated = new Date().toISOString();
  }
  if (!s.last_updated) {
    s.last_updated = new Date().toISOString();
  }

  return reconciled;
}

/**
 * Load the gate store with DB priority + JSON fallback (P2-A Step 3).
 *
 * Read order:
 *   1. DB (gate_sessions + gate_store_meta + gate_audit_history)
 *   2. JSON file (gate-state.json) — fallback if DB empty or failed
 *
 * Whichever source returns the store, reconciliation is applied.
 * If reconciliation modified the store, both DB and JSON are persisted
 * so subsequent readers see a consistent view.
 *
 * @public — Primary gate store loader with auto-reconciliation
 */
export function loadGateStore(root?: string): GateStore {
  // 1. Try DB first
  let store: GateStore | null = null;
  let fromDb = false;
  try {
    const dbStore = dbLoadGateStore();
    if (dbStore && Object.keys(dbStore.sessions).length > 0) {
      store = dbStore as GateStore;
      fromDb = true;
    }
  } catch {
    // fall through to JSON
  }

  // 2. Fallback to JSON
  if (!store) {
    store = loadGateStoreJson(root);
  }

  // 3. Reconcile (applies invariants to whichever source)
  const modified = reconcileGateStore(store);

  // 4. If modified, persist back to DB
  if (modified) {
    try {
      dbSaveGateStore(store);
    } catch (e: any) {
      writeLogSafe(SRC, "WARN", {
        event: "DB-RECONCILE-WRITE-FAILED",
        detail: e.message,
      });
    }
  }

  // Log source for diagnostics
  if (!fromDb && store && Object.keys(store.sessions).length > 0) {
    // DB was empty/failed, JSON was used — flag for observability
    // (no-op in normal operation; becomes actionable after Step 8)
  }

  return store;
}

/**
 * Search for an armed (confirmed, not consumed) gate session.
 *
 * Framework-enforcer.ts previously had its own inline implementation of this
 * function (~20 lines).  Centralising the lookup here eliminates duplication
 * and ensures the armed-session predicate stays consistent across all
 * consumers (plugin, gate-core, CI scripts).
 *
 * @returns { found: true, sessionId } when an armed session exists;
 *          { found: false, sessionId: null } otherwise.
 *
 * @public — Used by framework-enforcer.ts for pre-execution gate checks.
 * @since FW-HARNESS-P0-2a
 */
export function findArmedSession(root?: string): {
  found: boolean;
  sessionId: string | null;
} {
  const gate = loadGateStore(root);
  const sessions = Object.values(gate.sessions);
  const armed = sessions.find(
    (s) => s.gate_status === "armed" && s.consumed_at === null,
  );
  return armed
    ? { found: true, sessionId: armed.session_id }
    : { found: false, sessionId: null };
}

/**
 * Search for any non-consumed, non-drained gate session.
 *
 * Used for planning-phase tools (task) that require at least a checked
 * session without demanding the stricter "armed" status.  Previously
 * inlined in framework-enforcer.ts (~22 lines).
 *
 * @returns { found: true, sessionId } when a valid session exists;
 *          { found: false, sessionId: null } otherwise.
 *
 * @public — Used by framework-enforcer.ts for task-scheduling gate checks.
 * @since FW-HARNESS-P0-2a
 */
export function findAnyGateSession(root?: string): {
  found: boolean;
  sessionId: string | null;
} {
  const gate = loadGateStore(root);
  const sessions = Object.values(gate.sessions);
  const valid = sessions.find(
    (s) => s.consumed_at === null && s.gate_status !== "drained",
  );
  return valid
    ? { found: true, sessionId: valid.session_id }
    : { found: false, sessionId: null };
}

/**
 * Save the gate store (DB-only — P2-A Step 8, solves G1 non-atomic writes).
 * SQLite transaction provides atomic persistence; JSON dual-write removed.
 * @public — Primary gate store persistence API
 */
export function saveGateStore(store: GateStore, root?: string): void {
  try {
    dbSaveGateStore(store);
  } catch (e: any) {
    writeLogSafe(SRC, "ERROR", {
      event: "DB-SAVE-GATE-FAILED",
      detail: e.message,
    });
  }
}

// ════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ════════════════════════════════════════════════════════════

/**
 * Generate a unique session ID.
 * @internal — Internal helper; external consumers use createSession() which calls this
 */
export function generateSessionId(): string {
  return "cg_ses_" + Date.now();
}

/**
 * Create a new session in the gate store.
 * Returns the created session.
 * @public — Primary session creation API (compliance_gate_check entry point)
 */
export function createSession(
  taskDescription: string,
  failedItems: GateCheckItem[],
  ruleStatus: Record<string, string>,
  mode: EnforcementMode,
  root?: string,
): { session: GateSession; store: GateStore } {
  const store = loadGateStore(root);
  const sessionId = generateSessionId();
  const hasHighSeverity = failedItems.some((f) => f.severity === "HIGH");

  const session: GateSession = {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    task_description: taskDescription || "",
    enforcement_mode: mode,
    gate_status: "checked",
    last_check_passed: !hasHighSeverity,
    last_check_failed_items: failedItems,
    plan_summary: null,
    confirmed_at: null,
    consumed_at: null,
    audit: null,
  };

  store.sessions[sessionId] = session;
  store.last_updated = new Date().toISOString();
  saveGateStore(store, root);

  return { session, store };
}

/**
 * Validate and arm a session (confirm).
 * @public — Primary session arming API (compliance_gate_confirm entry point)
 */
export function armSession(
  sessionId: string,
  planSummary: string,
  agent?: string,
  taskId?: string,
  root?: string,
  declaredDeliverables?: DeliverableEntry[],
): GateConfirmResult {
  // ── FW-DISPATCH-TASKID-IMMUTABLE: task_id integrity at arm phase ──
  // Uses session_map DB (per-session dag_task_id) instead of shared
  // .dispatch_ctx file. DB is immune to concurrent dispatch race
  // conditions and task-after.ts deletion.
  //
  // Defense-in-depth: runGateCheck() validates at check phase, this
  // validates at arm phase. If sub-agent bypasses check (e.g. stale
  // .dispatch_ctx deleted by task-after.ts), arm still catches it.
  let hasDispatchContext = false;
  let dispatchAssignedTaskIds: string[] = [];
  try {
    if (taskId) {
      const { dbQuerySessionByDagTaskId } = require("./db-state-manager");
      const sessions = dbQuerySessionByDagTaskId(taskId);
      if (sessions.length > 0) {
        hasDispatchContext = true;
        dispatchAssignedTaskIds = [taskId];
      } else {
        // taskId not found — check if ANY dispatch context exists
        try {
          const { getDb } = require("./db-manager");
          const db = getDb();
          const anyRegistered = db
            .query(
              `SELECT dag_task_id FROM session_map WHERE dag_task_id IS NOT NULL LIMIT 1`,
            )
            .all() as { dag_task_id: string }[];
          if (anyRegistered.length > 0) {
            hasDispatchContext = true;
            dispatchAssignedTaskIds = anyRegistered.map((r) => r.dag_task_id);
          }
        } catch {
          /* DB failure — fall through */
        }
      }
    } else {
      // No taskId — fallback to ctx/ directory first (per-dispatch, no race)
      // IMPLEMENT-DISPATCH-CTX-FIX (GAP-2, 2026-06-19, @Super-Admin):
      //   Per-dispatch ctx/{dagTaskId}.json files are immune to overwrite
      //   race conditions. .dispatch_ctx is legacy fallback only.
      const projectRoot = root || getProjectRoot();
      const ctxDir = path.join(projectRoot, ".task_temp", "_dispatch", "ctx");
      try {
        if (fs.existsSync(ctxDir)) {
          const files = fs
            .readdirSync(ctxDir)
            .filter((f) => f.endsWith(".json"));
          if (files.length > 0) {
            const latest = files.reduce((a, b) => {
              const sa = fs.statSync(path.join(ctxDir, a));
              const sb = fs.statSync(path.join(ctxDir, b));
              return sa.mtimeMs > sb.mtimeMs ? a : b;
            });
            const ctx = JSON.parse(
              fs.readFileSync(path.join(ctxDir, latest), "utf8"),
            );
            if (ctx?.dagTaskId) {
              dispatchAssignedTaskIds = [ctx.dagTaskId];
              hasDispatchContext = true;
            }
          }
        }
      } catch {
        /* ctx/ scan failed — fall through to .dispatch_ctx */
      }

      // Legacy: .dispatch_ctx (if ctx/ scan missed)
      if (!hasDispatchContext) {
        const dispatchCtxPath = path.join(
          projectRoot,
          ".task_temp",
          "_dispatch",
          ".dispatch_ctx",
        );
        try {
          if (fs.existsSync(dispatchCtxPath)) {
            const ctx = JSON.parse(fs.readFileSync(dispatchCtxPath, "utf8"));
            if (ctx && ctx.dagTaskId) {
              dispatchAssignedTaskIds = [ctx.dagTaskId];
              hasDispatchContext = true;
            }
          }
        } catch {
          /* unreadable — fall through */
        }
      }
    }
  } catch {
    /* DB failure — fall through */
  }

  if (hasDispatchContext && taskId && dispatchAssignedTaskIds.length > 0) {
    if (!dispatchAssignedTaskIds.includes(taskId)) {
      writeLogSafe(SRC, "ERROR", {
        event: "DISPATCH_TASKID_TAMPER_AT_ARM",
        provided_task_id: taskId,
        dispatch_registered_task_ids: dispatchAssignedTaskIds,
        detail:
          "sub-agent attempted to use a task_id not registered in any dispatch at arm phase",
      });
      return {
        status: "rejected",
        reason: `DISPATCH-INTEGRITY: taskId "${taskId}" is not registered in any dispatch session. Registered: ${dispatchAssignedTaskIds.join(", ")}. The dispatch-assigned task_id is immutable.`,
      };
    }
  }

  // Normalize: use dispatch-assigned taskId when empty
  if (!taskId && dispatchAssignedTaskIds.length === 1) {
    taskId = dispatchAssignedTaskIds[0];
  }

  const store = loadGateStore(root);
  const session = sessionId ? store.sessions[sessionId] : undefined;

  if (!session) {
    return {
      status: "rejected",
      reason: `session not found: ${sessionId || "(missing)"}. Must call compliance_gate_check first.`,
    };
  }

  if (session.gate_status === "armed") {
    return {
      status: "rejected",
      reason: `session ${sessionId} is already armed. Cannot re-arm.`,
    };
  }

  if (session.gate_status !== "checked") {
    return {
      status: "rejected",
      reason: `session ${sessionId} is not in "checked" state (current: ${session.gate_status}). Must call compliance_gate_check first.`,
    };
  }

  if (!planSummary || planSummary.trim().length < 10) {
    return {
      status: "rejected",
      reason: "plan_summary must be at least 10 characters",
    };
  }

  const mode = getEnforcementMode(root);
  if (session.last_check_passed === false && mode !== "advisory") {
    return {
      status: "rejected",
      reason: `Gate check failed — resolve HIGH severity violations before arming. Session ${sessionId} has ${session.last_check_failed_items?.length || 0} check failures in ${mode} enforcement mode.`,
    };
  }

  // ── Deliverables hard constraint validation ──
  const EXEMPT_AGENTS = [
    "@Orchestrator",
    "@Super-Admin",
    "Orchestrator",
    "Super-Admin",
  ];
  const resolvedAgent = agent || session.agent || "unknown";
  const isExempt = EXEMPT_AGENTS.some(
    (exempt) => resolvedAgent === exempt || `@${resolvedAgent}` === exempt,
  );

  if (
    !isExempt &&
    (!declaredDeliverables || declaredDeliverables.length === 0)
  ) {
    return {
      status: "rejected",
      reason: `declared_deliverables is REQUIRED for agent "${resolvedAgent}". Exempt agents: @Orchestrator, @Super-Admin.`,
    };
  }

  session.gate_status = "armed";
  session.plan_summary = planSummary.trim();
  session.confirmed_at = new Date().toISOString();
  session.last_check_failed_items = [];
  session.task_id = taskId || session.task_id || null;
  session.agent = resolvedAgent;
  session.worktree = process.cwd();
  session.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  session.declared_deliverables = declaredDeliverables;
  session.approval_required = !isExempt;

  // Clean active_sessions
  store.active_sessions = store.active_sessions.filter((sid) => {
    const s = store.sessions[sid];
    return s && s.gate_status === "armed" && !s.consumed_at;
  });

  if (!store.active_sessions.includes(sessionId)) {
    store.active_sessions.push(sessionId);
  }

  store.last_updated = new Date().toISOString();
  saveGateStore(store, root);

  return {
    status: "armed",
    session_id: sessionId,
    confirmed_at: session.confirmed_at,
    expires_at: session.expires_at,
    plan_summary: planSummary.trim().substring(0, 200),
  };
}

/**
 * Complete a session and produce audit record.
 * @public — Primary session completion API (compliance_gate_complete entry point)
 */
export function completeSession(
  sessionId: string,
  executionSummary: string,
  root?: string,
): GateCompleteResult {
  const store = loadGateStore(root);
  const session = sessionId ? store.sessions[sessionId] : undefined;

  if (!session) {
    return {
      status: "rejected",
      reason: `session not found: ${sessionId || "(missing)"}. Must call compliance_gate_check and compliance_gate_confirm first.`,
    };
  }

  // ── State gate: approval_required sessions must be 'approved', exempt can be 'armed' ──
  if (session.approval_required) {
    if (session.gate_status !== "approved") {
      let guidance = "";
      if (session.gate_status === "armed") {
        guidance =
          "Must call submitDeliverables first, then wait for Orchestrator approval.";
      } else if (session.gate_status === "delivered") {
        guidance = "Awaiting Orchestrator approval.";
      } else {
        guidance = "Must call compliance_gate_confirm first.";
      }
      return {
        status: "rejected",
        reason: `session ${sessionId} requires Orchestrator approval (status: ${session.gate_status}). ${guidance}`,
      };
    }
  } else {
    if (session.gate_status !== "armed") {
      return {
        status: "rejected",
        reason: `session ${sessionId} is not armed (status: ${session.gate_status}). Must call compliance_gate_confirm first.`,
      };
    }
  }

  if (session.consumed_at) {
    return {
      status: "rejected",
      reason: `session ${sessionId} already completed at ${session.consumed_at}. Cannot re-complete.`,
    };
  }

  const mode = getEnforcementMode(root);

  // ESLint dirty_modules check — P1-B: read from dedicated sub-state file
  // instead of monolithic machine.json (which now only holds meta + contracts).
  let eslintFailed = false;
  let dirtyModules: string[] = [];

  try {
    const eslintState = readSubState("eslint_state");
    if (eslintState?.aggregate?.dirty_modules?.length > 0) {
      dirtyModules = eslintState.aggregate.dirty_modules;
      eslintFailed = true;
    }
  } catch {
    // Non-blocking
  }

  if (eslintFailed && mode !== "advisory") {
    const now = new Date().toISOString();
    session.gate_status = "failed";
    session.consumed_at = now;
    session.fail_reason =
      "ESLint mock-audit violations found in modules: " +
      dirtyModules.join(", ");
    store.active_sessions = store.active_sessions.filter(
      (sid) => sid !== sessionId,
    );
    store.last_updated = new Date().toISOString();
    saveGateStore(store, root);
    return {
      status: "failed",
      reason:
        "CAT3.7: ESLint mock-audit violations in modules: " +
        dirtyModules.join(", "),
      dirty_modules: dirtyModules,
    };
  }

  // Task artifact validation — @super-admin-handover-enforcement: pass
  // sessionId as fallback so sessions without DAG task_id still get validated.
  const missing = validateTaskArtifacts(
    session.task_id || null,
    root,
    sessionId,
  );
  if (missing.length > 0 && mode !== "advisory") {
    const now = new Date().toISOString();
    session.gate_status = "failed";
    session.consumed_at = now;
    session.fail_reason =
      "Missing required task artifacts: " + missing.join(", ");
    session.missing_artifacts = missing;
    store.active_sessions = store.active_sessions.filter(
      (sid) => sid !== sessionId,
    );
    store.last_updated = new Date().toISOString();
    saveGateStore(store, root);
    return {
      status: "failed",
      reason: "Missing required task artifacts: " + missing.join(", "),
      missing_artifacts: missing,
    };
  }

  // Success
  const now = new Date().toISOString();
  session.gate_status = "completed";
  session.consumed_at = now;
  session.audit = {
    execution_summary: (executionSummary || "").substring(0, 1000),
    completed_at: now,
  };

  // Audit history
  if (!Array.isArray(store.audit_history)) {
    store.audit_history = [];
  }
  store.audit_history.push({
    session_id: sessionId,
    task_description: session.task_description,
    plan_summary: session.plan_summary,
    agent: session.agent,
    task_id: session.task_id,
    confirmed_at: session.confirmed_at,
    consumed_at: now,
    execution_summary: (executionSummary || "").substring(0, 200),
    gate_status: "completed",
  });

  // Keep only last 500 audit entries
  if (store.audit_history.length > 500) {
    store.audit_history = store.audit_history.slice(-500);
  }

  store.active_sessions = store.active_sessions.filter(
    (sid) => sid !== sessionId,
  );
  store.last_updated = now;
  saveGateStore(store, root);

  return {
    status: "completed",
    audit: {
      session_id: sessionId,
      task_description: session.task_description,
      plan_summary: session.plan_summary,
      confirmed_at: session.confirmed_at,
      consumed_at: now,
      execution_summary: session.audit.execution_summary,
      audit_history_count: store.audit_history.length,
    },
  };
}

/**
 * Submit deliverables evidence for a gate session.
 * Transitions: armed → delivered (or armed → recoverable if artifacts missing).
 * @public — Deliverables submission API
 */
export function submitDeliverables(
  sessionId: string,
  deliverablesEvidence: DeliverableEvidence[],
  root?: string,
): { status: string; session_id: string; reason?: string } {
  const store = loadGateStore(root);
  const session = sessionId ? store.sessions[sessionId] : undefined;

  if (!session) {
    return {
      status: "rejected",
      session_id: sessionId,
      reason: `session not found: ${sessionId}`,
    };
  }
  if (session.gate_status !== "armed") {
    return {
      status: "rejected",
      session_id: sessionId,
      reason: `session ${sessionId} is not armed (status: ${session.gate_status})`,
    };
  }
  if (!deliverablesEvidence || deliverablesEvidence.length === 0) {
    return {
      status: "rejected",
      session_id: sessionId,
      reason: "deliverables_evidence must be non-empty",
    };
  }

  const now = new Date().toISOString();
  const evidenceWithTimestamps = deliverablesEvidence.map((ev) => ({
    ...ev,
    submitted_at: now,
  }));

  // Validate artifacts exist (HANDOVER.md + TASK_LOG.md)
  const taskId = session.task_id || sessionId;
  const taskDir = path.join(getProjectRoot(), ".task_temp", taskId || "");
  const missing: string[] = [];

  if (!fs.existsSync(path.join(taskDir, "HANDOVER.md")))
    missing.push("HANDOVER.md");
  if (!fs.existsSync(path.join(taskDir, "TASK_LOG.md")))
    missing.push("TASK_LOG.md");

  if (missing.length > 0) {
    session.gate_status = "recoverable";
    session.submitted_deliverables = evidenceWithTimestamps;
    session.fail_reason = `Missing deliverable artifacts: ${missing.join(", ")}`;
    session.missing_artifacts = missing;
    store.last_updated = now;
    saveGateStore(store, root);
    return {
      status: "recoverable",
      session_id: sessionId,
      reason: `Missing: ${missing.join(", ")}`,
    };
  }

  session.gate_status = "delivered";
  session.submitted_deliverables = evidenceWithTimestamps;
  store.last_updated = now;
  saveGateStore(store, root);
  return { status: "delivered", session_id: sessionId };
}

/**
 * Approve or reject submitted deliverables.
 * @public — Deliverables approval API (Orchestrator/Super-Admin only)
 */
export function approveDeliverables(
  sessionId: string,
  decision: "approve" | "reject",
  approvalNote?: string,
  executionSummary?: string,
  root?: string,
): { status: string; session_id: string; reason?: string } {
  const store = loadGateStore(root);
  const session = sessionId ? store.sessions[sessionId] : undefined;

  if (!session) {
    return {
      status: "rejected",
      session_id: sessionId,
      reason: `session not found: ${sessionId}`,
    };
  }
  if (session.gate_status !== "delivered") {
    return {
      status: "rejected",
      session_id: sessionId,
      reason: `session ${sessionId} is not in delivered state`,
    };
  }

  const now = new Date().toISOString();

  if (decision === "approve") {
    session.deliverables_approved_by = "Orchestrator";
    session.deliverables_approved_at = now;
    session.deliverables_approval_note = approvalNote || null;
    session.gate_status = "approved";

    if (executionSummary) {
      session.gate_status = "completed";
      session.consumed_at = now;
      session.audit = {
        execution_summary: executionSummary.substring(0, 1000),
        completed_at: now,
      };
      store.active_sessions = store.active_sessions.filter(
        (sid) => sid !== sessionId,
      );
    }

    store.last_updated = now;
    saveGateStore(store, root);
    return { status: session.gate_status, session_id: sessionId };
  }

  if (decision === "reject") {
    session.gate_status = "armed";
    session.deliverables_approval_note = approvalNote || "rejected";
    session.submitted_deliverables = undefined;
    store.last_updated = now;
    saveGateStore(store, root);
    return {
      status: "rejected",
      session_id: sessionId,
      reason: approvalNote || "rejected",
    };
  }

  return {
    status: "rejected",
    session_id: sessionId,
    reason: `Invalid decision: ${decision}`,
  };
}

// ════════════════════════════════════════════════════════════
// STALE SESSION MANAGEMENT
// ════════════════════════════════════════════════════════════

/**
 * Drain stale sessions with configurable thresholds.
 * @public — Stale session cleanup API (compliance_gate_drain_stale / purge)
 */
export function drainStaleSessions(
  armedHours = 24,
  checkedHours = 48,
  root?: string,
): {
  purged: number;
  drained_sessions: string[];
  remaining_active: number;
  remaining_total: number;
  drained_armed: number;
  drained_checked: number;
  drained_delivered: number;
} {
  const store = loadGateStore(root);

  const nowTs = Date.now();
  let purged = 0;
  let drainedArmed = 0;
  let drainedChecked = 0;
  let drainedDelivered = 0;
  const drainedIds: string[] = [];

  for (const sid of Object.keys(store.sessions)) {
    const ses = store.sessions[sid];
    if (!ses) continue;

    let shouldDrain = false;
    let reason = "";
    let drainType = "";

    if (ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at) {
      const age = nowTs - new Date(ses.confirmed_at).getTime();
      if (age > armedHours * 3600000) {
        shouldDrain = true;
        drainType = "STALE_ARMED";
        reason = `armed for ${Math.floor(age / 3600000)}h without completion (threshold: ${armedHours}h)`;
      }
    }

    if (ses.gate_status === "checked" && !ses.confirmed_at) {
      const age = nowTs - new Date(ses.created_at).getTime();
      if (age > checkedHours * 3600000) {
        shouldDrain = true;
        drainType = "STALE_CHECKED";
        reason = `checked for ${Math.floor(age / 3600000)}h without confirmation (threshold: ${checkedHours}h)`;
      }
    }

    // Delivered state: drain after 4 hours without Orchestrator approval
    if (ses.gate_status === "delivered" && ses.submitted_deliverables) {
      const submittedAt = ses.submitted_deliverables[0]?.submitted_at;
      if (submittedAt) {
        const age = nowTs - new Date(submittedAt).getTime();
        if (age > 4 * 3600000) {
          shouldDrain = true;
          drainType = "STALE_DELIVERED";
          reason = `delivered for ${Math.floor(age / 3600000)}h without Orchestrator approval (threshold: 4h)`;
        }
      }
    }

    if (shouldDrain) {
      const archived = dbArchiveDrainedSession(
        sid,
        ses.task_description || "",
        reason,
        drainType,
        JSON.stringify(ses),
      );
      if (!archived) {
        writeLogSafe(SRC, "WARN", {
          event: "DRAIN-ARCHIVE-SKIPPED",
          detail: `sid=${sid}`,
        });
        continue;
      }
      delete store.sessions[sid];
      store.active_sessions = store.active_sessions.filter((a) => a !== sid);
      purged++;
      drainedIds.push(sid);
      if (drainType === "STALE_ARMED") drainedArmed++;
      if (drainType === "STALE_CHECKED") drainedChecked++;
      if (drainType === "STALE_DELIVERED") drainedDelivered++;
    }
  }

  if (purged > 0) {
    store.last_updated = new Date().toISOString();
    saveGateStore(store, root);
    writeLogSafe(SRC, "INFO", {
      event: "DRAIN-COMPLETE",
      detail: `purged=${purged} armed=${drainedArmed} checked=${drainedChecked} delivered=${drainedDelivered} total_archived=${dbCountDrainedSessions()}`,
    });
  }

  return {
    purged,
    drained_sessions: drainedIds,
    drained_armed: drainedArmed,
    drained_checked: drainedChecked,
    drained_delivered: drainedDelivered,
    remaining_active: store.active_sessions.length,
    remaining_total: Object.keys(store.sessions).length,
  };
}

// ════════════════════════════════════════════════════════════
// TASK ARTIFACT VALIDATION
// ════════════════════════════════════════════════════════════

/**
 * Validate that HANDOVER.md and TASK_LOG.md exist for a given task.
 *
 * @super-admin-handover-enforcement: When taskId is null (common for
 * @Super-Admin sessions that bypass the DAG), the sessionId is used as a
 * fallback directory name under .task_temp/. This ensures @Super-Admin
 * sessions receive the same HANDOVER.md enforcement as other agents,
 * satisfying SUPER-ADMIN-HARDEN-01.
 *
 * @public — Task artifact validation used by completeSession and external audits
 * @param taskId - The task ID to validate (DAG task ID or dispatch session ID)
 * @param root - Project root path
 * @param sessionId - Fallback identifier when taskId is null (e.g., cg_ses_*)
 * @since v1.2.0 — Added fallback subdirectory scan (SA-FIX-VALIDATE-PATH, @Super-Admin 2026-06-11)
 */
export function validateTaskArtifacts(
  taskId: string | null,
  root?: string,
  sessionId?: string | null,
): string[] {
  const resolvedId = taskId || sessionId;
  if (!resolvedId) return [];
  const projectRoot = root || getProjectRoot();
  const taskDir = path.join(projectRoot, ".task_temp", resolvedId);
  const missing: string[] = [];

  // Check HANDOVER.md: primary path first, then fallback to immediate subdirectories.
  // Dispatch sessions may nest artifacts under .task_temp/{taskId}/_dispatch/ or similar.
  if (!fileExists(path.join(taskDir, "HANDOVER.md"))) {
    if (!scanSubdirForArtifact(taskDir, "HANDOVER.md")) {
      missing.push("HANDOVER.md");
    }
  }

  // Check TASK_LOG.md: same primary+fallback strategy as HANDOVER.md.
  if (!fileExists(path.join(taskDir, "TASK_LOG.md"))) {
    if (!scanSubdirForArtifact(taskDir, "TASK_LOG.md")) {
      missing.push("TASK_LOG.md");
    }
  }

  return missing;
}

/**
 * Scan immediate subdirectories under a base directory for a specific artifact filename.
 * Returns true if the artifact exists in any child directory.
 *
 * @internal — Fallback artifact discovery for dispatch sessions that create subdirectories
 * @param baseDir - The base directory to scan (e.g., .task_temp/{taskId})
 * @param artifact - The artifact filename to find (e.g., 'HANDOVER.md')
 * @returns true if the artifact exists in any immediate subdirectory
 * @since v1.2.0 — SA-FIX-VALIDATE-PATH, @Super-Admin 2026-06-11
 */
function scanSubdirForArtifact(baseDir: string, artifact: string): boolean {
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (fileExists(path.join(baseDir, entry.name, artifact))) return true;
      }
    }
  } catch {
    // Directory doesn't exist or is inaccessible — treat as not found
  }
  return false;
}

// ════════════════════════════════════════════════════════════
// COMPLIANCE VERIFICATION HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Compute a digest (sha256-prefixed) from a file path,
 * compatible with the keystone hash convention.
 * @public — Keystone hash computation for contract/rule validation
 */
export function computeDigest(filePath: string): {
  digest: string | null;
  error: string | null;
} {
  try {
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    return { digest: "sha256-" + hash, error: null };
  } catch (err: unknown) {
    return { digest: null, error: (err as Error).message };
  }
}

/**
 * Extract semantic version from file content.
 * @public — Semver extraction for rule registry version comparison
 */
export function extractSemver(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    // Pattern 1: YAML frontmatter `version: "1.2.3"`
    const fmMatch = content.match(/^version:\s*"?(\d+\.\d+\.\d+)"?/m);
    if (fmMatch) return fmMatch[1];
    // Pattern 2: Markdown header `## Version 1.2.3`
    const hdrMatch = content.match(
      /^#{1,3}\s+(?:Version|v)\s*(\d+\.\d+\.\d+)/im,
    );
    if (hdrMatch) return hdrMatch[1];
    // Pattern 3: Inline `v1.2.3`
    const inlineMatch = content.match(/v(\d+\.\d+\.\d+)/);
    if (inlineMatch) return inlineMatch[1];
  } catch {
    // ignore
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// FRAMEWORK PATH RESOLUTION (MIGRATED from framework-validation.cjs, FW-ENHANCE-A2-A5-EXTRAS)
// ════════════════════════════════════════════════════════════

export interface FrameworkPaths {
  root: string;
  dag: string;
  gateState: string;
  machine: string;
  projectConfig: string;
  ruleRegistry: string;
  ruleRegistryFallback: string;
  pluginsDir: string;
  hooksDir: string;
  stateDir: string;
  scriptsDir: string;
  agentsDir: string;
  rulesDir: string;
}

/**
 * Derive the OpenCode project root by walking up from known marker directories.
 * Pure function — no environment access beyond cwd walk-up.
 * @internal — Helper for resolveFrameworkPaths
 */
function deriveOpenCodeRoot(): string {
  let current = path.resolve(process.cwd());
  for (let i = 0; i < 10; i++) {
    const dotOpenCode = path.join(current, ".opencode");
    if (fs.existsSync(dotOpenCode)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

/**
 * Resolve all framework file paths from a project root.
 * If no root is provided, derives it from cwd walk-up.
 *
 * @param rootDir - Optional explicit project root path
 * @returns FrameworkPaths with all paths resolved as absolute paths
 * @public — Migrated from framework-validation.cjs (FW-ENHANCE-A2-A5-EXTRAS)
 */
export function resolveFrameworkPaths(rootDir?: string): FrameworkPaths {
  const resolvedRoot = rootDir ? path.resolve(rootDir) : deriveOpenCodeRoot();
  return {
    root: resolvedRoot,
    dag: path.join(resolvedRoot, "Task.DAG.json"),
    gateState: path.join(resolvedRoot, ".opencode", "state", "gate-state.json"),
    machine: path.join(resolvedRoot, ".opencode", "state", "machine.json"),
    projectConfig: path.join(resolvedRoot, ".opencode", "project.config.json"),
    ruleRegistry: path.join(
      resolvedRoot,
      ".opencode",
      "state",
      "rule_registry.json",
    ),
    ruleRegistryFallback: path.join(
      resolvedRoot,
      ".opencode",
      "rule_registry.json",
    ),
    pluginsDir: path.join(resolvedRoot, ".opencode", "plugins"),
    hooksDir: path.join(resolvedRoot, ".opencode", "hooks"),
    stateDir: path.join(resolvedRoot, ".opencode", "state"),
    scriptsDir: path.join(resolvedRoot, ".opencode", "scripts"),
    agentsDir: path.join(resolvedRoot, ".opencode", "agents"),
    rulesDir: path.join(resolvedRoot, ".opencode", "rules"),
  };
}

// ════════════════════════════════════════════════════════════
// DAG VALIDATION (MIGRATED from framework-validation.cjs, FW-ENHANCE-A2-A5-EXTRAS)
// ════════════════════════════════════════════════════════════

export interface DagExistsResult {
  found: boolean;
  taskCount: number;
}

/**
 * Check if Task.DAG.json exists and count tasks.
 * @param dagPath - Optional explicit path to Task.DAG.json; uses framework paths if omitted
 * @param verbose - Whether to log diagnostic info (default false)
 * @returns { found, taskCount }
 * @public — Migrated from framework-validation.cjs (FW-ENHANCE-A2-A5-EXTRAS)
 *
 * @deprecated (2026-06-14, FW-DEPRECATE-DEAD-DAG-HELPERS)
 *   ZERO live callers in the framework. Only scans `dag.tasks[]` — does NOT scan
 *   `dag.execution_order`, which is where most tasks now live after the
 *   FW-FIX-EXECORDER-01 reorganization. Using this function gives a misleading
 *   picture of DAG state and was a contributing factor in the mis-diagnosis
 *   documented in docs/review/cicd-dag-block/diagnosis.md.
 *
 *   Live replacement:
 *     - Existence check → `fs.existsSync(STATE_PATHS.dag())`
 *     - Task count     → `readJsonFile(STATE_PATHS.dag()).tasks.length`
 *     - Task lookup    → `findTaskInDag(taskId)` in ./gate-checks.ts (scans
 *                        BOTH `dag.tasks[]` and `dag.execution_order`).
 */
export function checkDagExists(
  dagPath?: string,
  verbose?: boolean,
): DagExistsResult {
  const fp = dagPath ? { dag: dagPath } : resolveFrameworkPaths();
  const dag = readJsonFile<{ tasks?: unknown[] }>(
    fp.dag || (fp as FrameworkPaths).dag,
  );
  if (verbose) {
    // diagnostic output — silent in production
  }
  if (!dag || !Array.isArray(dag.tasks)) {
    return {
      found: fileExists(fp.dag || (fp as FrameworkPaths).dag),
      taskCount: 0,
    };
  }
  return { found: true, taskCount: dag.tasks.length };
}

export interface TaskInDagResult {
  found: boolean;
  status: string;
  owner: string;
}

/**
 * Check if a specific task exists in Task.DAG.json and return its status.
 * @param dag - The parsed DAG object or path to DAG file
 * @param taskId - Task ID to search for
 * @returns { found, status, owner }
 * @public — Migrated from framework-validation.cjs (FW-ENHANCE-A2-A5-EXTRAS)
 *
 * @deprecated (2026-06-14, FW-DEPRECATE-DEAD-DAG-HELPERS)
 *   ZERO live callers in the framework. Only scans `dag.tasks[]` — does NOT scan
 *   `dag.execution_order`. Live replacement: `findTaskInDag(taskId)` in
 *   ./gate-checks.ts (scans BOTH `dag.tasks[]` and `dag.execution_order`,
 *   returns `{ found, status, source }` where source distinguishes which
 *   structure the match came from).
 */
export function checkTaskInDag(
  dag: { tasks?: Array<{ id: string; status: string; owner?: string }> },
  taskId: string,
): TaskInDagResult {
  if (!dag || !Array.isArray(dag.tasks)) {
    return { found: false, status: "unknown", owner: "" };
  }
  const task = dag.tasks.find((t) => t.id === taskId);
  if (!task) {
    return { found: false, status: "unknown", owner: "" };
  }
  return { found: true, status: task.status, owner: task.owner || "" };
}

export interface DagProgressResult {
  total: number;
  completed: number;
  pending: number;
  progressPercent: number;
}

/**
 * Calculate DAG progress (total, completed, pending, percent).
 * @param dag - The parsed DAG object
 * @returns Progress statistics
 * @public — Migrated from framework-validation.cjs (FW-ENHANCE-A2-A5-EXTRAS)
 *
 * @deprecated (2026-06-14, FW-DEPRECATE-DEAD-DAG-HELPERS)
 *   ZERO live callers in the framework. Only counts tasks in `dag.tasks[]` —
 *   ignores tasks that live exclusively in `dag.execution_order` groups, so
 *   the returned `progressPercent` is misleading for DAGs organized that way.
 *   No direct replacement (progress reporting belongs in framework-doctor.ts
 *   and state-integrity-scan.ts, which both handle both DAG layouts).
 */
export function checkDagProgress(dag: {
  tasks?: Array<{ status: string }>;
}): DagProgressResult {
  if (!dag || !Array.isArray(dag.tasks)) {
    return { total: 0, completed: 0, pending: 0, progressPercent: 0 };
  }
  const tasks = dag.tasks;
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const pending = tasks.filter(
    (t) => t.status === "pending" || t.status === "in_progress",
  ).length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, pending, progressPercent };
}

// ════════════════════════════════════════════════════════════
// GATE STATE VALIDATION (MIGRATED from framework-validation.cjs, FW-ENHANCE-A2-A5-EXTRAS)
// ════════════════════════════════════════════════════════════

export interface ArmedSessionResult {
  found: boolean;
  sessionId: string | null;
}

/**
 * Check if an armed compliance gate session exists.
 * An "armed" session has confirmed_at set, consumed_at is null,
 * and gate_status is "armed" (not "failed" or "drained").
 *
 * @param gateState - Parsed gate-state.json object
 * @returns { found, sessionId }
 * @public — Migrated from framework-validation.cjs (FW-ENHANCE-A2-A5-EXTRAS)
 */
export function checkArmedSession(gateState: {
  sessions?: Record<
    string,
    { gate_status?: string; consumed_at?: string | null; session_id?: string }
  >;
}): ArmedSessionResult {
  if (!gateState || !gateState.sessions) {
    return { found: false, sessionId: null };
  }
  const sessions = Object.values(gateState.sessions);
  const armed = sessions.find(
    (s) => s.gate_status === "armed" && s.consumed_at === null,
  );
  return armed
    ? { found: true, sessionId: armed.session_id || null }
    : { found: false, sessionId: null };
}

export interface StaleSessionInfo {
  id: string;
  age: number;
}

export interface StaleSessionsResult {
  stale: StaleSessionInfo[];
  count: number;
}

/**
 * Scan for stale gate sessions (older than thresholds).
 * Stale = drained > 48h, or checked > 48h without confirmation.
 *
 * @param gateState - Parsed gate-state.json object
 * @param thresholdHours - Hours threshold for staleness (default 48)
 * @returns Stale session info
 * @public — Migrated from framework-validation.cjs (FW-ENHANCE-A2-A5-EXTRAS)
 */
export function checkStaleSessions(
  gateState: {
    sessions?: Record<
      string,
      {
        session_id?: string;
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
        id: s.session_id || "",
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
        id: s.session_id || "",
        age: Math.round(ageHours * 10) / 10,
      });
    }
  }
  return { stale, count: stale.length };
}

export interface GateIntegrityResult {
  valid: boolean;
  issues: string[];
}

/**
 * Check gate-state.json structural integrity.
 * Validates: formatVersion presence, sessions structure, session ID format.
 *
 * @param gateState - Parsed gate-state.json object
 * @returns Integrity check result
 * @public — Migrated from framework-validation.cjs (FW-ENHANCE-A2-A5-EXTRAS)
 */
export function checkGateIntegrity(gateState: {
  formatVersion?: string;
  sessions?: Record<string, { session_id?: string; gate_status?: string }>;
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
      if (!s.session_id) {
        issues.push("gate-state.json: session entry missing session_id");
      }
      if (
        s.gate_status &&
        !["checked", "armed", "completed", "failed", "drained"].includes(
          s.gate_status,
        )
      ) {
        issues.push(
          `gate-state.json: unknown gate_status '${s.gate_status}' in session ${s.session_id || "(unknown)"}`,
        );
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

// ════════════════════════════════════════════════════════════
// MACHINE STATE VALIDATION (MIGRATED from framework-validation.cjs, FW-ENHANCE-A2-A5-EXTRAS)
// ════════════════════════════════════════════════════════════

export interface MachineCleanlinessResult {
  clean: boolean;
  dirty: string[];
}

/**
 * Check if machine sub-states are clean (no violations, no dirty modules).
 *
 * P1-B split architecture: reads each sub-state from its dedicated file
 * via readSubState() instead of from a monolithic machine.json parameter.
 * After the split, machine.json only contains meta + contracts;
 * eslint_state, type_check_state, dependency_state, and format_state
 * live in separate JSON files under .opencode/state/.
 *
 * @returns Cleanliness check result
 * @public — Migrated from framework-validation.cjs (FW-ENHANCE-A2-A5-EXTRAS)
 * @since P1-B — Signature changed: removed machineState parameter (obsolete after split)
 */
export function checkMachineCleanliness(): MachineCleanlinessResult {
  const dirty: string[] = [];

  try {
    const eslintAgg = readSubState("eslint_state")?.aggregate;
    if (eslintAgg?.dirty_modules?.length > 0) {
      dirty.push(
        `eslint_state: ${eslintAgg.dirty_modules.length} dirty module(s) — ${eslintAgg.dirty_modules.join(", ")}`,
      );
    }

    const tcs = readSubState("type_check_state");
    if (tcs?.status && tcs.status !== "clean") {
      dirty.push(
        `type_check_state: status=${tcs.status}, ${(tcs.dirty_files || []).length} dirty file(s)`,
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
    // Non-blocking — readSubState returns {} on failure, so sub-states
    // that cannot be read are treated as empty/clean.
  }

  return { clean: dirty.length === 0, dirty };
}

// ════════════════════════════════════════════════════════════
// RULE REGISTRY VALIDATION (MIGRATED from framework-validation.cjs, FW-ENHANCE-A2-A5-EXTRAS)
// ════════════════════════════════════════════════════════════

export interface RegistryMismatch {
  file: string;
  severity: "HIGH" | "WARNING";
}

export interface RuleRegistryResult {
  valid: boolean;
  mismatches: RegistryMismatch[];
}

/**
 * Check critical infrastructure files for uncommitted changes using git diff HEAD.
 * Replaces the old SHA-256 digest comparison against rule_registry.json.
 * All modified critical files are reported as HIGH severity.
 *
 * @returns Integrity check result
 * @public — Migrated from framework-validation.cjs (FW-ENHANCE-A2-A5-EXTRAS)
 */
export function checkRuleRegistryIntegrity(): RuleRegistryResult {
  try {
    const { getModifiedCriticalFiles } = require("./critical-files");
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

// ════════════════════════════════════════════════════════════
// PERMISSION ISOLATION (MIGRATED from framework-validation.cjs, FW-ENHANCE-A2-A5-EXTRAS)
// ════════════════════════════════════════════════════════════

/**
 * Simple glob matching for agent_write_scopes patterns.
 * Supports ** (recursive), * (single-segment wildcard), and literal paths.
 *
 * @param filePath - File path to test against pattern
 * @param pattern - Glob pattern (from agent_write_scopes)
 * @returns true if path matches the pattern
 * @public — Migrated from framework-validation.cjs (FW-ENHANCE-A2-A5-EXTRAS)
 */
export function pathMatchesGlob(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");
  const regexStr = pat
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`^${regexStr}$`).test(normalized);
}

export interface WriteScope {
  allowed: string[];
  denied: string[];
}

/**
 * Check whether an agent is allowed to write to a given file path.
 * Checks denied patterns first (explicit deny always wins).
 *
 * @param agentType - Agent type string (e.g., "@Coder-BE")
 * @param filePath - File path to check
 * @param permissionProfiles - Agent write scope profiles (from project.config.json agent_write_scopes)
 * @returns true if write is permitted, false otherwise
 * @public — Migrated from framework-validation.cjs (FW-ENHANCE-A2-A5-EXTRAS)
 */
export function isAgentAllowedToWrite(
  agentType: string,
  filePath: string,
  permissionProfiles: Record<string, WriteScope>,
): boolean {
  const scopes = permissionProfiles?.[agentType];
  if (!scopes) return true; // No scope defined — allow all

  for (const pattern of scopes.denied || []) {
    if (pathMatchesGlob(filePath, pattern)) return false;
  }
  for (const pattern of scopes.allowed || []) {
    if (pathMatchesGlob(filePath, pattern)) return true;
  }
  return false; // No matching allow pattern — deny
}

// ════════════════════════════════════════════════════════════
// ERROR CLASS (MIGRATED from framework-validation.cjs, FW-ENHANCE-A2-A5-EXTRAS)
// ════════════════════════════════════════════════════════════

/**
 * FrameworkEnforcementError — structured error for enforcement violations.
 * Carries check name, severity, agent identity, task ID, and enforcement mode
 * for rich error handling upstream.
 *
 * @public — Migrated from framework-validation.cjs (FW-ENHANCE-A2-A5-EXTRAS)
 */
export class FrameworkEnforcementError extends Error {
  /** Which check failed (e.g., "DAG Coverage", "Gate Lifecycle") */
  check: string;
  /** Severity level: "HIGH", "WARNING", or "INFO" */
  severity: "HIGH" | "WARNING" | "INFO";
  /** Agent type that triggered the violation (e.g., "@Coder-BE") */
  agent: string;
  /** Task ID associated with the violation */
  taskId: string;
  /** Enforcement mode at the time of the violation */
  mode: string;

  constructor(
    check: string,
    message: string,
    severity: "HIGH" | "WARNING" | "INFO" = "HIGH",
    agent: string = "",
    taskId: string = "",
    mode: string = "strict",
  ) {
    super(message);
    this.name = "FrameworkEnforcementError";
    this.check = check;
    this.severity = severity;
    this.agent = agent;
    this.taskId = taskId;
    this.mode = mode;
    Object.setPrototypeOf(this, FrameworkEnforcementError.prototype);
  }

  /**
   * Serialise the error to a JSON-friendly object.
   * @public
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      check: this.check,
      severity: this.severity,
      agent: this.agent,
      taskId: this.taskId,
      mode: this.mode,
    };
  }
}
