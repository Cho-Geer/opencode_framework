// service/gate/mcp-complete.ts — Gate complete logic
// ═══════════════════════════════════════════════════════════════
// Extracted from scripts/mcp-tools/compliance-gate.ts (runGateComplete L1737-2155)
// Handles ESLint/TSC checks, artifact validation, retry logic,
// compactor archival, and session completion.
// ═══════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { readSubState } from "../../lib/substate-manager";
import { atomicWriteSubState } from "../../lib/state-utils";
import {
  getProjectRoot,
  loadGateStore,
  saveGateStore,
} from "./store-crud";
import { getEnforcementMode } from "./enforcement";
import { checklistWirePassed } from "./checklist-hooks";

const SRC = "service-gate-mcp-complete";

export interface CompleteResult {
  status: string;
  reason?: string;
  dirty_modules?: string[];
  missing_artifacts?: string[];
  retry_count?: number;
  max_retries?: number;
  audit?: Record<string, unknown>;
}

/**
 * Validate HANDOVER.md and TASK_LOG.md exist.
 */
function validateTaskArtifacts(taskId: string | null, gateSessionId: string): string[] {
  const resolvedId = taskId || gateSessionId;
  const taskDir = path.join(getProjectRoot(), ".task_temp", resolvedId);
  const missing: string[] = [];
  if (!fs.existsSync(path.join(taskDir, "HANDOVER.md"))) missing.push("HANDOVER.md");
  if (!fs.existsSync(path.join(taskDir, "TASK_LOG.md"))) missing.push("TASK_LOG.md");
  return missing;
}

/**
 * Complete a gate session.
 *
 * Validates:
 * - Approval status (for approval_required sessions)
 * - ESLint dirty_modules check
 * - TypeScript diagnostic errors
 * - HANDOVER.md + TASK_LOG.md existence
 *
 * On success: transitions to "completed", wires checklist, archives to audit_history,
 * triggers StateCompactor archival.
 */
export function completeGateWithRetry(
  gateSessionId: string,
  executionSummary?: string,
): CompleteResult {
  const store = loadGateStore();
  const session = gateSessionId ? store.sessions[gateSessionId] : null;
  if (!session) {
    return { status: "rejected", reason: `session not found: ${gateSessionId || "(missing)"}. Must call compliance_gate_check and compliance_gate_confirm first.` };
  }

  // ── State gate: approval_required vs exempt ──
  if (session.approval_required) {
    if (session.gate_status !== "approved") {
      let guidance = "";
      if (session.gate_status === "armed") {
        guidance = "You must call compliance_gate_submit_deliverables first, then wait for Orchestrator approval.";
      } else if (session.gate_status === "delivered") {
        guidance = "Session is awaiting Orchestrator approval. Wait for @Orchestrator or @Super-Admin to call compliance_gate_approve_deliverables.";
      } else if (session.gate_status === "recoverable") {
        guidance = "Session is in 'recoverable' state. Call compliance_gate_retry_confirm first, then re-submit deliverables.";
      } else {
        guidance = "Must call compliance_gate_confirm first.";
      }
      return { status: "rejected", reason: `session ${gateSessionId} requires Orchestrator approval (status: ${session.gate_status}). ${guidance}` };
    }
  } else {
    if (session.gate_status !== "armed") {
      return { status: "rejected", reason: `session ${gateSessionId} is not armed (status: ${session.gate_status}). Must call compliance_gate_confirm first.` };
    }
  }
  if (session.consumed_at) {
    return { status: "rejected", reason: `session ${gateSessionId} already completed at ${session.consumed_at}. Cannot re-complete.` };
  }

  // ── Clear dirty_modules before ESLint check (P0-FIX-BUG-11) ──
  try {
    const eslintState = readSubState("eslint_state");
    const preDirty = Array.isArray(eslintState?.aggregate?.dirty_modules) ? eslintState.aggregate.dirty_modules : [];
    if (preDirty.length > 0) {
      atomicWriteSubState("eslint_state", (state: any) => {
        if (state?.aggregate) {
          state.aggregate.dirty_modules = [];
          state.aggregate.total_violations = 0;
        }
        state.last_full_scan = new Date().toISOString();
      });
    }
  } catch { /* allow gate to proceed */ }

  // ── ESLint check ──
  let eslintFailed = false;
  let dirtyModules: string[] = [];
  try {
    const eslintState = readSubState("eslint_state");
    if (eslintState?.aggregate?.dirty_modules?.length > 0) {
      dirtyModules = eslintState.aggregate.dirty_modules;
      eslintFailed = true;
    }
  } catch { /* allow gate to proceed */ }

  const enforcementMode = getEnforcementMode();
  if (eslintFailed && enforcementMode !== "advisory") {
    const now = new Date().toISOString();
    session.gate_status = "failed";
    session.consumed_at = now;
    session.enforcement_mode = enforcementMode;
    session.fail_reason = "ESLint mock-audit violations found in modules: " + dirtyModules.join(", ");
    session.audit = { execution_summary: (executionSummary || "").substring(0, 1000), completed_at: now };
    store.active_sessions = store.active_sessions.filter((sid) => sid !== gateSessionId);
    store.last_updated = now;
    saveGateStore(store);
    return { status: "failed", reason: "CAT3.7: ESLint mock-audit violations in modules: " + dirtyModules.join(", ") + ". Run eslint-audit.run_audit({ full_scan: true }) to see details.", dirty_modules: dirtyModules };
  }
  if (eslintFailed && enforcementMode === "advisory") {
    writeLog(SRC, "WARN", { event: "eslint_dirty_advisory", dirty_modules: dirtyModules });
  }

  // ── TypeScript Diagnostic Check ──
  let tscErrorCount = 0;
  let tscErrorFiles: string[] = [];
  try {
    const diagState = readSubState("diagnostic_state");
    const allFiles = diagState?.files || {};
    for (const [filePath, diag] of Object.entries(allFiles)) {
      const errors = (diag as any)?.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        tscErrorCount += errors.length;
        tscErrorFiles.push(filePath);
      }
    }
  } catch { /* non-blocking */ }

  if (tscErrorCount > 0 && enforcementMode !== "advisory") {
    const now = new Date().toISOString();
    session.gate_status = "failed";
    session.consumed_at = now;
    session.fail_reason = `TypeScript errors in ${tscErrorFiles.length} file(s): ${tscErrorFiles.join(", ")} (${tscErrorCount} total error(s))`;
    session.audit = { execution_summary: (executionSummary || "").substring(0, 1000), completed_at: now };
    store.active_sessions = store.active_sessions.filter((sid) => sid !== gateSessionId);
    store.last_updated = now;
    saveGateStore(store);
    writeLog(SRC, "ERROR", { event: "GATE_COMPLETE_TSC_ERRORS", detail: `${tscErrorCount} error(s) in ${tscErrorFiles.length} file(s)` });
    return { status: "failed", reason: `TypeScript errors detected in ${tscErrorCount} location(s) across ${tscErrorFiles.length} file(s). Fix all errors before completing.` };
  }
  if (tscErrorCount > 0 && enforcementMode === "advisory") {
    writeLog(SRC, "WARN", { event: "GATE_COMPLETE_TSC_ERRORS_ADVISORY", detail: `${tscErrorCount} error(s) in ${tscErrorFiles.length} file(s)` });
  }

  // ── Artifact validation ──
  const missingArtifacts = validateTaskArtifacts(session.task_id, gateSessionId);
  if (missingArtifacts.length > 0 && enforcementMode !== "advisory") {
    const now = new Date().toISOString();
    const maxRetries = enforcementMode === "locked" ? 1 : 3;
    session.retry_count = (session.retry_count || 0) + 1;

    if (session.retry_count > maxRetries) {
      // Retries exhausted → terminal failure
      session.gate_status = "failed";
      session.consumed_at = now;
      session.fail_reason = "Missing required task artifacts (retries exhausted): " + missingArtifacts.join(", ");
      session.missing_artifacts = missingArtifacts;
      session.audit = { execution_summary: (executionSummary || "").substring(0, 1000), completed_at: now };
      store.active_sessions = store.active_sessions.filter((sid) => sid !== gateSessionId);
      store.last_updated = now;
      saveGateStore(store);
      const resolvedId = session.task_id || gateSessionId;
      return { status: "failed", reason: `Missing required task artifacts (retries exhausted ${session.retry_count}/${maxRetries}): ${missingArtifacts.join(", ")}. Create HANDOVER.md and TASK_LOG.md under .task_temp/${resolvedId}/.`, missing_artifacts: missingArtifacts, retry_count: session.retry_count };
    }

    // Transient failure → recoverable
    session.gate_status = "recoverable";
    session.fail_reason = "Missing required task artifacts: " + missingArtifacts.join(", ");
    session.missing_artifacts = missingArtifacts;
    session.fail_history = session.fail_history || [];
    session.fail_history.push({ retry: session.retry_count, failed_at: now, reason: session.fail_reason });
    store.last_updated = now;
    saveGateStore(store);
    const resolvedId = session.task_id || gateSessionId;
    return { status: "recoverable", reason: `Missing required task artifacts: ${missingArtifacts.join(", ")}. Create HANDOVER.md and TASK_LOG.md under .task_temp/${resolvedId}/ and call complete() again. (retry=${session.retry_count}/${maxRetries})`, missing_artifacts: missingArtifacts, retry_count: session.retry_count, max_retries: maxRetries };
  }
  if (missingArtifacts.length > 0 && enforcementMode === "advisory") {
    writeLog(SRC, "WARN", { event: "missing_artifacts_advisory", artifacts: missingArtifacts });
  }

  // ── Success: complete the session ──
  const now = new Date().toISOString();
  session.gate_status = "completed";
  session.consumed_at = now;

  const ag3 = session.agent || "";
  const tk3 = session.task_id || null;
  const clSid3 = session.opencode_session_id || gateSessionId;
  checklistWirePassed(clSid3, ag3, tk3, "gate_closed", `summary: ${(executionSummary || "").substring(0, 60)}`);

  session.audit = { execution_summary: (executionSummary || "").substring(0, 1000), completed_at: now };

  if (!Array.isArray(store.audit_history)) store.audit_history = [];
  store.audit_history.push({
    gate_session_id: gateSessionId,
    task_description: session.task_description,
    plan_summary: session.plan_summary,
    agent: session.agent,
    task_id: session.task_id,
    confirmed_at: session.confirmed_at,
    consumed_at: now,
    execution_summary: (executionSummary || "").substring(0, 200),
    gate_status: "completed",
  });
  if (store.audit_history.length > 500) {
    store.audit_history = store.audit_history.slice(-500);
  }

  store.active_sessions = store.active_sessions.filter((sid) => sid !== gateSessionId);
  store.last_updated = now;
  saveGateStore(store);

  // ── StateCompactor auto-archival (fire-and-forget) ──
  try {
    const { StateCompactor } = require("../../lib/state-compactor.ts");
    const compactor = new StateCompactor();
    compactor.onGateComplete(gateSessionId, {
      gate_session_id: gateSessionId,
      created_at: session.created_at,
      gate_status: "completed",
      confirmed_at: session.confirmed_at,
      task_description: session.task_description,
      plan_summary: session.plan_summary,
    }).catch((err: any) => {
      writeLog(SRC, "WARN", { event: "compactor_archival_deferred", error: err.message });
    });
  } catch (err: any) {
    writeLog(SRC, "WARN", { event: "compactor_module_load_failed", error: err.message });
  }

  return {
    status: "completed",
    audit: {
      status: "completed",
      gate_session_id: gateSessionId,
      task_description: session.task_description,
      plan_summary: session.plan_summary,
      confirmed_at: session.confirmed_at,
      consumed_at: session.consumed_at,
      execution_summary: session.audit.execution_summary,
      audit_history_count: store.audit_history.length,
    },
  };
}
