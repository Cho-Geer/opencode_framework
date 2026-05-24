/**
 * framework-enforcer.ts — OpenCode Framework Enforcer Plugin
 *
 * Hooks into the OpenCode runtime to enforce framework governance rules:
 *  - tool.execute.before: Pre-validates DAG coverage, gate state, enforcement mode,
 *    and agent write scopes BEFORE any tool execution. Fail-closed in strict/locked mode.
 *  - shell.env: Injects enforcement context (mode, task ID, session ID, root path)
 *    into every shell command's environment.
 *
 * Reads framework state from files (NOT a second state model):
 *  - Task.DAG.json        — task status
 *  - .opencode/state/gate-state.json — armed sessions
 *  - .opencode/state/machine.json    — enforcement mode (via project.config.json)
 *  - .opencode/project.config.json   — enforcement_config, agent_write_scopes
 *
 * Modes:
 *  - advisory:  Log warnings but allow execution
 *  - strict:    Block on DAG/gate/scope violations
 *  - locked:    Block on all violations; no waivers accepted
 *
 * @author  @Architect
 * @version 1.0.0
 * @phase   FW-SAFE-P3
 */

import type { Plugin, HookContext, PluginError } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskDAG {
  version: string;
  project: string;
  tasks: Array<{
    id: string;
    title: string;
    status: string; // "pending" | "in_progress" | "completed" | "blocked"
    owner: string;
    priority: string;
    dependencies: string[];
  }>;
  meta?: {
    total_tasks: number;
    completed: number;
    pending: number;
    in_progress: number;
  };
}

interface GateState {
  formatVersion: string;
  active_sessions: string[];
  sessions: Record<
    string,
    {
      session_id: string;
      gate_status: string; // "checked" | "armed" | "completed" | "failed"
      enforcement_mode?: string;
      confirmed_at?: string | null;
      consumed_at?: string | null;
      task_description?: string;
    }
  >;
}

interface EnforcementConfig {
  enforcement_mode: "advisory" | "strict" | "locked";
  enforcement_config?: {
    advisory?: { block_on: string[]; log_level: string };
    strict?: { block_on: string[]; log_level: string };
    locked?: { block_on: string[]; log_level: string };
  };
}

interface AgentWriteScope {
  allowed: string[];
  denied: string[];
}

interface ProjectConfig {
  template_resolution?: EnforcementConfig;
  agent_write_scopes?: Record<string, AgentWriteScope>;
}

interface ToolContext extends HookContext {
  tool: string;
  args: Record<string, unknown>;
  agent?: string;
  task_id?: string;
}

interface ShellEnvContext extends HookContext {
  env: NodeJS.ProcessEnv;
}

// ---------------------------------------------------------------------------
// File paths (resolved relative to OPENCODE_ROOT)
// ---------------------------------------------------------------------------

function getOpenCodeRoot(): string {
  return process.env.OPENCODE_ROOT || process.cwd();
}

function resolveStatePath(relativePath: string): string {
  return path.resolve(getOpenCodeRoot(), relativePath);
}

const STATE_PATHS = {
  dag: () => resolveStatePath("Task.DAG.json"),
  gateState: () => resolveStatePath(".opencode/state/gate-state.json"),
  machine: () => resolveStatePath(".opencode/state/machine.json"),
  projectConfig: () => resolveStatePath(".opencode/project.config.json"),
};

// ---------------------------------------------------------------------------
// State readers (read-only; never create a second state model)
// ---------------------------------------------------------------------------

function readJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getEnforcementMode(): "advisory" | "strict" | "locked" {
  // 1. Check environment variable override
  const envMode = process.env.ENFORCEMENT_MODE || process.env.FRAMEWORK_MODE;
  if (envMode && ["advisory", "strict", "locked"].includes(envMode)) {
    return envMode as "advisory" | "strict" | "locked";
  }

  // 2. Read from project.config.json
  const config = readJsonFile<ProjectConfig>(STATE_PATHS.projectConfig());
  const mode = config?.template_resolution?.enforcement_mode;
  if (mode && ["advisory", "strict", "locked"].includes(mode)) {
    return mode as "advisory" | "strict" | "locked";
  }

  // 3. Default fallback: strict
  return "strict";
}

function findTaskInDag(taskId: string): { found: boolean; status: string } {
  const dag = readJsonFile<TaskDAG>(STATE_PATHS.dag());
  if (!dag || !Array.isArray(dag.tasks)) {
    return { found: false, status: "unknown" };
  }
  const task = dag.tasks.find((t) => t.id === taskId);
  return task
    ? { found: true, status: task.status }
    : { found: false, status: "unknown" };
}

function findArmedSession(taskId?: string): { found: boolean; sessionId: string | null } {
  const gate = readJsonFile<GateState>(STATE_PATHS.gateState());
  if (!gate || !gate.sessions) {
    return { found: false, sessionId: null };
  }

  // Look for armed sessions (gate_status === "armed")
  const sessions = Object.values(gate.sessions);
  const armedSession = sessions.find(
    (s) => s.gate_status === "armed" && s.consumed_at === null
  );

  if (armedSession) {
    return { found: true, sessionId: armedSession.session_id };
  }

  return { found: false, sessionId: null };
}

function isWriteAllowed(agentType: string, filePath: string): boolean {
  const config = readJsonFile<ProjectConfig>(STATE_PATHS.projectConfig());
  const scopes = config?.agent_write_scopes?.[agentType];
  if (!scopes) {
    // No scopes defined for this agent → allow (conservative in plugin;
    // actual enforcement happens in code-quality-gate)
    return true;
  }

  // Check denied patterns first (explicit deny wins)
  for (const pattern of scopes.denied) {
    if (matchGlob(filePath, pattern)) {
      return false;
    }
  }

  // Check allowed patterns
  for (const pattern of scopes.allowed) {
    if (matchGlob(filePath, pattern)) {
      return true;
    }
  }

  // No matching allow pattern → deny
  return false;
}

/**
 * Simple glob matching for agent_write_scopes patterns.
 * Supports **, *, and literal paths.
 */
function matchGlob(filePath: string, pattern: string): boolean {
  // Normalize separators
  const normalized = filePath.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");

  // Convert glob pattern to regex
  const regexStr = pat
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*");
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalized);
}

// ---------------------------------------------------------------------------
// Hook: tool.execute.before
// ---------------------------------------------------------------------------

async function toolExecuteBefore(context: ToolContext): Promise<void | PluginError> {
  const mode = getEnforcementMode();
  const taskId = context.task_id || (context.args?.task_id as string) || "";
  const agent = context.agent || "";
  const tool = context.tool;

  const violations: string[] = [];

  // ---- Check 1: DAG Coverage ----
  if (taskId) {
    const dagResult = findTaskInDag(taskId);
    if (!dagResult.found) {
      const msg = `[FW-ENFORCE] Task "${taskId}" not found in Task.DAG.json`;
      violations.push(msg);
    } else if (dagResult.status !== "pending" && dagResult.status !== "in_progress") {
      const msg = `[FW-ENFORCE] Task "${taskId}" has status "${dagResult.status}" (expected pending/in_progress)`;
      violations.push(msg);
    }
  }

  // ---- Check 2: Gate Armed Session ----
  const gateResult = findArmedSession(taskId);
  if (!gateResult.found && mode !== "advisory") {
    const msg = `[FW-ENFORCE] No armed compliance gate session found (mode: ${mode})`;
    violations.push(msg);
  }

  // ---- Check 3: Agent Write Scope (for write-like tools) ----
  if (tool === "write" || tool === "edit" || tool === "bash") {
    const filePath = (context.args?.filePath as string) || (context.args?.path as string) || "";
    if (filePath && agent) {
      if (!isWriteAllowed(agent, filePath)) {
        // Only block write scope violations in strict/locked mode
        if (mode === "strict" || mode === "locked") {
          const msg = `[FW-ENFORCE] Agent "${agent}" write to "${filePath}" blocked by agent_write_scopes (mode: ${mode})`;
          violations.push(msg);
        }
      }
    }
  }

  // ---- Enforcement decision ----
  if (violations.length > 0) {
    if (mode === "advisory") {
      console.warn(`[FW-ENFORCE][WARN][${mode}] ${violations.join("; ")}`);
      return; // Allow execution with warning
    }

    // Block in strict and locked modes
    const error: PluginError = {
      name: "FrameworkEnforcerError",
      message: `Framework enforcement blocked tool "${tool}": ${violations.join("; ")}`,
      details: {
        task_id: taskId,
        agent,
        tool,
        mode,
        violations,
        block_on: mode === "locked"
          ? ["gate_armed", "keystone_hash", "keystone_integrity", "tdd_order", "dag_gate", "eslint_audit", "role_scope", "workspace_root", "gate_state_sync", "write_audit_integrity"]
          : ["gate_armed", "keystone_hash", "tdd_order", "dag_gate", "eslint_audit", "role_scope"],
      },
    };
    return error;
  }

  // All checks passed — allow execution
  return;
}

// ---------------------------------------------------------------------------
// Hook: shell.env
// ---------------------------------------------------------------------------

async function shellEnv(context: ShellEnvContext): Promise<void> {
  const root = getOpenCodeRoot();
  const mode = getEnforcementMode();

  // Find current task ID (from context or env)
  const taskId = context.task_id || process.env.FRAMEWORK_TASK_ID || "";

  // Find armed session ID
  const gateResult = findArmedSession(taskId);

  // Inject framework environment variables (additive, not destructive)
  if (!context.env.OPENCODE_ROOT) {
    context.env.OPENCODE_ROOT = root;
  }
  if (!context.env.OPENCODE_WORKTREE) {
    context.env.OPENCODE_WORKTREE = root;
  }
  if (taskId && !context.env.FRAMEWORK_TASK_ID) {
    context.env.FRAMEWORK_TASK_ID = taskId;
  }
  if (gateResult.sessionId && !context.env.FRAMEWORK_SESSION_ID) {
    context.env.FRAMEWORK_SESSION_ID = gateResult.sessionId;
  }
  if (!context.env.FRAMEWORK_MODE) {
    context.env.FRAMEWORK_MODE = mode;
  }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

const plugin: Plugin = {
  name: "framework-enforcer",
  version: "1.0.0",
  description:
    "OpenCode Framework Enforcer — enforces DAG/gate/compliance at runtime via tool.execute.before and shell.env hooks",
  hooks: {
    "tool.execute.before": toolExecuteBefore,
    "shell.env": shellEnv,
  },
};

export default plugin;
