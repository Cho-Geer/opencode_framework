#!/usr/bin/env node
// state-integrity-scan.js — P4-002
// Scans gate-state.json, machine.json, project.config.json, rule_registry.json,
// and Task.DAG.json for JSON validity, required fields, and orphaned references.
// --fix flag auto-fixes invalid JSON and orphaned sessions.
// FW-ENHANCE-A2-A5-EXTRAS: migrated to gate-core.ts (dist/lib/gate-core.js)
const { readJsonFile, fileExists, resolveFrameworkPaths } = require('../lib/dist/lib/gate-core.js');

const paths = resolveFrameworkPaths();

function main() {
  const args = process.argv.slice(2);
  const shouldFix = args.includes('--fix');
  const dryRun = args.includes('--dry-run');

  const inconsistencies = [];
  let autoFixPossible = false;

  const files = {
    'gate-state.json': paths.gateState,
    'machine.json': paths.machine,
    'project.config.json': paths.projectConfig,
    'rule_registry.json': paths.ruleRegistry,
    'Task.DAG.json': paths.dag
  };

  // ── JSON validity check ──
  for (const [name, filepath] of Object.entries(files)) {
    if (!fileExists(filepath)) {
      inconsistencies.push({ severity: 'HIGH', file: name, issue: 'file_missing', detail: 'File not found' });
      continue;
    }
    const parsed = readJsonFile(filepath);
    if (parsed === null && fileExists(filepath)) {
      // fileExists returned true but readJsonFile returned null → invalid JSON
      inconsistencies.push({
        severity: 'HIGH',
        file: name,
        issue: 'invalid_json',
        detail: 'File exists but cannot be parsed as JSON'
      });
      if (shouldFix) {
        autoFixPossible = true;
        inconsistencies.push({
          severity: 'INFO',
          file: name,
          issue: 'invalid_json_fix',
          detail: 'Auto-fix not possible for invalid JSON — manual repair required. Run state-machine-reset.sh if needed.'
        });
      }
    }
  }

  // ── Required fields check ──
  const gateState = readJsonFile(files['gate-state.json']);
  const machine = readJsonFile(files['machine.json']);
  const dag = readJsonFile(files['Task.DAG.json']);
  const registry = readJsonFile(files['rule_registry.json']);

  // gate-state.json required fields
  if (gateState) {
    if (!gateState.sessions || typeof gateState.sessions !== 'object') {
      inconsistencies.push({ severity: 'HIGH', file: 'gate-state.json', issue: 'missing_sessions', detail: 'sessions field missing or not an object' });
    }
    if (!gateState.formatVersion) {
      inconsistencies.push({ severity: 'WARNING', file: 'gate-state.json', issue: 'missing_field', detail: 'formatVersion field missing' });
    }

    // Check session fields
    if (gateState.sessions) {
      for (const [sid, session] of Object.entries(gateState.sessions)) {
        if (typeof session !== 'object' || session === null) {
          continue;
        }
        if (!session.session_id) {
          inconsistencies.push({ severity: 'WARNING', file: 'gate-state.json', issue: 'missing_session_id', detail: `Session key '${sid}' missing session_id field` });
        }
        if (!session.created_at) {
          inconsistencies.push({ severity: 'WARNING', file: 'gate-state.json', issue: 'missing_created_at', detail: `Session '${sid}' missing created_at` });
        }
        if (!session.gate_status) {
          inconsistencies.push({ severity: 'WARNING', file: 'gate-state.json', issue: 'missing_gate_status', detail: `Session '${sid}' missing gate_status` });
        }
      }
    }
  }

  // machine.json required fields
  if (machine) {
    const requiredSubStates = ['meta', 'eslint_state', 'type_check_state', 'dependency_state', 'format_state', 'write_audit_state', 'compliance_records', 'tdd_enforcement_state', 'contracts', 'keystone_hashes'];
    for (const key of requiredSubStates) {
      if (!machine[key]) {
        inconsistencies.push({ severity: 'HIGH', file: 'machine.json', issue: 'missing_substate', detail: `Required sub-state '${key}' missing` });
      }
    }
    if (!machine.meta || !machine.meta.revision) {
      inconsistencies.push({ severity: 'WARNING', file: 'machine.json', issue: 'missing_meta', detail: 'meta.revision missing' });
    }
  }

  // Task.DAG.json required fields
  if (dag) {
    if (!dag.tasks || !Array.isArray(dag.tasks)) {
      inconsistencies.push({ severity: 'HIGH', file: 'Task.DAG.json', issue: 'missing_tasks', detail: 'tasks field missing or not an array' });
    }
    if (!dag.meta || !dag.meta.total_tasks) {
      inconsistencies.push({ severity: 'WARNING', file: 'Task.DAG.json', issue: 'missing_meta', detail: 'meta.total_tasks missing' });
    }
  }

  // rule_registry.json required fields
  if (registry) {
    if (!registry.entries || typeof registry.entries !== 'object') {
      inconsistencies.push({ severity: 'HIGH', file: 'rule_registry.json', issue: 'missing_entries', detail: 'entries field missing' });
    }
    if (!registry.meta || !registry.meta.last_regenerated) {
      inconsistencies.push({ severity: 'WARNING', file: 'rule_registry.json', issue: 'missing_meta', detail: 'meta.last_regenerated missing' });
    }
  }

  // ── Orphaned reference checks ──
  if (gateState && gateState.sessions && dag && dag.tasks) {
    const taskIds = new Set(dag.tasks.map(t => t.id));
    for (const [sid, session] of Object.entries(gateState.sessions)) {
      if (typeof session !== 'object' || session === null) continue;
      if (session.task_id && !taskIds.has(session.task_id)) {
        inconsistencies.push({
          severity: 'WARNING',
          file: 'gate-state.json',
          issue: 'orphaned_task_ref',
          detail: `Session '${sid}' references non-existent task '${session.task_id}'`
        });
        autoFixPossible = true;
        if (shouldFix && !dryRun) {
          if (!gateState.drained_sessions) gateState.drained_sessions = {};
          gateState.drained_sessions[sid] = { ...session, drained_at: new Date().toISOString(), drain_reason: 'orphaned_task_ref' };
          delete gateState.sessions[sid];
          inconsistencies.push({
            severity: 'INFO',
            file: 'gate-state.json',
            issue: 'auto_fix_applied',
            detail: `Session '${sid}' moved to drained_sessions`
          });
        } else if (shouldFix && dryRun) {
          inconsistencies.push({
            severity: 'INFO',
            file: 'gate-state.json',
            issue: 'dry_run_fix',
            detail: `Would move session '${sid}' to drained_sessions (--fix --dry-run)`
          });
        }
      }
    }
  }

  // ── Apply fixes ──
  if (shouldFix && !dryRun && autoFixPossible) {
    if (gateState) {
      const fs = require('fs');
      fs.writeFileSync(files['gate-state.json'], JSON.stringify(gateState, null, 2));
    }
  }

  // ── Output ──
  const highIssues = inconsistencies.filter(i => i.severity === 'HIGH');
  const valid = highIssues.length === 0;

  console.log(JSON.stringify({
    valid,
    inconsistencies,
    auto_fix_possible: autoFixPossible,
    scanned_files: Object.keys(files).filter(k => fileExists(files[k])),
    summary: `${Object.keys(files).length} files scanned, ${inconsistencies.length} inconsistencies (${highIssues.length} HIGH)`
  }, null, 2));

  process.exit(valid ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { main };
