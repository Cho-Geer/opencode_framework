"use strict";

/**
 * ts-build.test.js — Build Staleness Tests for framework-validation.cjs
 * =====================================================================
 * ARCH-2-RED [P2]: Tests that framework-validation.cjs should have
 * a build timestamp check. If .ts source is newer than .cjs output,
 * warn about stale build.
 *
 * RED phase: All tests expected to FAIL because the build staleness
 * check has not been implemented yet in framework-validation.cjs.
 *
 * After GREEN phase:
 *   framework-validation.cjs should export a `checkBuildStaleness()`
 *   function that compares .ts source mtime vs .cjs output mtime.
 */

const path = require("path");
const fs = require("fs");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const CJS_PATH = path.join(PROJECT_ROOT, ".opencode", "lib", "framework-validation.cjs");
const TS_PATH = path.join(PROJECT_ROOT, ".opencode", "lib", "framework-validation.ts");

// =============================================================================
// Test 1: Implementation Existence
// =============================================================================
describe("safeBash implementation", () => {
  test("safeBash is a function", () => {
    expect(typeof safeBash).toBe("function");
  });

  test("DEFAULT_ALLOWLIST is a non-empty array", () => {
    expect(Array.isArray(DEFAULT_ALLOWLIST)).toBe(true);
    expect(DEFAULT_ALLOWLIST.length).toBeGreaterThan(0);
  });

  test("DEFAULT_ALLOWLIST contains expected patterns", () => {
    expect(DEFAULT_ALLOWLIST).toContain("npm run *");
    expect(DEFAULT_ALLOWLIST).toContain("npx jest *");
  });
});

// =============================================================================
// Test 2: Allowed command execution
// =============================================================================
describe("safeBash allowed commands", () => {
  test('"npm run build" passes (matches default allowlist pattern "npm run *")', () => {
    const result = safeBash("npm run build", { projectRoot: PROJECT_ROOT });
    expect(result.pass).toBe(true);
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("violations");
    expect(result.violations).toHaveLength(0);
    expect(result).toHaveProperty("agent");
    expect(result).toHaveProperty("command", "npm run build");
  });

  test("result shape contains all expected fields", () => {
    const result = safeBash("npm run build", { projectRoot: PROJECT_ROOT });
    expect(result).toMatchObject({
      pass: true,
      violations: [],
      agent: expect.any(String),
      command: "npm run build",
    });
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
    expect(result).toHaveProperty("exitCode");
  });
});

// =============================================================================
// Test 3: Dangerous command blocking
// =============================================================================
describe("safeBash dangerous command blocking", () => {
  test("'rm -rf /' is blocked with BLOCKER violation", () => {
    const result = safeBash("rm -rf /", { projectRoot: PROJECT_ROOT });
    expect(result.pass).toBe(false);
    expect(result.violations).toBeInstanceOf(Array);
    expect(result.violations.length).toBeGreaterThan(0);
    // At least one violation should be BLOCKER severity
    const hasBlocker = result.violations.some(
      (v) => v.severity === "BLOCKER"
    );
    expect(hasBlocker).toBe(true);
  });

  test("'rm -rf /tmp/test' is blocked", () => {
    const result = safeBash("rm -rf /tmp/test", { projectRoot: PROJECT_ROOT });
    expect(result.pass).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  test("'sudo rm -rf' is blocked", () => {
    const result = safeBash("sudo rm -rf /etc", { projectRoot: PROJECT_ROOT });
    expect(result.pass).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Test 4: Custom allowlist
// =============================================================================
describe("safeBash custom allowlist", () => {
  test("custom allowlist allows 'echo hello'", () => {
    const result = safeBash("echo hello", {
      projectRoot: PROJECT_ROOT,
      allowlist: ["echo *"],
    });
    expect(result.pass).toBe(true);
    expect(result.stdout).toBe("hello\n");
  });

  test("custom allowlist blocks unlisted command", () => {
    const result = safeBash("curl http://example.com", {
      projectRoot: PROJECT_ROOT,
      allowlist: ["echo *"],
    });
    expect(result.pass).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  test("custom allowlist still blocks dangerous patterns", () => {
    const result = safeBash("rm -rf /", {
      projectRoot: PROJECT_ROOT,
      allowlist: ["rm *"],
    });
    // DANGEROUS_PATTERNS should still fire even with custom allowlist
    expect(result.pass).toBe(false);
    const hasBlocker = result.violations.some(
      (v) => v.severity === "BLOCKER"
    );
    expect(hasBlocker).toBe(true);
  });
});

// =============================================================================
// Test 5: Agent identity
// =============================================================================
describe("safeBash agent identity", () => {
  const ORIGINAL_AGENT = process.env.FRAMEWORK_AGENT;

  afterEach(() => {
    process.env.FRAMEWORK_AGENT = ORIGINAL_AGENT;
  });

  test("result contains agent from FRAMEWORK_AGENT env", () => {
    process.env.FRAMEWORK_AGENT = "@Coder-BE";
    const result = safeBash("npm run build", {
      projectRoot: PROJECT_ROOT,
      allowlist: ["npm run build"],
    });
    expect(result.agent).toBe("@Coder-BE");
  });

  test("result defaults to 'unknown' when FRAMEWORK_AGENT not set", () => {
    delete process.env.FRAMEWORK_AGENT;
    const result = safeBash("npm run build", {
      projectRoot: PROJECT_ROOT,
      allowlist: ["npm run build"],
    });
    expect(result.agent).toBe("unknown");
  });
});
