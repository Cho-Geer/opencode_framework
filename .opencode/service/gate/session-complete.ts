// service/gate/session-complete.ts — Gate session completion and artifact validation
// Split from session-crud.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { readSubState } from "../../lib/substate-manager";
import {
  getProjectRoot,
  fileExists,
  loadGateStore,
  saveGateStore,
  logGateStatusTransition,
  type GateCompleteResult,
} from "./store";
import { shouldBlock } from "../enforcement/rule-disposition";

const SRC = "service-gate-complete";

// ════════════════════════════════════════════════
// TASK ARTIFACT VALIDATION
// ════════════════════════════════════════════════

function scanSubdirForArtifact(baseDir: string, artifact: string): boolean {
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (fileExists(path.join(baseDir, entry.name, artifact))) return true;
      }
    }
  } catch {
    // Directory doesn't exist or is inaccessible
  }
  return false;
}

export function validateTaskArtifacts(
  taskId: string | null,
  root?: string,
  gateSessionId?: string | null,
): string[] {
  const resolvedId = taskId || gateSessionId;
  if (!resolvedId) return [];
  const projectRoot = root || getProjectRoot();
  const taskDir = path.join(projectRoot, ".task_temp", resolvedId);
  const missing: string[] = [];

  if (!fileExists(path.join(taskDir, "HANDOVER.md"))) {
    if (!scanSubdirForArtifact(taskDir, "HANDOVER.md")) {
      missing.push("HANDOVER.md");
    }
  }

  if (!fileExists(path.join(taskDir, "TASK_LOG.md"))) {
    if (!scanSubdirForArtifact(taskDir, "TASK_LOG.md")) {
      missing.push("TASK_LOG.md");
    }
  }

  return missing;
}

// ════════════════════════════════════════════════
// COMPLETE SESSION
// ════════════════════════════════════════════════

export function completeGateSession(
  gateSessionId: string,
  executionSummary: string,
  root?: string,
): GateCompleteResult {
  const store = loadGateStore(root);
  const session = gateSessionId ? store.sessions[gateSessionId] : undefined;

  if (!session) {
    return {
      status: "rejected",
      reason: `session not found: ${gateSessionId || "(missing)"}.`,
    };
  }

  if (session.approval_required) {
    if (session.gate_status !== "approved") {
      let guidance = "";
      if (session.gate_status === "armed") {
        guidance =
          "Must call submitDeliverables first, then wait for Orchestrator approval.";
      } else if (session.gate_status === "delivered") {
        guidance = "Awaiting Orchestrator approval.";
      } else {
        guidance = "Must call compliance_gate_confirm first.";
      }
      return {
        status: "rejected",
        reason: `session ${gateSessionId} requires Orchestrator approval (status: ${session.gate_status}). ${guidance}`,
      };
    }
  } else {
    if (session.gate_status !== "armed") {
      return {
        status: "rejected",
        reason: `session ${gateSessionId} is not armed (status: ${session.gate_status}).`,
      };
    }
  }

  if (session.consumed_at) {
    return {
      status: "rejected",
      reason: `session ${gateSessionId} already completed at ${session.consumed_at}.`,
    };
  }

  let eslintFailed = false;
  let dirtyModules: string[] = [];

  try {
    const eslintState = readSubState("eslint_state");
    if (eslintState?.aggregate?.dirty_modules && eslintState.aggregate.dirty_modules.length > 0) {
      dirtyModules = eslintState.aggregate.dirty_modules;
      eslintFailed = true;
    }
  } catch {
    // Non-blocking
  }

  if (eslintFailed && shouldBlock("session-complete-check")) {
    const now = new Date().toISOString();
    logGateStatusTransition(gateSessionId, session.gate_status, "failed", {
      source: "completeGateSession",
      agent: session.agent,
    });
    session.gate_status = "failed";
    session.consumed_at = now;
    session.fail_reason =
      "ESLint mock-audit violations found in modules: " +
      dirtyModules.join(", ");
    store.active_sessions = store.active_sessions.filter(
      (sid) => sid !== gateSessionId,
    );
    store.last_updated = new Date().toISOString();
    saveGateStore(store, root);
    return {
      status: "failed",
      reason:
        "CAT3.7: ESLint mock-audit violations in modules: " +
        dirtyModules.join(", "),
      dirty_modules: dirtyModules,
    };
  }

  const missing = validateTaskArtifacts(
    session.task_id || null,
    root,
    gateSessionId,
  );
  if (missing.length > 0 && shouldBlock("session-complete-check")) {
    const now = new Date().toISOString();
    logGateStatusTransition(gateSessionId, session.gate_status, "failed", {
      source: "completeGateSession",
      agent: session.agent,
    });
    session.gate_status = "failed";
    session.consumed_at = now;
    session.fail_reason =
      "Missing required task artifacts: " + missing.join(", ");
    session.missing_artifacts = missing;
    store.active_sessions = store.active_sessions.filter(
      (sid) => sid !== gateSessionId,
    );
    store.last_updated = new Date().toISOString();
    saveGateStore(store, root);
    return {
      status: "failed",
      reason: "Missing required task artifacts: " + missing.join(", "),
      missing_artifacts: missing,
    };
  }

  // Success
  const now = new Date().toISOString();
  logGateStatusTransition(gateSessionId, session.gate_status, "completed", {
    source: "completeGateSession",
    agent: session.agent,
  });
  session.gate_status = "completed";
  session.consumed_at = now;
  session.audit = {
    execution_summary: (executionSummary || "").substring(0, 1000),
    completed_at: now,
  };

  if (!Array.isArray(store.audit_history)) {
    store.audit_history = [];
  }
  store.audit_history.push({
    session_id: gateSessionId,
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

  store.active_sessions = store.active_sessions.filter(
    (sid) => sid !== gateSessionId,
  );
  store.last_updated = now;
  saveGateStore(store, root);

  return {
    status: "completed",
    audit: {
      session_id: gateSessionId,
      task_description: session.task_description,
      plan_summary: session.plan_summary,
      confirmed_at: session.confirmed_at,
      consumed_at: now,
      execution_summary: session.audit.execution_summary,
      audit_history_count: store.audit_history.length,
    },
  };
}
