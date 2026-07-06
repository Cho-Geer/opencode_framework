// service/gate/mcp-deliverables.ts — Full deliverables submit + approve logic
// ═══════════════════════════════════════════════════════════════
// Extracted from scripts/mcp-tools/compliance-gate.ts
//   runGateSubmitDeliverables (L2156-2310)
//   enforceMultiSourceAudit   (L2315-2470)
//   parseFindingsTable        (L2473-2555)
//   runGateApproveDeliverables (L2556-2955)
//
// Enhances the simplified deliverables.ts with:
//   - Evidence cross-check vs declared_deliverables
//   - Artifact file existence validation
//   - Step 0d multi-source investigation audit
//   - SHA-256 HANDOVER.md proof-of-read
//   - FINDINGS-REPORT-ENFORCE
//   - READ-BEFORE-APPROVE (session-bound + fallback)
//   - Caller identity enforcement (approve restricted to SA/Orch)
//   - Checklist wiring
//   - Auto-complete with execution_summary
// ═══════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { writeLog } from "../../lib/log-manager";
import { loadGateStore, saveGateStore, getProjectRoot } from "./store-crud";
import { checklistWirePassed } from "./checklist-hooks";
import { shouldBlock } from "../enforcement/rule-disposition";

const SRC = "service-gate-mcp-deliverables";

// ═══════════════════════════════════════
// Types
// ═══════════════════════════════════════

export interface SubmitResult {
  status: string;
  gate_session_id?: string;
  reason?: string;
  missing_artifacts?: string[];
  retry_count?: number;
  next_action?: string;
  submitted_at?: string;
  deliverables_count?: number;
  pending_approval_by?: string;
}

export interface ApproveResult {
  status: string;
  gate_session_id?: string;
  approved_by?: string;
  approved_at?: string;
  approval_note?: string | null;
  auto_completed?: boolean;
  reason?: string;
}

// ═══════════════════════════════════════
// Helpers
// ═══════════════════════════════════════

const ALLOWED_APPROVE_AGENTS = [
  "@Orchestrator",
  "@Super-Admin",
  "Orchestrator",
  "Super-Admin",
  "@orchestrator",
  "@super-admin",
  "orchestrator",
  "super-admin",
];

const INVESTIGATION_KW_EN = [
  "investigation", "audit", "analysis", "diagnosis", "diagnose",
  "debug", "troubleshoot", "root-cause", "trace", "tracing", "forensic",
];
const INVESTIGATION_KW_CN = [
  "调查", "排查", "调试", "诊断", "根因", "审计", "追溯", "排错", "定位",
];

/**
 * Parse the ## Findings table from HANDOVER.md content.
 * Extracts Category column (second column) for cross-checking.
 */
export function parseFindingsTable(handoverContent: string): {
  categories: string[];
  count: number;
  error: string | null;
} {
  if (!handoverContent || typeof handoverContent !== "string") {
    return { categories: [], count: 0, error: null };
  }
  const lines = handoverContent.split(/\r?\n/);
  let inFindings = false;
  const categories: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+Findings\s*$/im.test(trimmed)) { inFindings = true; continue; }
    if (inFindings && /^##\s+/.test(trimmed)) break;
    if (inFindings && /^\|[\s\-:]+\|[\s\-:]+\|/.test(trimmed)) continue;
    if (inFindings && /^\|.*\|.*\|/.test(trimmed)) {
      const cols = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 2 && /^[a-z][a-z0-9_-]*$/.test(cols[1])) {
        categories.push(cols[1]);
      }
    }
  }
  return { categories, count: categories.length, error: null };
}

/**
 * Step 0d: For investigation-type tasks, validate HANDOVER.md
 * contains "## Logs Checked" section with log/audit evidence.
 * Returns null if OK; error object if missing.
 */
function enforceMultiSourceAudit(
  sessionPlan: string | undefined,
  taskId: string | null,
  declaredDeliverables: Array<{ name?: string; artifact_path?: string }>,
): { id: string; desc: string; severity: string } | null {
  if (!taskId) return null;

  const desc = (sessionPlan || "").toLowerCase();
  const isInvestigation =
    INVESTIGATION_KW_EN.some((kw) => desc.includes(kw)) ||
    INVESTIGATION_KW_CN.some((kw) => desc.includes(kw));
  if (!isInvestigation) return null;

  const handoverEntry = declaredDeliverables?.find(
    (d) => d.name === "HANDOVER.md",
  );
  const handoverPath = handoverEntry?.artifact_path ||
    `.task_temp/${taskId}/HANDOVER.md`;
  const resolvedPath = path.resolve(getProjectRoot(), handoverPath);

  let handover = "";
  try { handover = fs.readFileSync(resolvedPath, "utf-8"); } catch { /* missing */ }

  if (!handover) {
    return {
      id: "step_0d_handover_missing",
      desc: `[Step 0d] Investigation task requires HANDOVER.md at ${handoverPath}`,
      severity: "HIGH",
    };
  }
  if (!/##\s+Logs\s+Checked/i.test(handover)) {
    const logPaths = [
      ".task_temp/_logs/", ".opencode/state/gate-state.json",
      ".opencode/state/machine.json", ".task_temp/_dispatch/",
      ".opencode/state/session_log/ (SQLite)",
      ".opencode/state/framework-state.db (SQLite)",
    ];
    return {
      id: "step_0d_log_evidence_missing",
      desc: `[Step 0d] Investigation task HANDOVER.md lacks "## Logs Checked" section with ≥2 log/audit sources. Check: ${logPaths.join(", ")}`,
      severity: "HIGH",
    };
  }
  return null;
}

// ═══════════════════════════════════════
// SUBMIT DELIVERABLES (full logic)
// ═══════════════════════════════════════

/**
 * Submit deliverables with cross-check, artifact validation, and checklist wiring.
 * Replaces compliance-gate.ts runGateSubmitDeliverables.
 */
export function submitDeliverablesWithCrossCheck(
  gateSessionId: string,
  deliverablesEvidence: unknown,
): SubmitResult {
  const store = loadGateStore();
  const session = gateSessionId ? store.sessions[gateSessionId] : null;
  if (!session) {
    return { status: "rejected", reason: `session not found: ${gateSessionId || "(missing)"}` };
  }
  if (session.gate_status !== "armed") {
    return { status: "rejected", reason: `session ${gateSessionId} is not armed (status: ${session.gate_status}). Must call compliance_gate_confirm first.` };
  }

  // ── Parse evidence ──
  let parsedEvidence: Array<{ name?: string; artifact_path?: string; [k: string]: unknown }>;
  try {
    parsedEvidence = typeof deliverablesEvidence === "string"
      ? JSON.parse(deliverablesEvidence)
      : (deliverablesEvidence as typeof parsedEvidence);
    if (!Array.isArray(parsedEvidence) || parsedEvidence.length === 0) {
      return { status: "rejected", reason: "deliverables_evidence must be a non-empty JSON array" };
    }
  } catch (e: any) {
    return { status: "rejected", reason: `deliverables_evidence must be valid JSON. Parse error: ${e.message}` };
  }

  // ── Cross-check: evidence names ⊆ declared_deliverables ──
  const declaredNames = new Set((session.declared_deliverables || []).map((d: any) => d.name));
  const missingDeclared: string[] = [];
  for (const ev of parsedEvidence) {
    if (!ev.name) {
      return { status: "rejected", reason: `Each evidence entry must have a "name". Got: ${JSON.stringify(ev)}` };
    }
    if (declaredNames.size > 0 && !declaredNames.has(ev.name)) {
      missingDeclared.push(ev.name);
    }
  }
  if (missingDeclared.length > 0) {
    return {
      status: "rejected",
      reason: `Evidence contains names not in declared_deliverables: ${missingDeclared.join(", ")}. Declared: ${[...declaredNames].join(", ") || "(none)"}`,
    };
  }

  // ── File existence check for artifact_path entries ──
  const missingFiles: string[] = [];
  for (const ev of parsedEvidence) {
    if (ev.artifact_path) {
      const resolvedPath = path.resolve(getProjectRoot(), ev.artifact_path);
      if (!fs.existsSync(resolvedPath)) missingFiles.push(ev.name!);
    }
  }

  // ── HANDOVER.md + TASK_LOG.md validation ──
  const taskId = session.task_id || gateSessionId;
  const taskDir = path.join(getProjectRoot(), ".task_temp", taskId);
  if (fs.existsSync(taskDir)) {
    if (!fs.existsSync(path.join(taskDir, "HANDOVER.md"))) missingFiles.push("HANDOVER.md");
    if (!fs.existsSync(path.join(taskDir, "TASK_LOG.md"))) missingFiles.push("TASK_LOG.md");
  } else {
    missingFiles.push("HANDOVER.md", "TASK_LOG.md");
  }
  const uniqueMissing = [...new Set(missingFiles)];
  const now = new Date().toISOString();
  const evidenceWithTimestamps = parsedEvidence.map((ev) => ({ ...ev, name: ev.name || ev.artifact_path || "unknown", submitted_at: now }));

  // ── Missing artifacts → recoverable ──
  if (uniqueMissing.length > 0) {
    session.gate_status = "recoverable";
    session.submitted_deliverables = evidenceWithTimestamps;
    session.fail_reason = `Missing deliverable artifacts: ${uniqueMissing.join(", ")}`;
    session.missing_artifacts = uniqueMissing;
    session.retry_count = (session.retry_count || 0) + 1;
    store.last_updated = now;
    saveGateStore(store);
    return {
      status: "recoverable",
      gate_session_id: gateSessionId,
      reason: `Missing artifacts: ${uniqueMissing.join(", ")}. Next steps: (1) Create the missing file(s) under .task_temp/${taskId}/. (2) Call compliance_gate_retry_confirm(session_id="${gateSessionId}", plan_summary="..."). (3) Re-call compliance_gate_submit_deliverables. Do NOT re-submit without retry_confirm — session is in 'recoverable' state.`,
      retry_count: session.retry_count,
      missing_artifacts: uniqueMissing,
      next_action: "retry_confirm",
    };
  }

  // ── All artifacts present → delivered ──
  session.gate_status = "delivered";
  session.submitted_deliverables = evidenceWithTimestamps;

  const ag = session.agent || "";
  const tk = session.task_id || null;
  const clSid = session.opencode_session_id || gateSessionId;
  checklistWirePassed(clSid, ag, tk, "deliverables_submitted", `evidence: ${parsedEvidence.length} file(s)`);

  store.last_updated = now;
  saveGateStore(store);

  return {
    status: "delivered",
    gate_session_id: gateSessionId,
    submitted_at: now,
    pending_approval_by: "Orchestrator",
    deliverables_count: evidenceWithTimestamps.length,
    next_action:
      "Delivered. If you are @Orchestrator or @Super-Admin self-approving: " +
      "(1) read HANDOVER.md via the `read` tool (NOT safe_hash — read_audit requires the read tool), " +
      "(2) compute its SHA-256 via safe_hash, " +
      '(3) call compliance_gate_approve_deliverables with approval_decision="approve", ' +
      "handover_sha256=<hash>, and execution_summary=<summary>. " +
      "If you are a non-exempt subagent: wait for Orchestrator to approve.",
  };
}

// ═══════════════════════════════════════
// APPROVE DELIVERABLES (full logic)
// ═══════════════════════════════════════

/**
 * Approve or reject submitted deliverables.
 * Restricted to @Orchestrator / @Super-Admin.
 * Includes: Step 0d audit, SHA-256 proof, FINDINGS-REPORT-ENFORCE,
 *           READ-BEFORE-APPROVE, checklist wiring, auto-complete.
 */
export function approveDeliverablesWithAudit(
  gateSessionId: string,
  approvalDecision: string,
  approvalNote?: string,
  executionSummary?: string,
  agentId?: string,
  handoverSha256?: string,
  findingsReported?: string,
): ApproveResult {
  const store = loadGateStore();
  const session = gateSessionId ? store.sessions[gateSessionId] : null;
  if (!session) {
    return { status: "rejected", reason: `session not found: ${gateSessionId || "(missing)"}` };
  }

  // ── Caller identity enforcement ──
  const resolvedAgent = (agentId || session.agent || "").replace(/^@/, "");
  writeLog(SRC, "INFO", {
    sessionID: gateSessionId,
    event: "RESOLVED_FROM",
    agent: resolvedAgent,
    source: agentId ? "agent_id_param" : session.agent ? "session.agent" : "dispatch_target",
  });

  if (resolvedAgent &&
    !ALLOWED_APPROVE_AGENTS.includes(resolvedAgent) &&
    !ALLOWED_APPROVE_AGENTS.includes("@" + resolvedAgent)) {
    return {
      status: "rejected",
      reason: `compliance_gate_approve_deliverables restricted to @Orchestrator/@Super-Admin. Current agent: @${resolvedAgent}.`,
    };
  }

  if (session.gate_status !== "delivered") {
    return { status: "rejected", reason: `session ${gateSessionId} is not in "delivered" state (current: ${session.gate_status}). Submit deliverables first.` };
  }

  const now = new Date().toISOString();

  // ── REJECT path ──
  if (approvalDecision === "reject") {
    session.gate_status = "armed";
    session.deliverables_approval_note = approvalNote || "rejected";
    session.submitted_deliverables = null;
    store.last_updated = now;
    saveGateStore(store);
    return { status: "rejected", gate_session_id: gateSessionId, reason: approvalNote || "Deliverables rejected." };
  }

  if (approvalDecision !== "approve") {
    return { status: "rejected", reason: `Invalid approval_decision: "${approvalDecision}". Must be "approve" or "reject".` };
  }

  // ── APPROVE path ──
  const taskId = session.task_id;

  // Step 0d: Multi-source investigation audit
  const step0d = enforceMultiSourceAudit(
    session.plan_summary || session.task_description,
    taskId,
    session.declared_deliverables,
  );
  if (step0d) {
    writeLog(SRC, "ERROR", { sessionID: gateSessionId, event: "STEP_0D_LOG_EVIDENCE_MISSING", detail: step0d.desc });
    return { status: "rejected", reason: step0d.desc };
  }

  // ── DELIVERABLES-REVIEW-LOCK: HANDOVER.md existence ──
  const handoverEntry = (session.declared_deliverables || []).find((d: any) => d.name === "HANDOVER.md");
  const handoverPath = handoverEntry?.artifact_path || `.task_temp/${taskId}/HANDOVER.md`;
  const resolvedHandoverPath = path.resolve(getProjectRoot(), handoverPath);
  let handoverContent = "";
  try {
    if (fs.existsSync(resolvedHandoverPath)) {
      handoverContent = fs.readFileSync(resolvedHandoverPath, "utf8");
    }
  } catch { /* missing */ }

  if (!handoverContent || handoverContent.trim().length === 0) {
    return { status: "rejected", reason: `[DELIVERABLES-REVIEW-LOCK] HANDOVER.md missing or empty at ${handoverPath}.` };
  }

  // ── SHA-256 proof ──
  if (!handoverSha256 || typeof handoverSha256 !== "string" || handoverSha256.length !== 64) {
    return { status: "rejected", reason: `[DELIVERABLES-REVIEW-LOCK] handover_sha256 required. Compute: sha256sum ${handoverPath}` };
  }
  const actualHash = crypto.createHash("sha256").update(handoverContent).digest("hex");
  if (actualHash !== handoverSha256.toLowerCase()) {
    return {
      status: "rejected",
      reason: `[DELIVERABLES-REVIEW-LOCK] HANDOVER.md SHA-256 mismatch. Provided: ${handoverSha256.substring(0, 16)}... | Actual: ${actualHash.substring(0, 16)}...`,
    };
  }

  // ── FINDINGS-REPORT-ENFORCE ──
  const findingsResult = parseFindingsTable(handoverContent);
  if (findingsResult.count > 0 && findingsReported) {
    const reported = findingsReported.split("|").map((s) => s.trim()).filter(Boolean);
    const missing = findingsResult.categories.filter((c) => !reported.includes(c));
    if (missing.length > 0) {
      writeLog(SRC, "ERROR", { sessionID: gateSessionId, event: "FINDINGS_REPORT_ENFORCE_REJECTED", detail: `Missing: ${missing.join(", ")}` });
      return { status: "rejected", reason: `[FINDINGS-REPORT-ENFORCE] findings_reported missing: ${missing.join(", ")}. Must report all: ${findingsResult.categories.join("|")}` };
    }
    writeLog(SRC, "INFO", { sessionID: gateSessionId, event: "FINDINGS_REPORT_ENFORCE_PASSED", detail: `All ${findingsResult.count} verified` });
  }

  // ── Approval note minimum length ──
  const note = (approvalNote || executionSummary || "").trim();
  if (note.length < 10) {
    return { status: "rejected", reason: `[DELIVERABLES-REVIEW-LOCK] approval_note too short (${note.length} chars, minimum 10).` };
  }

  // ── READ-BEFORE-APPROVE ──
  try {
    const { computeApprovalArgsHash, buildApprovalArgsHashInput, getApprovalContext, markApprovalContextConsumed } =
      require("../../lib/approval-read-context");
    const argsHash = computeApprovalArgsHash(
      buildApprovalArgsHashInput({
        gate_session_id: gateSessionId,
        approval_decision: approvalDecision,
        handover_sha256: handoverSha256 || "",
        agent_id: agentId || "",
      }),
    );
    const approvalCtx = getApprovalContext(gateSessionId, argsHash);
    let readResult: { verified: boolean; reason: string } | null = null;

    if (approvalCtx) {
      const { verifyNonEmptyReadSet } = require("../../lib/read-audit");
      const setResult = verifyNonEmptyReadSet({
        agent: resolvedAgent.replace(/^@/, ""),
        filePaths: [resolvedHandoverPath],
      });
      readResult = { verified: setResult.verified, reason: setResult.reason };
      writeLog(SRC, "INFO", { sessionID: gateSessionId, event: "READ_BEFORE_APPROVE_SESSION_BOUND", verified: setResult.verified });
    } else {
      writeLog(SRC, "INFO", { sessionID: gateSessionId, event: "READ_BEFORE_APPROVE_FALLBACK_UNBOUND" });
      const { verifyRead } = require("../../lib/read-audit");
      readResult = verifyRead(resolvedAgent, resolvedHandoverPath);
    }

    if (!readResult.verified) {
      writeLog(SRC, "ERROR", { sessionID: gateSessionId, event: "READ_BEFORE_APPROVE_FAILED", detail: readResult.reason });
      return {
        status: "rejected",
        reason: `[READ-BEFORE-APPROVE] ${readResult.reason}\n\n1. Use the \`read\` tool to open HANDOVER.md\n2. Compute SHA-256: sha256sum .task_temp/${taskId}/HANDOVER.md\n3. Re-call with handover_sha256 and approval_note (min 10 chars)`,
      };
    }
    if (approvalCtx) markApprovalContextConsumed(gateSessionId, argsHash);
    writeLog(SRC, "INFO", { sessionID: gateSessionId, event: "READ_BEFORE_APPROVE_PASSED" });
  } catch (readAuditErr: any) {
    const blockReadAudit = shouldBlock("mcp-deliverable-check");
    writeLog(SRC, blockReadAudit ? "ERROR" : "WARN", {
      sessionID: gateSessionId, event: "READ_BEFORE_APPROVE_UNAVAILABLE",
      policy: "mcp-deliverable-check", detail: readAuditErr.message,
    });
    if (blockReadAudit) {
      return {
        status: "rejected",
        reason: `[READ-BEFORE-APPROVE] Read audit unavailable under the active deliverables policy.\nError: ${readAuditErr.message}\n\nRemediation: verify read-track-after.ts plugin + framework-state.db read_audit table.`,
      };
    }
  }

  // ── Apply approval ──
  session.deliverables_approved_by = "Orchestrator";
  session.deliverables_approved_at = now;
  session.deliverables_approval_note = approvalNote || null;
  session.gate_status = "approved";
  session.consumed_at = now;

  const ag2 = session.agent || "";
  const tk2 = session.task_id || null;
  const clSidA = session.opencode_session_id || gateSessionId;
  checklistWirePassed(clSidA, ag2, tk2, "deliverables_approved", `approved by ${session.deliverables_approved_by}`);
  checklistWirePassed(clSidA, ag2, tk2, "handover_hash_bound", "sha256 verified");
  checklistWirePassed(clSidA, ag2, tk2, "declared_handover_path_bound", `path: ${handoverPath}`);
  checklistWirePassed(clSidA, ag2, tk2, "read_before_approve_verified", "hash matched");

  // ── Auto-complete if execution_summary provided ──
  if (executionSummary) {
    session.gate_status = "completed";
    session.consumed_at = now;
    checklistWirePassed(clSidA, ag2, tk2, "gate_closed", "auto-completed after approval");
    session.audit = {
      execution_summary: (executionSummary || "").substring(0, 1000),
      completed_at: now,
    };
    store.active_sessions = store.active_sessions.filter((sid) => sid !== gateSessionId);
    if (!Array.isArray(store.audit_history)) store.audit_history = [];
    store.audit_history.push({
      session_id: gateSessionId,
      task_description: session.task_description,
      plan_summary: session.plan_summary,
      agent: session.agent,
      task_id: session.task_id,
      confirmed_at: session.confirmed_at,
      consumed_at: now,
      execution_summary: (executionSummary || "").substring(0, 1000),
      gate_status: "completed",
    });
    if (store.audit_history.length > 500) {
      store.audit_history = store.audit_history.slice(-500);
    }
  }

  store.last_updated = now;
  saveGateStore(store);

  return {
    status: session.gate_status,
    gate_session_id: gateSessionId,
    approved_by: session.deliverables_approved_by,
    approved_at: now,
    approval_note: approvalNote || null,
    auto_completed: !!executionSummary,
  };
}
