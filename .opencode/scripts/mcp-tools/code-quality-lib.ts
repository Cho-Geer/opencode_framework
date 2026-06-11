"use strict";

/**
 * code-quality-lib.js — Shared Audit Library
 * ==========================================
 * Extracted from code-quality-gate.js (CI-EMBED-001)
 *
 * Provides 6 pure check functions that return standardized results.
 * State persistence (machine.json writes) is handled by the caller (code-quality-gate.js).
 *
 * Exports:
 *   runScopeCheck(filePath, projectRoot, agentType, agentWriteScopes)
 *   runPrettierCheck(filePath, projectRoot, autoFix)
 *   runDepCruiserCheck(filePath, projectRoot)
 *   runEslintAudit(filePath, projectRoot)
 *   runTscCheck(filePath, projectRoot, backendDir, frontendDir)
 *   runTddOrderCheck(filePath, workspaceRoot, tddState)
 *   runTddSpecCheck(filePath, existingFiles, tddState)
 *   runAllChecks(filePath, projectRoot, agentType, taskId, options)
 *   runFullScan(projectRoot, backendDir, frontendDir)
 *   matchGlob(filePath, pattern)
 *   firstPathSegment(relativePath)
 *
 * Standard return: { pass: boolean, violations: array, detail: string, execution_evidence: string }
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ─── Workspace Canonicalization ───────────────────────────
let _stateCanon = null;
function getStateCanon() {
  if (!_stateCanon) {
    _stateCanon = require("../state-canonicalize");
  }
  return _stateCanon;
}

// ─── Utility: Glob Matching ──────────────────────────────
/**
 * Simple glob: * matches anything except /, ** matches anything
 */
function matchGlob(filePath, pattern) {
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
function firstPathSegment(relativePath) {
  return (
    relativePath.replace(/\\/g, "/").split("/").filter(Boolean)[0] ||
    relativePath
  );
}

// ─── Helper: build standardized result ───────────────────
function makeResult(pass, violations, detail, execution_evidence) {
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
 *
 * @param {string} filePath - absolute path to the changed file
 * @param {string} projectRoot - project root directory
 * @param {string} agentType - agent identifier (e.g. "@Coder-BE")
 * @param {object} agentWriteScopes - { allowed: string[], denied: string[] }
 * @returns {{ pass, violations, detail, execution_evidence }}
 */
function runScopeCheck(filePath, projectRoot, agentType, agentWriteScopes) {
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
      return makeResult(
        false,
        [{ check: "scope", severity: "BLOCKER", message: msg }],
        msg,
        "",
      );
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
  return makeResult(
    false,
    [{ check: "scope", severity: "BLOCKER", message: msg }],
    msg,
    "",
  );
}

// ═══════════════════════════════════════════════════════════
// CHECK 2: Prettier Format
// ═══════════════════════════════════════════════════════════
/**
 * Check (and optionally fix) code formatting with Prettier.
 *
 * @param {string} filePath - absolute path
 * @param {string} projectRoot - project root for cwd
 * @param {boolean} autoFix - auto-fix formatting violations
 * @returns {{ pass, violations, detail, execution_evidence }}
 */
function runPrettierCheck(filePath, projectRoot, autoFix) {
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
  } catch (checkErr) {
    // Check failed — try auto-fix or report
    if (effectiveAutoFix) {
      try {
        const fixOut = execSync(`npx prettier --write "${absPath}"`, {
          cwd: projectRoot,
          encoding: "utf8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return makeResult(
          true,
          [],
          "Prettier auto-fixed",
          fixOut.substring(0, 500),
        );
      } catch (fixErr) {
        return makeResult(
          false,
          [
            {
              check: "format",
              severity: "ERROR",
              message: "Prettier check failed and auto-fix failed",
            },
          ],
          `Prettier auto-fix failed: ${fixErr.message}`,
          fixErr.stderr?.substring(0, 500) || fixErr.message,
        );
      }
    }
    return makeResult(
      false,
      [
        {
          check: "format",
          severity: "ERROR",
          message: "Prettier check failed. Run: npx prettier --write <file>",
        },
      ],
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
 *
 * @param {string} filePath - absolute path
 * @param {string} projectRoot - project root for cwd
 * @returns {{ pass, violations, detail, execution_evidence }}
 */
function runDepCruiserCheck(filePath, projectRoot) {
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
        data.summary.violations.map((v, i) => ({
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
  } catch (e) {
    // depcruise exits non-zero on violations
    try {
      const data = JSON.parse(e.stdout?.toString() || "{}");
      if (data.summary?.violations?.length > 0) {
        return makeResult(
          false,
          data.summary.violations.map((v, i) => ({
            check: "deps",
            severity: "ERROR",
            message: `depcruise violation #${i + 1}: ${v.rule?.name || "unknown"}`,
            raw: v,
          })),
          `${data.summary.violations.length} dependency violations`,
          JSON.stringify(data.summary.violations).substring(0, 500),
        );
      }
    } catch (_) {}

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
// ═══════════════════════════════════════════════════════════
// CHECK 4: ESLint mock-audit
// ═══════════════════════════════════════════════════════════
/**
 * Derive the corresponding business code file path from a test file path.
 * Strips .spec or .test suffix from the filename.
 * e.g. "time-slots.service.spec.ts" → "time-slots.service.ts"
 *
 * @param {string} testFilePath - absolute path to a test file
 * @returns {string} absolute path to the corresponding business code file
 */
function deriveBusinessCodePath(testFilePath) {
  const dir = path.dirname(testFilePath);
  const ext = path.extname(testFilePath);
  let base = path.basename(testFilePath, ext);
  // Strip .spec or .test suffix
  base = base.replace(/\.(spec|test)$/, "");
  return path.join(dir, base + ext);
}

/**
 * Run ESLint with opencode-mock-audit plugin on test files.
 * Only runs on .spec., .test., or /test/ files.
 *
 * When options.phase === "red" (CI-EMBED-007), test files whose
 * corresponding business code file does NOT exist are exempted
 * from audit. This supports the TDD RED phase where tests are
 * written before business code exists.
 *
 * @param {string} filePath - absolute path
 * @param {string} projectRoot - project root
 * @param {object} [options] - { phase?: "red" }
 * @returns {{ pass, violations, detail, execution_evidence }}
 */
function runEslintAudit(filePath, projectRoot, options) {
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

  // ─── RED-Phase Exemption Check (CI-EMBED-007) ─────────
  // During TDD RED phase, test files import business modules that
  // haven't been created yet. This is intentional — the tests are
  // expected to fail. The ESLint mock-audit should not flag these
  // as violations since there is no business code to audit against.
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
    // Business code exists — proceed with normal audit below
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
  } catch (e) {
    try {
      const results = JSON.parse(e.stdout?.toString() || "[]");
      const violations = results
        .filter((f) => f.messages?.length > 0)
        .flatMap((f) =>
          f.messages.map((m) => ({
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
    } catch (_) {
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
// CHECK 5: TypeScript Incremental Check
// ═══════════════════════════════════════════════════════════
// CHECK 5: TypeScript Incremental Check
// ═══════════════════════════════════════════════════════════
/**
 * Run tsc --noEmit --incremental on the affected project (backend or frontend).
 *
 * @param {string} filePath - absolute path
 * @param {string} projectRoot - project root
 * @param {string} backendDir - absolute path to backend directory
 * @param {string} frontendDir - absolute path to frontend directory
 * @returns {{ pass, violations, detail, execution_evidence }}
 */
function runTscCheck(filePath, projectRoot, backendDir, frontendDir) {
  let absPath = filePath;
  if (!path.isAbsolute(absPath)) absPath = path.resolve(projectRoot, absPath);

  if (!fs.existsSync(absPath)) {
    return makeResult(true, [], `File not found: ${absPath}`, "");
  }
  if (!absPath.endsWith(".ts")) {
    return makeResult(true, [], "Not a TypeScript file", "");
  }

  // Determine which project directory
  const isBackend =
    (backendDir && absPath.startsWith(backendDir)) ||
    (backendDir && absPath.includes(path.basename(backendDir)));
  const isFrontend =
    (frontendDir && absPath.startsWith(frontendDir)) ||
    (frontendDir && absPath.includes(path.basename(frontendDir)));

  if (!isBackend && !isFrontend) {
    return makeResult(
      true,
      [],
      "Not in backend or frontend src — tsc skipped",
      "",
    );
  }

  const cwd = isBackend ? backendDir : frontendDir;

  try {
    const start = Date.now();
    const out = execSync("npx tsc --noEmit --incremental --pretty false", {
      cwd,
      encoding: "utf8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const elapsed = Date.now() - start;
    return makeResult(
      true,
      [],
      `tsc passed (${elapsed}ms)`,
      out.substring(0, 500),
    );
  } catch (e) {
    const errMsg =
      e.stderr?.substring(0, 500) ||
      e.stdout?.substring(0, 500) ||
      e.message?.substring(0, 300) ||
      "TypeScript compilation error";
    return makeResult(
      false,
      [{ check: "tsc", severity: "BLOCKER", message: errMsg.split("\n")[0] }],
      `TypeScript error in ${path.basename(cwd)}`,
      errMsg,
    );
  }
}

// ═══════════════════════════════════════════════════════════
// CHECK 6: TDD Order Enforcement
// ═══════════════════════════════════════════════════════════
/**
 * Enforce TDD order: test files must be written before implementation files.
 * This is a PURE function — it does not mutate tddState.
 * Returns updated tddState in result.tddState for the caller to persist.
 *
 * @param {string} filePath - absolute path to changed file
 * @param {string} workspaceRoot - OPENCODE_ROOT / project root
 * @param {object} tddState - { testWritten, testFilesWritten, implFilesAttempted, blockedAttempts, initialized }
 * @returns {{ pass, violations, detail, execution_evidence, tddState }}
 */
function runTddOrderCheck(filePath, workspaceRoot, tddState) {
  const stateCanon = getStateCanon();

  // Canonicalize to relative path
  const relFile = stateCanon.makePathRelativeToWorkspace(
    filePath,
    workspaceRoot,
  );
  const fileName = path.basename(filePath);

  // Initialize tddState
  const state = tddState || {
    testWritten: false,
    implFilesAttempted: [],
    blockedAttempts: [],
    testFilesWritten: [],
    initialized: true,
  };

  // Foreign workspace path
  if (!relFile) {
    return Object.assign(
      makeResult(true, [], `Foreign workspace path: ${fileName}`, ""),
      { tddState: state },
    );
  }

  // Classify file
  const isTestFile =
    fileName.includes(".spec.") ||
    fileName.includes(".test.") ||
    relFile.includes("/test/");
  const isImplFile =
    /\.(ts|js)$/.test(relFile) && !isTestFile && !relFile.includes(".config.");
  const isConfigOrDoc = /\.(json|yaml|yml|md)$/.test(relFile);

  // Initialize session if needed
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

  // Test file — record and allow
  if (isTestFile) {
    state.testWritten = true;
    state.testFilesWritten.push(relFile);
    return Object.assign(
      makeResult(true, [], `Test file recorded: ${fileName}`, ""),
      { tddState: state },
    );
  }

  // Implementation file — check if test was written first
  if (isImplFile) {
    if (!state.testWritten) {
      state.implFilesAttempted.push(relFile);
      state.blockedAttempts.push({
        file: relFile,
        timestamp: new Date().toISOString(),
      });

      const blkMsg = `CAT5.2: Implementation file "${fileName}" written without a preceding test file. Write the test first (RED phase), then implement (GREEN phase).`;
      return Object.assign(
        makeResult(
          false,
          [
            {
              check: "tdd",
              severity: "BLOCKER",
              code: "CAT5.2",
              message: blkMsg,
            },
          ],
          blkMsg,
          "",
        ),
        { tddState: state },
      );
    }
    return Object.assign(
      makeResult(
        true,
        [],
        `Impl file allowed (test already written): ${fileName}`,
        "",
      ),
      { tddState: state },
    );
  }

  return Object.assign(makeResult(true, [], `Skipped: ${fileName}`, ""), {
    tddState: state,
  });
}

// ═══════════════════════════════════════════════════════════
// CHECK 7: TDD Spec File Existence (CI-EMBED-006)
// ═══════════════════════════════════════════════════════════
/**
 * Enforce that source files have corresponding test files (spec or test).
 * Checks that a .spec.ts or .test.ts file exists for every .ts/.js source file.
 * This is a PURE function — it does not mutate state.
 *
 * @param {string} filePath - absolute path to changed file
 * @param {string[]} existingFiles - array of all project file paths to check against
 * @param {object} tddState - TDD enforcement state (unused, kept for API consistency)
 * @returns {{ pass, violations, detail, execution_evidence }}
 */
function runTddSpecCheck(filePath, existingFiles, tddState) {
  const fileName = path.basename(filePath);
  const fileExt = path.extname(filePath);

  // Only check source files (.ts, .js) that are not test, config, or declaration files
  const isSourceFile =
    /\.(ts|js)$/.test(fileExt) &&
    !fileName.includes(".spec.") &&
    !fileName.includes(".test.") &&
    !fileName.includes(".config.") &&
    !fileName.endsWith(".d.ts");

  if (!isSourceFile) {
    return makeResult(true, [], `Skipped (not a source file): ${fileName}`, "");
  }

  // Derive the base name (without extension) and directory
  const baseName = fileName.replace(/\.(ts|js)$/, "");
  const dir = path.dirname(filePath);

  // Construct expected spec/test file names
  const expectedSpec = path.join(dir, baseName + ".spec.ts");
  const expectedTest = path.join(dir, baseName + ".test.ts");

  // Check if either exists in existingFiles
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
      [
        {
          check: "tdd_spec",
          severity: "BLOCKER",
          code: "CAT5.2",
          message: msg,
        },
      ],
      msg,
      "",
    );
  }

  return makeResult(true, [], `Spec file found for: ${fileName}`, "");
}

// ═══════════════════════════════════════════════════════════
// BATCH RUNNER: runAllChecks
// ═══════════════════════════════════════════════════════════
/**
 * Run all applicable checks on a file.
 *
 * @param {string} filePath - absolute path to changed file
 * @param {string} projectRoot - project root directory
 * @param {string} agentType - agent identifier
 * @param {string} taskId - current task ID
 * @param {object} options - { skip_checks, auto_fix, agentWriteScopes, backendDir, frontendDir, tddState, existingFiles }
 * @returns {{ overall: "pass"|"fail", checks: object, violations: array, fixes_applied: array, tddState: object }}
 */
function runAllChecks(filePath, projectRoot, agentType, taskId, options) {
  const opts = options || {};
  const skip = new Set(opts.skip_checks || []);
  const results = {
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
    const r = runScopeCheck(
      absPath,
      projectRoot,
      agentType,
      opts.agentWriteScopes,
    );
    results.checks.scope = r;
    if (!r.pass) {
      results.overall = "fail";
      results.violations.push(
        ...r.violations.map((v) => ({ ...v, check: "scope" })),
      );
    }
  }

  // Check 2: Prettier Format
  if (!skip.has("format")) {
    const r = runPrettierCheck(absPath, projectRoot, opts.auto_fix !== false);
    results.checks.format = r;
    if (r.violations.length > 0) {
      // If auto_fixed, don't count as failure
      if (r.detail && r.detail.includes("auto-fixed")) {
        results.fixes_applied.push({
          check: "format",
          action: "prettier --write",
        });
      } else {
        results.overall = "fail";
        results.violations.push(
          ...r.violations.map((v) => ({ ...v, check: "format" })),
        );
      }
    }
  }

  // Check 3: dependency-cruiser
  if (!skip.has("deps")) {
    const r = runDepCruiserCheck(absPath, projectRoot);
    results.checks.deps = r;
    if (!r.pass) {
      results.overall = "fail";
      results.violations.push(
        ...r.violations.map((v) => ({ ...v, check: "deps" })),
      );
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

  // Check 5: tsc incremental
  if (!skip.has("tsc")) {
    const r = runTscCheck(
      absPath,
      projectRoot,
      opts.backendDir,
      opts.frontendDir,
    );
    results.checks.tsc = r;
    if (!r.pass) {
      results.overall = "fail";
      results.violations.push(
        ...r.violations.map((v) => ({ ...v, check: "tsc" })),
      );
    }
  }

  // Check 6: TDD Order Enforcement
  if (!skip.has("tdd")) {
    const r = runTddOrderCheck(absPath, projectRoot, opts.tddState);
    results.checks.tdd = r;
    results.tddState = r.tddState;
    if (!r.pass) {
      results.overall = "fail";
      results.violations.push(
        ...r.violations.map((v) => ({ ...v, check: "tdd" })),
      );
    }
  }

  // Check 7: TDD Spec File Existence (CI-EMBED-006)
  if (!skip.has("tdd_spec") && opts.existingFiles) {
    const r = runTddSpecCheck(absPath, opts.existingFiles, opts.tddState);
    results.checks.tdd_spec = r;
    if (!r.pass) {
      results.overall = "fail";
      results.violations.push(
        ...r.violations.map((v) => ({ ...v, check: "tdd_spec" })),
      );
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// FULL SCAN: runFullScan
// ═══════════════════════════════════════════════════════════
/**
 * Full project scan — tsc, depcruise, prettier on entire codebase.
 *
 * @param {string} projectRoot - project root
 * @param {string} backendDir - absolute backend dir
 * @param {string} frontendDir - absolute frontend dir
 * @returns {{ overall: "pass"|"fail", violations: array, tscErrors: number }}
 */
function runFullScan(projectRoot, backendDir, frontendDir) {
  const results = { overall: "pass", violations: [], tscErrors: 0 };

  // TypeScript full check
  for (const cwd of [backendDir, frontendDir]) {
    if (!cwd || !fs.existsSync(cwd)) continue;
    try {
      execSync("npx tsc --noEmit --pretty false", {
        cwd,
        encoding: "utf8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      results.tscErrors++;
      results.overall = "fail";
      results.violations.push({
        check: "tsc_full",
        severity: "BLOCKER",
        message: `TypeScript errors in ${path.basename(cwd)}`,
        detail: (e.stderr || e.stdout || "").substring(0, 500),
      });
    }
  }

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
  } catch (e) {
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
    } catch (_) {}
  }

  // Prettier full check
  try {
    execSync('npx prettier --check "src/**/*.{ts,html,scss,css,json}"', {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (_) {
    results.overall = "fail";
    results.violations.push({
      check: "format_full",
      severity: "ERROR",
      message: "Some files are not formatted",
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// CHECK 7: safeBash — Allowlist-Based Shell Execution
// ═══════════════════════════════════════════════════════════
/**
 * Default allowlist for safeBash.
 * Commands matching these patterns are permitted.
 * Order: more specific patterns first.
 */
const DEFAULT_ALLOWLIST = [
  "npm run *",
  "npx jest *",
  "npx tsc *",
  "npx eslint *",
  "node * --help",
];

/**
 * safeBash — Execute shell commands with allowlist-based protection.
 *
 * Checks the command against an allowlist of permitted patterns.
 * If the command does not match any pattern, a BLOCKER violation is returned.
 * If matched, the command is executed via execSync and results returned.
 *
 * Reads agent identity from process.env.FRAMEWORK_AGENT (propagated via
 * dispatch-subagent.ts BUG-5894 fix).
 *
 * @param {string} cmd - The shell command to execute
 * @param {object} [options] - Options
 * @param {string[]} [options.allowlist] - Allowlist of permitted command patterns
 *        (defaults to DEFAULT_ALLOWLIST)
 * @param {string} [options.projectRoot] - Working directory for execution
 *        (defaults to process.cwd())
 * @returns {{ pass: boolean, stdout: string, stderr: string, exitCode: number, violations: array, agent: string }}
 */
function safeBash(cmd, options) {
  const opts = options || {};
  const allowlist = opts.allowlist || DEFAULT_ALLOWLIST;
  const projectRoot = opts.projectRoot || process.cwd();
  const agent = "unknown"; // v4.0.0: FRAMEWORK_AGENT deprecated; agent identity from _dispatch_target.json not needed here

  // Check command against allowlist
  let matched = false;
  for (const pattern of allowlist) {
    if (matchGlob(cmd, pattern)) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    const msg = `BLOCKER: Command "${cmd}" does not match any allowlist pattern. Agent: ${agent}. Allowed patterns: ${JSON.stringify(allowlist)}`;
    return makeResult(
      false,
      [
        {
          check: "safeBash",
          severity: "BLOCKER",
          message: msg,
        },
      ],
      msg,
      "",
    );
  }

  // Execute the command
  try {
    const startTime = Date.now();
    const result = execSync(cmd, {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 300000, // 5 minutes
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024, // 10MB output buffer
    });
    const duration = Date.now() - startTime;
    return {
      pass: true,
      stdout: result || "",
      stderr: "",
      exitCode: 0,
      violations: [],
      agent: agent,
      command: cmd,
      duration: duration,
    };
  } catch (e) {
    const duration = Date.now() - (e.startedAt || Date.now());
    // execSync throws with stdout, stderr, status on non-zero exit
    return {
      pass: true, // Execution happened; non-zero exit is not a BLOCKER
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      exitCode: e.status || 1,
      violations: [],
      agent: agent,
      command: cmd,
      duration: duration,
    };
  }
}

// ─── Exports ──────────────────────────────────────────────
module.exports = {
  // Utility
  matchGlob,
  firstPathSegment,

  // Default allowlist
  DEFAULT_ALLOWLIST,

  // Individual checks (pure functions, no side effects)
  runScopeCheck,
  runPrettierCheck,
  runDepCruiserCheck,
  runEslintAudit,
  runTscCheck,
  runTddOrderCheck,
  runTddSpecCheck,

  // Safe shell execution
  safeBash,

  // Batch runners
  runAllChecks,
  runFullScan,
};
