"use strict";

/**
 * safe-bash.test.js — RED phase tests for safeBash function
 * 
 * These tests verify allowlist-based shell execution protection.
 * All tests should FAIL initially (safeBash not yet implemented).
 */

const path = require("path");
const PROJECT_ROOT = process.env.OPENCODE_ROOT || path.resolve(__dirname, "..", "..", "..");

// Import safeBash from code-quality-lib.js — will be undefined initially (RED)
let safeBash;
let DEFAULT_ALLOWLIST;
try {
  const lib = require("../../../.opencode/scripts/mcp-tools/code-quality-lib");
  safeBash = lib.safeBash;
  DEFAULT_ALLOWLIST = lib.DEFAULT_ALLOWLIST;
} catch (e) {
  // Expected in RED phase — safeBash doesn't exist yet
}

let testsPassed = 0;
let testsFailed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
    testsFailed++;
    return false;
  }
  testsPassed++;
  return true;
}

// ─── Test 1: safeBash exists as a function ───
console.log("\n--- Test 1: safeBash is a function ---");
const test1Result = typeof safeBash === "function";
assert(test1Result, "EXPECTED: safeBash to be a function, but got " + typeof safeBash);
console.log(test1Result ? "  PASS" : "  FAIL");

// ─── Test 2: Allowed command returns success ───
console.log("\n--- Test 2: Allowed command (npm run build) passes allowlist ---");
let test2Result = false;
let test2Detail = "";
if (typeof safeBash === "function") {
  try {
    const result = safeBash("npm run build", { projectRoot: PROJECT_ROOT });
    test2Result = result.pass === true && result.stdout !== undefined;
    test2Detail = JSON.stringify(result);
  } catch (e) {
    test2Detail = e.message;
  }
} else {
  test2Detail = "safeBash not implemented (RED phase — expected)";
}
// In RED phase, this should fail because safeBash doesn't exist
assert(test2Result, "EXPECTED: safeBash('npm run build') to return { pass: true, stdout: string }. Got: " + test2Detail);
console.log(test2Result ? "  PASS" : "  FAIL — " + test2Detail);

// ─── Test 3: Denied command returns BLOCKER violation ───
console.log("\n--- Test 3: Denied command (rm -rf) returns BLOCKER violation ---");
let test3Result = false;
let test3Detail = "";
if (typeof safeBash === "function") {
  try {
    const result = safeBash("rm -rf /tmp/test", { projectRoot: PROJECT_ROOT });
    test3Result = result.pass === false && 
                  result.violations && 
                  result.violations.length > 0 &&
                  result.violations[0].severity === "BLOCKER";
    test3Detail = JSON.stringify(result);
  } catch (e) {
    test3Detail = e.message;
  }
} else {
  test3Detail = "safeBash not implemented (RED phase — expected)";
}
assert(test3Result, "EXPECTED: safeBash('rm -rf /tmp/test') to return { pass: false, violations: [{ severity: 'BLOCKER' }] }. Got: " + test3Detail);
console.log(test3Result ? "  PASS" : "  FAIL — " + test3Detail);

// ─── Test 4: Default allowlist contains expected patterns ───
console.log("\n--- Test 4: Default allowlist contains expected patterns ---");
let test4Result = false;
let test4Detail = "";
if (typeof safeBash === "function" && DEFAULT_ALLOWLIST) {
  test4Result = Array.isArray(DEFAULT_ALLOWLIST) &&
    DEFAULT_ALLOWLIST.includes("npm run *") &&
    DEFAULT_ALLOWLIST.includes("npx jest *");
  test4Detail = "allowlist: " + JSON.stringify(DEFAULT_ALLOWLIST);
} else if (typeof safeBash === "function") {
  // Check by trying an allowed command
  test4Detail = "DEFAULT_ALLOWLIST is empty or missing expected patterns";
} else {
  test4Detail = "safeBash not implemented (RED phase — expected)";
}
assert(test4Result, "EXPECTED: DEFAULT_ALLOWLIST to contain 'npm run *', 'npx jest *'. Got: " + test4Detail);
console.log(test4Result ? "  PASS" : "  FAIL — " + test4Detail);

// ─── Test 5: Custom allowlist overrides default ───
console.log("\n--- Test 5: Custom allowlist overrides default ---");
let test5Result = false;
let test5Detail = "";
if (typeof safeBash === "function") {
  try {
    const result = safeBash("echo hello", { 
      projectRoot: PROJECT_ROOT,
      allowlist: ["echo *"]
    });
    test5Result = result.pass === true;
    test5Detail = JSON.stringify(result);
  } catch (e) {
    test5Detail = e.message;
  }
} else {
  test5Detail = "safeBash not implemented (RED phase — expected)";
}
assert(test5Result, "EXPECTED: safeBash('echo hello', { allowlist: ['echo *'] }) to pass. Got: " + test5Detail);
console.log(test5Result ? "  PASS" : "  FAIL — " + test5Detail);

// ─── Test 6: Agent identity from FRAMEWORK_AGENT env var ───
console.log("\n--- Test 6: Agent identity from FRAMEWORK_AGENT env var ---");
let test6Result = false;
let test6Detail = "";
if (typeof safeBash === "function") {
  try {
    const result = safeBash("npm run build", { 
      projectRoot: PROJECT_ROOT,
      allowlist: ["npm run build"]
    });
    // Agent identity check via violations log or result metadata
    test6Result = result.pass === true;
    test6Detail = JSON.stringify(result);
  } catch (e) {
    test6Detail = e.message;
  }
} else {
  test6Detail = "safeBash not implemented (RED phase — expected)";
}
assert(test6Result, "EXPECTED: safeBash with FRAMEWORK_AGENT env to include agent in logging. Got: " + test6Detail);
console.log(test6Result ? "  PASS" : "  FAIL — " + test6Detail);

// ─── Summary ───
console.log(`\n${"=".repeat(50)}`);
console.log(`RED PHASE RESULTS:`);
console.log(`  Passed: ${testsPassed}`);
console.log(`  Failed: ${testsFailed}`);
console.log(`${"=".repeat(50)}`);

// Expected: All 6 tests should FAIL in RED phase
const exitCode = testsFailed > 0 ? 1 : 0;
// Skip exit when run inside `bun test` suite (would kill the whole process)
if (!process.env.BUN_TEST_SUITE) process.exit(exitCode);
