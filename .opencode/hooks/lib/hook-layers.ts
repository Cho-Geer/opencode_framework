/**
 * hook-layers.ts — Pre-commit hook TypeScript implementation
 * ===========================================================
 *
 * Replaces the monolithic `.opencode/hooks/pre-commit` bash script.
 * The bash hook now simply execs `bun .opencode/lib/hook-layers.ts`.
 *
 * Layers executed:
 *   0   Compliance gate armed check
 *   1.5 Critical infrastructure file detection
 *   1.8 Gate lifecycle audit
 *   1.9 State format validation
 *   1   lint-staged auto-formatting
 *   2.5 TDD order pre-check
 *   2.6 UC7KS docs consistency
 *   2.0 JSON syntax validation
 *   2   Keystone validation
 *
 * @author @Super-Admin
 * @since 2026-06-15
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";

import {
  getEnforcementMode,
  getEnforcementModeWithSource,
  getProjectRoot,
} from "../../lib/gate-core";
import type { EnforcementMode } from "../../lib/gate-core";
/**
 * FIX-011 (Phase 2): Git hooks now emit structured high-severity events
 * through Log Central (log-manager.ts) in addition to the existing
 * file-based hook-layers.log.  This closes the observability gap
 * documented in HVEC-007 — reject/skip/env-downgrade/break-glass
 * events are now searchable in Log Central's source index.
 */
import { writeLog } from "../../lib/log-manager";
import { getStagedCriticalFiles } from "./hook-critical-files";
import { isInfraOnlyCommit } from "./hook-critical-files";
import { tolerantParse } from "../../lib/tolerant-json";

// ── Redirect all output to log file (sync writes for reliable flush before exit) ──
const logFile = ".task_temp/_logs/hook-layers.log";
mkdirSync(dirname(logFile), { recursive: true });
function log(...args: any[]) {
  appendFileSync(logFile, `[${new Date().toISOString()}] ${args.join(" ")}\n`);
}
console.log = log;
console.error = (...args: any[]) => log("ERROR:", ...args);
console.warn = (...args: any[]) => log("WARN:", ...args);

// ── Path resolution (reused from gate-core) ──
const ROOT = getProjectRoot();
const PROJECT_CONFIG = join(ROOT, ".opencode/project.config.json");
const GATE_STATE = join(ROOT, ".opencode/state/gate-state.json");
const MACHINE = join(ROOT, ".opencode/state/machine.json");
const INNER = (() => {
  try {
    const cfg = JSON.parse(readFileSync(PROJECT_CONFIG, "utf8"));
    return join(ROOT, cfg.project_root || ".");
  } catch {
    return ROOT;
  }
})();

const mode = getEnforcementMode(ROOT);

// ═══ FIX-004: Block env downgrades in strict/locked mode ═══
// Source-aware mode resolution detects when ENFORCEMENT_MODE env
// reduces strictness below project.config.json's configured level.
// This prevents a local env var from silently weakening hook enforcement.
const modeSource = getEnforcementModeWithSource(ROOT);
if (modeSource.downgraded) {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  ❌ PRE-COMMIT BLOCKED — Enforcement downgrade detected");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Config mode: ${modeSource.configMode}`);
  console.log(`  Env override: ${modeSource.envMode}`);
  console.log(`  ${modeSource.downgradeReason}`);
  console.log(
    "  Unset ENFORCEMENT_MODE or set it to at least the config level.",
  );
  console.log("═══════════════════════════════════════════════════════");
  /**
   * FIX-011: Emit structured Log Central event for env downgrade.
   * HVEC-007 observability gap — this event is now searchable
   * in Log Central's source index under "env-downgrade-blocked".
   */
  writeLog("hook-layers", "hooks", {
    level: "ERROR",
    event: "ENFORCEMENT-MODE-DOWNGRADE-BLOCKED",
    detail: JSON.stringify({
      configMode: modeSource.configMode,
      envMode: modeSource.envMode,
      reason: modeSource.downgradeReason,
      hook: "pre-commit",
    }),
  });
  process.exit(1);
}

console.log("═══════════════════════════════════════════════════════");
console.log("  🔍 OpenCode v3.3 Pre-Commit Hook — TypeScript + Bun");
console.log(`  Mode: ${mode}`);
console.log("═══════════════════════════════════════════════════════");

// ── Layer 0: Compliance Gate Armed Check ──
console.log("\n[Layer 0/4] Checking compliance gate state...");

if (mode === "advisory") {
  console.log("  ⚠️  [ADVISORY] Gate armed check skipped");
} else {
  // Post-Step-8 DB-only migration: gate-state.json is frozen snapshot.
  // Read from DB via dbLoadGateStore() for accurate session state.
  let store: any = null;
  try {
    const { dbLoadGateStore } = require("../../lib/db-state-manager");
    store = dbLoadGateStore();
  } catch {
    /**
     * FIX-005: Fail closed — DB read failure exits 1 in strict/locked.
     * Previously logged "Cannot read — skipped", which allowed commits
     * when the gate state DB was corrupted or unavailable. In strict/locked
     * mode, a missing compliance gate session DB is treated as a hard failure
     * because we cannot verify gate arming. Advisory mode retains log-only.
     */
    if (mode === "strict" || mode === "locked") {
      console.log("❌ [GATE] Cannot read gate sessions from DB — BLOCKED");
      console.log(
        "   Verify gate-state DB integrity: bun .opencode/scripts/state-reconciliation.ts --fix",
      );
      writeLog("hook-layers", "hooks", {
        level: "ERROR",
        event: "GATE-DB-READ-FAILURE",
        detail:
          "Gate state DB unavailable in strict/locked mode — commit blocked",
      });
      process.exit(1);
    }
    console.log("  ⚠️  [ADVISORY] Cannot read gate sessions from DB — skipped");
    writeLog("hook-layers", "hooks", {
      level: "WARN",
      event: "GATE-DB-READ-SKIPPED",
      detail: "Gate state DB unavailable — advisory mode, commit not blocked",
    });
  }
  if (store) {
    const sessions = store.sessions || {};
    const count = Object.keys(sessions).length;
    if (count === 0) {
      console.log("❌ [GATE] No compliance gate session is armed.");
      console.log(
        "   Run: compliance_gate_check → compliance_gate_confirm before committing.",
      );
      writeLog("hook-layers", "hooks", {
        level: "ERROR",
        event: "GATE-NO-ACTIVE-SESSION",
        detail: "No compliance gate session is armed",
      });
      process.exit(1);
    }
    console.log(`  ✅ Compliance gate armed (${count} active session(s))`);
  }
}

// ── Layer 1.5: Critical Files Check (git diff, replaces SHA-256) ──
console.log("\n[1.5/4] Critical infrastructure files check (git diff)...");
const criticalModified = getStagedCriticalFiles();
if (criticalModified.length > 0) {
  console.log("  ⚠️  Critical infrastructure files modified:");
  criticalModified.forEach((f) => console.log(`    - ${f}`));
  if (mode === "locked") {
    console.log(
      "  ❌ [FW-ENFORCE][INFRA] Critical files in locked mode — BLOCKED",
    );
    writeLog("hook-layers", "hooks", {
      level: "ERROR",
      event: "INFRA-CRITICAL-BLOCKED",
      detail: JSON.stringify({ files: criticalModified, mode }),
    });
    process.exit(1);
  }
  console.log("  ⚠️  Ensure commit message includes [INFRA] marker");
  writeLog("hook-layers", "hooks", {
    level: "WARN",
    event: "INFRA-CRITICAL-DETECTED",
    detail: JSON.stringify({ files: criticalModified, mode, blocked: false }),
  });
} else {
  console.log("  ✅ No critical infrastructure files in this commit");
}

// ── Layer 1.8: Gate Lifecycle Audit ──
console.log("\n[1.8/4] Gate lifecycle audit...");
try {
  const output = execSync(
    "bun .opencode/scripts/gate-lifecycle-audit.ts --json",
    {
      encoding: "utf8",
      cwd: ROOT,
      timeout: 30000,
    },
  );
  const result = JSON.parse(output);
  const stale = (result.stale_sessions || []).filter(
    (s: any) => (s.hours_old || 0) > 24,
  ).length;
  if (stale > 0) {
    console.log(`  ⚠️  ${stale} stale gate session(s) (>24h)`);
    console.log("  Fix: bun .opencode/scripts/state-reconciliation.ts --fix");
  } else {
    console.log("  ✅ No stale gate sessions");
  }
} catch {
  /**
   * FIX-005: Fail closed — gate lifecycle audit failure exits 1 in strict/locked.
   * Previously logged "skipped", which allowed commits when the audit script
   * was broken or unavailable. In strict/locked mode, inability to verify
   * gate lifecycle integrity is a hard failure.
   */
  if (mode === "strict" || mode === "locked") {
    console.log(
      "❌ [GATE-LIFECYCLE] Gate lifecycle audit unavailable — BLOCKED",
    );
    console.log(
      "   Verify: bun .opencode/scripts/gate-lifecycle-audit.ts --json",
    );
    writeLog("hook-layers", "hooks", {
      level: "ERROR",
      event: "GATE-LIFECYCLE-AUDIT-UNAVAILABLE",
      detail: "Gate lifecycle audit script unavailable in strict/locked mode",
    });
    process.exit(1);
  }
  console.log(
    "  ⚠️  [ADVISORY] Gate lifecycle audit skipped (script unavailable)",
  );
  writeLog("hook-layers", "hooks", {
    level: "WARN",
    event: "GATE-LIFECYCLE-AUDIT-SKIPPED",
    detail: "Gate lifecycle audit skipped — advisory mode",
  });
}

// ── Layer 1.9: State Format Validation ──
// Post-Step-8 DB-only migration: gate-state.json is frozen snapshot.
// Validate format consistency from DB store instead of JSON file.
console.log("\n[1.9/4] State format validation...");
try {
  const { dbLoadGateStore } = require("../../lib/db-state-manager");
  const gs = dbLoadGateStore();
  if (gs) {
    const active = Object.keys(gs.active_sessions || {}).length;
    const recent = Object.keys(gs.recent_sessions || {}).length;
    // Also validate frozen snapshot for format consistency
    if (existsSync(GATE_STATE)) {
      const frozen = JSON.parse(readFileSync(GATE_STATE, "utf8"));
      if ((frozen.formatVersion || "1.0") === "3.0") {
        const indexPath = join(ROOT, ".opencode/state/gate-state.index.json");
        if (existsSync(indexPath)) {
          const idx = JSON.parse(readFileSync(indexPath, "utf8"));
          const indexCount = Object.keys(idx.sessions || {}).length;
          const frozenRecent = Object.keys(frozen.recent_sessions || {}).length;
          if (indexCount < frozenRecent) {
            console.log(
              `  ❌ gate-state v3: index (${indexCount}) < frozen recent (${frozenRecent})`,
            );
            process.exit(1);
          }
        }
      }
    }
    console.log(`  ✅ gate-state v3 (DB): active=${active} recent=${recent}`);
  } else {
    console.log("  ✅ gate-state: no DB store (clean state)");
  }
} catch {
  /**
   * FIX-005: Fail closed — state format validation failure exits 1 in strict/locked.
   * Previously logged "skipped (DB unavailable)", which allowed commits
   * when the state DB or format validation was broken. In strict/locked mode,
   * inability to verify state format integrity is a hard failure.
   */
  if (mode === "strict" || mode === "locked") {
    console.log(
      "❌ [STATE-FORMAT] State format validation unavailable — BLOCKED",
    );
    console.log(
      "   Verify DB: bun .opencode/scripts/state-reconciliation.ts --fix",
    );
    writeLog("hook-layers", "hooks", {
      level: "ERROR",
      event: "STATE-FORMAT-VALIDATION-UNAVAILABLE",
      detail: "State format validation unavailable in strict/locked mode",
    });
    process.exit(1);
  }
  console.log(
    "  ⚠️  [ADVISORY] State format validation skipped (DB unavailable)",
  );
  writeLog("hook-layers", "hooks", {
    level: "WARN",
    event: "STATE-FORMAT-VALIDATION-SKIPPED",
    detail: "State format validation skipped — advisory mode / DB unavailable",
  });
}

// DAG changelog externalization
const dagPath = join(ROOT, "Task.DAG.json");
if (existsSync(dagPath)) {
  const dag = JSON.parse(readFileSync(dagPath, "utf8"));
  if (dag.change_log) {
    console.log("  ⚠️  Task.DAG.json still has inline change_log");
  }
}

// ── Layer 1: lint-staged ──
const lintStagedBin = join(INNER, "node_modules/.bin/lint-staged");
if (existsSync(lintStagedBin)) {
  console.log("\n[Layer 1/4] Auto-formatting staged files (lint-staged)...");
  try {
    execSync(`npx --prefix "${INNER}" lint-staged --concurrent false`, {
      encoding: "utf8",
      timeout: 120000,
      stdio: "inherit",
    });
  } catch {
    console.log("⚠️  [lint-staged] Some files could not be auto-fixed.");
  }
} else {
  console.log("[Layer 1/4] lint-staged not installed — skipping");
}

// ── Layer 2.5: TDD Order Pre-Check ──
console.log("\n[Layer 2.5/4] TDD order pre-check...");

const staged = execSync("git diff --cached --name-only", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

/**
 * INFRA-ONLY-TDD-SKIP (2026-06-22): If ALL staged files are infrastructure
 * (outside BUSINESS_CODE_PREFIX), skip the TDD order validation.
 * Infrastructure maintenance commits (e.g., hook fixes, framework updates)
 * do not require test file pairing or TDD phase markers.
 */
if (isInfraOnlyCommit(staged)) {
  console.log("  ✅ [INFRA] INFRA-only commit — TDD order check skipped");
} else {
  const FRAMEWORK_EXCLUDES =
    /^\.opencode\/|^docs\/|^\.task_temp\/|^node_modules\/|^opencode\.json$|^AGENTS\.md$|^contract\.yaml$|^Task\.DAG\.json$|^TECH_DEBT_REGISTRY\.md$|^WAIVE\.md$|^PROJECT_REFERENCE\.md$|^Project\.graph$/;
  const implFiles = staged.filter(
    (f) =>
      /\.(ts|js)$/.test(f) &&
      !/\.spec\.|\.test\.|\/test\/|\.config\./.test(f) &&
      !FRAMEWORK_EXCLUDES.test(f),
  );
  const testFiles = staged.filter((f) => /\.spec\.|\.test\.|\/test\//.test(f));

  if (implFiles.length > 0 && testFiles.length === 0) {
    try {
      const lastMsg = execSync("git log -1 --format=%s", {
        encoding: "utf8",
      }).trim();
      if (!/\[(Red|Green|Refactor)\]/i.test(lastMsg)) {
        if (mode === "advisory") {
          console.log(
            "⚠️  [ADVISORY] Impl files without test files & no TDD tag",
          );
        } else {
          console.log(
            "❌ [TDD] Impl files without test files AND no TDD tag — BLOCKED",
          );
          writeLog("hook-layers", "hooks", {
            level: "ERROR",
            event: "TDD-ORDER-VIOLATION",
            detail: JSON.stringify({ implFiles, mode }),
          });
          process.exit(1);
        }
      }
    } catch {
      /* no previous commit */
    }
  } else {
    console.log("  ✅ TDD order check passed");
  }
} // end else (non-INFRA-only commit)

// ── Layer 2.6: UC7KS Docs Consistency ──
console.log("\n[Layer 2.6/4] UC7KS docs consistency...");
const idxPath = join(ROOT, "docs/official_docs/index.json");
if (existsSync(idxPath)) {
  let parsed: any = null;
  try {
    parsed = tolerantParse(readFileSync(idxPath, "utf8"));
  } catch {
    // malformed JSON — handled below
  }
  if (!parsed || !parsed.manifest_version || !parsed.entries) {
    if (mode === "advisory") {
      console.log("  ⚠️  [ADVISORY] index.json is malformed");
    } else {
      console.log("  ❌ [UC7KS] index.json is malformed — BLOCKED");
      writeLog("hook-layers", "hooks", {
        level: "ERROR",
        event: "UC7KS-INDEX-MALFORMED",
        detail: "docs/official_docs/index.json manifest validation failed",
      });
      process.exit(1);
    }
  } else {
    const stagedDocs = staged.filter(
      (f) =>
        f.startsWith("docs/official_docs/") &&
        !f.includes("index.json") &&
        !f.includes(".metadata/"),
    );
    if (stagedDocs.length > 0) {
      const orphans = stagedDocs.filter(
        (doc) =>
          !parsed.entries.some((e: any) =>
            e.files?.some((f: any) => doc.includes(f.path)),
          ),
      );
      if (orphans.length > 0) {
        if (mode === "advisory") {
          console.log(`  ⚠️  [ADVISORY] Orphan docs: ${orphans.join(", ")}`);
        } else {
          console.log(`  ❌ [UC7KS] Orphan docs: ${orphans.join(", ")}`);
          writeLog("hook-layers", "hooks", {
            level: "ERROR",
            event: "UC7KS-ORPHAN-DOCS",
            detail: JSON.stringify({ orphans, mode }),
          });
          process.exit(1);
        }
      } else {
        console.log("  ✅ Staged docs verified in index.json");
      }
    }
    console.log("  ✅ index.json manifest integrity verified");
  }
} else {
  console.log("  ⚠️  index.json not found — skipped");
}

// ── Layer 2.0: JSON Syntax Validation ──
console.log("\n[Layer 2.0/4] JSON syntax validation...");
const jsonFiles = staged.filter((f) => f.endsWith(".json") && existsSync(f));
let jsonErrors = 0;
for (const f of jsonFiles) {
  try {
    tolerantParse(readFileSync(f, "utf8"));
  } catch {
    console.log(`  ❌ JSON parse error: ${f}`);
    jsonErrors++;
  }
}
if (jsonErrors > 0) {
  console.log(`  ❌ ${jsonErrors} JSON file(s) have syntax errors — BLOCKED`);
  writeLog("hook-layers", "hooks", {
    level: "ERROR",
    event: "JSON-SYNTAX-ERROR",
    detail: `${jsonErrors} staged JSON file(s) have syntax errors`,
  });
  process.exit(1);
}
console.log(`  ✅ All staged JSON files valid (${jsonFiles.length} checked)`);

// ── Layer 2: Keystone Validation ──
console.log("\n[Layer 2/4] Keystone full validation...");
const validatorCandidates = [
  join(INNER, "scripts/keystone-validate.ts"),
  join(ROOT, ".opencode/scripts/mcp-tools/keystone-validate.ts"),
];
const validator = validatorCandidates.find((p) => existsSync(p));

if (!validator) {
  /**
   * FIX-005: Fail closed — keystone validator missing exits 1 in strict/locked.
   * Previously logged "skipped", which allowed commits when the keystone
   * validation script was deleted or corrupted. In strict/locked mode, the
   * absence of the keystone validator is a critical integrity failure.
   */
  if (mode === "strict" || mode === "locked") {
    console.log("❌ [KEYSTONE] keystone-validate not found — BLOCKED");
    console.log(
      "   Expected at: .opencode/scripts/mcp-tools/keystone-validate.ts",
    );
    writeLog("hook-layers", "hooks", {
      level: "ERROR",
      event: "KEYSTONE-VALIDATION-MISSING",
      detail: "keystone-validate script not found in strict/locked mode",
    });
    process.exit(1);
  }
  console.log("⚠️  [ADVISORY] keystone-validate not found — skipped");
  writeLog("hook-layers", "hooks", {
    level: "WARN",
    event: "KEYSTONE-VALIDATION-SKIPPED",
    detail: "keystone-validate not found — advisory mode",
  });
} else if (!existsSync(MACHINE)) {
  console.log("⚠️  machine.json not found — no Keystone constraints");
} else {
  // Use spawnSync — execSync with stdio:'inherit' cannot enforce timeout
  // because the child process owns the terminal fd.
  const { spawnSync } = require("node:child_process");
  const result = spawnSync("bun", [validator, "--pre-commit"], {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    /**
     * FIX-005: Fail closed — keystone validator execution failure
     * (timeout or spawn error) exits 1 in strict/locked.
     * Previously allowed commits to proceed when the keystone validator
     * crashed or timed out, creating a false sense of validation.
     */
    if ((result.error as any).code === "ETIMEDOUT") {
      if (mode === "strict" || mode === "locked") {
        console.log("❌ [KEYSTONE] Validation timed out after 60s — BLOCKED");
        writeLog("hook-layers", "hooks", {
          level: "ERROR",
          event: "KEYSTONE-VALIDATION-TIMEOUT",
          detail:
            "Keystone validation timed out after 60s in strict/locked mode",
        });
        process.exit(1);
      }
      console.log(
        "  ⚠️  [ADVISORY] Keystone validation timed out after 60s — skipped",
      );
      writeLog("hook-layers", "hooks", {
        level: "WARN",
        event: "KEYSTONE-VALIDATION-TIMEOUT",
        detail: "Keystone validation timed out — advisory mode",
      });
    } else {
      if (mode === "strict" || mode === "locked") {
        console.log(
          `❌ [KEYSTONE] Validation error: ${(result.error as any).message} — BLOCKED`,
        );
        writeLog("hook-layers", "hooks", {
          level: "ERROR",
          event: "KEYSTONE-VALIDATION-ERROR",
          detail: `Keystone validation error: ${(result.error as any).message}`,
        });
        process.exit(1);
      }
      console.log(
        `  ⚠️  [ADVISORY] Keystone validation error: ${(result.error as any).message}`,
      );
      writeLog("hook-layers", "hooks", {
        level: "WARN",
        event: "KEYSTONE-VALIDATION-ERROR",
        detail: `Keystone validation error: ${(result.error as any).message}`,
      });
    }
  } else if (result.status === 0) {
    console.log("  ✅ Keystone validation passed");
  } else {
    if (mode === "advisory") {
      console.log("  ⚠️  [ADVISORY] Keystone validation failed");
      writeLog("hook-layers", "hooks", {
        level: "WARN",
        event: "KEYSTONE-VALIDATION-FAILED",
        detail: "Keystone validation failed — advisory mode",
      });
    } else {
      console.log("\n═══════════════════════════════════════════════════════");
      console.log("  ❌ PRE-COMMIT REJECTED — Keystone validation failed");
      console.log("═══════════════════════════════════════════════════════");
      writeLog("hook-layers", "hooks", {
        level: "ERROR",
        event: "KEYSTONE-VALIDATION-FAILED",
        detail: "Keystone validation failed — pre-commit rejected",
      });
      process.exit(1);
    }
  }
}

// ── Layer 3: Delegate to commit-msg ──
console.log("\n[Layer 3/4] Commit message validation → commit-msg hook");
console.log("\n═══════════════════════════════════════════════════════");
console.log("  ✅ PRE-COMMIT PASSED — All checks clear");
console.log("═══════════════════════════════════════════════════════");
// Test: Mon Jun 15 21:52:30 JST 2026
