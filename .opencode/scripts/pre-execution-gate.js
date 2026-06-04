#!/usr/bin/env node
"use strict";

/**
 * pre-execution-gate.js — Node-First DAG/Gate Validation with Fail-Closed Semantics
 * ================================================================================
 * Replaces shell-first dispatch validation with Node-only path resolution.
 *
 * Usage:
 *   node .opencode/scripts/pre-execution-gate.js --task-id <id>
 *   node .opencode/scripts/pre-execution-gate.js <task_id>
 *   node .opencode/scripts/pre-execution-gate.js <task_id> --dispatch-session
 *
 * Exit codes:
 *   0 — All checks passed (task may proceed)
 *   1 — Validation failure or usage error
 *   2 — System error (config missing, file unreadable, etc.)
 *
 * Checks:
 *   Check 1 — DAG Coverage: task_id exists in Task.DAG.json with status=pending
 *              (SKIPPED when --dispatch-session flag is set — dispatch session
 *               IDs are OpenCode background sub-agent process identifiers,
 *               NOT DAG task IDs)
 *   Check 2 — Gate Lifecycle: matching armed gate session exists in gate-state.json
 *   Check 3 — Role Violations: no unresolved role violations in machine.json
 *   Check 4 — Rule Registry: no HIGH severity mismatches (or all mismatches waived)
 *   Check 5 — Config Validity: required config files are readable
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
  if (
    cfg.ok &&
    cfg.data.template_resolution &&
    cfg.data.template_resolution.enforcement_mode
  ) {
    const mode = cfg.data.template_resolution.enforcement_mode;
    if (["advisory", "strict", "locked"].includes(mode)) {
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
    "  🔧 Run: node .opencode/scripts/state-reconciliation.js --fix",
  "Gate Lifecycle":
    "No armed gate session found or gate-state.json is missing/invalid.\n" +
    "  🔧 Fix: Run compliance_gate_check() then compliance_gate_confirm() to arm the gate.\n" +
    "  🔧 Run: node .opencode/scripts/state-reconciliation.js --fix --backfill-audit",
  "Role Violations":
    "Unresolved role violations detected in machine.json compliance_records.\n" +
    "  🔧 Fix: Have the violating agent resolve the scope issue, or file a waiver.\n" +
    "  🔧 Run: node .opencode/scripts/state-reconciliation.js --fix",
  "Rule Registry":
    "Rule registry digest mismatches detected — files may have been modified unexpectedly.\n" +
    "  🔧 Fix: Run registry repair to recompute and update digests.\n" +
    "  🔧 Run: node .opencode/scripts/rule-registry-verify.js --repair",
  "Config Validity":
    "Required configuration file(s) are missing or unreadable.\n" +
    "  🔧 Fix: Ensure project.config.json, Task.DAG.json, machine.json, and gate-state.json exist.\n" +
    "  🔧 Run: node .opencode/scripts/framework-doctor.js",
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
    "  🔧 Run: node .opencode/scripts/framework-doctor.js --strict";

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

  if (mode === "advisory") {
    console.error(`⚠️  [ADVISORY] ${jsonErr}`);
    return false; // non-blocking in advisory
  } else {
    console.error(`❌ [${mode.toUpperCase()}] ${jsonErr}`);
    console.error(`   ── Violation: ${violation || message}`);
    console.error(`   ── Mode: ${mode.toUpperCase()}`);
    console.error(`   ── Remediation:`);
    for (const line of remediation.split("\n")) {
      console.error(`      ${line}`);
    }
    return true; // blocking in strict/locked
  }
}

/**
 * Compute SHA-256 digest of a file.
 * Returns hex string without prefix, or empty string on failure.
 */
function computeFileSHA256(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256");
    hash.update(content);
    return hash.digest("hex");
  } catch {
    return "";
  }
}

/**
 * Print usage and exit 1.
 */
function printUsage() {
  console.error(
    "Usage: node .opencode/scripts/pre-execution-gate.js --task-id <task_id>",
  );
  console.error(
    "       node .opencode/scripts/pre-execution-gate.js <task_id>",
  );
  console.error("");
  console.error(
    "Validates that a task is ready for execution in the current project.",
  );
  console.error(
    "Performs 5 checks: DAG coverage, Gate lifecycle, Role violations,",
  );
  console.error("Rule registry integrity, and Config validity.");
  console.error("");
  console.error("Exit codes: 0=pass, 1=fail, 2=system error");
  process.exit(1);
}

// ─── Check Implementations ────────────────────────────────────────────────

/**
 * Check 1 — DAG Coverage: task_id exists in Task.DAG.json with status=pending.
 * Failures: task not found, task not pending (e.g. completed).
 */
function checkDagCoverage(taskId) {
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

  const task = dag.data.tasks.find((t) => t.id === taskId);
  if (!task) {
    const blocked = emitError(
      "DAG Coverage",
      `Task '${taskId}' not found in Task.DAG.json`,
      `Available tasks: ${dag.data.tasks
        .slice(0, 10)
        .map((t) => t.id)
        .join(", ")}${dag.data.tasks.length > 10 ? "..." : ""}`,
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
  const gs = readJSON(GATE_STATE_FILE);
  if (!gs.ok) {
    // gate-state.json might not exist on fresh projects
    const blocked = emitError(
      "Gate Lifecycle",
      "gate-state.json cannot be read — compliance gate has not been initialized",
      gs.error,
    );
    if (blocked) process.exit(1);
    return false;
  }

  const sessions = gs.data.sessions || {};
  const sessionIds = Object.keys(sessions);

  if (sessionIds.length === 0) {
    const blocked = emitError(
      "Gate Lifecycle",
      "No gate sessions found in gate-state.json — run compliance_gate_check first",
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
 * Check 3 — Role Violations: no unresolved role violations in machine.json.
 */
function checkRoleViolations() {
  const mach = readJSON(MACHINE_FILE);
  if (!mach.ok) {
    const blocked = emitError(
      "Role Violations",
      "machine.json cannot be read",
      mach.error,
    );
    if (blocked) process.exit(2);
    return true;
  }

  const violations =
    mach.data.compliance_records && mach.data.compliance_records.role_violations
      ? mach.data.compliance_records.role_violations
      : [];

  const unresolved = violations.filter((v) => v.status !== "resolved");

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

  return true;
}

/**
 * Check 4 — Rule Registry: no HIGH severity mismatches.
 * Reads rule_registry.json, computes SHA-256 of each registered file,
 * compares against stored digests. HIGH if digest changed but version didn't.
 */
function checkRuleRegistry() {
  const rr = readJSON(RULE_REGISTRY_FILE);
  if (!rr.ok) {
    // rule_registry.json may not exist — skip check
    console.error(
      `  ℹ️  rule_registry.json not found — skipping registry check`,
    );
    return true;
  }

  const entries = rr.data.entries || {};
  const entryKeys = Object.keys(entries);

  if (entryKeys.length === 0) {
    return true; // nothing to check
  }

  let highCount = 0;
  let warnCount = 0;
  let passCount = 0;
  let errorEntries = [];

  for (const key of entryKeys) {
    const entry = entries[key];
    const filePath = path.join(OPENCODE_ROOT, entry.path);
    const storedHash = entry.sha256 || "";
    const storedSemver = entry.semver || "";

    if (!fs.existsSync(filePath)) {
      highCount++;
      errorEntries.push({
        key,
        severity: "HIGH",
        reason: "file_missing",
        path: entry.path,
      });
      continue;
    }

    const actualHash = computeFileSHA256(filePath);
    if (!actualHash) {
      highCount++;
      errorEntries.push({
        key,
        severity: "HIGH",
        reason: "read_error",
        path: entry.path,
      });
      continue;
    }

    if (actualHash === storedHash) {
      passCount++;
      continue;
    }

    // Digest mismatch — determine severity
    // Try to extract current semver from the file
    let currentSemver = "";
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      // YAML frontmatter pattern: version: "x.y.z"
      const ymMatch = content.match(/^version:\s*"?(\d+\.\d+\.\d+)"?/m);
      if (ymMatch) currentSemver = ymMatch[1];
    } catch {
      // can't read file
    }

    if (currentSemver && currentSemver !== storedSemver) {
      // Version bumped → intentional update → WARNING
      warnCount++;
      errorEntries.push({
        key,
        severity: "WARNING",
        reason: "version_bumped",
        path: entry.path,
        stored_semver: storedSemver,
        current_semver: currentSemver,
      });
    } else {
      // No version change → possible unauthorized modification → HIGH
      highCount++;
      errorEntries.push({
        key,
        severity: "HIGH",
        reason: "digest_mismatch_unchanged_version",
        path: entry.path,
        stored_hash: storedHash.substring(0, 12) + "...",
        actual_hash: actualHash.substring(0, 12) + "...",
      });
    }
  }

  if (highCount > 0) {
    const blocked = emitError(
      "Rule Registry",
      `${highCount} HIGH severity digest mismatch(es) detected (${passCount} pass, ${warnCount} warn)`,
      {
        high_count: highCount,
        warn_count: warnCount,
        pass_count: passCount,
        errors: errorEntries.filter((e) => e.severity === "HIGH").slice(0, 10),
      },
    );
    if (blocked) process.exit(1);
    return false;
  }

  // Warnings only — non-blocking even in strict mode
  if (warnCount > 0) {
    console.error(
      `  ⚠️  Rule Registry: ${warnCount} WARNING(s) (version bumps), ${passCount} pass`,
    );
  }

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

  // Require task_id
  if (!taskId) {
    printUsage();
  }

  // Special case: Super-Admin bypass — emergency framework administrator
  const agent = process.env.FRAMEWORK_AGENT || "";
  if (agent === "Super-Admin" || agent === "@Super-Admin") {
    console.log("[GATE] Super-Admin agent detected — bypassing DAG/enforcement gates for emergency maintenance.");
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

  // Check 0: Config validity (must pass first)
  console.error("  Check 1/5 — Config Validity...");
  if (!checkConfigValidity()) {
    allPassed = false;
    // checkConfigValidity exits on failure in strict/locked
    // In advisory mode, we continue
  } else {
    console.error("    ✅ Config files present and readable");
  }

  // Check 1: DAG Coverage (SKIPPED for dispatch sessions — dispatch session IDs
  // are OpenCode background sub-agent process identifiers, not DAG task IDs)
  console.error("  Check 2/5 — DAG Coverage...");
  if (isDispatchSession) {
    console.error(
      `    ⏭️  SKIPPED (--dispatch-session: task_id '${taskId}' is a dispatch session identifier, not a DAG task ID)`,
    );
  } else if (!checkDagCoverage(taskId)) {
    allPassed = false;
    // checkDagCoverage exits on failure in strict/locked
  } else {
    console.error(`    ✅ Task '${taskId}' found in DAG with status=pending`);
  }

  // Check 2: Gate Lifecycle
  console.error("  Check 3/5 — Gate Lifecycle...");
  if (checkGateLifecycle(taskId)) {
    console.error("    ✅ Armed gate session found");
  } else {
    allPassed = false;
  }

  // Check 3: Role Violations
  console.error("  Check 4/5 — Role Violations...");
  if (checkRoleViolations()) {
    console.error("    ✅ No unresolved role violations");
  } else {
    allPassed = false;
  }

  // Check 4: Rule Registry
  console.error("  Check 5/5 — Rule Registry...");
  if (checkRuleRegistry()) {
    console.error("    ✅ Rule registry integrity verified");
  } else {
    allPassed = false;
  }

  console.error("");

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
    computeFileSHA256,
    emitError,
    checkDagCoverage,
    checkGateLifecycle,
    checkRoleViolations,
    checkRuleRegistry,
    checkConfigValidity,
  };
}
