// service/gate/deliverables.ts — Deliverables submission and approval
// Split from session-crud.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { readSubState } from "../../lib/substate-manager";
import {
  getProjectRoot,
  loadGateStore,
  saveGateStore,
  logGateStatusTransition,
  type DeliverableEvidence,
} from "./store";

const SRC = "service-gate-deliverables";

// ════════════════════════════════════════════════
// SUBMIT DELIVERABLES
// ════════════════════════════════════════════════

export function submitDeliverables(
  gateSessionId: string,
  deliverablesEvidence: DeliverableEvidence[],
  root?: string,
): { status: string; session_id: string; reason?: string } {
  const store = loadGateStore(root);
  const session = gateSessionId ? store.sessions[gateSessionId] : undefined;

  if (!session) {
    return {
      status: "rejected",
      session_id: gateSessionId,
      reason: `session not found: ${gateSessionId}`,
    };
  }
  if (session.gate_status !== "armed") {
    return {
      status: "rejected",
      session_id: gateSessionId,
      reason: `session ${gateSessionId} is not armed (status: ${session.gate_status})`,
    };
  }
  if (!deliverablesEvidence || deliverablesEvidence.length === 0) {
    return {
      status: "rejected",
      session_id: gateSessionId,
      reason: "deliverables_evidence must be non-empty",
    };
  }

  const now = new Date().toISOString();
  const evidenceWithTimestamps = deliverablesEvidence.map((ev) => ({
    ...ev,
    submitted_at: now,
  }));

  const taskId = session.task_id || gateSessionId;
  const taskDir = path.join(getProjectRoot(), ".task_temp", taskId || "");
  const missing: string[] = [];

  if (!fs.existsSync(path.join(taskDir, "HANDOVER.md")))
    missing.push("HANDOVER.md");
  if (!fs.existsSync(path.join(taskDir, "TASK_LOG.md")))
    missing.push("TASK_LOG.md");

  if (missing.length > 0) {
    logGateStatusTransition(gateSessionId, session.gate_status, "recoverable", {
      source: "submitDeliverables",
      agent: session.agent,
    });
    session.gate_status = "recoverable";
    session.submitted_deliverables = evidenceWithTimestamps;
    session.fail_reason = `Missing deliverable artifacts: ${missing.join(", ")}`;
    session.missing_artifacts = missing;
    store.last_updated = now;
    saveGateStore(store, root);
    return {
      status: "recoverable",
      session_id: gateSessionId,
      reason: `Missing: ${missing.join(", ")}`,
    };
  }

  // TypeScript Diagnostic Check (zero-tolerance)
  const diagnosticState = readSubState("diagnostic_state");
  const writeAuditState = readSubState("write_audit_state");
  const taskFiles: string[] =
    writeAuditState?.current_session?.files_written || [];
  const filesWithErrors: string[] = [];

  for (const f of taskFiles) {
    const absPath = path.isAbsolute(f) ? f : path.join(getProjectRoot(), f);
    const diag = diagnosticState?.files?.[absPath];
    if ((diag?.errors?.length ?? 0) > 0) {
      filesWithErrors.push(absPath);
    }
  }

  if (filesWithErrors.length > 0) {
    logGateStatusTransition(gateSessionId, session.gate_status, "recoverable", {
      source: "submitDeliverables",
      agent: session.agent,
    });
    session.gate_status = "recoverable";
    session.submitted_deliverables = evidenceWithTimestamps;
    session.fail_reason = `TypeScript errors in ${filesWithErrors.length} file(s): ${filesWithErrors.join(", ")}`;
    session.fail_history = session.fail_history || [];
    session.fail_history.push({
      retry: session.retry_count || 0,
      failed_at: now,
      reason: session.fail_reason,
    });
    session.missing_artifacts = filesWithErrors;
    store.last_updated = now;
    saveGateStore(store, root);
    return {
      status: "recoverable",
      session_id: gateSessionId,
      reason: `TypeScript errors in: ${filesWithErrors.join(", ")}. Fix errors and retry.`,
    };
  }

  logGateStatusTransition(gateSessionId, session.gate_status, "delivered", {
    source: "submitDeliverables",
    agent: session.agent,
  });
  session.gate_status = "delivered";
  session.submitted_deliverables = evidenceWithTimestamps;
  store.last_updated = now;
  saveGateStore(store, root);
  return { status: "delivered", session_id: gateSessionId };
}

// ════════════════════════════════════════════════
// APPROVE DELIVERABLES
// ════════════════════════════════════════════════

export function approveDeliverables(
  gateSessionId: string,
  decision: "approve" | "reject",
  approvalNote?: string,
  executionSummary?: string,
  root?: string,
): { status: string; session_id: string; reason?: string } {
  const store = loadGateStore(root);
  const session = gateSessionId ? store.sessions[gateSessionId] : undefined;

  if (!session) {
    return {
      status: "rejected",
      session_id: gateSessionId,
      reason: `session not found: ${gateSessionId}`,
    };
  }
  if (session.gate_status !== "delivered") {
    return {
      status: "rejected",
      session_id: gateSessionId,
      reason: `session ${gateSessionId} is not in delivered state`,
    };
  }

  const now = new Date().toISOString();

  if (decision === "approve") {
    session.deliverables_approved_by = "Orchestrator";
    session.deliverables_approved_at = now;
    session.deliverables_approval_note = approvalNote || undefined;
    session.gate_status = "approved";

    if (executionSummary) {
      logGateStatusTransition(gateSessionId, "delivered", "completed", {
        source: "approveDeliverables",
        agent: session.agent,
      });
      session.gate_status = "completed";
      session.consumed_at = now;
      session.audit = {
        execution_summary: executionSummary.substring(0, 1000),
        completed_at: now,
      };
      store.active_sessions = store.active_sessions.filter(
        (sid) => sid !== gateSessionId,
      );
    } else {
      logGateStatusTransition(gateSessionId, "delivered", "approved", {
        source: "approveDeliverables",
        agent: session.agent,
      });
    }

    store.last_updated = now;
    saveGateStore(store, root);
    return { status: session.gate_status, session_id: gateSessionId };
  }

  if (decision === "reject") {
    logGateStatusTransition(gateSessionId, "delivered", "armed", {
      source: "approveDeliverables",
      agent: session.agent,
    });
    session.gate_status = "armed";
    session.deliverables_approval_note = approvalNote || "rejected";
    session.submitted_deliverables = undefined;
    store.last_updated = now;
    saveGateStore(store, root);
    return {
      status: "rejected",
      session_id: gateSessionId,
      reason: approvalNote || "rejected",
    };
  }

  return {
    status: "rejected",
    session_id: gateSessionId,
    reason: `Invalid decision: ${decision}`,
  };
}

// ════════════════════════════════════════════════
// DELIVERABLES TEMPLATES (restored from lib/deliverables-templates.ts.bak-1b)
// Lost during session-crud.ts → 3-file split
// ════════════════════════════════════════════════

export interface DeliverableTemplate {
  name: string;
  description: string;
  artifact_path?: string;
  required: boolean;
}

export const APPROVAL_EXEMPT_AGENTS = [
  "@Orchestrator",
  "@Super-Admin",
  "Orchestrator",
  "Super-Admin",
];

export const DELIVERABLES_TEMPLATES: Record<string, DeliverableTemplate[]> = {
  "Coder-BE": [
    { name: "HANDOVER.md", description: "Handover summary of backend API changes", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with implementation details", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
    { name: "test_report.json", description: "Test execution evidence", artifact_path: ".task_temp/{taskId}/test_report.json", required: true },
  ],
  "Coder-FE": [
    { name: "HANDOVER.md", description: "Handover summary of frontend component changes", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with implementation details", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
    { name: "test_report.json", description: "Test execution evidence", artifact_path: ".task_temp/{taskId}/test_report.json", required: true },
  ],
  Architect: [
    { name: "HANDOVER.md", description: "Handover summary of architecture decisions", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with design rationale", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
  ],
  Guardian: [
    { name: "HANDOVER.md", description: "Handover summary of code review findings", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with review evidence", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
  ],
  Arbiter: [
    { name: "HANDOVER.md", description: "Handover summary of arbitration ruling", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with deliberation notes", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
  ],
  "CI-CD-Agent": [
    { name: "HANDOVER.md", description: "Handover summary of deployment actions", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with CI/CD pipeline status", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
  ],
  "Knowledge-Curator": [
    { name: "HANDOVER.md", description: "Handover summary of knowledge cache updates", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with knowledge curation details", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
  ],
  "Meta-Planner": [
    { name: "HANDOVER.md", description: "Handover summary of planning outputs", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
    { name: "TASK_LOG.md", description: "Working memory log with planning rationale", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
  ],
};

export function getDeliverablesTemplate(agentType: string): DeliverableTemplate[] {
  const normalized = agentType.replace(/^@/, "").replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()).replace(/ /g, "-");
  return (
    DELIVERABLES_TEMPLATES[normalized] ||
    DELIVERABLES_TEMPLATES[agentType] || [
      { name: "HANDOVER.md", description: "Handover summary", artifact_path: ".task_temp/{taskId}/HANDOVER.md", required: true },
      { name: "TASK_LOG.md", description: "Working memory log", artifact_path: ".task_temp/{taskId}/TASK_LOG.md", required: true },
    ]
  );
}

export function isExemptAgent(agentName: string): boolean {
  const norm = agentName.replace(/^@/, "").toLowerCase();
  return norm === "orchestrator" || norm === "super-admin";
}

export function deliverablesTemplateMarkdown(agentType: string): string {
  const templates = getDeliverablesTemplate(agentType);
  const lines = [
    "### Deliverables Declaration — MANDATORY",
    "",
    "When calling `compliance_gate_confirm`, you MUST include `declared_deliverables`.",
    `Your agent type's (${agentType}) typical deliverables:`,
    "",
    ...templates.map(
      (t, i) =>
        `${i + 1}. **${t.name}**: ${t.description}` +
        (t.required ? " (required)" : " (optional)"),
    ),
    "",
    "",
    "**JSON format**: `declared_deliverables` must be an array of objects, each with `name` (string ≥1 char) and `description` (string ≥5 chars).",
    'Example: `[{name: "HANDOVER.md", description: "Handover summary for next agent"}, {name: "TASK_LOG.md", description: "Working memory log"}]` — do NOT pass bare strings like `["HANDOVER.md"]`.',
    "After writing ALL deliverables, call `compliance_gate_submit_deliverables(session_id, evidence)`.",
    "Then wait for Orchestrator approval before the gate can be closed.",
  ];
  return lines.join("\n");
}
