#!/usr/bin/env bun
/**
 * reset-interrupt-state.ts — Interrupt State Reconciliation
 * =========================================================
 *
 * Purpose:
 *   Clean up any artifacts left behind by a cooperative interrupt that was
 *   trapped by the framework's interrupt-guard layer. This script is
 *   automatically invoked from the session.error hook inside
 *   .opencode/plugins/session.ts when the upstream OpenCode interrupt
 *   handler surfaces a raw "Unexpected {interrupt}" template error.
 *
 * Actions performed:
 *   1. Delete .opencode/state/.last-interrupt.json (sentinel file).
 *   2. Release any lock held on .opencode/state/gate-state.json by removing
 *      the in-flight `locked_by` / `locked_at` fields if the lock is stale
 *      (older than 10 minutes). Fresh locks are preserved to avoid clobbering
 *      legitimate in-flight operations.
 *   3. Do NOT modify machine.json.eslint_state.last_full_scan — that value
 *      is authoritative and preserved across interrupts.
 *
 * Usage:
 *   bun .opencode/scripts/reset-interrupt-state.ts [--force]
 *
 * Exit codes:
 *   0 — clean (no cleanup required, or cleanup succeeded)
 *   0 — also returned after successful cleanup (never non-zero for
 *       recoverable situations; this script must not block the framework)
 *
 * @author @Super-Admin (framework repair)
 * @version 1.0.0
 * @since 2026-06-14
 */

import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const SENTINEL_PATH = path.join(
  PROJECT_ROOT,
  ".opencode",
  "state",
  ".last-interrupt.json",
);
const GATE_STATE_PATH = path.join(
  PROJECT_ROOT,
  ".opencode",
  "state",
  "gate-state.json",
);
const STALE_LOCK_MS = 10 * 60 * 1000; // 10 minutes
const FORCE = process.argv.includes("--force");

interface CleanupReport {
  sentinel_deleted: boolean;
  gate_lock_released: boolean;
  gate_lock_preserved_reason?: string;
  errors: string[];
}

function run(): CleanupReport {
  const report: CleanupReport = {
    sentinel_deleted: false,
    gate_lock_released: false,
    errors: [],
  };

  // ── 1. Sentinel cleanup ──────────────────────────────────────────
  try {
    if (fs.existsSync(SENTINEL_PATH)) {
      fs.unlinkSync(SENTINEL_PATH);
      report.sentinel_deleted = true;
    }
  } catch (err: any) {
    report.errors.push(`sentinel unlink failed: ${err.message}`);
  }

  // ── 2. Gate lock reconciliation ───────────────────────────────────
  try {
    if (fs.existsSync(GATE_STATE_PATH)) {
      const raw = fs.readFileSync(GATE_STATE_PATH, "utf8");
      const gate = JSON.parse(raw);
      const lockedAt = gate?.locked_at ? Date.parse(gate.locked_at) : NaN;
      const isLocked = Boolean(gate?.locked_by);
      const age = Number.isFinite(lockedAt) ? Date.now() - lockedAt : 0;

      if (isLocked && (FORCE || age > STALE_LOCK_MS)) {
        delete gate.locked_by;
        delete gate.locked_at;
        gate.last_reconciled_at = new Date().toISOString();
        gate.reconcile_reason =
          FORCE ? "forced by reset-interrupt-state --force" : "stale lock released";
        const tmp = GATE_STATE_PATH + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(gate, null, 2) + "\n", "utf8");
        fs.renameSync(tmp, GATE_STATE_PATH);
        report.gate_lock_released = true;
      } else if (isLocked) {
        report.gate_lock_preserved_reason =
          `lock held by ${gate.locked_by} for ${Math.round(age / 1000)}s (< 600s)`;
      }
    }
  } catch (err: any) {
    report.errors.push(`gate-state reconcile failed: ${err.message}`);
  }

  return report;
}

const result = run();
process.stdout.write(JSON.stringify(result, null, 2) + "\n");

// Always exit 0 — this script is called from a hook path that must not
// block the framework even if reconciliation partially failed.
process.exit(0);
