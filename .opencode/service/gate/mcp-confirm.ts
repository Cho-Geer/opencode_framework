// service/gate/mcp-confirm.ts — Gate confirm (arm) logic
// ═══════════════════════════════════════════════════════════════
// Extracted from scripts/mcp-tools/compliance-gate.ts (runGateConfirm L1462-1735)
// Transitions gate session from "checked" → "armed" with plan summary,
// deliverables validation, checklist wiring, and agent identity resolution.
// ═══════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import {
  getProjectRoot,
  loadGateStore,
  saveGateStore,
} from "./store-crud";
import { getEnforcementMode } from "./enforcement";
import { checklistWirePassed } from "./checklist-hooks";

const SRC = "service-gate-mcp-confirm";

const EXEMPT_AGENTS = [
  "@Orchestrator", "@Super-Admin", "Orchestrator", "Super-Admin",
];

export interface ConfirmResult {
  status: string;
  gate_session_id?: string;
  confirmed_at?: string;
  expires_at?: string;
  plan_summary?: string;
  declared_deliverables?: number;
  approval_required?: boolean;
  artifact_reminder?: {
    task_dir: string;
    required_files: string[];
    currently_missing: string[];
    note: string;
  };
  next_steps?: string;
  reason?: string;
}

export interface DeliverableEntry {
  name: string;
  description: string;
  artifact_path?: string;
  required?: boolean;
}

/**
 * Confirm (arm) a gate session.
 *
 * Transitions from "checked" → "armed" with:
 * - Plan summary validation
 * - Deliverables parsing and validation
 * - Universal mandatory deliverables auto-append (HANDOVER.md, TASK_LOG.md)
 * - Agent identity resolution
 * - Checklist wiring
 * - OpenCode session ID resolution (V7.2 fix)
 */
export function confirmGateSession(
  gateSessionId: string,
  planSummary: string,
  agent?: string,
  taskId?: string | null,
  declaredDeliverables?: unknown,
): ConfirmResult {
  const store = loadGateStore();
  const session = gateSessionId ? store.sessions[gateSessionId] : null;
  if (!session) {
    return { status: "rejected", reason: `session not found: ${gateSessionId || "(missing)"}. Must call compliance_gate_check first.` };
  }
  if (session.gate_status === "armed") {
    return { status: "rejected", reason: `session ${gateSessionId} is already armed. Cannot re-arm.` };
  }
  if (session.gate_status !== "checked") {
    return { status: "rejected", reason: `session ${gateSessionId} is not in "checked" state (current: ${session.gate_status}). Must call compliance_gate_check first.` };
  }
  if (!planSummary || planSummary.trim().length < 10) {
    return { status: "rejected", reason: "plan_summary must be at least 10 characters" };
  }

  // ── F1 Fix: Block if gate check failed ──
  const enforcementMode = getEnforcementMode();
  if (session.last_check_passed === false && enforcementMode !== "advisory") {
    return {
      status: "rejected",
      reason: `Gate check failed — resolve HIGH severity violations before arming. Session ${gateSessionId} has ${session.last_check_failed_items?.length || 0} check failures in ${enforcementMode} enforcement mode.`,
    };
  }

  // ── Resolve agent identity ──
  let resolvedAgent = agent || session.agent || "unknown";
  const isExempt = EXEMPT_AGENTS.some((exempt) => resolvedAgent === exempt || `@${resolvedAgent}` === exempt);

  // ── Deliverables validation ──
  let parsedDeliverables: DeliverableEntry[] | null = null;
  if (declaredDeliverables) {
    try {
      parsedDeliverables = typeof declaredDeliverables === "string"
        ? JSON.parse(declaredDeliverables)
        : (declaredDeliverables as DeliverableEntry[]);
      if (!Array.isArray(parsedDeliverables)) {
        return { status: "rejected", reason: "declared_deliverables must be a JSON array" };
      }
      for (const entry of parsedDeliverables) {
        if (!entry.name || typeof entry.name !== "string") {
          return { status: "rejected", reason: `Each deliverable must have a "name" (string). Got: ${JSON.stringify(entry)}` };
        }
        if (!entry.description || typeof entry.description !== "string" || entry.description.trim().length < 5) {
          return { status: "rejected", reason: `Each deliverable must have a "description" (min 5 chars). Got for "${entry.name}": ${entry.description || "(empty)"}` };
        }
      }
    } catch (e: any) {
      return { status: "rejected", reason: `declared_deliverables must be valid JSON. Parse error: ${e.message}` };
    }
  }

  // Hard constraint: non-exempt agents MUST provide deliverables
  if (!isExempt && (!parsedDeliverables || parsedDeliverables.length === 0)) {
    return {
      status: "rejected",
      reason: `declared_deliverables is REQUIRED for agent "${resolvedAgent}". Exempt agents: @Orchestrator, @Super-Admin. Declare at least 1 deliverable.`,
    };
  }

  // ── Auto-append universal mandatory deliverables ──
  if (!isExempt && parsedDeliverables) {
    const universalDeliverables = ["HANDOVER.md", "TASK_LOG.md"];
    for (const name of universalDeliverables) {
      if (!parsedDeliverables.some((d) => d.name === name)) {
        parsedDeliverables.push({
          name,
          description: `${name} — universal mandatory deliverable (auto-added)`,
          artifact_path: `.task_temp/${taskId || "{taskId}"}/${name}`,
          required: true,
        });
      }
    }
  }

  // ── Apply state changes ──
  session.gate_status = "armed";
  session.plan_summary = planSummary.trim();

  // V7.2 FIX: Resolve OpenCode session ID
  let opencodeSessionId = process.env.OPENCODE_SESSION_ID || "";
  if (opencodeSessionId) {
    session.opencode_session_id = opencodeSessionId;
    writeLog(SRC, "INFO", { event: "GATE-V7.2-FIX", detail: `Resolved opencode_session_id=${opencodeSessionId} for gate=${gateSessionId}` });
  } else {
    writeLog(SRC, "WARN", { event: "GATE-V7.2-FALLBACK", detail: `Cannot resolve opencode_session_id for gate=${gateSessionId} — falling back to gateSessionId` });
  }

  // ── Checklist wiring ──
  const clSessionId = opencodeSessionId || gateSessionId;
  const clAgent = session.agent || resolvedAgent || "";
  const clTaskId = session.task_id || taskId || null;
  checklistWirePassed(clSessionId, clAgent, clTaskId, "compliance_gate_armed", `plan: ${planSummary.trim().substring(0, 80)}`);
  if (parsedDeliverables && parsedDeliverables.length > 0) {
    checklistWirePassed(clSessionId, clAgent, clTaskId, "deliverables_declared", JSON.stringify(parsedDeliverables.map((d) => d.name)));
  }

  session.confirmed_at = new Date().toISOString();
  session.last_check_failed_items = [];
  session.task_id = taskId || session.task_id || null;
  session.agent = resolvedAgent;
  checklistWirePassed(clSessionId, resolvedAgent, clTaskId, "compliance_gate_checked", `desc: ${(session.task_description || "").substring(0, 80)}`);
  session.worktree = process.cwd();
  session.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  session.declared_deliverables = parsedDeliverables;
  session.approval_required = !isExempt;

  // ── Update active_sessions ──
  store.active_sessions = store.active_sessions.filter((sid) => {
    const s = store.sessions[sid];
    return s && s.gate_status === "armed" && !s.consumed_at;
  });
  if (!store.active_sessions.includes(gateSessionId)) {
    store.active_sessions.push(gateSessionId);
  }
  for (const [sid, s] of Object.entries(store.sessions) as [string, any][]) {
    if (s.gate_status === "checked" && store.active_sessions.includes(sid)) {
      store.active_sessions = store.active_sessions.filter((a) => a !== sid);
    }
  }
  store.last_updated = new Date().toISOString();
  saveGateStore(store);

  // ── Artifact reminder ──
  const reminderTaskId = session.task_id || gateSessionId;
  const reminderTaskDir = path.join(getProjectRoot(), ".task_temp", reminderTaskId);
  const implicitRequired = ["HANDOVER.md", "TASK_LOG.md"];
  const missingImplicit = implicitRequired.filter((f) => !fs.existsSync(path.join(reminderTaskDir, f)));

  let nextStepsGuidance: string;
  if (isExempt) {
    nextStepsGuidance = `Exempt agent: you may call compliance_gate_complete directly after finishing. Ensure HANDOVER.md + TASK_LOG.md exist under .task_temp/${reminderTaskId}/ before completing.`;
  } else {
    nextStepsGuidance = "Non-exempt agent: you MUST call compliance_gate_submit_deliverables after finishing, then wait for Orchestrator to approve.";
  }

  return {
    status: "armed",
    gate_session_id: gateSessionId,
    confirmed_at: session.confirmed_at,
    expires_at: session.expires_at,
    plan_summary: planSummary.trim().substring(0, 200),
    declared_deliverables: parsedDeliverables ? parsedDeliverables.length : 0,
    approval_required: !isExempt,
    artifact_reminder: {
      task_dir: `.task_temp/${reminderTaskId}/`,
      required_files: implicitRequired,
      currently_missing: missingImplicit,
      note: missingImplicit.length > 0 ? `Create ${missingImplicit.join(", ")} before completing the task.` : "All required artifacts already exist.",
    },
    next_steps: nextStepsGuidance,
  };
}
