#!/usr/bin/env node
"use strict";

/**
 * framework-self-test.js — OpenCode Framework Binding Force Self-Test
 * ===================================================================
 * Validates 16 critical framework integrity checks.
 * Usage: node .opencode/scripts/framework-self-test.js
 *
 * Exit code: 0 if ALL 16 checks pass, 1 if any fail.
 */

const fs = require("fs");
const path = require("path");

// ─── Constants ────────────────────────────────────────────────
const OPENCODE_ROOT = path.resolve(__dirname, "..", "..");
const PROJECT_ROOT = OPENCODE_ROOT; // project_root is "."

const PASS = "PASS";
const FAIL = "FAIL";

let results = [];
let allPassed = true;

function check(name, passed, detail) {
  const status = passed ? PASS : FAIL;
  if (!passed) allPassed = false;
  const line = `[${status}] ${name}${detail ? " — " + detail : ""}`;
  results.push(line);
  console.log(line);
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function readFile(p) {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Check 1: config.json loads
// ═══════════════════════════════════════════════════════════════
function checkConfigJson() {
  const cfgPath = path.join(OPENCODE_ROOT, ".opencode", "project.config.json");
  const raw = readFile(cfgPath);
  if (!raw)
    return check(1, false, "project.config.json not found or unreadable");

  try {
    const cfg = JSON.parse(raw);
    const hasProjectRoot = !!cfg.project_root;
    const hasTechStack = !!cfg.tech_stack && typeof cfg.tech_stack === "object";
    const hasContext7Mapping =
      Array.isArray(cfg.context7_task_mapping) &&
      cfg.context7_task_mapping.length > 0;
    const hasAgentWriteScopes =
      !!cfg.agent_write_scopes && typeof cfg.agent_write_scopes === "object";

    const ok =
      hasProjectRoot &&
      hasTechStack &&
      hasContext7Mapping &&
      hasAgentWriteScopes;
    let detail = "";
    if (!hasProjectRoot) detail += " missing project_root";
    if (!hasTechStack) detail += " missing tech_stack";
    if (!hasContext7Mapping) detail += " missing context7_task_mapping";
    if (!hasAgentWriteScopes) detail += " missing agent_write_scopes";
    return check(
      1,
      ok,
      detail.trim() ||
        `project_root="${cfg.project_root}", tech_stack keys=${Object.keys(cfg.tech_stack).length}, context7_task_mapping=${cfg.context7_task_mapping.length}, agent_write_scopes keys=${Object.keys(cfg.agent_write_scopes).length}`,
    );
  } catch (e) {
    return check(1, false, `JSON parse error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Check 2: State directory exists
// ═══════════════════════════════════════════════════════════════
function checkStateDir() {
  const stateDir = path.join(OPENCODE_ROOT, ".opencode", "state");
  const files = [
    "machine.json",
    "gate-state.json",
    "project.config.schema.json",
  ];
  const missing = files.filter((f) => !fileExists(path.join(stateDir, f)));
  const ok = missing.length === 0;
  return check(
    2,
    ok,
    ok ? "All 3 files present" : `Missing: ${missing.join(", ")}`,
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 3: machine.json has all sub-states
// ═══════════════════════════════════════════════════════════════
function checkMachineSubStates() {
  const machPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "state",
    "machine.json",
  );
  const raw = readFile(machPath);
  if (!raw) return check(3, false, "machine.json not found");

  try {
    const m = JSON.parse(raw);
    const requiredKeys = [
      "eslint_state",
      "type_check_state",
      "dependency_state",
      "format_state",
      "write_audit_state",
      "compliance_records",
      "tdd_enforcement_state",
      "contracts",
      "keystone_hashes",
    ];
    const missing = requiredKeys.filter((k) => !(k in m));
    const ok = missing.length === 0;
    return check(
      3,
      ok,
      ok
        ? `All ${requiredKeys.length} sub-states present`
        : `Missing: ${missing.join(", ")}`,
    );
  } catch (e) {
    return check(3, false, `JSON parse error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Check 4: ESLint has 11 rules
// ═══════════════════════════════════════════════════════════════
function checkESLintRules() {
  const pluginPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "tools",
    "eslint-plugin-opencode-mock-audit",
    "index.js",
  );
  if (!fileExists(pluginPath))
    return check(4, false, "ESLint plugin index.js not found");

  try {
    const plugin = require(pluginPath);
    if (!plugin || !plugin.rules)
      return check(4, false, "Plugin does not export rules");
    const ruleCount = Object.keys(plugin.rules).length;
    const ok = ruleCount === 11;
    return check(
      4,
      ok,
      ok
        ? `Exactly 11 rules exported (count=${ruleCount})`
        : `Expected 11 rules but found ${ruleCount}`,
    );
  } catch (e) {
    return check(4, false, `Require error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Check 5: Pre-commit Layer 0 - exit 1 for compliance gate check
// ═══════════════════════════════════════════════════════════════
function checkPreCommitLayer0() {
  const hookPath = path.join(OPENCODE_ROOT, ".opencode", "hooks", "pre-commit");
  const content = readFile(hookPath);
  if (!content) return check(5, false, "pre-commit hook not found");

  // Layer 0 is the Compliance Gate Armed Check which uses exit 1
  const hasExit1 =
    content.includes("exit 1") && content.includes("compliance gate");
  const hasArmedCheck =
    content.includes("Layer 0") && content.includes("exit 1");
  const ok = hasExit1 && hasArmedCheck;
  return check(
    5,
    ok,
    ok
      ? "Layer 0 compliance gate check with exit 1 found"
      : "Missing compliance gate Layer 0 exit 1 enforcement",
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 6: Pre-commit Layer 2.5 - exit 1 for TDD violation (BLOCKING)
// ═══════════════════════════════════════════════════════════════
function checkPreCommitLayer25() {
  const hookPath = path.join(OPENCODE_ROOT, ".opencode", "hooks", "pre-commit");
  const content = readFile(hookPath);
  if (!content) return check(6, false, "pre-commit hook not found");

  // Layer 2.5 is TDD Order Pre-Check (BLOCKING) with exit 1
  const hasLayer25 = content.includes("Layer 2.5") && content.includes("TDD");
  const hasExit1 = content.includes("exit 1");
  const isBlocking =
    content.includes("BLOCKING") ||
    (content.includes("Layer 2.5") && content.includes("TDD Order Pre-Check"));
  const ok = hasLayer25 && hasExit1;
  return check(
    6,
    ok,
    ok
      ? "Layer 2.5 TDD violation check with exit 1 (BLOCKING) found"
      : "Missing TDD Layer 2.5 BLOCKING enforcement",
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 7: commit-msg TDD ordering
// ═══════════════════════════════════════════════════════════════
function checkCommitMsgTDD() {
  const hookPath = path.join(OPENCODE_ROOT, ".opencode", "hooks", "commit-msg");
  const content = readFile(hookPath);
  if (!content) return check(7, false, "commit-msg hook not found");

  // Must validate RED→GREEN→REFACTOR phase ordering
  const hasGreenCheck = content.includes("Green") && content.includes("[Red]");
  const hasRefactorCheck =
    content.includes("Refactor") && content.includes("[Green]");
  const hasExit1 =
    content.match(/exit 1/g) && content.match(/exit 1/g).length >= 2;
  const ok = hasGreenCheck && hasRefactorCheck && hasExit1;
  return check(
    7,
    ok,
    ok
      ? "RED→GREEN→REFACTOR phase ordering validation present"
      : "Missing TDD phase ordering check in commit-msg",
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 8: Agent skills clean (no Read/Write/Glob/Grep in skills)
// ═══════════════════════════════════════════════════════════════
function checkAgentSkillsClean() {
  const agentsDir = path.join(OPENCODE_ROOT, ".opencode", "agents");
  let dirEntries;
  try {
    dirEntries = fs.readdirSync(agentsDir);
  } catch {
    return check(8, false, "agents directory not found");
  }

  const agentFiles = dirEntries.filter((f) => f.endsWith(".md"));
  const forbidden = ["Read", "Write", "Glob", "Grep"];
  let violations = [];
  let totalSkills = 0;

  for (const af of agentFiles) {
    const content = readFile(path.join(agentsDir, af));
    if (!content) continue;

    // Extract skills list from YAML frontmatter
    const skillsMatch = content.match(/^skills:\n((?:\s+- .+\n)*)/m);
    if (!skillsMatch) continue;

    const skillsSection = skillsMatch[1];
    const skillNames = skillsSection.match(/^\s+-\s+(.+)$/gm) || [];
    totalSkills += skillNames.length;

    for (const s of skillNames) {
      const clean = s.replace(/^\s+-\s+/, "").trim();
      if (forbidden.includes(clean)) {
        violations.push(`${af}: ${clean}`);
      }
    }
  }

  const ok = violations.length === 0;
  return check(
    8,
    ok,
    ok
      ? `No forbidden skills across ${agentFiles.length} agents (${totalSkills} total skills)`
      : `Forbidden skills found: ${violations.join("; ")}`,
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 9: architect has code-quality-gate
// ═══════════════════════════════════════════════════════════════
function checkArchitectCQG() {
  const archPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "agents",
    "architect.md",
  );
  const content = readFile(archPath);
  if (!content) return check(9, false, "architect.md not found");

  const hasCQG = content.includes("code-quality-gate");
  return check(
    9,
    hasCQG,
    hasCQG
      ? "code-quality-gate found in architect.md mcp_tools"
      : "MISSING! code-quality-gate not in architect.md",
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 10: ci-cd-agent has explicit docker tools
// ═══════════════════════════════════════════════════════════════
function checkCICAgentDockerTools() {
  const cicdPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "agents",
    "ci-cd-agent.md",
  );
  const content = readFile(cicdPath);
  if (!content) return check(10, false, "ci-cd-agent.md not found");

  // Must have specific docker tool names (not just "Docker")
  const dockerToolNames = [
    "docker_list_containers",
    "docker_run_container",
    "docker_build_image",
    "docker_create_network",
    "docker_create_volume",
    "docker_fetch_container_logs",
    "docker_remove_container",
    "docker_remove_image",
    "docker_recreate_container",
    "docker_start_container",
    "docker_stop_container",
  ];

  const found = dockerToolNames.filter((t) => content.includes(t));
  // At least the core tools should be present
  const ok = found.length >= 3; // At least 3 specific docker tools
  const detail = ok
    ? `${found.length}/${dockerToolNames.length} docker tools found (${found.join(", ")})`
    : `Only ${found.length} docker tools found, expected specific tool names, not generic "Docker"`;
  return check(10, ok, detail);
}

// ═══════════════════════════════════════════════════════════════
// Check 11: AGENTS.md no backslashes
// ═══════════════════════════════════════════════════════════════
function checkAgentsNoBackslashes() {
  const agentsPath = path.join(OPENCODE_ROOT, "AGENTS.md");
  const content = readFile(agentsPath);
  if (!content) return check(11, false, "AGENTS.md not found");

  // Check for \.opencode\ patterns (backslash instead of forward slash)
  // On Linux, we look for literal backslash before dot
  const backslashPattern = /\\\\\.opencode\\\\/;
  // Also check for backslash-used-as-path-separator patterns
  const backslashPaths = content.match(/\.opencode\\/g);
  const ok = !backslashPaths || backslashPaths.length === 0;
  return check(
    11,
    ok,
    ok
      ? "No backslash patterns in AGENTS.md"
      : `Found ${backslashPaths.length} backslash patterns`,
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 12: Deployment doc exists
// ═══════════════════════════════════════════════════════════════
function checkDeploymentDoc() {
  const docPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "context",
    "requirements",
    "运维与部署设计文档.md",
  );
  const ok = fileExists(docPath);
  return check(12, ok, ok ? "运维与部署设计文档.md exists" : "MISSING");
}

// ═══════════════════════════════════════════════════════════════
// Check 13: PROJECT_REFERENCE.md no placeholders
// ═══════════════════════════════════════════════════════════════
function checkProjectRefNoPlaceholders() {
  const prPath = path.join(OPENCODE_ROOT, "PROJECT_REFERENCE.md");
  const content = readFile(prPath);
  if (!content) return check(13, false, "PROJECT_REFERENCE.md not found");

  const placeholderPattern = /\{placeholder\}/g;
  const matches = content.match(placeholderPattern);
  const ok = !matches || matches.length === 0;
  return check(
    13,
    ok,
    ok
      ? "No {placeholder} strings found"
      : `Found ${matches.length} {placeholder} instances`,
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 14: skill-invocation-standard.md says 三层八角色
// ═══════════════════════════════════════════════════════════════
function checkThreeLayersEightRoles() {
  const skillPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "rules",
    "rule_detail",
    "skill-invocation-standard.md",
  );
  const content = readFile(skillPath);
  if (!content)
    return check(14, false, "skill-invocation-standard.md not found");

  const hasCorrectWording = content.includes("三层八角色");
  const hasWrongWording = content.includes("三层九角色");
  const ok = hasCorrectWording && !hasWrongWording;
  return check(
    14,
    ok,
    ok
      ? 'Uses "三层八角色" (not 三层九角色)'
      : hasWrongWording
        ? 'FOUND "三层九角色" — WRONG!'
        : 'Missing "三层八角色" reference',
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 15: code-quality-gate.js bootstrap
// ═══════════════════════════════════════════════════════════════
function checkCQGBootstrap() {
  const cqgPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "mcp-tools",
    "code-quality-gate.js",
  );
  const content = readFile(cqgPath);
  if (!content) return check(15, false, "code-quality-gate.js not found");

  // Check getStatePath() calls ensureStateDir()
  const hasEnsureStateDirCall =
    content.includes("ensureStateDir(stateDir)") ||
    content.includes("ensureStateDir(");
  const hasEnsureStateDirInGetStatePath =
    content.indexOf("function getStatePath") <
      content.indexOf("ensureStateDir") &&
    content.indexOf("ensureStateDir") <
      content.indexOf("return path.join(stateDir");

  // More robust: check that getStatePath contains ensureStateDir
  const getStatePathFunc = content.match(
    /function getStatePath\(\)\s*\{[^}]+\}/,
  );
  let getStatePathCallsEnsure = false;
  if (getStatePathFunc) {
    getStatePathCallsEnsure = getStatePathFunc[0].includes("ensureStateDir");
  }

  // Check getMachine() bootstraps on null
  const getMachineFunc = content.match(
    /function getMachine\(\)\s*\{[\s\S]*?^function|\}[\s\S]*?^export/m,
  );
  let getMachineBootstrap = false;
  if (getMachineFunc) {
    getMachineBootstrap =
      getMachineFunc[0].includes("getDefaultMachine()") &&
      getMachineFunc[0].includes("writeMachine");
  }

  const ok = getStatePathCallsEnsure && getMachineBootstrap;
  let detail = "";
  if (!getStatePathCallsEnsure)
    detail += " getStatePath() missing ensureStateDir() call";
  if (!getMachineBootstrap)
    detail += " getMachine() missing getDefaultMachine() bootstrap";
  return check(
    15,
    ok,
    ok
      ? "getStatePath() calls ensureStateDir(), getMachine() bootstraps with getDefaultMachine() on null"
      : detail.trim(),
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 16: All referenced files from AGENTS.md lines 37-49 exist
// ═══════════════════════════════════════════════════════════════
function checkReferencedFiles() {
  const referencedFiles = [
    ".opencode/rules/common-project.md",
    ".opencode/rules/mcp-compliance-guide.md",
    ".opencode/rules/skill-compliance-guide.md",
    ".opencode/context/requirements/系统架构设计文档（SAD）.md",
    ".opencode/context/requirements/接口设计规范文档.md",
    ".opencode/context/requirements/数据架构设计文档.md",
    ".opencode/context/requirements/安全架构设计文档.md",
    ".opencode/context/requirements/测试策略与计划.md",
    ".opencode/context/requirements/运维与部署设计文档.md",
    ".opencode/context/code_standards/frontend-coding-standard.md",
    ".opencode/context/code_standards/backend-coding-standard.md",
    ".opencode/context/code_standards/testing-coding-standard.md",
  ];

  const missing = referencedFiles.filter(
    (f) => !fileExists(path.join(OPENCODE_ROOT, f)),
  );
  const ok = missing.length === 0;
  return check(
    16,
    ok,
    ok
      ? `All ${referencedFiles.length} referenced files exist`
      : `Missing: ${missing.join(", ")}`,
  );
}

// ═══════════════════════════════════════════════════════════════
// Main execution
// ═══════════════════════════════════════════════════════════════
console.log("═══════════════════════════════════════════════════════════════");
console.log("  🔍 OpenCode Framework Binding Force Self-Test");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");

checkConfigJson();
checkStateDir();
checkMachineSubStates();
checkESLintRules();
checkPreCommitLayer0();
checkPreCommitLayer25();
checkCommitMsgTDD();
checkAgentSkillsClean();
checkArchitectCQG();
checkCICAgentDockerTools();
checkAgentsNoBackslashes();
checkDeploymentDoc();
checkProjectRefNoPlaceholders();
checkThreeLayersEightRoles();
checkCQGBootstrap();
checkReferencedFiles();

console.log("");
console.log("═══════════════════════════════════════════════════════════════");

const passedCount = results.filter((r) => r.startsWith("[PASS]")).length;
const failedCount = results.filter((r) => r.startsWith("[FAIL]")).length;

if (allPassed) {
  console.log(`  ✅ ALL ${results.length} CHECKS PASSED`);
  process.exit(0);
} else {
  console.log(`  ❌ ${failedCount}/${results.length} CHECKS FAILED`);
  process.exit(1);
}
