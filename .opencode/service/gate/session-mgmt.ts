// service/gate/session-mgmt.ts — Gate session creation and arming
// Split from session-crud.ts

import * as fs from "node:fs";
import * as path from "node:path";
import {
  getProjectRoot,
  loadGateStore,
  saveGateStore,
  generateGateSessionId,
  logGateStatusTransition,
  writeLogSafe,
  type GateSession,
  type GateStore,
  type GateCheckItem,
  type GateConfirmResult,
  type DeliverableEntry,
} from "./store";
import { shouldBlock } from "../enforcement/rule-disposition";

const SRC = "service-gate-session-mgmt";

// ════════════════════════════════════════════════
// SESSION CREATION
// ════════════════════════════════════════════════

export function createGateSession(
  taskDescription: string,
  failedItems: GateCheckItem[],
  ruleStatus: Record<string, string>,
  mode: string = "rule-disposition-compat",
  root?: string,
): { session: GateSession; store: GateStore } {
  const store = loadGateStore(root);
  const gateSessionId = generateGateSessionId();
  const hasHighSeverity = failedItems.some((f) => f.severity === "HIGH");

  const session: GateSession = {
    session_id: gateSessionId,
    created_at: new Date().toISOString(),
    task_description: taskDescription || "",
    enforcement_mode: mode,
    gate_status: "checked",
    last_check_passed: !hasHighSeverity,
    last_check_failed_items: failedItems,
    plan_summary: null,
    confirmed_at: null,
    consumed_at: null,
    audit: null,
  };

  store.sessions[gateSessionId] = session;
  store.last_updated = new Date().toISOString();
  saveGateStore(store, root);

  return { session, store };
}

// ════════════════════════════════════════════════
// ARM (CONFIRM) SESSION
// ════════════════════════════════════════════════

export function armGateSession(
  gateSessionId: string,
  planSummary: string,
  agent?: string,
  taskId?: string,
  root?: string,
  declaredDeliverables?: DeliverableEntry[],
): GateConfirmResult {
  // ── DISPATCH-TASKID-IMMUTABLE: task_id integrity at arm phase ──
  let hasDispatchContext = false;
  let dispatchAssignedTaskIds: string[] = [];
  try {
    if (taskId) {
      const { dbQuerySessionByDagTaskId } = require("../../lib/db-state-manager");
      const sessions = dbQuerySessionByDagTaskId(taskId);
      if (sessions.length > 0) {
        hasDispatchContext = true;
        dispatchAssignedTaskIds = [taskId];
      } else {
        try {
          const { getDb } = require("../../lib/db-manager");
          const db = getDb();
          const anyRegistered = db
            .query(
              `SELECT dag_task_id FROM session_map WHERE dag_task_id IS NOT NULL LIMIT 1`,
            )
            .all() as { dag_task_id: string }[];
          if (anyRegistered.length > 0) {
            hasDispatchContext = true;
            dispatchAssignedTaskIds = anyRegistered.map((r) => r.dag_task_id);
          }
        } catch {
          /* DB failure — fall through */
        }
      }
    } else {
      const projectRoot = root || getProjectRoot();
      const ctxDir = path.join(projectRoot, ".task_temp", "_dispatch", "ctx");
      try {
        if (fs.existsSync(ctxDir)) {
          const files = fs
            .readdirSync(ctxDir)
            .filter((f) => f.endsWith(".json"));
          if (files.length > 0) {
            const latest = files.reduce((a, b) => {
              const sa = fs.statSync(path.join(ctxDir, a));
              const sb = fs.statSync(path.join(ctxDir, b));
              return sa.mtimeMs > sb.mtimeMs ? a : b;
            });
            const ctx = JSON.parse(
              fs.readFileSync(path.join(ctxDir, latest), "utf8"),
            );
            if (ctx?.dagTaskId) {
              dispatchAssignedTaskIds = [ctx.dagTaskId];
              hasDispatchContext = true;
            }
          }
        }
      } catch {
        /* ctx/ scan failed */
      }
    }
  } catch {
    /* DB failure — fall through */
  }

  if (hasDispatchContext && taskId && dispatchAssignedTaskIds.length > 0) {
    if (!dispatchAssignedTaskIds.includes(taskId)) {
      writeLogSafe(SRC, "ERROR", {
        event: "DISPATCH_TASKID_TAMPER_AT_ARM",
        provided_task_id: taskId,
        dispatch_registered_task_ids: dispatchAssignedTaskIds,
        detail:
          "sub-agent attempted to use a task_id not registered in any dispatch at arm phase",
      });
      return {
        status: "rejected",
        reason: `DISPATCH-INTEGRITY: taskId "${taskId}" is not registered in any dispatch session. Registered: ${dispatchAssignedTaskIds.join(", ")}. The dispatch-assigned task_id is immutable.`,
      };
    }
  }

  if (!taskId && dispatchAssignedTaskIds.length === 1) {
    taskId = dispatchAssignedTaskIds[0];
  }

  const store = loadGateStore(root);
  const session = gateSessionId ? store.sessions[gateSessionId] : undefined;

  if (!session) {
    return {
      status: "rejected",
      reason: `session not found: ${gateSessionId || "(missing)"}. Must call compliance_gate_check first.`,
    };
  }

  if (session.gate_status === "armed") {
    return {
      status: "rejected",
      reason: `session ${gateSessionId} is already armed. Cannot re-arm.`,
    };
  }

  if (session.gate_status !== "checked") {
    return {
      status: "rejected",
      reason: `session ${gateSessionId} is not in "checked" state (current: ${session.gate_status}). Must call compliance_gate_check first.`,
    };
  }

  if (!planSummary || planSummary.trim().length < 10) {
    return {
      status: "rejected",
      reason: "plan_summary must be at least 10 characters",
    };
  }

  if (session.last_check_passed === false && shouldBlock("session-mgmt-block")) {
    return {
      status: "rejected",
      reason: `Gate check failed — resolve HIGH severity violations before arming. Session ${gateSessionId} has ${session.last_check_failed_items?.length || 0} check failures under the active session policy.`,
    };
  }

  // ── Deliverables hard constraint validation ──
  const EXEMPT_AGENTS = [
    "@Orchestrator",
    "@Super-Admin",
    "Orchestrator",
    "Super-Admin",
  ];
  const resolvedAgent = agent || session.agent || "unknown";
  // v0.2: normalize agent identity for exempt check (strip @, trim, lowercase)
  const normalizedAgent = (resolvedAgent || "").replace(/^@/, "").trim().toLowerCase();
  const isExempt = normalizedAgent === "orchestrator" || normalizedAgent === "super-admin";

  if (
    !isExempt &&
    (!declaredDeliverables || declaredDeliverables.length === 0)
  ) {
    return {
      status: "rejected",
      reason: `declared_deliverables is REQUIRED for agent "${resolvedAgent}". Exempt agents: @Orchestrator, @Super-Admin.`,
    };
  }

  logGateStatusTransition(gateSessionId, session.gate_status, "armed", {
    source: "armGateSession",
    agent: resolvedAgent,
  });

  session.gate_status = "armed";
  session.plan_summary = planSummary.trim();
  session.confirmed_at = new Date().toISOString();
  session.last_check_failed_items = [];
  session.task_id = taskId || session.task_id || null;
  session.agent = resolvedAgent;
  session.worktree = process.cwd();
  session.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  session.declared_deliverables = declaredDeliverables;
  session.approval_required = !isExempt;

  store.active_sessions = store.active_sessions.filter((sid) => {
    const s = store.sessions[sid];
    return s && s.gate_status === "armed" && !s.consumed_at;
  });

  if (!store.active_sessions.includes(gateSessionId)) {
    store.active_sessions.push(gateSessionId);
  }

  store.last_updated = new Date().toISOString();
  saveGateStore(store, root);

  return {
    status: "armed",
    session_id: gateSessionId,
    confirmed_at: session.confirmed_at,
    expires_at: session.expires_at,
    plan_summary: planSummary.trim().substring(0, 200),
  };
}
