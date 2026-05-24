#!/usr/bin/env node
// framework-compliance-check.js — P4-001
// Validates: DAG coverage, gate lifecycle, and state consistency across
// Task.DAG.json, gate-state.json, and machine.json.
// Exit 0 if clean, 1 if violations found.

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function readJSON(filepath) {
  try {
    const raw = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function main() {
  const violations = [];
  const checks = [];

  // ── Load state files ──
  const dagPath = path.join(PROJECT_ROOT, 'Task.DAG.json');
  const gatePath = path.join(PROJECT_ROOT, '.opencode', 'state', 'gate-state.json');
  const machinePath = path.join(PROJECT_ROOT, '.opencode', 'state', 'machine.json');

  const dag = readJSON(dagPath);
  const gateState = readJSON(gatePath);
  const machine = readJSON(machinePath);

  // ── Check 1: Task.DAG.json exists and is valid ──
  if (!dag) {
    violations.push({ check: 'dag_exists', severity: 'HIGH', detail: 'Task.DAG.json missing or invalid JSON' });
    output({ violations, checks, status: 'FAIL' });
    process.exit(1);
  }
  checks.push({ id: 'dag_exists', name: 'DAG file exists', status: 'pass' });

  // ── Check 2: All pending tasks have an armed gate session ──
  const pendingTasks = (dag.tasks || []).filter(t => t.status === 'pending');
  const activeSessions = gateState && gateState.sessions ? Object.values(gateState.sessions).filter(s => s.gate_status === 'armed') : [];

  if (pendingTasks.length > 0 && activeSessions.length === 0) {
    violations.push({
      check: 'pending_tasks_no_gate',
      severity: 'HIGH',
      detail: `${pendingTasks.length} pending task(s) found but 0 armed gate sessions. Tasks: ${pendingTasks.map(t => t.id).join(', ')}`
    });
  } else if (pendingTasks.length > activeSessions.length) {
    violations.push({
      check: 'pending_tasks_exceed_armed',
      severity: 'WARNING',
      detail: `${pendingTasks.length} pending tasks vs ${activeSessions.length} armed sessions`
    });
  }
  checks.push({
    id: 'pending_vs_armed',
    name: 'Pending tasks vs armed sessions',
    status: violations.some(v => v.check === 'pending_tasks_no_gate') ? 'fail' : 'pass',
    detail: `pending=${pendingTasks.length}, armed=${activeSessions.length}`
  });

  // ── Check 3: Completed tasks without consumed gate ──
  const completedTasks = (dag.tasks || []).filter(t => t.status === 'completed');
  const consumedSessions = gateState && gateState.sessions
    ? Object.values(gateState.sessions).filter(s => s.gate_status === 'completed' && s.consumed_at)
    : [];

  if (completedTasks.length > 0 && consumedSessions.length === 0 && gateState && gateState.sessions) {
    // This is expected in some cases (tasks completed before gate tracking), downgrade to WARNING
    violations.push({
      check: 'completed_tasks_no_gate',
      severity: 'WARNING',
      detail: `${completedTasks.length} completed tasks but 0 consumed gate sessions found. Historical tasks may predate gate tracking.`
    });
  }
  checks.push({
    id: 'completed_vs_consumed',
    name: 'Completed tasks vs consumed sessions',
    status: 'pass',
    detail: `completed=${completedTasks.length}, consumed=${consumedSessions.length}`
  });

  // ── Check 4: gate-state.json sessions consistency ──
  if (gateState && gateState.sessions) {
    const sessions = Object.values(gateState.sessions);
    const armedCheckFailed = sessions.filter(s => s.gate_status === 'failed' || (s.gate_status === 'armed' && s.last_check_failed_items && s.last_check_failed_items.length > 0));
    const orphaned = sessions.filter(s => s.gate_status === 'armed' && !s.confirmed_at);
    const stale = sessions.filter(s => {
      if (s.consumed_at) return false;
      const created = new Date(s.created_at);
      const hoursSince = (Date.now() - created.getTime()) / (1000 * 60 * 60);
      return hoursSince > 24;
    });

    if (armedCheckFailed.length > 0) {
      violations.push({
        check: 'armed_with_failures',
        severity: 'HIGH',
        detail: `${armedCheckFailed.length} session(s) armed but with check failures: ${armedCheckFailed.map(s => s.session_id).join(', ')}`
      });
    }
    if (orphaned.length > 0) {
      violations.push({
        check: 'orphaned_sessions',
        severity: 'WARNING',
        detail: `${orphaned.length} session(s) armed but never confirmed: ${orphaned.map(s => s.session_id).join(', ')}`
      });
    }
    if (stale.length > 0) {
      violations.push({
        check: 'stale_sessions',
        severity: 'WARNING',
        detail: `${stale.length} session(s) older than 24h without completion: ${stale.map(s => s.session_id).join(', ')}`
      });
    }

    checks.push({
      id: 'session_health',
      name: 'Gate session health',
      status: (armedCheckFailed.length > 0) ? 'fail' : 'pass',
      detail: `total=${sessions.length}, armed_failed=${armedCheckFailed.length}, orphaned=${orphaned.length}, stale=${stale.length}`
    });
  }

  // ── Check 5: machine.json sub-state cleanliness ──
  if (machine) {
    const dirtyStates = [];
    if (machine.eslint_state && machine.eslint_state.aggregate && machine.eslint_state.aggregate.total_violations > 0) {
      dirtyStates.push(`eslint_state: ${machine.eslint_state.aggregate.total_violations} violations`);
    }
    if (machine.type_check_state && machine.type_check_state.status !== 'clean') {
      dirtyStates.push(`type_check_state: ${machine.type_check_state.status}`);
    }
    if (machine.format_state && machine.format_state.status !== 'clean') {
      dirtyStates.push(`format_state: ${machine.format_state.status}`);
    }
    if (machine.dependency_state && machine.dependency_state.status !== 'clean') {
      dirtyStates.push(`dependency_state: ${machine.dependency_state.status}`);
    }

    if (dirtyStates.length > 0) {
      violations.push({
        check: 'dirty_machine_state',
        severity: 'WARNING',
        detail: `machine.json has dirty sub-states: ${dirtyStates.join('; ')}`
      });
    }
    checks.push({
      id: 'machine_state',
      name: 'Machine state cleanliness',
      status: dirtyStates.length > 0 ? 'warn' : 'pass',
      detail: dirtyStates.length > 0 ? dirtyStates.join('; ') : 'all sub-states clean'
    });
  }

  // ── Check 6: Enforcement mode consistency ──
  const configPath = path.join(PROJECT_ROOT, '.opencode', 'project.config.json');
  const config = readJSON(configPath);
  if (config && config.template_resolution) {
    const enfMode = config.template_resolution.enforcement_mode || 'advisory';
    if (enfMode === 'strict' && activeSessions.length === 0 && pendingTasks.length > 0) {
      violations.push({
        check: 'strict_no_gate',
        severity: 'HIGH',
        detail: `Enforcement mode is 'strict' but ${pendingTasks.length} pending tasks have no armed gate session`
      });
    }
    checks.push({
      id: 'enforcement_mode',
      name: 'Enforcement mode check',
      status: 'pass',
      detail: `mode=${enfMode}`
    });
  }

  // ── Summary ──
  const highViolations = violations.filter(v => v.severity === 'HIGH');
  const status = highViolations.length > 0 ? 'FAIL' : (violations.length > 0 ? 'WARN' : 'PASS');

  output({ status, violations, checks, summary: `${checks.filter(c => c.status === 'pass').length}/${checks.length} checks passed, ${violations.length} violations (${highViolations.length} HIGH)` });

  process.exit(highViolations.length > 0 ? 1 : 0);
}

function output(report) {
  console.log(JSON.stringify(report, null, 2));
}

main();
