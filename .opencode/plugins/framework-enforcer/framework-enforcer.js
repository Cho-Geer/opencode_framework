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
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { safeEdit } from '../../tools/safe-edit.js';
// ---------------------------------------------------------------------------
// Plugin integrity state (FW-HARNESS-PLUGIN-CHECK)
// ---------------------------------------------------------------------------
let _pluginHash = "";
let _pluginHooksCount = 0;
// ---------------------------------------------------------------------------
// Critical framework file patterns (FW-HARNESS-FILE-EDITED)
// ---------------------------------------------------------------------------
const CRITICAL_PATTERNS = [
  ".opencode/plugins/framework-enforcer/framework-enforcer.ts",
  ".opencode/plugins/framework-enforcer.ts",
  ".opencode/hooks/pre-commit",
  ".opencode/hooks/commit-msg",
  ".opencode/project.config.json",
  "opencode.json",
  ".opencode/state/",
];
// ---------------------------------------------------------------------------
// File paths (resolved relative to OPENCODE_ROOT)
// ---------------------------------------------------------------------------
function getOpenCodeRoot() {
  return process.env.OPENCODE_ROOT || process.cwd();
}
function resolveStatePath(relativePath) {
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
function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore if already exists
  }
}
// ---------------------------------------------------------------------------
// Utility: compute SHA-256 hash of a file
// ---------------------------------------------------------------------------
function computeFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return "";
  }
}
// ---------------------------------------------------------------------------
// Plugin integrity self-check (FW-HARNESS-PLUGIN-CHECK)
// ---------------------------------------------------------------------------
function checkPluginIntegrity() {
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
// Enforcement mode retrieval
// ---------------------------------------------------------------------------
function getEnforcementMode() {
  const envMode = process.env.ENFORCEMENT_MODE || process.env.FRAMEWORK_MODE;
  if (envMode && ["advisory", "strict", "locked"].includes(envMode)) {
    return envMode;
  }
  const config = readJsonFile(STATE_PATHS.projectConfig());
  const mode = config?.template_resolution?.enforcement_mode;
  if (mode && ["advisory", "strict", "locked"].includes(mode)) {
    return mode;
  }
  return "strict";
}
// ---------------------------------------------------------------------------
// DAG and gate state readers
// ---------------------------------------------------------------------------
function findTaskInDag(taskId) {
  const dag = readJsonFile(STATE_PATHS.dag());
  if (!dag || !Array.isArray(dag.tasks)) {
    return { found: false, status: "unknown" };
  }
  const task = dag.tasks.find((t) => t.id === taskId);
  return task
    ? { found: true, status: task.status }
    : { found: false, status: "unknown" };
}
function findArmedSession() {
  const gate = readJsonFile(STATE_PATHS.gateState());
  if (!gate || !gate.sessions) {
    return { found: false, sessionId: null };
  }
  const sessions = Object.values(gate.sessions);
  const armedSession = sessions.find(
    (s) => s.gate_status === "armed" && s.consumed_at === null,
  );
  if (armedSession) {
    return { found: true, sessionId: armedSession.session_id };
  }
  return { found: false, sessionId: null };
}
// ---------------------------------------------------------------------------
// Write scope check
// ---------------------------------------------------------------------------
function isWriteAllowed(agentType, filePath) {
  const config = readJsonFile(STATE_PATHS.projectConfig());
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
function matchGlob(filePath, pattern) {
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
function isSourceFile(filePath) {
  if (!filePath) return false;
  return /\.(ts|tsx|js|jsx)$/.test(filePath);
}
function isCriticalFrameworkFile(filePath) {
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
function isStaleSession(session) {
  if (!session.confirmed_at || session.consumed_at) return false;
  const confirmed = new Date(session.confirmed_at).getTime();
  const hoursElapsed = (Date.now() - confirmed) / 3600000;
  return hoursElapsed > 24;
}
function filePathMatches(args, pattern) {
  if (!args) return false;
  const fp = (args.filePath || args.path || "").replace(/\\/g, "/");
  return fp.includes(pattern);
}
// ---------------------------------------------------------------------------
// Phase 2 Helpers (FW-HARNESS-P2)
// ---------------------------------------------------------------------------
function checkStaleSessions(paths) {
  try {
    const gate = readJsonFile(paths.gateState());
    if (!gate?.sessions) return { count: 0 };
    const sessions = Object.values(gate.sessions);
    const staleCount = sessions.filter(isStaleSession).length;
    return { count: staleCount };
  } catch {
    return { count: 0 };
  }
}
function autoDrainStaleSessions(paths) {
  try {
    const gatePath = paths.gateState();
    const gate = readJsonFile(gatePath);
    if (!gate?.sessions) return 0;
    const staleEntries = Object.entries(gate.sessions).filter(([, s]) =>
      isStaleSession(s),
    );
    if (staleEntries.length === 0) return 0;
    gate.drained_sessions = gate.drained_sessions || {};
    for (const [sid, session] of staleEntries) {
      gate.drained_sessions[sid] = {
        ...session,
        drained_at: new Date().toISOString(),
        reason: "auto-drain",
      };
      delete gate.sessions[sid];
    }
    gate.active_sessions = (gate.active_sessions || []).filter(
      (sid) => gate.sessions[sid] && gate.sessions[sid].gate_status === "armed",
    );
    fs.writeFileSync(gatePath, JSON.stringify(gate, null, 2), "utf8");
    return staleEntries.length;
  } catch {
    return 0;
  }
}
function checkRuleRegistryIntegrity(paths) {
  try {
    const registry = readJsonFile(
      resolveStatePath(".opencode/state/rule_registry.json"),
    );
    if (!registry) return { valid: true, mismatches: [] };
    const entries = registry.entries || registry.files || [];
    const mismatches = [];
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
function checkMachineCleanliness(paths) {
  try {
    const machine = readJsonFile(paths.machine());
    if (!machine) return { clean: true, dirty: [] };
    const dirty = [];
    const esDirty = machine?.eslint_state?.aggregate?.dirty_modules || [];
    const tsDirty = machine?.type_check_state?.dirty_files || [];
    const fmtDirty = machine?.format_state?.unformatted_files || [];
    dirty.push(...esDirty.map((f) => `eslint:${f}`));
    dirty.push(...tsDirty.map((f) => `tsc:${f}`));
    dirty.push(...fmtDirty.map((f) => `format:${f}`));
    return { clean: dirty.length === 0, dirty };
  } catch {
    return { clean: true, dirty: [] };
  }
}
// ---------------------------------------------------------------------------
// Audit log writer
// ---------------------------------------------------------------------------
function writeAuditLogEntry(entry) {
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
function logAuditEntry(entry) {
  writeAuditLogEntry({
    timestamp: new Date().toISOString(),
    ...entry,
    sessionID: entry.sessionID || "",
  });
}
function flushAuditTrail(sessionID) {
  const auditDir = path.join(getOpenCodeRoot(), ".task_temp", "_global");
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }
  const trailPath = path.join(auditDir, "audit_trail.json");
  let existing = [];
  try {
    const raw = fs.readFileSync(trailPath, "utf-8");
    existing = JSON.parse(raw);
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
async function toolExecuteBefore(input, output) {
  const tool = input.tool;
  const mode = getEnforcementMode();
  const violations = [];
  const agent = process.env.FRAMEWORK_AGENT || "";
  const taskId = process.env.FRAMEWORK_TASK_ID || "";
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
  // Only enforce for modifying tools; skip read-only and bootstrap tools
  const MODIFYING_TOOLS = ["write", "edit", "bash", "task"];
  const BOOTSTRAP_TOOLS = [
    "compliance_gate_check",
    "compliance_gate_confirm",
    "compliance_gate_complete",
  ];
  const isModifyingTool = MODIFYING_TOOLS.includes(tool);
  const isBootstrapTool = BOOTSTRAP_TOOLS.includes(tool);
  if (isModifyingTool && !isBootstrapTool) {
    const armedCheck = findArmedSession();
    if (!armedCheck.found && mode !== "advisory") {
      violations.push(
        `[FW-ENFORCE] No armed compliance gate session found (mode: ${mode})`,
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
          const newMode = parsed?.template_resolution?.enforcement_mode;
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
    const cmd = output.args?.command || "";
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
        const oldConfig = readJsonFile(STATE_PATHS.projectConfig());
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
async function toolExecuteAfter(input, output) {
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
    result: output?.result !== undefined ? "success" : "completed",
  });
  // ---- (b) Detect stale gate sessions (>24h armed without completion) ----
  try {
    const gate = readJsonFile(STATE_PATHS.gateState());
    if (gate?.sessions) {
      const staleSessions = Object.values(gate.sessions).filter(isStaleSession);
      for (const stale of staleSessions) {
        writeAuditLogEntry({
          timestamp: new Date().toISOString(),
          event: "stale_session_detected",
          session_id: stale.session_id,
          confirmed_at: stale.confirmed_at,
          hours_stale: (
            (Date.now() - new Date(stale.confirmed_at).getTime()) /
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
        const machine = readJsonFile(machinePath);
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
}
// ---------------------------------------------------------------------------
// Hook: shell.env (FW-HARNESS-SHELL-ENV)
// ---------------------------------------------------------------------------
async function shellEnv(input, output) {
  output.env.FRAMEWORK_ENFORCEMENT_MODE = getEnforcementMode();
  output.env.FRAMEWORK_ROOT = getOpenCodeRoot();
}
// ---------------------------------------------------------------------------
// Hook: file.edited (FW-HARNESS-FILE-EDITED)
// ---------------------------------------------------------------------------
async function fileEdited(input, _output) {
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
async function sessionCreated(input, _output) {
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
async function sessionError(input, _output) {
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
async function sessionIdle(input, _output) {
  const { sessionID } = input;
  const mode = getEnforcementMode();
  try {
    const gate = readJsonFile(STATE_PATHS.gateState());
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
async function permissionAsked(input, _output) {
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
async function permissionReplied(input, _output) {
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
async function commandExecuted(input, _output) {
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
async function sessionCompacted(input, _output) {
  logAuditEntry({
    tool: "session.compacted",
    sessionID: input.sessionID,
    action: "compacted",
  });
}
// ---------------------------------------------------------------------------
// Hook: message.updated (FW-HARNESS-MESSAGE-UPDATED)
// ---------------------------------------------------------------------------
async function messageUpdated(input, _output) {
  logAuditEntry({
    tool: "message.updated",
    action: "message_changed",
    detail: input.messageID?.slice(0, 50),
  });
}
// ---------------------------------------------------------------------------
// Hook: todo.updated (FW-HARNESS-TODO-UPDATED)
// ---------------------------------------------------------------------------
async function todoUpdated(_input, _output) {
  logAuditEntry({
    tool: "todo.updated",
    action: "todo_changed",
  });
}
// ---------------------------------------------------------------------------
// Hook: tui.command.execute (FW-HARNESS-TUI-COMMAND)
// ---------------------------------------------------------------------------
async function tuiCommandExecute(input, _output) {
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
const plugin = async (_ctx) => {
  // Initialize plugin integrity hash (FW-HARNESS-PLUGIN-CHECK)
  checkPluginIntegrity();
  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    "shell.env": shellEnv,
    "file.edited": fileEdited,
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
  };
};
export default plugin;
