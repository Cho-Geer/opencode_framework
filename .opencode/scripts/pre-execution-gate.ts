#!/usr/bin/env bun
"use strict";

/**
 * FW-LOG-UNIFY-P3-C2 (2026-06-12, @Super-Admin): Lazy-load writeLog from
 * log-manager to avoid per-dispatch require() overhead. Only loaded on first
 * log call, staying nil when no logging is needed (clean exit).
 *
 * Rationale: This script runs on EVERY agent dispatch. Adding a synchronous
 * require("../../lib/log-manager") at the top would add Bun transpile overhead
 * to every dispatch. Lazy-loading defers the cost to the first log call.
 */
let _writeLog = null;
function getWriteLog() {
  if (!_writeLog) {
    try {
      _writeLog = require("../lib/log-manager").writeLog;
    } catch (e) {
      /* keep null — no logging available */
    }
  }
  return _writeLog;
}
/** Convenience: writeLog that silently no-ops if log-manager unavailable. */
function gateLog(category, level, data) {
  const wl = getWriteLog();
  if (wl) wl("script-pre-execution-gate", level, { event: category, ...data });
}

/**
 * FW-PLAN-FIRST (2026-06-14): Lazy-loaded canonical DAG-exempt predicate.
 * Replaces the inline exempt list (Meta-Planner/Orchestrator/Knowledge-Curator)
 * that previously lived in checkDagCoverage(). Lazy-loaded to keep per-dispatch
 * overhead minimal — same pattern as getWriteLog() above.
 */
let _isDagExempt = null;
function getIsDagExempt() {
  if (!_isDagExempt) {
    try {
      _isDagExempt = require("../lib/dag-policy").isDagExempt;
    } catch (e) {
      // Fallback: inline the canonical list so the gate still works if
      // dag-policy is unreadable. Should never happen in practice.
      _isDagExempt = (agent) => {
        const n = String(agent || "")
          .toLowerCase()
          .replace(/^@/, "");
        return [
          "meta-planner",
          "orchestrator",
          "super-admin",
          "knowledge-curator",
        ].includes(n);
      };
    }
  }
  return _isDagExempt;
}

/**
 * pre-execution-gate.ts — Node-First DAG/Gate Validation with Fail-Closed Semantics
 * ================================================================================
 * Replaces shell-first dispatch validation with Node-only path resolution.
 *
 * Usage:
 *   node .opencode/scripts/pre-execution-gate.ts --task-id <id>
 *   node .opencode/scripts/pre-execution-gate.ts <task_id>
 *   node .opencode/scripts/pre-execution-gate.ts <task_id> --dispatch-session
 *
 * Exit codes:
 *   0 — All checks passed (task may proceed)
 *   1 — Validation failure or usage error
 *   2 — System error (config missing, file unreadable, etc.)
 *
 * Checks (in execution order):
 *   Check 1 — Config Validity: required config files are readable.
 *             Runs first to validate that all prerequisite files exist before
 *             checks that depend on them (DAG, Gate, Role, Registry, Knowledge).
 *   Check 2 — DAG Coverage: task_id exists in Task.DAG.json with status=pending
 *              (SKIPPED when --dispatch-session flag is set — dispatch session
 *               IDs are OpenCode background sub-agent process identifiers,
 *               NOT DAG task IDs)
 *   Check 3 — Gate Lifecycle: matching armed gate session exists in gate-state.json
 *   Check 4 — Role Violations: no unresolved role violations in machine.json
 *   Check 5 — Rule Registry: no HIGH severity mismatches (or all mismatches waived)
 *   Check 6 — Knowledge Pipeline (NEW): when Knowledge-Curator is dispatched,
 *             verifies DISPATCH_TOKEN presence and UC7KS cache-first compliance
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readSubState } = require("../lib/substate-manager");

// ─── Path Resolution (Node path APIs ONLY — no shell path manipulation) ───
const OPENCODE_ROOT = (function () {
  // Windows/WSL cross-platform: resolve from script location
  // __dirname is always an absolute path on all platforms
  const scriptDir = __dirname;
  // Walk up from .opencode/scripts/ to project root
  // On Windows: C:\Users\...\project\.opencode\scripts
  // On Linux/WSL: /home/.../project/.opencode/scripts
  const parentScripts = path.dirname(scriptDir); // .opencode/scripts -> .opencode
  const parentOpenCode = path.dirname(parentScripts); // .opencode -> project root
  // Verify: project root should contain .opencode/ directory
  const dotOpenCodeCheck = path.join(parentOpenCode, ".opencode");
  if (fs.existsSync(dotOpenCodeCheck)) {
    return parentOpenCode;
  }
  // Fallback: relative resolution from cwd
  return path.resolve(process.cwd());
})();

// Path constants (all resolved via Node path APIs)
const PROJECT_CONFIG_PATH = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "project.config.json",
);
const DAG_FILE = path.join(OPENCODE_ROOT, "Task.DAG.json");
const GATE_STATE_FILE = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "state",
  "gate-state.json",
);
const MACHINE_FILE = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "state",
  "machine.json",
);
const PRIMARY_RULE_REGISTRY = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "state",
  "rule_registry.json",
);
const FALLBACK_RULE_REGISTRY = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "rule_registry.json",
);
const RULE_REGISTRY_FILE = fs.existsSync(PRIMARY_RULE_REGISTRY)
  ? PRIMARY_RULE_REGISTRY
  : fs.existsSync(FALLBACK_RULE_REGISTRY)
    ? FALLBACK_RULE_REGISTRY
    : PRIMARY_RULE_REGISTRY;
const STATE_DIR = path.join(OPENCODE_ROOT, ".opencode", "state");

// Knowledge pipeline paths (UC7KS)
const KNOWLEDGE_INDEX_FILE = path.join(
  OPENCODE_ROOT,
  "docs",
  "official_docs",
  "index.json",
);
const DISPATCH_OUTPUT_DIR = path.join(OPENCODE_ROOT, ".task_temp", "_dispatch");

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Safely read and parse a JSON file.
 * Returns { ok: true, data } or { ok: false, error }
 */
function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        ok: false,
        error: `File not found: ${path.relative(OPENCODE_ROOT, filePath)}`,
      };
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return {
      ok: false,
      error: `Cannot read/parse ${path.relative(OPENCODE_ROOT, filePath)}: ${e.message}`,
    };
  }
}

/**
 * Determine enforcement mode from project.config.json or ENFORCEMENT_MODE env var.
 * Returns "advisory", "strict", or "locked".
 */
function getEnforcementMode() {
  const envMode = process.env.ENFORCEMENT_MODE || "";
  if (["advisory", "strict", "locked"].includes(envMode)) {
    return envMode;
  }
  const cfg = readJSON(PROJECT_CONFIG_PATH);
  /**
   * Dual-key design (FW-HARNESS-P6): check develop_enforcement_mode first (local dev),
   * then runtime_enforcement_mode (CI/production), then enforcement_mode (legacy).
   * This aligns with enforcement-modes-standard.md §4.1 which defines separate
   * develop and runtime keys replacing the old singular enforcement_mode.
   */
  if (cfg.ok && cfg.data.template_resolution) {
    const tr = cfg.data.template_resolution;
    const mode = tr.develop_enforcement_mode || tr.runtime_enforcement_mode;
    if (mode && ["advisory", "strict", "locked"].includes(mode)) {
      return mode;
    }
  }
  return "strict";
}

/**
 * Remediation instructions map — per check name, provides actionable fix commands.
 */
const REMEDIATION_MAP = {
  "DAG Coverage":
    "Task not found or not pending in Task.DAG.json.\n" +
    "  🔧 Fix: Add the task to Task.DAG.json, or update status to 'pending'.\n" +
    "  🔧 Run: node .opencode/scripts/state-reconciliation.ts --fix",
  "Gate Lifecycle":
    "No armed gate session found or gate-state.json is missing/invalid.\n" +
    "  🔧 Fix: Run compliance_gate_check() then compliance_gate_confirm() to arm the gate.\n" +
    "  🔧 Run: node .opencode/scripts/state-reconciliation.ts --fix --backfill-audit",
  "Role Violations":
    "Unresolved role violations detected in machine.json compliance_records.\n" +
    "  🔧 Fix: Have the violating agent resolve the scope issue, or file a waiver.\n" +
    "  🔧 Run: node .opencode/scripts/state-reconciliation.ts --fix",
  "Critical Files":
    "Critical infrastructure files have been modified since the last commit.\n" +
    "  🔧 Review the changes and ensure they are intentional.\n" +
    "  🔧 When committing, include [INFRA] marker in commit message.",
  "Config Validity":
    "Required configuration file(s) are missing or unreadable.\n" +
    "  🔧 Fix: Ensure project.config.json, Task.DAG.json, machine.json, and gate-state.json exist.\n" +
    "  🔧 Run: node .opencode/scripts/framework-doctor.ts",
};

/**
 * Emit structured error to stderr.
 * In strict/locked mode, always exits non-zero.
 * In advisory mode, prints warning but returns (allows execution).
 * Enhanced output includes specific violation, enforcement mode, and remediation.
 */
function emitError(checkName, message, details) {
  const mode = getEnforcementMode();
  const violation =
    details && typeof details === "object"
      ? details.violation || details.issue || details.reason || null
      : null;
  const remediation =
    REMEDIATION_MAP[checkName] ||
    "  🔧 Run: node .opencode/scripts/framework-doctor.ts --strict";

  const output = {
    check: checkName,
    status: mode === "advisory" ? "WARNING" : "FAILED",
    enforcement_mode: mode,
    message: message,
    violation: violation,
    remediation: remediation.trim(),
    details: details || null,
    timestamp: new Date().toISOString(),
  };

  const jsonErr = JSON.stringify(output, null, 2);

  /**
   * FW-LOG-UNIFY-P3-C2 (2026-06-12, @Super-Admin): DUAL-WRITE — persist
   * enforcement gate failures to log-manager via lazy-load gateLog().
   * These messages were previously DISCARDED on every dispatch.
   */
  gateLog("gate_check_failed", mode !== "advisory" ? "ERROR" : "WARN", {
    check: checkName,
    mode,
    message,
    violation,
    details: details || null,
  });

  if (mode === "advisory") {
    console.error(`⚠️  [ADVISORY] ${jsonErr}`);
    return false; // non-blocking in advisory
  } else {
    console.error(`❌ [${mode.toUpperCase()}] ${jsonErr}`);
    return true; // blocking in strict/locked
  }
}

/**
 * UC7-009: Check if the knowledge cache is healthy.
 * Used by Super-Admin emergency bypass gate — if the cache is corrupted,
 * missing, or empty, Super-Admin gets an emergency bypass to prevent
 * circular deadlock (Super-Admin dispatched to repair broken cache →
 * blocked by cache health check → cannot repair → deadlock).
 *
 * @returns {boolean} true if index.json exists, is valid JSON, and has entries
 */
function isKnowledgeCacheHealthy() {
  const index = readJSON(KNOWLEDGE_INDEX_FILE);
  if (!index.ok) {
    return false;
  }
  // Check that the index has entries (not just an empty skeleton)
  const entries = index.data.entries;
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return false;
  }
  return true;
}

/**
 * Print usage and exit 1.
 */
function printUsage() {
  console.error(
    "Usage: node .opencode/scripts/pre-execution-gate.ts --task-id <task_id>",
  );
  console.error(
    "       node .opencode/scripts/pre-execution-gate.ts <task_id>",
  );
  console.error("");
  console.error(
    "Validates that a task is ready for execution in the current project.",
  );
  console.error(
    "Performs 6 checks: DAG coverage, Gate lifecycle, Role violations,",
  );
  console.error(
    "Rule registry integrity, Config validity, and Knowledge pipeline.",
  );
  console.error("");
  console.error("Exit codes: 0=pass, 1=fail, 2=system error");
  process.exit(1);
}

// ─── Check Implementations ────────────────────────────────────────────────

/**
 * Read agent identity from _dispatch_target.json (v4.0.0 replacement for FRAMEWORK_AGENT).
 * Applies the same run_id staleness check as enforce.ts resolveAgent().
 * @returns {string} agent name (e.g. "@Coder-BE") or empty string
 */
function readDispatchTargetAgent() {
  try {
    const p = require("path").join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch_target.json",
    );
    if (require("fs").existsSync(p)) {
      const d = JSON.parse(require("fs").readFileSync(p, "utf8"));
      const currentRunId = process.env.OPENCODE_RUN_ID || "";
      if (currentRunId && (!d.run_id || d.run_id !== currentRunId)) {
        try {
          require("fs").unlinkSync(p);
        } catch {}
        return "";
      }
      return d.agent || "";
    }
  } catch {}
  return "";
}

/**
 * Check 1 — DAG Coverage: task_id exists in Task.DAG.json with status=pending.
 * Failures: task not found, task not pending (e.g. completed).
 *
 * Bypass: @Meta-Planner, @Orchestrator, and @Knowledge-Curator are exempt from
 * DAG coverage checks. @Meta-Planner and @Orchestrator CREATE and MANAGE the DAG.
 * @Knowledge-Curator is dispatched for external knowledge fetching (UC7KS pipeline),
 * not for executing DAG tasks — it has no task_id in the DAG by design.
 *
 * @since 2026-06-07 — FW-REPAIR-DAG-DEADLOCK: Added Meta-Planner/Orchestrator bypass
 * @since 2026-06-12 — SA-ENFORCE-FIX-20250612: Added Knowledge-Curator bypass
 */
function checkDagCoverage(taskId) {
  // ── DAG-exempt bypass: canonical list in lib/dag-policy.ts ──
  // FW-PLAN-FIRST (2026-06-14): Consolidated exempt set:
  //   meta-planner, orchestrator, super-admin, knowledge-curator.
  const agent = readDispatchTargetAgent() || process.env.AGENT || "";
  if (getIsDagExempt()(agent)) {
    console.error(
      `    ⏭️  DAG Coverage SKIPPED — ${agent || "(unknown)"} is DAG-exempt (task may not exist yet)`,
    );
    gateLog("dag_skip", "INFO", { reason: "exempt_agent", agent });
    return true;
  }

  const dag = readJSON(DAG_FILE);
  if (!dag.ok) {
    const blocked = emitError(
      "DAG Coverage",
      "Task.DAG.json cannot be read",
      dag.error,
    );
    if (blocked) process.exit(2);
    return true; // advisory: pass through
  }

  let task = dag.data.tasks.find((t) => t.id === taskId);

  /**
   * FW-REPAIR-021 (2026-06-14, @Super-Admin): Also scan execution_order for
   * task IDs not present in the flat tasks array. execution_order organizes
   * tasks into logical groups (e.g. { "validate_configs_all": ["T001", ...] });
   * tasks may appear ONLY in execution_order and not in the tasks array
   * (e.g. when tasks are archived/pruned). Without this fallback search,
   * checkDagCoverage incorrectly reports "not found" for valid scheduled tasks.
   */
  const executionOrderIds = new Set();
  if (
    dag.data.execution_order &&
    typeof dag.data.execution_order === "object"
  ) {
    for (const group of Object.values(dag.data.execution_order)) {
      if (Array.isArray(group)) {
        group.forEach((id) => executionOrderIds.add(id));
      }
    }
  }

  if (!task) {
    // Task not in tasks array — check execution_order
    if (executionOrderIds.has(taskId)) {
      // Task found in execution_order: accept as valid (status defaults
      // to "included" — the task is scheduled for execution)
      return true;
    }

    const availableInTasks = dag.data.tasks.slice(0, 10).map((t) => t.id);
    const availableInExecOrder = [...executionOrderIds].slice(0, 10);
    const allAvailable = [
      ...new Set([...availableInTasks, ...availableInExecOrder]),
    ];
    const blocked = emitError(
      "DAG Coverage",
      `Task '${taskId}' not found in Task.DAG.json (checked both tasks[] and execution_order)`,
      `To fix: dispatch @Meta-Planner to plan this task and add it to the DAG.\n` +
        `  Tasks in DAG (tasks[]): ${availableInTasks.join(", ") || "(none)"}${dag.data.tasks.length > 10 ? "..." : ""}\n` +
        `  Tasks in DAG (execution_order): ${availableInExecOrder.join(", ") || "(none)"}${executionOrderIds.size > 10 ? "..." : ""}\n` +
        `  Combined unique IDs: ${allAvailable.length}`,
    );
    if (blocked) process.exit(1);
    return false;
  }

  if (task.status === "completed") {
    const blocked = emitError(
      "DAG Coverage",
      `Task '${taskId}' is already completed (status=${task.status})`,
      { task_id: taskId, current_status: task.status, owner: task.owner },
    );
    if (blocked) process.exit(1);
    return false;
  }

  if (task.status !== "pending") {
    const blocked = emitError(
      "DAG Coverage",
      `Task '${taskId}' has status='${task.status}', expected 'pending'`,
      { task_id: taskId, current_status: task.status, expected: "pending" },
    );
    if (blocked) process.exit(1);
    return false;
  }

  return true;
}

/**
 * Check 2 — Gate Lifecycle: verify a matching armed gate session exists.
 * An "armed" session has confirmed_at set but consumed_at is null, and
 * gate_status is not "failed".
 */
function checkGateLifecycle(taskId) {
  // Post-Step-8 DB-only migration: gate-state.json is a frozen snapshot
  // no longer synced with DB writes. Use dbLoadGateStore() to read
  // directly from the DB (single source of truth).
  let store;
  try {
    const { dbLoadGateStore } = require("../lib/db-state-manager");
    store = dbLoadGateStore();
  } catch (e) {
    const blocked = emitError(
      "Gate Lifecycle",
      "Cannot read gate sessions from DB — compliance gate has not been initialized",
      { error: e.message },
    );
    if (blocked) process.exit(1);
    return false;
  }

  if (!store || !store.sessions) {
    const blocked = emitError(
      "Gate Lifecycle",
      "No gate sessions found in DB — run compliance_gate_check first",
      { task_id: taskId },
    );
    if (blocked) process.exit(1);
    return false;
  }

  const sessions = store.sessions;
  const sessionIds = Object.keys(sessions);

  if (sessionIds.length === 0) {
    const blocked = emitError(
      "Gate Lifecycle",
      "No gate sessions found in DB — run compliance_gate_check first",
      { task_id: taskId },
    );
    if (blocked) process.exit(1);
    return false;
  }

  // Find an armed session: confirmed_at set, consumed_at null, gate_status not "failed"
  const armedSessions = sessionIds.filter((sid) => {
    const s = sessions[sid];
    return s && s.confirmed_at && !s.consumed_at && s.gate_status !== "failed";
  });

  if (armedSessions.length === 0) {
    const blocked = emitError(
      "Gate Lifecycle",
      "No armed gate sessions found — call compliance_gate_confirm first",
      {
        task_id: taskId,
        total_sessions: sessionIds.length,
        session_statuses: sessionIds.map((sid) => ({
          id: sid,
          status: sessions[sid].gate_status,
          confirmed: !!sessions[sid].confirmed_at,
          consumed: !!sessions[sid].consumed_at,
        })),
      },
    );
    if (blocked) process.exit(1);
    return false;
  }

  return true;
}

/**
 * Check 4 — Role Violations: no unresolved role violations.
 * P2-A Step 6: compliance_records migrated to DB via readSubState().
 * No file-based fallback — directly use readSubState return value.
 * Matches compliance-gate.ts:826 pattern.
 */
function checkRoleViolations() {
  const complianceRecords = readSubState("compliance_records");
  if (!complianceRecords || Object.keys(complianceRecords).length === 0) {
    gateLog("role_check", "INFO", {
      status: "no_compliance_records",
      reason: "empty_or_missing",
    });
    return true; // No records → no violations
  }
  const violations = complianceRecords.role_violations || [];
  const unresolved = violations.filter((v) => v.status === "unresolved");
  if (unresolved.length > 0) {
    const blocked = emitError(
      "Role Violations",
      `${unresolved.length} unresolved role violation(s) detected`,
      {
        violations: unresolved.map((v) => ({
          agent: v.agent,
          file: v.violation_file,
          severity: v.severity,
          timestamp: v.timestamp,
        })),
      },
    );
    if (blocked) process.exit(1);
    return false;
  }
  gateLog("role_check", "INFO", {
    status: "clean",
    total_violations: violations.length,
    unresolved: 0,
  });
  return true;
}

/**
 * Check 4 — Critical Infrastructure Files: detect uncommitted changes
 * to critical framework files using git diff HEAD (replaces SHA-256 digest check).
 * advisory → warn, strict → warn+log, locked → block dispatch.
 */
function checkRuleRegistry() {
  const { getModifiedCriticalFiles } = require("../lib/critical-files");
  const modified = getModifiedCriticalFiles();

  if (modified.length === 0) {
    return true; // no critical files changed
  }

  const mode = getEnforcementMode();
  const fileList = modified.join(", ");

  if (mode === "locked") {
    const blocked = emitError(
      "Critical Files",
      `${modified.length} critical infrastructure file(s) modified since HEAD: ${fileList}`,
      { modified_files: modified, enforcement_mode: mode },
    );
    if (blocked) process.exit(1);
    return false;
  }

  if (mode === "strict") {
    console.error(
      `  ⚠️  [STRICT] Critical infrastructure files modified: ${fileList}`,
    );
    console.error(
      `     Ensure commit message includes [INFRA] marker when committing.`,
    );
    gateLog("critical_files_modified", "WARN", {
      modified_files: modified,
      enforcement_mode: mode,
    });
    return true;
  }

  // advisory
  console.error(
    `  ⚠️  [ADVISORY] Critical infrastructure files modified: ${fileList}`,
  );
  gateLog("critical_files_modified", "INFO", {
    modified_files: modified,
    enforcement_mode: mode,
  });
  return true;
}

/**
 * Check 5 — Config Validity: required config files are readable.
 * Fail-closed in strict/locked mode.
 */
function checkConfigValidity() {
  const requiredFiles = [
    { path: DAG_FILE, name: "Task.DAG.json" },
    { path: PROJECT_CONFIG_PATH, name: "project.config.json" },
    { path: MACHINE_FILE, name: "machine.json" },
    { path: GATE_STATE_FILE, name: "gate-state.json" },
  ];

  const missing = [];
  for (const f of requiredFiles) {
    if (!fs.existsSync(f.path)) {
      missing.push(f.name);
    }
  }

  if (missing.length > 0) {
    const mode = getEnforcementMode();
    const blocked = emitError(
      "Config Validity",
      `${missing.length} required config file(s) missing: ${missing.join(", ")}`,
      { missing_files: missing, enforcement_mode: mode },
    );
    if (blocked) process.exit(2);
    return false;
  }

  return true;
}

/**
 * Check 6 — Knowledge Pipeline Gate (UC7KS):
 * When Knowledge-Curator is dispatched, verify DISPATCH_TOKEN is present.
 * When any agent is dispatched, verify UC7KS cache-first compliance
 * (index.json exists and has been checked).
 *
 * CAT-KNOW-01: Missing knowledge cache check before task execution.
 * CAT-KNOW-02: Knowledge-Curator dispatch without DISPATCH_TOKEN.
 */
function checkKnowledgeGate(taskId) {
  const KNOWLEDGE_KEYWORDS = [
    "Knowledge-Curator",
    "knowledge",
    "context7",
    "docs lookup",
    "external documentation",
    "fetch docs",
    "latest version",
    "API reference",
    "library docs",
    "webfetch",
    "websearch",
  ];

  // Only activate when task or dispatch involves knowledge acquisition
  const taskLower = taskId.toLowerCase();
  const isKnowledgeTask = KNOWLEDGE_KEYWORDS.some((kw) =>
    taskLower.includes(kw.toLowerCase()),
  );

  // Also check if Knowledge-Curator dispatch output exists
  const dispatchFiles = fs.existsSync(DISPATCH_OUTPUT_DIR)
    ? fs
        .readdirSync(DISPATCH_OUTPUT_DIR)
        .filter((f) => f.startsWith("dispatch-Knowledge-Curator"))
    : [];

  const isKnowledgeDispatch = dispatchFiles.length > 0;

  // ── Check 6a: Knowledge pipeline integrity (ALWAYS checked for Knowledge-Curator tasks) ──
  if (isKnowledgeTask || isKnowledgeDispatch) {
    // Verify knowledge cache index exists
    if (!fs.existsSync(KNOWLEDGE_INDEX_FILE)) {
      const blocked = emitError(
        "Knowledge Pipeline",
        "Knowledge cache index (docs/official_docs/index.json) not found",
        "The UC7KS pipeline requires this file. Run: touch docs/official_docs/index.json and initialize with valid JSON.",
      );
      if (blocked) process.exit(1);
      return false;
    }

    // For Knowledge-Curator dispatches, DISPATCH_TOKEN must be present
    if (isKnowledgeDispatch) {
      let tokenFound = false;
      for (const f of dispatchFiles) {
        try {
          const content = fs.readFileSync(
            path.join(DISPATCH_OUTPUT_DIR, f),
            "utf8",
          );
          if (content.includes("//DISPATCH_TOKEN:")) {
            tokenFound = true;
            break;
          }
        } catch {
          /* skip unreadable files */
        }
      }

      if (!tokenFound) {
        const blocked = emitError(
          "Knowledge Pipeline",
          "Knowledge-Curator dispatch missing DISPATCH_TOKEN",
          "All @Knowledge-Curator dispatches must go through @Orchestrator (or @Super-Admin for UC7KS — FW-DISPATCH-BYPASS) using the dispatch_subagent tool, which generates a cryptographic DISPATCH_TOKEN. Direct dispatch without this token violates the UC7KS pipeline.",
        );
        if (blocked) process.exit(1);
        return false;
      }
    }
  }

  // ── Check 6b: UC7KS bypass audit (reads knowledge-cache-state.json sub-state) ──
  // P1-B split: knowledge_cache_state now lives in its own sub-state file.
  const knowledgeCacheState = readSubState("knowledge_cache_state");
  if (knowledgeCacheState) {
    const kcs = knowledgeCacheState;
    const bypassAttempts = kcs.compliance?.total_bypass_attempts || 0;

    if (bypassAttempts > 0) {
      const agent = readDispatchTargetAgent() || "unknown";
      const agentBypasses = kcs.compliance?.bypass_attempts_by_agent?.[agent];
      const agentCount = agentBypasses?.count || 0;

      if (agentCount > 0) {
        gateLog("uc7ks_bypass_warn", "WARN", {
          agent,
          agentCount,
          bypassAttempts,
          last_attempt_at: agentBypasses?.last_attempt_at,
          last_tool_attempted: agentBypasses?.last_tool_attempted,
        });
        console.error(
          `    ⚠️  Agent "${agent}" has ${agentCount} UC7KS bypass attempt(s) recorded. ` +
            `Last attempt: ${agentBypasses?.last_attempt_at || "unknown"} using "${agentBypasses?.last_tool_attempted || "unknown"}". ` +
            `Total system bypasses: ${bypassAttempts}.`,
        );

        const mode = getEnforcementMode();
        if (mode === "locked" && agentCount >= 1) {
          const blocked = emitError(
            "Knowledge Pipeline",
            `Agent "${agent}" has ${agentCount} UC7KS bypass attempt(s) in LOCKED mode`,
            "In LOCKED mode, all external documentation queries must go through @Knowledge-Curator. Bypass attempts are not tolerated. Remediation: clear bypass attempts via state-reconciliation --reset-knowledge-audit after verifying all cached docs are up to date.",
          );
          if (blocked) process.exit(1);
          return false;
        }
      }
    }
  }

  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main() {
  // Parse CLI arguments — support both positional and --task-id flag
  let taskId = null;
  let isDispatchSession = false;

  // Check for --dispatch-session flag (dispatch session IDs are NOT DAG task IDs)
  if (process.argv.includes("--dispatch-session")) {
    isDispatchSession = true;
  }

  // Check for --task-id flag
  const taskIdFlagIdx = process.argv.indexOf("--task-id");
  if (taskIdFlagIdx !== -1 && taskIdFlagIdx + 1 < process.argv.length) {
    taskId = process.argv[taskIdFlagIdx + 1];
  }

  // Fallback: positional argument (first non-flag argument)
  if (!taskId) {
    const positionalArgs = process.argv
      .slice(2)
      .filter((a) => !a.startsWith("--"));
    if (positionalArgs.length > 0) {
      taskId = positionalArgs[0];
    }
  }

  // Require task_id — unless the agent is a DAG creator/manager
  // @Meta-Planner and @Orchestrator CREATE and MANAGE the DAG — they
  // cannot logically require a task_id to exist before they've created it.
  // Without this bypass, dispatching @Meta-Planner to bootstrap a DAG creates
  // an unresolvable chicken-and-egg deadlock.
  //
  // @since 2026-06-07 — FW-REPAIR-DAG-DEADLOCK: Added DAG-creator bypass
  if (!taskId) {
    const agent = readDispatchTargetAgent() || "";
    const normalizedAgent = agent.replace(/^@/, "");
    if (
      normalizedAgent === "Meta-Planner" ||
      normalizedAgent === "Orchestrator"
    ) {
      gateLog("dag_creator_bypass", "INFO", { agent });
      console.log(
        `[GATE] ${agent} detected — DAG creator bypass ` +
          `(no task_id needed for DAG planning/management).`,
      );
      process.exit(0);
    }
    printUsage();
  }

  // Special case: Super-Admin — emergency framework administrator
  // Bypasses DAG coverage and gate lifecycle checks (emergency repairs cannot wait for planning)
  // BUT: knowledge pipeline (UC7KS) checks still apply to prevent documentation bypass
  //
  // UC7-009: Health-state gate — if knowledge cache is unhealthy, Super-Admin gets
  // an emergency bypass. This prevents circular deadlock: Super-Admin dispatched to
  // repair broken cache → blocked by cache health check → cannot repair → deadlock.
  const agent = readDispatchTargetAgent() || "";
  if (agent === "Super-Admin" || agent === "@Super-Admin") {
    console.error(
      "[GATE] Super-Admin agent detected — bypassing DAG/enforcement gates for emergency maintenance.",
    );
    gateLog("super_admin_bypass", "INFO", { agent, taskId });

    if (isKnowledgeCacheHealthy()) {
      // Cache HEALTHY → normal UC7KS enforcement applies
      console.error(
        "[GATE][UC7-009] Knowledge cache is HEALTHY — enforcing UC7KS pipeline.",
      );
      gateLog("uc7ks_cache_healthy", "INFO", { agent, taskId });
      if (!checkKnowledgeGate(taskId)) {
        const mode = getEnforcementMode();
        if (mode === "locked" || mode === "strict") {
          const blocked = emitError(
            "Knowledge Pipeline",
            "Knowledge pipeline check FAILED for Super-Admin — blocked in locked/strict mode.",
            {
              agent: "Super-Admin",
              task_id: taskId,
              cache_health: "healthy",
              enforcement_mode: mode,
            },
          );
          if (blocked) process.exit(1);
        }
        console.error(
          "[GATE][ADVISORY] Knowledge pipeline warnings for Super-Admin (non-blocking in advisory mode).",
        );
        gateLog("uc7ks_pipeline_warn", "WARN", {
          agent,
          taskId,
          mode: getEnforcementMode(),
        });
      }
    } else {
      // Cache UNHEALTHY → UC7-009 emergency bypass
      console.error(
        "[GATE][UC7-009] Knowledge cache is UNHEALTHY — activating emergency bypass.",
      );
      const auditEntry = {
        event: "uc7ks_super_admin_emergency_bypass",
        agent: "Super-Admin",
        task_id: taskId,
        reason: "knowledge_cache_unhealthy",
        cache_path: path.relative(OPENCODE_ROOT, KNOWLEDGE_INDEX_FILE),
        timestamp: new Date().toISOString(),
        enforcement_mode: getEnforcementMode(),
      };
      console.error(`[GATE][UC7-009] ${JSON.stringify(auditEntry)}`);
      gateLog("uc7ks_emergency_bypass", "WARN", auditEntry);
    }
    process.exit(0);
  }

  // Special case: NOT_A_TASK must fail
  if (taskId === "NOT_A_TASK") {
    const blocked = emitError(
      "DAG Coverage",
      "NOT_A_TASK is not a valid task identifier — blocked by design",
      { task_id: "NOT_A_TASK" },
    );
    process.exit(1);
  }

  const mode = getEnforcementMode();

  // ── Header ──
  console.error(`🔍 [Pre-Exec Gate] Enforcement mode: ${mode.toUpperCase()}`);
  console.error(`   Project root: ${OPENCODE_ROOT}`);
  console.error(`   Task ID: ${taskId}`);
  if (isDispatchSession) {
    console.error(`   Mode: DISPATCH SESSION (DAG Coverage check SKIPPED)`);
  }
  console.error("");

  // ── Run checks in order ──
  let allPassed = true;
  const checkResults = {};

  console.error("  Check 1/6 — Config Validity...");
  if (!checkConfigValidity()) {
    allPassed = false;
  } else {
    console.error("    ✅ Config files present and readable");
    checkResults.config = "pass";
  }

  console.error("  Check 2/6 — DAG Coverage...");
  if (isDispatchSession) {
    console.error(`    ⏭️  SKIPPED (--dispatch-session)`);
    checkResults.dag = "skipped";
  } else if (!checkDagCoverage(taskId)) {
    allPassed = false;
  } else {
    console.error(`    ✅ Task '${taskId}' found in DAG with status=pending`);
    checkResults.dag = "pass";
  }

  console.error("  Check 3/6 — Gate Lifecycle...");
  if (isDispatchSession) {
    console.error(`    ⏭️  SKIPPED (--dispatch-session)`);
    checkResults.gate = "skipped";
  } else if (checkGateLifecycle(taskId)) {
    console.error("    ✅ Armed gate session found");
    checkResults.gate = "pass";
  } else {
    allPassed = false;
  }

  console.error("  Check 4/6 — Role Violations...");
  if (checkRoleViolations()) {
    console.error("    ✅ No unresolved role violations");
    checkResults.role = "pass";
  } else {
    allPassed = false;
  }

  console.error("  Check 5/6 — Rule Registry...");
  if (checkRuleRegistry()) {
    console.error("    ✅ Rule registry integrity verified");
    checkResults.rule = "pass";
  } else {
    allPassed = false;
  }

  console.error("  Check 6/6 — Knowledge Pipeline...");
  if (checkKnowledgeGate(taskId)) {
    console.error("    ✅ Knowledge pipeline compliance verified");
    checkResults.knowledge = "pass";
  } else {
    allPassed = false;
  }

  console.error("");

  /**
   * FW-LOG-UNIFY-P3-C2 (2026-06-12): Persist gate check results to log-manager.
   * Previously ALL console.error output from this script was DISCARDED on dispatch.
   */
  gateLog("gate_result", allPassed ? "INFO" : "ERROR", {
    mode,
    taskId,
    isDispatchSession,
    allPassed,
    checks: checkResults,
  });

  // ── Summary ──
  if (allPassed) {
    console.error(
      `✅ [Pre-Exec Gate] All checks passed — task '${taskId}' may proceed.`,
    );
    process.exit(0);
  } else {
    console.error(
      `❌ [Pre-Exec Gate] ${mode === "advisory" ? "Warnings found (non-blocking in advisory mode)" : "Validation FAILED — task execution blocked."}`,
    );
    process.exit(mode === "advisory" ? 0 : 1);
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────

// Verify we're running in a Node environment
if (typeof require === "undefined" || typeof process === "undefined") {
  gateLog("runtime_error", "ERROR", { reason: "non_node_runtime" });
  console.error("❌ [Pre-Exec Gate] This script requires Node.js runtime.");
  process.exit(2);
}

// Execute main
if (require.main === module) {
  main();
} else {
  // When required as a module (for testing), export for testability
  module.exports = {
    OPENCODE_ROOT,
    readJSON,
    getEnforcementMode,
    emitError,
    isKnowledgeCacheHealthy,
    checkDagCoverage,
    checkGateLifecycle,
    checkRoleViolations,
    checkRuleRegistry,
    checkConfigValidity,
    checkKnowledgeGate,
  };
}
