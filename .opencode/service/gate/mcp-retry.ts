// service/gate/mcp-retry.ts — Gate retry confirm logic
// ═══════════════════════════════════════════════════════════════
// Extracted from scripts/mcp-tools/compliance-gate.ts (runGateRetryConfirm)
// Handles two paths: recoverable (self-repair) and failed (supervisory retry)
// ═══════════════════════════════════════════════════════════════

import { writeLog } from "../../lib/log-manager";
import { loadGateStore, saveGateStore } from "./store-crud";

const SRC = "service-gate-retry";

const ALLOWED_RETRY_AGENTS = [
  "@Super-Admin",
  "@Orchestrator",
  "Super-Admin",
  "Orchestrator",
];

export interface RetryConfirmResult {
  status: string;
  gate_session_id?: string;
  retry_count?: number;
  reason?: string;
}

/**
 * Retry a gate session confirmation.
 *
 * Two paths:
 * - recoverable: ANY agent can self-repair (no permission check)
 * - failed: Only @Super-Admin/@Orchestrator (supervisory retry),
 *   and only for "Missing required task artifacts" failures
 */
export function retryConfirmGateSession(
  gateSessionId: string,
  planSummary: string,
  taskId?: string,
  agentId?: string,
): RetryConfirmResult {
  if (!gateSessionId) {
    return { status: "rejected", reason: "session_id required" };
  }
  if (!planSummary || planSummary.trim().length < 10) {
    return { status: "rejected", reason: "plan_summary min 10 chars" };
  }

  const store = loadGateStore();
  const session = store.sessions[gateSessionId];
  if (!session) {
    return { status: "rejected", reason: `session ${gateSessionId} not found` };
  }

  const resolvedAgent = (agentId || session.agent || "").replace(/^@/, "");

  // ── Recoverable: self-repair path (any agent allowed) ──
  if (session.gate_status === "recoverable") {
    session.gate_status = "armed";
    session.plan_summary = planSummary.trim();
    session.task_id = taskId || session.task_id || null;
    session.retry_count = (session.retry_count || 0) + 1;
    session.fail_history = session.fail_history || [];
    session.fail_history.push({
      retry: 0,
      failed_at: new Date().toISOString(),
      reason: "parent session: " + planSummary.trim().slice(0, 180),
    });
    session.confirmed_at = new Date().toISOString();
    session.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    session.consumed_at = null;
    session.fail_reason = null;
    session.missing_artifacts = null;
    if (!store.active_sessions.includes(gateSessionId)) {
      store.active_sessions.push(gateSessionId);
    }
    store.last_updated = new Date().toISOString();
    saveGateStore(store);

    writeLog(SRC, "INFO", {
      event: "RETRY-SUPERVISORY",
      detail: `session=${gateSessionId} agent=${resolvedAgent}`,
    });

    return {
      status: "armed",
      gate_session_id: gateSessionId,
      retry_count: session.retry_count,
    };
  }

  return {
    status: "rejected",
    reason: `Session in state "${session.gate_status}" — must be "recoverable" or "failed".`,
  };
}
