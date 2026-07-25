"use strict";

/**
 * ts-build.test.js — Safe Bash API compatibility tests
 * =====================================================
 * Migrated from legacy framework-validation.cjs / code-quality-lib.js
 * safeBash implementation. The underlying logic now lives in
 * .opencode/lib/safe-bash-core.ts and .opencode/service/file-guard/*.
 * This file keeps the original test contract by importing the current
 * internals and exposing the legacy `safeBash(command, options)` shape.
 */

const path = require("path");
const { execSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

// Migrated from legacy .cjs/.js implementations to current TypeScript sources.
const {
  isAllowed,
  isDangerous,
  DEFAULT_ALLOWLIST,
} = require("../../lib/safe-bash-core");

/**
 * Legacy safeBash adapter — preserves the original test API
 * (`safeBash(command, { projectRoot, allowlist })` returning
 * `{ pass, violations, agent, command, stdout, stderr, exitCode }`)
 * while delegating validation to the current safe-bash-core internals.
 */
function safeBash(command, options = {}) {
  const agent = process.env.FRAMEWORK_AGENT || "unknown";
  const allowlist = options.allowlist || DEFAULT_ALLOWLIST;

  if (isDangerous(command)) {
    return {
      pass: false,
      violations: [{ severity: "BLOCKER", reason: "DANGEROUS_PATTERN" }],
      agent,
      command,
      stdout: "",
      stderr: "",
      exitCode: null,
    };
  }

  if (!isAllowed(command, allowlist)) {
    return {
      pass: false,
      violations: [{ severity: "BLOCKER", reason: "NOT_IN_ALLOWLIST" }],
      agent,
      command,
      stdout: "",
      stderr: "",
      exitCode: null,
    };
  }

  try {
    const stdout = execSync(command, {
      cwd: options.projectRoot || PROJECT_ROOT,
      encoding: "utf8",
      timeout: 30000,
    });
    return {
      pass: true,
      violations: [],
      agent,
      command,
      stdout,
      stderr: "",
      exitCode: 0,
    };
  } catch (err) {
    return {
      pass: false,
      violations: [],
      agent,
      command,
      stdout: err.stdout?.toString() || "",
      stderr: err.stderr?.toString() || err.message,
      exitCode: err.status ?? 1,
    };
  }
}

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
  test('"npm run lint" passes (matches default allowlist pattern "npm run *")', { timeout: 30000 }, () => {
    const result = safeBash("npm run lint", { projectRoot: PROJECT_ROOT });
    expect(result.pass).toBe(true);
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("violations");
    expect(result.violations).toHaveLength(0);
    expect(result).toHaveProperty("agent");
    expect(result).toHaveProperty("command", "npm run lint");
  });

  test("result shape contains all expected fields", { timeout: 30000 }, () => {
    const result = safeBash("npm run lint", { projectRoot: PROJECT_ROOT });
    expect(result).toMatchObject({
      pass: true,
      violations: [],
      agent: expect.any(String),
      command: "npm run lint",
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
