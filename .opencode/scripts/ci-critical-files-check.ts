#!/usr/bin/env bun
/**
 * ci-critical-files-check.ts — FIX-007: Canonical CI critical-files source
 * ===========================================================================
 * This script is the SINGLE canonical source for CI critical-file drift checks.
 * It imports CRITICAL_FILES from .opencode/lib/critical-files.ts — the same
 * source used by hook-commit-msg.ts and the pre-commit hook.
 *
 * Previously, .github/workflows/framework-ci.yml maintained a separate
 * static shell array that was independent and prone to drift.
 *
 * Usage:
 *   bun .opencode/scripts/ci-critical-files-check.ts              # check mode (exit 1 if modified)
 *   bun .opencode/scripts/ci-critical-files-check.ts --list       # print list (for CI export)
 *
 * Exit codes:
 *   0 — No critical files modified since HEAD
 *   1 — Critical files modified (or script error)
 *
 * @author @Super-Admin
 * @since 2026-06-21 — FIX-007
 */

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";

// ── Path resolution (same pattern as critical-files.ts) ──
function resolveOpenCodeRoot(): string {
  if (process.env.OPENCODE_ROOT) return resolve(process.env.OPENCODE_ROOT);

  // __dirname for CJS, import.meta.url for ESM
  const modDir =
    typeof __dirname !== "undefined"
      ? resolve(__dirname)
      : resolve(dirname(new URL(import.meta.url).pathname));

  let current = modDir;
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(current, ".opencode", "project.config.json"))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return resolve(modDir, "..", "..");
}

const OPENCODE_ROOT = resolveOpenCodeRoot();

// Dynamically resolve critical-files.ts relative to OPENCODE_ROOT
// Bun allows direct .ts imports
let CRITICAL_FILES: string[] = [];
try {
  const criticalMod = require(
    resolve(OPENCODE_ROOT, ".opencode", "lib", "critical-files"),
  );
  CRITICAL_FILES = criticalMod.CRITICAL_FILES || [];
} catch (e) {
  console.error(`::error::Failed to import critical-files.ts: ${e}`);
  process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────
const listOnly = process.argv.includes("--list");

if (listOnly) {
  // JSON array output for CI consumption
  console.log(JSON.stringify(CRITICAL_FILES));
  process.exit(0);
}

// Check mode: verify no critical files modified since HEAD
try {
  const modified = execSync(
    "git diff HEAD --name-only -- " +
      CRITICAL_FILES.map((f) => `'${f}'`).join(" "),
    { encoding: "utf8", cwd: OPENCODE_ROOT },
  )
    .trim()
    .split("\n")
    .filter(Boolean);

  if (modified.length > 0) {
    console.log(
      `FAIL: ${modified.length} critical infrastructure file(s) modified since HEAD:`,
    );
    modified.forEach((f) => console.log(`  - ${f}`));
    console.log("");
    console.log("Action required:");
    console.log(
      "  1. Commit the changes with [INFRA] marker in commit message",
    );
    console.log(
      "  2. If changes are unintended, revert with: git checkout -- <file>",
    );
    process.exit(1);
  }

  console.log(
    `PASS: No critical infrastructure files modified since HEAD (tracking ${CRITICAL_FILES.length} files)`,
  );
  process.exit(0);
} catch (e: any) {
  if (e?.status === 1 && e?.stdout) {
    console.log(e.stdout.toString());
    process.exit(1);
  }
  console.error(`::error::Critical files check failed: ${e}`);
  process.exit(1);
}
