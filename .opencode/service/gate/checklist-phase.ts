// service/gate/checklist-phase.ts — Checklist types, phase definitions, and helpers
// Source: execution-checklist.ts (types, PHASE_ITEMS, helpers)

import { isDagExempt } from "../../lib/agent-identity";

// ════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════

export interface CreateChecklistRunInput {
  opencode_session_id: string;
  parent_session_id?: string | null;
  task_id?: string | null;
  agent: string;
  domain_id?: string | null;
  worktree?: string | null;
}

export interface MarkChecklistInput {
  run_id: string;
  item_key: string;
  evidence_ref?: string | null;
  actor?: string | null;
}

export interface MarkChecklistFailedInput extends MarkChecklistInput {
  fail_reason: string;
  remediation?: string | null;
}

export interface RequireChecklistPassedInput {
  run_id: string;
  phase?: string | null;
  item_key?: string | null;
  tool_name?: string | null;
}

export interface ChecklistBlockerItem {
  item_key: string;
  phase: string;
  remediation: string | null;
  fail_reason?: string | null;
}

export interface RequireChecklistPassedResult {
  passed: boolean;
  blockers: ChecklistBlockerItem[];
}

export interface AdvanceChecklistPhaseInput {
  run_id: string;
  current_phase: string;
  next_phase: string;
}

export interface AdvanceChecklistPhaseResult {
  advanced: boolean;
  blockers: ChecklistBlockerItem[];
  new_phase?: string;
}

export interface ChecklistSummary {
  run_id: string;
  phase: string;
  status: string;
  pending_blockers: ChecklistBlockerItem[];
  next_action: string;
}

export interface DispatchPayloadIntegrityInput {
  payload_id: string;
  dispatch_ref_id?: string | null;
  parent_session_id?: string | null;
  agent_type: string;
  dag_task_id?: string | null;
  task_description: string;
  normalized_payload: string;
  sha256: string;
  completeness_status: string;
  completeness_error?: string | null;
  prompt_path?: string | null;
}

export interface ValidatePayloadInput {
  task_description: string;
  agent_type: string;
}

export interface ValidatePayloadResult {
  passed: boolean;
  error?: string;
}

// ════════════════════════════════════════════════
// PHASE ITEM DEFINITIONS
// ════════════════════════════════════════════════

export const PHASE_ITEMS: Record<
  string,
  Array<{ key: string; verifier: string; remediation: string }>
> = {
  dispatch_payload: [
    {
      key: "payload_complete",
      verifier: "dispatch-subagent.ts",
      remediation:
        "Provide complete task description with artifacts or findings. " +
        "The dispatcher must include actual content, not placeholder text.",
    },
    {
      key: "dispatch_token_created",
      verifier: "dispatch-subagent.ts",
      remediation:
        "Call dispatch_subagent() to generate DISPATCH_TOKEN and prompt.",
    },
    {
      key: "session_context_bound",
      verifier: "task-before.ts + session_map",
      remediation:
        "Call Task() with the dispatch-generated prompt. The child slot in session_map must exist.",
    },
  ],
  preflight: [
    {
      key: "dag_entry_verified",
      verifier: "dispatch-before.ts",
      remediation:
        "Ensure the DAG task exists in Task.DAG.json, or dispatch @Meta-Planner to plan it.",
    },
    {
      key: "agent_scope_resolved",
      verifier: "scope-before.ts",
      remediation:
        "Agent identity must be resolved from session_map. Check OpenCode session configuration.",
    },
    {
      key: "domain_resolved",
      verifier: "resolve_domain_id",
      remediation:
        "Call resolve_domain_id() or check dispatch context for domain assignment.",
    },
    {
      key: "module_scope_declared",
      verifier: "module_scope_declare",
      remediation:
        "Call module_scope_declare(module, task_id) with the resolved domain.",
    },
    {
      key: "config_read_attested",
      verifier: "config_read_attest",
      remediation:
        "Read .opencode/agents/<Agent>.md, opencode.json, .opencode/project.config.json, " +
        "then call config_read_attest(task_id). This is reset every conversation round " +
        "in strict/locked mode — agents must re-read config files before each round.",
    },
  ],
  read_attest: [
    {
      key: "knowledge_search_completed",
      verifier: "knowledge_cache_search",
      remediation:
        "Call knowledge_cache_search(domain, task_id). If insufficient, dispatch @Knowledge-Curator.",
    },
    {
      key: "knowledge_attested",
      verifier: "knowledge_cache_attest",
      remediation:
        "Read at least one cache file via 'read' tool, then call " +
        "knowledge_cache_attest(domain, task_id, reason, files_read, content_summary).",
    },
    {
      key: "mistake_precautions_read",
      verifier: "knowledge_cache_attest",
      remediation:
        "In strict/locked mode, read ALL files under " +
        "docs/official_docs/framework/mistake_precautions/ (错题集) " +
        "via 'read' tool before knowledge_cache_attest. " +
        "Include them in files_read list.",
    },
  ],
  gate_armed: [
    {
      key: "compliance_gate_checked",
      verifier: "compliance_gate_check",
      remediation: "Call compliance_gate_check(task_description, task_id).",
    },
    {
      key: "compliance_gate_armed",
      verifier: "compliance_gate_confirm",
      remediation:
        "Call compliance_gate_confirm(session_id, plan_summary, declared_deliverables).",
    },
    {
      key: "deliverables_declared",
      verifier: "compliance_gate_confirm",
      remediation:
        "Provide declared_deliverables JSON array with at least HANDOVER.md " +
        "and TASK_LOG.md entries.",
    },
  ],
  execute: [
    {
      key: "task_log_written",
      verifier: "submit gate + file evidence",
      remediation:
        "Write TASK_LOG.md to .task_temp/{taskId}/TASK_LOG.md with modification plan.",
    },
    {
      key: "required_logs_checked",
      verifier: "submit gate + file evidence",
      remediation:
        "Ensure HANDOVER.md has ## Logs Checked section with at least 2 entries.",
    },
    {
      key: "findings_section_present",
      verifier: "submit gate + file evidence",
      remediation:
        "Ensure HANDOVER.md has ## Findings table with discovered issues.",
    },
    {
      key: "knowledge_post_write_verified",
      verifier: "uc7ks-after.ts UC7-003 events",
      remediation:
        "If writing to docs/official_docs/, UC7-003 post-write verification must complete.",
    },
  ],
  deliver: [
    {
      key: "deliverables_submitted",
      verifier: "compliance_gate_submit_deliverables",
      remediation:
        "Call compliance_gate_submit_deliverables(session_id, deliverables_evidence).",
    },
    {
      key: "handover_hash_bound",
      verifier: "approve gate",
      remediation:
        "Compute SHA-256 of HANDOVER.md and pass to compliance_gate_approve_deliverables.",
    },
    {
      key: "declared_handover_path_bound",
      verifier: "approve gate",
      remediation:
        "HANDOVER.md path must match declared_deliverables[].artifact_path.",
    },
  ],
  close: [
    {
      key: "read_before_approve_verified",
      verifier: "compliance_gate_approve_deliverables",
      remediation:
        "Approver must read HANDOVER.md before approving. " +
        "Provide handover_sha256 to compliance_gate_approve_deliverables.",
    },
    {
      key: "deliverables_approved",
      verifier: "compliance_gate_approve_deliverables",
      remediation:
        "Call compliance_gate_approve_deliverables(session_id, 'approve', ...).",
    },
    {
      key: "gate_closed",
      verifier: "compliance_gate_complete",
      remediation:
        "Call compliance_gate_complete(session_id, execution_summary).",
    },
  ],
};

// ════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════

export function now(): number {
  return Date.now();
}

export function generateRunId(): string {
  return `ecr_${now()}_${Math.random().toString(36).substring(2, 10)}`;
}

export function generateItemId(run_id: string, item_key: string): string {
  return `eci_${run_id}_${item_key}`;
}

export function generatePayloadId(): string {
  return `dpi_${now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export { isDagExempt };
