// safe_bash: allow-write
/**
 * FW-REPAIR-13: safe_bash allow-write granted — this is a framework state repair tool
 * that only writes to .opencode/state/ files. Always invoked via `node state-reconciliation.ts`.
 *
 * state-reconciliation.ts — State Reconciliation Daemon
 * ======================================================
 * P5-003: Gate-state ↔ DAG ↔ machine.json consistency checks with auto-repair.
 *
 * Checks:
 *   #1 — Every completed DAG task has a consumed gate session
 *   #2 — Every armed gate session references a pending/in_progress DAG task
 *   #3 — No orphaned sessions (armed >24h with completed tasks)
 *   #4 — DAG meta counts match actual task statuses
 *
 * Usage:
 *   node .opencode/scripts/state-reconciliation.ts [options]
 *     --json           Output raw JSON report (default: human-readable)
 *     --fix            Auto-fix resolvable inconsistencies (stale sessions, meta counts)
 *     --strict         Exit 1 if ANY inconsistency found
 *     --dry-run        Show what would be fixed without modifying state
 *     --quick          Skip Check #1 (completed_task_no_gate_session — the
 *                      write-audit deep scan). Checks #2, #3, #4 only.
 *                      Used by pre-execution-hook.sh for fast gate validation.
 *     --force-drain    Drain orphaned armed sessions regardless of age if they
 *                      have no DAG task reference or are test artifacts
 *                      (descriptions like "test for arming", "test for double arm")
 *     --backfill-audit Create synthetic compliance_records in machine.json for
 *                      completed DAG tasks lacking consumed gate sessions
 */

const fs = require("fs");
const path = require("path");

/**
 * FW-LOG-UNIFY-C5: Lazy-load writeLog to record reconciliation outcomes.
 */
let _writeLog = null;
function getWriteLog() {
  if (!_writeLog) {
    try {
      const lm = require(path.join(__dirname, "..", "lib", "log-manager"));
      _writeLog = lm.writeLog;
    } catch { _writeLog = () => {}; }
  }
  return _writeLog;
}
function srcLog(level, event, fields) {
  try { getWriteLog()("script-state-reconciliation", level, { event, ...fields }); } catch {}
}

const OPENCODE_ROOT = process.env.OPENCODE_ROOT
  ? path.resolve(process.env.OPENCODE_ROOT)
  : path.resolve(__dirname, "..", "..");

// ─── Paths ────────────────────────────────────────────────
const DAG_PATH = path.join(OPENCODE_ROOT, "Task.DAG.json");
const GATE_PATH = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "state",
  "gate-state.json",
);
const MACHINE_PATH = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "state",
  "machine.json",
);

// ─── Read Helpers ─────────────────────────────────────────
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (err) {
    return null;
  }
}

function safeGet(obj, ...keys) {
  for (const k of keys) {
    if (obj == null) return undefined;
    obj = obj[k];
  }
  return obj;
}

/**
 * Normalize gate-state from V3 format (active_sessions + recent_sessions) to a
 * V2-compatible view with a combined `sessions` object.
 *
 * V3 hot file: { active_sessions, recent_sessions, meta }
 * V2 hot file: { sessions, active_sessions, drained_sessions, ... }
 *
 * This shim merges active_sessions + recent_sessions into a virtual `sessions`
 * field so all existing reconciliation logic continues to work.
 */
function normalizeGateV3(gate) {
  if (!gate) return gate;
  // Already has V2-style sessions map — no conversion needed
  if (gate.sessions) return gate;
  // V3: combine active_sessions + recent_sessions into virtual sessions
  gate.sessions = Object.assign(
    {},
    gate.active_sessions || {},
    gate.recent_sessions || {},
  );
  return gate;
}

/**
 * Build a unified task ID → pseudo-task map from BOTH dag.tasks[] and
 * dag.execution_order groups (flat arrays and nested object groups).
 *
 * WHY: Many DAGs organize tasks in execution_order groups rather than a
 * flat tasks[] array (e.g. after hot-file compaction). Previously the
 * three reconciliation checks only scanned dag.tasks[], producing false
 * "armed_session_orphan_task" HIGH findings for any armed session whose
 * task_id lived in execution_order only.
 *
 * Tasks from tasks[] retain their real status and owner fields. Tasks
 * found only in execution_order have status inferred as "pending"
 * (scheduled for execution) and owner "" — there is no per-task
 * metadata in execution_order groups.
 *
 * @since FW-REPAIR-STATE-RECON-EXECORDER (2026-06-14)
 */
function buildTaskMap(dag) {
  const taskMap = {};
  // 1) tasks[] takes precedence — real per-task metadata
  const tasks = dag.tasks || [];
  for (const t of tasks) {
    if (t && t.id) taskMap[t.id] = t;
  }
  // 2) execution_order groups — flat arrays and nested object groups
  const eo = dag.execution_order;
  if (eo && typeof eo === "object") {
    for (const group of Object.values(eo)) {
      if (Array.isArray(group)) {
        for (const id of group) {
          if (typeof id === "string" && !taskMap[id]) {
            taskMap[id] = { id, status: "pending", owner: "", source: "execution_order" };
          }
        }
      } else if (group && typeof group === "object") {
        for (const subgroup of Object.values(group)) {
          if (Array.isArray(subgroup)) {
            for (const id of subgroup) {
              if (typeof id === "string" && !taskMap[id]) {
                taskMap[id] = { id, status: "pending", owner: "", source: "execution_order" };
              }
            }
          }
        }
      }
    }
  }
  return taskMap;
}

// ─── Check #1: Completed DAG tasks have consumed gate sessions ──
function checkCompletedDagHasGateSession(dag, gate, machine) {
  const inconsistencies = [];
  const tasks = dag.tasks || [];
  const sessions = gate.sessions || {};

  // Build a set of tasks that have reconciled compliance records
  const reconciledTaskIds = new Set();
  if (machine && machine.compliance_records) {
    const allRecords = [
      ...(machine.compliance_records.gate_violations || []),
      ...(machine.compliance_records.role_violations || []),
      ...(machine.compliance_records.tdd_violations || []),
    ];
    for (const rec of allRecords) {
      if (rec.reconciled && rec.session_id) {
        reconciledTaskIds.add(rec.session_id);
      }
    }
  }

  for (const task of tasks) {
    if (task.status === "completed") {
      // If this task has a reconciled compliance record, skip it
      if (reconciledTaskIds.has(task.id)) continue;

      // Look for a gate session that references this task_id
      const matchingSession = Object.entries(sessions).find(
        ([sid, s]) =>
          s.task_id === task.id || s.task_description?.includes(task.id),
      );

      if (!matchingSession) {
        inconsistencies.push({
          type: "completed_task_no_gate_session",
          severity: "WARNING",
          task_id: task.id,
          detail: `Task "${task.id}" is completed but has no matching gate session in gate-state.json`,
        });
        continue;
      }

      const [sid, session] = matchingSession;

      // Check if session was consumed (completed or failed)
      if (
        session.gate_status !== "completed" &&
        session.gate_status !== "failed"
      ) {
        inconsistencies.push({
          type: "completed_task_unconsumed_session",
          severity: "WARNING",
          task_id: task.id,
          session_id: sid,
          gate_status: session.gate_status,
          detail: `Task "${task.id}" is completed but its gate session (${sid}) has status "${session.gate_status}" (not consumed)`,
        });
      }
    }
  }

  return {
    passed: inconsistencies.length === 0,
    inconsistencies,
    description: "Every completed DAG task has a consumed gate session",
  };
}

// ─── Check #2: Armed sessions reference valid DAG tasks ──
function checkArmedSessionDagReference(dag, gate) {
  const inconsistencies = [];
  const tasks = dag.tasks || [];
  const sessions = gate.sessions || {};
  // FW-REPAIR-13: Handle V3 format (active_sessions is object) or V2 format (array)
  const rawActive = gate.active_sessions || [];
  const activeSessions = Array.isArray(rawActive)
    ? rawActive
    : Object.keys(rawActive);
  const taskMap = buildTaskMap(dag);

  for (const sid of activeSessions) {
    const session = sessions[sid];
    if (!session) {
      inconsistencies.push({
        type: "active_session_missing",
        severity: "HIGH",
        session_id: sid,
        detail: `Session ${sid} is in active_sessions but does not exist in sessions map`,
      });
      continue;
    }

    // Only check armed sessions
    if (session.gate_status !== "armed") continue;

    // SA-FIX-RECONCILER-EXEMPT (@Super-Admin): DAG-exempt agents bypass DAG reference check.
    // Super-Admin (emergency framework repairs), Meta-Planner and Orchestrator (DAG creators)
    // operate outside DAG coverage per pre-execution-gate.ts lines 303-314 and 793-814.
    // Without this exemption, reconciler Check 2 falsely reports HIGH inconsistencies
    // for armed gate sessions that legitimately reference non-DAG task_ids.
    const DAG_EXEMPT_AGENTS = [
      "super-admin", "@super-admin",
      "meta-planner", "@meta-planner",
      "orchestrator", "@orchestrator",
    ];
    const sessionAgent = (session.agent || "").toLowerCase();
    if (DAG_EXEMPT_AGENTS.includes(sessionAgent)) continue;

    const taskId = session.task_id;
    if (!taskId) {
      inconsistencies.push({
        type: "armed_session_no_task_id",
        severity: "WARNING",
        session_id: sid,
        detail: `Armed session ${sid} has no task_id field to cross-reference`,
      });
      continue;
    }

    const dagTask = taskMap[taskId];
    if (!dagTask) {
      inconsistencies.push({
        type: "armed_session_orphan_task",
        severity: "HIGH",
        session_id: sid,
        task_id: taskId,
        detail: `Armed session ${sid} references task "${taskId}" which does not exist in Task.DAG.json`,
      });
      continue;
    }

    if (dagTask.status === "completed") {
      // Downgrade to WARNING when all DAG tasks are completed (maintenance mode)
      const anyPending = tasks.some((t) => t.status !== "completed");
      inconsistencies.push({
        type: "armed_session_completed_task",
        severity: anyPending ? "HIGH" : "WARNING",
        session_id: sid,
        task_id: taskId,
        detail: `Armed session ${sid} references completed task "${taskId}" (should be consumed)`,
      });
    }
  }

  return {
    passed: inconsistencies.length === 0,
    inconsistencies,
    description: "Every armed gate session references a valid DAG task",
  };
}

// ─── Check #3: No orphaned sessions (armed >24h with completed tasks) ──
function checkOrphanedSessions(dag, gate) {
  const inconsistencies = [];
  const tasks = dag.tasks || [];
  const sessions = gate.sessions || {};
  const taskMap = buildTaskMap(dag);

  const STALE_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const [sid, session] of Object.entries(sessions)) {
    if (session.gate_status !== "armed") continue;
    if (!session.confirmed_at) continue;

    const age = now - new Date(session.confirmed_at).getTime();
    if (age <= STALE_MS) continue;

    // Session is armed and >24h old
    const taskId = session.task_id;
    let reason = "";

    if (taskId && taskMap[taskId]) {
      const dagTask = taskMap[taskId];
      if (dagTask.status === "completed") {
        reason = `Task "${taskId}" is completed but gate session ${sid} is still armed (${Math.floor(age / 3600000)}h old)`;
      } else if (dagTask.status === "pending") {
        reason = `Gate session ${sid} has been armed for ${Math.floor(age / 3600000)}h for pending task "${taskId}"`;
      } else {
        reason = `Gate session ${sid} has been armed for ${Math.floor(age / 3600000)}h for task "${taskId}" (status: ${dagTask.status})`;
      }
    } else if (taskId && !taskMap[taskId]) {
      reason = `Gate session ${sid} references non-existent task "${taskId}" and is ${Math.floor(age / 3600000)}h old`;
    } else {
      reason = `Gate session ${sid} has been armed for ${Math.floor(age / 3600000)}h with no task reference`;
    }

    inconsistencies.push({
      type: "stale_armed_session",
      severity: "HIGH",
      session_id: sid,
      task_id: taskId || null,
      age_hours: Math.floor(age / 3600000),
      detail: reason,
    });
  }

  return {
    passed: inconsistencies.length === 0,
    inconsistencies,
    description: "No orphaned sessions (armed >24h with completed tasks)",
  };
}

// ─── Check #4: DAG meta counts match actual task statuses ──
function checkDagMetaCounts(dag) {
  const inconsistencies = [];
  const tasks = dag.tasks || [];
  const meta = dag.meta || {};

  let actualCompleted = 0;
  let actualPending = 0;
  let actualInProgress = 0;
  let actualOther = 0;

  for (const task of tasks) {
    switch (task.status) {
      case "completed":
        actualCompleted++;
        break;
      case "pending":
        actualPending++;
        break;
      case "in_progress":
        actualInProgress++;
        break;
      default:
        actualOther++;
    }
  }

  const actualTotal = tasks.length;

  if (meta.completed_tasks !== actualCompleted) {
    inconsistencies.push({
      type: "meta_completed_mismatch",
      severity: "HIGH",
      meta_value: meta.completed_tasks,
      actual_value: actualCompleted,
      detail: `meta.completed_tasks is ${meta.completed_tasks} but actual completed count is ${actualCompleted}`,
    });
  }

  if (meta.pending_tasks !== actualPending) {
    inconsistencies.push({
      type: "meta_pending_mismatch",
      severity: "HIGH",
      meta_value: meta.pending_tasks,
      actual_value: actualPending,
      detail: `meta.pending_tasks is ${meta.pending_tasks} but actual pending count is ${actualPending}`,
    });
  }

  if (meta.total_tasks !== actualTotal) {
    inconsistencies.push({
      type: "meta_total_mismatch",
      severity: "HIGH",
      meta_value: meta.total_tasks,
      actual_value: actualTotal,
      detail: `meta.total_tasks is ${meta.total_tasks} but actual task count is ${actualTotal}`,
    });
  }

  return {
    passed: inconsistencies.length === 0,
    inconsistencies,
    actual_counts: {
      total: actualTotal,
      completed: actualCompleted,
      pending: actualPending,
      in_progress: actualInProgress,
      other: actualOther,
    },
    description: "DAG meta counts match actual task statuses",
  };
}

// ─── Fix: drain orphaned sessions (>24h stale) ─────────────
function fixDrainOrphanedSessions(gate) {
  const STALE_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  let drained = 0;
  const drainedList = [];

  const sessionIds = Object.keys(gate.sessions);
  for (const sid of sessionIds) {
    const s = gate.sessions[sid];
    if (!s) continue;
    if (s.gate_status !== "armed") continue;
    if (!s.confirmed_at) continue;

    const age = now - new Date(s.confirmed_at).getTime();
    if (age <= STALE_MS) continue;

    // Drain this session
    s.gate_status = "drained";
    s.drained_at = new Date().toISOString();
    s.drain_reason = "auto-reconciled: stale armed session >24h";
    // FW-REPAIR-13: V2 (array) → use filter; V3 (object) → use delete
    if (Array.isArray(gate.active_sessions)) {
      gate.active_sessions = gate.active_sessions.filter((a) => a !== sid);
    } else {
      delete gate.active_sessions[sid];
    }
    // P0-FIX-QUAD-02: Write to drained_sessions Record (object) in addition to in-place status.
    // Ensures consistency with gate-lifecycle-audit.ts and gate-core.ts canonical type.
    if (!gate.drained_sessions) gate.drained_sessions = {};
    gate.drained_sessions[sid] = {
      ...s,
      drained_at: new Date().toISOString(),
      drain_reason: "auto-reconciled: stale armed session >24h",
    };
    drained++;
    drainedList.push(sid);
  }

  return { drained, drainedList };
}

// ─── Fix: force-drain orphaned sessions regardless of age ──
function fixForceDrainOrphanedSessions(gate, dag) {
  const tasks = dag.tasks || [];
  const taskMap = buildTaskMap(dag);

  const testArtifactPatterns = [
    /^test for /i,
    /^test: /i,
    /test artifact/i,
    /^test of /i,
    /test for arm/i,
    /test for double arm/i,
  ];

  let drained = 0;
  const drainedList = [];

  const sessionIds = Object.keys(gate.sessions);
  for (const sid of sessionIds) {
    const s = gate.sessions[sid];
    if (!s) continue;

    // Only drain armed or checked sessions (not already completed/failed/drained)
    if (s.gate_status !== "armed" && s.gate_status !== "checked") continue;

    const taskId = s.task_id;
    const desc = s.task_description || "";
    let shouldDrain = false;
    let reason = "";

    // Check 1: No task_id at all
    if (!taskId) {
      // Check if description matches test artifact patterns
      const isTestArtifact = testArtifactPatterns.some((p) => p.test(desc));
      if (isTestArtifact) {
        shouldDrain = true;
        reason =
          "force-drained: test artifact session with no DAG task reference";
      } else {
        shouldDrain = true;
        reason = "force-drained: session has no task_id field";
      }
    }
    // Check 2: Task_id doesn't exist in DAG
    else if (!taskMap[taskId]) {
      shouldDrain = true;
      reason = `force-drained: session references task "${taskId}" which does not exist in DAG`;
    }

    if (!shouldDrain) continue;

    s.gate_status = "drained";
    s.drained_at = new Date().toISOString();
    s.drain_reason = reason;
    // FW-REPAIR-13: V2 (array) → use filter; V3 (object) → use delete
    if (Array.isArray(gate.active_sessions)) {
      gate.active_sessions = gate.active_sessions.filter((a) => a !== sid);
    } else {
      delete gate.active_sessions[sid];
    }
    drained++;
    drainedList.push({ session_id: sid, reason });
  }

  return { drained, drainedList };
}

// ─── Fix: backfill compliance records for completed DAG tasks ──
function backfillComplianceRecords(dag, machine) {
  const tasks = dag.tasks || [];
  const records = [];

  // Build a set of task_ids already tracked in write_audit_state
  const auditTaskIds = new Set();
  const was = machine.write_audit_state || {};
  if (was.current_session && was.current_session.task_id) {
    auditTaskIds.add(was.current_session.task_id);
  }
  if (was.history && Array.isArray(was.history)) {
    for (const h of was.history) {
      if (h.task_id) auditTaskIds.add(h.task_id);
    }
  }

  const gateSessions = {};
  // We'll read gate-state directly in the reconcile function

  let backfilled = 0;
  const backfilledList = [];

  for (const task of tasks) {
    if (task.status !== "completed") continue;

    // If already has a write_audit record, skip
    if (auditTaskIds.has(task.id)) continue;

    backfilled++;
    const record = {
      session_id: task.id,
      reconciled: true,
      reconciled_at: new Date().toISOString(),
      original_status: "completed",
      detail: `Backfilled by state-reconciliation --backfill-audit for completed task "${task.id}"`,
    };
    records.push(record);
    backfilledList.push(task.id);
  }

  // Append records to machine.json compliance_records.gate_violations
  if (!machine.compliance_records) {
    machine.compliance_records = {
      role_violations: [],
      gate_violations: [],
      tdd_violations: [],
    };
  }
  if (!machine.compliance_records.gate_violations) {
    machine.compliance_records.gate_violations = [];
  }

  for (const record of records) {
    machine.compliance_records.gate_violations.push(record);
  }

  return { backfilled, backfilledList };
}

// ─── Fix: correct DAG meta counts ──────────────────────────
function fixDagMetaCounts(dag) {
  const tasks = dag.tasks || [];
  let completed = 0;
  let pending = 0;
  let inProgress = 0;

  for (const t of tasks) {
    switch (t.status) {
      case "completed":
        completed++;
        break;
      case "pending":
        pending++;
        break;
      case "in_progress":
        inProgress++;
        break;
    }
  }

  const total = tasks.length;
  if (!dag.meta) dag.meta = {};

  dag.meta.total_tasks = total;
  dag.meta.completed_tasks = completed;
  dag.meta.pending_tasks = pending;
  dag.meta.last_updated = new Date().toISOString();

  // Recalculate progress
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  dag.meta.progress = pct + "%";

  return {
    total,
    completed,
    pending,
    inProgress,
  };
}

// ─── Main Reconciliation ───────────────────────────────────
function reconcile(options = {}) {
  const results = {
    valid: true,
    timestamp: new Date().toISOString(),
    checks: {
      check1: null,
      check2: null,
      check3: null,
      check4: null,
      check5: null,
      check6: null,
      check7: null,
    },
    inconsistencies: [],
    auto_fixable: false,
    fixes_applied: null,
  };

  // Read state files
  const dag = readJson(DAG_PATH);
  const gate = readJson(GATE_PATH);
  normalizeGateV3(gate); // V3→V2 shim: merge active_sessions + recent_sessions → sessions
  const machine = readJson(MACHINE_PATH);

  if (!dag) {
    return {
      ...results,
      valid: false,
      inconsistencies: [
        {
          type: "dag_not_found",
          severity: "HIGH",
          detail: `Cannot read Task.DAG.json at ${DAG_PATH}`,
        },
      ],
    };
  }
  if (!gate) {
    return {
      ...results,
      valid: false,
      inconsistencies: [
        {
          type: "gate_not_found",
          severity: "HIGH",
          detail: `Cannot read gate-state.json at ${GATE_PATH}`,
        },
      ],
    };
  }

  // Run checks (skip Check #1 in --quick mode)
  const check1 = options.quick
    ? {
        passed: true,
        inconsistencies: [],
        description: "Skipped (--quick mode)",
      }
    : checkCompletedDagHasGateSession(dag, gate, machine);
  const check2 = checkArmedSessionDagReference(dag, gate);
  const check3 = checkOrphanedSessions(dag, gate);
  const check4 = checkDagMetaCounts(dag);

  results.checks.check1 = check1;
  results.checks.check2 = check2;
  results.checks.check3 = check3;
  results.checks.check4 = check4;
  results.quick_mode = options.quick || false;

  // Collect all inconsistencies
  const allInconsistencies = [
    ...check1.inconsistencies,
    ...check2.inconsistencies,
    ...check3.inconsistencies,
    ...check4.inconsistencies,
  ];
  results.inconsistencies = allInconsistencies;
  results.valid = allInconsistencies.length === 0;

  // Determine auto-fixable
  const highIssues = allInconsistencies.filter((i) => i.severity === "HIGH");
  const hasStaleSessions = allInconsistencies.some(
    (i) => i.type === "stale_armed_session",
  );
  const hasMetaMismatch = allInconsistencies.some(
    (i) => i.type && i.type.startsWith("meta_"),
  );
  results.auto_fixable = hasStaleSessions || hasMetaMismatch;

  // SA-IMPL-LEGACY-FIXES: Pre-check Check6 so --fix block can repair knowledge_state drift
  // even when no stale sessions or meta mismatches exist.
  const check6Pre = checkKnowledgeStateIntegrity(OPENCODE_ROOT);
  if (!check6Pre.ok) {
    results.auto_fixable = true;
  }

  // ─── --fix flag: apply auto-repair ──────────────────────

  if (options.fix && results.auto_fixable) {
    const fixes = { drained: 0, meta_corrected: false, details: [] };
    const MACHINE_PATH = path.join(OPENCODE_ROOT, ".opencode", "state", "machine.json");
    const indexPath = path.join(OPENCODE_ROOT, "docs", "official_docs", "index.json");

    // Check6 fix: knowledge_state drift (SA-IMPL-LEGACY-FIXES)
    if (!check6Pre.ok && fs.existsSync(indexPath) && fs.existsSync(MACHINE_PATH)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(indexPath, "utf8"));
        const machine = JSON.parse(fs.readFileSync(MACHINE_PATH, "utf8"));
        machine.knowledge_state = machine.knowledge_state || {};
        const oldCount = machine.knowledge_state.total_docs_count || 0;
        const oldSize = machine.knowledge_state.total_size_bytes || 0;
        machine.knowledge_state.total_docs_count = manifest.entries.length;
        // Recalculate total size from actual docs/official_docs files
        let actualSize = 0;
        const docsDir = path.join(OPENCODE_ROOT, "docs", "official_docs");
        const walk = (dir: string) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
              walk(full);
            } else {
              actualSize += fs.statSync(full).size;
            }
          }
        };
        if (fs.existsSync(docsDir)) walk(docsDir);
        machine.knowledge_state.total_size_bytes = actualSize;
        fs.writeFileSync(MACHINE_PATH, JSON.stringify(machine, null, 2), "utf8");
        console.error(
          `[fix] check6: total_docs_count ${oldCount} → ${manifest.entries.length}, total_size_bytes ${oldSize} → ${actualSize}`,
        );
      } catch (e: any) {
        console.error(`[fix] check6: ${e.message}`);
      }
    }

    // Fix stale sessions (>24h)
    const drainResult = fixDrainOrphanedSessions(gate);
    fixes.drained = drainResult.drained;
    if (drainResult.drained > 0) {
      fixes.details.push(
        `Drained ${drainResult.drained} stale sessions: ${drainResult.drainedList.join(", ")}`,
      );
    }

    // Fix DAG meta counts
    const corrected = fixDagMetaCounts(dag);
    fixes.meta_corrected = true;
    fixes.details.push(
      `Corrected DAG meta: ${corrected.total} total, ${corrected.completed} completed, ${corrected.pending} pending`,
    );

    // Write files if any changes were made
    let gateChanged = drainResult.drained > 0;
    let dagChanged = check4.inconsistencies.length > 0;

    if (gateChanged) {
      delete gate.sessions; // Remove V3→V2 virtual field before writing back
      const gateContent = JSON.stringify(gate, null, 2) + "\n";
      fs.writeFileSync(GATE_PATH, gateContent, "utf-8");
    }
    if (dagChanged) {
      const dagContent = JSON.stringify(dag, null, 2) + "\n";
      fs.writeFileSync(DAG_PATH, dagContent, "utf-8");
    }

    results.fixes_applied = fixes;
  }

  // ─── --force-drain flag: drain orphaned sessions regardless of age ──
  if (options.forceDrain) {
    const forceResult = fixForceDrainOrphanedSessions(gate, dag);
    if (!results.force_drain) results.force_drain = {};
    results.force_drain.drained = forceResult.drained;
    results.force_drain.drainedList = forceResult.drainedList;

    if (forceResult.drained > 0) {
      delete gate.sessions; // Remove V3→V2 virtual field before writing back
      const gateContent = JSON.stringify(gate, null, 2) + "\n";
      fs.writeFileSync(GATE_PATH, gateContent, "utf-8");
    }
  }

  // ─── --backfill-audit flag: create synthetic compliance records ──
  if (options.backfillAudit) {
    const backfillResult = backfillComplianceRecords(dag, machine);
    if (!results.backfill_audit) results.backfill_audit = {};
    results.backfill_audit.backfilled = backfillResult.backfilled;
    results.backfill_audit.backfilledList = backfillResult.backfilledList;

    if (backfillResult.backfilled > 0) {
      const machineContent = JSON.stringify(machine, null, 2) + "\n";
      fs.writeFileSync(MACHINE_PATH, machineContent, "utf-8");
    }
  }

  // ─── --dry-run flag ─────────────────────────────────────
  if (options.dryRun && results.auto_fixable) {
    results.dry_run_plan = {};

    if (hasStaleSessions) {
      const staleSessions = allInconsistencies
        .filter((i) => i.type === "stale_armed_session")
        .map((i) => ({
          session_id: i.session_id,
          task_id: i.task_id,
          age_hours: i.age_hours,
        }));
      results.dry_run_plan.drain_sessions = staleSessions;
    }

    if (hasMetaMismatch) {
      results.dry_run_plan.correct_meta = {
        reported: {
          total: dag.meta?.total_tasks,
          completed: dag.meta?.completed_tasks,
          pending: dag.meta?.pending_tasks,
        },
        actual: check4.actual_counts,
      };
    }
  }

  // ─── --dry-run for --force-drain ────────────────────────
  if (options.dryRun && options.forceDrain) {
    if (!results.dry_run_plan) results.dry_run_plan = {};
    const dagLocal = readJson(DAG_PATH);
    const gateLocal = readJson(GATE_PATH);
    normalizeGateV3(gateLocal); // V3→V2 shim
    if (dagLocal && gateLocal) {
      const result = fixForceDrainOrphanedSessions(gateLocal, dagLocal);
      results.dry_run_plan.force_drain = {
        count: result.drained,
        sessions: result.drainedList,
      };
    }
  }

  // ─── --dry-run for --backfill-audit ─────────────────────
  if (options.dryRun && options.backfillAudit) {
    if (!results.dry_run_plan) results.dry_run_plan = {};
    const dagLocal = readJson(DAG_PATH);
    const machineLocal = readJson(MACHINE_PATH);
    if (dagLocal && machineLocal) {
      const result = backfillComplianceRecords(dagLocal, machineLocal);
      results.dry_run_plan.backfill_audit = {
        count: result.backfilled,
        tasks: result.backfilledList,
      };
    }
  }

  // ─── Check #5: Hierarchical v3 state cross-file integrity ───
  /**
   * @super-admin FW-REPAIR-ITEM1: Re-apply raw5 normalization wrapper lost in framework update.
   * check5 now uses the same { passed, description, details, summary } pattern as check6 (raw6 wrapper).
   * This ensures consistent output format for the --fix flag and downstream consumers.
   */
  const raw5 = checkHierarchicalStateIntegrity(OPENCODE_ROOT);
  const check5 = {
    passed: raw5.valid,
    description: raw5.valid
      ? "all hierarchical state integrity checks passed"
      : raw5.issues.map((i) => i.detail).join("; "),
    details: raw5.issues,
    summary: raw5.summary,
  };
  results.checks.check5 = check5;
  if (!raw5.valid) {
    results.valid = false;
    for (const issue of raw5.issues) {
      results.inconsistencies.push({
        check: "check5_hierarchical_state",
        gate_session: issue.ref,
        severity: issue.severity,
        detail: issue.detail,
      });
    }
  }

  // ─── Check #6: UC7KS knowledge_state ↔ index.json sync (UC7-HARDEN-08) ───
  const raw6 = checkKnowledgeStateIntegrity(OPENCODE_ROOT);
  const check6 = {
    passed: raw6.ok,
    description: raw6.detail,
    inconsistencies: raw6.fixes.map((f) => ({ detail: f })),
  };
  results.checks.check6 = check6;
  if (!check6.passed) {
    results.valid = false;
    results.inconsistencies.push({
      check: "check6_knowledge_state",
      severity: "WARNING",
      detail: raw6.detail,
    });
  }

  // Check 7: Session access integrity (SA-IMPL-SELF-CLEANUP, 2026-06-11)
  // Detects stale/invalid agent entries in knowledge_cache_state.session_access.
  const raw7 = checkSessionAccessIntegrity(OPENCODE_ROOT);
  const check7 = {
    passed: raw7.ok,
    description: raw7.detail,
    inconsistencies: raw7.fixes.map((f) => ({ detail: f })),
  };
  results.checks.check7 = check7;
  if (!check7.passed) {
    results.valid = false;
    results.inconsistencies.push({
      check: "check7_session_access",
      severity: raw7.invalidEntries?.length > 0 ? "HIGH" : "WARNING",
      detail: raw7.detail,
    });
  }

  // SA-IMPL-LEGACY-FIXES: Check6 auto-fix (must be evaluated before --fix block)
  if (!check6.passed) {
    results.auto_fixable = true;
  }

  return results;
}

// ─── CLI Interface ────────────────────────────────────────
function runCLI() {
  const args = process.argv.slice(2);
  const options = {
    json: args.includes("--json"),
    fix: args.includes("--fix"),
    strict: args.includes("--strict"),
    dryRun: args.includes("--dry-run"),
    quick: args.includes("--quick"),
    forceDrain: args.includes("--force-drain"),
    backfillAudit: args.includes("--backfill-audit"),
  };

  if (options.quick) {
    console.error(
      "⚡ [State Reconciliation] Quick mode — skipping Check #1 (write-audit deep scan)",
    );
  }
  if (options.forceDrain) {
    console.error(
      "💪 [State Reconciliation] Force-drain mode — draining orphaned sessions regardless of age",
    );
  }
  if (options.backfillAudit) {
    console.error(
      "📋 [State Reconciliation] Backfill-audit mode — creating synthetic compliance records for completed tasks",
    );
  }

  const result = reconcile(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const statusIcon = result.valid ? "✅" : "❌";
    const quickTag = result.quick_mode ? " ⚡ Quick mode" : "";
    console.log(
      `\n${statusIcon} [State Reconciliation]${quickTag} ${result.timestamp}\n`,
    );

    /**
     * @super-admin FW-REPAIR-ITEM1-NULLGUARD: Add defensive null guard for checks
     * that may be unset due to early returns or partial reconciliation. Prevents
     * "Cannot read properties of null (reading 'passed')" crash in CLI formatter.
     */
    for (const [checkName, check] of Object.entries(result.checks)) {
      if (!check) {
        console.log(`  ⚠️  ${checkName}: (not executed — skipped)`);
        continue;
      }
      const icon = check.passed ? "✅" : "❌";
      const issueCount = check.inconsistencies?.length || 0;
      console.log(`  ${icon} ${checkName}: ${check.description}`);
      if (issueCount > 0) {
        console.log(`     (${issueCount} issue(s))`);
        for (const inc of check.inconsistencies) {
          console.log(`     [${inc.severity}] ${inc.detail}`);
        }
      }
    }

    if (result.inconsistencies.length > 0) {
      const highCount = result.inconsistencies.filter(
        (i) => i.severity === "HIGH",
      ).length;
      const warnCount = result.inconsistencies.filter(
        (i) => i.severity === "WARNING",
      ).length;
      console.log(
        `\n  📊 Summary: ${result.inconsistencies.length} total inconsistency(ies) — ${highCount} HIGH, ${warnCount} WARNING`,
      );
      console.log(
        `  🔧 Auto-fixable: ${result.auto_fixable ? "Yes (run with --fix)" : "No"}`,
      );
      srcLog("WARN", "reconciliation_found_issues", { total: result.inconsistencies.length, high: highCount, warning: warnCount });
    } else {
      console.log(`\n  ✅ All checks passed — no inconsistencies found.`);
      srcLog("INFO", "reconciliation_complete", { total: 0 });
    }

    if (result.dry_run_plan) {
      console.log(`\n  📋 Dry-run plan (--fix would apply):`);
      if (result.dry_run_plan.drain_sessions?.length) {
        console.log(
          `    Drain ${result.dry_run_plan.drain_sessions.length} stale session(s)`,
        );
        for (const s of result.dry_run_plan.drain_sessions) {
          console.log(
            `      - ${s.session_id} (${s.age_hours}h, task: ${s.task_id})`,
          );
        }
      }
      if (result.dry_run_plan.correct_meta) {
        const m = result.dry_run_plan.correct_meta;
        console.log(
          `    Correct DAG meta: total ${m.reported.total}→${m.actual.total}, ` +
            `completed ${m.reported.completed}→${m.actual.completed}, ` +
            `pending ${m.reported.pending}→${m.actual.pending}`,
        );
      }
    }



    if (result.force_drain) {
      console.log(`\n  💪 Force-drain results:`);
      console.log(`    Drained sessions: ${result.force_drain.drained}`);
      for (const entry of result.force_drain.drainedList || []) {
        const sid = typeof entry === "string" ? entry : entry.session_id;
        const reason = typeof entry === "string" ? "" : entry.reason || "";
        console.log(`    - ${sid}${reason ? ` (${reason})` : ""}`);
      }
    }

    if (result.backfill_audit) {
      console.log(`\n  📋 Backfill-audit results:`);
      console.log(
        `    Backfilled records: ${result.backfill_audit.backfilled}`,
      );
      for (const tid of result.backfill_audit.backfilledList || []) {
        console.log(`    - ${tid}`);
      }
    }
  }


}

if (require.main === module) {
  runCLI();
}

function validateWriteAuditIntegrity(machine, rootDir) {
  const violations = [];
  let filesChecked = 0,
    filesPassed = 0,
    filesFailed = 0;
  const crypto = require("crypto");
  function sha256(content) {
    return (
      "sha256-" + crypto.createHash("sha256").update(content).digest("hex")
    );
  }

  function checkFile(fileEntry, session) {
    filesChecked++;
    const fp = typeof fileEntry === "string" ? fileEntry : fileEntry.path;
    const expectedHash = typeof fileEntry === "string" ? null : fileEntry.hash;
    if (!fs.existsSync(fp)) {
      filesFailed++;
      violations.push({
        type: "file_not_found",
        severity: "HIGH",
        file: fp,
        session,
        detail: "Recorded write not found on disk",
      });
      return;
    }
    if (expectedHash) {
      const actualHash = sha256(fs.readFileSync(fp, "utf-8"));
      if (actualHash !== expectedHash) {
        filesFailed++;
        violations.push({
          type: "hash_mismatch",
          severity: "HIGH",
          file: fp,
          session,
          detail: `Expected ${expectedHash} got ${actualHash}`,
        });
        return;
      }
    }
    filesPassed++;
  }

  const was = machine.write_audit_state;
  if (!was || !was.enabled)
    return {
      valid: true,
      violations: [],
      summary: { files_checked: 0, files_passed: 0, files_failed: 0 },
    };
  if (was.history)
    for (const e of was.history)
      if (e.files) for (const f of e.files) checkFile(f, e.session);
  if (was.current_session?.files_written)
    for (const f of was.current_session.files_written)
      checkFile(f, was.current_session.task_id || "current");
  return {
    valid: violations.length === 0,
    violations,
    summary: {
      files_checked: filesChecked,
      files_passed: filesPassed,
      files_failed: filesFailed,
    },
  };
}

/**
 * P1-1: Validate hierarchical v3 state files for cross-file consistency.
 * Checks gate-state.json ↔ gate-state.index.json ↔ gate-state.archive.json
 *
 * @param {string} rootDir - Project root directory
 * @returns {{ valid: boolean, issues: Array<{ref: string, severity: string, detail: string}> }}
 */
function checkHierarchicalStateIntegrity(rootDir) {
  const issues = [];
  const gateHot = readJson(
    path.join(rootDir, ".opencode/state/gate-state.json"),
  );
  const gateIndex = readJson(
    path.join(rootDir, ".opencode/state/gate-state.index.json"),
  );
  const gateArchive = readJson(
    path.join(rootDir, ".opencode/state/gate-state.archive.json"),
  );

  if (!gateHot) {
    issues.push({
      ref: "gate-state.json",
      severity: "HIGH",
      detail: "gate-state.json missing or unparseable",
    });
    return { valid: false, issues };
  }

  // Only validate v3 format
  if (gateHot.formatVersion !== "3.0") {
    return { valid: true, issues: [] }; // v2 format — skip v3 checks
  }

  const activeCount = Object.keys(gateHot.active_sessions || {}).length;
  const recentCount = Object.keys(gateHot.recent_sessions || {}).length;

  // Check 5a: Index exists and has correct count
  if (gateIndex) {
    const indexCount = Object.keys(gateIndex.sessions || {}).length;
    if (indexCount < recentCount) {
      issues.push({
        ref: "gate-state.index.json",
        severity: "HIGH",
        detail: `Index count (${indexCount}) < recent sessions (${recentCount}) — possible data loss`,
      });
    }

    // Spot-check 3 random archive references
    const recentEntries = Object.entries(gateHot.recent_sessions || {}).slice(
      0,
      3,
    );
    for (const [sid, entry] of recentEntries) {
      if (entry.archive_ref) {
        const refMatch = entry.archive_ref.match(
          /^gate-state\.history\/(\d{4}-\d{2}-\d{2}\.jsonl)#(\d+)$/,
        );
        if (!refMatch) {
          issues.push({
            ref: `session ${sid.substring(0, 20)}`,
            severity: "MEDIUM",
            detail: `Invalid archive_ref format: ${entry.archive_ref}`,
          });
        } else {
          const historyFile = path.join(
            rootDir,
            ".opencode/state/gate-state.history",
            refMatch[1],
          );
          if (!fs.existsSync(historyFile)) {
            issues.push({
              ref: `session ${sid.substring(0, 20)}`,
              severity: "HIGH",
              detail: `archive_ref points to missing history file: ${refMatch[1]}`,
            });
          }
        }
      }
    }
  } else {
    issues.push({
      ref: "gate-state.index.json",
      severity: "MEDIUM",
      detail:
        "gate-state.index.json not found — index file should exist for v3 format",
    });
  }

  // Check 5b: Archive has correct session count
  if (gateArchive) {
    const archiveSessions = Object.keys(gateArchive.sessions || {}).length;
    if (archiveSessions !== (gateArchive.session_count || 0)) {
      issues.push({
        ref: "gate-state.archive.json",
        severity: "MEDIUM",
        detail: `Archive session_count (${gateArchive.session_count}) != actual keys (${archiveSessions})`,
      });
    }
  }

  // Check 5c: DAG changelog consistency
  const dagFile = path.join(rootDir, "Task.DAG.json");
  const dagChangelog = path.join(rootDir, "Task.DAG.changelog.md");
  if (fs.existsSync(dagFile)) {
    try {
      const dag = JSON.parse(fs.readFileSync(dagFile, "utf8"));
      if (dag.change_log) {
        issues.push({
          ref: "Task.DAG.json",
          severity: "LOW",
          detail:
            "Task.DAG.json still has inline change_log — run DAG migration",
        });
      }
      if (!fs.existsSync(dagChangelog) && !dag.change_log) {
        issues.push({
          ref: "Task.DAG.changelog.md",
          severity: "LOW",
          detail:
            "Task.DAG.changelog.md missing — changelog should be externalized",
        });
      }
    } catch (e) {
      /* skip if unparseable */
    }
  }

  // Check 5d (Wave 2.3): Spot-validate history entries against schema
  const historySchemaPath = path.join(
    rootDir,
    ".opencode/state/history-entry.schema.json",
  );
  if (fs.existsSync(historySchemaPath)) {
    try {
      const historyDir = path.join(
        rootDir,
        ".opencode/state/gate-state.history",
      );
      if (fs.existsSync(historyDir)) {
        const jsonlFiles = fs
          .readdirSync(historyDir)
          .filter((f) => f.endsWith(".jsonl"));
        let checked = 0,
          invalid = 0;
        for (const f of jsonlFiles.slice(0, 3)) {
          const lines = fs
            .readFileSync(path.join(historyDir, f), "utf8")
            .split("\n")
            .filter((l) => l.trim());
          for (const line of lines.slice(0, 2)) {
            try {
              const entry = JSON.parse(line);
              if (
                !entry.session_id ||
                !/^cg_ses_\d{13}$/.test(entry.session_id)
              )
                invalid++;
              if (!entry.task_description || entry.task_description.length < 5)
                invalid++;
              checked++;
            } catch {
              invalid++;
              checked++;
            }
          }
        }
        if (checked > 0 && invalid === 0) {
          // All spot-checks pass — no issue to report
        } else if (invalid > 0) {
          issues.push({
            ref: "history.schema",
            severity: "MEDIUM",
            detail: `History schema validation: ${invalid}/${checked} entries failed spot-check`,
          });
        }
      }
    } catch {
      /* schema file unparseable — skip */
    }
  }

  // Check 5e (Wave 2.4): docs/official_docs/index.json integrity
  const docsIndexPath = path.join(rootDir, "docs", "official_docs", "index.json");
  if (fs.existsSync(docsIndexPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(docsIndexPath, "utf8"));
      // Validate required fields
      if (!manifest.manifest_version || !Array.isArray(manifest.entries)) {
        issues.push({
          ref: "docs.index",
          severity: "MEDIUM",
          detail: "index.json missing required fields (manifest_version, entries)",
        });
      } else {
        // Validate total_entries matches actual count
        if (manifest.total_entries !== manifest.entries.length) {
          issues.push({
            ref: "docs.index",
            severity: "LOW",
            detail: `total_entries (${manifest.total_entries}) !== entries.length (${manifest.entries.length})`,
          });
        }
        // Validate each entry has required fields
        const entryRequired = ["library_id", "query_topic", "domain", "tags", "files"];
        for (let i = 0; i < manifest.entries.length; i++) {
          const entry = manifest.entries[i];
          for (const key of entryRequired) {
            if (!(key in entry)) {
              issues.push({
                ref: "docs.index",
                severity: "MEDIUM",
                detail: `entries[${i}] missing required field: ${key}`,
              });
            }
          }
          // Validate files array
          if (Array.isArray(entry.files)) {
            const fileRequired = ["path", "source", "sha256", "size_bytes", "created_at", "ttl_days", "status"];
            for (let j = 0; j < entry.files.length; j++) {
              const file = entry.files[j];
              for (const key of fileRequired) {
                if (!(key in file)) {
                  issues.push({
                    ref: "docs.index",
                    severity: "LOW",
                    detail: `entries[${i}].files[${j}] missing required field: ${key}`,
                  });
                }
              }
            }
          }
        }
      }
    } catch (e) {
      issues.push({
        ref: "docs.index",
        severity: "HIGH",
        detail: `index.json JSON parse error: ${e.message}`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    summary: {
      active_sessions: activeCount,
      recent_sessions: recentCount,
      index_entries: gateIndex
        ? Object.keys(gateIndex.sessions || {}).length
        : 0,
      archive_entries: gateArchive
        ? Object.keys(gateArchive.sessions || {}).length
        : 0,
    },
  };
}

// ─── UC7KS: Knowledge State Integrity Check ──
/**
 * Validates that machine.json.knowledge_state is consistent with
 * the actual docs/official_docs/index.json manifest.
 * @param {string} rootDir - Project root directory
 * @returns {{ ok: boolean, detail: string, fixes: string[] }}
 */
function checkKnowledgeStateIntegrity(rootDir) {
  const issues = [];
  const fixes = [];
  const indexPath = path.join(rootDir, "docs", "official_docs", "index.json");
  const docsDir = path.join(rootDir, "docs", "official_docs");
  const machinePath = path.join(rootDir, ".opencode", "state", "machine.json");

  // Read machine.json knowledge_state
  let machine;
  try {
    machine = JSON.parse(fs.readFileSync(machinePath, "utf-8"));
  } catch {
    return { ok: false, detail: "Cannot read machine.json", fixes: [] };
  }
  const ks = machine.knowledge_state;
  if (!ks) {
    return {
      ok: true,
      detail: "knowledge_state section not yet initialized in machine.json",
      fixes: [],
    };
  }

  // Read index.json
  let manifest;
  try {
    if (fs.existsSync(indexPath)) {
      manifest = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    }
  } catch {
    issues.push("index.json is malformed or unreadable");
  }

  // Check 1: entry count sync
  if (manifest && Array.isArray(manifest.entries)) {
    const actualCount = manifest.entries.length;
    if (ks.total_docs_count !== actualCount) {
      issues.push(
        `knowledge_state.total_docs_count (${ks.total_docs_count}) != actual index.json entries (${actualCount})`,
      );
      fixes.push(
        `Update machine.json.knowledge_state.total_docs_count to ${actualCount}`,
      );
    }
  }

  // Check 2: total size
  let actualSize = 0;
  try {
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else {
          actualSize += fs.statSync(full).size;
        }
      }
    };
    if (fs.existsSync(docsDir)) walk(docsDir);
  } catch (_) {}
  if (actualSize > 0 && ks.total_size_bytes !== actualSize) {
    issues.push(
      `knowledge_state.total_size_bytes (${ks.total_size_bytes}) != actual (${actualSize})`,
    );
    fixes.push(
      `Update machine.json.knowledge_state.total_size_bytes to ${actualSize}`,
    );
  }

  // Check 3: stale active queries
  if (Array.isArray(ks.active_queries)) {
    const now = Date.now();
    const staleTTL = 24 * 60 * 60 * 1000; // 24h
    for (const q of ks.active_queries) {
      if (q.timestamp && now - new Date(q.timestamp).getTime() > staleTTL) {
        issues.push(`Stale active query: ${q.token_id} (since ${q.timestamp})`);
        fixes.push(
          `Drain stale query ${q.token_id} from knowledge_state.active_queries`,
        );
      }
    }
  }

  return {
    ok: issues.length === 0,
    detail:
      issues.length > 0
        ? issues.join("; ")
        : "knowledge_state synchronized with docs/official_docs/",
    fixes,
  };
}

// SA-IMPL-SELF-CLEANUP (2026-06-11): Check 7 — session_access integrity.
// Detects stale (>30d inactive) and invalid ("unknown","",etc.) agent entries
// in knowledge_cache_state.session_access. Strategy C: gate-time detection.
function checkSessionAccessIntegrity(projectRoot) {
  const issues = [];
  const fixes = [];
  const invalidEntries = [];
  const STALE_DAYS = 30;
  const INVALID_AGENT_KEYS = ["unknown", "", "undefined", "null"];
  const machinePath = path.join(projectRoot, ".opencode", "state", "machine.json");

  try {
    if (!fs.existsSync(machinePath)) return { ok: true, detail: "machine.json not found", fixes: [] };
    const machine = JSON.parse(fs.readFileSync(machinePath, "utf-8"));
    const sa = machine?.knowledge_cache_state?.session_access;
    if (!sa || Object.keys(sa).length === 0) return { ok: true, detail: "no session_access entries", fixes: [] };

    const now = Date.now();
    const staleThreshold = STALE_DAYS * 24 * 60 * 60 * 1000;

    for (const [agent, state] of Object.entries(sa)) {
      // Check invalid keys
      if (INVALID_AGENT_KEYS.includes(agent)) {
        issues.push(`Invalid agent key "${agent}" in session_access`);
        fixes.push(`Remove invalid agent entry "${agent}" from session_access`);
        invalidEntries.push(agent);
        continue;
      }
      // Check staleness
      const lastRead = state?.last_read_at || state?.declared_at;
      if (lastRead) {
        const age = now - new Date(lastRead).getTime();
        if (age > staleThreshold) {
          issues.push(`Stale agent "${agent}" (last_read: ${lastRead.substring(0, 10)}, age: ${Math.round(age / 86400000)}d)`);
          fixes.push(`Remove stale agent entry "${agent}" from session_access`);
          invalidEntries.push(agent);
        }
      }
    }

    return {
      ok: issues.length === 0,
      detail: issues.length > 0 ? issues.join("; ") : "all session_access entries valid and fresh",
      fixes,
      invalidEntries,
    };
  } catch (e) {
    return { ok: false, detail: "Failed to read machine.json: " + e.message, fixes: [] };
  }
}

module.exports = {
  reconcile,
  validateWriteAuditIntegrity,
  checkHierarchicalStateIntegrity,
  checkKnowledgeStateIntegrity,
};
