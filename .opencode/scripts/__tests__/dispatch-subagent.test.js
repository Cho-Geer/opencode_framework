/**
 * dispatch-subagent.test.js — RED phase tests for BUG-5894-ENV-PROPAGATE
 * =====================================================================
 *
 * Tests that FRAMEWORK_AGENT and FRAMEWORK_TASK_ID env vars are set by
 * dispatch-subagent.js before spawning child processes.
 *
 * RED phase expectation: ALL tests 1-3 MUST FAIL (env vars not yet set).
 * Test 4 should PASS (execSync env spread already exists).
 */

"use strict";

var assert = require("assert");
var execFileSync = require("child_process").execFileSync;
var path = require("path");
var fs = require("fs");

var SCRIPT = path.join(
  __dirname,
  "..",
  "command-tools",
  "dispatch-subagent.js",
);
var OPENCODE_ROOT = path.resolve(__dirname, "..", "..");

// --- Helper: run dispatch-subagent.js in child with positional task_id ---
function runAndCaptureEnvPositional(agentType, taskId, taskDesc) {
  // Pattern: node dispatch-subagent.js <agent_type> "<task_id>" "<task_description>"
  var argvItems = [JSON.stringify(agentType), JSON.stringify(taskId), JSON.stringify(taskDesc)];

  var childCode = [
    'var path = require("path");',
    "var script = " + JSON.stringify(SCRIPT) + ";",
    "var OPENCODE_ROOT = " + JSON.stringify(OPENCODE_ROOT) + ";",
    'process.argv = ["node", script, ' + argvItems.join(", ") + "];",
    "var origExit = process.exit;",
    "process.exit = function(c) { process.exitCode = c || 0; };",
    "try { require(script); } catch(e) { process.exitCode = 1; }",
    'console.log("ENVJSON:" + JSON.stringify({ FA: process.env.FRAMEWORK_AGENT, FT: process.env.FRAMEWORK_TASK_ID, FD: process.env.FRAMEWORK_DISPATCH_CONTEXT }));',
  ].join("\n");

  try {
    var stdout = execFileSync(process.execPath, ["-e", childCode], {
      env: Object.assign({}, process.env, { OPENCODE_ROOT: OPENCODE_ROOT }),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
  } catch (e) {
    if (e.stdout) {
      var stdout = e.stdout;
    } else {
      return { FA: null, FT: null, FD: null, error: e.message };
    }
  }

  // Find the ENVJSON line in stdout
  var lines = stdout.trim().split("\n");
  for (var i = lines.length - 1; i >= 0; i--) {
    if (lines[i].indexOf("ENVJSON:") === 0) {
      return JSON.parse(lines[i].slice(8));
    }
  }
  return { FA: null, FT: null, FD: null, error: "ENVJSON not found" };
}

// --- Test 1: FRAMEWORK_AGENT is set to agent type ---
(function testFrameworkAgent() {
  console.log("--- Test 1: FRAMEWORK_AGENT is set to agent type ---");
  var env = runAndCaptureEnv("Architect", "test task", "T-001");
  console.log("  FRAMEWORK_AGENT =", JSON.stringify(env.FA));
  console.log('  Expected:        "Architect"');
  // This assertion WILL FAIL — current code does not set FRAMEWORK_AGENT
  assert.strictEqual(
    env.FA,
    "Architect",
    'FRAMEWORK_AGENT should be "Architect" after dispatching',
  );
  console.log("  PASS");
})();

// --- Test 2: FRAMEWORK_TASK_ID is set to --task-id value ---
(function testFrameworkTaskId() {
  console.log("--- Test 2: FRAMEWORK_TASK_ID is set to --task-id value ---");
  var env = runAndCaptureEnv(
    "Architect",
    "test task",
    "BUG-5894-ENV-PROPAGATE",
  );
  console.log("  FRAMEWORK_TASK_ID =", JSON.stringify(env.FT));
  console.log('  Expected:         "BUG-5894-ENV-PROPAGATE"');
  // This assertion WILL FAIL — current code does not set FRAMEWORK_TASK_ID
  assert.strictEqual(
    env.FT,
    "BUG-5894-ENV-PROPAGATE",
    'FRAMEWORK_TASK_ID should be "BUG-5894-ENV-PROPAGATE"',
  );
  console.log("  PASS");
})();

// --- Test 3b: FRAMEWORK_TASK_ID is set from positional 2nd param (NEW) ---
(function testPositionalTaskId() {
  console.log("--- Test 3b: FRAMEWORK_TASK_ID set from positional param (NEW) ---");
  var env = runAndCaptureEnvPositional("Architect", "T-014", "implement booking");
  console.log("  FRAMEWORK_TASK_ID =", JSON.stringify(env.FT));
  console.log('  Expected:         "T-014"');
  assert.strictEqual(
    env.FT,
    "T-014",
    'FRAMEWORK_TASK_ID should be "T-014" from positional task_id param',
  );
  console.log("  FRAMEWORK_AGENT =", JSON.stringify(env.FA));
  console.log('  Expected:         "Architect"');
  assert.strictEqual(
    env.FA,
    "Architect",
    'FRAMEWORK_AGENT should be "Architect"',
  );
  console.log("  FRAMEWORK_DISPATCH_CONTEXT =", JSON.stringify(env.FD));
  console.log('  Expected:         "orchestrated"');
  assert.strictEqual(
    env.FD,
    "orchestrated",
    'FRAMEWORK_DISPATCH_CONTEXT should be "orchestrated"',
  );
  console.log("  PASS");
})();

// --- Test 3: FRAMEWORK_TASK_ID defaults to empty string ---
(function testTaskIdDefault() {
  console.log("--- Test 3: FRAMEWORK_TASK_ID defaults to empty string ---");
  var env = runAndCaptureEnv("Architect", "test task", null);
  console.log("  FRAMEWORK_TASK_ID =", JSON.stringify(env.FT));
  console.log('  Expected:         "" (empty string)');
  // This assertion WILL FAIL — current code does not set FRAMEWORK_TASK_ID at all
  assert.strictEqual(
    env.FT,
    "",
    "FRAMEWORK_TASK_ID should default to empty string",
  );
  console.log("  PASS");
})();

// --- Test 4: execSync env spread already exists in source ---
(function testEnvSpread() {
  console.log("--- Test 4: execSync uses env: { ...process.env } spread ---");
  var source = fs.readFileSync(SCRIPT, "utf8");
  var hasEnvSpread = source.indexOf("env: { ...process.env") !== -1;
  console.log("  env: { ...process.env } spread found:", hasEnvSpread);
  // This test SHOULD PASS — the spread pattern already exists at line 87
  assert.ok(hasEnvSpread, "execSync should use env: { ...process.env } spread");
  console.log("  PASS");
})();

// --- Summary ---
console.log("");
console.log("=== RED Phase Test Summary ===");
console.log("Tests 1-3 should FAIL (env vars not yet implemented)");
console.log("Test 3b should PASS (positional task_id param supported)");
console.log("Test 4 should PASS (env spread already exists)");
console.log("Expected exit code: 1 (non-zero = FAIL)");
