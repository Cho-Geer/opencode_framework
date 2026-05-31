/**
 * gate-core.ts — Shared Compliance Gate Core Logic
 * =================================================
 *
 * SINGLE SOURCE OF TRUTH for compliance gate state operations.
 * Currently duplicated across:
 *   - .opencode/scripts/mcp-tools/compliance-gate.js (1261 lines)
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
 * @version 1.0.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════

export interface GateSession {
  session_id: string;
  created_at: string;
  task_description?: string;
  enforcement_mode?: string;
  gate_status: 'checked' | 'armed' | 'completed' | 'failed' | 'drained';
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
}

export interface GateCheckItem {
  id: string;
  desc: string;
  severity: 'HIGH' | 'WARNING' | 'INFO';
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
  status: 'armed' | 'rejected';
  reason?: string;
  session_id?: string;
  confirmed_at?: string;
  expires_at?: string;
  plan_summary?: string;
}

export interface GateCompleteResult {
  status: 'completed' | 'failed' | 'rejected';
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

export type EnforcementMode = 'advisory' | 'strict' | 'locked';

interface DrainedStore {
  formatVersion: string;
  drained_sessions: Record<string, GateSession & { drained_at: string; drain_reason: string; drain_type?: string }>;
  last_drained: string | null;
  total_drained?: number;
}

// ════════════════════════════════════════════════════════════
// PATH RESOLUTION
// ════════════════════════════════════════════════════════════

/**
 * Get the project root directory.
 * Priority: OPENCODE_ROOT env var > process.cwd()
 */
export function getProjectRoot(): string {
  return process.env.OPENCODE_ROOT || process.cwd();
}

/**
 * Resolve the state directory path.
 * Handles project_root nesting (e.g., booking_system_refactor/).
 */
export function resolveStateDir(root?: string): string {
  const projectRoot = root || getProjectRoot();
  const cfgPath = path.join(projectRoot, '.opencode', 'project.config.json');
  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const pr = cfg.project_root;
      if (pr && pr !== '.') {
        const stateDir = path.join(projectRoot, pr, '.opencode', 'state');
        if (fs.existsSync(stateDir)) return stateDir;
      }
    }
  } catch {
    // fall through
  }
  return path.join(projectRoot, '.opencode', 'state');
}

// ════════════════════════════════════════════════════════════
// FILE OPERATIONS
// ════════════════════════════════════════════════════════════

/**
 * Read and parse a JSON file. Returns null on any failure.
 */
export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Check if a file exists at the given path.
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
 */
export function computeSHA256(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256');
    hash.update(content);
    return hash.digest('hex');
  } catch {
    return null;
  }
}

/**
 * Write JSON to a file with mkdirp.
 */
export function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ════════════════════════════════════════════════════════════
// ENFORCEMENT MODE
// ════════════════════════════════════════════════════════════

const VALID_MODES: ReadonlySet<string> = new Set([
  'advisory',
  'strict',
  'locked',
]);

/**
 * Determine the current enforcement mode.
 * Priority: ENFORCEMENT_MODE env var > project.config.json > default "advisory"
 */
export function getEnforcementMode(root?: string): EnforcementMode {
  const envMode = process.env.ENFORCEMENT_MODE;
  const projectRoot = root || getProjectRoot();

  // Read from project.config.json
  const cfgPath = path.join(projectRoot, '.opencode', 'project.config.json');
  let configMode: EnforcementMode = 'advisory';

  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      const mode = cfg.template_resolution?.enforcement_mode;
      if (mode && VALID_MODES.has(mode)) {
        configMode = mode;
      }
    }
  } catch {
    // use default
  }

  // Environment variable override (locked mode is protected)
  if (envMode && VALID_MODES.has(envMode)) {
    if (configMode === 'locked') return 'locked'; // locked cannot be overridden
    return envMode as EnforcementMode;
  }

  return configMode;
}

// ════════════════════════════════════════════════════════════
// GATE STORE I/O
// ════════════════════════════════════════════════════════════

export function getGateStatePath(root?: string): string {
  const stateDir = resolveStateDir(root);
  return process.env.GATE_STATE_PATH ||
    path.join(stateDir, 'gate-state.json');
}

export function getMachinePath(root?: string): string {
  const stateDir = resolveStateDir(root);
  return path.join(stateDir, 'machine.json');
}

export function getDrainedStorePath(gateStateFile: string): string {
  return gateStateFile.replace(/\.json$/, '.drained_sessions.json');
}

/**
 * Create a fresh gate store with default values.
 */
export function createFreshStore(): GateStore {
  return {
    formatVersion: '2.0',
    sessions: {},
    active_sessions: [],
    last_updated: null as unknown as string,
  };
}

/**
 * Load the gate store from disk, with active_sessions reconciliation.
 */
export function loadGateStore(root?: string): GateStore {
  const gateFile = getGateStatePath(root);
  const s = readJsonFile<GateStore>(gateFile);

  if (
    s &&
    s.formatVersion === '2.0' &&
    s.sessions &&
    typeof s.sessions === 'object'
  ) {
    // Ensure active_sessions exists
    if (!Array.isArray(s.active_sessions)) {
      s.active_sessions = [];
    }

    // Reconciliation: remove completed/failed sessions from active_sessions
    let reconciled = false;

    s.active_sessions = s.active_sessions.filter((sid) => {
      const ses = s.sessions[sid];
      if (!ses) { reconciled = true; return false; }
      if (ses.gate_status === 'completed' || ses.gate_status === 'failed') {
        reconciled = true; return false;
      }
      if (ses.consumed_at) { reconciled = true; return false; }
      return true;
    });

    // Remove stale armed sessions (>24h since confirmation)
    const STALE_MS = 24 * 60 * 60 * 1000;
    const nowTs = Date.now();
    s.active_sessions = s.active_sessions.filter((sid) => {
      const ses = s.sessions[sid];
      if (!ses) return false;
      if (ses.gate_status === 'armed' && !ses.consumed_at && ses.confirmed_at) {
        const age = nowTs - new Date(ses.confirmed_at).getTime();
        if (age > STALE_MS) { reconciled = true; return false; }
      }
      return true;
    });

    // Add armed sessions missing from active_sessions
    for (const [sid, ses] of Object.entries(s.sessions)) {
      if (
        ses.gate_status === 'armed' &&
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

    return s;
  }

  return createFreshStore();
}

/**
 * Save the gate store to disk.
 */
export function saveGateStore(store: GateStore, root?: string): void {
  const gateFile = getGateStatePath(root);
  writeJsonFile(gateFile, store);
}

// ════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ════════════════════════════════════════════════════════════

/**
 * Generate a unique session ID.
 */
export function generateSessionId(): string {
  return 'cg_ses_' + Date.now();
}

/**
 * Create a new session in the gate store.
 * Returns the created session.
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
  const hasHighSeverity = failedItems.some((f) => f.severity === 'HIGH');

  const session: GateSession = {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    task_description: taskDescription || '',
    enforcement_mode: mode,
    gate_status: 'checked',
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
 */
export function armSession(
  sessionId: string,
  planSummary: string,
  agent?: string,
  taskId?: string,
  root?: string,
): GateConfirmResult {
  const store = loadGateStore(root);
  const session = sessionId ? store.sessions[sessionId] : undefined;

  if (!session) {
    return {
      status: 'rejected',
      reason: `session not found: ${sessionId || '(missing)'}. Must call compliance_gate_check first.`,
    };
  }

  if (session.gate_status === 'armed') {
    return { status: 'rejected', reason: `session ${sessionId} is already armed. Cannot re-arm.` };
  }

  if (session.gate_status !== 'checked') {
    return {
      status: 'rejected',
      reason: `session ${sessionId} is not in "checked" state (current: ${session.gate_status}). Must call compliance_gate_check first.`,
    };
  }

  if (!planSummary || planSummary.trim().length < 10) {
    return { status: 'rejected', reason: 'plan_summary must be at least 10 characters' };
  }

  const mode = getEnforcementMode(root);
  if (session.last_check_passed === false && mode !== 'advisory') {
    return {
      status: 'rejected',
      reason: `Gate check failed — resolve HIGH severity violations before arming. Session ${sessionId} has ${session.last_check_failed_items?.length || 0} check failures in ${mode} enforcement mode.`,
    };
  }

  session.gate_status = 'armed';
  session.plan_summary = planSummary.trim();
  session.confirmed_at = new Date().toISOString();
  session.last_check_failed_items = [];
  session.task_id = taskId || session.task_id || null;
  session.agent = agent || session.agent || 'unknown';
  session.worktree = process.cwd();
  session.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Clean active_sessions
  store.active_sessions = store.active_sessions.filter((sid) => {
    const s = store.sessions[sid];
    return s && s.gate_status === 'armed' && !s.consumed_at;
  });

  if (!store.active_sessions.includes(sessionId)) {
    store.active_sessions.push(sessionId);
  }

  store.last_updated = new Date().toISOString();
  saveGateStore(store, root);

  return {
    status: 'armed',
    session_id: sessionId,
    confirmed_at: session.confirmed_at,
    expires_at: session.expires_at,
    plan_summary: planSummary.trim().substring(0, 200),
  };
}

/**
 * Complete a session and produce audit record.
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
      status: 'rejected',
      reason: `session not found: ${sessionId || '(missing)'}. Must call compliance_gate_check and compliance_gate_confirm first.`,
    };
  }

  if (session.gate_status !== 'armed') {
    return {
      status: 'rejected',
      reason: `session ${sessionId} is not armed (status: ${session.gate_status}). Must call compliance_gate_confirm first.`,
    };
  }

  if (session.consumed_at) {
    return {
      status: 'rejected',
      reason: `session ${sessionId} already completed at ${session.consumed_at}. Cannot re-complete.`,
    };
  }

  const mode = getEnforcementMode(root);

  // ESLint dirty_modules check
  const machinePath = getMachinePath(root);
  let eslintFailed = false;
  let dirtyModules: string[] = [];

  try {
    if (fs.existsSync(machinePath)) {
      const machine = JSON.parse(fs.readFileSync(machinePath, 'utf8'));
      if (machine.eslint_state?.aggregate?.dirty_modules?.length > 0) {
        dirtyModules = machine.eslint_state.aggregate.dirty_modules;
        eslintFailed = true;
      }
    }
  } catch {
    // Non-blocking
  }

  if (eslintFailed && mode !== 'advisory') {
    const now = new Date().toISOString();
    session.gate_status = 'failed';
    session.consumed_at = now;
    session.fail_reason = 'ESLint mock-audit violations found in modules: ' + dirtyModules.join(', ');
    store.active_sessions = store.active_sessions.filter((sid) => sid !== sessionId);
    store.last_updated = new Date().toISOString();
    saveGateStore(store, root);
    return {
      status: 'failed',
      reason: 'CAT3.7: ESLint mock-audit violations in modules: ' + dirtyModules.join(', '),
      dirty_modules: dirtyModules,
    };
  }

  // Task artifact validation
  const missing = validateTaskArtifacts(session.task_id || null, root);
  if (missing.length > 0 && mode !== 'advisory') {
    const now = new Date().toISOString();
    session.gate_status = 'failed';
    session.consumed_at = now;
    session.fail_reason = 'Missing required task artifacts: ' + missing.join(', ');
    session.missing_artifacts = missing;
    store.active_sessions = store.active_sessions.filter((sid) => sid !== sessionId);
    store.last_updated = new Date().toISOString();
    saveGateStore(store, root);
    return {
      status: 'failed',
      reason: 'Missing required task artifacts: ' + missing.join(', '),
      missing_artifacts: missing,
    };
  }

  // Success
  const now = new Date().toISOString();
  session.gate_status = 'completed';
  session.consumed_at = now;
  session.audit = {
    execution_summary: (executionSummary || '').substring(0, 1000),
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
    execution_summary: (executionSummary || '').substring(0, 200),
    gate_status: 'completed',
  });

  // Keep only last 500 audit entries
  if (store.audit_history.length > 500) {
    store.audit_history = store.audit_history.slice(-500);
  }

  store.active_sessions = store.active_sessions.filter((sid) => sid !== sessionId);
  store.last_updated = now;
  saveGateStore(store, root);

  return {
    status: 'completed',
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

// ════════════════════════════════════════════════════════════
// STALE SESSION MANAGEMENT
// ════════════════════════════════════════════════════════════

/**
 * Drain stale sessions with configurable thresholds.
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
} {
  const gateFile = getGateStatePath(root);
  const store = loadGateStore(root);
  const drainedFile = getDrainedStorePath(gateFile);
  const drainedStore = readJsonFile<DrainedStore>(drainedFile) || {
    formatVersion: '2.0',
    drained_sessions: {},
    last_drained: null,
  };

  const nowTs = Date.now();
  let purged = 0;
  let drainedArmed = 0;
  let drainedChecked = 0;
  const drainedIds: string[] = [];

  for (const sid of Object.keys(store.sessions)) {
    const ses = store.sessions[sid];
    if (!ses) continue;

    let shouldDrain = false;
    let reason = '';
    let drainType = '';

    if (ses.gate_status === 'armed' && !ses.consumed_at && ses.confirmed_at) {
      const age = nowTs - new Date(ses.confirmed_at).getTime();
      if (age > armedHours * 3600000) {
        shouldDrain = true;
        drainType = 'STALE_ARMED';
        reason = `armed for ${Math.floor(age / 3600000)}h without completion (threshold: ${armedHours}h)`;
      }
    }

    if (ses.gate_status === 'checked' && !ses.confirmed_at) {
      const age = nowTs - new Date(ses.created_at).getTime();
      if (age > checkedHours * 3600000) {
        shouldDrain = true;
        drainType = 'STALE_CHECKED';
        reason = `checked for ${Math.floor(age / 3600000)}h without confirmation (threshold: ${checkedHours}h)`;
      }
    }

    if (shouldDrain) {
      drainedStore.drained_sessions[sid] = {
        ...ses,
        drained_at: new Date().toISOString(),
        drain_reason: reason,
        drain_type: drainType,
      };
      delete store.sessions[sid];
      store.active_sessions = store.active_sessions.filter((a) => a !== sid);
      purged++;
      drainedIds.push(sid);
      if (drainType === 'STALE_ARMED') drainedArmed++;
      if (drainType === 'STALE_CHECKED') drainedChecked++;
    }
  }

  if (purged > 0) {
    drainedStore.last_drained = new Date().toISOString();
    drainedStore.total_drained = Object.keys(drainedStore.drained_sessions).length;
    writeJsonFile(drainedFile, drainedStore);
    store.last_updated = new Date().toISOString();
    saveGateStore(store, root);
  }

  return {
    purged,
    drained_sessions: drainedIds,
    drained_armed: drainedArmed,
    drained_checked: drainedChecked,
    remaining_active: store.active_sessions.length,
    remaining_total: Object.keys(store.sessions).length,
  };
}

// ════════════════════════════════════════════════════════════
// TASK ARTIFACT VALIDATION
// ════════════════════════════════════════════════════════════

/**
 * Validate that HANDOVER.md and TASK_LOG.md exist for a given task.
 */
export function validateTaskArtifacts(
  taskId: string | null,
  root?: string,
): string[] {
  if (!taskId) return [];
  const projectRoot = root || getProjectRoot();
  const taskDir = path.join(projectRoot, '.task_temp', taskId);
  const missing: string[] = [];
  if (!fileExists(path.join(taskDir, 'HANDOVER.md'))) missing.push('HANDOVER.md');
  if (!fileExists(path.join(taskDir, 'TASK_LOG.md'))) missing.push('TASK_LOG.md');
  return missing;
}

// ════════════════════════════════════════════════════════════
// COMPLIANCE VERIFICATION HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Compute a digest (sha256-prefixed) from a file path,
 * compatible with the keystone hash convention.
 */
export function computeDigest(filePath: string): { digest: string | null; error: string | null } {
  try {
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return { digest: 'sha256-' + hash, error: null };
  } catch (err: unknown) {
    return { digest: null, error: (err as Error).message };
  }
}

/**
 * Extract semantic version from file content.
 */
export function extractSemver(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Pattern 1: YAML frontmatter `version: "1.2.3"`
    const fmMatch = content.match(/^version:\s*"?(\d+\.\d+\.\d+)"?/m);
    if (fmMatch) return fmMatch[1];
    // Pattern 2: Markdown header `## Version 1.2.3`
    const hdrMatch = content.match(/^#{1,3}\s+(?:Version|v)\s*(\d+\.\d+\.\d+)/im);
    if (hdrMatch) return hdrMatch[1];
    // Pattern 3: Inline `v1.2.3`
    const inlineMatch = content.match(/v(\d+\.\d+\.\d+)/);
    if (inlineMatch) return inlineMatch[1];
  } catch {
    // ignore
  }
  return null;
}
