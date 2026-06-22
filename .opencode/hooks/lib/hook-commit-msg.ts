/**
 * hook-commit-msg.ts — Commit message validation hook
 * ====================================================
 *
 * Replaces the bash `.opencode/hooks/commit-msg` script.
 * Validates:
 *   - TDD phase ordering ([Red] → [Green] → [Refactor])
 *   - [INFRA] marker when critical files are modified
 *   - commitlint fallback for non-TDD commits
 *
 * FIX-011 (Phase 2, 2026-06-21): Added structured Log Central
 * integration via writeLog() for high-severity events.
 * HVEC-007: reject/skip/env-downgrade events now searchable
 * in Log Central's source index.
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
import {
  getStagedCriticalFiles,
  getStagedInfraFiles,
} from "./hook-critical-files";
/**
 * FIX-011 (Phase 2): Commit-msg hook now emits structured high-severity
 * events through Log Central (log-manager.ts) in addition to the existing
 * file-based hook-commit-msg.log. This closes the HVEC-007 observability
 * gap for commit-message enforcement rejections.
 */
import { writeLog } from "../../lib/log-manager";

// ── Redirect all output to log file (sync writes for reliable flush before exit) ──
const logFile = ".task_temp/_logs/hook-commit-msg.log";
mkdirSync(dirname(logFile), { recursive: true });
function log(...args: any[]) {
  appendFileSync(logFile, `[${new Date().toISOString()}] ${args.join(" ")}\n`);
}
console.log = log;
console.error = (...args: any[]) => log("ERROR:", ...args);
console.warn = (...args: any[]) => log("WARN:", ...args);

const commitMsgFile = process.argv[2];
if (!commitMsgFile || !existsSync(commitMsgFile)) {
  console.log("⚠️  [commit-msg] no commit message file — skipping");
  process.exit(0);
}

const msg = readFileSync(commitMsgFile, "utf8").trim();
const root = getProjectRoot();

const mode = getEnforcementMode(root);

// ═══ FIX-004: Block env downgrades in strict/locked mode ═══
const modeSource = getEnforcementModeWithSource(root);
if (modeSource.downgraded) {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  ❌ COMMIT-MSG BLOCKED — Enforcement downgrade detected");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Config mode: ${modeSource.configMode}`);
  console.log(`  Env override: ${modeSource.envMode}`);
  console.log(`  ${modeSource.downgradeReason}`);
  console.log(
    "  Unset ENFORCEMENT_MODE or set it to at least the config level.",
  );
  console.log("═══════════════════════════════════════════════════════");
  /**
   * FIX-011: Emit structured Log Central event for commit-msg env downgrade.
   */
  writeLog("hook-commit-msg", "hooks", {
    level: "ERROR",
    event: "ENFORCEMENT-MODE-DOWNGRADE-BLOCKED",
    detail: JSON.stringify({
      configMode: modeSource.configMode,
      envMode: modeSource.envMode,
      reason: modeSource.downgradeReason,
      hook: "commit-msg",
    }),
  });
  process.exit(1);
}

// ── Skip merge commits ──
if (/^Merge /i.test(msg)) {
  console.log("✅ [commit-msg] Merge commit — skipping");
  process.exit(0);
}

// ── TDD Marker + Phase Ordering ──
const tddMatch = msg.match(/^\[(Red|Green|Refactor)\]\s+(\S+)/i);

// INFRA-POLICY-WIDER-SCOPE (2026-06-22): Also check for infrastructure files
// (anything NOT under booking_system_refactor/), not just CRITICAL_FILES.
const criticalModified = getStagedCriticalFiles();
const infraModified = getStagedInfraFiles();
const isInfraOnly =
  !tddMatch && msg.includes("[INFRA]") && infraModified.length > 0;

if (tddMatch) {
  const phase = tddMatch[1].toLowerCase();
  const taskId = tddMatch[2];
  const prevCommits = (() => {
    try {
      return execSync(`git log --oneline --all --grep="${taskId}"`, {
        encoding: "utf8",
        timeout: 5000,
      });
    } catch {
      return "";
    }
  })();

  if (phase === "green") {
    const hasRed = prevCommits
      .split("\n")
      .some((l) => new RegExp(`\\[Red\\].*${taskId}`, "i").test(l));
    if (!hasRed) {
      console.log(`❌ [TDD] [Green] for ${taskId} without preceding [Red]`);
      writeLog("hook-commit-msg", "hooks", {
        level: "ERROR",
        event: "TDD-PHASE-VIOLATION",
        detail: JSON.stringify({
          phase: "green",
          taskId,
          reason: "no preceding [Red]",
        }),
      });
      process.exit(1);
    }
  }
  if (phase === "refactor") {
    const hasGreen = prevCommits
      .split("\n")
      .some((l) => new RegExp(`\\[Green\\].*${taskId}`, "i").test(l));
    if (!hasGreen) {
      console.log(
        `❌ [TDD] [Refactor] for ${taskId} without preceding [Green]`,
      );
      writeLog("hook-commit-msg", "hooks", {
        level: "ERROR",
        event: "TDD-PHASE-VIOLATION",
        detail: JSON.stringify({
          phase: "refactor",
          taskId,
          reason: "no preceding [Green]",
        }),
      });
      process.exit(1);
    }
  }
  console.log(`✅ [TDD] Valid ${phase} commit for ${taskId}`);
} else if (isInfraOnly) {
  console.log(
    `✅ [INFRA] infrastructure-only commit (${criticalModified.length} critical file(s)) — TDD marker not required`,
  );
} else if (mode === "strict" || mode === "locked") {
  console.log(
    "❌ [TDD] Commit message must contain [Red], [Green], or [Refactor]",
  );
  writeLog("hook-commit-msg", "hooks", {
    level: "ERROR",
    event: "TDD-MARKER-MISSING",
    detail: JSON.stringify({ mode, msg: msg.substring(0, 200) }),
  });
  process.exit(1);
} else {
  console.log("⚠️  [TDD] Advisory: No TDD marker found");
  writeLog("hook-commit-msg", "hooks", {
    level: "WARN",
    event: "TDD-MARKER-MISSING-ADVISORY",
    detail: "TDD marker missing — advisory mode",
  });
}

// ═══ INFRA-NO-MIXED-COMMITS: Block mixed business+infra commits ═══
// Added 2026-06-22 by @Super-Admin.
// A single commit MUST NOT contain both business code files
// (under booking_system_refactor/) AND infrastructure files (everything else).
// They must be committed separately for clean audit trails.
import {
  hasMixedBusinessAndInfra,
  getStagedChangedFiles,
} from "./hook-critical-files";

const allStagedFiles = getStagedChangedFiles();
const isMixed = hasMixedBusinessAndInfra(allStagedFiles);

if (isMixed) {
  const businessFiles = allStagedFiles.filter((f: string) =>
    f.startsWith("booking_system_refactor/"),
  );
  const infraFiles = allStagedFiles.filter(
    (f: string) => !f.startsWith("booking_system_refactor/"),
  );

  console.log("═══════════════════════════════════════════════════════");
  console.log("  ❌ [FW-ENFORCE][INFRA-NO-MIXED-COMMITS]");
  console.log("  Cannot mix INFRA and business code files in the same commit.");
  console.log("  Please commit separately.");
  console.log("═══════════════════════════════════════════════════════");
  console.log("");
  console.log(`  Business code files (${businessFiles.length}):`);
  businessFiles.forEach((f: string) => console.log(`    ${f}`));
  console.log("");
  console.log(`  Infrastructure files (${infraFiles.length}):`);
  infraFiles.forEach((f: string) => console.log(`    ${f}`));
  console.log("");
  console.log("  Suggested approach:");
  console.log(
    "    1. git add <infra files only> && git commit -m '[INFRA] ...'",
  );
  console.log(
    "    2. git add <business files only> && git commit -m '[Red] T-xxx ...'",
  );
  console.log("═══════════════════════════════════════════════════════");

  writeLog("hook-commit-msg", "hooks", {
    level: "ERROR",
    event: "INFRA-NO-MIXED-COMMITS",
    detail: JSON.stringify({
      totalFiles: allStagedFiles.length,
      businessCount: businessFiles.length,
      infraCount: infraFiles.length,
      businessFiles,
      infraFiles,
    }),
  });
  process.exit(1);
}

// ── [INFRA] Marker Check (infrastructure files) ──
// INFRA-POLICY-WIDER-SCOPE (2026-06-22): Check ALL infrastructure files
// (anything NOT under booking_system_refactor/), not just CRITICAL_FILES.
// This closes the blind spot where modifications to files like
// package.json, tsconfig.json, or .github/workflows/* could bypass
// the [INFRA] commit-marker requirement.
if (infraModified.length > 0) {
  if (!msg.includes("[INFRA]")) {
    console.log("═══════════════════════════════════════════════════════");
    console.log(
      "[FW-ENFORCE][INFRA] Infrastructure files in this commit (outside booking_system_refactor/):",
    );
    infraModified.forEach((f) => console.log(`  - ${f}`));
    console.log("\nCommit message must include [INFRA] marker.");
    console.log(
      'Example: git commit -m "[Green][INFRA] update agent permissions"',
    );
    console.log("═══════════════════════════════════════════════════════");
    if (mode === "locked") {
      console.log(
        "❌ [INFRA] Blocked in locked mode — [INFRA] marker required",
      );
      writeLog("hook-commit-msg", "hooks", {
        level: "ERROR",
        event: "INFRA-MARKER-REQUIRED-LOCKED",
        detail: JSON.stringify({ files: infraModified, mode }),
      });
      process.exit(1);
    } else {
      console.log(
        `⚠️  [INFRA] Advisory: ${infraModified.length} infrastructure file(s) modified — ` +
          `[INFRA] marker recommended but not enforced in ${mode} mode`,
      );
      writeLog("hook-commit-msg", "hooks", {
        level: "WARN",
        event: "INFRA-MARKER-RECOMMENDED",
        detail: JSON.stringify({ files: infraModified, mode }),
      });
    }
  } else if (!isInfraOnly) {
    console.log(
      `✅ [INFRA] ${infraModified.length} infrastructure file(s) — marker confirmed`,
    );
  }
}

// ── commitlint (fallback for non-TDD commits) ──
if (!tddMatch) {
  const commitlint = join(root, "node_modules/.bin/commitlint");
  if (existsSync(commitlint)) {
    console.log("🔍 [commitlint] Validating...");
    try {
      execSync(`npx commitlint --edit "${commitMsgFile}"`, {
        encoding: "utf8",
        stdio: "inherit",
      });
    } catch {
      console.log("❌ Commit message rejected by commitlint.");
      writeLog("hook-commit-msg", "hooks", {
        level: "ERROR",
        event: "COMMITLINT-REJECTED",
        detail: "Commit message rejected by commitlint",
      });
      process.exit(1);
    }
  }
}
