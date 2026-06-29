/**
 * quality-batch.ts — Batch quality check orchestrators
 * ═══════════════════════════════════════════════════════════
 * Extracted from scripts/mcp-tools/code-quality-lib.ts (B-4C refactoring).
 *
 * Provides:
 *   runAllChecks()  — Run all applicable checks on a single file
 *   runFullScan()   — Full project scan (depcruise + prettier)
 *
 * These are orchestration functions that compose individual checks
 * from quality-checks.ts.
 *
 * @since 2026-06-29 (B-4C extraction)
 */
import * as path from "node:path";
import { execSync } from "node:child_process";
import {
  runScopeCheck,
  runPrettierCheck,
  runDepCruiserCheck,
  runEslintAudit,
  runTddOrderCheck,
  runTddSpecCheck,
  matchGlob,
} from "./quality-checks";
import type {
  CheckResult,
  CheckViolation,
  WriteScopes,
  TddState,
} from "./quality-checks";

// ─── Types ──────────────────────────────────────────────────

export interface RunAllChecksOptions {
  skip_checks?: string[];
  auto_fix?: boolean;
  agentWriteScopes?: WriteScopes | null;
  backendDir?: string;
  frontendDir?: string;
  tddState?: TddState | null;
  existingFiles?: string[];
  phase?: string;
}

export interface RunAllChecksResult {
  overall: "pass" | "fail";
  checks: Record<string, CheckResult>;
  violations: CheckViolation[];
  fixes_applied: Array<{ check: string; action: string }>;
  tddState: TddState | null;
}

export interface FullScanResult {
  overall: "pass" | "fail";
  violations: CheckViolation[];
}

// ═══════════════════════════════════════════════════════════
// BATCH RUNNER: runAllChecks
// ═══════════════════════════════════════════════════════════

/**
 * Run all applicable checks on a file.
 *
 * @param filePath - absolute path to changed file
 * @param projectRoot - project root directory
 * @param agentType - agent identifier
 * @param taskId - current task ID
 * @param options - skip_checks, auto_fix, agentWriteScopes, etc.
 */
export function runAllChecks(
  filePath: string,
  projectRoot: string,
  agentType: string,
  taskId: string,
  options?: RunAllChecksOptions,
): RunAllChecksResult {
  const opts = options || {};
  const skip = new Set(opts.skip_checks || []);
  const results: RunAllChecksResult = {
    checks: {},
    overall: "pass",
    violations: [],
    fixes_applied: [],
    tddState: opts.tddState || null,
  };

  // Resolve file path
  let absPath = filePath;
  if (!path.isAbsolute(absPath)) absPath = path.resolve(projectRoot, absPath);

  // Check 1: Agent Write Scope
  if (!skip.has("scope")) {
    const r = runScopeCheck(absPath, projectRoot, agentType, opts.agentWriteScopes ?? null);
    results.checks.scope = r;
    if (!r.pass) {
      results.overall = "fail";
      results.violations.push(...r.violations.map((v) => ({ ...v, check: "scope" })));
    }
  }

  // Check 2: Prettier Format
  if (!skip.has("format")) {
    const r = runPrettierCheck(absPath, projectRoot, opts.auto_fix !== false);
    results.checks.format = r;
    if (r.violations.length > 0) {
      if (r.detail && r.detail.includes("auto-fixed")) {
        results.fixes_applied.push({ check: "format", action: "prettier --write" });
      } else {
        results.overall = "fail";
        results.violations.push(...r.violations.map((v) => ({ ...v, check: "format" })));
      }
    }
  }

  // Check 3: dependency-cruiser
  if (!skip.has("deps")) {
    const r = runDepCruiserCheck(absPath, projectRoot);
    results.checks.deps = r;
    if (!r.pass) {
      results.overall = "fail";
      results.violations.push(...r.violations.map((v) => ({ ...v, check: "deps" })));
    }
  }

  // Check 4: ESLint mock-audit
  if (!skip.has("eslint")) {
    const r = runEslintAudit(absPath, projectRoot, { phase: opts.phase });
    results.checks.eslint = r;
    const tier1Mocks = r.violations.filter((v) => v.rule === "no-tier1-mock");
    if (tier1Mocks.length > 0) {
      results.overall = "fail";
      results.violations.push({
        check: "eslint",
        severity: "BLOCKER",
        message: `CAT1.1: ${tier1Mocks.length} Tier1 service mock(s) detected`,
      });
    } else if (!r.pass && r.violations.length > 0) {
      results.violations.push({
        check: "eslint",
        severity: "ERROR",
        message: `${r.violations.length} ESLint violations`,
      });
    }
  }

  // Check 5: tsc check — handled by tsc-diag-track.ts plugin (removed 2026-06-26)

  // Check 6: TDD Order Enforcement
  if (!skip.has("tdd")) {
    const r = runTddOrderCheck(absPath, projectRoot, opts.tddState ?? null);
    results.checks.tdd = r;
    results.tddState = r.tddState;
    if (!r.pass) {
      results.overall = "fail";
      results.violations.push(...r.violations.map((v) => ({ ...v, check: "tdd" })));
    }
  }

  // Check 7: TDD Spec File Existence (CI-EMBED-006)
  if (!skip.has("tdd_spec") && opts.existingFiles) {
    const r = runTddSpecCheck(absPath, opts.existingFiles, opts.tddState ?? null);
    results.checks.tdd_spec = r;
    if (!r.pass) {
      results.overall = "fail";
      results.violations.push(...r.violations.map((v) => ({ ...v, check: "tdd_spec" })));
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// FULL SCAN: runFullScan
// ═══════════════════════════════════════════════════════════

/**
 * Full project scan — dependency-cruiser + prettier on entire codebase.
 * Note: tsc is handled by tsc-diag-track.ts plugin (removed from full scan 2026-06-26).
 */
export function runFullScan(
  projectRoot: string,
  _backendDir: string,
  _frontendDir: string,
): FullScanResult {
  const results: FullScanResult = { overall: "pass", violations: [] };

  // dependency-cruiser full scan
  try {
    execSync(
      "npx depcruise --config .dependency-cruiser.js --output-type json .",
      {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch (e: any) {
    try {
      const data = JSON.parse(e.stdout?.toString() || "{}");
      const depsViolations = data.summary?.violations?.length || 0;
      if (depsViolations > 0) {
        results.overall = "fail";
        results.violations.push({
          check: "dep_full",
          severity: "ERROR",
          message: `${depsViolations} dependency violations`,
        });
      }
    } catch {}
  }

  // Prettier full check
  try {
    execSync('npx prettier --check "src/**/*.{ts,html,scss,css,json}"', {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    results.overall = "fail";
    results.violations.push({
      check: "format_full",
      severity: "ERROR",
      message: "Some files are not formatted",
    });
  }

  return results;
}
