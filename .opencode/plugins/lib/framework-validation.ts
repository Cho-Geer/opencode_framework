/**
 * framework-validation.ts — Shared Framework Validation Module
 * =================================================================
 *
 * Pure utility functions for framework state validation, eliminating
 * code duplication across the framework harness:
 *   - framework-enforcer.ts (plugin hooks)
 *   - framework-compliance-check.js, state-integrity-scan.js (CLI scripts)
 *   - gate-lifecycle-audit.js, pre-execution-gate.js (dispatch gate)
 *   - framework-doctor.js (health check)
 *   - state-reconciliation.js (state repair)
 *   - framework-self-test.js (binding force test)
 *
 * All functions are PURE — no console.log, no process.exit, no
 * side effects during import. Structured return objects only.
 * Never throws except for FrameworkEnforcementError.
 *
 * @author  @Architect
 * @version 1.0.0
 * @phase   FW-HARNESS-SHARED-MODULE
 * @since   2026-05-25
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ============================================================================
// A. File Operations
// ============================================================================

/**
 * Safely read and parse a JSON file. Returns the parsed object or null on any
 * failure (file missing, unreadable, invalid JSON).
 */
export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Check whether a file exists at the given path.
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
 * Returns the hex string (no prefix) or null on failure.
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

// ============================================================================
// B. Path Resolution
// ============================================================================

/**
 * Canonical framework file paths, all resolved to absolute paths.
 */
export interface FrameworkPaths {
  /** Project root directory */
  root: string;
  /** Path to Task.DAG.json */
  dag: string;
  /** Path to .opencode/state/gate-state.json */
  gateState: string;
  /** Path to .opencode/state/machine.json */
  machine: string;
  /** Path to .opencode/project.config.json */
  projectConfig: string;
  /** Path to .opencode/state/rule_registry.json */
  ruleRegistry: string;
  /** Fallback rule registry at .opencode/rule_registry.json */
  ruleRegistryFallback: string;
  /** Path to .opencode/plugins/ directory */
  pluginsDir: string;
  /** Path to .opencode/hooks/ directory */
  hooksDir: string;
  /** Path to .opencode/state/ directory */
  stateDir: string;
  /** Path to .opencode/scripts/ directory */
  scriptsDir: string;
  /** Path to .opencode/agents/ directory */
  agentsDir: string;
  /** Path to .opencode/rules/ directory */
  rulesDir: string;
}

/**
 * Resolve all framework file paths from a project root.
 * If no root is provided, derive it from the module's location (__dirname walk-up)
 * or fall back to process.cwd().
 *
 * @param root - Optional explicit project root path
 * @returns FrameworkPaths with all paths resolved as absolute paths
 */
export function resolveFrameworkPaths(root?: string): FrameworkPaths {
  const resolvedRoot = root
    ? path.resolve(root)
    : deriveOpenCodeRoot();

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

/**
 * Derive the OpenCode project root by walking up from known marker directories.
 * This is a pure function — no environment access, no shell.
 * It must be called from a script inside .opencode/ for the walk-up to work.
 */
function deriveOpenCodeRoot(): string {
  // Strategy: check for .opencode/ directory from cwd upward
  let current = path.resolve(process.cwd());
  for (let i = 0; i < 10; i++) {
    const dotOpenCode = path.join(current, ".opencode");
    if (fs.existsSync(dotOpenCode)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break; // reached filesystem root
    }
    current = parent;
  }
  return process.cwd();
}

// ============================================================================
// C. DAG Validations
// ============================================================================

/**
 * Result of checking whether Task.DAG.json exists.
 */
export interface DagExistsResult {
  found: boolean;
  taskCount: number;
}

/**
 * Result of checking a single task in Task.DAG.json.
 */
export interface TaskInDagResult {
  found: boolean;
  status: string;
  owner: string;
}

/**
 * Result of checking DAG progress.
 */
export interface DagProgressResult {
  total: number;
  completed: number;
  pending: number;
  progressPercent: number;
}

/**
 * Internal DAG structure for parsing.
 */
interface TaskDAG {
  tasks?: Array<{
    id: string;
    title?: string;
    status: string;
    owner?: string;
    priority?: string;
    dependencies?: string[];
  }>;
  meta?: {
    total_tasks?: number;
    completed?: number;
    pending?: number;
    in_progress?: number;
  };
}

/**
 * Check if Task.DAG.json exists and count tasks.
 */
export function checkDagExists(paths: FrameworkPaths): DagExistsResult {
  const dag = readJsonFile<TaskDAG>(paths.dag);
  if (!dag || !Array.isArray(dag.tasks)) {
    return { found: fileExists(paths.dag), taskCount: 0 };
  }
  return { found: true, taskCount: dag.tasks.length };
}

/**
 * Check if a specific task exists in Task.DAG.json and return its status.
 */
export function checkTaskInDag(
  taskId: string,
  paths: FrameworkPaths,
): TaskInDagResult {
  const dag = readJsonFile<TaskDAG>(paths.dag);
  if (!dag || !Array.isArray(dag.tasks)) {
    return { found: false, status: "unknown", owner: "" };
  }
  const task = dag.tasks.find((t) => t.id === taskId);
  if (!task) {
    return { found: false, status: "unknown", owner: "" };
  }
  return {
    found: true,
    status: task.status,
    owner: task.owner || "",
  };
}

/**
 * Calculate DAG progress (total, completed, pending, percent).
 */
export function checkDagProgress(paths: FrameworkPaths): DagProgressResult {
  const dag = readJsonFile<TaskDAG>(paths.dag);
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

// ============================================================================
// D. Gate Lifecycle
// ============================================================================

/**
 * Internal gate state structure.
 */
interface GateState {
  formatVersion?: string;
  active_sessions?: string[];
  sessions?: Record<
    string,
    {
      session_id: string;
      gate_status: string;
      enforcement_mode?: string;
      confirmed_at?: string | null;
      consumed_at?: string | null;
      created_at?: string;
      task_description?: string;
      drained_at?: string;
    }
  >;
}

/**
 * Result of armed session lookup.
 */
export interface ArmedSessionResult {
  found: boolean;
  sessionId: string | null;
}

/**
 * Result of stale session scan.
 */
export interface StaleSession {
  id: string;
  age: number; // hours since creation
}

export interface StaleSessionsResult {
  stale: StaleSession[];
  count: number;
}

/**
 * Result of gate integrity check.
 */
export interface GateIntegrityResult {
  valid: boolean;
  issues: string[];
}

/**
 * Check if an armed compliance gate session exists.
 * An "armed" session has confirmed_at set, consumed_at is null, and
 * gate_status is "armed" (not "failed" or "drained").
 */
export function checkArmedSession(
  taskId: string | undefined,
  paths: FrameworkPaths,
): ArmedSessionResult {
  const gate = readJsonFile<GateState>(paths.gateState);
  if (!gate || !gate.sessions) {
    return { found: false, sessionId: null };
  }

  const sessions = Object.values(gate.sessions);
  const armed = sessions.find(
    (s) =>
      s.gate_status === "armed" &&
      s.consumed_at === null,
  );

  return armed
    ? { found: true, sessionId: armed.session_id }
    : { found: false, sessionId: null };
}

/**
 * Scan for stale gate sessions (older than thresholds).
 * Stale = drained sessions > 48h old, or checked sessions > 48h old
 * without confirmation (never confirmed).
 */
export function checkStaleSessions(
  paths: FrameworkPaths,
): StaleSessionsResult {
  const gate = readJsonFile<GateState>(paths.gateState);
  const now = Date.now();
  const stale: StaleSession[] = [];

  if (!gate || !gate.sessions) {
    return { stale, count: 0 };
  }

  const STALE_THRESHOLD_HOURS = 48;
  const STALE_THRESHOLD_MS = STALE_THRESHOLD_HOURS * 60 * 60 * 1000;

  for (const s of Object.values(gate.sessions)) {
    const createdAt = s.created_at ? new Date(s.created_at).getTime() : 0;
    if (!createdAt) continue;

    const ageHours = (now - createdAt) / (60 * 60 * 1000);

    // Drained sessions
    if (s.gate_status === "drained" && ageHours > STALE_THRESHOLD_HOURS) {
      stale.push({ id: s.session_id, age: Math.round(ageHours * 10) / 10 });
      continue;
    }

    // Checked but never confirmed within the threshold
    if (
      s.gate_status === "checked" &&
      !s.confirmed_at &&
      ageHours > STALE_THRESHOLD_HOURS
    ) {
      stale.push({ id: s.session_id, age: Math.round(ageHours * 10) / 10 });
    }
  }

  return { stale, count: stale.length };
}

/**
 * Check gate-state.json structural integrity.
 * Validates: formatVersion presence, sessions object structure, session ID format.
 */
export function checkGateIntegrity(paths: FrameworkPaths): GateIntegrityResult {
  const issues: string[] = [];

  if (!fileExists(paths.gateState)) {
    // Missing gate-state.json is normal for fresh projects — not an integrity failure
    return { valid: true, issues: [] };
  }

  const gate = readJsonFile<GateState>(paths.gateState);
  if (!gate) {
    issues.push("gate-state.json exists but cannot be parsed as JSON");
    return { valid: false, issues };
  }

  if (!gate.formatVersion) {
    issues.push("gate-state.json missing formatVersion field");
  }

  if (!gate.sessions || typeof gate.sessions !== "object") {
    issues.push("gate-state.json missing 'sessions' object");
  } else {
    const sessions = Object.values(gate.sessions);
    if (sessions.length === 0 && (gate.active_sessions || []).length > 0) {
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

// ============================================================================
// E. Machine State
// ============================================================================

/**
 * Internal machine.json structure.
 */
interface MachineState {
  meta?: { version?: string; project?: string; lastUpdated?: string };
  eslint_state?: {
    aggregate?: { dirty_modules?: string[]; total_violations?: number };
    modules?: Record<string, { status: string; violations?: unknown[] }>;
  };
  type_check_state?: { status?: string; dirty_files?: string[]; incremental_errors?: number };
  dependency_state?: { status?: string; violations?: unknown[] };
  format_state?: { status?: string; unformatted_files?: string[] };
  write_audit_state?: {
    current_session?: { files_written?: string[]; violations_found?: number };
  };
  compliance_records?: {
    role_violations?: Array<{ status?: string }>;
  };
}

/**
 * Result of machine.json cleanliness check.
 */
export interface MachineCleanlinessResult {
  clean: boolean;
  dirty: string[];
}

/**
 * Check if machine.json sub-states are clean (no violations, no dirty modules).
 */
export function checkMachineCleanliness(
  paths: FrameworkPaths,
): MachineCleanlinessResult {
  const dirty: string[] = [];
  const machine = readJsonFile<MachineState>(paths.machine);

  if (!machine) {
    // Missing machine.json is clean by definition (no state to check)
    return { clean: true, dirty: [] };
  }

  // Check ESLint state
  const eslintAgg = machine.eslint_state?.aggregate;
  if (eslintAgg?.dirty_modules && eslintAgg.dirty_modules.length > 0) {
    dirty.push(
      `eslint_state: ${eslintAgg.dirty_modules.length} dirty module(s) — ${eslintAgg.dirty_modules.join(", ")}`,
    );
  }

  // Check type check state
  if (
    machine.type_check_state?.status &&
    machine.type_check_state.status !== "clean"
  ) {
    const dirtyFiles = machine.type_check_state.dirty_files || [];
    dirty.push(
      `type_check_state: status=${machine.type_check_state.status}, ${dirtyFiles.length} dirty file(s)`,
    );
  }

  // Check dependency state
  if (
    machine.dependency_state?.status &&
    machine.dependency_state.status !== "clean"
  ) {
    dirty.push(
      `dependency_state: status=${machine.dependency_state.status}, ${(machine.dependency_state.violations || []).length} violation(s)`,
    );
  }

  // Check format state
  if (
    machine.format_state?.status &&
    machine.format_state.status !== "clean"
  ) {
    const unformatted = machine.format_state.unformatted_files || [];
    dirty.push(
      `format_state: status=${machine.format_state.status}, ${unformatted.length} unformatted file(s)`,
    );
  }

  return { clean: dirty.length === 0, dirty };
}

/**
 * Rule registry entry structure.
 */
interface RuleRegistryEntry {
  path: string;
  category: string;
  semver: string;
  sha256: string;
  last_modified?: string;
  description?: string;
  critical?: boolean;
}

interface RuleRegistry {
  entries?: Record<string, RuleRegistryEntry>;
  integrity?: {
    verified_count?: number;
    mismatch_count?: number;
    status?: string;
  };
}

/**
 * Individual registry mismatch record.
 */
export interface RegistryMismatch {
  file: string;
  severity: string; // "HIGH" | "WARNING" | "INFO"
}

/**
 * Result of rule registry integrity check.
 */
export interface RuleRegistryIntegrityResult {
  valid: boolean;
  mismatches: RegistryMismatch[];
}

/**
 * Check rule_registry.json integrity by comparing stored digests with
 * actual file digests. HIGH severity = digest changed but version unchanged.
 * WARNING = version bumped (intentional). INFO = unregistered file.
 */
export function checkRuleRegistryIntegrity(
  paths: FrameworkPaths,
): RuleRegistryIntegrityResult {
  const mismatches: RegistryMismatch[] = [];

  // Resolve registry path (primary + fallback)
  let registryPath = paths.ruleRegistry;
  if (!fileExists(registryPath)) {
    if (fileExists(paths.ruleRegistryFallback)) {
      registryPath = paths.ruleRegistryFallback;
    } else {
      // No registry exists — valid by definition
      return { valid: true, mismatches: [] };
    }
  }

  const rr = readJsonFile<RuleRegistry>(registryPath);
  if (!rr || !rr.entries) {
    mismatches.push({
      file: "rule_registry.json",
      severity: "HIGH",
    });
    return { valid: false, mismatches };
  }

  const entries = rr.entries;
  const onDiskRegistry = readJsonFile<RuleRegistry>(registryPath);

  for (const [key, entry] of Object.entries(entries)) {
    const filePath = path.join(paths.root, entry.path);
    const storedHash = entry.sha256 || "";

    if (!fileExists(filePath)) {
      mismatches.push({
        file: entry.path,
        severity: "HIGH",
      });
      continue;
    }

    const actualHash = computeSHA256(filePath);
    if (!actualHash) {
      mismatches.push({ file: entry.path, severity: "HIGH" });
      continue;
    }

    if (actualHash !== storedHash) {
      // Try to detect version change
      let versionBumped = false;
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const ymMatch = content.match(
          /^version:\s*"?(\d+\.\d+\.\d+)"?/m,
        );
        if (ymMatch && ymMatch[1] !== entry.semver) {
          versionBumped = true;
        }
      } catch {
        // Can't read — treat as HIGH
      }

      mismatches.push({
        file: entry.path,
        severity: versionBumped ? "WARNING" : "HIGH",
      });
    }
  }

  return {
    valid: mismatches.filter((m) => m.severity === "HIGH").length === 0,
    mismatches,
  };
}

// ============================================================================
// F. Write Scope
// ============================================================================

/**
 * Internal project config structure for write scopes.
 */
interface AgentWriteScopeEntry {
  allowed: string[];
  denied: string[];
}

interface ProjectConfigForScopes {
  agent_write_scopes?: Record<string, AgentWriteScopeEntry>;
  template_resolution?: {
    enforcement_mode?: string;
  };
}

/**
 * Check whether an agent is allowed to write to a given file path.
 * Returns true if write is permitted, false otherwise.
 */
export function isAgentAllowedToWrite(
  agent: string,
  filePath: string,
  paths: FrameworkPaths,
): boolean {
  const config = readJsonFile<ProjectConfigForScopes>(paths.projectConfig);
  const scopes = config?.agent_write_scopes?.[agent];
  if (!scopes) {
    // No scope defined for this agent — allow all
    return true;
  }

  // Check denied patterns first (explicit deny always wins)
  for (const pattern of scopes.denied) {
    if (pathMatchesGlob(filePath, pattern)) {
      return false;
    }
  }

  // Check allowed patterns
  for (const pattern of scopes.allowed) {
    if (pathMatchesGlob(filePath, pattern)) {
      return true;
    }
  }

  // No matching allow pattern — deny
  return false;
}

/**
 * Simple glob matching for agent_write_scopes patterns.
 * Supports ** (recursive), * (single-segment wildcard), and literal paths.
 * Handles both forward and backslash separators on all platforms.
 */
export function pathMatchesGlob(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");

  const regexStr = pat
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*");
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalized);
}

// ============================================================================
// G. Enforcement Mode
// ============================================================================

export type EnforcementMode = "advisory" | "strict" | "locked";

const VALID_MODES: ReadonlySet<string> = new Set([
  "advisory",
  "strict",
  "locked",
]);

/**
 * Determine the current enforcement mode.
 * Priority: ENFORCEMENT_MODE env var > project.config.json > default "strict".
 */
export function getEnforcementMode(
  paths: FrameworkPaths,
): EnforcementMode {
  // 1. Environment variable override (highest priority)
  //    Read from process.env only when called (pure otherwise)
  if (typeof process !== "undefined" && process.env) {
    const envMode =
      process.env.ENFORCEMENT_MODE || process.env.FRAMEWORK_MODE || "";
    if (VALID_MODES.has(envMode)) {
      return envMode as EnforcementMode;
    }
  }

  // 2. Read from project.config.json
  const config = readJsonFile<ProjectConfigForScopes>(paths.projectConfig);
  const mode = config?.template_resolution?.enforcement_mode;
  if (mode && VALID_MODES.has(mode)) {
    return mode as EnforcementMode;
  }

  // 3. Default fallback: strict
  return "strict";
}

// ============================================================================
// H. Error Class
// ============================================================================

/**
 * FrameworkEnforcementError — structured error for enforcement violations.
 * Carries check name, severity, agent identity, task ID, and enforcement mode
 * for rich error handling upstream.
 */
export class FrameworkEnforcementError extends Error {
  /** Which check failed (e.g., "DAG Coverage", "Gate Lifecycle") */
  public readonly check: string;

  /** Severity level: "HIGH", "WARNING", or "INFO" */
  public readonly severity: string;

  /** Agent type that triggered the violation (e.g., "@Coder-BE") */
  public readonly agent: string;

  /** Task ID associated with the violation (empty string if N/A) */
  public readonly taskId: string;

  /** Enforcement mode at the time of the violation */
  public readonly mode: EnforcementMode;

  constructor(
    check: string,
    message: string,
    severity: string,
    agent: string = "",
    taskId: string = "",
    mode: EnforcementMode = "strict",
  ) {
    super(message);
    this.name = "FrameworkEnforcementError";
    this.check = check;
    this.severity = severity;
    this.agent = agent;
    this.taskId = taskId;
    this.mode = mode;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, FrameworkEnforcementError.prototype);
  }

  /**
   * Serialise the error to a JSON-friendly object.
   */
  toJSON(): Record<string, string> {
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
