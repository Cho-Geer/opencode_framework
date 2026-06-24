#!/usr/bin/env bun
"use strict";

/**
 * state-canonicalize.js — Workspace-Root Canonicalization Runtime Enforcement
 * ============================================================================
 * OpenCode v3.0 — RVW-REVIEW-02
 *
 * Scans machine.json and replaces absolute paths outside OPENCODE_ROOT with
 * relative equivalents. Enforces workspace-bound path hygiene at every read/write
 * boundary.
 *
 * Exported as module:
 *   const {
 *     isPathInWorkspace,
 *     makePathRelativeToWorkspace,
 *     validateWorkspaceIntegrity,
 *     sanitizePathsInMachine,
 *     canonicalizePathsInMachine,
 *     OPENCODE_ROOT,
 *     MACHINE_JSON,
 *   } = require('./state-canonicalize');
 *
 * CLI usage:
 *   bun state-canonicalize.ts [--dry-run] [--state-path <path>]
 *
 * Covered state sections:
 *   - write_audit_state.current_session.files_written
 *   - write_audit_state.history[].files
 *   - type_check_state.dirty_files
 *   - format_state.unformatted_files
 *   - compliance_records.role_violations[].violation_file
 *   - tdd_enforcement_state.current_session.impl_files_attempted
 *   - tdd_enforcement_state.current_session.test_files_written
 *   - tdd_enforcement_state.current_session.blocked_attempts[].file
 *   - tdd_enforcement_state.violations[].file
 *
 * Note: eslint_state.modules (keyed by module name) and dependency_state (violation
 *   objects) do not contain file paths requiring canonicalization.
 */

const fs = require("node:fs");
const path = require("node:path");
const { atomicWriteSubState } = require("../lib/state-utils");
const { readSubState } = require("../lib/substate-manager");

// ─── Constants ────────────────────────────────────────────

/**
 * OPENCODE_ROOT — workspace root resolution
 *
 * Priority:
 *   1. OPENCODE_ROOT env var (explicit override)
 *   2. __dirname-based derivation (for scripts under .opencode/scripts/)
 *   3. process.cwd() (runtime working directory)
 *
 * The env-var override is highest priority to support cross-workspace
 * debugging and CI environments where cwd may differ.
 */
const OPENCODE_ROOT = path.resolve(
  process.env.OPENCODE_ROOT || path.resolve(__dirname, "..", ".."),
);

const MACHINE_JSON = path.join(
  OPENCODE_ROOT,
  ".opencode",
  "state",
  "machine.json",
);

// ─── Core Path Utilities ──────────────────────────────────

/**
 * Determine if a file path belongs to the current workspace root.
 * Resolves relative paths against process.cwd() before comparison.
 * Returns false for null/empty paths.
 *
 * Safe: Uses path.resolve() to normalize '..', '.', and symlinks.
 *
 * @param {string} filePath - The file path to check
 * @param {string} workspaceRoot - The workspace root directory
 * @returns {boolean} True if the path is inside the workspace
 */
function isPathInWorkspace(filePath, workspaceRoot) {
  if (!filePath || typeof filePath !== "string" || !workspaceRoot) return false;
  try {
    const resolved = path.resolve(filePath);
    const root = path.resolve(workspaceRoot) + path.sep;
    return (
      resolved.startsWith(root) || resolved === path.resolve(workspaceRoot)
    );
  } catch {
    return false;
  }
}

/**
 * Convert an absolute file path within the workspace to a relative path
 * (relative to workspaceRoot). Returns null if the path is outside the
 * workspace. Already-relative paths are returned as-is (normalized).
 *
 * @param {string} filePath - The file path to convert
 * @param {string} workspaceRoot - The workspace root directory
 * @returns {string|null} Relative path, or null if foreign
 */
function makePathRelativeToWorkspace(filePath, workspaceRoot) {
  if (!filePath || typeof filePath !== "string") return null;
  const resolved = path.resolve(filePath);
  const root = path.resolve(workspaceRoot) + path.sep;
  // Already relative — normalize and return
  if (!path.isAbsolute(filePath)) {
    return filePath.replace(/\\/g, "/");
  }
  // Absolute within workspace — strip root prefix
  if (resolved.startsWith(root) || resolved === path.resolve(workspaceRoot)) {
    if (resolved === path.resolve(workspaceRoot)) return ".";
    return resolved.slice(root.length).replace(/\\/g, "/");
  }
  // Outside workspace — reject
  return null;
}

// ─── Validation: Detect Foreign Paths ─────────────────────

/**
 * Scan the machine.json state object for file paths that do NOT belong
 * to the current OPENCODE_ROOT. Returns an array of warning messages and
 * a flag indicating if foreign paths were found.
 *
 * Scanned sections (ALL state sections containing file paths):
 *   - write_audit_state.current_session.files_written
 *   - write_audit_state.history[].files
 *   - type_check_state.dirty_files
 *   - format_state.unformatted_files
 *   - compliance_records.role_violations[].violation_file
 *   - tdd_enforcement_state.current_session.impl_files_attempted
 *   - tdd_enforcement_state.current_session.test_files_written
 *   - tdd_enforcement_state.current_session.blocked_attempts[].file
 *   - tdd_enforcement_state.violations[].file
 *
 * @param {object} machine - The machine.json state object
 * @param {string} workspaceRoot - Path to the workspace root
 * @returns {{ hasForeignPaths: boolean, warnings: string[] }}
 */
function validateWorkspaceIntegrity(machine, workspaceRoot) {
  const warnings = [];
  let hasForeignPaths = false;
  const root = path.resolve(workspaceRoot);

  function checkPathArray(arr, label) {
    if (!Array.isArray(arr)) return;
    const foreign = arr.filter(
      (p) =>
        typeof p === "string" && p.length > 0 && !isPathInWorkspace(p, root),
    );
    if (foreign.length > 0) {
      hasForeignPaths = true;
      warnings.push(
        `[state-canonicalize] ⚠ Cross-workspace paths detected in ${label}: ` +
          foreign.map((p) => `"${p}"`).join(", ") +
          `. These paths reference a foreign OPENCODE_ROOT (not ${root}). They will be filtered.`,
      );
    }
  }

  // write_audit_state.current_session.files_written
  if (machine.write_audit_state?.current_session?.files_written) {
    checkPathArray(
      machine.write_audit_state.current_session.files_written,
      "write_audit_state.current_session.files_written",
    );
  }

  // write_audit_state.history[].files
  if (Array.isArray(machine.write_audit_state?.history)) {
    machine.write_audit_state.history.forEach((entry, i) => {
      if (entry?.files)
        checkPathArray(entry.files, `write_audit_state.history[${i}].files`);
    });
  }

  // type_check_state.dirty_files
  if (machine.type_check_state?.dirty_files) {
    checkPathArray(
      machine.type_check_state.dirty_files,
      "type_check_state.dirty_files",
    );
  }

  // format_state.unformatted_files
  if (machine.format_state?.unformatted_files) {
    checkPathArray(
      machine.format_state.unformatted_files,
      "format_state.unformatted_files",
    );
  }

  // compliance_records.role_violations[].violation_file
  if (Array.isArray(machine.compliance_records?.role_violations)) {
    const foreignViolations = machine.compliance_records.role_violations.filter(
      (v) => v.violation_file && !isPathInWorkspace(v.violation_file, root),
    );
    if (foreignViolations.length > 0) {
      hasForeignPaths = true;
      warnings.push(
        `[state-canonicalize] ⚠ Cross-workspace paths detected in compliance_records.role_violations: ` +
          foreignViolations.map((v) => `"${v.violation_file}"`).join(", ") +
          `. These records reference a foreign OPENCODE_ROOT.`,
      );
    }
  }

  // Helper: check an object array field (e.g. blocked_attempts[].file, violations[].file)
  function checkObjectArrayField(arr, fieldName, label) {
    if (!Array.isArray(arr)) return;
    const foreignEntries = arr.filter(
      (entry) =>
        entry &&
        typeof entry[fieldName] === "string" &&
        entry[fieldName].length > 0 &&
        !isPathInWorkspace(entry[fieldName], root),
    );
    if (foreignEntries.length > 0) {
      hasForeignPaths = true;
      warnings.push(
        `[state-canonicalize] ⚠ Cross-workspace paths detected in ${label}: ` +
          foreignEntries.map((e) => `"${e[fieldName]}"`).join(", ") +
          `. These records reference a foreign OPENCODE_ROOT.`,
      );
    }
  }

  // tdd_enforcement_state.current_session.impl_files_attempted
  if (machine.tdd_enforcement_state?.current_session?.impl_files_attempted) {
    checkPathArray(
      machine.tdd_enforcement_state.current_session.impl_files_attempted,
      "tdd_enforcement_state.current_session.impl_files_attempted",
    );
  }

  // tdd_enforcement_state.current_session.test_files_written
  if (machine.tdd_enforcement_state?.current_session?.test_files_written) {
    checkPathArray(
      machine.tdd_enforcement_state.current_session.test_files_written,
      "tdd_enforcement_state.current_session.test_files_written",
    );
  }

  // tdd_enforcement_state.current_session.blocked_attempts[].file
  if (machine.tdd_enforcement_state?.current_session?.blocked_attempts) {
    checkObjectArrayField(
      machine.tdd_enforcement_state.current_session.blocked_attempts,
      "file",
      "tdd_enforcement_state.current_session.blocked_attempts[].file",
    );
  }

  // tdd_enforcement_state.violations[].file
  if (machine.tdd_enforcement_state?.violations) {
    checkObjectArrayField(
      machine.tdd_enforcement_state.violations,
      "file",
      "tdd_enforcement_state.violations[].file",
    );
  }

  return { hasForeignPaths, warnings };
}

// ─── Sanitization: Remove Foreign Paths ───────────────────

/**
 * Remove (filter out) all file paths in machine.json state sections
 * that do NOT belong to the current workspace root.
 *
 * This is the "auto-clean" companion to validateWorkspaceIntegrity().
 * Returns the modified machine object (mutated in place for efficiency).
 *
 * Covered sections: same as validateWorkspaceIntegrity()
 *
 * @param {object} machine - The machine.json state object (mutated in place)
 * @param {string} workspaceRoot - Path to the workspace root
 * @returns {object} The modified machine object
 */
function sanitizePathsInMachine(machine, workspaceRoot) {
  const root = path.resolve(workspaceRoot);

  function filterArray(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr.filter(
      (p) => typeof p === "string" && isPathInWorkspace(p, root),
    );
  }

  // write_audit_state.current_session.files_written
  if (machine.write_audit_state?.current_session?.files_written) {
    machine.write_audit_state.current_session.files_written = filterArray(
      machine.write_audit_state.current_session.files_written,
    );
  }

  // write_audit_state.history[].files
  if (Array.isArray(machine.write_audit_state?.history)) {
    machine.write_audit_state.history.forEach((entry) => {
      if (entry?.files) entry.files = filterArray(entry.files);
    });
  }

  // type_check_state.dirty_files
  if (machine.type_check_state?.dirty_files) {
    machine.type_check_state.dirty_files = filterArray(
      machine.type_check_state.dirty_files,
    );
    // Reset status to clean if dirty_files is now empty
    if (
      machine.type_check_state.dirty_files.length === 0 &&
      machine.type_check_state.status === "dirty"
    ) {
      machine.type_check_state.status = "clean";
      machine.type_check_state.incremental_errors = 0;
    }
  }

  // format_state.unformatted_files
  if (machine.format_state?.unformatted_files) {
    machine.format_state.unformatted_files = filterArray(
      machine.format_state.unformatted_files,
    );
    if (
      machine.format_state.unformatted_files.length === 0 &&
      machine.format_state.status === "dirty"
    ) {
      machine.format_state.status = "clean";
    }
  }

  // compliance_records.role_violations — filter out foreign-path violations
  if (Array.isArray(machine.compliance_records?.role_violations)) {
    machine.compliance_records.role_violations =
      machine.compliance_records.role_violations.filter(
        (v) => !v.violation_file || isPathInWorkspace(v.violation_file, root),
      );
  }

  // ── tdd_enforcement_state sections ──
  if (machine.tdd_enforcement_state?.current_session) {
    const tddSess = machine.tdd_enforcement_state.current_session;

    // impl_files_attempted
    if (tddSess.impl_files_attempted) {
      tddSess.impl_files_attempted = filterArray(tddSess.impl_files_attempted);
    }

    // test_files_written
    if (tddSess.test_files_written) {
      tddSess.test_files_written = filterArray(tddSess.test_files_written);
    }

    // blocked_attempts[].file — filter out entries with foreign paths
    if (Array.isArray(tddSess.blocked_attempts)) {
      tddSess.blocked_attempts = tddSess.blocked_attempts.filter(
        (entry) =>
          entry &&
          typeof entry.file === "string" &&
          isPathInWorkspace(entry.file, root),
      );
    }
  }

  // tdd_enforcement_state.violations[].file
  if (Array.isArray(machine.tdd_enforcement_state?.violations)) {
    machine.tdd_enforcement_state.violations =
      machine.tdd_enforcement_state.violations.filter(
        (v) => !v.file || isPathInWorkspace(v.file, root),
      );
  }

  return machine;
}

// ─── Canonicalization: Convert to Relative Paths ──────────

/**
 * Canonicalize all file paths in machine.json to be relative to workspaceRoot.
 * Absolute paths within workspace are converted to relative; foreign paths
 * are removed. This is the "relative-path enforcement" step — after this,
 * all stored paths are relative to OPENCODE_ROOT.
 *
 * Covered sections (ALL state sections containing file paths — RVW-REVIEW-02):
 *   - write_audit_state.current_session.files_written
 *   - write_audit_state.history[].files
 *   - type_check_state.dirty_files
 *   - format_state.unformatted_files
 *   - compliance_records.role_violations[].violation_file
 *   - tdd_enforcement_state.current_session.impl_files_attempted
 *   - tdd_enforcement_state.current_session.test_files_written
 *   - tdd_enforcement_state.current_session.blocked_attempts[].file
 *   - tdd_enforcement_state.violations[].file
 *
 * @param {object} machine - The machine.json state object (mutated in place)
 * @param {string} workspaceRoot - Path to the workspace root
 * @returns {object} The modified machine object
 */
function canonicalizePathsInMachine(machine, workspaceRoot) {
  const root = path.resolve(workspaceRoot);

  function canonicalizeArray(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr
      .map((p) =>
        typeof p === "string" ? makePathRelativeToWorkspace(p, root) : p,
      )
      .filter((p) => p !== null && p !== undefined);
  }

  function canonicalizeObjectArrayField(arr, fieldName) {
    if (!Array.isArray(arr)) return arr;
    return arr
      .map((entry) => {
        if (!entry || typeof entry[fieldName] !== "string") return entry;
        const rel = makePathRelativeToWorkspace(entry[fieldName], root);
        if (rel === null) return null; // mark for removal
        return { ...entry, [fieldName]: rel };
      })
      .filter((entry) => entry !== null);
  }

  // write_audit_state.current_session.files_written
  if (machine.write_audit_state?.current_session?.files_written) {
    machine.write_audit_state.current_session.files_written = canonicalizeArray(
      machine.write_audit_state.current_session.files_written,
    );
  }

  // write_audit_state.history[].files
  if (Array.isArray(machine.write_audit_state?.history)) {
    machine.write_audit_state.history.forEach((entry) => {
      if (entry?.files) entry.files = canonicalizeArray(entry.files);
    });
  }

  // type_check_state.dirty_files
  if (machine.type_check_state?.dirty_files) {
    machine.type_check_state.dirty_files = canonicalizeArray(
      machine.type_check_state.dirty_files,
    );
  }

  // format_state.unformatted_files
  if (machine.format_state?.unformatted_files) {
    machine.format_state.unformatted_files = canonicalizeArray(
      machine.format_state.unformatted_files,
    );
  }

  // compliance_records.role_violations[].violation_file
  if (Array.isArray(machine.compliance_records?.role_violations)) {
    machine.compliance_records.role_violations = canonicalizeObjectArrayField(
      machine.compliance_records.role_violations,
      "violation_file",
    );
  }

  // tdd_enforcement_state.current_session.impl_files_attempted
  if (machine.tdd_enforcement_state?.current_session?.impl_files_attempted) {
    machine.tdd_enforcement_state.current_session.impl_files_attempted =
      canonicalizeArray(
        machine.tdd_enforcement_state.current_session.impl_files_attempted,
      );
  }

  // tdd_enforcement_state.current_session.test_files_written
  if (machine.tdd_enforcement_state?.current_session?.test_files_written) {
    machine.tdd_enforcement_state.current_session.test_files_written =
      canonicalizeArray(
        machine.tdd_enforcement_state.current_session.test_files_written,
      );
  }

  // tdd_enforcement_state.current_session.blocked_attempts[].file
  if (machine.tdd_enforcement_state?.current_session?.blocked_attempts) {
    machine.tdd_enforcement_state.current_session.blocked_attempts =
      canonicalizeObjectArrayField(
        machine.tdd_enforcement_state.current_session.blocked_attempts,
        "file",
      );
  }

  // tdd_enforcement_state.violations[].file
  if (Array.isArray(machine.tdd_enforcement_state?.violations)) {
    machine.tdd_enforcement_state.violations = canonicalizeObjectArrayField(
      machine.tdd_enforcement_state.violations,
      "file",
    );
  }

  return machine;
}

// ─── Summary Report ───────────────────────────────────────

/**
 * Generate a summary of what canonicalization changed (or would change).
 *
 * @param {object} results - Object with pre/post state info
 * @returns {string} Human-readable summary
 */
function generateReport(results) {
  const lines = [
    `[state-canonicalize] Workspace Root: ${OPENCODE_ROOT}`,
    `[state-canonicalize] Machine JSON: ${MACHINE_JSON}`,
    `[state-canonicalize] Foreign paths detected: ${results.foreignPathsDetected ? "YES ⚠" : "NO ✓"}`,
  ];

  if (results.foreignPathsDetected) {
    lines.push(`[state-canonicalize] Foreign path warnings:`);
    for (const w of results.warnings || []) {
      lines.push(`  ${w}`);
    }
  }

  if (results.absolutePathsConverted > 0) {
    lines.push(
      `[state-canonicalize] Absolute paths converted to relative: ${results.absolutePathsConverted}`,
    );
  } else {
    lines.push(`[state-canonicalize] No absolute paths require conversion ✓`);
  }

  if (results.foreignPathsRemoved > 0) {
    lines.push(
      `[state-canonicalize] Foreign paths removed: ${results.foreignPathsRemoved}`,
    );
  }

  if (results.dryRun) {
    lines.push(`[state-canonicalize] DRY RUN — no changes written to disk`);
  } else if (results.changesApplied) {
    lines.push(`[state-canonicalize] Changes written to ${MACHINE_JSON}`);
  }

  return lines.join("\n");
}

// ─── Count Absolute Paths ─────────────────────────────────

function countAbsolutePathsInMachine(machine) {
  let count = 0;

  function countArray(arr) {
    if (!Array.isArray(arr)) return;
    for (const entry of arr) {
      if (typeof entry === "string" && path.isAbsolute(entry)) count++;
    }
  }

  function countObjectArrayField(arr, fieldName) {
    if (!Array.isArray(arr)) return;
    for (const entry of arr) {
      if (
        entry &&
        typeof entry[fieldName] === "string" &&
        path.isAbsolute(entry[fieldName])
      )
        count++;
    }
  }

  countArray(machine.write_audit_state?.current_session?.files_written);
  if (Array.isArray(machine.write_audit_state?.history)) {
    machine.write_audit_state.history.forEach((e) => countArray(e?.files));
  }
  countArray(machine.type_check_state?.dirty_files);
  countArray(machine.format_state?.unformatted_files);
  countObjectArrayField(
    machine.compliance_records?.role_violations,
    "violation_file",
  );
  countArray(
    machine.tdd_enforcement_state?.current_session?.impl_files_attempted,
  );
  countArray(
    machine.tdd_enforcement_state?.current_session?.test_files_written,
  );
  countObjectArrayField(
    machine.tdd_enforcement_state?.current_session?.blocked_attempts,
    "file",
  );
  countObjectArrayField(machine.tdd_enforcement_state?.violations, "file");

  return count;
}

// ─── Main: Canonicalize and Write ─────────────────────────

/**
 * Read machine.json, run all canonicalization passes, and write back.
 *
 * @param {object} options
 * @param {boolean} [options.dryRun=false] - Report only, do not write
 * @param {string} [options.statePath] - Override path to machine.json
 * @returns {object} Report result
 */
function canonicalizeStateFile(options = {}) {
  const { dryRun = false, statePath = MACHINE_JSON } = options;
  const results = {
    dryRun,
    statePath,
    foreignPathsDetected: false,
    foreignPathsRemoved: 0,
    absolutePathsConverted: 0,
    warnings: [],
    changesApplied: false,
  };

  // Read sub-states via substate-manager (P1-B split architecture)
  // Pure functions below still take a machine-like object, so we assemble
  // one from individual readSubState() calls instead of reading machine.json
  // monolithically.
  const machine = {
    write_audit_state: readSubState("write_audit_state"),
    type_check_state: readSubState("type_check_state"),
    format_state: readSubState("format_state"),
    compliance_records: readSubState("compliance_records"),
    tdd_enforcement_state: readSubState("tdd_enforcement_state"),
  };

  // Phase 1: Validate workspace integrity
  const integrity = validateWorkspaceIntegrity(machine, OPENCODE_ROOT);
  results.warnings = integrity.warnings;
  results.foreignPathsDetected = integrity.hasForeignPaths;

  // Count initial foreign paths for reporting
  let initialForeignCount = 0;
  // (we approximate by checking if validation found foreign paths)

  // Phase 2: Sanitize (remove foreign paths)
  const beforeSanitizeCount = countAbsolutePathsInMachine(machine);
  sanitizePathsInMachine(machine, OPENCODE_ROOT);

  // Phase 3: Canonicalize (convert to relative)
  const beforeCanonicalizeCount = countAbsolutePathsInMachine(machine);
  canonicalizePathsInMachine(machine, OPENCODE_ROOT);
  const afterCount = countAbsolutePathsInMachine(machine);
  results.absolutePathsConverted = beforeCanonicalizeCount - afterCount;

  // Foreign path removal estimate
  results.foreignPathsRemoved =
    beforeSanitizeCount -
    (beforeCanonicalizeCount + results.absolutePathsConverted);
  if (results.foreignPathsRemoved < 0) results.foreignPathsRemoved = 0;

  // Determine if changes were made
  const hasChanges =
    results.foreignPathsDetected || results.absolutePathsConverted > 0;

  if (hasChanges && !dryRun) {
    // Write back using CAS for each sub-state
    const subStates = [
      "write_audit_state",
      "type_check_state",
      "format_state",
      "compliance_records",
      "tdd_enforcement_state",
    ];

    let allOk = true;
    for (const subStateKey of subStates) {
      const ok = atomicWriteSubState(subStateKey, (subState) => {
        // Create a temporary machine-like object with just this sub-state
        const tempMachine = { [subStateKey]: subState };
        sanitizePathsInMachine(tempMachine, OPENCODE_ROOT);
        canonicalizePathsInMachine(tempMachine, OPENCODE_ROOT);
        // Copy back the modified sub-state
        Object.assign(subState, tempMachine[subStateKey]);
      });
      if (!ok) {
        allOk = false;
        console.error(`[canonicalize] CAS write failed for ${subStateKey}`);
      }
    }

    results.changesApplied = allOk;
    if (!allOk) {
      results.error = "CAS write failed for one or more sub-states";
    }
  }

  return results;
}

// ─── CLI Interface ────────────────────────────────────────
function runCLI() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let statePath = MACHINE_JSON;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dry-run":
        dryRun = true;
        break;
      case "--state-path":
        statePath = args[++i];
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: bun state-canonicalize.ts [--dry-run] [--state-path <path>]",
        );
        console.log("");
        console.log(
          "  --dry-run       Report foreign/absolute paths without modifying files",
        );
        console.log(
          "  --state-path    Path to machine.json (default: .opencode/state/machine.json)",
        );
        console.log("  --help, -h      Show this help");
        process.exit(0);
      default:
        console.error(`Unknown flag: ${args[i]}`);
        process.exit(1);
    }
  }

  const results = canonicalizeStateFile({ dryRun, statePath });
  console.log(generateReport(results));

  if (results.error) {
    console.error(`[state-canonicalize] ERROR: ${results.error}`);
    process.exit(1);
  }

  process.exit(0);
}

// ═══ Run CLI if called directly ═══
if (require.main === module) {
  runCLI();
}

// ═══ Module Exports ═══
module.exports = {
  isPathInWorkspace,
  makePathRelativeToWorkspace,
  validateWorkspaceIntegrity,
  sanitizePathsInMachine,
  canonicalizePathsInMachine,
  canonicalizeStateFile,
  generateReport,
  countAbsolutePathsInMachine,
  OPENCODE_ROOT,
  MACHINE_JSON,
};
