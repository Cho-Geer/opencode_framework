// service/gate/enforcement.ts — Enforcement mode resolution + framework paths
// Source: gate-core.ts (enforcement mode, framework paths, DAG validation, error class)

import * as fs from "node:fs";
import * as path from "node:path";
import {
  getProjectRoot,
  resolveStateDir,
  readJsonFile,
  fileExists,
  type EnforcementMode,
  type EnforcementModeWithSource,
  type FrameworkPaths,
  type DagExistsResult,
  type TaskInDagResult,
  type DagProgressResult,
} from "./store";

const VALID_MODES: ReadonlySet<string> = new Set([
  "advisory",
  "strict",
  "locked",
]);

const STRICTNESS_ORDER: Readonly<Record<EnforcementMode, number>> = {
  advisory: 0,
  strict: 1,
  locked: 2,
};

// ════════════════════════════════════════════════
// ENFORCEMENT MODE
// ════════════════════════════════════════════════

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

export function getEnforcementMode(root?: string): EnforcementMode {
  const envMode = process.env.ENFORCEMENT_MODE;
  const projectRoot = root || getProjectRoot();

  const cfgPath = path.join(projectRoot, ".opencode", "project.config.json");
  let configMode: EnforcementMode = "advisory";

  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      const tr = cfg.template_resolution;
      const mode = tr?.develop_enforcement_mode || tr?.runtime_enforcement_mode;
      if (mode && VALID_MODES.has(mode)) {
        configMode = mode;
      }
    }
  } catch {
    // use default
  }

  if (isEnforcementDebugEnabled(projectRoot)) {
    try {
      // Diagnostic logging available when DEBUG contains "enforcement"/"gate-core"
    } catch (_diagErr) {
      // Diagnostic failure is non-blocking
    }
  }

  if (envMode && VALID_MODES.has(envMode)) {
    if (configMode === "locked") return "locked";
    return envMode as EnforcementMode;
  }

  return configMode;
}

export function getEnforcementModeWithSource(
  root?: string,
): EnforcementModeWithSource {
  const envModeRaw = process.env.ENFORCEMENT_MODE;
  const projectRoot = root || getProjectRoot();

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

  const envMode: EnforcementMode | null =
    envModeRaw && VALID_MODES.has(envModeRaw)
      ? (envModeRaw as EnforcementMode)
      : null;

  let finalMode = configMode;
  let downgraded = false;
  let downgradeReason: string | null = null;

  if (envMode) {
    if (configMode === "locked") {
      finalMode = "locked";
    } else {
      finalMode = envMode;
    }
  }

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

// ════════════════════════════════════════════════
// FRAMEWORK PATHS
// ════════════════════════════════════════════════

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

// ════════════════════════════════════════════════
// DAG VALIDATION (deprecated — kept for backward compat)
// ════════════════════════════════════════════════

/** @deprecated Use findTaskInDag() from checks.ts */
export function checkDagExists(
  dagPath?: string,
  verbose?: boolean,
): DagExistsResult {
  const fp = dagPath ? { dag: dagPath } : resolveFrameworkPaths();
  const dag = readJsonFile<{ tasks?: unknown[] }>(
    fp.dag || (fp as FrameworkPaths).dag,
  );
  if (!dag || !Array.isArray(dag.tasks)) {
    return {
      found: fileExists(fp.dag || (fp as FrameworkPaths).dag),
      taskCount: 0,
    };
  }
  return { found: true, taskCount: dag.tasks.length };
}

/** @deprecated Use findTaskInDag() from checks.ts */
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

/** @deprecated No live replacement — progress reporting in doctor/scan tools */
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

// ════════════════════════════════════════════════
// ERROR CLASS
// ════════════════════════════════════════════════

export class FrameworkEnforcementError extends Error {
  check: string;
  severity: "HIGH" | "WARNING" | "INFO";
  agent: string;
  taskId: string;
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
