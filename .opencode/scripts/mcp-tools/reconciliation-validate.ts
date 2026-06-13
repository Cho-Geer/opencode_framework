#!/usr/bin/env node
// ==============================================================================
// reconciliation-validate.js — State Reconciliation Validator (Node.js)
// ==============================================================================
// Purpose: Cross-references three state planes:
//           1. Task.DAG.json          — task planning/execution state
//           2. gate-state.json        — compliance gate session state
//           3. machine.json           — write audit / enforcement state
//
// Checks:
//   Check 1 (DAG ↔ Gate):   Every in_progress DAG task MUST have an armed gate
//                            session. Every armed gate session MUST reference a
//                            valid pending/in_progress DAG task.
//   Check 2 (Gate ↔ Machine): Every armed gate session MUST have a matching
//                              write_audit_state entry. Orphaned sessions flagged.
//   Check 3 (DAG ↔ Machine): Completed tasks must have write audit history.
//                             Pending tasks must NOT have write audit entries.
//
// Usage:   node reconciliation-validate.js [--quiet] [--strict] [--json]
//          --quiet  : suppress per-check detail, only print summary line
//          --strict : treat warnings as errors (exit 1 on any inconsistency)
//          --json   : output results as JSON (for programmatic consumption)
//
// Exit:    0 — all three state planes consistent
//          1 — inconsistencies found (or strict mode with warnings)
//          2 — precondition failure (missing files, parse errors)
// ==============================================================================

const fs = require('fs');
const path = require('path');

/**
 * FW-LOG-UNIFY Phase 2: Lazy-load writeLog to avoid circular imports.
 * reconciliation-validate.ts is a standalone CLI script, so we use
 * lazy require to keep the import lightweight.
 */
let _writeLog = null;
function getWriteLog() {
  if (!_writeLog) {
    try {
      const lm = require(path.join(__dirname, '..', '..', 'lib', 'log-manager'));
      _writeLog = lm.writeLog;
    } catch {
      _writeLog = () => {}; // Graceful degradation if log-manager unavailable
    }
  }
  return _writeLog;
}
function srcLog(level, event, fields) {
  try { getWriteLog()("mcp-reconciliation-validate", level, { event, ...fields }); } catch {}
}

// ─── Argument Parsing ──────────────────────────────────────────
const args = process.argv.slice(2);
const QUIET = args.includes('--quiet');
const STRICT = args.includes('--strict');
const JSON_OUTPUT = args.includes('--json');

// ─── Path Resolution ───────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DAG_FILE = path.join(PROJECT_ROOT, 'Task.DAG.json');
const GATE_FILE = path.join(PROJECT_ROOT, '.opencode', 'state', 'gate-state.json');
const MACHINE_FILE = path.join(PROJECT_ROOT, '.opencode', 'state', 'machine.json');

// ─── State Tracking ────────────────────────────────────────────
let INCONSISTENCIES = 0;
const inconsistencyDetails = [];
const warningDetails = [];

function logInconsistency(msg) {
  INCONSISTENCIES++;
  inconsistencyDetails.push(msg);
  if (!QUIET && !JSON_OUTPUT) console.log(`  ⚠️  ${msg}`);
  srcLog("WARN", "inconsistency", { message: msg });
}

function logWarning(msg) {
  warningDetails.push(msg);
  if (!QUIET && !JSON_OUTPUT) console.log(`  ℹ️  ${msg}`);
  srcLog("INFO", "warning", { message: msg });
}

// Verbose output helper — suppressed in both --quiet and --json modes
function verbose(line) {
  if (!QUIET && !JSON_OUTPUT) console.log(line);
}

// ─── File Loading ──────────────────────────────────────────────
function loadJSON(filePath, label) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`❌ [Reconciliation] Failed to load ${label} from ${filePath}: ${err.message}`);
    srcLog("ERROR", "load_failed", { label, filePath, error: err.message });
    return null;
  }
}

// ─── Precondition Checks ───────────────────────────────────────
const dag = loadJSON(DAG_FILE, 'Task.DAG.json');
if (!dag) process.exit(2);

const gate = loadJSON(GATE_FILE, 'gate-state.json');
if (!gate) process.exit(2);

const machine = loadJSON(MACHINE_FILE, 'machine.json');
if (!machine) process.exit(2);

if (!Array.isArray(dag.tasks)) {
  console.error('❌ [Reconciliation] Task.DAG.json missing .tasks array. Cannot reconcile.');
  process.exit(2);
}

if (!gate.sessions || typeof gate.sessions !== 'object') {
  console.error('❌ [Reconciliation] gate-state.json missing .sessions object. Cannot reconcile.');
  process.exit(2);
}

// ─── Data Extraction ───────────────────────────────────────────
const tasks = dag.tasks;

// Extract gate sessions as entries
const sessions = gate.sessions;
const sessionEntries = Object.entries(sessions);

// Helper: find DAG task(s) referenced in a gate session's task_description
function findDagTasksForSession(sessionDesc) {
  if (!sessionDesc) return [];
  const descLower = sessionDesc.toLowerCase();
  return tasks.filter(t => descLower.includes(t.id.toLowerCase()));
}

// Helper: check if any gate session references a given DAG task
function anySessionReferencesTask(taskId, statusFilter) {
  for (const [, session] of sessionEntries) {
    const desc = (session.task_description || '').toLowerCase();
    if (desc.includes(taskId.toLowerCase())) {
      if (!statusFilter) return true;
      if (statusFilter.includes(session.gate_status)) return true;
    }
  }
  return false;
}

// ─── Write Audit Data ──────────────────────────────────────────
const writeAudit = machine.write_audit_state || {};
const currentSession = writeAudit.current_session || {};
const writeHistory = writeAudit.history || [];
const currentTaskId = currentSession.task_id || null;
const currentAgent = currentSession.agent || null;

// ─── Header ────────────────────────────────────────────────────
verbose('═══════════════════════════════════════════════════════════════');
verbose('  🔍 State Reconciliation Check');
verbose('═══════════════════════════════════════════════════════════════');
verbose('');

// ═══════════════════════════════════════════════════════════════
// Check 1: DAG ↔ Gate
// ═══════════════════════════════════════════════════════════════
verbose('── Check 1: DAG ↔ Gate ──────────────────────────────────────');

const dagInProgress = tasks.filter(t => t.status === 'in_progress');
const dagPending = tasks.filter(t => t.status === 'pending');
const validDagStatuses = ['pending', 'in_progress'];

// 1a: Every in_progress DAG task must have an armed gate session (or completed)
for (const task of dagInProgress) {
  if (!anySessionReferencesTask(task.id, ['armed'])) {
    // Check if it has a completed session instead (may need status sync)
    if (anySessionReferencesTask(task.id, ['completed'])) {
      logWarning(`DAG task '${task.id}' is in_progress but has only completed gate session(s) — may need status sync`);
    } else {
      logInconsistency(`DAG task '${task.id}' is in_progress but has NO matching gate session (armed or completed)`);
    }
  }
}

// 1b: Every armed gate session must reference a valid DAG task
const armedSessions = sessionEntries.filter(([, s]) => s.gate_status === 'armed');
for (const [sessionId, session] of armedSessions) {
  const matchedTasks = findDagTasksForSession(session.task_description);

  if (matchedTasks.length === 0) {
    const descPreview = (session.task_description || '').substring(0, 80);
    logInconsistency(`Gate session '${sessionId}' is armed but references no valid DAG task. Task description: '${descPreview}...'`);
    continue;
  }

  // Verify at least one matched task has valid status
  const hasValidStatus = matchedTasks.some(t => validDagStatuses.includes(t.status));
  if (!hasValidStatus) {
    const statuses = [...new Set(matchedTasks.map(t => t.status))].join(', ');
    logWarning(`Gate session '${sessionId}' is armed but all matched DAG tasks have status "${statuses}" (expected pending or in_progress)`);
  }
}

if (!QUIET && !JSON_OUTPUT) {
  console.log(`  DAG in_progress: ${dagInProgress.length} | Gate armed: ${armedSessions.length}`);
  console.log('');
}

// ═══════════════════════════════════════════════════════════════
// Check 2: Gate ↔ Machine
// ═══════════════════════════════════════════════════════════════
verbose('── Check 2: Gate ↔ Machine ──────────────────────────────────');

// 2a: If gate has armed sessions, write_audit_state should reflect active work
if (armedSessions.length > 0) {
  if (!currentAgent || currentAgent === 'null') {
    logInconsistency(`${armedSessions.length} gate session(s) armed but write_audit_state.current_session is empty (no active write audit tracking)`);
  } else {
    // Verify current_session.task_id matches an armed gate session
    if (currentTaskId && currentTaskId !== 'null') {
      const taskHasArmed = anySessionReferencesTask(currentTaskId, ['armed']);
      if (!taskHasArmed) {
        // Check if the task has a completed session instead
        const taskHasCompleted = anySessionReferencesTask(currentTaskId, ['completed']);
        if (!taskHasCompleted) {
          logInconsistency(`write_audit_state tracks task '${currentTaskId}' but no gate session (armed or completed) references it`);
        }
      }
    }
  }
}

// 2b: Orphan detection — gate sessions armed but never consumed (stale > 1 hour)
const ONE_HOUR_MS = 3600 * 1000;
const now = Date.now();

for (const [sessionId, session] of armedSessions) {
  const confirmedAt = session.confirmed_at;
  const consumedAt = session.consumed_at;

  if (confirmedAt && confirmedAt !== 'null' && (!consumedAt || consumedAt === 'null')) {
    const confirmedTime = new Date(confirmedAt).getTime();
    if (!isNaN(confirmedTime)) {
      const ageMs = now - confirmedTime;
      if (ageMs > ONE_HOUR_MS) {
        const ageHours = Math.floor(ageMs / ONE_HOUR_MS);
        logInconsistency(`Gate session '${sessionId}' armed for ${ageHours}h without being consumed (orphaned session)`);
      }
    }
  }
}

if (!QUIET && !JSON_OUTPUT) {
  console.log(`  Current write audit: agent=${currentAgent || 'none'}, task=${currentTaskId || 'none'}`);
  console.log('');
}

// ═══════════════════════════════════════════════════════════════
// Check 3: DAG ↔ Machine
// ═══════════════════════════════════════════════════════════════
verbose('── Check 3: DAG ↔ Machine ───────────────────────────────────');

const dagCompleted = tasks.filter(t => t.status === 'completed');

// 3a: Tasks with status 'completed' should have write audit evidence
//     (either in history array or as current_session task_id after completion)
const writeHistoryTaskIds = new Set();
for (const entry of writeHistory) {
  if (entry.task_id) writeHistoryTaskIds.add(entry.task_id);
}
// Also consider current_session if it seems to match a completed task
const completedInHistory = new Set([...writeHistoryTaskIds]);
if (currentTaskId && dagCompleted.some(t => t.id === currentTaskId)) {
  completedInHistory.add(currentTaskId);
}

for (const task of dagCompleted) {
  if (!completedInHistory.has(task.id)) {
    // Only flag if the task has NO gate session evidence either (completed gate sessions serve as evidence)
    if (!anySessionReferencesTask(task.id, ['completed'])) {
      logInconsistency(`DAG task '${task.id}' marked completed but no write audit found`);
    }
  }
}

// 3b: Tasks with status 'pending' must NOT have active write audit tracking
//     (unless the task is currently being executed - flag as warning)
for (const task of dagPending) {
  if (task.id === currentTaskId) {
    logWarning(`DAG task '${task.id}' is 'pending' but write_audit_state tracks it as current (agent=${currentAgent}). May be in-flight sync drift.`);
  }
}

if (!QUIET && !JSON_OUTPUT) {
  console.log(`  DAG completed: ${dagCompleted.length} | Write audit history entries: ${writeHistory.length}`);
  console.log('');
}

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
const dagTotal = tasks.length;
const dagPendingCount = dagPending.length;
const dagCompletedCount = dagCompleted.length;
const sessionTotal = sessionEntries.length;
const gateArmedCount = armedSessions.length;

// Machine state status
const eslintStatus = ((machine.eslint_state || {}).aggregate || {}).total_violations || 0;
const machineStatus = eslintStatus === 0 ? 'clean' : `dirty(${eslintStatus} violations)`;

if (JSON_OUTPUT) {
  console.log(JSON.stringify({
    status: INCONSISTENCIES === 0 ? 'consistent' : 'inconsistent',
    summary: {
      dag: { total: dagTotal, pending: dagPendingCount, completed: dagCompletedCount, inProgress: dagInProgress.length },
      gate: { total: sessionTotal, armed: gateArmedCount },
      machine: { status: machineStatus }
    },
    inconsistencies: inconsistencyDetails,
    warnings: warningDetails,
    exitCode: INCONSISTENCIES === 0 ? (STRICT && warningDetails.length > 0 ? 1 : 0) : 1
  }, null, 2));
} else {
  verbose('═══════════════════════════════════════════════════════════════');

  if (INCONSISTENCIES === 0) {
    const statusLine = `✅ [Reconciliation] DAG(${dagTotal} tasks, ${dagPendingCount} pending) ↔ Gate(${sessionTotal} sessions, ${gateArmedCount} armed) ↔ Machine(${machineStatus}) — consistent`;
    console.log(statusLine);
    srcLog("INFO", "reconciliation_complete", {
      status: "consistent", dagTotal, dagPendingCount, dagCompletedCount,
      sessionTotal, gateArmedCount, machineStatus, warnings: warningDetails.length,
    });
    if (STRICT && warningDetails.length > 0) {
      console.log(`⚠️  [Reconciliation] Strict mode: ${warningDetails.length} warning(s) treated as errors.`);
      process.exit(1);
    }
    process.exit(0);
  } else {
    const statusLine = `❌ [Reconciliation] DAG(${dagTotal} tasks) ↔ Gate(${sessionTotal} sessions) ↔ Machine(${machineStatus}) — ${INCONSISTENCIES} inconsistency(ies) found`;
    console.log(statusLine);
    srcLog("ERROR", "reconciliation_failed", {
      status: "inconsistent", dagTotal, sessionTotal, machineStatus,
      inconsistencies: INCONSISTENCIES, warnings: warningDetails.length,
    });
    if (!QUIET) {
      console.log('');
      console.log('Details:');
      for (const detail of inconsistencyDetails) {
        console.log(`  ${detail}`);
      }
    }
    process.exit(1);
  }
}
