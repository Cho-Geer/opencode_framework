// service/gate/checklist-lifecycle-crud.ts — Checklist run CRUD, mark, interrupt, reset
// Split from: checklist-lifecycle.ts
// Query/summary functions → checklist-query.ts
// Source: execution-checklist.ts (createChecklistRun, mark*, interrupt, reset)

import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";
import {
  PHASE_ITEMS,
  now,
  generateRunId,
  generateItemId,
  isDagExempt,
  type CreateChecklistRunInput,
  type MarkChecklistInput,
  type MarkChecklistFailedInput,
  type ChecklistBlockerItem,
} from "./checklist-phase";

const SRC = "execution-checklist";

// ════════════════════════════════════════════════
// inheritDispatchPayloadItems
// ════════════════════════════════════════════════

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

  const agentNorm = agent.toLowerCase().replace(/^@/, "");

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

  if (parentSessionId && parentSessionId === childSessionId) {
    writeLog(SRC, "runtime", {
      event: "CHECKLIST-PARENT-IS-SELF",
      detail: `child_run=${childRunId} session=${childSessionId} task_id=${taskId} agent=${agent} — skipping self-inheritance`,
    });
    return { inherited: 0, parentSessionId, parentRunId: null };
  }

  db.run(
    `UPDATE execution_checklist_runs
     SET parent_session_id = ?, updated_at = ?
     WHERE run_id = ?`,
    [parentSessionId, ts, childRunId],
  );

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

// ════════════════════════════════════════════════
// createChecklistRun
// ════════════════════════════════════════════════

export function createChecklistRun(input: CreateChecklistRunInput): {
  run_id: string;
  phase: string;
  items_created: number;
} {
  const db = getDb();

  const isMainAgentSession = !input.parent_session_id;
  const isDispatchPayloadExempt =
    isMainAgentSession &&
    (input.agent === "Super-Admin" ||
      input.agent === "@Super-Admin" ||
      input.agent === "Orchestrator" ||
      input.agent === "@Orchestrator");

  const existing = db
    .query(
      `SELECT run_id, phase FROM execution_checklist_runs
       WHERE opencode_session_id = ? AND (task_id = ? OR (task_id IS NULL AND ? IS NULL))
       AND status != 'interrupted'
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
  const initPhase = isDispatchPayloadExempt ? "preflight" : "dispatch_payload";

  const create = db.transaction(() => {
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

    let totalItems = 0;
    let dagExemptDomain: string | null = null;
    if (isDagExempt(input.agent)) {
      try {
        const configPath = path.join(
          process.env.OPENCODE_ROOT || process.cwd(),
          ".opencode",
          "project.config.json",
        );
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        const dam = config.agent_domain_map || {};
        dagExemptDomain = dam[input.agent] || dam["@" + input.agent] || null;
      } catch (_) {
        /* non-fatal */
      }
    }
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
            isDispatchPayloadExempt && phase === "dispatch_payload"
              ? "passed"
              : isDagExempt(input.agent) &&
                  phase === "preflight" &&
                  item.key === "dag_entry_verified"
                ? "passed"
                : isDispatchPayloadExempt &&
                    phase === "preflight" &&
                    (item.key === "agent_scope_resolved" ||
                      item.key === "domain_resolved" ||
                      item.key === "module_scope_declared")
                  ? "passed"
                  : "pending",
            item.verifier,
            item.remediation,
            ts,
            ts,
          ],
        );
        totalItems++;
      }
    }

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

// ════════════════════════════════════════════════
// markChecklistPassed
// ════════════════════════════════════════════════

export function markChecklistPassed(input: MarkChecklistInput): boolean {
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

      if (item.status === "passed") {
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

      db.run(
        `UPDATE execution_checklist_items
         SET status = 'passed', evidence_ref = ?, updated_at = ?
         WHERE run_id = ? AND item_key = ?`,
        [input.evidence_ref ?? null, ts, input.run_id, input.item_key],
      );

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

// ════════════════════════════════════════════════
// markChecklistFailed
// ════════════════════════════════════════════════

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
         (run_id, item_id, event_type, actor, tool_name, old_status, new_status,
          evidence_ref, message, created_at)
         VALUES (?, ?, 'checklist_item_failed', ?, ?, ?, 'failed', ?, ?, ?)`,
        [
          input.run_id,
          item.item_id,
          input.actor ?? null,
          input.evidence_ref ?? null,
          oldStatus,
          input.fail_reason,
          ts,
        ],
      );
    })();

    writeLog(SRC, "runtime", {
      event: "CHECKLIST-ITEM-FAILED",
      detail: `run_id=${input.run_id} item_key=${input.item_key} reason=${input.fail_reason}`,
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

// ════════════════════════════════════════════════
// markChecklistRunInterrupted
// ════════════════════════════════════════════════

export function markChecklistRunInterrupted(runId: string): boolean;
export function markChecklistRunInterrupted(phase: string, status: string): number;
export function markChecklistRunInterrupted(
  runIdOrPhase: string,
  status?: string,
): boolean | number {
  const db = getDb();
  const ts = now();

  // Bulk mode: markChecklistRunInterrupted(phase, status)
  if (status !== undefined) {
    try {
      const result = db.run(
        `UPDATE execution_checklist_runs
         SET status = 'interrupted', updated_at = ?
         WHERE phase = ? AND status = ?`,
        [ts, runIdOrPhase, status],
      );

      const count = (result as any).changes ?? 0;

      if (count > 0) {
        writeLog(SRC, "runtime", {
          event: "CHECKLIST-RUN-INTERRUPTED-BULK",
          detail: `phase=${runIdOrPhase} status=${status} count=${count}`,
        });
      }

      return count;
    } catch (e: any) {
      writeLog(SRC, "ERROR", {
        event: "CHECKLIST-INTERRUPT-BULK-FAILED",
        detail: `phase=${runIdOrPhase} status=${status} err=${e.message}`,
      });
      return 0;
    }
  }

  // Single mode: markChecklistRunInterrupted(runId)
  try {
    db.run(
      `UPDATE execution_checklist_runs
       SET status = 'interrupted', updated_at = ?
       WHERE run_id = ?`,
      [ts, runIdOrPhase],
    );

    writeLog(SRC, "runtime", {
      event: "CHECKLIST-RUN-INTERRUPTED",
      detail: `run_id=${runIdOrPhase}`,
    });

    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "CHECKLIST-INTERRUPT-FAILED",
      detail: `run_id=${runIdOrPhase} err=${e.message}`,
    });
    return false;
  }
}
// ════════════════════════════════════════════════
// resetChecklistItemToPending
// ════════════════════════════════════════════════

export function resetChecklistItemToPending(
  runId: string,
  itemKey: string,
): boolean {
  const db = getDb();
  const ts = now();

  try {
    db.run(
      `UPDATE execution_checklist_items
       SET status = 'pending', fail_reason = NULL, evidence_ref = NULL, updated_at = ?
       WHERE run_id = ? AND item_key = ?`,
      [ts, runId, itemKey],
    );

    writeLog(SRC, "runtime", {
      event: "CHECKLIST-ITEM-RESET",
      detail: `run_id=${runId} item_key=${itemKey}`,
    });

    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "CHECKLIST-RESET-FAILED",
      detail: `run_id=${runId} item_key=${itemKey} err=${e.message}`,
    });
    return false;
  }
}
