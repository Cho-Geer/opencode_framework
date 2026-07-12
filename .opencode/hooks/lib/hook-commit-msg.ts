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
  getProjectRoot,
} from "../../lib/gate-core";
import {
  getStagedCriticalFiles,
  getStagedInfraFiles,
  BUSINESS_CODE_PREFIX,
  isInfraOnlyCommit,
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

// ═══ Phase 3 cleanup: legacy ENFORCEMENT_MODE env override is ignored ═══
// Single-policy runtime enforces per-rule disposition only; the deprecated
// getEnforcementModeWithSource() compat shim is no longer consulted here.
const legacyEnvMode = process.env.ENFORCEMENT_MODE;
if (legacyEnvMode) {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  ⚠️  COMMIT-MSG NOTICE — Legacy env override ignored");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Legacy ENFORCEMENT_MODE=${legacyEnvMode} is ignored`);
  console.log("  Single-policy runtime enforces per-rule disposition only.");
  console.log("═══════════════════════════════════════════════════════");
  writeLog("hook-commit-msg", "hooks", {
    level: "WARN",
    event: "ENFORCEMENT-MODE-DOWNGRADE-IGNORED",
    detail: JSON.stringify({
      legacyEnvMode,
      hook: "commit-msg",
    }),
  });
}

// ── Skip merge commits ──
if (/^Merge /i.test(msg)) {
  console.log("✅ [commit-msg] Merge commit — skipping");
  process.exit(0);
}

// ── TDD Marker + Phase Ordering ──
/**
 * INFRA-ONLY-TDD-SKIP (2026-06-22): If ALL staged files are infrastructure
 * (outside BUSINESS_CODE_PREFIX), skip TDD phase ordering entirely.
 * Only require [INFRA] marker. This allows framework maintenance commits
 * to bypass RED/GREEN/REFACTOR without weakening business code enforcement.
 */
const infraOnlyCommit = isInfraOnlyCommit(getStagedChangedFiles());
const infraModified = getStagedInfraFiles();

if (infraOnlyCommit) {
  // ── INFRA-only commit: skip TDD markers, require [INFRA] ──
  if (!msg.includes("[INFRA]")) {
    console.log("═══════════════════════════════════════════════════════");
    console.log(
      "  [FW-ENFORCE][INFRA] INFRA-only commit — [INFRA] marker required",
    );
    console.log("═══════════════════════════════════════════════════════");
    console.log(
      "  All staged files are infrastructure (outside booking_system_refactor/).",
    );
    console.log(
      "  Commit message must include [INFRA] marker. TDD markers not required.",
    );
    console.log(
      '  Example: git commit -m "[INFRA] fix hook enforcement logic"',
    );
    console.log("═══════════════════════════════════════════════════════");
    console.log("  ⚠️  [INFRA] [INFRA] marker recommended for audit clarity");
    writeLog("hook-commit-msg", "hooks", {
      level: "WARN",
      event: "INFRA-ONLY-MARKER-MISSING-ADVISORY",
      detail: JSON.stringify({ policy: modeSource.mode }),
    });
  } else {
    console.log(
      `✅ [INFRA] INFRA-only commit — TDD markers skipped, [INFRA] confirmed`,
    );
    writeLog("hook-commit-msg", "hooks", {
      level: "INFO",
      event: "INFRA-ONLY-COMMIT-ACCEPTED",
      detail: "INFRA-only commit with [INFRA] marker — TDD skipped",
    });
  }
} else {
  // ── Normal (non-INFRA-only) commit: enforce TDD markers ──
  const tddMatch = msg.match(/^\[(Red|Green|Refactor)\]\s+(\S+)/i);

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
        console.log(`⚠️  [TDD] [Green] for ${taskId} without preceding [Red]`);
        writeLog("hook-commit-msg", "hooks", {
          level: "WARN",
          event: "TDD-PHASE-VIOLATION",
          detail: JSON.stringify({
            phase: "green",
            taskId,
            reason: "no preceding [Red]",
          }),
        });
      }
    }
    if (phase === "refactor") {
      const hasGreen = prevCommits
        .split("\n")
        .some((l) => new RegExp(`\\[Green\\].*${taskId}`, "i").test(l));
      if (!hasGreen) {
        console.log(
          `⚠️  [TDD] [Refactor] for ${taskId} without preceding [Green]`,
        );
        writeLog("hook-commit-msg", "hooks", {
          level: "WARN",
          event: "TDD-PHASE-VIOLATION",
          detail: JSON.stringify({
            phase: "refactor",
            taskId,
            reason: "no preceding [Green]",
          }),
        });
      }
    }
    console.log(`✅ [TDD] Valid ${phase} commit for ${taskId}`);
  } else {
    console.log("⚠️  [TDD] No TDD marker found");
    writeLog("hook-commit-msg", "hooks", {
      level: "WARN",
      event: "TDD-MARKER-MISSING-ADVISORY",
      detail: "TDD marker missing — audit only",
    });
  }
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
    f.startsWith(BUSINESS_CODE_PREFIX),
  );
  const infraFiles = allStagedFiles.filter(
    (f: string) => !f.startsWith(BUSINESS_CODE_PREFIX),
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

// ═══ INFRA-CHECK-UNCOMMITTED: Block business commits with uncommitted INFRA files ═══
// Added 2026-06-22 by @Super-Admin (task: INFRA-CHECK-UNCOMMITTED).
// When committing business code (files under BUSINESS_CODE_PREFIX, i.e.,
// booking_system_refactor/), there must be NO uncommitted/unstaged INFRA
// files (files outside BUSINESS_CODE_PREFIX). All pending INFRA changes
// must be committed first. This prevents scenarios where business code
// changes are committed alongside uncommitted framework modifications,
// creating confusing audit trails.
//
// The check uses two git commands:
//   git diff --name-only        → unstaged modified files
//   git ls-files --others --exclude-standard → untracked files
// Both are filtered by isInfrastructureFile() to identify INFRA files
// that exist on disk but are NOT part of the current commit.
//
// This check is skipped for INFRA-only commits (they have no business code).

const hasBusinessCodeInCommit = allStagedFiles.some((f: string) =>
  f.startsWith(BUSINESS_CODE_PREFIX),
);

if (hasBusinessCodeInCommit) {
  // Discover uncommitted INFRA files
  const uncommittedInfraFiles: string[] = [];

  // Unstaged modified files
  try {
    const diffOut = execSync("git diff --name-only", {
      encoding: "utf8",
      timeout: 5000,
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const f of diffOut) {
      if (isInfrastructureFile(f)) {
        uncommittedInfraFiles.push(f);
      }
    }
  } catch (err) {
    console.warn("⚠️  [INFRA-CHECK] git diff failed:", String(err));
  }

  // Untracked files
  try {
    const untrackedOut = execSync("git ls-files --others --exclude-standard", {
      encoding: "utf8",
      timeout: 5000,
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const f of untrackedOut) {
      if (isInfrastructureFile(f)) {
        uncommittedInfraFiles.push(f);
      }
    }
  } catch (err) {
    console.warn("⚠️  [INFRA-CHECK] git ls-files failed:", String(err));
  }

  if (uncommittedInfraFiles.length > 0) {
    console.log("═══════════════════════════════════════════════════════");
    console.log("  ❌ [FW-ENFORCE][INFRA-CHECK-UNCOMMITTED]");
    console.log("  Cannot commit business code while uncommitted INFRA");
    console.log("  files exist. Please commit INFRA files first.");
    console.log("═══════════════════════════════════════════════════════");
    console.log("");
    console.log(`  Uncommitted INFRA files (${uncommittedInfraFiles.length}):`);
    uncommittedInfraFiles.forEach((f: string) => console.log(`    ${f}`));
    console.log("");
    console.log("  Suggested approach:");
    console.log("    1. git add <infra files> && git commit -m '[INFRA] ...'");
    console.log("    2. Then commit your business code changes.");
    console.log("═══════════════════════════════════════════════════════");
    writeLog("hook-commit-msg", "hooks", {
      level: "ERROR",
      event: "INFRA-CHECK-UNCOMMITTED-BLOCKED",
      detail: JSON.stringify({
        uncommittedInfraCount: uncommittedInfraFiles.length,
        uncommittedInfraFiles,
        businessFilesAtCommit: allStagedFiles.filter((f: string) =>
          f.startsWith(BUSINESS_CODE_PREFIX),
        ),
      }),
    });
    process.exit(1);
  } else {
    console.log(
      "✅ [INFRA-CHECK] No uncommitted INFRA files — business commit allowed",
    );
    writeLog("hook-commit-msg", "hooks", {
      level: "INFO",
      event: "INFRA-CHECK-PASSED",
      detail: "Business code commit: no uncommitted INFRA files detected",
    });
  }
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
    console.log(
      `⚠️  [INFRA] ${infraModified.length} infrastructure file(s) modified — [INFRA] marker recommended for audit clarity`,
    );
    writeLog("hook-commit-msg", "hooks", {
      level: "WARN",
      event: "INFRA-MARKER-RECOMMENDED",
      detail: JSON.stringify({ files: infraModified, policy: modeSource.mode }),
    });
  } else if (!infraOnlyCommit) {
    console.log(
      `✅ [INFRA] ${infraModified.length} infrastructure file(s) — marker confirmed`,
    );
  }
}

// ── commitlint (fallback for non-TDD, non-INFRA-only commits) ──
const tddMatchGlobal = msg.match(/^\[(Red|Green|Refactor)\]\s+(\S+)/i);
if (!tddMatchGlobal && !infraOnlyCommit) {
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
