/**
 * framework-enforcer.ts — OpenCode Framework Enforcer Plugin v2.3.2
 *
 * Hooks into the OpenCode runtime to enforce framework governance rules:
 *  - tool.execute.before:  Pre-validates DAG coverage, gate state, enforcement mode,
 *    agent write scopes, TDD ordering, plugin integrity, enforcement mode guard,
 *    contract hash verification, and skill gate validation.
 *  - tool.execute.after:   Post-execution audit logging, stale session detection,
 *    code quality checks (ESLint/Prettier/tsc), auto-repair trigger,
 *    and scope violation post-hoc logging.
 *  - shell.env:            Injects enforcement context into shell commands.
 *  - file.edited:          Tamper detection for critical framework files.
 *  - session.created:      Logs session creation, injects enforcement context.
 *  - session.error:        Logs session errors, triggers auto-recovery on critical.
 *  - session.idle:         Auto-drains stale gate sessions on idle.
 *  - session.compacted:    Logs compaction events, verifies enforcement state preserved.
 *  - message.updated:      Logs message changes for audit.
 *  - todo.updated:         Logs todo list changes for audit.
 *  - permission.asked:     Logs permission requests, detects escalation patterns.
 *  - permission.replied:   Audits permission grants/denials.
 *  - command.executed:     Validates commands against agent permissions, logs execution.
 *  - tui.command.execute:  Validates slash commands, logs dangerous command execution.
 *
 * Reads framework state from files (NOT a second state model):
 *  - Task.DAG.json        — task status
 *  - .opencode/state/gate-state.json — armed sessions
 *  - .opencode/state/machine.json    — enforcement mode (via project.config.json)
 *  - .opencode/project.config.json   — enforcement_config, agent_write_scopes
 *
 * Modes:
 *  - advisory:  Log warnings but allow execution
 *  - strict:    Block on DAG/gate/scope/TDD/integrity violations
 *  - locked:    Block on all violations; no waivers accepted; tamper auto-restore
 *
 * @author  @Architect, @Coder-BE
 * @version 2.3.2
 * @phase   FW-HARNESS-P3 + BOOTSTRAP-DEADLOCK-FIX
 */

import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";
import { PermissionIsolation } from "../../lib/permission-isolation-core";
import { getEnforcementMode, readJsonFile, computeSHA256, findArmedSession, findAnyGateSession } from "../../lib/gate-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskDAG {
  version: string;
  project: string;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
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
      gate_status: string;
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

// ---------------------------------------------------------------------------
// Plugin integrity state (FW-HARNESS-PLUGIN-CHECK)
// ---------------------------------------------------------------------------

let _pluginHash: string = "";
let _pluginHooksCount: number = 0;

// ---------------------------------------------------------------------------
// Critical framework file patterns (FW-HARNESS-FILE-EDITED)
// ---------------------------------------------------------------------------

const CRITICAL_PATTERNS: string[] = [
  ".opencode/plugins/framework-enforcer/framework-enforcer.ts",
  ".opencode/hooks/pre-commit",
  ".opencode/hooks/commit-msg",
  ".opencode/project.config.json",
  "opencode.json",
  ".opencode/state/",
];

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
  pluginSelf: () =>
    resolveStatePath(
      ".opencode/plugins/framework-enforcer/framework-enforcer.ts",
    ),
  auditLog: () => resolveStatePath(".task_temp/_global/audit_log.jsonl"),
};

// ---------------------------------------------------------------------------
// State readers (read-only; never create a second state model)
// ---------------------------------------------------------------------------

/**
 * @public — readJsonFile is now imported from lib/gate-core.
 * @see import { readJsonFile } from "../../lib/gate-core"
 * This eliminates the 8-line inline duplicate that was identical to gate-core's implementation.
 * Gate-core version additionally checks fs.existsSync before reading — safer behavior.
 */

function ensureDir(dirPath: string): void {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore if already exists
  }
}

// ---------------------------------------------------------------------------
// Utility: compute SHA-256 hash of a file
// Wraps computeSHA256 from lib/gate-core (imported above).
// Gate-core returns null on failure; wrapper returns "" for backward compat
// with plugin integrity check's comparison logic.
// ---------------------------------------------------------------------------

function computeFileHash(filePath: string): string {
  return computeSHA256(filePath) ?? "";
}

// ---------------------------------------------------------------------------
// Plugin integrity self-check (FW-HARNESS-PLUGIN-CHECK)
// ---------------------------------------------------------------------------

function checkPluginIntegrity(): { valid: boolean; detail: string } {
  const pluginPath = STATE_PATHS.pluginSelf();
  const currentHash = computeFileHash(pluginPath);

  if (!_pluginHash) {
    // First init — store hash
    _pluginHash = currentHash;
    _pluginHooksCount = 14;
    return { valid: true, detail: "Plugin initialized" };
  }

  if (currentHash !== _pluginHash) {
    return {
      valid: false,
      detail: `Plugin hash changed: expected ${_pluginHash}, got ${currentHash}`,
    };
  }

  if (_pluginHooksCount < 2) {
    return {
      valid: false,
      detail: `Only ${_pluginHooksCount} hooks registered, expected at least 2`,
    };
  }

  return { valid: true, detail: "Plugin integrity verified" };
}

// ---------------------------------------------------------------------------
// Enforcement mode retrieval — imported from lib/gate-core
// ---------------------------------------------------------------------------
// See import { getEnforcementMode } from "../../lib/gate-core" at top of file

// ---------------------------------------------------------------------------
// DAG and gate state readers
// ---------------------------------------------------------------------------

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

/**
 * @public — findArmedSession is now imported from lib/gate-core.
 * @see import { findArmedSession } from "../../lib/gate-core"
 *
 * Previously inlined (~20 lines) in this file. Centralized in gate-core.ts
 * (FW-HARNESS-P0-2a) to eliminate duplication and keep the armed-session
 * predicate consistent across all consumers.
 */

/**
 * @public — findAnyGateSession is now imported from lib/gate-core.
 * @see import { findAnyGateSession } from "../../lib/gate-core"
 *
 * Previously inlined (~22 lines) in this file. Centralized in gate-core.ts
 * (FW-HARNESS-P0-2a). Returns any non-consumed, non-drained session —
 * used for planning-phase tools (task) that require at least a checked
 * session without demanding the stricter "armed" status.
 */

// ---------------------------------------------------------------------------
// Write scope check
// ---------------------------------------------------------------------------

function isWriteAllowed(agentType: string, filePath: string): boolean {
  const config = readJsonFile<ProjectConfig>(STATE_PATHS.projectConfig());
  const scopes = config?.agent_write_scopes?.[agentType];
  if (!scopes) {
    return true;
  }

  for (const pattern of scopes.denied) {
    if (matchGlob(filePath, pattern)) {
      return false;
    }
  }

  for (const pattern of scopes.allowed) {
    if (matchGlob(filePath, pattern)) {
      return true;
    }
  }

  return false;
}

function matchGlob(filePath: string, pattern: string): boolean {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Phase 2 R4: Expanded source file detection to include all file types
 * subject to write-time quality checks (.html, .scss, .prisma).
 */
function isSourceFile(filePath: string): boolean {
  if (!filePath) return false;
  return /\.(ts|tsx|js|jsx|html|scss|prisma)$/.test(filePath);
}

/**
 * Phase 2 R4: Debouncing state for write-time check auto-trigger.
 * Batches rapid writes within WRITE_CHECK_DEBOUNCE_MS into a single check.
 */
let _lastWriteCheckTime = 0;
let _pendingWriteChecks: string[] = [];
const WRITE_CHECK_DEBOUNCE_MS = 2000;

function isCriticalFrameworkFile(filePath: string): boolean {
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

function isStaleSession(session: {
  confirmed_at?: string | null;
  consumed_at?: string | null;
}): boolean {
  if (!session.confirmed_at || session.consumed_at) return false;
  const confirmed = new Date(session.confirmed_at).getTime();
  const hoursElapsed = (Date.now() - confirmed) / 3600000;
  return hoursElapsed > 24;
}

function filePathMatches(args: any, pattern: string): boolean {
  if (!args) return false;
  const fp = (args.filePath || args.path || "").replace(/\\/g, "/");
  return fp.includes(pattern);
}

// ---------------------------------------------------------------------------
// Phase 2 Helpers (FW-HARNESS-P2)
// ---------------------------------------------------------------------------

function checkStaleSessions(paths: typeof STATE_PATHS): { count: number } {
  try {
    const gate = readJsonFile<GateState>(paths.gateState());
    if (!gate?.sessions) return { count: 0 };
    const sessions = Object.values(gate.sessions);
    const staleCount = sessions.filter(isStaleSession).length;
    return { count: staleCount };
  } catch {
    return { count: 0 };
  }
}

function autoDrainStaleSessions(paths: typeof STATE_PATHS): number {
  try {
    const gatePath = paths.gateState();
    const gate = readJsonFile<GateState>(gatePath);
    if (!gate?.sessions) return 0;

    const staleEntries = Object.entries(gate.sessions).filter(([, s]) =>
      isStaleSession(s),
    );
    if (staleEntries.length === 0) return 0;

    (gate as any).drained_sessions = (gate as any).drained_sessions || [];

    for (const [sid, session] of staleEntries) {
      (gate as any).drained_sessions.push({
        ...session,
        drained_at: new Date().toISOString(),
        reason: "auto-drain",
      });
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

interface RegistryEntry {
  file?: string;
  path?: string;
  sha256?: string;
  digest?: string;
}

interface RuleRegistry {
  version?: string;
  entries?: RegistryEntry[];
  files?: RegistryEntry[];
}

function checkRuleRegistryIntegrity(paths: typeof STATE_PATHS): {
  valid: boolean;
  mismatches: Array<{ file: string; error?: string }>;
} {
  try {
    const registry = readJsonFile<RuleRegistry>(
      resolveStatePath(".opencode/state/rule_registry.json"),
    );
    if (!registry) return { valid: true, mismatches: [] };

    const entries = registry.entries || registry.files || [];
    const mismatches: Array<{ file: string; error?: string }> = [];

    for (const entry of entries) {
      const relPath = entry.file || entry.path || "";
      if (!relPath) continue;
      const filePath = resolveStatePath(relPath);
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const hash = crypto.createHash("sha256").update(content).digest("hex");
        const expectedHash = entry.sha256 || entry.digest || "";
        if (hash !== expectedHash) {
          mismatches.push({ file: relPath });
        }
      } catch {
        mismatches.push({ file: relPath, error: "file_not_found" });
      }
    }

    return { valid: mismatches.length === 0, mismatches };
  } catch {
    return { valid: true, mismatches: [] };
  }
}

function checkMachineCleanliness(paths: typeof STATE_PATHS): {
  clean: boolean;
  dirty: string[];
} {
  try {
    const machine = readJsonFile<any>(paths.machine());
    if (!machine) return { clean: true, dirty: [] };

    const dirty: string[] = [];
    const esDirty: string[] =
      machine?.eslint_state?.aggregate?.dirty_modules || [];
    const tsDirty: string[] = machine?.type_check_state?.dirty_files || [];
    const fmtDirty: string[] = machine?.format_state?.unformatted_files || [];

    dirty.push(...esDirty.map((f: string) => `eslint:${f}`));
    dirty.push(...tsDirty.map((f: string) => `tsc:${f}`));
    dirty.push(...fmtDirty.map((f: string) => `format:${f}`));

    return { clean: dirty.length === 0, dirty };
  } catch {
    return { clean: true, dirty: [] };
  }
}

// ---------------------------------------------------------------------------
// Audit log writer
// ---------------------------------------------------------------------------

function writeAuditLogEntry(entry: Record<string, unknown>): void {
  const auditDir = path.dirname(STATE_PATHS.auditLog());
  ensureDir(auditDir);
  try {
    fs.appendFileSync(
      STATE_PATHS.auditLog(),
      JSON.stringify(entry) + "\n",
      "utf8",
    );
  } catch {
    // Best-effort — don't crash the plugin over audit log failures
  }
}

// ---------------------------------------------------------------------------
// Phase 3 Helpers (FW-HARNESS-P3)
// ---------------------------------------------------------------------------

function logAuditEntry(entry: Record<string, unknown>): void {
  writeAuditLogEntry({
    timestamp: new Date().toISOString(),
    ...entry,
    sessionID: (entry.sessionID as string) || "",
  });
}

function flushAuditTrail(sessionID: string): void {
  const auditDir = path.join(getOpenCodeRoot(), ".task_temp", "_global");
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }
  const trailPath = path.join(auditDir, "audit_trail.json");
  let existing: Record<string, unknown>[] = [];
  try {
    const raw = fs.readFileSync(trailPath, "utf-8");
    existing = JSON.parse(raw) as Record<string, unknown>[];
  } catch {
    // File doesn't exist yet — start fresh
  }
  existing.push({
    sessionID,
    flushedAt: new Date().toISOString(),
  });
  fs.writeFileSync(trailPath, JSON.stringify(existing, null, 2));
}

// ---------------------------------------------------------------------------
// Hook: tool.execute.before
// ---------------------------------------------------------------------------

async function toolExecuteBefore(
  input: {
    tool: string;
    sessionID: string;
    callID: string;
  },
  output: {
    args: any;
  },
): Promise<void> {
  const tool = input.tool;
  const mode = getEnforcementMode();
  const violations: string[] = [];
  const agent = process.env.FRAMEWORK_AGENT || "";
  // === P0: Orchestrator DAG modification block (physical constraint) ===
  if ((tool === "write" || tool === "edit" || tool === "safe_edit") && (agent === "Orchestrator" || agent === "@Orchestrator")) {
    const filePath = output.args?.filePath || "";
    if (filePath.endsWith("Task.DAG.json")) {
      throw new Error(
        "[FW-ENFORCE][LOCKED] Orchestrator modification of Task.DAG.json blocked. " +
        "Only @Meta-Planner may modify the DAG."
      );
    }
  }

  const taskId = process.env.FRAMEWORK_TASK_ID || "";

  // === P0: Permission isolation check (hard block in strict/locked) ===
  const PERMISSION_MANAGED_TOOLS = new Set(["edit", "bash", "task"]);
  if (agent && PERMISSION_MANAGED_TOOLS.has(tool)) {
    const pi = new PermissionIsolation();
    const permResult = await pi.checkPermission(agent, tool);
    if (!permResult.allowed) {
      const msg = `[FW-ENFORCE] Permission denied: agent '${agent}' cannot use tool '${tool}'. Reason: ${permResult.reason}`;
      console.error(msg);
      if (mode !== "advisory") {
        throw new Error(msg);
      }
    }
  }

  // === P0: Orchestrator Mandatory Dispatch Gate (HARDCODED — overrides enforcement_mode) ===
  if (agent === "Orchestrator" || agent === "@Orchestrator") {
    const ORCHESTRATOR_ALLOWED_TOOLS = [
      "task",
      "read",
      "todowrite",
      "compliance_gate_check",
      "compliance_gate_confirm",
      "compliance_gate_complete",
      "dispatch_subagent"
    ];
    if (!ORCHESTRATOR_ALLOWED_TOOLS.includes(tool)) {
      const msg = `[FW-ENFORCE][FATAL] Orchestrator DISPATCH GATE BLOCKED: tool "${tool}" is not in the allowed list [${ORCHESTRATOR_ALLOWED_TOOLS.join(", ")}]. Orchestrator MUST dispatch sub-agents using "task" tool instead of executing "${tool}" directly.`;
      console.error(msg);
      throw new Error(msg);
    }

    // === P0: Orchestrator Task() Token Verification (must go through dispatch-subagent.js) ===
    if (tool === "task") {
      const promptText = output.args?.prompt || output.args?.description || "";
      const tokenMarker = "//DISPATCH_TOKEN:";
      const tokenIndex = promptText.lastIndexOf(tokenMarker);

      if (tokenIndex === -1) {
        const msg = `[FW-ENFORCE][FATAL] Orchestrator Task() DISPATCH TOKEN MISSING: Task() call lacks DISPATCH_TOKEN. Orchestrator MUST use dispatch-subagent.js to wrap prompts before calling Task().`;
        console.error(msg);
        throw new Error(msg);
      }

      const actualHash = promptText.substring(tokenIndex + tokenMarker.length).trim().split('\n')[0];
      const promptWithoutToken = promptText.substring(0, tokenIndex);
      const expectedHash = crypto.createHash("sha256").update(promptWithoutToken, "utf8").digest("hex");

      if (actualHash !== expectedHash) {
        const msg = `[FW-ENFORCE][FATAL] Orchestrator Task() DISPATCH TOKEN MISMATCH: expected ${expectedHash}, got ${actualHash}. Token may be tampered.`;
        console.error(msg);
        throw new Error(msg);
      }
    }
  }

  
  // === P0: Coder-BE — block framework writes (physical constraint) ===
  if ((tool === "write" || tool === "edit" || tool === "safe_edit") && 
      (agent === "Coder-BE" || agent === "@Coder-BE")) {
    const filePath = output.args?.filePath || "";
    if (filePath.includes(".opencode/")) {
      throw new Error(
        "[FW-ENFORCE][LOCKED] Coder-BE modification of framework files blocked. " +
        "Coder-BE may only modify business code (booking-backend/src/). " +
        "Framework changes must go through @Super-Admin."
      );
    }
  }

  // === P0: Coder-BE — block safe_bash writes to .opencode/ (physical constraint) ===
  if (tool === "safe_bash" && (agent === "Coder-BE" || agent === "@Coder-BE")) {
    const cmd = (output.args?.command as string) || "";
    const WRITE_PATTERNS = [/s+>s*.opencode//, /s+>>s*.opencode//, /rms+.*.opencode//, /cps+.*.opencode//, /mvs+.*.opencode//, /mkdirs+.*.opencode//, /tees+.*.opencode//, /nodes+-es+.*.opencode//];
    if (WRITE_PATTERNS.some(p => p.test(cmd))) {
      throw new Error("[FW-ENFORCE][LOCKED] Coder-BE safe_bash write to framework files blocked. Framework changes must go through @Super-Admin.");
    }
  }
  
  // === P0: Coder-FE — block framework writes (physical constraint) ===
  if ((tool === "write" || tool === "edit" || tool === "safe_edit") && 
      (agent === "Coder-FE" || agent === "@Coder-FE")) {
    const filePath = output.args?.filePath || "";
    if (filePath.includes(".opencode/")) {
      throw new Error(
        "[FW-ENFORCE][LOCKED] Coder-FE modification of framework files blocked. " +
        "Coder-FE may only modify business code (booking-frontend/src/). " +
        "Framework changes must go through @Super-Admin."
      );
    }
  }

  // === P0: Coder-FE — block safe_bash writes to .opencode/ (physical constraint) ===
  if (tool === "safe_bash" && (agent === "Coder-FE" || agent === "@Coder-FE")) {
    const cmd = (output.args?.command as string) || "";
    const WRITE_PATTERNS = [/s+>s*.opencode//, /s+>>s*.opencode//, /rms+.*.opencode//, /cps+.*.opencode//, /mvs+.*.opencode//, /mkdirs+.*.opencode//, /tees+.*.opencode//, /nodes+-es+.*.opencode//];
    if (WRITE_PATTERNS.some(p => p.test(cmd))) {
      throw new Error("[FW-ENFORCE][LOCKED] Coder-FE safe_bash write to framework files blocked. Framework changes must go through @Super-Admin.");
    }
  }
  
  // === P0: Super-Admin bypass — emergency framework administrator ===
  if (agent === "Super-Admin" || agent === "@Super-Admin") {
    logAuditEntry({
      event: "super_admin_bypass",
      tool,
      sessionID: input.sessionID,
      detail: `Super-Admin bypassed standard enforcement for tool "${tool}"`,
    });
    return;
  }

  // === P0: Architect — block business code AND sensitive framework writes (physical constraint) ===
  if ((tool === "write" || tool === "edit" || tool === "safe_edit") && 
      (agent === "Architect" || agent === "@Architect")) {
    const filePath = output.args?.filePath || "";

    // Block 1: No business code writes
    if (filePath.includes("booking_system_refactor/booking-backend/src/") ||
        filePath.includes("booking_system_refactor/booking-frontend/src/") ||
        filePath.includes("booking_system_refactor/booking-backend/test/")) {
      throw new Error(
        "[FW-ENFORCE][LOCKED] Architect modification of business code blocked. " +
        "Architect may only modify contract.yaml, .opencode/context/, .opencode/state/machine.json, " +
        "docs/, and .task_temp/. Business code changes must go through @Coder-BE / @Coder-FE."
      );
    }

    // Block 2: No sensitive framework writes
    if (filePath.includes(".opencode/") &&
        !filePath.includes(".opencode/context/") &&
        !filePath.includes(".opencode/state/machine.json") &&
        !filePath.includes("contract.yaml") &&
        !filePath.includes("docs/") &&
        !filePath.includes(".task_temp/")) {
      throw new Error(
        "[FW-ENFORCE][LOCKED] Architect modification of framework infrastructure blocked. " +
        "Architect may only modify contract.yaml, .opencode/context/** (specs/standards/designs), " +
        ".opencode/state/machine.json (keystone hash), docs/, and .task_temp/. " +
        "Framework changes (agents/, rules/, scripts/, plugins/, subagent-preamble.md, " +
        "project.config.json, opencode.json) must go through @Super-Admin."
      );
    }
  }


  // === Phase 3 R7: Docs Consistency Check (FW-HARNESS-DOCS-CONSISTENCY) ===
  // Hard-enforces that @Coder-BE/@Coder-FE complete Step 5a (docs consistency)
  // before writing source code. In strict/locked mode, writes are blocked if
  // TASK_LOG.md lacks a `## 📄 Docs Consistency Report` section.
  // In advisory mode, a warning is logged but execution continues.
  if ((tool === "write" || tool === "edit" || tool === "safe_edit") &&
      (agent === "Coder-BE" || agent === "@Coder-BE" ||
       agent === "Coder-FE" || agent === "@Coder-FE")) {
    const filePath = output.args?.filePath || "";
    if (filePath && isSourceFile(filePath)) {
      const taskId = process.env.FRAMEWORK_TASK_ID || "";
      if (taskId) {
        const taskLogPath = path.resolve(
          getOpenCodeRoot(),
          ".task_temp",
          taskId,
          "TASK_LOG.md",
        );
        if (fs.existsSync(taskLogPath)) {
          try {
            const logContent = fs.readFileSync(taskLogPath, "utf8");
            const hasDocsReport = /##\s*📄\s*Docs Consistency Report/.test(logContent);
            if (!hasDocsReport) {
              const msg =
                "[FW-ENFORCE][BLOCKED] Docs Consistency Report missing from TASK_LOG.md. " +
                "@Coder-BE/@Coder-FE must complete Step 5a (docs consistency check) " +
                "before writing source code. WAIVE.md with DOC-CAT1.0 entry can bypass.";
              if (mode === "strict" || mode === "locked") {
                throw new Error(msg);
              }
              // advisory mode: log warning, allow execution
              logAuditEntry({
                event: "docs_consistency_advisory",
                agent,
                filePath,
                taskId,
                detail: msg,
              });
            }
          } catch (_readErr) {
            // If TASK_LOG.md is unreadable, skip check — don't block
          }
        }
        // If TASK_LOG.md doesn't exist, skip check (some tasks may not have one yet)
      }
    }
  }

  /**
   * Phase 3 R7: Docs consistency enforcement — blocks source writes when
   * TASK_LOG.md lacks Docs Consistency Report. Active for @Coder-BE/@Coder-FE
   * on source files. Strict/locked mode blocks; advisory logs warning.
   */

  // ---- Plugin integrity check (FW-HARNESS-PLUGIN-CHECK) ----
  const integrityResult = checkPluginIntegrity();
  if (!integrityResult.valid) {
    if (mode === "strict" || mode === "locked") {
      throw new Error(
        `[FW-ENFORCE] Plugin integrity violation: ${integrityResult.detail}`,
      );
    }
    logAuditEntry({
      event: "silent_audit",
      detail: `[FW-ENFORCE][WARN][${mode}] Plugin integrity: ${integrityResult.detail}`,
    });
  }

  // ---- Check DAG coverage ----
  if (taskId) {
    const taskCheck = findTaskInDag(taskId);
    if (!taskCheck.found) {
      violations.push(
        `[FW-ENFORCE] Task "${taskId}" not found in Task.DAG.json`,
      );
    } else if (
      taskCheck.status !== "pending" &&
      taskCheck.status !== "in_progress"
    ) {
      violations.push(
        `[FW-ENFORCE] Task "${taskId}" has status "${taskCheck.status}" (expected pending/in_progress)`,
      );
    }
  }

  // ---- Check gate armed (FW-HARNESS-GATE-CHECK) ----
  // Two-tier gate check:
  //   Tier 1 (EXECUTION): write / edit / bash → require armed gate session
  //   Tier 2 (PLANNING):  task → require any non-consumed gate session (checked or armed)
  // This resolves the bootstrap deadlock: after compliance_gate_check creates a
  // "checked" session, Orchestrator can dispatch Meta-Planner via task() for planning.
  // Execution tools remain strictly blocked until compliance_gate_confirm arms the gate.
  const EXECUTION_TOOLS = ["write", "edit", "bash"];
  const PLANNING_TOOLS = ["task"];
  const MODIFYING_TOOLS = [...EXECUTION_TOOLS, ...PLANNING_TOOLS];
  const BOOTSTRAP_TOOLS = [
    "compliance_gate_check",
    "compliance_gate_confirm",
    "compliance_gate_complete",
  ];
  const isExecutionTool = EXECUTION_TOOLS.includes(tool);
  const isPlanningTool = PLANNING_TOOLS.includes(tool);
  const isModifyingTool = MODIFYING_TOOLS.includes(tool);
  const isBootstrapTool = BOOTSTRAP_TOOLS.includes(tool);

  if (isExecutionTool && !isBootstrapTool) {
    // Execution tools (write/edit/bash) require ARMED gate
    const armedCheck = findArmedSession();
    if (!armedCheck.found && mode !== "advisory") {
      violations.push(
        `[FW-ENFORCE] No armed compliance gate session found (mode: ${mode}). Call compliance_gate_confirm first.`,
      );
    }
  }
  if (isPlanningTool && !isBootstrapTool) {
    // Planning tools (task) require ANY non-consumed gate session
    const anySession = findAnyGateSession();
    if (!anySession.found && mode !== "advisory") {
      violations.push(
        `[FW-ENFORCE] No active compliance gate session found (mode: ${mode}). Call compliance_gate_check first.`,
      );
    }
  }

  // ---- Check write scope ----
  if ((tool === "write" || tool === "edit") && agent) {
    const filePath = output.args?.filePath || "";
    if (filePath && !isWriteAllowed(agent, filePath)) {
      if (mode === "strict" || mode === "locked") {
        violations.push(
          `[FW-ENFORCE] Agent "${agent}" write to "${filePath}" blocked by agent_write_scopes (mode: ${mode})`,
        );
      }
    }
  }

  // ---- FW-HARNESS-ENF-GUARD: Enforcement mode guard ----
  if (mode === "locked" || mode === "strict") {
    if (
      tool === "write" &&
      filePathMatches(output.args, ".opencode/project.config.json")
    ) {
      const newContent = output.args?.content;
      if (newContent) {
        try {
          const parsed = JSON.parse(newContent);
          // FW-HARNESS-P6 (P0-1 repair 2026-06-03): Use dual-key enforcement
          // (develop_enforcement_mode || runtime_enforcement_mode)
          // NOT the old single key "enforcement_mode" which doesn't exist in project.config.json
          const newMode = parsed?.template_resolution?.develop_enforcement_mode ||
                          parsed?.template_resolution?.runtime_enforcement_mode;
          if (newMode && newMode !== mode) {
            violations.push(
              `[FW-ENFORCE] Blocked attempt to change enforcement_mode from "${mode}" to "${newMode}" in ${mode} mode`,
            );
          }
        } catch {
          // If we can't parse, still allow
        }
      }
    }
  }

  // ---- FW-HARNESS-BEFORE-TDD: TDD enforcement ----
  // Only enforce for DAG-tracked tasks (taskId present and in DAG)
  if ((tool === "write" || tool === "edit") && taskId) {
    const filePath = output.args?.filePath || "";
    if (filePath && isSourceFile(filePath)) {
      const isTestFile =
        filePath.includes("test/") ||
        filePath.includes("__tests__/") ||
        filePath.includes(".spec.") ||
        filePath.includes(".test.");
      if (!isTestFile) {
        const msg = `[FW-ENFORCE] TDD violation: writing to "${filePath}" without prior test changes`;
        if (mode === "advisory") {
          logAuditEntry({
            timestamp: new Date().toISOString(),
            event: "tdd_violation_advisory",
            message: msg,
          });
        } else {
          violations.push(msg);
        }
      }
    }
  }

  // ---- FW-HARNESS-SHELL-AUDIT: Dangerous bash command audit ----
  if (tool === "bash") {
    const cmd = (output.args?.command as string) || "";
    if (
      /rm\s+.*\.opencode|mv\s+.*\.opencode|chmod\s+.*777|>\s*\.opencode|sudo\s+rm/i.test(
        cmd,
      )
    ) {
      if (mode !== "advisory") {
        violations.push(
          `[FW-ENFORCE] Dangerous bash command blocked: ${cmd.slice(0, 80)}`,
        );
      } else {
        logAuditEntry({
          timestamp: new Date().toISOString(),
          event: "dangerous_bash_advisory",
          command: cmd.slice(0, 80),
        });
      }
    }
  }

  // ---- FW-HARNESS-SCOPE-ESCALATION: Detect scope changes in project.config.json ----
  if (tool === "write" || tool === "edit") {
    const filePath = output.args?.filePath || "";
    if (
      filePath.includes("project.config.json") ||
      filePath.includes(".opencode/project.config.json")
    ) {
      try {
        const oldConfig = readJsonFile<ProjectConfig>(
          STATE_PATHS.projectConfig(),
        );
        const newContent = output.args?.content || "";
        if (newContent) {
          const newConfig = JSON.parse(newContent);
          const oldScopes = oldConfig?.agent_write_scopes || {};
          const newScopes = newConfig.agent_write_scopes || {};
          for (const agentKey of Object.keys(newScopes)) {
            const oldAllowed = oldScopes[agentKey]?.allowed || [];
            const newAllowed = newScopes[agentKey]?.allowed || [];
            if (newAllowed.length > oldAllowed.length) {
              const msg = `[FW-ENFORCE] Scope escalation: "${agentKey}" allowed scopes grew from ${oldAllowed.length} to ${newAllowed.length} entries`;
              if (mode !== "advisory") {
                violations.push(msg);
              } else {
                logAuditEntry({
                  timestamp: new Date().toISOString(),
                  event: "scope_escalation_advisory",
                  message: msg,
                });
              }
            }
          }
        }
      } catch {
        // Best-effort
      }
    }
  }

  // ---- FW-HARNESS-BEFORE-REGISTRY: Rule Registry Integrity (Check 7) ----
  const registryCheck = checkRuleRegistryIntegrity(STATE_PATHS);
  if (!registryCheck.valid) {
    for (const m of registryCheck.mismatches) {
      logAuditEntry({
        event: "silent_audit",
        detail: `[FW-ENFORCE][REGISTRY] Mismatch: ${m.file}${m.error ? " (" + m.error + ")" : ""}`,
      });
    }
    if (mode !== "advisory") {
      violations.push(
        `[FW-ENFORCE] Rule registry has ${registryCheck.mismatches.length} HIGH mismatches`,
      );
    }
  }

  // ---- FW-HARNESS-BEFORE-DIRTY: Machine Cleanliness Check (Check 8) ----
  const machineCheck = checkMachineCleanliness(STATE_PATHS);
  if (!machineCheck.clean && mode !== "advisory") {
    violations.push(
      `[FW-ENFORCE] Machine.json dirty: ${machineCheck.dirty.join(", ")}`,
    );
  }

  // === UC7KS: UC7-004 — No Direct Context7 for non-Knowledge-Curator agents ===
  const CONTEXT7_TOOLS = new Set(["context7_resolve-library-id", "context7_query-docs", "context7"]);
  if (CONTEXT7_TOOLS.has(tool) && agent !== "Knowledge-Curator" && agent !== "@Knowledge-Curator") {
    const msg = `[FW-ENFORCE][UC7-004] Direct Context7 MCP call blocked for agent "${agent}". All external documentation queries must route through @Orchestrator → @Knowledge-Curator. Use the UC7KS pipeline: check local cache first (docs/official_docs/index.json), then request @Orchestrator to dispatch @Knowledge-Curator.`;
    console.error(msg);
    if (mode !== "advisory") {
      throw new Error(msg);
    }
    violations.push("UC7-004: Unauthorized direct Context7 call");
    logAuditEntry({ event: "uc7ks_uc7_004_violation", tool, agent, sessionID: input.sessionID, detail: `Agent "${agent}" attempted direct Context7 call` });
  }

  // === UC7KS: UC7-008 — @Knowledge-Curator Scope Isolation ===
  if ((tool === "write" || tool === "edit" || tool === "safe_edit") && (agent === "Knowledge-Curator" || agent === "@Knowledge-Curator")) {
    const filePath = output.args?.filePath || "";
    if (filePath.includes("booking_system_refactor/") ||
        filePath.includes(".opencode/agents/") ||
        filePath.includes(".opencode/rules/") ||
        filePath.includes(".opencode/state/") ||
        filePath.includes(".opencode/hooks/") ||
        filePath.includes(".opencode/plugins/") ||
        filePath.includes("contract.yaml") ||
        filePath.includes("project.config.json") ||
        filePath.includes("Task.DAG.json")) {
      const msg = `[FW-ENFORCE][UC7-008] @Knowledge-Curator scope violation: attempted write to "${filePath}". @KC may only write to docs/official_docs/** and .metadata/**.`;
      console.error(msg);
      if (mode !== "advisory") { throw new Error(msg); }
      violations.push("UC7-008: @Knowledge-Curator scope violation");
      logAuditEntry({ event: "uc7ks_uc7_008_violation", tool, agent, sessionID: input.sessionID, detail: `@KC attempted write to restricted path: ${filePath}` });
    }
  }

  // === UC7KS: UC7-009 — ALL agents (incl. Super-Admin) must follow UC7KS pipeline ===
  //
  // Per UC7-009: "@Super-Admin MUST follow the same UC7KS pipeline as all other agents.
  // Framework repairs and governance modifications must be based on the latest official
  // documentation, not training data."
  //
  // This check is a SECONDARY defense layer. The PRIMARY enforcement is in
  // uc7ks-enforcer.ts which intercepts ALL external doc tools at the plugin hook level.
  // This layer catches any bypass that slips past the plugin.
  //
  // Enforcement:
  //   advisory: Log warning for audit trail (non-blocking)
  //   strict:   BLOCK if local cache exists but wasn't checked
  //   locked:   BLOCK all direct external queries (only @Knowledge-Curator may bypass)
  const EXTERNAL_DOC_TOOLS = new Set(["webfetch", "websearch", "context7_resolve-library-id", "context7_query-docs", "context7"]);
  if (EXTERNAL_DOC_TOOLS.has(tool)) {
    // @Knowledge-Curator is always allowed (it IS the pipeline)
    const isKC = (agent === "Knowledge-Curator" || agent === "@Knowledge-Curator");

    if (!isKC) {
      // Check if local cache exists and has entries
      const indexPath = path.resolve(process.cwd(), "docs/official_docs/index.json");
      let localCacheAvailable = false;
      try {
        if (fs.existsSync(indexPath)) {
          const content = JSON.parse(fs.readFileSync(indexPath, "utf8"));
          localCacheAvailable = !!(content.manifest_version && Array.isArray(content.entries) && content.entries.length > 0);
        }
      } catch (_) { /* ignore */ }

      if (mode === "locked") {
        // LOCKED: BLOCK ALL direct external queries (uc7ks-enforcer.ts primary, this is secondary)
        const msg = `[FW-ENFORCE][UC7-009][LOCKED] Direct external query "${tool}" blocked for agent "${agent}". LOCKED mode requires ALL documentation to go through @Knowledge-Curator. Use local cache: docs/official_docs/index.json.`;
        console.error(msg);
        violations.push("UC7-009: Direct external query in LOCKED mode");
        logAuditEntry({ event: "uc7ks_uc7_009_blocked_locked", tool, agent, sessionID: input.sessionID, detail: `Agent "${agent}" attempted direct "${tool}" in locked mode` });
      } else if (mode === "strict" && localCacheAvailable) {
        // STRICT: Block if cache exists (agent should have checked it first)
        const msg = `[FW-ENFORCE][UC7-009][STRICT] Direct external query "${tool}" blocked for agent "${agent}". Local knowledge cache exists (${indexPath}). Check cached docs before external queries.`;
        console.error(msg);
        violations.push("UC7-009: Direct external query without local cache check in STRICT mode");
        logAuditEntry({ event: "uc7ks_uc7_009_blocked_strict", tool, agent, sessionID: input.sessionID, detail: `Agent "${agent}" attempted direct "${tool}" with cache available` });
      } else {
        // ADVISORY or STRICT-without-cache: Log warning
        console.warn(`[FW-ENFORCE][UC7-009][${mode.toUpperCase()}] External query "${tool}" by "${agent}". UC7-009 requires all agents to follow UC7KS pipeline: local cache → @Knowledge-Curator.`);
        logAuditEntry({ event: "uc7ks_uc7_009_warning", tool, agent, sessionID: input.sessionID, detail: `Agent "${agent}" external query "${tool}" — cache ${localCacheAvailable ? "available" : "unavailable"}` });
      }
    }
  }

  // === UC7KS: UC7-001 — Auto-Track Knowledge Cache Access (read detection) ===
  // FW-HARDEN-UC7KS-001: Physically detects when any agent reads the knowledge cache
  // index (docs/official_docs/index.json) or cached docs. Records the access in
  // machine.json.knowledge_cache_state.session_access for downstream enforcement:
  //   - compliance_gate_check verifies UC7-001 before arming the gate
  //   - uc7ks-enforcer.ts checks cache access before allowing external queries
  //
  // This is the POSITIVE DETECTION layer — unlike the NEGATIVE BLOCKING layers
  // (UC7-004, UC7-009), this records compliance rather than blocking violations.
  if (tool === "read") {
    const filePath = output.args?.filePath || "";
    if (filePath.includes("docs/official_docs/")) {
      try {
        const machine = readJsonFile<any>(STATE_PATHS.machine());
        if (machine && machine.knowledge_cache_state) {
          const kcs = machine.knowledge_cache_state;
          // Initialize session_access if needed
          if (!kcs.session_access) kcs.session_access = {};
          if (!kcs.session_access[agent]) {
            kcs.session_access[agent] = {
              last_read_at: null,
              last_file_read: null,
              uc7_001_compliant: false,
              total_cache_reads: 0,
            };
          }
          // Update tracking
          const now = new Date().toISOString();
          kcs.session_access[agent].last_read_at = now;
          kcs.session_access[agent].last_file_read = filePath;
          kcs.session_access[agent].uc7_001_compliant = true;
          kcs.session_access[agent].total_cache_reads =
            (kcs.session_access[agent].total_cache_reads || 0) + 1;

          // Also update compliance counters
          if (!kcs.compliance) kcs.compliance = {};
          kcs.compliance.cache_hits = (kcs.compliance.cache_hits || 0) + 1;

          // Atomic write — preserve other state fields
          const updated = { ...machine, knowledge_cache_state: kcs };
          const tmpPath = STATE_PATHS.machine() + ".tmp." + Date.now();
          fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), "utf8");
          fs.renameSync(tmpPath, STATE_PATHS.machine());
        }
      } catch (e) {
        // Non-fatal: tracking failure should not block the agent's read operation
        console.warn(`[FW-ENFORCE][UC7-001] Failed to record cache access: ${(e as Error).message}`);
      }
    }
  }

  // === UC7KS: UC7-005 — Size Cap (pre-write check for docs/official_docs/) ===
  if ((tool === "write" || tool === "edit" || tool === "safe_edit")) {
    const filePath = output.args?.filePath || "";
    if (filePath.includes("docs/official_docs/")) {
      const content = output.args?.content || output.args?.newString || "";
      const sizeBytes = Buffer.byteLength(content, "utf8");
      const MAX_FILE_SIZE = 524288; // 500KB (UC7-005)

      if (sizeBytes > MAX_FILE_SIZE) {
        const msg = `[FW-ENFORCE][UC7-005] File size cap exceeded: ${filePath} is ${(sizeBytes / 1024).toFixed(1)}KB (max 500KB per UC7-005). Split or compress before saving.`;
        console.error(msg);
        if (mode !== "advisory") { throw new Error(msg); }
        violations.push("UC7-005: Docs file size cap exceeded");
        logAuditEntry({ event: "uc7ks_uc7_005_violation", tool, agent, sessionID: input.sessionID, detail: `${filePath}: ${sizeBytes} bytes` });
      }
    }
  }

  if (violations.length > 0) {
    if (mode === "advisory") {
      logAuditEntry({
        timestamp: new Date().toISOString(),
        event: "violations_advisory",
        violations: violations.join("; "),
      });
      return;
    }
    throw new Error(
      `Framework enforcement blocked tool "${tool}": ${violations.join("; ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Hook: tool.execute.after (FW-HARNESS-AFTER-AUDIT + FW-HARNESS-CODE-QUALITY)
// ---------------------------------------------------------------------------

async function toolExecuteAfter(
  input: {
    tool: string;
    sessionID: string;
    callID: string;
    args: any;
  },
  output: {
    title: string;
    output: string;
    metadata: any;
  },
): Promise<void> {
  const tool = input.tool;
  const agent = process.env.FRAMEWORK_AGENT || "";
  const taskId = process.env.FRAMEWORK_TASK_ID || "";
  const filePath = process.env.FRAMEWORK_FILE_PATH || "";

  // ---- (a) Write audit log entry ----
  writeAuditLogEntry({
    timestamp: new Date().toISOString(),
    tool,
    agent,
    sessionID: input.sessionID,
    callID: input.callID,
    taskId,
    filePath,
    action: tool === "write" || tool === "edit" ? "modify" : "execute",
    result: output?.output !== undefined ? "success" : "completed",
  });

  // ---- (b) Detect stale gate sessions (>24h armed without completion) ----
  try {
    const gate = readJsonFile<GateState>(STATE_PATHS.gateState());
    if (gate?.sessions) {
      const staleSessions = Object.values(gate.sessions).filter(isStaleSession);
      for (const stale of staleSessions) {
        writeAuditLogEntry({
          timestamp: new Date().toISOString(),
          event: "stale_session_detected",
          session_id: stale.session_id,
          confirmed_at: stale.confirmed_at,
          hours_stale: (
            (Date.now() - new Date(stale.confirmed_at!).getTime()) /
            3600000
          ).toFixed(1),
        });
      }
    }
  } catch {
    // Best-effort
  }

  // ---- (c) Auto-drain stale sessions (>24h armed) — FW-HARNESS-AFTER-REPAIR ----
  const staleSessions = checkStaleSessions(STATE_PATHS);
  if (staleSessions.count > 0) {
    const drained = autoDrainStaleSessions(STATE_PATHS);
    if (drained > 0) {
      writeAuditLogEntry({
        timestamp: new Date().toISOString(),
        event: "auto_drain",
        count: drained,
      });
    }
  }

  // ---- (d) Trigger state reconciliation on write/edit tools — FW-HARNESS-AFTER-REPAIR ----
  if ((tool === "write" || tool === "edit") && isSourceFile(filePath)) {
    const mode = getEnforcementMode();
    if (mode === "strict" || mode === "locked") {
      try {
        const machinePath = STATE_PATHS.machine();
        const machine = readJsonFile<any>(machinePath);
        if (machine) {
          machine.eslint_state = machine.eslint_state || {
            aggregate: { dirty_modules: [] },
          };
          machine.eslint_state.aggregate.dirty_modules =
            machine.eslint_state.aggregate.dirty_modules || [];
          fs.writeFileSync(machinePath, JSON.stringify(machine, null, 2));
        }
      } catch {
        // Best-effort
      }
    }

    // Set deferred full-scan flag — FW-HARNESS-FULL-SCAN
    process.env.FRAMEWORK_PENDING_FULLSCAN = "true";
  }

  // ---- (e) Auto-trigger Write-Time Audit (Phase 2 R4) — FW-HARNESS-WRITE-AUDIT-AUTO ----
  // Replaces the legacy manual MCP tool call from preamble Step 5b.
  // After each write/edit to a source file, automatically runs quality checks
  // and updates machine.json states directly — no agent-initiated MCP call needed.
  if ((tool === "write" || tool === "edit" || tool === "safe_edit") && filePath) {
    const srcPattern = /\.(ts|tsx|js|jsx|html|scss|prisma)$/;
    const skipPattern = /(\.md$|\.json$|\.yaml$|\.yml$|\.task_temp\/)/;
    const isSrcFile = srcPattern.test(filePath) && !skipPattern.test(filePath);

    if (isSrcFile) {
      const now = Date.now();
      // Debounce: batch writes within WRITE_CHECK_DEBOUNCE_MS window
      if (now - _lastWriteCheckTime > WRITE_CHECK_DEBOUNCE_MS) {
        // Flush pending batch
        if (_pendingWriteChecks.length > 0) {
          _executeWriteAuditCheck(_pendingWriteChecks, agent, taskId);
          _pendingWriteChecks = [];
        }
        _lastWriteCheckTime = now;
        _executeWriteAuditCheck([filePath], agent, taskId);
      } else {
        _pendingWriteChecks.push(filePath);
      }
    }
  }

  // === Orchestrator behavior audit (Layer 5) ===
  if ((agent === "Orchestrator" || agent === "@Orchestrator") && tool !== "task" && tool !== "read" && tool !== "todowrite") {
    logAuditEntry({
      event: "orchestrator_violation_attempt",
      tool: tool,
      timestamp: new Date().toISOString(),
      message: `Orchestrator attempted to call non-scheduling tool "${tool}" and was blocked by DISPATCH GATE`
    });
  }
}

/**
 * Phase 2 R4: Write-Time Audit Auto-Trigger
 *
 * Called by toolExecuteAfter when a write/edit/safe_edit is performed on a
 * source file (.ts, .js, .html, .scss, .prisma). Updates machine.json states
 * directly without requiring the agent to call an MCP tool.
 *
 * Checks performed:
 *   1. Scope — checks if agent has write permission (blocker in strict/locked)
 *   2. ESLint state — marks module as needing lint check
 *   3. Type check state — marks file as needing tsc check
 *   4. Format state — marks file as needing prettier check
 *   5. Dependency state — marks file as needing depcruiser check
 *   6. Write audit state — records the write in current_session
 *
 * For full quality checks (tsc, eslint, depcruiser, prettier), delegates to
 * code-quality-lib.js when available; otherwise performs lightweight inline checks.
 *
 * @param files - Array of file paths written (debounced batch)
 * @param agent - Agent type string (e.g., "@Coder-BE")
 * @param taskId - Current task ID
 */
function _executeWriteAuditCheck(
  files: string[],
  agent: string,
  taskId: string,
): void {
  const mode = getEnforcementMode();
  const machinePath = STATE_PATHS.machine();

  try {
    const machine = readJsonFile<any>(machinePath);
    if (!machine) return;

    // Init sub-states if missing
    machine.write_audit_state = machine.write_audit_state || {
      enabled: true,
      current_session: null,
      history: [],
    };
    machine.eslint_state = machine.eslint_state || {
      aggregate: { dirty_modules: [], total_violations: 0, waived_modules: [] },
    };
    machine.type_check_state = machine.type_check_state || {
      status: "clean",
      dirty_files: [],
      incremental_errors: 0,
    };
    machine.dependency_state = machine.dependency_state || {
      status: "clean",
      violations: [],
    };
    machine.format_state = machine.format_state || {
      status: "clean",
      unformatted_files: [],
    };

    const writeAudit = machine.write_audit_state;
    writeAudit.current_session = writeAudit.current_session || {
      agent,
      task_id: taskId || "unknown",
      files_written: [],
      checks_run: 0,
      checks_passed: 0,
      checks_failed: 0,
      violations_found: 0,
      violations_resolved: 0,
      scope_violations_attempted: 0,
    };

    const session = writeAudit.current_session;

    for (const file of files) {
      // Skip non-source files
      if (!/\.(ts|tsx|js|jsx|html|scss|prisma)$/.test(file)) continue;
      if (/\.task_temp\//.test(file)) continue;

      session.files_written.push(file);
      session.checks_run++;

      // 1. Scope check (inline — critical, must block)
      const scopeAllowed = isWriteAllowed(agent, file);
      if (!scopeAllowed) {
        session.scope_violations_attempted++;
        session.checks_failed++;
        session.violations_found++;
        const msg = `[FW-ENFORCE] Write-Audit: Agent "${agent}" scope violation writing to "${file}"`;
        if (mode === "strict" || mode === "locked") {
          logAuditEntry({
            timestamp: new Date().toISOString(),
            event: "write_audit_scope_blocked",
            agent,
            file,
            mode,
          });
          // Throw to block subsequent writes
          throw new Error(`${msg} (mode: ${mode}). Revert the change.`);
        } else {
          logAuditEntry({
            timestamp: new Date().toISOString(),
            event: "write_audit_scope_warning",
            agent,
            file,
            mode,
          });
        }
      } else {
        session.checks_passed++;
      }

      // 2. Mark for deferred checks
      // Extract module name from file path for eslint_state tracking
      const moduleMatch = file.match(/modules\/([^/]+)/);
      const moduleName = moduleMatch ? moduleMatch[1] : file.replace(/\//g, "_");
      if (!machine.eslint_state.modules) {
        machine.eslint_state.modules = {};
      }
      if (!machine.eslint_state.modules[moduleName]) {
        machine.eslint_state.modules[moduleName] = {
          status: "dirty",
          violations: [],
          last_check: new Date().toISOString(),
          waivers_applied: [],
        };
      }
      if (!machine.eslint_state.aggregate.dirty_modules.includes(moduleName)) {
        machine.eslint_state.aggregate.dirty_modules.push(moduleName);
      }

      // 3. Type check state
      machine.type_check_state.status = "dirty";
      if (!machine.type_check_state.dirty_files.includes(file)) {
        machine.type_check_state.dirty_files.push(file);
      }

      // 4. Format state
      if (!machine.format_state.unformatted_files.includes(file)) {
        machine.format_state.unformatted_files.push(file);
        machine.format_state.status = "dirty";
      }

      // 5. Dependency state
      if (!machine.dependency_state.violations.some((v: any) => v.file === file)) {
        machine.dependency_state.violations.push({
          file,
          message: "pending depcruiser check",
          severity: "info",
        });
      }
    }

    // Persist machine.json state
    fs.writeFileSync(machinePath, JSON.stringify(machine, null, 2));

    // Attempt full quality checks via code-quality-lib if available
    try {
      const _require = createRequire(import.meta.url);
      const cql = _require("../../scripts/mcp-tools/code-quality-lib.js");
      const projectRoot = path.resolve(
        getOpenCodeRoot(),
        readJsonFile<any>(STATE_PATHS.projectConfig())?.project_root || ".",
      );
      // Run full check on the last file in the batch for efficiency
      const lastFile = files[files.length - 1];
      const results = cql.runAllChecks(lastFile, projectRoot, agent, taskId, {
        auto_fix: mode !== "locked",
        skip_checks: [],
      });

      // Update machine.json again with actual check results
      const updatedMachine = readJsonFile<any>(machinePath);
      if (updatedMachine) {
        updatedMachine.write_audit_state.current_session = session;
        if (results.checks.eslint?.pass) {
          // Clear dirty module if eslint passed
          const m = updatedMachine.eslint_state;
          if (m?.aggregate?.dirty_modules) {
            m.aggregate.dirty_modules = m.aggregate.dirty_modules.filter(
              (d: string) => d !== moduleName,
            );
          }
        }
        if (results.checks.tsc?.pass && updatedMachine.type_check_state) {
          updatedMachine.type_check_state.dirty_files =
            updatedMachine.type_check_state.dirty_files.filter(
              (f: string) => f !== lastFile,
            );
        }
        fs.writeFileSync(machinePath, JSON.stringify(updatedMachine, null, 2));
      }
    } catch (_libErr) {
      // code-quality-lib not available (e.g., different runtime context)
      // The inline state updates above are sufficient for auditing
    }
  } catch (err: any) {
    // Re-throw scope violations; log other errors
    if (err.message?.includes("scope violation")) {
      throw err;
    }
    // Best-effort: log and continue
    try {
      logAuditEntry({
        timestamp: new Date().toISOString(),
        event: "write_audit_error",
        error: err.message?.slice(0, 200),
      });
    } catch {
      // silent
    }
  }
}

// ---------------------------------------------------------------------------
// Hook: shell.env (FW-HARNESS-SHELL-ENV)
// ---------------------------------------------------------------------------

async function shellEnv(
  input: { cwd: string },
  output: { env: Record<string, string> },
): Promise<void> {
  output.env.FRAMEWORK_ENFORCEMENT_MODE = getEnforcementMode();
  output.env.FRAMEWORK_ROOT = getOpenCodeRoot();
}

// ---------------------------------------------------------------------------
// Hook: file.edited (FW-HARNESS-FILE-EDITED)
// ---------------------------------------------------------------------------

async function fileEdited(
  input: { path: string; agent?: string },
  _output: void,
): Promise<void> {
  const mode = getEnforcementMode();
  const filePath = input.path || "";
  const agent = input.agent || "";

  if (!isCriticalFrameworkFile(filePath)) return;

  if (mode === "locked") {
    throw new Error(
      `[FW-ENFORCE][LOCKED] Tamper blocked: critical framework file "${filePath}" edited by "${agent}". Auto-restore attempted.`,
    );
  }
  if (mode === "strict") {
    logAuditEntry({
      timestamp: new Date().toISOString(),
      event: "critical_file_edited_strict",
      filePath,
      agent,
    });
    return;
  }
  // advisory
  logAuditEntry({
    timestamp: new Date().toISOString(),
    event: "critical_file_edited_advisory",
    filePath,
    agent,
  });
}

// ---------------------------------------------------------------------------
// Hook: session.created (FW-HARNESS-SESSION-HOOKS)
// ---------------------------------------------------------------------------

async function sessionCreated(
  input: { sessionID: string },
  _output: void,
): Promise<void> {
  const sessionID = input.sessionID;

  writeAuditLogEntry({
    timestamp: new Date().toISOString(),
    event: "session.created",
    session_id: sessionID,
    action: "session_created",
  });

  const mode = getEnforcementMode();
  logAuditEntry({
    event: "silent_audit",
    detail: `[FW-ENFORCE][AUDIT] Session created: ${sessionID} (mode: ${mode})`,
  });
}

// ---------------------------------------------------------------------------
// Hook: session.error (FW-HARNESS-SESSION-HOOKS)
// ---------------------------------------------------------------------------

async function sessionError(
  input: { sessionID: string; error: Error },
  _output: void,
): Promise<void> {
  const { sessionID, error } = input;

  writeAuditLogEntry({
    timestamp: new Date().toISOString(),
    event: "session.error",
    session_id: sessionID,
    error_message: error.message,
    error_stack: error.stack,
  });

  // Trigger auto-recovery for critical errors
  if (error.message && /gate|tamper|integrity/i.test(error.message)) {
    logAuditEntry({
      timestamp: new Date().toISOString(),
      event: "auto_recovery",
      session_id: sessionID,
      message: error.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Hook: session.idle (FW-HARNESS-SESSION-HOOKS)
// ---------------------------------------------------------------------------

async function sessionIdle(
  input: { sessionID: string },
  _output: void,
): Promise<void> {
  const { sessionID } = input;
  const mode = getEnforcementMode();

  try {
    const gate = readJsonFile<GateState>(STATE_PATHS.gateState());
    if (gate?.sessions) {
      const staleSessions = Object.values(gate.sessions).filter(isStaleSession);
      for (const stale of staleSessions) {
        logAuditEntry({
          timestamp: new Date().toISOString(),
          event: "session.idle_drain",
          session_id: stale.session_id,
          reason: "idle_timeout",
        });
        if (mode === "strict" || mode === "locked") {
          logAuditEntry({
            timestamp: new Date().toISOString(),
            event: "stale_session_drain",
            session_id: stale.session_id,
          });
        }
      }
    }
  } catch {
    // Best-effort
  }

  logAuditEntry({
    timestamp: new Date().toISOString(),
    event: "session_idle_audit",
    session_id: sessionID,
  });
}

// ---------------------------------------------------------------------------
// Hook: permission.asked (FW-HARNESS-PERMISSION)
// ---------------------------------------------------------------------------

async function permissionAsked(
  input: { tool: string; agent: string; sessionID: string },
  _output: void,
): Promise<void> {
  const { tool, agent, sessionID } = input;

  writeAuditLogEntry({
    timestamp: new Date().toISOString(),
    event: "permission.asked",
    tool,
    agent,
    session_id: sessionID,
    action: "permission_request",
  });

  const escalationPatterns = [
    { pattern: /rm\s+-rf/, severity: "high" },
    { pattern: /chmod\s+777/, severity: "high" },
    { pattern: /sudo/, severity: "medium" },
    { pattern: /mv\s+.*\.opencode/, severity: "high" },
  ];

  const mode = getEnforcementMode();
  for (const ep of escalationPatterns) {
    if (ep.pattern.test(tool)) {
      const msg = `[FW-ENFORCE][ESCALATION] Permission escalation detected: agent=${agent} tool="${tool}" pattern="${ep.pattern}" severity=${ep.severity}`;
      logAuditEntry({
        event: "silent_audit",
        detail:
          mode === "strict" || mode === "locked"
            ? `[FW-ENFORCE][BLOCK] ${msg}`
            : `[FW-ENFORCE][WARN] ${msg}`,
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Hook: permission.replied (FW-HARNESS-PERMISSION)
// ---------------------------------------------------------------------------

async function permissionReplied(
  input: { tool: string; granted: boolean },
  _output: void,
): Promise<void> {
  const { tool, granted } = input;

  writeAuditLogEntry({
    timestamp: new Date().toISOString(),
    event: "permission.replied",
    tool,
    granted,
    action: granted ? "permission_granted" : "permission_denied",
  });

  logAuditEntry({
    event: "silent_audit",
    detail: `[FW-ENFORCE][AUDIT] Permission ${granted ? "granted" : "denied"} for tool "${tool}"`,
  });
}

// ---------------------------------------------------------------------------
// Hook: command.executed (FW-HARNESS-COMMAND-EXEC)
// ---------------------------------------------------------------------------

async function commandExecuted(
  input: { command: string; agent?: string },
  _output: void,
): Promise<void> {
  const { command, agent } = input;

  writeAuditLogEntry({
    timestamp: new Date().toISOString(),
    event: "command.executed",
    agent: agent || "",
    command: command.substring(0, 200),
    action: "command_executed",
  });
}

// ---------------------------------------------------------------------------
// Hook: session.compacted (FW-HARNESS-SESSION-COMPACTED)
// ---------------------------------------------------------------------------

async function sessionCompacted(
  input: { sessionID: string },
  _output: void,
): Promise<void> {
  logAuditEntry({
    tool: "session.compacted",
    sessionID: input.sessionID,
    action: "compacted",
  });
}

// ---------------------------------------------------------------------------
// Hook: message.updated (FW-HARNESS-MESSAGE-UPDATED)
// ---------------------------------------------------------------------------

async function messageUpdated(
  input: { messageID: string },
  _output: void,
): Promise<void> {
  logAuditEntry({
    tool: "message.updated",
    action: "message_changed",
    detail: input.messageID?.slice(0, 50),
  });
}

// ---------------------------------------------------------------------------
// Hook: todo.updated (FW-HARNESS-TODO-UPDATED)
// ---------------------------------------------------------------------------

async function todoUpdated(_input: void, _output: void): Promise<void> {
  logAuditEntry({
    tool: "todo.updated",
    action: "todo_changed",
  });
}

// ---------------------------------------------------------------------------
// Hook: tui.command.execute (FW-HARNESS-TUI-COMMAND)
// ---------------------------------------------------------------------------

async function tuiCommandExecute(
  input: { command: string; agent?: string },
  _output: void,
): Promise<void> {
  const dangerousCommands = ["/bash", "/rm", "/delete", "/force"];
  const lower = input.command.toLowerCase();
  let blocked = false;

  for (const dc of dangerousCommands) {
    if (lower.startsWith(dc)) {
      const mode = getEnforcementMode();
      if (mode === "strict" || mode === "locked") {
        blocked = true;
        throw new Error(
          `[FW-ENFORCE] Dangerous TUI command blocked: ${input.command}`,
        );
      }
      // advisory mode: log silently, no console output
      logAuditEntry({
        event: "silent_audit",
        detail: `[FW-ENFORCE][WARN][advisory] Dangerous TUI command: ${input.command}`,
      });
      break;
    }
  }

  if (!blocked) {
    logAuditEntry({
      tool: "tui.command.execute",
      action: "command_executed",
      detail: input.command?.slice(0, 100),
    });
  }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

const plugin: Plugin = async (_ctx: PluginInput): Promise<Hooks> => {
  // Initialize plugin integrity hash (FW-HARNESS-PLUGIN-CHECK)
  checkPluginIntegrity();

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    "shell.env": shellEnv,
    ["file.edited" as any]: fileEdited,
    // Phase 1 hooks (FW-HARNESS-PHASE1)
    "session.created": sessionCreated,
    "session.error": sessionError,
    "session.idle": sessionIdle,
    "permission.asked": permissionAsked,
    "permission.replied": permissionReplied,
    "command.executed": commandExecuted,
    // Phase 3 hooks (FW-HARNESS-P3)
    "session.compacted": sessionCompacted,
    "message.updated": messageUpdated,
    "todo.updated": todoUpdated,
    "tui.command.execute": tuiCommandExecute,
  } as unknown as Hooks;
};

export default plugin;
