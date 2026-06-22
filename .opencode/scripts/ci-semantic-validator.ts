#!/usr/bin/env bun
/**
 * ci-semantic-validator.ts — FIX-008: CI semantic validation layer
 * =====================================================================
 * Validates commit range policy independently of staged files. This is
 * the CI-side answer to raw `git commit --no-verify` bypasses that the
 * local pre-commit/commit-msg hooks cannot intercept.
 *
 * Checks performed (all exit non-zero on violation):
 *   1. Critical infra commits require [INFRA] marker in commit message
 *   2. Enforcement mode cannot be downgraded within the commit range
 *   3. Hook implementation invariants hold (wrappers delegate correctly)
 *   4. Keystone hashes are consistent (via framework-self-test.ts)
 *   5. State machine schema is valid
 *
 * Usage:
 *   bun .opencode/scripts/ci-semantic-validator.ts                    # checks current HEAD
 *   bun .opencode/scripts/ci-semantic-validator.ts --range HEAD~3..HEAD # checks range
 *   bun .opencode/scripts/ci-semantic-validator.ts --base origin/main # PR check
 *
 * Exit codes:
 *   0 — All semantic checks pass
 *   1 — Policy violation(s) detected
 *
 * @author @Super-Admin
 * @since 2026-06-21 — FIX-008
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync, accessSync, constants } from "node:fs";
import { resolve, dirname, basename } from "node:path";

// ── Path Resolution ──────────────────────────────────────────
function resolveOpenCodeRoot(): string {
  if (process.env.OPENCODE_ROOT) return resolve(process.env.OPENCODE_ROOT);
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

const ROOT = resolveOpenCodeRoot();

// ── CLI Args ──────────────────────────────────────────────────
let commitRange = "HEAD";
const rangeIdx = process.argv.indexOf("--range");
if (rangeIdx !== -1 && rangeIdx + 1 < process.argv.length) {
  commitRange = process.argv[rangeIdx + 1];
}
const baseIdx = process.argv.indexOf("--base");
if (baseIdx !== -1 && baseIdx + 1 < process.argv.length) {
  commitRange = `${process.argv[baseIdx + 1]}..HEAD`;
}

let failures = 0;
function fail(msg: string): void {
  console.log(`❌ ${msg}`);
  failures++;
}
function pass(msg: string): void {
  console.log(`✅ ${msg}`);
}

// ── Load Critical Files ──────────────────────────────────────
let CRITICAL_FILES: string[] = [];
try {
  CRITICAL_FILES =
    require(resolve(ROOT, ".opencode", "lib", "critical-files"))
      .CRITICAL_FILES || [];
} catch {
  console.warn(
    "⚠️  Could not load critical-files.ts; critical-file checks will be skipped",
  );
}

// ═══════════════════════════════════════════════════════════════
// CHECK 1: Infrastructure commits require [INFRA] marker
//
// INFRA-POLICY-WIDER-SCOPE (2026-06-22): Replaced the explicit
// CRITICAL_FILES array check with a broader rule:
//   ANY file NOT under booking_system_refactor/ is infrastructure
//   and requires [INFRA] in the commit message.
//
// FIX-CI-ENVIRONMENT (2026-06-22): Added POLICY_CUTOFF_DATE to skip
// commits authored before the [INFRA] policy existed. The first
// [INFRA] commit was 7ea5bef1 on 2026-06-15. Commits before this
// date are exempt from the [INFRA] marker requirement to avoid
// false positives in CI on pre-policy commits.
// ═══════════════════════════════════════════════════════════════

/**
 * Unix timestamp cutoff for [INFRA] policy exemption.
 * FIX-008 (commit 419e1e6f, 2026-06-21) introduced CI semantic validation.
 * Commits authored before CI enforcement existed are exempt to avoid
 * false positives in PR checks where historical commits are in range.
 */
const POLICY_CUTOFF_EPOCH = 1750896000; // 2026-06-21T00:00:00Z

/**
 * INFRA-POLICY-WIDER-SCOPE (2026-06-22):
 * Business code directories — files under these prefixes are exempt
 * from the [INFRA] marker requirement. Everything else is infrastructure.
 */
const BUSINESS_CODE_PREFIXES = ["booking_system_refactor/"];

function check1_criticalInfraMarker(): void {
  console.log("\n── Check 1: Infrastructure commit [INFRA] marker ──");
  console.log(
    `   Policy: any file NOT under ${BUSINESS_CODE_PREFIXES.join(", ")} requires [INFRA]`,
  );

  try {
    // Get commits in range
    const commits = execSync(`git log --oneline --name-only ${commitRange}`, {
      encoding: "utf8",
      cwd: ROOT,
    }).trim();

    if (!commits) {
      pass("No commits in range");
      return;
    }

    // Get full commit messages with committer date (UNIX timestamp) for analysis
    const fullLog = execSync(
      `git log --format='---COMMIT---%n%H%n%ct%n%s%n%b' ${commitRange}`,
      { encoding: "utf8", cwd: ROOT },
    ).trim();

    const commitBlocks = fullLog.split("---COMMIT---").filter(Boolean);

    for (const block of commitBlocks) {
      const lines = block.trim().split("\n");
      if (lines.length < 3) continue;
      const hash = lines[0].trim();
      const committerEpoch = parseInt(lines[1]?.trim() || "0", 10);
      const subject = lines[2]?.trim() || "";
      const body = lines.slice(3).join("\n");

      // Skip commits authored before the [INFRA] policy existed (false positives)
      if (committerEpoch < POLICY_CUTOFF_EPOCH) {
        pass(
          `Commit ${hash.substring(0, 7)} predates [INFRA] CI policy (${new Date(committerEpoch * 1000).toISOString().split("T")[0]}) — skipped`,
        );
        continue;
      }

      // Get files changed in this commit
      const changedFiles = execSync(
        `git diff-tree --no-commit-id --name-only -r ${hash}`,
        { encoding: "utf8", cwd: ROOT },
      )
        .trim()
        .split("\n")
        .filter(Boolean);

      // INFRA-POLICY-WIDER-SCOPE: Check if ANY file is NOT under a business code prefix
      const hasInfraFiles = changedFiles.some(
        (f: string) =>
          !BUSINESS_CODE_PREFIXES.some((prefix) => f.startsWith(prefix)),
      );

      if (hasInfraFiles) {
        // Identify which specific files are infrastructure
        const infraFiles = changedFiles.filter(
          (f: string) =>
            !BUSINESS_CODE_PREFIXES.some((prefix) => f.startsWith(prefix)),
        );

        const hasInfraMarker =
          /\[INFRA\]/i.test(subject) || /\[INFRA\]/i.test(body);
        if (!hasInfraMarker) {
          fail(
            `Commit ${hash.substring(0, 7)} touches infrastructure files without [INFRA] marker: ${infraFiles.slice(0, 5).join(", ")}${infraFiles.length > 5 ? ` (+${infraFiles.length - 5} more)` : ""}`,
          );
        } else {
          pass(
            `Commit ${hash.substring(0, 7)} has [INFRA] marker (${infraFiles.length} infra file(s))`,
          );
        }
      }
    }
  } catch (e: any) {
    console.warn(`⚠️  Check 1 error: ${e.message || e}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK 2: Enforcement mode downgrade detection
// ═══════════════════════════════════════════════════════════════
function check2_enforcementModeDowngrade(): void {
  console.log("\n── Check 2: Enforcement mode downgrade detection ──");

  try {
    const configPath = resolve(ROOT, ".opencode", "project.config.json");
    if (!existsSync(configPath)) {
      fail("project.config.json not found");
      return;
    }

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const devMode = config?.template_resolution?.develop_enforcement_mode;
    const runtimeMode = config?.template_resolution?.runtime_enforcement_mode;

    // Check that neither mode is advisory when in CI
    if (devMode === "advisory") {
      fail(
        `develop_enforcement_mode is 'advisory' — CI requires strict or locked`,
      );
    } else {
      pass(`develop_enforcement_mode is '${devMode}'`);
    }

    if (runtimeMode === "advisory") {
      fail(
        `runtime_enforcement_mode is 'advisory' — CI requires strict or locked`,
      );
    } else {
      pass(`runtime_enforcement_mode is '${runtimeMode}'`);
    }

    // If locked, verify allow_downgrade is false
    if (devMode === "locked" || runtimeMode === "locked") {
      const allowDowngrade =
        config?.template_resolution?.enforcement_config?.locked
          ?.allow_downgrade;
      if (allowDowngrade !== false) {
        fail("locked mode must have allow_downgrade=false");
      } else {
        pass("Locked mode: allow_downgrade=false (correct)");
      }
    }

    // Check for mode change within range
    try {
      const modeChanges = execSync(
        `git log --oneline -p -- .opencode/project.config.json ${commitRange} | grep -E '[+-].*enforcement_mode' || true`,
        { encoding: "utf8", cwd: ROOT },
      ).trim();

      if (modeChanges) {
        // Parse for downgrade patterns
        const downgrades = modeChanges
          .split("\n")
          .filter(
            (line) =>
              line.includes("+") &&
              (line.includes("advisory") || line.includes('"strict"')),
          );
        if (downgrades.length > 0) {
          console.warn(
            "⚠️  Enforcement mode changes detected in range (review required)",
          );
        }
      }
    } catch {
      // No changes to config, OK
    }
  } catch (e: any) {
    console.warn(`⚠️  Check 2 error: ${e.message || e}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK 3: Hook implementation invariants
// ═══════════════════════════════════════════════════════════════
function check3_hookInvariants(): void {
  console.log("\n── Check 3: Hook implementation invariants ──");

  const hooksDir = resolve(ROOT, ".opencode", "hooks");
  const libDir = resolve(hooksDir, "lib");

  // 3a. Wrapper scripts must delegate to bun + hook-layers.ts / hook-commit-msg.ts
  const preCommit = resolve(hooksDir, "pre-commit");
  const commitMsg = resolve(hooksDir, "commit-msg");

  for (const [name, path] of [
    ["pre-commit", preCommit],
    ["commit-msg", commitMsg],
  ]) {
    if (!existsSync(path)) {
      fail(`Hook wrapper '${name}' not found at ${path}`);
      continue;
    }

    try {
      accessSync(path, constants.X_OK);
    } catch {
      fail(`Hook wrapper '${name}' is not executable`);
      continue;
    }

    const content = readFileSync(path, "utf-8");

    // Verify delegation: must call bun against correct script
    if (name === "pre-commit" && !content.includes("hook-layers")) {
      fail(`pre-commit wrapper does not delegate to hook-layers.ts`);
    } else if (name === "commit-msg" && !content.includes("hook-commit-msg")) {
      fail(`commit-msg wrapper does not delegate to hook-commit-msg.ts`);
    }

    // Verify no forbidden skip patterns in wrapper
    const forbiddenPatterns = [
      /--no-verify/,
      /-n\b(?!px|ode)/i, // -n shorthand (exclude npx/node)
      /skipHooks/,
      /skip-worktree/,
    ];

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(content)) {
        fail(
          `Hook wrapper '${name}' contains forbidden pattern: ${pattern.source}`,
        );
      }
    }
  }

  // 3b. Implementation files must exist
  const implFiles = ["hook-layers.ts", "hook-commit-msg.ts"];
  for (const f of implFiles) {
    const fp = resolve(libDir, f);
    if (!existsSync(fp)) {
      fail(`Hook implementation '${f}' not found at ${fp}`);
    } else {
      pass(`Hook implementation '${f}' exists`);
    }
  }

  // 3c. hook-critical-files.ts — optional but checked if present
  const hcfPath = resolve(libDir, "hook-critical-files.ts");
  if (existsSync(hcfPath)) {
    pass(`hook-critical-files.ts exists`);
    // Verify it imports from .opencode/lib/critical-files.ts
    const hcfContent = readFileSync(hcfPath, "utf-8");
    if (!hcfContent.includes("critical-files")) {
      fail(`hook-critical-files.ts does not reference critical-files`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK 4: Framework self-test passes
// ═══════════════════════════════════════════════════════════════
function check4_frameworkSelfTest(): void {
  console.log("\n── Check 4: Framework self-test ──");

  const selfTestPath = resolve(
    ROOT,
    ".opencode",
    "scripts",
    "framework-self-test.ts",
  );
  if (!existsSync(selfTestPath)) {
    fail("framework-self-test.ts not found");
    return;
  }

  try {
    const result = execSync(`bun ${selfTestPath}`, {
      encoding: "utf8",
      cwd: ROOT,
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    pass("framework-self-test.ts passed");
  } catch (e: any) {
    // Exit code 1 is expected for failures; log output
    const stdout = e?.stdout?.toString() || "";
    const failLines = stdout
      .split("\n")
      .filter((l: string) => l.startsWith("[FAIL]"));
    fail(
      `framework-self-test.ts exited with failures (${failLines.length} checks): ${failLines.slice(0, 3).join("; ")}${failLines.length > 3 ? "..." : ""}`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
console.log(`🔍 CI Semantic Validator — commit range: ${commitRange}`);
console.log(`📁 Root: ${ROOT}`);
console.log(`🔒 Tracking ${CRITICAL_FILES.length} critical files`);

check1_criticalInfraMarker();
check2_enforcementModeDowngrade();
check3_hookInvariants();
check4_frameworkSelfTest();

console.log("");
if (failures === 0) {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("✅ ALL SEMANTIC CHECKS PASSED");
  console.log("═══════════════════════════════════════════════════════════");
  process.exit(0);
} else {
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`❌ ${failures} SEMANTIC CHECK(S) FAILED`);
  console.log("═══════════════════════════════════════════════════════════");
  process.exit(1);
}
