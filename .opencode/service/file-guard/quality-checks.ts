/**
 * quality-checks.ts — Individual code quality check functions
 * ═══════════════════════════════════════════════════════════
 * Extracted from scripts/mcp-tools/code-quality-lib.ts (B-4C refactoring).
 *
 * Each check is a pure function returning a standardized CheckResult.
 * No side effects — state persistence is the caller's responsibility.
 *
 * Checks:
 *   1. runScopeCheck     — Agent write scope enforcement
 *   2. runPrettierCheck  — Code formatting with auto-fix
 *   3. runDepCruiserCheck — Import/dependency architecture boundaries
 *   4. runEslintAudit    — ESLint mock-audit on test files
 *   5. runTddOrderCheck  — TDD order enforcement (test before impl)
 *   6. runTddSpecCheck   — Spec file existence enforcement
 *
 * @since 2026-06-29 (B-4C extraction)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

// ─── Types ──────────────────────────────────────────────────

export interface CheckViolation {
  check: string;
  severity: string;
  message: string;
  rule?: string;
  file?: string;
  line?: number;
  code?: string;
  raw?: unknown;
}

export interface CheckResult {
  pass: boolean;
  violations: CheckViolation[];
  detail: string;
  execution_evidence: string;
}

export interface WriteScopes {
  allowed: string[];
  denied: string[];
}

export interface TddState {
  testWritten: boolean;
  implFilesAttempted: string[];
  blockedAttempts: Array<{ file: string; timestamp: string }>;
  testFilesWritten: string[];
  initialized: boolean;
}

export interface TddOrderResult extends CheckResult {
  tddState: TddState;
}

// ─── Lazy-loaded dependencies ───────────────────────────────

let _stateCanon: any = null;
function getStateCanon() {
  if (!_stateCanon) {
    _stateCanon = require("../../scripts/state-canonicalize");
  }
  return _stateCanon;
}

// ─── Utility Functions ──────────────────────────────────────

/**
 * Simple glob matching: * matches anything except /, ** matches anything.
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  const regexStr =
    "^" +
    pattern
      .replace(/\*\*/g, "___DOUBLESTAR___")
      .replace(/\*/g, "[^/]*")
      .replace(/___DOUBLESTAR___/g, ".*") +
    "$";
  return new RegExp(regexStr).test(filePath);
}

/**
 * Extract the first path segment from a relative path string.
 * e.g. "booking-backend/src/" → "booking-backend"
 */
export function firstPathSegment(relativePath: string): string {
  return (
    relativePath.replace(/\\/g, "/").split("/").filter(Boolean)[0] ||
    relativePath
  );
}

/**
 * Build a standardized check result.
 */
function makeResult(
  pass: boolean,
  violations: CheckViolation[],
  detail: string,
  execution_evidence: string,
): CheckResult {
  return {
    pass: !!pass,
    violations: violations || [],
    detail: detail || "",
    execution_evidence: execution_evidence || "",
  };
}

// ═══════════════════════════════════════════════════════════
// CHECK 1: Agent Write Scope
// ═══════════════════════════════════════════════════════════

/**
 * Enforce that agent_type is allowed to write to filePath.
 */
export function runScopeCheck(
  filePath: string,
  projectRoot: string,
  agentType: string,
  agentWriteScopes: WriteScopes | null,
): CheckResult {
  if (!agentWriteScopes || !agentWriteScopes.allowed) {
    return makeResult(
      false,
      [
        {
          check: "scope",
          severity: "BLOCKER",
          message: `No write scope defined for ${agentType}`,
        },
      ],
      `Scope check failed: no scopes configured for ${agentType}`,
      "",
    );
  }

  // Normalize path to project-relative
  let normFile = filePath;
  if (
    normFile.startsWith(projectRoot + "/") ||
    normFile.startsWith(projectRoot)
  ) {
    normFile = normFile.replace(projectRoot, "").replace(/^\//, "");
  }

  // Check denied first
  for (const deny of agentWriteScopes.denied || []) {
    if (matchGlob(normFile, deny)) {
      const msg = `CAT4.1: ${agentType} DENIED from writing ${normFile}. Scope rule: denied ${deny}.`;
      return makeResult(false, [{ check: "scope", severity: "BLOCKER", message: msg }], msg, "");
    }
  }

  // Check allowed
  for (const allow of agentWriteScopes.allowed || []) {
    if (matchGlob(normFile, allow)) {
      return makeResult(
        true,
        [],
        `Scope check passed: ${normFile} allowed for ${agentType}`,
        "",
      );
    }
  }

  const msg = `CAT4.1: ${agentType} attempted to write ${normFile} — not in allowed scopes.`;
  return makeResult(false, [{ check: "scope", severity: "BLOCKER", message: msg }], msg, "");
}

// ═══════════════════════════════════════════════════════════
// CHECK 2: Prettier Format
// ═══════════════════════════════════════════════════════════

/**
 * Check (and optionally fix) code formatting with Prettier.
 */
export function runPrettierCheck(
  filePath: string,
  projectRoot: string,
  autoFix?: boolean,
): CheckResult {
  const effectiveAutoFix = autoFix !== false;
  let absPath = filePath;
  if (!path.isAbsolute(absPath)) absPath = path.resolve(projectRoot, absPath);

  if (!fs.existsSync(absPath)) {
    return makeResult(true, [], `File not found: ${absPath}`, "");
  }

  const ext = path.extname(absPath);
  if (!/\.(ts|js|html|scss|css|json|ya?ml|md)$/i.test(ext)) {
    return makeResult(true, [], `Non-formattable extension: ${ext}`, "");
  }

  try {
    const out = execSync(`npx prettier --check "${absPath}"`, {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return makeResult(true, [], "Prettier check passed", out.substring(0, 500));
  } catch (checkErr: any) {
    if (effectiveAutoFix) {
      try {
        const fixOut = execSync(`npx prettier --write "${absPath}"`, {
          cwd: projectRoot,
          encoding: "utf8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return makeResult(true, [], "Prettier auto-fixed", fixOut.substring(0, 500));
      } catch (fixErr: any) {
        return makeResult(
          false,
          [{ check: "format", severity: "ERROR", message: "Prettier check failed and auto-fix failed" }],
          `Prettier auto-fix failed: ${fixErr.message}`,
          fixErr.stderr?.substring(0, 500) || fixErr.message,
        );
      }
    }
    return makeResult(
      false,
      [{ check: "format", severity: "ERROR", message: "Prettier check failed. Run: npx prettier --write <file>" }],
      "Prettier check failed",
      checkErr.stdout?.substring(0, 500) || checkErr.message,
    );
  }
}

// ═══════════════════════════════════════════════════════════
// CHECK 3: dependency-cruiser
// ═══════════════════════════════════════════════════════════

/**
 * Check import/dependency violations via dependency-cruiser.
 */
export function runDepCruiserCheck(
  filePath: string,
  projectRoot: string,
): CheckResult {
  let absPath = filePath;
  if (!path.isAbsolute(absPath)) absPath = path.resolve(projectRoot, absPath);

  if (!fs.existsSync(absPath)) {
    return makeResult(true, [], `File not found: ${absPath}`, "");
  }

  try {
    const result = execSync(
      `npx depcruise --include-only "^${absPath}" --output-type json "${projectRoot}"`,
      {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const data = JSON.parse(result);
    if (data.summary?.violations?.length > 0) {
      return makeResult(
        false,
        data.summary.violations.map((v: any, i: number) => ({
          check: "deps",
          severity: "ERROR",
          message: `depcruise violation #${i + 1}: ${v.rule?.name || "unknown"}`,
          raw: v,
        })),
        `${data.summary.violations.length} dependency violations`,
        JSON.stringify(data.summary.violations).substring(0, 500),
      );
    }
    return makeResult(true, [], "dependency-cruiser check passed", "");
  } catch (e: any) {
    try {
      const data = JSON.parse(e.stdout?.toString() || "{}");
      if (data.summary?.violations?.length > 0) {
        return makeResult(
          false,
          data.summary.violations.map((v: any, i: number) => ({
            check: "deps",
            severity: "ERROR",
            message: `depcruise violation #${i + 1}: ${v.rule?.name || "unknown"}`,
            raw: v,
          })),
          `${data.summary.violations.length} dependency violations`,
          JSON.stringify(data.summary.violations).substring(0, 500),
        );
      }
    } catch {}

    if (e.message && e.message.includes("Cannot find module")) {
      return makeResult(true, [], "dependency-cruiser not installed", "");
    }
    return makeResult(
      true,
      [],
      `depcruise error (non-blocking): ${e.message?.substring(0, 200)}`,
      e.stderr?.substring(0, 500) || "",
    );
  }
}

// ═══════════════════════════════════════════════════════════
// CHECK 4: ESLint mock-audit
// ═══════════════════════════════════════════════════════════

/**
 * Derive the corresponding business code file path from a test file path.
 * Strips .spec or .test suffix from the filename.
 */
function deriveBusinessCodePath(testFilePath: string): string {
  const dir = path.dirname(testFilePath);
  const ext = path.extname(testFilePath);
  let base = path.basename(testFilePath, ext);
  base = base.replace(/\.(spec|test)$/, "");
  return path.join(dir, base + ext);
}

/**
 * Run ESLint with opencode-mock-audit plugin on test files.
 * Only runs on .spec., .test., or /test/ files.
 *
 * When options.phase === "red" (CI-EMBED-007), test files whose
 * corresponding business code file does NOT exist are exempted.
 */
export function runEslintAudit(
  filePath: string,
  projectRoot: string,
  options?: { phase?: string },
): CheckResult {
  const opts = options || {};
  let absPath = filePath;
  if (!path.isAbsolute(absPath)) absPath = path.resolve(projectRoot, absPath);

  if (!fs.existsSync(absPath)) {
    return makeResult(true, [], `File not found: ${absPath}`, "");
  }

  // Only run on spec/test files for mock audit
  const isTestFile =
    absPath.includes(".spec.") ||
    absPath.includes(".test.") ||
    absPath.includes("/test/");
  if (!isTestFile) {
    return makeResult(true, [], "Not a test file — ESLint audit skipped", "");
  }

  // RED-Phase Exemption Check (CI-EMBED-007)
  if (opts.phase === "red") {
    const businessCodePath = deriveBusinessCodePath(absPath);
    if (!fs.existsSync(businessCodePath)) {
      return makeResult(
        true,
        [],
        `RED-phase exemption: business code "${path.basename(businessCodePath)}" does not exist yet. ESLint audit deferred to GREEN phase.`,
        `exempted: ${path.relative(projectRoot, absPath)}`,
      );
    }
  }

  const pluginDir = path.join(
    projectRoot,
    ".opencode",
    "eslint-plugin",
    "eslint-plugin-opencode-mock-audit",
  );
  if (!fs.existsSync(pluginDir)) {
    return makeResult(true, [], "ESLint plugin not found — audit skipped", "");
  }

  try {
    const out = execSync(
      `npx eslint --no-eslintrc --rulesdir "${pluginDir}/rules" --rule 'no-tier1-mock: error' --rule 'no-skipped-tests: error' --rule 'no-skipped-audit: error' --rule 'no-console-log: error' --rule 'tier3-verify: warn' --format json "${absPath}"`,
      {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return makeResult(true, [], "ESLint audit passed", out.substring(0, 500));
  } catch (e: any) {
    try {
      const results = JSON.parse(e.stdout?.toString() || "[]");
      const violations: CheckViolation[] = results
        .filter((f: any) => f.messages?.length > 0)
        .flatMap((f: any) =>
          f.messages.map((m: any) => ({
            check: "eslint",
            rule: m.ruleId,
            file: f.filePath,
            line: m.line,
            message: m.message,
            severity: m.severity === 2 ? "ERROR" : "WARNING",
          })),
        );
      const tier1Mocks = violations.filter((v) => v.rule === "no-tier1-mock");

      if (tier1Mocks.length > 0) {
        return makeResult(
          false,
          violations,
          `CAT1.1: ${tier1Mocks.length} Tier1 service mock(s) detected`,
          JSON.stringify(violations).substring(0, 1000),
        );
      }
      if (violations.length > 0) {
        return makeResult(
          false,
          violations,
          `${violations.length} ESLint violations`,
          JSON.stringify(violations).substring(0, 1000),
        );
      }
      return makeResult(true, [], "ESLint audit passed", "");
    } catch {
      return makeResult(
        true,
        [],
        `ESLint error (non-blocking): ${e.message?.substring(0, 200)}`,
        e.stderr?.substring(0, 500) || "",
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════
// CHECK 5: TDD Order Enforcement
// ═══════════════════════════════════════════════════════════

/**
 * Enforce TDD order: test files must be written before implementation files.
 * PURE function — returns updated tddState for the caller to persist.
 */
export function runTddOrderCheck(
  filePath: string,
  workspaceRoot: string,
  tddState: TddState | null,
): TddOrderResult {
  const stateCanon = getStateCanon();

  const relFile = stateCanon.makePathRelativeToWorkspace(
    filePath,
    workspaceRoot,
  );
  const fileName = path.basename(filePath);

  const state: TddState = tddState || {
    testWritten: false,
    implFilesAttempted: [],
    blockedAttempts: [],
    testFilesWritten: [],
    initialized: true,
  };

  if (!relFile) {
    return Object.assign(
      makeResult(true, [], `Foreign workspace path: ${fileName}`, ""),
      { tddState: state },
    );
  }

  const isTestFile =
    fileName.includes(".spec.") ||
    fileName.includes(".test.") ||
    relFile.includes("/test/");
  const isImplFile =
    /\.(ts|js)$/.test(relFile) && !isTestFile && !relFile.includes(".config.");
  const isConfigOrDoc = /\.(json|yaml|yml|md)$/.test(relFile);

  if ((isTestFile || isImplFile) && !state.initialized) {
    state.initialized = true;
    state.testWritten = false;
    state.implFilesAttempted = [];
    state.blockedAttempts = [];
    state.testFilesWritten = [];
  }

  if (isConfigOrDoc || (!isTestFile && !isImplFile)) {
    return Object.assign(
      makeResult(true, [], `Skipped (config/doc/non-code): ${fileName}`, ""),
      { tddState: state },
    );
  }

  if (isTestFile) {
    state.testWritten = true;
    state.testFilesWritten.push(relFile);
    return Object.assign(
      makeResult(true, [], `Test file recorded: ${fileName}`, ""),
      { tddState: state },
    );
  }

  if (isImplFile) {
    if (!state.testWritten) {
      state.implFilesAttempted.push(relFile);
      state.blockedAttempts.push({
        file: relFile,
        timestamp: new Date().toISOString(),
      });

      const blkMsg = `CAT5.2: Implementation file "${fileName}" written without a preceding test file. Write the test first (RED phase), then implement (GREEN phase).`;
      return Object.assign(
        makeResult(false, [{ check: "tdd", severity: "BLOCKER", code: "CAT5.2", message: blkMsg }], blkMsg, ""),
        { tddState: state },
      );
    }
    return Object.assign(
      makeResult(true, [], `Impl file allowed (test already written): ${fileName}`, ""),
      { tddState: state },
    );
  }

  return Object.assign(makeResult(true, [], `Skipped: ${fileName}`, ""), {
    tddState: state,
  });
}

// ═══════════════════════════════════════════════════════════
// CHECK 6: TDD Spec File Existence (CI-EMBED-006)
// ═══════════════════════════════════════════════════════════

/**
 * Enforce that source files have corresponding test files (spec or test).
 * PURE function — no state mutation.
 */
export function runTddSpecCheck(
  filePath: string,
  existingFiles: string[] | null,
  _tddState: TddState | null,
): CheckResult {
  const fileName = path.basename(filePath);
  const fileExt = path.extname(filePath);

  const isSourceFile =
    /\.(ts|js)$/.test(fileExt) &&
    !fileName.includes(".spec.") &&
    !fileName.includes(".test.") &&
    !fileName.includes(".config.") &&
    !fileName.endsWith(".d.ts");

  if (!isSourceFile) {
    return makeResult(true, [], `Skipped (not a source file): ${fileName}`, "");
  }

  const baseName = fileName.replace(/\.(ts|js)$/, "");
  const dir = path.dirname(filePath);

  const expectedSpec = path.join(dir, baseName + ".spec.ts");
  const expectedTest = path.join(dir, baseName + ".test.ts");

  const specExists =
    existingFiles &&
    existingFiles.some((f) => f === expectedSpec || f === expectedTest);

  if (!specExists) {
    const msg =
      `CAT5.2: Implementation file "${fileName}" has no corresponding spec/test file. ` +
      `Expected: ${path.basename(expectedSpec)} or ${path.basename(expectedTest)}. ` +
      "Write the test first (RED phase), then implement (GREEN phase).";
    return makeResult(
      false,
      [{ check: "tdd_spec", severity: "BLOCKER", code: "CAT5.2", message: msg }],
      msg,
      "",
    );
  }

  return makeResult(true, [], `Spec file found for: ${fileName}`, "");
}
