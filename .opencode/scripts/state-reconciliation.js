#!/usr/bin/env node
/**
 * state-reconciliation.js — State Reconciliation Daemon
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
 *   node .opencode/scripts/state-reconciliation.js [options]
 *     --json       Output raw JSON report (default: human-readable)
 *     --fix        Auto-fix resolvable inconsistencies
 *     --strict     Exit 1 if ANY inconsistency found
 *     --dry-run    Show what would be fixed without modifying state
 */

"use strict";

const fs = require("fs");
const path = require("path");

const OPENCODE_ROOT =
  process.env.OPENCODE_ROOT || path.resolve(__dirname, "..", "..");

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

// ─── Check #1: Completed DAG tasks have consumed gate sessions ──
function checkCompletedDagHasGateSession(dag, gate) {
  const inconsistencies = [];
  const tasks = dag.tasks || [];
  const sessions = gate.sessions || {};

  for (const task of tasks) {
    if (task.status === "completed") {
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
  const activeSessions = gate.active_sessions || [];
  const taskMap = {};
  for (const t of tasks) {
    taskMap[t.id] = t;
  }

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
      inconsistencies.push({
        type: "armed_session_completed_task",
        severity: "HIGH",
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
  const taskMap = {};
  for (const t of tasks) {
    taskMap[t.id] = t;
  }

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

// ─── Fix: drain orphaned sessions ──────────────────────────
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
    gate.active_sessions = (gate.active_sessions || []).filter(
      (a) => a !== sid,
    );
    drained++;
    drainedList.push(sid);
  }

  return { drained, drainedList };
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
    },
    inconsistencies: [],
    auto_fixable: false,
    fixes_applied: null,
  };

  // Read state files
  const dag = readJson(DAG_PATH);
  const gate = readJson(GATE_PATH);
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

  // Run all 4 checks
  const check1 = checkCompletedDagHasGateSession(dag, gate);
  const check2 = checkArmedSessionDagReference(dag, gate);
  const check3 = checkOrphanedSessions(dag, gate);
  const check4 = checkDagMetaCounts(dag);

  results.checks.check1 = check1;
  results.checks.check2 = check2;
  results.checks.check3 = check3;
  results.checks.check4 = check4;

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

  // ─── --fix flag: apply auto-repair ──────────────────────
  if (options.fix && results.auto_fixable) {
    const fixes = { drained: 0, meta_corrected: false, details: [] };

    // Fix stale sessions
    const drainResult = fixDrainOrphanedSessions(gate);
    fixes.drained = drainResult.drained;
    if (drainResult.drained > 0) {
      fixes.details.push(
        `Drained ${drainResult.drained} stale sessions: ${drainResult.drainedList.join(", ")}`,
      );
      // Write updated gate-state.json
      const gateContent = JSON.stringify(gate, null, 2) + "\n";
      fs.writeFileSync(GATE_PATH, gateContent, "utf-8");
    }

    // Fix DAG meta counts
    const corrected = fixDagMetaCounts(dag);
    fixes.meta_corrected = true;
    fixes.details.push(
      `Corrected DAG meta: ${corrected.total} total, ${corrected.completed} completed, ${corrected.pending} pending`,
    );

    // Write updated Task.DAG.json — only if meta counts were wrong
    if (check4.inconsistencies.length > 0) {
      const dagContent = JSON.stringify(dag, null, 2) + "\n";
      fs.writeFileSync(DAG_PATH, dagContent, "utf-8");
    }

    results.fixes_applied = fixes;
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
  };

  const result = reconcile(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const statusIcon = result.valid ? "✅" : "❌";
    console.log(`\n${statusIcon} [State Reconciliation] ${result.timestamp}\n`);

    for (const [checkName, check] of Object.entries(result.checks)) {
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
    } else {
      console.log(`\n  ✅ All checks passed — no inconsistencies found.`);
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

    if (result.fixes_applied) {
      console.log(`\n  🔧 Fixes applied:`);
      console.log(`    Drained sessions: ${result.fixes_applied.drained}`);
      console.log(`    Meta corrected: ${result.fixes_applied.meta_corrected}`);
      for (const d of result.fixes_applied.details) {
        console.log(`    - ${d}`);
      }
    }
  }

  if (options.strict && !result.valid) {
    process.exit(1);
  }

  process.exit(
    result.valid
      ? 0
      : result.auto_fixable && !options.fix
        ? 0
        : result.valid
          ? 0
          : 1,
  );
}

if (require.main === module) {
  runCLI();
}

module.exports = { reconcile };
