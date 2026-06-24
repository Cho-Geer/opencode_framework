/**
 * execution-checklist.ts — DB-canonical P0 execution checklist state machine
 * ═══════════════════════════════════════════════════════════════════════
 * Implements the checklist DB API for the P0 protocol decomposition plan.
 *
 * All checklist state is stored in SQLite (schema v18 tables). No JSON
 * state files. Each state change writes both a DB event and a structured
 * log via writeLog().
 *
 * Exported functions:
 *   createChecklistRun          — create run + required items for phase
 *   markChecklistPassed         — mark item passed + record event
 *   markChecklistFailed         — mark item failed + reason/remediation
 *   requireChecklistPassed      — query blocking items, return blockers
 *   advanceChecklistPhase       — advance phase when all blockers clear
 *   getChecklistSummary         — agent-readable summary
 *   recordDispatchPayloadIntegrity — write dispatch payload validation
 *   validateDispatchPayload     — check task description completeness
 *
 * Code spec:
 *   - Uses getDb() from db-manager for DB access
 *   - All writes use db.transaction() for atomicity
 *   - No JSON state file I/O (no substate-manager)
 *   - No console.log — use writeLog() exclusively
 *   - Each state change emits writeLog("execution-checklist", "runtime", ...)
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-22
 * @see docs/review/framework-refactor/db-canonical-p0-checklist-optimization-plan.md §4 Step 2
 */

import { getDb } from "./db-manager";
import { writeLog } from "./log-manager";

const SRC = "execution-checklist";

// ════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════
// PHASE ITEM DEFINITIONS
// ════════════════════════════════════════════════════════════

/** Items required per phase (from plan §3.2). */
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
  ],
  read_attest: [
    {
      key: "config_read_attested",
      verifier: "config_read_attest",
      remediation:
        "Read .opencode/agents/<Agent>.md, opencode.json, .opencode/project.config.json, " +
        "then call config_read_attest(task_id).",
    },
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

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

function now(): number {
  return Date.now();
}

function generateRunId(): string {
  return `ecr_${now()}_${Math.random().toString(36).substring(2, 10)}`;
}

function generateItemId(run_id: string, item_key: string): string {
  return `eci_${run_id}_${item_key}`;
}

function generatePayloadId(): string {
  return `dpi_${now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ════════════════════════════════════════════════════════════
// inheritDispatchPayloadItems
// ════════════════════════════════════════════════════════════

/**
 * Inherit passed dispatch_payload items from the parent run into a child run.
 *
 * DB-canonical F-A fix (2026-06-22, @Super-Admin):
 * When Orchestrator dispatches a sub-agent, dispatch-subagent.ts marks the
 * payload_complete / dispatch_token_created / session_context_bound items as
 * passed in the Orchestrator's own checklist run. The sub-agent's session has
 * a different opencode_session_id, so its createChecklistRun() creates a fresh
 * run where those items are still pending. Without inheritance the sub-agent
 * deadlocks in dispatch_payload phase.
 *
 * This helper uses dispatch_payload_integrity (which already records
 * parent_session_id + dag_task_id + agent_type for every dispatch) as the
 * authoritative lineage source. It:
 *   1. Looks up the parent_session_id for this (task_id, agent) dispatch.
 *   2. Updates the child run's parent_session_id column.
 *   3. Finds the parent's checklist run.
 *   4. Copies any passed dispatch_payload items into the child run.
 *
 * Concurrency safety:
 *   - Called inside createChecklistRun's db.transaction() so all reads/writes
 *     are atomic with child run creation.
 *   - Each child run has a unique run_id; item_id = generateItemId(run_id, key)
 *     so concurrent child runs never conflict on item rows.
 *   - Parent run lookup is by (opencode_session_id, task_id); multiple child
 *     runs for the same task read the same parent snapshot -- reads are safe.
 *
 * @returns Number of items inherited and the resolved parent session/run ids.
 */
function inheritDispatchPayloadItems(
  db: any,
  childRunId: string,
  childSessionId: string | null,
  taskId: string | null | undefined,
  agent: string,
  ts: number,
): {
  inherited: number;
  parentSessionId: string | null;
  parentRunId: string | null;
} {
  if (!taskId) {
    return { inherited: 0, parentSessionId: null, parentRunId: null };
  }

  // Normalize agent type to ignore optional '@' prefix and case differences.
  // dispatch-subagent.ts records agent_type from the CLI arg (often no '@'),
  // while checklist-before.ts resolves the child agent with '@' prefix.
  const agentNorm = agent.toLowerCase().replace(/^@/, "");

  // 1. Find the dispatch audit row for this (task_id, agent) combination.
  const dispatchRow = db
    .query(
      `SELECT parent_session_id
       FROM dispatch_payload_integrity
       WHERE dag_task_id = ? AND lower(replace(agent_type, '@', '')) = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(taskId, agentNorm) as { parent_session_id: string | null } | null;

  if (!dispatchRow?.parent_session_id) {
    writeLog(SRC, "runtime", {
      event: "CHECKLIST-PARENT-NOT-FOUND",
      detail: `child_run=${childRunId} task_id=${taskId} agent=${agent} reason=no_dispatch_payload_integrity`,
    });
    return { inherited: 0, parentSessionId: null, parentRunId: null };
  }

  const parentSessionId = dispatchRow.parent_session_id;

  // Safety: do not treat the parent run itself as a child. This happens when
  // checklistWirePassed() in dispatch-subagent.ts creates the parent run while
  // running in the parent's OPENCODE_SESSION_ID context.
  if (parentSessionId && parentSessionId === childSessionId) {
    writeLog(SRC, "runtime", {
      event: "CHECKLIST-PARENT-IS-SELF",
      detail: `child_run=${childRunId} session=${childSessionId} task_id=${taskId} agent=${agent} — skipping self-inheritance`,
    });
    return { inherited: 0, parentSessionId, parentRunId: null };
  }

  // 2. Record parent lineage on the child run.
  db.run(
    `UPDATE execution_checklist_runs
     SET parent_session_id = ?, updated_at = ?
     WHERE run_id = ?`,
    [parentSessionId, ts, childRunId],
  );

  // 3. Find the parent's checklist run for the same task + agent.
  const parentRun = db
    .query(
      `SELECT run_id
       FROM execution_checklist_runs
       WHERE opencode_session_id = ? AND task_id = ?
         AND lower(replace(agent, '@', '')) = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(parentSessionId, taskId, agentNorm) as { run_id: string } | null;

  if (!parentRun) {
    writeLog(SRC, "runtime", {
      event: "CHECKLIST-PARENT-RUN-NOT-FOUND",
      detail: `child_run=${childRunId} parent_session=${parentSessionId} task_id=${taskId} agent=${agent}`,
    });
    return { inherited: 0, parentSessionId, parentRunId: null };
  }

  // 4. Copy passed dispatch_payload items from parent to child.
  const passedItems = db
    .query(
      `SELECT item_key, evidence_ref
       FROM execution_checklist_items
       WHERE run_id = ? AND phase = 'dispatch_payload' AND status = 'passed'`,
    )
    .all(parentRun.run_id) as Array<{
    item_key: string;
    evidence_ref: string | null;
  }>;

  let inherited = 0;
  for (const item of passedItems) {
    const itemId = generateItemId(childRunId, item.item_key);

    // Skip if already passed (idempotent for concurrent/repeated calls).
    const current = db
      .query(
        `SELECT status FROM execution_checklist_items WHERE item_id = ? AND run_id = ?`,
      )
      .get(itemId, childRunId) as { status: string } | null;
    if (current?.status === "passed") continue;

    db.run(
      `UPDATE execution_checklist_items
       SET status = 'passed',
           evidence_ref = ?,
           updated_at = ?
       WHERE item_id = ? AND run_id = ?`,
      [
        `inherited from parent_run=${parentRun.run_id}; original=${item.evidence_ref || "none"}`,
        ts,
        itemId,
        childRunId,
      ],
    );

    inherited++;
    db.run(
      `INSERT INTO execution_checklist_events
       (run_id, event_type, actor, tool_name, old_status, new_status,
        evidence_ref, message, created_at)
       VALUES (?, 'checklist_item_passed', 'dispatch-inheritance', ?,
               'pending', 'passed', ?, ?, ?)`,
      [
        childRunId,
        item.item_key,
        `parent_run=${parentRun.run_id}`,
        `Inherited ${item.item_key} from parent run ${parentRun.run_id}`,
        ts,
      ],
    );
  }

  writeLog(SRC, "runtime", {
    event: "CHECKLIST-PARENT-ITEMS-INHERITED",
    detail: `child_run=${childRunId} parent_run=${parentRun.run_id} parent_session=${parentSessionId} task_id=${taskId} agent=${agent} inherited=${inherited}`,
  });

  return { inherited, parentSessionId, parentRunId: parentRun.run_id };
}

// ════════════════════════════════════════════════════════════
// createChecklistRun
// ════════════════════════════════════════════════════════════

/**
 * Create a new execution checklist run for the given agent/session.
 * Creates all required items for the dispatch_payload phase.
 * If a run already exists for the session+task combination, returns the existing run.
 */
export function createChecklistRun(input: CreateChecklistRunInput): {
  run_id: string;
  phase: string;
  items_created: number;
} {
  const db = getDb();

  // Check if run already exists for this session+task
  const existing = db
    .query(
      `SELECT run_id, phase FROM execution_checklist_runs
       WHERE opencode_session_id = ? AND (task_id = ? OR (task_id IS NULL AND ? IS NULL))
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(
      input.opencode_session_id,
      input.task_id ?? null,
      input.task_id ?? null,
    ) as { run_id: string; phase: string } | null;

  if (existing) {
    writeLog(SRC, "runtime", {
      event: "CHECKLIST-RUN-REUSED",
      detail: `run_id=${existing.run_id} phase=${existing.phase} agent=${input.agent}`,
    });
    return { run_id: existing.run_id, phase: existing.phase, items_created: 0 };
  }

  const run_id = generateRunId();
  const ts = now();
  const initPhase = "dispatch_payload";

  const create = db.transaction(() => {
    // Create run
    db.run(
      `INSERT INTO execution_checklist_runs
       (run_id, opencode_session_id, parent_session_id, task_id, agent, domain_id,
        worktree, phase, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        run_id,
        input.opencode_session_id,
        input.parent_session_id ?? null,
        input.task_id ?? null,
        input.agent,
        input.domain_id ?? null,
        input.worktree ?? null,
        initPhase,
        ts,
        ts,
      ],
    );

    // Create items for ALL phases (P0-3 fix: pre-create all items from policy snapshot)
    let totalItems = 0;
    for (const phase of Object.keys(PHASE_ITEMS)) {
      const items = PHASE_ITEMS[phase];
      for (const item of items) {
        const item_id = generateItemId(run_id, item.key);
        db.run(
          `INSERT OR IGNORE INTO execution_checklist_items
           (item_id, run_id, item_key, phase, required_when, status, blocking,
            verifier, remediation, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'always', ?, 1, ?, ?, ?, ?)`,
          [
            item_id,
            run_id,
            item.key,
            phase,
            phase === initPhase ? "pending" : "pending",
            item.verifier,
            item.remediation,
            ts,
            ts,
          ],
        );
        totalItems++;
      }
    }

    // Inherit passed dispatch_payload items from parent run (F-A fix).
    const { inherited, parentSessionId, parentRunId } =
      inheritDispatchPayloadItems(
        db,
        run_id,
        input.opencode_session_id,
        input.task_id,
        input.agent,
        ts,
      );

    return { totalItems, inherited, parentSessionId, parentRunId };
  });

  const result = create();

  writeLog(SRC, "runtime", {
    event: "CHECKLIST-RUN-CREATED",
    detail:
      `run_id=${run_id} phase=${initPhase} agent=${input.agent} ` +
      `task_id=${input.task_id ?? "none"} items=${result.totalItems} ` +
      `inherited=${result.inherited}` +
      (result.parentRunId ? ` parent_run=${result.parentRunId}` : ""),
  });

  return { run_id, phase: initPhase, items_created: result.totalItems };
}

// ════════════════════════════════════════════════════════════
// markChecklistPassed
// ════════════════════════════════════════════════════════════

/**
 * Mark a checklist item as passed and record the event.
 * Uses a single transaction for state update + event insertion.
 */
export function markChecklistPassed(input: MarkChecklistInput): boolean {
  const db = getDb();
  const ts = now();

  try {
    db.transaction(() => {
      // Verify item exists and is not already passed
      const item = db
        .query(
          `SELECT item_id, status FROM execution_checklist_items
           WHERE run_id = ? AND item_key = ?`,
        )
        .get(input.run_id, input.item_key) as {
        item_id: string;
        status: string;
      } | null;

      if (!item) {
        throw new Error(
          `Item not found: run_id=${input.run_id} item_key=${input.item_key}`,
        );
      }

      if (item.status === "passed") {
        // Already passed — idempotent, record event only
        db.run(
          `INSERT INTO execution_checklist_events
           (run_id, item_id, event_type, actor, tool_name, old_status, new_status,
            evidence_ref, created_at)
           VALUES (?, ?, 'checklist_item_passed', ?, ?, 'passed', 'passed', ?, ?)`,
          [
            input.run_id,
            item.item_id,
            input.actor ?? null,
            input.evidence_ref ?? null,
            input.evidence_ref ?? null,
            ts,
          ],
        );
        return;
      }

      const oldStatus = item.status;

      // Update item to passed
      db.run(
        `UPDATE execution_checklist_items
         SET status = 'passed', evidence_ref = ?, updated_at = ?
         WHERE run_id = ? AND item_key = ?`,
        [input.evidence_ref ?? null, ts, input.run_id, input.item_key],
      );

      // Record event
      db.run(
        `INSERT INTO execution_checklist_events
         (run_id, item_id, event_type, actor, tool_name, old_status, new_status,
          evidence_ref, created_at)
         VALUES (?, ?, 'checklist_item_passed', ?, ?, ?, 'passed', ?, ?)`,
        [
          input.run_id,
          item.item_id,
          input.actor ?? null,
          input.evidence_ref ?? null,
          oldStatus,
          input.evidence_ref ?? null,
          ts,
        ],
      );
    })();

    writeLog(SRC, "runtime", {
      event: "CHECKLIST-ITEM-PASSED",
      detail: `run_id=${input.run_id} item_key=${input.item_key} evidence=${input.evidence_ref ?? "none"}`,
    });

    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "CHECKLIST-ITEM-PASS-FAILED",
      detail: `run_id=${input.run_id} item_key=${input.item_key} err=${e.message}`,
    });
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// markChecklistFailed
// ════════════════════════════════════════════════════════════

/**
 * Mark a checklist item as failed with reason and optional remediation.
 * Uses a single transaction for state update + event insertion.
 */
export function markChecklistFailed(input: MarkChecklistFailedInput): boolean {
  const db = getDb();
  const ts = now();

  try {
    db.transaction(() => {
      const item = db
        .query(
          `SELECT item_id, status FROM execution_checklist_items
           WHERE run_id = ? AND item_key = ?`,
        )
        .get(input.run_id, input.item_key) as {
        item_id: string;
        status: string;
      } | null;

      if (!item) {
        throw new Error(
          `Item not found: run_id=${input.run_id} item_key=${input.item_key}`,
        );
      }

      const oldStatus = item.status;

      db.run(
        `UPDATE execution_checklist_items
         SET status = 'failed', fail_reason = ?, remediation = ?,
             evidence_ref = ?, updated_at = ?
         WHERE run_id = ? AND item_key = ?`,
        [
          input.fail_reason,
          input.remediation ?? null,
          input.evidence_ref ?? null,
          ts,
          input.run_id,
          input.item_key,
        ],
      );

      db.run(
        `INSERT INTO execution_checklist_events
         (run_id, item_id, event_type, actor, old_status, new_status,
          evidence_ref, message, created_at)
         VALUES (?, ?, 'checklist_item_failed', ?, ?, 'failed', ?, ?, ?)`,
        [
          input.run_id,
          item.item_id,
          input.actor ?? null,
          oldStatus,
          input.evidence_ref ?? null,
          input.fail_reason,
          ts,
        ],
      );
    })();

    writeLog(SRC, "runtime", {
      event: "CHECKLIST-ITEM-FAILED",
      detail: `run_id=${input.run_id} item_key=${input.item_key} reason="${input.fail_reason.substring(0, 100)}"`,
    });

    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "CHECKLIST-ITEM-FAIL-FAILED",
      detail: `run_id=${input.run_id} item_key=${input.item_key} err=${e.message}`,
    });
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// requireChecklistPassed
// ════════════════════════════════════════════════════════════

/**
 * Query blocking items for the given run.
 * Returns structured blockers with remediation steps.
 * If passed=true, all required blocking items are passed.
 */
export function requireChecklistPassed(
  input: RequireChecklistPassedInput,
): RequireChecklistPassedResult {
  const db = getDb();

  let sql = `
    SELECT item_key, phase, remediation, fail_reason
    FROM execution_checklist_items
    WHERE run_id = ? AND blocking = 1 AND status != 'passed'
  `;
  const params: any[] = [input.run_id];

  if (input.phase) {
    sql += " AND phase = ?";
    params.push(input.phase);
  }

  if (input.item_key) {
    sql += " AND item_key = ?";
    params.push(input.item_key);
  }

  sql += " ORDER BY phase, item_key";

  const rows = db.query(sql).all(...params) as Array<{
    item_key: string;
    phase: string;
    remediation: string | null;
    fail_reason: string | null;
  }>;

  const blockers: ChecklistBlockerItem[] = rows.map((r) => ({
    item_key: r.item_key,
    phase: r.phase,
    remediation: r.remediation,
    fail_reason: r.fail_reason,
  }));

  return {
    passed: blockers.length === 0,
    blockers,
  };
}

// ════════════════════════════════════════════════════════════
// advanceChecklistPhase
// ════════════════════════════════════════════════════════════

/**
 * Advance the run to the next phase IF all blocking items in current_phase are passed.
 * If blockers remain, returns them without advancing.
 */
export function advanceChecklistPhase(
  input: AdvanceChecklistPhaseInput,
): AdvanceChecklistPhaseResult {
  const db = getDb();
  const ts = now();

  // Check blocking items for current phase
  const result = requireChecklistPassed({
    run_id: input.run_id,
    phase: input.current_phase,
  });

  if (!result.passed) {
    return { advanced: false, blockers: result.blockers };
  }

  try {
    db.transaction(() => {
      // Advance phase
      db.run(
        `UPDATE execution_checklist_runs
         SET phase = ?, updated_at = ?
         WHERE run_id = ?`,
        [input.next_phase, ts, input.run_id],
      );

      // Create items for the new phase
      const items = PHASE_ITEMS[input.next_phase];
      if (items) {
        for (const item of items) {
          const item_id = generateItemId(input.run_id, item.key);
          db.run(
            `INSERT OR IGNORE INTO execution_checklist_items
             (item_id, run_id, item_key, phase, required_when, status, blocking,
              verifier, remediation, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'always', 'pending', 1, ?, ?, ?, ?)`,
            [
              item_id,
              input.run_id,
              item.key,
              input.next_phase,
              item.verifier,
              item.remediation,
              ts,
              ts,
            ],
          );
        }
      }

      // Record phase advance event
      db.run(
        `INSERT INTO execution_checklist_events
         (run_id, event_type, old_status, new_status, message, created_at)
         VALUES (?, 'checklist_phase_advanced', ?, ?, ?, ?)`,
        [
          input.run_id,
          input.current_phase,
          input.next_phase,
          `Phase advanced: ${input.current_phase} → ${input.next_phase}`,
          ts,
        ],
      );
    })();

    writeLog(SRC, "runtime", {
      event: "CHECKLIST-PHASE-ADVANCED",
      detail: `run_id=${input.run_id} from=${input.current_phase} to=${input.next_phase}`,
    });

    return { advanced: true, blockers: [], new_phase: input.next_phase };
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "CHECKLIST-PHASE-ADVANCE-FAILED",
      detail: `run_id=${input.run_id} err=${e.message}`,
    });
    return { advanced: false, blockers: [] };
  }
}

// ════════════════════════════════════════════════════════════
// getChecklistSummary
// ════════════════════════════════════════════════════════════

/**
 * Return an agent-readable summary of the current checklist state.
 * Includes current phase, pending blockers, and next action.
 */
export function getChecklistSummary(input: {
  run_id: string;
}): ChecklistSummary {
  const db = getDb();

  const run = db
    .query(
      `SELECT run_id, phase, status FROM execution_checklist_runs WHERE run_id = ?`,
    )
    .get(input.run_id) as {
    run_id: string;
    phase: string;
    status: string;
  } | null;

  if (!run) {
    return {
      run_id: input.run_id,
      phase: "unknown",
      status: "not_found",
      pending_blockers: [],
      next_action:
        "Run createChecklistRun() to initialize checklist for this session.",
    };
  }

  const blockerResult = requireChecklistPassed({
    run_id: input.run_id,
    phase: run.phase,
  });

  let next_action: string;
  if (blockerResult.blockers.length > 0) {
    const first = blockerResult.blockers[0];
    next_action =
      `Complete blocking item "${first.item_key}" (phase: ${first.phase}): ` +
      (first.remediation || "No remediation specified.");
  } else {
    const phases = Object.keys(PHASE_ITEMS);
    const idx = phases.indexOf(run.phase);
    if (idx >= 0 && idx < phases.length - 1) {
      next_action = `All items passed for phase "${run.phase}". Call advanceChecklistPhase("${run.phase}", "${phases[idx + 1]}").`;
    } else if (run.phase === "close") {
      next_action =
        "All phases complete. Call compliance_gate_complete to close.";
    } else {
      next_action = `All items passed for phase "${run.phase}". Proceed to next phase.`;
    }
  }

  return {
    run_id: run.run_id,
    phase: run.phase,
    status: run.status,
    pending_blockers: blockerResult.blockers,
    next_action,
  };
}

// ════════════════════════════════════════════════════════════
// recordDispatchPayloadIntegrity
// ════════════════════════════════════════════════════════════

/**
 * Record a dispatch payload integrity entry.
 * Called by dispatch-subagent.ts after payload validation.
 */
export function recordDispatchPayloadIntegrity(
  input: DispatchPayloadIntegrityInput,
): boolean {
  const db = getDb();
  const ts = now();
  const payload_id = input.payload_id || generatePayloadId();

  try {
    db.run(
      `INSERT OR REPLACE INTO dispatch_payload_integrity
       (payload_id, dispatch_ref_id, parent_session_id, agent_type, dag_task_id,
        task_description, normalized_payload, sha256, completeness_status,
        completeness_error, prompt_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload_id,
        input.dispatch_ref_id ?? null,
        input.parent_session_id ?? null,
        input.agent_type,
        input.dag_task_id ?? null,
        input.task_description,
        input.normalized_payload,
        input.sha256,
        input.completeness_status,
        input.completeness_error ?? null,
        input.prompt_path ?? null,
        ts,
      ],
    );

    writeLog(SRC, "runtime", {
      event:
        input.completeness_status === "passed"
          ? "PAYLOAD-INTEGRITY-PASSED"
          : "PAYLOAD-INTEGRITY-FAILED",
      detail: `payload_id=${payload_id} status=${input.completeness_status} agent=${input.agent_type}`,
    });

    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "PAYLOAD-INTEGRITY-WRITE-FAILED",
      detail: `payload_id=${payload_id} err=${e.message}`,
    });
    return false;
  }
}

// ════════════════════════════════════════════════════════════
// validateDispatchPayload
// ════════════════════════════════════════════════════════════

/**
 * Validate task description completeness.
 *
 * Detects placeholder/reference patterns (e.g., "provided below", "根据以下")
 * that indicate the description should contain actual content but may be
 * missing it. Rejects descriptions with these patterns that lack substantive
 * content (less than 100 chars of actual description after stripping
 * meta-patterns).
 */
export function validateDispatchPayload(
  input: ValidatePayloadInput,
): ValidatePayloadResult {
  const desc = input.task_description || "";

  // Patterns that signal the description should contain inline content
  const referencePatterns = [
    /provided\s+below/i,
    /以下/,
    /上面的/,
    /the\s+findings/i,
    /specific\s+findings/i,
    /append/i,
    /追加/,
    /根据以下/,
    /如下/,
    /see\s+(above|below)/i,
    /below\s*$/i,
  ];

  const hasReferencePattern = referencePatterns.some((p) => p.test(desc));

  if (!hasReferencePattern) {
    return { passed: true };
  }

  // If description has a reference pattern, it MUST have substantive content.
  // Strip common meta-text to measure actual payload size.
  const metaStripped = desc
    .replace(/^(Task|任务)\s*(Payload|内容|描述)?\s*[:：]/im, "")
    .replace(/##\s*(Task|Payload|Context|Background)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // Consider the description incomplete if it's very short after stripping
  if (metaStripped.length < 100) {
    return {
      passed: false,
      error:
        `PAYLOAD-INCOMPLETE: task description contains reference pattern ` +
        `("provided below", "以下", "the findings", etc.) but has only ` +
        `${metaStripped.length} chars of substantive content (min 100 required). ` +
        `The dispatcher likely omitted the actual findings/artifacts. ` +
        `Ensure the task description includes the concrete content referenced.`,
    };
  }

  // Additional check: the word "provided" alone without actual content
  // after it is suspicious. Check if description ends immediately after
  // a reference phrase without substantive content.
  const endsWithReference = /(below|以下|上面的|追加|如下)\s*$/i.test(
    desc.trim(),
  );

  if (endsWithReference) {
    return {
      passed: false,
      error:
        "PAYLOAD-INCOMPLETE: task description ends with a reference phrase " +
        "without the actual content. The dispatcher must include the referenced " +
        "findings, artifacts, or content inline.",
    };
  }

  return { passed: true };
}

// ═══════════════════════════════════════════════════════════════
// markChecklistRunInterrupted — FW-SESSION-STARTUP-CLEANUP (2026-06-24)
// ═══════════════════════════════════════════════════════════════

/**
 * Mark all active checklist runs in a specific phase as 'interrupted'.
 * Used by session.ts chatMessageHook during interrupt recovery to prevent
 * deadlocks where stuck dispatch_payload phases block all write/shell tools.
 *
 * @param phase - The checklist phase to target (e.g., 'dispatch_payload')
 * @param status - The current status to match (default: 'active')
 * @returns Number of runs marked as interrupted
 */
export function markChecklistRunInterrupted(
  phase: string = "dispatch_payload",
  status: string = "active",
): number {
  try {
    const { getDb } = require("./db-manager");
    const db = getDb();
    const now = Date.now();

    // Query all stuck runs
    const rows = db
      .query(
        `SELECT run_id FROM execution_checklist_runs
         WHERE phase = ? AND status = ?
         ORDER BY updated_at DESC`,
      )
      .all(phase, status) as Array<{ run_id: string }>;

    if (rows.length === 0) return 0;

    // Mark each as interrupted in a transaction
    let count = 0;
    const txn = db.transaction(() => {
      for (const row of rows) {
        const result = db.run(
          `UPDATE execution_checklist_runs
           SET status = 'interrupted', updated_at = ?
           WHERE run_id = ?`,
          [now, row.run_id],
        );
        count += result.changes;
      }
    });
    txn();

    writeLog(SRC, "INFO", {
      event: "CHECKLIST-RUN-INTERRUPT-CLEANUP",
      detail: `${count} checklist run(s) in phase='${phase}' marked as interrupted`,
    });

    return count;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "CHECKLIST-RUN-INTERRUPT-FAILED",
      detail: e.message,
    });
    return 0;
  }
}
