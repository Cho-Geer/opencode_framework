#!/usr/bin/env bun
/**
 * state-reset.ts — Idempotent state machine bootstrap/reset script
 *
 * Usage:
 *   bun .opencode/scripts/state-reset.ts              # interactive (asks confirmation)
 *   bun .opencode/scripts/state-reset.ts --force       # non-interactive, skips prompt
 *   bun .opencode/scripts/state-reset.ts --dry-run     # preview what would change, no write
 *
 * Actions:
 *   1. Reads machine.json from .opencode/state/
 *   2. Logs before-state diff
 *   3. Resets all sub-states to clean baseline (preserving meta)
 *   4. Writes updated machine.json (unless --dry-run)
 *   5. Logs after-state diff
 */

const fs = require("node:fs");
const path = require("node:path");

const OPENCODE_ROOT = process.env.OPENCODE_ROOT
  ? path.resolve(process.env.OPENCODE_ROOT)
  : path.resolve(__dirname, "..", "..");
const STATE_DIR = path.join(OPENCODE_ROOT, ".opencode", "state");
const MACHINE_FILE = path.join(STATE_DIR, "machine.json");

const FORCE = process.argv.includes("--force");
const DRY_RUN = process.argv.includes("--dry-run");

// ──────────────────────────────────────────────
// 1. Clean baseline state template
// ──────────────────────────────────────────────
function buildCleanBaseline(meta) {
  return {
    meta: {
      version: (meta as any).version || "1.0.0",
      createdAt: meta.createdAt || new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      project: (meta as any).project || "",
      framework: meta.framework || "opencode-v3",
    },
    eslint_state: {
      last_full_scan: null,
      modules: {},
      aggregate: {
        total_violations: 0,
        dirty_modules: [],
        waived_modules: [],
      },
    },
    // diagnostic_state (replaces type_check_state, 2026-06-26)
    diagnostic_state: {
      files: {},
      last_updated: new Date().toISOString(),
    },
    dependency_state: {
      last_check: null,
      violations: [],
      forbidden_rules_applied: 0,
      status: "clean",
    },
    format_state: {
      status: "clean",
      unformatted_files: [],
      last_run: null,
    },
    write_audit_state: {
      enabled: true,
      current_session: null,
      history: [],
    },
    compliance_records: {
      role_violations: [],
      gate_violations: [],
      tdd_violations: [],
    },
    tdd_enforcement_state: {
      enabled: true,
      current_session: null,
      violations: [],
      history: [],
    },
    contracts: ["contract.yaml"],
    keystone_hashes: {
      "contract.yaml": "",
    },
  };
}

// ──────────────────────────────────────────────
// 2. Diff helper
// ──────────────────────────────────────────────
function diffStates(before, after) {
  const changed = [];
  const topKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of topKeys) {
    const beforeVal = JSON.stringify(before[key]);
    const afterVal = JSON.stringify(after[key]);
    if (beforeVal !== afterVal) {
      changed.push(key);
    }
  }
  return changed;
}

// ──────────────────────────────────────────────
// 3. Main
// ──────────────────────────────────────────────
function main() {
  (console as any).error("[state-reset] OPENCODE_ROOT:", OPENCODE_ROOT);
  (console as any).error("[state-reset] Target:", MACHINE_FILE);

  // Check if machine.json exists
  if (!fs.existsSync(MACHINE_FILE)) {
    (console as any).error(
      "[state-reset] machine.json not found. Creating fresh baseline...",
    );
    const fresh = buildCleanBaseline({});
    if (!DRY_RUN) {
      fs.writeFileSync(
        MACHINE_FILE,
        JSON.stringify(fresh, null, 2) + "\n",
        "utf8",
      );
      (console as any).error("[state-reset] Created fresh machine.json");
    } else {
      (console as any).error("[state-reset] [DRY RUN] Would create fresh machine.json");
      console.log(JSON.stringify(fresh, null, 2));
    }
    return;
  }

  // Read current state
  let current;
  try {
    current = JSON.parse(fs.readFileSync(MACHINE_FILE, "utf8"));
  } catch (err) {
    (console as any).error(
      `[state-reset] ERROR: Cannot parse machine.json: ${err.message}`,
    );
    process.exit(1);
  }

  const original = JSON.parse(JSON.stringify(current)); // deep clone for diff

  // Show before state
  (console as any).error("[state-reset] === BEFORE STATE ===");
  for (const [key, val] of Object.entries(current)) {
    if (key === "meta") {
      (console as any).error(
        `  ${key}: version=${(val as any).version}, project=${(val as any).project}, lastUpdated=${(val as any).lastUpdated}`,
      );
    } else if (typeof val === "object" && val !== null) {
      const status =
        (val as any).status ||
        ((val as any).aggregate
          ? `modules=${Object.keys((val as any).modules || {}).length}, violations=${(val as any).aggregate?.total_violations || 0}`
          : "N/A");
      (console as any).error(`  ${key}: ${status}`);
    } else {
      (console as any).error(`  ${key}: ${JSON.stringify(val)}`);
    }
  }

  // Build clean baseline, preserving meta
  const clean = buildCleanBaseline(current.meta || {});

  // Compute diff
  const changed = diffStates(current, clean);
  (console as any).error("[state-reset] === CHANGES ===");
  if (changed.length === 0) {
    (console as any).error("  No changes needed — state is already clean.");
    return;
  }
  for (const key of changed) {
    (console as any).error(`  ${key}: RESET`);
  }

  // Confirmation (skip if --force)
  if (!FORCE) {
    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question("[state-reset] Proceed with reset? [y/N]: ", (answer) => {
      rl.close();
      if (answer.toLowerCase() !== "y") {
        (console as any).error("[state-reset] Aborted by user.");
        return;
      }
      applyReset(clean, changed);
    });
    return;
  }

  applyReset(clean, changed);
}

function applyReset(clean, changed) {
  if (DRY_RUN) {
    (console as any).error(
      "[state-reset] [DRY RUN] Would reset the following sections:",
      changed.join(", "),
    );
    (console as any).error("[state-reset] [DRY RUN] Proposed state:");
    console.log(JSON.stringify(clean, null, 2));
    return;
  }

  fs.writeFileSync(MACHINE_FILE, JSON.stringify(clean, null, 2) + "\n", "utf8");
  (console as any).error("[state-reset] === RESULT ===");
  (console as any).error(`  Sections reset: ${changed.join(", ")}`);
  (console as any).error("  machine.json reset to clean baseline.");
  (console as any).error(
    "  Keystone hashes preserved as empty — run keystone-validate to populate.",
  );
}

// ──────────────────────────────────────────────
// 4. Run
// ──────────────────────────────────────────────
main();

