// write-audit-lib.ts — Write-time audit check (lib)
import { getEnforcementMode } from "./gate-core";
import { atomicWriteSubState } from "./state-utils";
import { isWriteAllowed } from "./gate-checks";
import { logAuditEntry } from "./audit-log";
import { writeLog } from "./log-manager";

const SRC = "lib-write-audit-lib";

export function executeWriteAuditCheck(
  files: string[],
  agent: string,
  taskId: string,
): void {
  const mode = getEnforcementMode();

  // Collect changes in memory first, then write each sub-state sequentially
  let writeAuditChanges: any = null;
  let eslintChanges: any = null;
  let typeCheckChanges: any = null;
  let dependencyChanges: any = null;
  let formatChanges: any = null;
  let hasScopeViolation = false;
  let violationMessage = "";

  // Phase 1: Compute all changes in memory
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
    eslintModules[moduleName] = {
      status: "dirty", violations: [], last_check: new Date().toISOString(), waivers_applied: [],
    };
    dirtyModulesSet.add(moduleName);
    dirtyFilesSet.add(file);
    unformattedFilesSet.add(file);
    dependencyViolations.push({
      file, message: "pending depcruiser check", severity: "info",
    });
  }

  // Throw early if scope violation in strict/locked mode
  if (hasScopeViolation) {
    throw new Error(`${violationMessage} (mode: ${mode}). Revert the change.`);
  }

  // Phase 2: Write each sub-state sequentially
  // 1. write_audit_state
  let ok = atomicWriteSubState("write_audit_state", (state) => {
    state.enabled = state.enabled ?? true;
    state.current_session = state.current_session || { ...sessionData };
    state.history = state.history || [];
    // Merge new session data
    const sess = state.current_session;
    sess.files_written.push(...sessionData.files_written);
    sess.checks_run += sessionData.checks_run;
    sess.checks_passed += sessionData.checks_passed;
    sess.checks_failed += sessionData.checks_failed;
    sess.violations_found += sessionData.violations_found;
    sess.scope_violations_attempted += sessionData.scope_violations_attempted;
  });
  if (!ok) writeLog(SRC, "ERROR", { event: "SUBSTATE-WRITE-FAILED", detail: "write_audit_state" });

  // 2. eslint_state
  ok = atomicWriteSubState("eslint_state", (state) => {
    state.aggregate = state.aggregate || { dirty_modules: [], total_violations: 0, waived_modules: [] };
    state.modules = state.modules || {};
    // Merge eslint module changes
    for (const [moduleName, moduleData] of Object.entries(eslintModules)) {
      if (!state.modules[moduleName]) {
        state.modules[moduleName] = moduleData;
      }
    }
    // Merge dirty_modules
    for (const moduleName of dirtyModulesSet) {
      if (!state.aggregate.dirty_modules.includes(moduleName)) {
        state.aggregate.dirty_modules.push(moduleName);
      }
    }
  });
  if (!ok) writeLog(SRC, "ERROR", { event: "SUBSTATE-WRITE-FAILED", detail: "eslint_state" });

  // 3. type_check_state
  ok = atomicWriteSubState("type_check_state", (state) => {
    state.status = "dirty";
    state.dirty_files = state.dirty_files || [];
    for (const file of dirtyFilesSet) {
      if (!state.dirty_files.includes(file)) {
        state.dirty_files.push(file);
      }
    }
  });
  if (!ok) writeLog(SRC, "ERROR", { event: "SUBSTATE-WRITE-FAILED", detail: "type_check_state" });

  // 4. format_state
  ok = atomicWriteSubState("format_state", (state) => {
    state.status = "dirty";
    state.unformatted_files = state.unformatted_files || [];
    for (const file of unformattedFilesSet) {
      if (!state.unformatted_files.includes(file)) {
        state.unformatted_files.push(file);
      }
    }
  });
  if (!ok) writeLog(SRC, "ERROR", { event: "SUBSTATE-WRITE-FAILED", detail: "format_state" });

  // 5. dependency_state
  ok = atomicWriteSubState("dependency_state", (state) => {
    state.violations = state.violations || [];
    for (const violation of dependencyViolations) {
      if (!state.violations.some((v: any) => v.file === violation.file)) {
        state.violations.push(violation);
      }
    }
  });
  if (!ok) writeLog(SRC, "ERROR", { event: "SUBSTATE-WRITE-FAILED", detail: "dependency_state" });
}
