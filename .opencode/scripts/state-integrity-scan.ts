#!/usr/bin/env bun
export {};
// state-integrity-scan.ts — P4-002
// Scans gate-state.json, machine.json, project.config.json, rule_registry.json,
// and Task.DAG.json for JSON validity, required fields, and orphaned references.
// --fix flag auto-fixes invalid JSON and orphaned sessions.
// FW-PLAN-JS-TO-TS: Unified to TypeScript + Bun; imports gate-core.ts source directly.
const {
  readJsonFile,
  fileExists,
  resolveFrameworkPaths,
} = require("../lib/gate-core.ts");
const { readSubState, readMachineMeta } = require("../lib/substate-manager");
// Post-Step-8 DB-only migration: read/write gate state via DB instead of frozen JSON snapshot
const { dbLoadGateStore, dbSaveGateStore } = require("../lib/db-state-manager");

const paths = resolveFrameworkPaths();

function main() {
  const args = process.argv.slice(2);
  const shouldFix = args.includes("--fix");
  const dryRun = args.includes("--dry-run");

  const inconsistencies = [];
  let autoFixPossible = false;

  const files = {
    "gate-state.json": paths.gateState,
    "machine.json": paths.machine,
    "project.config.json": paths.projectConfig,
    "rule_registry.json": paths.ruleRegistry,
    "Task.DAG.json": (paths as any).dag,
  };

  // ── JSON validity check ──
  for (const [name, filepath] of Object.entries(files)) {
    if (!fileExists(filepath)) {
      inconsistencies.push({
        severity: "HIGH",
        file: name,
        issue: "file_missing",
        detail: "File not found",
      });
      continue;
    }
    const parsed = readJsonFile(filepath);
    if (parsed === null && fileExists(filepath)) {
      // fileExists returned true but readJsonFile returned null → invalid JSON
      inconsistencies.push({
        severity: "HIGH",
        file: name,
        issue: "invalid_json",
        detail: "File exists but cannot be parsed as JSON",
      });
      if (shouldFix) {
        autoFixPossible = true;
        inconsistencies.push({
          severity: "INFO",
          file: name,
          issue: "invalid_json_fix",
          detail:
            "Auto-fix not possible for invalid JSON — manual repair required. Run state-machine-reset.sh if needed.",
        });
      }
    }
  }

  // ── Required fields check ──
  // Post-Step-8 DB-only migration: read gate state from DB instead of frozen JSON snapshot
  const gateState = dbLoadGateStore();
  const dag = readJsonFile(files["Task.DAG.json"]);
  const registry = readJsonFile(files["rule_registry.json"]);

  // gate-state.json required fields
  if (gateState) {
    if (!gateState.sessions && !gateState.active_sessions) {
      inconsistencies.push({
        severity: "HIGH",
        file: "gate-state.json",
        issue: "missing_sessions",
        detail: "sessions/active_sessions field missing",
      });
    }
    if (!gateState.formatVersion) {
      inconsistencies.push({
        severity: "WARNING",
        file: "gate-state.json",
        issue: "missing_field",
        detail: "formatVersion field missing",
      });
    }

    // Check session fields (v2: sessions, v3: active_sessions)
    const allSessions = gateState.sessions || gateState.active_sessions;
    if (allSessions) {
      for (const [sid, session] of Object.entries(allSessions)) {
        if (typeof session !== "object" || session === null) {
          continue;
        }
        if (!(session as any).session_id) {
          inconsistencies.push({
            severity: "WARNING",
            file: "gate-state.json",
            issue: "missing_session_id",
            detail: `Session key '${sid}' missing session_id field`,
          });
        }
        if (!(session as any).created_at) {
          inconsistencies.push({
            severity: "WARNING",
            file: "gate-state.json",
            issue: "missing_created_at",
            detail: `Session '${sid}' missing created_at`,
          });
        }
        if (!(session as any).gate_status) {
          inconsistencies.push({
            severity: "WARNING",
            file: "gate-state.json",
            issue: "missing_gate_status",
            detail: `Session '${sid}' missing gate_status`,
          });
        }
      }
    }
  }

  // machine.json required sub-state fields check (P1-B: split architecture)
  // Sub-states now live in dedicated files; readSubState() returns {} for
  // missing/unreadable files, which we flag as structural problems.
  if (fileExists(files["machine.json"])) {
    const machineMeta = readMachineMeta();
    const requiredSubStates = [
      "eslint_state",
      "diagnostic_state", // replaces type_check_state (2026-06-26)
      "dependency_state",
      "format_state",
      "write_audit_state",
      "compliance_records",
      "tdd_enforcement_state",
      "keystone_hashes",
    ];
    for (const key of requiredSubStates) {
      const subState = readSubState(key);
      if (!subState || Object.keys(subState).length === 0) {
        inconsistencies.push({
          severity: "HIGH",
          file: "machine.json",
          issue: "missing_substate",
          detail: `Required sub-state '${key}' missing or empty`,
        });
      }
    }
    // meta and contracts reside in machine.json itself (not split files)
    if (!machineMeta.meta || Object.keys(machineMeta.meta).length === 0) {
      inconsistencies.push({
        severity: "HIGH",
        file: "machine.json",
        issue: "missing_substate",
        detail: `Required sub-state 'meta' missing or empty`,
      });
    }
    if (!machineMeta.contracts) {
      inconsistencies.push({
        severity: "HIGH",
        file: "machine.json",
        issue: "missing_substate",
        detail: `Required sub-state 'contracts' missing`,
      });
    }
    if (!machineMeta.meta || !machineMeta.meta.revision) {
      inconsistencies.push({
        severity: "WARNING",
        file: "machine.json",
        issue: "missing_meta",
        detail: "meta.revision missing",
      });
    }
  }

  // Task.DAG.json required fields
  if (dag) {
    if (!dag.tasks || !Array.isArray(dag.tasks)) {
      inconsistencies.push({
        severity: "HIGH",
        file: "Task.DAG.json",
        issue: "missing_tasks",
        detail: "tasks field missing or not an array",
      });
    }
    if (!dag.meta || !dag.meta.total_tasks) {
      inconsistencies.push({
        severity: "WARNING",
        file: "Task.DAG.json",
        issue: "missing_meta",
        detail: "meta.total_tasks missing",
      });
    }
  }

  // rule_registry.json required fields
  if (registry) {
    if (!registry.entries || typeof registry.entries !== "object") {
      inconsistencies.push({
        severity: "HIGH",
        file: "rule_registry.json",
        issue: "missing_entries",
        detail: "entries field missing",
      });
    }
    if (!registry.meta || !registry.meta.last_regenerated) {
      inconsistencies.push({
        severity: "WARNING",
        file: "rule_registry.json",
        issue: "missing_meta",
        detail: "meta.last_regenerated missing",
      });
    }
  }

  // ── Orphaned reference checks ──
  // FW-REPAIR-STATE-INTEGRITY-EXECORDER (2026-06-14): Build the task ID set
  // from BOTH dag.tasks[] AND dag.execution_order groups. Many DAGs organize
  // tasks in execution_order groups (flat arrays + nested object groups)
  // rather than a flat tasks[] array; the previous tasks[]-only scan produced
  // false "orphaned_task_ref" warnings for any gate-state session whose
  // task_id lived in execution_order only.
  if (gateState && gateState.sessions && dag) {
    const taskIds = new Set();
    if (Array.isArray(dag.tasks)) {
      for (const t of dag.tasks) {
        if (t && t.id) taskIds.add(t.id);
      }
    }
    const eo = dag.execution_order;
    if (eo && typeof eo === "object") {
      for (const group of Object.values(eo)) {
        if (Array.isArray(group)) {
          for (const id of group) {
            if (typeof id === "string") taskIds.add(id);
          }
        } else if (group && typeof group === "object") {
          for (const subgroup of Object.values(
            group as Record<string, unknown>,
          )) {
            if (Array.isArray(subgroup)) {
              for (const id of subgroup) {
                if (typeof id === "string") taskIds.add(id);
              }
            }
          }
        }
      }
    }
    for (const [sid, session] of Object.entries(gateState.sessions)) {
      if (typeof session !== "object" || session === null) continue;
      if ((session as any).task_id && !taskIds.has((session as any).task_id)) {
        inconsistencies.push({
          severity: "WARNING",
          file: "gate-state.json",
          issue: "orphaned_task_ref",
          detail: `Session '${sid}' references non-existent task '${(session as any).task_id}'`,
        });
        autoFixPossible = true;
        if (shouldFix && !dryRun) {
          if (!gateState.drained_sessions) gateState.drained_sessions = {};
          gateState.drained_sessions[sid] = {
            ...session,
            drained_at: new Date().toISOString(),
            drain_reason: "orphaned_task_ref",
          };
          delete gateState.sessions[sid];
          inconsistencies.push({
            severity: "INFO",
            file: "gate-state.json",
            issue: "auto_fix_applied",
            detail: `Session '${sid}' moved to drained_sessions`,
          });
        } else if (shouldFix && dryRun) {
          inconsistencies.push({
            severity: "INFO",
            file: "gate-state.json",
            issue: "dry_run_fix",
            detail: `Would move session '${sid}' to drained_sessions (--fix --dry-run)`,
          });
        }
      }
    }
  }

  // ── FW-PLAN-FIRST (2026-06-14): auto_plan_history cross-check ──
  // Every successful auto-plan attempt must have a matching DAG entry.
  // A "success" record whose dag_task_id is no longer in the DAG indicates
  // a past plan that was pruned without updating history.
  // P1-B: auto_plan_history resides in transaction_state sub-state file.
  const transactionState = readSubState("transaction_state");
  if (transactionState && Array.isArray(transactionState.auto_plan_history)) {
    const taskIds = new Set();
    if (dag && Array.isArray(dag.tasks)) {
      for (const t of dag.tasks) if (t && t.id) taskIds.add(t.id);
    }
    if (dag && dag.execution_order && typeof dag.execution_order === "object") {
      for (const group of Object.values(dag.execution_order)) {
        if (Array.isArray(group)) {
          for (const id of group) if (typeof id === "string") taskIds.add(id);
        } else if (group && typeof group === "object") {
          for (const sg of Object.values(group)) {
            if (Array.isArray(sg))
              for (const id of sg) if (typeof id === "string") taskIds.add(id);
          }
        }
      }
    }
    for (const rec of transactionState.auto_plan_history) {
      if (
        rec &&
        (rec as any).status === "success" &&
        rec.dag_task_id &&
        !taskIds.has(rec.dag_task_id)
      ) {
        inconsistencies.push({
          severity: "WARNING",
          file: "machine.json",
          issue: "auto_plan_orphan",
          detail: `auto_plan_history entry "${rec.dag_task_id}" (success at ${rec.timestamp}) no longer in Task.DAG.json`,
        });
      }
    }
  }

  // ── Apply fixes ──
  // Post-Step-8 DB-only migration: persist gate state fixes via DB instead of frozen JSON snapshot.
  if (shouldFix && !dryRun && autoFixPossible) {
    if (gateState) {
      dbSaveGateStore(gateState);
    }
  }

  // ── Output ──
  const highIssues = inconsistencies.filter((i) => i.severity === "HIGH");
  const valid = highIssues.length === 0;

  console.log(
    JSON.stringify(
      {
        valid,
        inconsistencies,
        auto_fix_possible: autoFixPossible,
        scanned_files: Object.keys(files).filter((k) => fileExists(files[k])),
        summary: `${Object.keys(files).length} files scanned, ${inconsistencies.length} inconsistencies (${highIssues.length} HIGH)`,
      },
      null,
      2,
    ),
  );

  process.exit(valid ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { main };

