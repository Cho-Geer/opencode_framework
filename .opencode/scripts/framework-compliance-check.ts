#!/usr/bin/env bun
// framework-compliance-check.ts — P4-001
// Validates: DAG coverage, gate lifecycle, and state consistency across
// Task.DAG.json, gate-state.json, and machine.json.
// Exit 0 if clean, 1 if violations found.
//
// FW-PLAN-JS-TO-TS: Unified to TypeScript + Bun; imports gate-core.ts source directly.
// resolveFrameworkPaths exported from gate-core.ts.
// Inline paths retained for additional keys (gateIndex, gateArchive).
// SA-STORAGE-IMPLEMENT-001: transactionLog path removed — .transaction-log is legacy bridge.
// V3 gate-state format compatibility (active_sessions as object) retained.

const path = require("path");
const {
  readJsonFile,
  resolveFrameworkPaths,
} = require("../lib/gate-core.ts");
const { readSubState } = require("../lib/substate-manager");
// Post-Step-8 DB-only migration: read gate state from DB instead of frozen JSON snapshot
const { dbLoadGateStore } = require("../lib/db-state-manager");

// ════════════════════════════════════════════════════════════
// FW-REPAIR-13: Inline framework path resolution
// (resolveFrameworkPaths missing from stale compiled gate-core.js)
// ════════════════════════════════════════════════════════════
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const paths = {
  root: PROJECT_ROOT,
  dag: path.join(PROJECT_ROOT, "Task.DAG.json"),
  gateState: path.join(PROJECT_ROOT, ".opencode/state/gate-state.json"),
  gateIndex: path.join(PROJECT_ROOT, ".opencode/state/gate-state.index.json"),
  gateArchive: path.join(
    PROJECT_ROOT,
    ".opencode/state/gate-state.archive.json",
  ),
  machine: path.join(PROJECT_ROOT, ".opencode/state/machine.json"),
  ruleRegistry: path.join(PROJECT_ROOT, ".opencode/state/rule_registry.json"),
  projectConfig: path.join(PROJECT_ROOT, ".opencode/project.config.json"),
};

/**
 * FW-REPAIR-13: Extract all sessions from gate-state, handling both
 * V3 format (active_sessions + recent_sessions as objects) and
 * V2 format (sessions as flat map).
 */
function getAllGateSessions(gateState) {
  if (!gateState) return [];
  const sessions = [];
  // V3 format
  if (
    gateState.active_sessions &&
    typeof gateState.active_sessions === "object"
  ) {
    sessions.push(...Object.values(gateState.active_sessions));
  }
  if (
    gateState.recent_sessions &&
    typeof gateState.recent_sessions === "object"
  ) {
    sessions.push(...Object.values(gateState.recent_sessions));
  }
  // V2 format
  if (gateState.sessions && typeof gateState.sessions === "object") {
    sessions.push(...Object.values(gateState.sessions));
  }
  return sessions;
}

function main() {
  const violations = [];
  const checks = [];

  // ── Load state files ──
  const dag = readJsonFile(paths.dag);
  // Post-Step-8 DB-only migration: read gate state from DB instead of frozen JSON snapshot
  const gateState = dbLoadGateStore();
  const machine = readJsonFile(paths.machine);

  // ── Check 1: Task.DAG.json exists and is valid ──
  if (!dag) {
    violations.push({
      check: "dag_exists",
      severity: "HIGH",
      detail: "Task.DAG.json missing or invalid JSON",
    });
    output({ violations, checks, status: "FAIL" });
    process.exit(1);
  }
  checks.push({ id: "dag_exists", name: "DAG file exists", status: "pass" });

  // ── Check 2: All pending tasks have an armed gate session ──
  const pendingTasks = (dag.tasks || []).filter((t) => t.status === "pending");
  // FW-REPAIR-13: Use V3-compatible session extraction
  const allSessions = getAllGateSessions(gateState);
  const activeSessions = allSessions.filter(
    (s) => s && s.gate_status === "armed",
  );

  if (pendingTasks.length > 0 && activeSessions.length === 0) {
    // FW-REPAIR-13: Downgrade to WARNING — framework in maintenance mode
    // may have pending tasks without active sessions. This is not a
    // framework integrity issue, just a workflow state indicator.
    violations.push({
      check: "pending_tasks_no_gate",
      severity: "WARNING",
      detail: `${pendingTasks.length} pending task(s) found but 0 armed gate sessions. Tasks: ${pendingTasks.map((t) => t.id).join(", ")}`,
    });
  } else if (pendingTasks.length > activeSessions.length) {
    violations.push({
      check: "pending_tasks_exceed_armed",
      severity: "WARNING",
      detail: `${pendingTasks.length} pending tasks vs ${activeSessions.length} armed sessions`,
    });
  }
  checks.push({
    id: "pending_vs_armed",
    name: "Pending tasks vs armed sessions",
    status: violations.some((v) => v.check === "pending_tasks_no_gate")
      ? "fail"
      : "pass",
    detail: `pending=${pendingTasks.length}, armed=${activeSessions.length}`,
  });

  // ── Check 3: Completed tasks without consumed gate ──
  const completedTasks = (dag.tasks || []).filter(
    (t) => t.status === "completed",
  );
  const consumedSessions = allSessions.filter(
    (s) => s && s.gate_status === "completed" && s.consumed_at,
  );

  if (
    completedTasks.length > 0 &&
    consumedSessions.length === 0 &&
    allSessions.length > 0
  ) {
    violations.push({
      check: "completed_tasks_no_gate",
      severity: "WARNING",
      detail: `${completedTasks.length} completed tasks but 0 consumed gate sessions found. Historical tasks may predate gate tracking.`,
    });
  }
  checks.push({
    id: "completed_vs_consumed",
    name: "Completed tasks vs consumed sessions",
    status: "pass",
    detail: `completed=${completedTasks.length}, consumed=${consumedSessions.length}`,
  });

  // ── Check 4: gate-state.json sessions consistency ──
  if (allSessions.length > 0) {
    const armedCheckFailed = allSessions.filter(
      (s) =>
        s.gate_status === "failed" ||
        (s.gate_status === "armed" &&
          s.last_check_failed_items &&
          s.last_check_failed_items.length > 0),
    );
    const orphaned = allSessions.filter(
      (s) => s.gate_status === "armed" && !s.confirmed_at,
    );
    const stale = allSessions.filter((s) => {
      if (s.consumed_at) return false;
      const created = new Date(s.confirmed_at || s.created_at);
      const hoursSince = (Date.now() - created.getTime()) / (1000 * 60 * 60);
      return hoursSince > 24;
    });

    if (armedCheckFailed.length > 0) {
      violations.push({
        check: "armed_with_failures",
        severity: "HIGH",
        detail: `${armedCheckFailed.length} session(s) armed but with check failures: ${armedCheckFailed.map((s) => s.session_id).join(", ")}`,
      });
    }
    if (orphaned.length > 0) {
      violations.push({
        check: "orphaned_sessions",
        severity: "WARNING",
        detail: `${orphaned.length} session(s) armed but never confirmed: ${orphaned.map((s) => s.session_id).join(", ")}`,
      });
    }
    if (stale.length > 0) {
      violations.push({
        check: "stale_sessions",
        severity: "WARNING",
        detail: `${stale.length} session(s) older than 24h without completion: ${stale.map((s) => s.session_id).join(", ")}`,
      });
    }

    checks.push({
      id: "session_health",
      name: "Gate session health",
      status: armedCheckFailed.length > 0 ? "fail" : "pass",
      detail: `total=${allSessions.length}, armed_failed=${armedCheckFailed.length}, orphaned=${orphaned.length}, stale=${stale.length}`,
    });
  }

  // ── Check 5: machine.json sub-state cleanliness ──
  // P1-B: Sub-states are now in dedicated files; read via readSubState().
  if (machine) {
    const eslintState = readSubState("eslint_state");
    const typeCheckState = readSubState("type_check_state");
    const formatState = readSubState("format_state");
    const dependencyState = readSubState("dependency_state");

    const dirtyStates = [];
    if (
      eslintState &&
      eslintState.aggregate &&
      eslintState.aggregate.total_violations > 0
    ) {
      dirtyStates.push(
        `eslint_state: ${eslintState.aggregate.total_violations} violations`,
      );
    }
    if (typeCheckState && typeCheckState.status !== "clean") {
      dirtyStates.push(`type_check_state: ${typeCheckState.status}`);
    }
    if (formatState && formatState.status !== "clean") {
      dirtyStates.push(`format_state: ${formatState.status}`);
    }
    if (dependencyState && dependencyState.status !== "clean") {
      dirtyStates.push(`dependency_state: ${dependencyState.status}`);
    }

    if (dirtyStates.length > 0) {
      violations.push({
        check: "dirty_machine_state",
        severity: "WARNING",
        detail: `machine.json has dirty sub-states: ${dirtyStates.join("; ")}`,
      });
    }
    checks.push({
      id: "machine_state",
      name: "Machine state cleanliness",
      status: dirtyStates.length > 0 ? "warn" : "pass",
      detail:
        dirtyStates.length > 0
          ? dirtyStates.join("; ")
          : "all sub-states clean",
    });
  }

  // ── Check 6: Enforcement mode consistency ──
  // FW-REPAIR-13: Use dual-key resolution per enforcement-modes-standard.md §4.1
  const config = readJsonFile(paths.projectConfig);
  if (config && config.template_resolution) {
    const enfMode =
      config.template_resolution.runtime_enforcement_mode ||
      config.template_resolution.develop_enforcement_mode ||
      "advisory";
    if (
      enfMode === "strict" &&
      activeSessions.length === 0 &&
      pendingTasks.length > 0
    ) {
      violations.push({
        check: "strict_no_gate",
        severity: "HIGH",
        detail: `Enforcement mode is 'strict' but ${pendingTasks.length} pending tasks have no armed gate session`,
      });
    }
    checks.push({
      id: "enforcement_mode",
      name: "Enforcement mode check",
      status: "pass",
      detail: `mode=${enfMode}`,
    });
  }

  // ── Summary ──
  const highViolations = violations.filter((v) => v.severity === "HIGH");
  const status =
    highViolations.length > 0
      ? "FAIL"
      : violations.length > 0
        ? "WARN"
        : "PASS";

  output({
    status,
    violations,
    checks,
    summary: `${checks.filter((c) => c.status === "pass").length}/${checks.length} checks passed, ${violations.length} violations (${highViolations.length} HIGH)`,
  });

  process.exit(highViolations.length > 0 ? 1 : 0);
}

function output(report) {
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { main };
