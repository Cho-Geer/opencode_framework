/**
 * hooks/tool-execute.ts — Tool Execution Hooks (Before/After)
 *
 * Extracted from framework-enforcer.ts §FW-HARNESS (lines 515-1316, ~771 lines).
 * The core enforcement engine — handles all pre/post tool execution checks.
 *
 * FUNCTIONS:
 *   - toolExecuteBefore()       — Pre-execution: DAG coverage, gate state, permission
 *                                 isolation, dispatch token, write scopes, TDD enforcement,
 *                                 dangerous command audit, scope escalation, plugin integrity,
 *                                 rule registry, machine cleanliness
 *   - toolExecuteAfter()        — Post-execution: audit logging, stale session detection,
 *                                 auto-drain, state reconciliation, write-audit auto-trigger
 *   - _executeWriteAuditCheck() — Internal: debounced write-time quality check auto-trigger
 *
 * DEPENDS ON (all already extracted):
 *   - utils/state-utils.ts
 *   - utils/audit-log.ts
 *   - checks/gate-checks.ts
 *
 * STATUS: ✅ EXTRACTED — 7/7 modules complete. Phase 4 modularization: 100%.
 *
 * @since Wave 3.1 (R5)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";
import { PermissionIsolation } from "../../../lib/permission-isolation-core";
import { readJsonFile, findArmedSession, findAnyGateSession, getEnforcementMode } from "../../../lib/gate-core";
import { computeSHA256 } from "../../../lib/gate-core";
import {
  getOpenCodeRoot, STATE_PATHS, isSourceFile, isStaleSession, isCriticalFrameworkFile,
} from "../utils/state-utils";
import {
  writeAuditLogEntry, logAuditEntry,
} from "../utils/audit-log";
import {
  checkPluginIntegrity, findTaskInDag, isWriteAllowed, checkStaleSessions,
  autoDrainStaleSessions, checkRuleRegistryIntegrity, checkMachineCleanliness,
} from "../checks/gate-checks";

// Debounce state for write-time checks
let _lastWriteCheckTime = 0;
let _pendingWriteChecks: string[] = [];
const WRITE_CHECK_DEBOUNCE_MS = 2000;

export async function toolExecuteBefore(
  input: { tool: string; sessionID: string; callID: string },
  output: { args: Record<string, unknown> },
): Promise<void> {
  const tool = input.tool;
  const mode = getEnforcementMode();
  const violations: string[] = [];
  const agent = process.env.FRAMEWORK_AGENT || "";
  const taskId = process.env.FRAMEWORK_TASK_ID || "";

  // P0: Orchestrator DAG modification block
  if ((tool === "write" || tool === "edit" || tool === "safe_edit") && (agent === "Orchestrator" || agent === "@Orchestrator")) {
    const filePath = (output.args?.filePath as string) || "";
    if (filePath.endsWith("Task.DAG.json")) {
      throw new Error("[FW-ENFORCE][LOCKED] Orchestrator modification of Task.DAG.json blocked. Only @Meta-Planner may modify the DAG.");
    }
  }

  // P0: Permission isolation check
  const PERMISSION_MANAGED_TOOLS = new Set(["edit", "bash", "task"]);
  if (agent && PERMISSION_MANAGED_TOOLS.has(tool)) {
    const pi = new PermissionIsolation();
    const permResult = await pi.checkPermission(agent, tool);
    if (!permResult.allowed) {
      const msg = `[FW-ENFORCE] Permission denied: agent '${agent}' cannot use tool '${tool}'. Reason: ${permResult.reason}`;
      console.error(msg);
      if (mode !== "advisory") throw new Error(msg);
    }
  }

  // P0: Orchestrator Mandatory Dispatch Gate
  if (agent === "Orchestrator" || agent === "@Orchestrator") {
    const ORCHESTRATOR_ALLOWED_TOOLS = ["task", "read", "todowrite", "compliance_gate_check", "compliance_gate_confirm", "compliance_gate_complete", "dispatch_subagent"];
    if (!ORCHESTRATOR_ALLOWED_TOOLS.includes(tool)) {
      throw new Error(`[FW-ENFORCE][FATAL] Orchestrator DISPATCH GATE BLOCKED: tool "${tool}" not allowed.`);
    }
    if (tool === "task") {
      const promptText = (output.args?.prompt || output.args?.description || "") as string;
      const tokenMarker = "//DISPATCH_TOKEN:";
      const tokenIndex = promptText.lastIndexOf(tokenMarker);
      if (tokenIndex === -1) throw new Error("[FW-ENFORCE][FATAL] Orchestrator Task() DISPATCH TOKEN MISSING.");
      const actualHash = promptText.substring(tokenIndex + tokenMarker.length).trim().split("\n")[0];
      const promptWithoutToken = promptText.substring(0, tokenIndex);
      const expectedHash = crypto.createHash("sha256").update(promptWithoutToken, "utf8").digest("hex");
      if (actualHash !== expectedHash) throw new Error(`[FW-ENFORCE][FATAL] DISPATCH TOKEN MISMATCH.`);
    }
  }

  // P0: Coder-BE/FE block framework writes
  const coderAgent = agent === "Coder-BE" || agent === "@Coder-BE" || agent === "Coder-FE" || agent === "@Coder-FE";
  if ((tool === "write" || tool === "edit" || tool === "safe_edit") && coderAgent) {
    const fp = (output.args?.filePath as string) || "";
    if (fp.includes(".opencode/")) throw new Error(`[FW-ENFORCE][LOCKED] ${agent} framework write blocked.`);
  }
  if (tool === "safe_bash" && coderAgent) {
    const cmd = (output.args?.command as string) || "";
    const WRITE_PATTERNS = [/\s+>\s*\.opencode\//, /\s+>>\s*\.opencode\//, /rm\s+.*\.opencode\//, /cp\s+.*\.opencode\//, /mv\s+.*\.opencode\//, /mkdir\s+.*\.opencode\//, /tee\s+.*\.opencode\//, /node\s+-e\s+.*\.opencode\//];
    if (WRITE_PATTERNS.some(p => p.test(cmd))) throw new Error(`[FW-ENFORCE][LOCKED] ${agent} safe_bash framework write blocked.`);
  }

  // P0: Super-Admin bypass
  if (agent === "Super-Admin" || agent === "@Super-Admin") {
    logAuditEntry({ event: "super_admin_bypass", tool, sessionID: input.sessionID, detail: `Super-Admin bypassed standard enforcement for tool "${tool}"` });
    return;
  }

  // P0: Architect block business code + sensitive framework writes
  if ((tool === "write" || tool === "edit" || tool === "safe_edit") && (agent === "Architect" || agent === "@Architect")) {
    const fp = (output.args?.filePath as string) || "";
    if (fp.includes("booking_system_refactor/booking-backend/src/") || fp.includes("booking_system_refactor/booking-frontend/src/")) {
      throw new Error("[FW-ENFORCE][LOCKED] Architect business code write blocked.");
    }
    if (fp.includes(".opencode/") && !fp.includes(".opencode/context/") && !fp.includes(".opencode/state/machine.json") && !fp.includes("contract.yaml") && !fp.includes("docs/") && !fp.includes(".task_temp/")) {
      throw new Error("[FW-ENFORCE][LOCKED] Architect framework infrastructure write blocked.");
    }
  }

  // Docs consistency check
  if ((tool === "write" || tool === "edit" || tool === "safe_edit") && (agent === "Coder-BE" || agent === "@Coder-BE" || agent === "Coder-FE" || agent === "@Coder-FE")) {
    const fp = (output.args?.filePath as string) || "";
    if (fp && isSourceFile(fp) && taskId) {
      const logPath = path.resolve(getOpenCodeRoot(), ".task_temp", taskId, "TASK_LOG.md");
      if (fs.existsSync(logPath)) {
        try {
          const logContent = fs.readFileSync(logPath, "utf8");
          if (!/##\s*📄\s*Docs Consistency Report/.test(logContent)) {
            const msg = "[FW-ENFORCE][BLOCKED] Docs Consistency Report missing from TASK_LOG.md.";
            if (mode === "strict" || mode === "locked") throw new Error(msg);
            logAuditEntry({ event: "docs_consistency_advisory", agent, filePath: fp, taskId, detail: msg });
          }
        } catch (_e) { /* skip */ }
      }
    }
  }

  // Plugin integrity check
  const integrityResult = checkPluginIntegrity();
  if (!integrityResult.valid) {
    if (mode === "strict" || mode === "locked") throw new Error(`[FW-ENFORCE] Plugin integrity violation: ${integrityResult.detail}`);
    logAuditEntry({ event: "silent_audit", detail: `[FW-ENFORCE][WARN][${mode}] Plugin integrity: ${integrityResult.detail}` });
  }

  // DAG coverage check
  if (taskId) {
    const taskCheck = findTaskInDag(taskId);
    if (!taskCheck.found) violations.push(`[FW-ENFORCE] Task "${taskId}" not found in Task.DAG.json`);
    else if (taskCheck.status !== "pending" && taskCheck.status !== "in_progress") violations.push(`[FW-ENFORCE] Task "${taskId}" has status "${taskCheck.status}"`);
  }

  // Gate armed check
  const EXECUTION_TOOLS = ["write", "edit", "bash"];
  const BOOTSTRAP_TOOLS = ["compliance_gate_check", "compliance_gate_confirm", "compliance_gate_complete"];
  if (EXECUTION_TOOLS.includes(tool) && !BOOTSTRAP_TOOLS.includes(tool)) {
    const armedCheck = findArmedSession();
    if (!armedCheck.found && mode !== "advisory") violations.push(`[FW-ENFORCE] No armed compliance gate session found (mode: ${mode}).`);
  }
  if (tool === "task" && !BOOTSTRAP_TOOLS.includes(tool)) {
    const anySession = findAnyGateSession();
    if (!anySession.found && mode !== "advisory") violations.push(`[FW-ENFORCE] No active compliance gate session found.`);
  }

  // Write scope check
  if ((tool === "write" || tool === "edit") && agent) {
    const fp = (output.args?.filePath as string) || "";
    if (fp && !isWriteAllowed(agent, fp) && (mode === "strict" || mode === "locked")) {
      violations.push(`[FW-ENFORCE] Agent "${agent}" write to "${fp}" blocked by agent_write_scopes.`);
    }
  }

  // Enforcement mode guard
  if ((mode === "locked" || mode === "strict") && tool === "write" && (output.args?.filePath as string || "").includes(".opencode/project.config.json")) {
    try {
      const newContent = output.args?.content as string;
      if (newContent) {
        const parsed = JSON.parse(newContent);
        const newMode = parsed?.template_resolution?.develop_enforcement_mode || parsed?.template_resolution?.runtime_enforcement_mode;
        if (newMode && newMode !== mode) violations.push(`[FW-ENFORCE] Blocked enforcement_mode change from "${mode}" to "${newMode}".`);
      }
    } catch { /* best-effort */ }
  }

  // TDD enforcement
  if ((tool === "write" || tool === "edit") && taskId) {
    const fp = (output.args?.filePath as string) || "";
    if (fp && isSourceFile(fp) && !fp.includes("test/") && !fp.includes("__tests__/") && !fp.includes(".spec.") && !fp.includes(".test.")) {
      const msg = `[FW-ENFORCE] TDD violation: writing to "${fp}" without prior test changes`;
      if (mode === "advisory") logAuditEntry({ event: "tdd_violation_advisory", message: msg });
      else violations.push(msg);
    }
  }

  // Dangerous bash command audit
  if (tool === "bash") {
    const cmd = (output.args?.command as string) || "";
    if (/rm\s+.*\.opencode|mv\s+.*\.opencode|chmod\s+.*777|>\s*\.opencode|sudo\s+rm/i.test(cmd)) {
      if (mode !== "advisory") violations.push(`[FW-ENFORCE] Dangerous bash command blocked.`);
      else logAuditEntry({ event: "dangerous_bash_advisory", command: cmd.slice(0, 80) });
    }
  }

  // Scope escalation detection
  if ((tool === "write" || tool === "edit") && ((output.args?.filePath as string) || "").includes("project.config.json")) {
    try {
      const oldConfig = readJsonFile<any>(STATE_PATHS.projectConfig());
      const newContent = output.args?.content as string;
      if (newContent) {
        const newConfig = JSON.parse(newContent);
        const oldScopes = oldConfig?.agent_write_scopes || {};
        const newScopes = newConfig.agent_write_scopes || {};
        for (const agentKey of Object.keys(newScopes)) {
          const oldAllowed = oldScopes[agentKey]?.allowed || [];
          const newAllowed = newScopes[agentKey]?.allowed || [];
          if (newAllowed.length > oldAllowed.length) {
            const msg = `[FW-ENFORCE] Scope escalation: "${agentKey}" scopes grew from ${oldAllowed.length} to ${newAllowed.length}`;
            if (mode !== "advisory") violations.push(msg);
            else logAuditEntry({ event: "scope_escalation_advisory", message: msg });
          }
        }
      }
    } catch { /* best-effort */ }
  }

  // Rule registry integrity
  const registryCheck = checkRuleRegistryIntegrity(STATE_PATHS);
  for (const m of registryCheck.mismatches) {
    logAuditEntry({ event: "silent_audit", detail: `[FW-ENFORCE][REGISTRY] Mismatch: ${m.file}${m.error ? " (" + m.error + ")" : ""}` });
  }
  if (!registryCheck.valid && mode !== "advisory") violations.push(`[FW-ENFORCE] Rule registry has ${registryCheck.mismatches.length} mismatches.`);

  // Machine cleanliness
  const machineCheck = checkMachineCleanliness(STATE_PATHS);
  if (!machineCheck.clean && mode !== "advisory") violations.push(`[FW-ENFORCE] Machine.json dirty: ${machineCheck.dirty.join(", ")}`);

  if (violations.length > 0) {
    if (mode === "advisory") { logAuditEntry({ event: "violations_advisory", violations: violations.join("; ") }); return; }
    throw new Error(`Framework enforcement blocked tool "${tool}": ${violations.join("; ")}`);
  }
}

export async function toolExecuteAfter(
  input: { tool: string; sessionID: string; callID: string; args: any },
  output: { title: string; output: string; metadata: any },
): Promise<void> {
  const tool = input.tool;
  const agent = process.env.FRAMEWORK_AGENT || "";
  const taskId = process.env.FRAMEWORK_TASK_ID || "";
  const filePath = process.env.FRAMEWORK_FILE_PATH || "";

  // (a) Write audit log entry
  writeAuditLogEntry({
    timestamp: new Date().toISOString(), tool, agent, sessionID: input.sessionID,
    callID: input.callID, taskId, filePath,
    action: tool === "write" || tool === "edit" ? "modify" : "execute",
    result: output?.output !== undefined ? "success" : "completed",
  });

  // (b) Detect stale gate sessions
  try {
    const gate = readJsonFile<any>(STATE_PATHS.gateState());
    if (gate?.sessions) {
      for (const stale of Object.values(gate.sessions).filter(isStaleSession)) {
        writeAuditLogEntry({ event: "stale_session_detected", session_id: (stale as any).session_id, confirmed_at: (stale as any).confirmed_at, hours_stale: ((Date.now() - new Date((stale as any).confirmed_at!).getTime()) / 3600000).toFixed(1) });
      }
    }
  } catch { /* best-effort */ }

  // (c) Auto-drain stale sessions
  const staleResult = checkStaleSessions(STATE_PATHS);
  if (staleResult.count > 0) {
    const drained = autoDrainStaleSessions(STATE_PATHS);
    if (drained > 0) writeAuditLogEntry({ event: "auto_drain", count: drained });
  }

  // (d) Trigger state reconciliation on write/edit
  const mode = getEnforcementMode();
  if ((tool === "write" || tool === "edit") && isSourceFile(filePath) && (mode === "strict" || mode === "locked")) {
    try {
      const machinePath = STATE_PATHS.machine();
      const machine = readJsonFile<any>(machinePath);
      if (machine) {
        machine.eslint_state = machine.eslint_state || { aggregate: { dirty_modules: [] } };
        machine.eslint_state.aggregate.dirty_modules = machine.eslint_state.aggregate.dirty_modules || [];
        fs.writeFileSync(machinePath, JSON.stringify(machine, null, 2));
      }
    } catch { /* best-effort */ }
    process.env.FRAMEWORK_PENDING_FULLSCAN = "true";
  }

  // (e) Auto-trigger Write-Time Audit
  if ((tool === "write" || tool === "edit" || tool === "safe_edit") && filePath) {
    const srcPattern = /\.(ts|tsx|js|jsx|html|scss|prisma)$/;
    const skipPattern = /(\.md$|\.json$|\.yaml$|\.yml$|\.task_temp\/)/;
    if (srcPattern.test(filePath) && !skipPattern.test(filePath)) {
      const now = Date.now();
      if (now - _lastWriteCheckTime > WRITE_CHECK_DEBOUNCE_MS) {
        if (_pendingWriteChecks.length > 0) { _executeWriteAuditCheck(_pendingWriteChecks, agent, taskId); _pendingWriteChecks = []; }
        _lastWriteCheckTime = now;
        _executeWriteAuditCheck([filePath], agent, taskId);
      } else { _pendingWriteChecks.push(filePath); }
    }
  }

  // Orchestrator behavior audit
  if ((agent === "Orchestrator" || agent === "@Orchestrator") && tool !== "task" && tool !== "read" && tool !== "todowrite") {
    logAuditEntry({ event: "orchestrator_violation_attempt", tool, message: `Orchestrator attempted non-scheduling tool "${tool}" and was blocked by DISPATCH GATE` });
  }
}

function _executeWriteAuditCheck(files: string[], agent: string, taskId: string): void {
  const mode = getEnforcementMode();
  const machinePath = STATE_PATHS.machine();
  try {
    const machine = readJsonFile<any>(machinePath);
    if (!machine) return;

    machine.write_audit_state = machine.write_audit_state || { enabled: true, current_session: null, history: [] };
    machine.eslint_state = machine.eslint_state || { aggregate: { dirty_modules: [], total_violations: 0, waived_modules: [] } };
    machine.type_check_state = machine.type_check_state || { status: "clean", dirty_files: [], incremental_errors: 0 };
    machine.dependency_state = machine.dependency_state || { status: "clean", violations: [] };
    machine.format_state = machine.format_state || { status: "clean", unformatted_files: [] };

    const writeAudit = machine.write_audit_state;
    writeAudit.current_session = writeAudit.current_session || { agent, task_id: taskId || "unknown", files_written: [], checks_run: 0, checks_passed: 0, checks_failed: 0, violations_found: 0, violations_resolved: 0, scope_violations_attempted: 0 };
    const session = writeAudit.current_session;

    for (const file of files) {
      if (!/\.(ts|tsx|js|jsx|html|scss|prisma)$/.test(file)) continue;
      if (/\.task_temp\//.test(file)) continue;
      session.files_written.push(file); session.checks_run++;

      const scopeAllowed = isWriteAllowed(agent, file);
      if (!scopeAllowed) {
        session.scope_violations_attempted++; session.checks_failed++; session.violations_found++;
        const msg = `[FW-ENFORCE] Write-Audit: Agent "${agent}" scope violation writing to "${file}"`;
        if (mode === "strict" || mode === "locked") {
          logAuditEntry({ event: "write_audit_scope_blocked", agent, file, mode });
          throw new Error(`${msg} (mode: ${mode}). Revert the change.`);
        }
        logAuditEntry({ event: "write_audit_scope_warning", agent, file, mode });
      } else { session.checks_passed++; }

      const moduleMatch = file.match(/modules\/([^/]+)/);
      const moduleName = moduleMatch ? moduleMatch[1] : file.replace(/\//g, "_");
      if (!machine.eslint_state.modules) machine.eslint_state.modules = {};
      if (!machine.eslint_state.modules[moduleName]) machine.eslint_state.modules[moduleName] = { status: "dirty", violations: [], last_check: new Date().toISOString(), waivers_applied: [] };
      if (!machine.eslint_state.aggregate.dirty_modules.includes(moduleName)) machine.eslint_state.aggregate.dirty_modules.push(moduleName);
      machine.type_check_state.status = "dirty";
      if (!machine.type_check_state.dirty_files.includes(file)) machine.type_check_state.dirty_files.push(file);
      if (!machine.format_state.unformatted_files.includes(file)) { machine.format_state.unformatted_files.push(file); machine.format_state.status = "dirty"; }
      if (!machine.dependency_state.violations.some((v: any) => v.file === file)) machine.dependency_state.violations.push({ file, message: "pending depcruiser check", severity: "info" });
    }

    fs.writeFileSync(machinePath, JSON.stringify(machine, null, 2));

    // Attempt full quality checks via code-quality-lib
    try {
      const _require = createRequire(import.meta.url);
      const cql = _require("../../scripts/mcp-tools/code-quality-lib.js");
      const projectRoot = path.resolve(getOpenCodeRoot(), (readJsonFile<any>(STATE_PATHS.projectConfig())?.project_root || "."));
      const results = cql.runAllChecks(files[files.length - 1], projectRoot, agent, taskId, { auto_fix: mode !== "locked", skip_checks: [] });
      const updatedMachine = readJsonFile<any>(machinePath);
      if (updatedMachine) {
        updatedMachine.write_audit_state.current_session = session;
        if (results.checks.eslint?.pass) {
          const m = updatedMachine.eslint_state;
          if (m?.aggregate?.dirty_modules) {
            m.aggregate.dirty_modules = m.aggregate.dirty_modules.filter((d: string) => d !== moduleName);
          }
        }
        fs.writeFileSync(machinePath, JSON.stringify(updatedMachine, null, 2));
      }
    } catch { /* code-quality-lib not available */ }
  } catch (err: any) {
    if (err.message?.includes("scope violation")) throw err;
    try { logAuditEntry({ event: "write_audit_error", error: err.message?.slice(0, 200) }); } catch { /* silent */ }
  }
}
