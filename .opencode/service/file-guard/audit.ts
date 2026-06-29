// service/file-guard/audit.ts — Write audit check + audit log
// Source: write-audit-lib.ts + audit-log.ts

import { getEnforcementMode } from "../../lib/gate-core";
import { atomicWriteSubState } from "../../lib/state-utils";
import { isWriteAllowed } from "../../lib/gate-checks";
import { writeLog } from "../../lib/log-manager";
import { dbWriteAuditLogEntry, dbFlushAuditTrail } from "../../lib/db-state-manager";

const SRC = "service-audit";

// ── Audit Log (from audit-log.ts) ──────────────────────────────

export function writeAuditLogEntry(entry: Record<string, unknown>): void {
  try {
    dbWriteAuditLogEntry({
      session_id: (entry.sessionID as string) || undefined,
      agent: (entry.agent as string) || undefined,
      event_type: (entry.event as string) || (entry.eventType as string) || "audit",
      detail: entry,
      timestamp: entry.timestamp ? Date.parse(entry.timestamp as string) : Date.now(),
    });
  } catch { /* DB write failed */ }
}

export function logAuditEntry(entry: Record<string, unknown>): void {
  writeAuditLogEntry({ timestamp: new Date().toISOString(), ...entry, sessionID: (entry.sessionID as string) || "" });
}

export function flushAuditTrail(sessionID: string): void {
  try {
    dbFlushAuditTrail(sessionID, [{ sessionID, flushedAt: new Date().toISOString() }]);
  } catch { /* DB write failed */ }
}

// ── Write Audit Check (from write-audit-lib.ts) ────────────────

export function executeWriteAuditCheck(files: string[], agent: string, taskId: string): void {
  const mode = getEnforcementMode();
  let hasScopeViolation = false;
  let violationMessage = "";

  const sessionData = {
    agent, task_id: taskId || "unknown", files_written: [] as string[],
    checks_run: 0, checks_passed: 0, checks_failed: 0,
    violations_found: 0, violations_resolved: 0, scope_violations_attempted: 0,
  };

  const eslintModules: Record<string, any> = {};
  const dirtyModulesSet = new Set<string>();
  const dirtyFilesSet = new Set<string>();
  const unformattedFilesSet = new Set<string>();
  const dependencyViolations: any[] = [];

  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx|html|scss|prisma)$/.test(file)) continue;
    if (/\.task_temp\//.test(file)) continue;
    sessionData.files_written.push(file);
    sessionData.checks_run++;

    const scopeAllowed = isWriteAllowed(agent, file);
    if (!scopeAllowed) {
      sessionData.scope_violations_attempted++;
      sessionData.checks_failed++;
      sessionData.violations_found++;
      const msg = `[FW-ENFORCE] Write-Audit: Agent "${agent}" scope violation writing to "${file}"`;
      if (mode === "strict" || mode === "locked") {
        logAuditEntry({ event: "write_audit_scope_blocked", agent, file, mode });
        hasScopeViolation = true;
        violationMessage = msg;
        break;
      }
      logAuditEntry({ event: "write_audit_scope_warning", agent, file, mode });
    } else {
      sessionData.checks_passed++;
    }

    const moduleMatch = file.match(/modules\/([^/]+)/);
    const moduleName = moduleMatch ? moduleMatch[1] : file.replace(/\//g, "_");
    eslintModules[moduleName] = { status: "dirty", violations: [], last_check: new Date().toISOString(), waivers_applied: [] };
    dirtyModulesSet.add(moduleName);
    dirtyFilesSet.add(file);
    unformattedFilesSet.add(file);
    dependencyViolations.push({ file, message: "pending depcruiser check", severity: "info" });
  }

  if (hasScopeViolation) {
    throw new Error(`${violationMessage} (mode: ${mode}). Revert the change.`);
  }

  // Write 5 sub-states sequentially
  let ok = atomicWriteSubState("write_audit_state", (state) => {
    state.enabled = state.enabled ?? true;
    state.current_session = state.current_session || { ...sessionData };
    state.history = state.history || [];
    const sess = state.current_session;
    sess.files_written.push(...sessionData.files_written);
    sess.checks_run += sessionData.checks_run;
    sess.checks_passed += sessionData.checks_passed;
    sess.checks_failed += sessionData.checks_failed;
    sess.violations_found += sessionData.violations_found;
    sess.scope_violations_attempted += sessionData.scope_violations_attempted;
  });
  if (!ok) writeLog(SRC, "ERROR", { event: "SUBSTATE-WRITE-FAILED", detail: "write_audit_state" });

  ok = atomicWriteSubState("eslint_state", (state) => {
    state.aggregate = state.aggregate || { dirty_modules: [], total_violations: 0, waived_modules: [] };
    state.modules = state.modules || {};
    for (const [k, v] of Object.entries(eslintModules)) { if (!state.modules[k]) state.modules[k] = v; }
    for (const m of dirtyModulesSet) { if (!state.aggregate.dirty_modules.includes(m)) state.aggregate.dirty_modules.push(m); }
  });
  if (!ok) writeLog(SRC, "ERROR", { event: "SUBSTATE-WRITE-FAILED", detail: "eslint_state" });

  ok = atomicWriteSubState("diagnostic_state", (state) => {
    state.files = state.files || {};
    for (const f of dirtyFilesSet) { if (!state.files[f]) state.files[f] = { errors: [], updated_at: new Date().toISOString() }; }
    state.last_updated = new Date().toISOString();
  });
  if (!ok) writeLog(SRC, "ERROR", { event: "SUBSTATE-WRITE-FAILED", detail: "diagnostic_state" });

  ok = atomicWriteSubState("format_state", (state) => {
    state.status = "dirty";
    state.unformatted_files = state.unformatted_files || [];
    for (const f of unformattedFilesSet) { if (!state.unformatted_files.includes(f)) state.unformatted_files.push(f); }
  });
  if (!ok) writeLog(SRC, "ERROR", { event: "SUBSTATE-WRITE-FAILED", detail: "format_state" });

  ok = atomicWriteSubState("dependency_state", (state) => {
    state.violations = state.violations || [];
    for (const v of dependencyViolations) { if (!state.violations.some((x: any) => x.file === v.file)) state.violations.push(v); }
  });
  if (!ok) writeLog(SRC, "ERROR", { event: "SUBSTATE-WRITE-FAILED", detail: "dependency_state" });
}

// ── Write Audit Trail (from audit-after hook) ─────────────────
// Records each file modification to write_audit_state history.
// Called by audit-after plugin after safe_edit/safe_delete/safe_shell.

export function recordWriteAudit(params: {
  sessionID: string;
  callID: string;
  tool: string;
  filePath: string;
}): void {
  let agent = "unknown";
  try {
    const { resolveAgent } = require("../../lib/agent-resolver");
    agent = resolveAgent(params.sessionID);
  } catch {}

  writeLog("audit-after", "runtime", {
    sessionID: params.sessionID,
    callID: params.callID,
    agent,
    event: "TOOL-AFTER",
    detail: `audit-track | tool=${params.tool} | file=${params.filePath}`,
  });

  try {
    const { atomicWriteSubState } = require("../../lib/state-utils");
    atomicWriteSubState("write_audit_state", (state: any) => {
      state.enabled = state.enabled ?? true;
      state.current_session = state.current_session ?? null;
      state.history = state.history ?? [];
      state.history.push({
        file: params.filePath,
        tool: params.tool,
        agent,
        sessionID: params.sessionID,
        timestamp: new Date().toISOString(),
      });
      if (state.history.length > 200) {
        state.history = state.history.slice(-200);
      }
    });
  } catch (err: any) {
    writeLog("audit-after", "runtime", {
      sessionID: params.sessionID,
      callID: params.callID,
      agent,
      level: "ERROR",
      event: "TOOL-AFTER",
      detail: "audit-state update failed: " + err.message,
    });
  }
}
