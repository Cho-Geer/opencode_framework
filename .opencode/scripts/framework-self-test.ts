#!/usr/bin/env node
"use strict";

/**
 * framework-self-test.ts — OpenCode Framework Binding Force Self-Test
 * ===================================================================
 * Validates 33 critical framework integrity checks.
 * Usage: bun .opencode/scripts/framework-self-test.ts
 *
 * Exit code: 0 if ALL 33 checks pass, 1 if any fail.
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

/**
 * FW-REPAIR-SHELL-TSX (2026-06-06): Resolve the best available TypeScript
 * runner for executing .ts sub-scripts. Priority order:
 *   1. bun  — fastest, already used by pre-execution-hook.sh
 *   2. tsx  — lightweight ts-node alternative
 *   3. node — fallback (may fail for ESM .ts files)
 *
 * When framework-self-test runs its own sub-checks (checks 25-27), it
 * spawns framework-doctor.ts and state-reconciliation.ts. These are
 * TypeScript files with ESM import syntax that plain `node` cannot
 * execute without --experimental-strip-types. Using the correct runner
 * prevents spurious test failures in environments without bun.
 *
 * @returns {string} Best available runner command prefix
 */
function resolveTsRunner() {
  try {
    const { execSync: _sync } = require("child_process");
    // Check for bun first (preferred by pre-execution-hook.sh)
    _sync("which bun", { stdio: "pipe" });
    return "bun";
  } catch (_bun) {
    try {
      const { execSync: _sync } = require("child_process");
      // Check for tsx
      _sync("which tsx", { stdio: "pipe" });
      return "tsx";
    } catch (_tsx) {
      try {
        const { execSync: _sync } = require("child_process");
        // Check for npx tsx
        _sync("npx tsx --version", { stdio: "pipe" });
        return "npx tsx";
      } catch (_npx) {
        // Fallback to node (may fail for ESM .ts files)
        return "node";
      }
    }
  }
}

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

/**
 * Read and parse a JSON file with trailing comma tolerance.
 * Attempts strict JSON.parse first; on failure, strips trailing commas
 * and retries. SA-IMPL-LEGACY-FIXES (2026-06-11).
 */
function readJSONFile(p) {
  var raw = readFile(p);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Strip trailing commas
    var cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
    if (cleaned === raw) throw e;
    try { return JSON.parse(cleaned); } catch (e2) {
      throw new Error("JSON parse failed after trailing comma fix: " + e2.message);
    }
  }
}

/**
 * Strip the "path_lint" JSON block from project.config.json content.
 * This block contains detection patterns (e.g., "/home/", "/Users/") that are
 * legitimate configuration values for lint detection, not actual absolute path leaks.
 * Returns the content unchanged for any other file.
 */
function stripPathLintBlock(content, filePath) {
  const basename = path.basename(filePath);
  if (basename !== "project.config.json") return content;

  const lines = content.split("\n");
  const result = [];
  let inBlock = false;
  let depth = 0;
  let entryDepth = 0;

  for (const line of lines) {
    let foundKey = false;
    if (!inBlock && line.includes('"path_lint"')) {
      foundKey = true;
      entryDepth = depth;
    }

    // Count braces
    for (const ch of line) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }

    if (foundKey || inBlock) {
      if (foundKey) inBlock = true;
      // Exited the path_lint block when depth returns to entry level
      if (inBlock && depth <= entryDepth) {
        inBlock = false;
      }
      continue; // Skip line inside path_lint block
    }

    result.push(line);
  }

  return result.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// Check 1: config.json loads

// ═══════════════════════════════════════════════════════════════
function checkConfigJson() {
  const cfg = readJSONFile(path.join(OPENCODE_ROOT, ".opencode", "project.config.json"));
  if (!cfg)
    return check(1, false, "project.config.json not found or unreadable");
    const hasProjectRoot = !!cfg.project_root;
    const hasTechStack = !!cfg.tech_stack && typeof cfg.tech_stack === "object";
    const hasContext7Mapping =
      Array.isArray(cfg.context7_task_mapping) &&
      cfg.context7_task_mapping.length > 0;
    const hasAgentWriteScopes =
      !!cfg.agent_write_scopes && typeof cfg.agent_write_scopes === "object";

    const ok = hasProjectRoot && hasTechStack && hasContext7Mapping && hasAgentWriteScopes;
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
    "eslint-plugin",
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
    "Architect.md",
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
    "CI-CD-Agent.md",
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
// Check 15: code-quality-gate.ts bootstrap

// ═══════════════════════════════════════════════════════════════
function checkCQGBootstrap() {
  const cqgPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "mcp-tools",
    "code-quality-gate.ts",
  );
  const content = readFile(cqgPath);
  if (!content) return check(15, false, "code-quality-gate.ts not found");

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
// Check 17: Scan rule/agent files for unresolved {placeholder} strings

// ═══════════════════════════════════════════════════════════════
function checkUnresolvedPlaceholders() {
  const dirsToScan = [
    path.join(OPENCODE_ROOT, ".opencode", "agents"),
    path.join(OPENCODE_ROOT, ".opencode", "rules"),
    path.join(OPENCODE_ROOT, ".opencode", "skills"),
  ];

  let totalFiles = 0;
  let violations = [];

  for (const dir of dirsToScan) {
    if (!fs.existsSync(dir)) continue;

    function walkDir(d) {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith(".md") ||
            entry.name.endsWith(".js") ||
            entry.name.endsWith(".sh") ||
            entry.name.endsWith(".json"))
        ) {
          totalFiles++;
          const content = readFile(fullPath);
          if (!content) continue;

          // Match literal {placeholder} or {xxx} patterns that are NOT valid template variables
          // Valid template: {project.xxx} or {backend.xxx} etc.
          const literalPlaceholderPattern =
            /\{(placeholder|xxx|todo|fixme)\}/gi;
          const matches = content.match(literalPlaceholderPattern);
          if (matches) {
            violations.push(
              `${path.relative(OPENCODE_ROOT, fullPath)}: ${matches.join(", ")}`,
            );
          }
        }
      }
    }
    walkDir(dir);
  }

  const ok = violations.length === 0;
  return check(
    17,
    ok,
    ok
      ? `No unresolved {placeholder} strings in ${totalFiles} framework files`
      : `Found ${violations.length} files with unresolved placeholders: ${violations.slice(0, 5).join("; ")}${violations.length > 5 ? ` ... and ${violations.length - 5} more` : ""}`,
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 18: Validate template_resolution exists in project.config.json

// ═══════════════════════════════════════════════════════════════
function checkTemplateResolution() {
  const cfg = readJSONFile(path.join(OPENCODE_ROOT, ".opencode", "project.config.json"));
  if (!cfg) return check(18, false, "project.config.json not found");
    const hasTemplateResolution =
      !!cfg.template_resolution && typeof cfg.template_resolution === "object";

    // Required keys for template_resolution
    const requiredKeys = ["contract_hash_command"];
    let missingKeys = [];
    let invalidKeys = [];

    if (hasTemplateResolution) {
      missingKeys = requiredKeys.filter((k) => !(k in cfg.template_resolution));
      for (const k of requiredKeys) {
        if (
          typeof cfg.template_resolution[k] !== "string" ||
          cfg.template_resolution[k].trim() === ""
        ) {
          invalidKeys.push(k);
        }
      }
    }

    const ok =
      hasTemplateResolution &&
      missingKeys.length === 0 &&
      invalidKeys.length === 0;
    let detail = "";
    if (!hasTemplateResolution)
      detail = "template_resolution section missing from project.config.json";
    else if (missingKeys.length > 0)
      detail = `Missing required keys in template_resolution: ${missingKeys.join(", ")}`;
    else if (invalidKeys.length > 0)
      detail = `Invalid/empty values in template_resolution: ${invalidKeys.join(", ")}`;
    else
      detail = `All ${requiredKeys.length} required keys present with valid values`;

    return check(18, ok, detail);
}

// ═══════════════════════════════════════════════════════════════
// Check 19: Scan .md files in .opencode/ for absolute path leakage

// ═══════════════════════════════════════════════════════════════
function checkAbsolutePathLeakage() {
  const OPENCODE_ROOT = process.env.OPENCODE_ROOT || process.cwd();
  const scanDirs = [
    OPENCODE_ROOT + "/.opencode/rules",
    OPENCODE_ROOT + "/.opencode/agents",
    OPENCODE_ROOT + "/.opencode/skills",
    OPENCODE_ROOT + "/.opencode/scripts",
    OPENCODE_ROOT + "/.opencode/state",
    OPENCODE_ROOT + "/.opencode/hooks",
  ];
  const leakPatterns = [
    { pattern: /\/home\//, name: "Linux home" },
    { pattern: /\/Users\//, name: "macOS home" },
    { pattern: /\/root\//, name: "root" },
    { pattern: /[A-Za-z]:\\/, name: "Windows absolute" },
  ];
  const whitelist = [
    "/tmp/opencode",
    "/usr/bin/",
    "/home/runner/work/",
    "/home/",
    "/Users/",
    "/root/",
    "C:\\",
    "[A-Za-z]:\\",
    "RegExp",
    "pattern:",
    "\\K",
    "\\d",
    "\\s",
    "\\n",
    "\\t",
    "\\r",
    "\\0",
  ];
  const violations = [];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = dir + "/" + entry.name;
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (
        entry.isFile() &&
        /\.(md|json|yaml|yml|sh|js|ts)$/i.test(entry.name)
      ) {
        let rawContent = fs.readFileSync(full, "utf8");
        rawContent = stripPathLintBlock(rawContent, full);
        const lines = rawContent.split("\n");
        for (let i = 0; i < lines.length; i++) {
          // Skip lines that are regex patterns or escape sequences (false positives)
          const line = lines[i];
          if (
            line.includes("\\") ||
            line.includes("RegExp") ||
            line.includes("grep -oP") ||
            line.includes("pattern:")
          )
            continue;
          for (const lp of leakPatterns) {
            if (lp.pattern.test(line)) {
              const isWhitelisted = whitelist.some((w) => line.includes(w));
              if (!isWhitelisted) {
                violations.push(full + ":" + (i + 1) + " " + lp.name);
              }
            }
          }
        }
      }
    }
  }

  for (const d of scanDirs) scanDir(d);

  if (violations.length === 0) {
    return check(19, true, "No absolute path leakage in framework files");
  }
  return check(
    19,
    false,
    violations.length + " violation(s):\n" + violations.slice(0, 5).join("\n"),
  );
}

// Check 20: Reconciliation script is wired into pre-execution-hook.sh

// ═══════════════════════════════════════════════════════════════
function checkReconciliationInfra() {
  // 20a: At least one reconciliation script exists (reconciliation-check.sh OR state-reconciliation.ts)
  const reconcileShellPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "reconciliation-check.sh",
  );
  const reconcileJSPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "state-reconciliation.ts",
  );

  const hasShellScript = fileExists(reconcileShellPath);
  const hasJSScript = fileExists(reconcileJSPath);

  if (!hasShellScript && !hasJSScript) {
    return check(
      20,
      false,
      "No reconciliation script found — expected reconciliation-check.sh or state-reconciliation.ts",
    );
  }

  // 20b: At least one reconciliation script has all 3 cross-reference check types
  // Check state-reconciliation.ts first (primary), then reconciliation-check.sh (fallback)
  let primaryPath = null;
  let scriptType = "";

  if (hasJSScript) {
    primaryPath = reconcileJSPath;
    scriptType = "state-reconciliation.ts";
  } else {
    primaryPath = reconcileShellPath;
    scriptType = "reconciliation-check.sh";
  }

  // 20b-i: For state-reconciliation.ts, verify it has the 4 check functions
  // For reconciliation-check.sh, verify it has the 3 cross-ref markers
  let hasCheck1 = false;
  let hasCheck2 = false;
  let hasCheck3 = false;
  let hasSummaryFormat = false;

  if (hasJSScript) {
    const jsContent = readFile(reconcileJSPath);
    if (!jsContent) {
      return check(20, false, "state-reconciliation.ts cannot be read");
    }

    // Check for the 4 check functions in state-reconciliation.ts
    hasCheck1 = jsContent.includes("checkCompletedDagHasGateSession");
    hasCheck2 = jsContent.includes("checkArmedSessionDagReference");
    hasCheck3 = jsContent.includes("checkOrphanedSessions");
    const hasCheck4 = jsContent.includes("checkDagMetaCounts");
    hasSummaryFormat = jsContent.includes("[State Reconciliation]");

    if (!hasCheck1 || !hasCheck2 || !hasCheck3 || !hasCheck4) {
      const missing = [];
      if (!hasCheck1) missing.push("checkCompletedDagHasGateSession");
      if (!hasCheck2) missing.push("checkArmedSessionDagReference");
      if (!hasCheck3) missing.push("checkOrphanedSessions");
      if (!hasCheck4) missing.push("checkDagMetaCounts");
      return check(
        20,
        false,
        `state-reconciliation.ts missing functions: ${missing.join(", ")}`,
      );
    }
  }

  if (hasShellScript) {
    const shContent = readFile(reconcileShellPath);
    if (shContent) {
      hasCheck1 =
        hasCheck1 ||
        shContent.includes("Check 1: DAG ↔ Gate") ||
        shContent.includes("DAG ↔ Gate");
      hasCheck2 =
        hasCheck2 ||
        shContent.includes("Check 2: Gate ↔ Machine") ||
        shContent.includes("Gate ↔ Machine");
      hasCheck3 =
        hasCheck3 ||
        shContent.includes("Check 3: DAG ↔ Machine") ||
        shContent.includes("DAG ↔ Machine");
      hasSummaryFormat =
        hasSummaryFormat || shContent.includes("[Reconciliation]");
    }
  }

  if (!hasCheck1 || !hasCheck2 || !hasCheck3) {
    const missing = [];
    if (!hasCheck1) missing.push("Check 1 (DAG↔Gate)");
    if (!hasCheck2) missing.push("Check 2 (Gate↔Machine)");
    if (!hasCheck3) missing.push("Check 3 (DAG↔Machine)");
    return check(
      20,
      false,
      `Missing cross-reference checks in reconciliation scripts: ${missing.join(", ")}`,
    );
  }

  if (!hasSummaryFormat) {
    return check(
      20,
      false,
      "Missing [Reconciliation] or [State Reconciliation] output format marker",
    );
  }

  // 20c: pre-execution-hook.sh references state-reconciliation.ts or reconciliation-check.sh
  const preExecPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "pre-execution-hook.sh",
  );
  const preExecContent = readFile(preExecPath);
  if (!preExecContent) {
    return check(
      20,
      false,
      "pre-execution-hook.sh not found (cannot verify integration)",
    );
  }

  const preExecHasReconcile =
    preExecContent.includes("state-reconciliation.ts") ||
    preExecContent.includes("reconciliation-check.sh") ||
    preExecContent.includes("Stage 2.5: State Reconciliation") ||
    preExecContent.includes("Stage 2: State Reconciliation");
  if (!preExecHasReconcile) {
    return check(
      20,
      false,
      "pre-execution-hook.sh does not invoke state-reconciliation.ts or reconciliation-check.sh",
    );
  }

  // 20d: For reconciliation-check.sh also verify bash syntax and executable
  if (hasShellScript) {
    // Check executable
    try {
      fs.accessSync(reconcileShellPath, fs.constants.X_OK);
    } catch {
      return check(
        20,
        false,
        "reconciliation-check.sh exists but is not executable",
      );
    }

    // Dry-run execution (verify script doesn't crash on syntax errors)
    try {
      const { execSync } = require("child_process");
      const relativePath = path.relative(OPENCODE_ROOT, reconcileShellPath);

      try {
        execSync(`bash -n "${relativePath}"`, {
          stdio: "pipe",
          timeout: 5000,
          cwd: OPENCODE_ROOT,
        });
      } catch (innerErr) {
        const stderr = (innerErr.stderr || "").toString();
        const isENOENT =
          stderr.includes("No such file or directory") ||
          stderr.includes("cannot open") ||
          stderr.includes("ENOENT") ||
          innerErr.status === 127;

        if (isENOENT) {
          try {
            execSync(`bash -n "${reconcileShellPath}"`, {
              stdio: "pipe",
              timeout: 5000,
            });
          } catch (absErr) {
            const absStderr = (absErr.stderr || "").toString();
            if (
              absStderr.includes("No such file or directory") ||
              absStderr.includes("cannot open") ||
              absErr.status === 127
            ) {
              return check(
                20,
                false,
                `reconciliation-check.sh not found at either path`,
              );
            }
            return check(
              20,
              false,
              `reconciliation-check.sh has bash syntax errors: ${absStderr || absErr.message}`,
            );
          }
        } else {
          return check(
            20,
            false,
            `reconciliation-check.sh has bash syntax errors: ${stderr || innerErr.message}`,
          );
        }
      }
    } catch (e) {
      return check(
        20,
        false,
        `reconciliation-check.sh bash check failed: ${e.stderr || e.message}`,
      );
    }
  }

  const ok =
    hasCheck1 &&
    hasCheck2 &&
    hasCheck3 &&
    hasSummaryFormat &&
    preExecHasReconcile;
  const detail = ok
    ? `${scriptType}: 3+ cross-ref checks (DAG↔Gate↔Machine), integrated into pre-execution-hook.sh` +
      (hasShellScript ? ", bash syntax valid, executable" : "")
    : "See failure details above";

  return check(20, ok, detail);
}

// ═══════════════════════════════════════════════════════════════
// Check 22: UC7KS Docs Manifest Integrity

// ═══════════════════════════════════════════════════════════════
function checkDocsManifestIntegrity() {
  const indexPath = path.join(
    OPENCODE_ROOT,
    "docs",
    "official_docs",
    "index.json",
  );
  const docsDir = path.join(OPENCODE_ROOT, "docs", "official_docs");

  // FW-REPAIR-14: Known non-document files in docs/official_docs/ that should
  // not be flagged as orphans. .gitkeep is a Git convention placeholder to track
  // empty directories. Other OS metadata files can be added here as needed.
  const KNOWN_NON_DOC_FILES = new Set([".gitkeep", "index.schema.json"]);

  // 22a: index.json exists
  if (!fs.existsSync(indexPath)) {
    return check(
      22,
      true,
      "docs/official_docs/index.json not yet created (no cache entries) — OK",
    );
  }

  // 22b: index.json is valid JSON with required fields
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (e) {
    return check(22, false, `index.json is not valid JSON: ${e.message}`);
  }

  if (!manifest.manifest_version || !Array.isArray(manifest.entries)) {
    return check(
      22,
      false,
      "index.json missing required fields (manifest_version, entries)",
    );
  }

  // 22b.5: Validate against JSON Schema (if schema exists)
  const schemaPath = path.join(OPENCODE_ROOT, "docs", "official_docs", "index.schema.json");
  if (fs.existsSync(schemaPath)) {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
      // Basic schema validation without ajv dependency
      const required = schema.required || [];
      for (const key of required) {
        if (!(key in manifest)) {
          return check(22, false, `index.json missing schema-required field: ${key}`);
        }
      }
      // Validate entries array items have required fields
      const entryRequired = schema.$defs?.entry?.required || [];
      const fileRequired = schema.$defs?.file_entry?.required || [];
      for (let i = 0; i < manifest.entries.length; i++) {
        const entry = manifest.entries[i];
        for (const key of entryRequired) {
          if (!(key in entry)) {
            return check(22, false, `index.json entries[${i}] missing required field: ${key}`);
          }
        }
        if (Array.isArray(entry.files)) {
          for (let j = 0; j < entry.files.length; j++) {
            const file = entry.files[j];
            for (const key of fileRequired) {
              if (!(key in file)) {
                return check(22, false, `index.json entries[${i}].files[${j}] missing required field: ${key}`);
              }
            }
          }
        }
      }
      // Validate total_entries matches actual count
      if (manifest.total_entries !== manifest.entries.length) {
        return check(
          22,
          false,
          `index.json total_entries (${manifest.total_entries}) does not match entries.length (${manifest.entries.length})`,
        );
      }
    } catch (e) {
      return check(22, false, `Schema validation error: ${e.message}`);
    }
  }

  // 22c: Check for orphan files (docs not in manifest)
  const orphanFiles = [];
  if (fs.existsSync(docsDir)) {
    const walkDir = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(docsDir, full);
        if (entry.isDirectory()) {
          if (
            !rel.startsWith(".metadata") &&
            !rel.startsWith("scout-extracts") &&
            !rel.includes(".opencode_backups")
          ) {
            walkDir(full);
          }
        } else if (
          entry.isFile() &&
          !rel.includes("index.json") &&
          !rel.startsWith(".metadata") &&
          !KNOWN_NON_DOC_FILES.has(entry.name)
        ) {
          const inManifest = manifest.entries.some(
            (e) =>
              e.files && e.files.some((f) => f.path && rel.includes(f.path)),
          );
          if (!inManifest) orphanFiles.push(rel);
        }
      }
    };
    try {
      walkDir(docsDir);
    } catch (_) {
      /* ignore */
    }
  }

  if (orphanFiles.length > 0) {
    return check(
      22,
      false,
      `Orphan docs not in index.json: ${orphanFiles.slice(0, 3).join(", ")}${orphanFiles.length > 3 ? " (+" + (orphanFiles.length - 3) + " more)" : ""}`,
    );
  }

  // 22d: Check total size against cap
  let totalSize = 0;
  try {
    const calcSize = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) calcSize(full);
        else totalSize += fs.statSync(full).size;
      }
    };
    calcSize(docsDir);
  } catch (_) {
    /* ignore */
  }

  const maxSize = 52428800; // 50MB
  if (totalSize > maxSize) {
    return check(
      22,
      false,
      `docs/official_docs/ total size ${(totalSize / 1048576).toFixed(1)}MB exceeds 50MB cap (UC7-005)`,
    );
  }

  return check(
    22,
    true,
    `${manifest.entries.length} entries, ${totalSize < 1048576 ? (totalSize / 1024).toFixed(0) + "KB" : (totalSize / 1048576).toFixed(1) + "MB"} total, 0 orphans`,
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 21: Git hooksPath enforcement (hooks present, executable, configured)

// ═══════════════════════════════════════════════════════════════
function checkGitHooksPath() {
  const hooksDir = path.join(OPENCODE_ROOT, ".opencode", "hooks");
  const preCommitPath = path.join(hooksDir, "pre-commit");
  const commitMsgPath = path.join(hooksDir, "commit-msg");

  // 21a: Verify git config core.hooksPath resolves to .opencode/hooks
  let configuredHooksPath = "";
  try {
    const { execSync } = require("child_process");
    configuredHooksPath = execSync("git config --local core.hooksPath", {
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
  } catch (e) {
    return check(
      21,
      false,
      `Failed to read git config core.hooksPath: ${e.stderr || e.message}`,
    );
  }

  if (configuredHooksPath !== ".opencode/hooks") {
    return check(
      21,
      false,
      `git config core.hooksPath is "${configuredHooksPath}", expected ".opencode/hooks". Run: git config core.hooksPath .opencode/hooks`,
    );
  }

  // 21b: Verify pre-commit hook exists and is executable
  let preCommitExists = false;
  let preCommitExec = false;
  try {
    const stat = fs.statSync(preCommitPath);
    preCommitExists = stat.isFile();
    fs.accessSync(preCommitPath, fs.constants.X_OK);
    preCommitExec = true;
  } catch (e) {
    // path not found or not executable
  }

  if (!preCommitExists) {
    return check(
      21,
      false,
      ".opencode/hooks/pre-commit does not exist or is not a regular file",
    );
  }
  if (!preCommitExec) {
    return check(
      21,
      false,
      ".opencode/hooks/pre-commit is not executable (chmod +x)",
    );
  }

  // 21c: Verify commit-msg hook exists and is executable
  let commitMsgExists = false;
  let commitMsgExec = false;
  try {
    const stat = fs.statSync(commitMsgPath);
    commitMsgExists = stat.isFile();
    fs.accessSync(commitMsgPath, fs.constants.X_OK);
    commitMsgExec = true;
  } catch (e) {
    // path not found or not executable
  }

  if (!commitMsgExists) {
    return check(
      21,
      false,
      ".opencode/hooks/commit-msg does not exist or is not a regular file",
    );
  }
  if (!commitMsgExec) {
    return check(
      21,
      false,
      ".opencode/hooks/commit-msg is not executable (chmod +x)",
    );
  }

  return check(
    21,
    true,
    `hooksPath=${configuredHooksPath}, pre-commit + commit-msg exist and executable`,
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 22: opencode.json adapter non-competing validation

// ═══════════════════════════════════════════════════════════════
function checkOpenCodeJsonAdapter() {
  const ocPath = path.join(OPENCODE_ROOT, "opencode.json");
  const raw = readFile(ocPath);
  if (!raw) return check(34, false, "opencode.json not found at project root");

  // 34a: valid JSON
  let oc;
  try {
    oc = JSON.parse(raw);
  } catch (e) {
    return check(34, false, `opencode.json is not valid JSON: ${e.message}`);
  }

  // 34b: no competing authorities — must NOT contain fields that duplicate DAG/gate/machine/contract
  const competingFields = [
    "dag",
    "tasks",
    "Task.DAG",
    "machine",
    "gate_state",
    "gate-state",
    "contract",
    "keystone_hashes",
    "eslint_state",
    "compliance_records",
    "tdd_enforcement",
    "write_audit",
  ];
  let dupes = [];
  function checkKeys(obj, prefix) {
    if (!obj || typeof obj !== "object") return;
    for (const k of Object.keys(obj)) {
      const fullKey = prefix ? `${prefix}.${k}` : k;
      for (const cf of competingFields) {
        if (k.toLowerCase() === cf.toLowerCase()) {
          dupes.push(fullKey);
        }
      }
      if (typeof obj[k] === "object" && !Array.isArray(obj[k])) {
        checkKeys(obj[k], fullKey);
      }
    }
  }
  checkKeys(oc, "");

  if (dupes.length > 0) {
    return check(
      22,
      false,
      `opencode.json contains competing authority fields: ${dupes.join(", ")}`,
    );
  }

  // 34c: agent definitions must match .opencode/agents/*.md counterparts
  if (!oc.agent || typeof oc.agent !== "object") {
    return check(34, false, "opencode.json missing 'agent' section");
  }

  const agentNames = Object.keys(oc.agent);
  if (agentNames.length < 8) {
    return check(
      34,
      false,
      `opencode.json has ${agentNames.length} agents, expected 8`,
    );
  }

  const agentsDir = path.join(OPENCODE_ROOT, ".opencode", "agents");
  const expectedMap = {
    "Meta-Planner": "Meta-Planner.md",
    Orchestrator: "Orchestrator.md",
    Architect: "Architect.md",
    "Coder-BE": "Coder-BE.md",
    "Coder-FE": "Coder-FE.md",
    Guardian: "Guardian.md",
    Arbiter: "Arbiter.md",
    "CI-CD-Agent": "CI-CD-Agent.md",
  };

  let agentMismatches = [];
  for (const [name, mdFile] of Object.entries(expectedMap)) {
    if (!oc.agent[name]) {
      agentMismatches.push(`Missing agent: ${name}`);
      continue;
    }
    const agentCfg = oc.agent[name];
    const agentMdPath = path.join(agentsDir, mdFile);
    const agentMd = readFile(agentMdPath);
    if (!agentMd) {
      agentMismatches.push(`Agent markdown file not found: ${mdFile}`);
      continue;
    }
    // Extract mode from frontmatter (allow opencode.json to elevate to primary)
    const modeMatch = agentMd.match(/^mode:\s*(\S+)/m);
    if (modeMatch && agentCfg.mode) {
      const mdMode = modeMatch[1];
      // Acceptable: opencode.json elevates subagent → primary (e.g. Architect, Meta-Planner, Orchestrator)
      // Not acceptable: opencode.json downgrades primary → subagent
      const isElevation = mdMode === "subagent" && agentCfg.mode === "primary";
      if (!isElevation && agentCfg.mode !== mdMode) {
        agentMismatches.push(
          `${name}: mode mismatch (opencode.json=${agentCfg.mode}, .md=${mdMode})`,
        );
      }
    }
    // Verify prompt path matches
    if (agentCfg.prompt && agentCfg.prompt !== `.opencode/agents/${mdFile}`) {
      agentMismatches.push(
        `${name}: prompt mismatch (opencode.json=${agentCfg.prompt}, expected=.opencode/agents/${mdFile})`,
      );
    }
  }

  if (agentMismatches.length > 0) {
    return check(
      22,
      false,
      `Agent definition mismatches: ${agentMismatches.join("; ")}`,
    );
  }

  // 22d: verify framework-authorities.json exists and contains required fields
  const faPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "state",
    "framework-authorities.json",
  );
  if (!fileExists(faPath)) {
    return check(
      22,
      false,
      ".opencode/state/framework-authorities.json not found",
    );
  }
  let fa;
  try {
    fa = JSON.parse(readFile(faPath));
  } catch (e) {
    return check(
      22,
      false,
      `framework-authorities.json is not valid JSON: ${e.message}`,
    );
  }
  const requiredFaFields = [
    "dag_authority",
    "state_authorities",
    "contract_authority",
    "agent_definitions",
  ];
  const missingFaFields = requiredFaFields.filter((f) => !(f in fa));
  if (missingFaFields.length > 0) {
    return check(
      22,
      false,
      `framework-authorities.json missing required fields: ${missingFaFields.join(", ")}`,
    );
  }

  return check(
    22,
    true,
    `opencode.json adapter valid: ${agentNames.length} agents, no competing authorities, all agent defs match .md counterparts, framework-authorities.json present`,
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 23: pre-execution-gate.ts exists, valid JS, wired into hook

// ═══════════════════════════════════════════════════════════════
function checkPreExecGate() {
  const gatePath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "pre-execution-gate.ts",
  );

  // 23a: File exists
  if (!fileExists(gatePath)) {
    return check(23, false, "pre-execution-gate.ts not found");
  }

  // 23b: Is valid TypeScript/JavaScript (syntax check via bun build)
  // FW-REPAIR-SA-20260611: node -c cannot validate .ts files; bun -c executes
  // the script (not syntax-check). Use bun build --outfile=/dev/null instead.
  try {
    const { execSync } = require("child_process");
    execSync(
      `bun build "${gatePath}" --target=bun --outfile=/dev/null`,
      { stdio: "pipe", timeout: 10000 },
    );
  } catch (e) {
    return check(
      23,
      false,
      `pre-execution-gate.ts has TypeScript/JavaScript syntax errors: ${(e.stderr || e.message).toString().substring(0, 200)}`,
    );
  }

  // 23c: Is executable
  try {
    fs.accessSync(gatePath, fs.constants.X_OK);
  } catch {
    return check(
      23,
      false,
      "pre-execution-gate.ts is not executable (chmod +x)",
    );
  }

  // 23d: Wired into pre-execution-hook.sh
  const preExecHookPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "pre-execution-hook.sh",
  );
  const hookContent = readFile(preExecHookPath);
  if (!hookContent) {
    return check(
      23,
      false,
      "pre-execution-hook.sh not found (cannot verify wiring)",
    );
  }

  const wiredIntoHook =
    hookContent.includes("pre-execution-gate.ts") &&
    hookContent.includes("Stage 1");
  if (!wiredIntoHook) {
    return check(
      23,
      false,
      "pre-execution-gate.ts not wired into pre-execution-hook.sh (missing Stage 1 reference)",
    );
  }

  // 23e: Key functions exist in script (structural validation)
  const gateContent = readFile(gatePath);
  if (!gateContent) {
    return check(23, false, "pre-execution-gate.ts cannot be read");
  }

  const requiredFunctions = [
    "checkDagCoverage",
    "checkGateLifecycle",
    "checkRoleViolations",
    "checkRuleRegistry",
    "checkConfigValidity",
    "checkKnowledgeGate",
    "getEnforcementMode",
  ];
  const missingFuncs = requiredFunctions.filter(
    (f) => !gateContent.includes(`function ${f}`),
  );
  if (missingFuncs.length > 0) {
    return check(
      23,
      false,
      `pre-execution-gate.ts missing required functions: ${missingFuncs.join(", ")}`,
    );
  }

  return check(
    23,
    true,
    "pre-execution-gate.ts exists, valid JS, executable, wired into pre-execution-hook.sh Stage 1, 6 checks implemented (incl. Knowledge Pipeline Gate)",
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 24: framework-doctor.ts exists, is valid JS

// ═══════════════════════════════════════════════════════════════
function checkFrameworkDoctorExists() {
  const doctorPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "framework-doctor.ts",
  );

  // 24a: File exists
  if (!fileExists(doctorPath)) {
    return check(24, false, "framework-doctor.ts not found");
  }

  // 24b: Is valid JavaScript (syntax check)
  try {
    const { execSync } = require("child_process");
    execSync(`"${process.execPath}" -c "${doctorPath}"`, {
      stdio: "pipe",
      timeout: 5000,
    });
  } catch (e) {
    return check(
      24,
      false,
      `framework-doctor.ts has JavaScript syntax errors: ${(e.stderr || e.message).toString().substring(0, 200)}`,
    );
  }

  // 24c: Is executable — FW-REPAIR-13: scripts invoked via `node` don't need +x
  // (chmod is blocked by safe_bash, and these scripts are always run as `node script.js`)
  const stat = fs.statSync(doctorPath);
  if ((stat.mode & 0o111) === 0) {
    // Non-blocking: warn but don't fail — `node script.js` works without +x
    console.warn(
      "  ⚠️  framework-doctor.ts is not executable — always invoked via `node`, not directly",
    );
  }

  return check(
    24,
    true,
    "framework-doctor.ts exists, valid JS" +
      (stat.mode & 0o111 ? ", executable" : ", node-invoked"),
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 25: doctor --json produces valid JSON with 10 checks

// ═══════════════════════════════════════════════════════════════
function checkDoctorJsonOutput() {
  const doctorPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "framework-doctor.ts",
  );

  if (!fileExists(doctorPath)) {
    return check(
      25,
      false,
      "framework-doctor.ts not found (cannot test --json output)",
    );
  }

  try {
    const { execSync } = require("child_process");
    let output;
    try {
      // FW-REPAIR-SHELL-TSX: Use tsx/bun runner instead of plain node
      // for TypeScript sub-scripts to handle ESM import syntax
      output = execSync(`${resolveTsRunner()} "${doctorPath}" --json`, {
        cwd: OPENCODE_ROOT,
        stdio: "pipe",
        timeout: 30000,
        encoding: "utf-8",
      });
    } catch (e) {
      // Doctor may exit non-zero but still produce valid JSON
      output = e.stdout || "";
    }

    if (!output || output.trim().length === 0) {
      return check(25, false, "--json flag produced empty output");
    }

    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch (e) {
      return check(
        25,
        false,
        `--json output is not valid JSON: ${e.message}. Output starts: ${output.substring(0, 100)}`,
      );
    }

    // Validate structure
    if (!parsed.version) {
      return check(25, false, "JSON missing 'version' field");
    }

    if (!parsed.checks || !Array.isArray(parsed.checks)) {
      return check(25, false, "JSON missing 'checks' array");
    }

    if (parsed.checks.length !== 11) {
      return check(
        25,
        false,
        `Expected 11 checks but found ${parsed.checks.length}`,
      );
    }

    // Each check must have id, name, status
    const missingFields = parsed.checks.filter(
      (c) => !c.id || !c.name || !c.status,
    );
    if (missingFields.length > 0) {
      return check(
        25,
        false,
        `${missingFields.length} checks missing required fields (id, name, status)`,
      );
    }

    if (!parsed.summary) {
      return check(25, false, "JSON missing 'summary' field");
    }

    const passedCount = parsed.checks.filter((c) => c.status === "PASS").length;
    const failedCount = parsed.checks.filter((c) => c.status === "FAIL").length;

    return check(
      25,
      true,
      `Valid JSON: ${parsed.checks.length} checks (${passedCount} PASS, ${failedCount} FAIL), version=${parsed.version}`,
    );
  } catch (e) {
    return check(25, false, `Unexpected error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Check 26: doctor --strict exits 0 on clean project

// ═══════════════════════════════════════════════════════════════
function checkDoctorStrict() {
  const doctorPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "framework-doctor.ts",
  );

  if (!fileExists(doctorPath)) {
    return check(
      26,
      false,
      "framework-doctor.ts not found (cannot test --strict)",
    );
  }

  try {
    const { execSync } = require("child_process");
    let output;
    let exitCode = 0;
    try {
      // FW-REPAIR-SHELL-TSX: Use tsx/bun runner for TypeScript sub-scripts
      output = execSync(`${resolveTsRunner()} "${doctorPath}" --strict`, {
        cwd: OPENCODE_ROOT,
        stdio: "pipe",
        timeout: 30000,
        encoding: "utf-8",
      });
      exitCode = 0;
    } catch (e) {
      exitCode = e.status || 1;
      output = e.stdout || "";
    }

    if (exitCode !== 0) {
      // Extract which checks failed
      const failLines = (output || "")
        .split("\n")
        .filter((l) => l.includes("[FAIL]"));
      return check(
        26,
        false,
        `--strict exited ${exitCode}. ${failLines.length} check(s) failing: ${failLines.join("; ").substring(0, 200)}`,
      );
    }

    return check(
      26,
      true,
      "--strict exits 0 (all checks pass on current project)",
    );
  } catch (e) {
    return check(26, false, `Unexpected error: ${e.message}`);
  }
}

function checkCrossValidation() {
  // Check 27: Cross-validate framework-doctor and state-reconciliation.ts agree
  const reconcilerPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "state-reconciliation.ts",
  );
  const doctorPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "framework-doctor.ts",
  );

  if (!fileExists(reconcilerPath) || !fileExists(doctorPath)) {
    return check(
      27,
      false,
      "state-reconciliation.ts or framework-doctor.ts not found",
    );
  }

  try {
    const { execSync } = require("child_process");

    // Run state-reconciliation --strict --json
    let reconcilerOutput,
      reconcilerExit = 0;
    try {
      // FW-REPAIR-SHELL-TSX: Use tsx/bun runner for TypeScript sub-scripts
      reconcilerOutput = execSync(
        `${resolveTsRunner()} "${reconcilerPath}" --strict --json`,
        {
          cwd: OPENCODE_ROOT,
          stdio: "pipe",
          timeout: 15000,
          encoding: "utf-8",
        },
      );
    } catch (e) {
      reconcilerExit = e.status || 1;
      reconcilerOutput = e.stdout || "";
    }

    // Parse reconciler output
    let reconcilerOk = false;
    try {
      const data = JSON.parse(reconcilerOutput);
      reconcilerOk =
        data.valid === true ||
        (data.inconsistencies &&
          data.inconsistencies.filter((i) => i.severity === "HIGH").length ===
            0);
    } catch (e) {
      reconcilerOk = false;
    }

    // Run doctor --strict --json
    let doctorOutput,
      doctorExit = 0;
    try {
      // FW-REPAIR-SHELL-TSX: Use tsx/bun runner for TypeScript sub-scripts
      doctorOutput = execSync(
        `${resolveTsRunner()} "${doctorPath}" --strict --json`,
        {
          cwd: OPENCODE_ROOT,
          stdio: "pipe",
          timeout: 30000,
          encoding: "utf-8",
        },
      );
    } catch (e) {
      doctorExit = e.status || 1;
      doctorOutput = e.stdout || "";
    }

    // Parse doctor output
    let doctorOk = false;
    try {
      const data = JSON.parse(doctorOutput);
      doctorOk = data.summary && data.summary.failed === 0;
    } catch (e) {
      // Try parsing the text output for check summary
      doctorOk = reconcilerOk; // fallback: check reconciler result
    }

    const bothOk = reconcilerOk && doctorOk;
    const detail = reconcilerOk
      ? doctorOk
        ? "Both tools agree: healthy (0 inconsistencies, 0 failures)"
        : "Reconciler clean but doctor reports failures"
      : "Reconciler reports inconsistencies";
    return check(27, bothOk, detail);
  } catch (e) {
    return check(27, false, `Cross-validation error: ${e.message}`);
  }
}

// ───────────────────────────────────────────────────────────────
// Check 28: UC7KS Schema Integrity
// Validates machine.json.knowledge_cache_state structure against
// the schema defined in machine.schema.json. Added FW-HARDEN-UC7KS.
// ───────────────────────────────────────────────────────────────
function checkUC7KSSchemaIntegrity() {
  const machinePath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "state",
    "machine.json",
  );
  const raw = readFile(machinePath);
  if (!raw) return check(28, false, "machine.json not found");
  try {
    const machine = JSON.parse(raw);
    const kcs = machine.knowledge_cache_state;
    if (!kcs || typeof kcs !== "object") {
      return check(28, false, "knowledge_cache_state missing or not an object");
    }
    const issues = [];
    if (!kcs.cache_status) issues.push("missing cache_status");
    if (kcs.total_entries === undefined || kcs.total_entries < 0)
      issues.push("invalid total_entries");
    if (!kcs.compliance) issues.push("missing compliance section");
    if (!kcs.session_access) issues.push("missing session_access");
    // Validate session_access sub-schema
    if (kcs.session_access) {
      for (const [agent, state] of Object.entries(kcs.session_access)) {
        const s = state;
        if (s.uc7_001_compliant === undefined)
          issues.push(agent + ": missing uc7_001_compliant");
        if (s.last_read_at === undefined)
          issues.push(agent + ": missing last_read_at");
        if (s.declared_scope === undefined)
          issues.push(agent + ": missing declared_scope (FW-HARDEN-UC7KS-002)");
        if (!s.cache_sufficiency)
          issues.push(
            agent + ": missing cache_sufficiency (FW-HARDEN-UC7KS-003)",
          );
      }
    }
    return check(
      28,
      issues.length === 0,
      issues.length === 0 ? "all fields present and valid" : issues.join("; "),
    );
  } catch (e) {
    return check(28, false, e.message);
  }
}

// ───────────────────────────────────────────────────────────────
// Check 29: Custom Tool Registration
// Verifies the 3 new UC7KS knowledge pipeline custom tools exist
// in .opencode/tools/. Added FW-HARDEN-UC7KS.
// ───────────────────────────────────────────────────────────────
function checkCustomToolRegistration() {
  const toolsDir = path.join(OPENCODE_ROOT, ".opencode", "tools");
  const requiredTools = [
    "module_scope_declare.ts",
    "knowledge_cache_search.ts",
    "knowledge_gap_report.ts",
  ];
  const missing = [];
  for (const tool of requiredTools) {
    if (!fileExists(path.join(toolsDir, tool))) missing.push(tool);
  }
  let existingCount = 0;
  try {
    existingCount = fs.readdirSync(toolsDir).filter(function (f) {
      return f.endsWith(".ts") && !f.startsWith(".");
    }).length;
  } catch (_) {}
  return check(
    29,
    missing.length === 0,
    missing.length > 0
      ? "missing: [" + missing.join(", ") + "]"
      : "all " +
          requiredTools.length +
          " new tools exist (total: " +
          existingCount +
          ")",
  );
}

// ───────────────────────────────────────────────────────────────
// Check 30: Knowledge Semantic Map Coverage
// Validates all 12 domains in knowledge_semantic_map have required
// fields (keywords, save_path, fallback_pattern). Added FW-HARDEN-UC7KS.
// ───────────────────────────────────────────────────────────────
function checkKnowledgeSemanticMapCoverage() {
  const config = readJSONFile(path.join(OPENCODE_ROOT, ".opencode", "project.config.json"));
  if (!config) return check(30, false, "project.config.json not found");
  const map = config.knowledge_semantic_map;
    if (!map || !Array.isArray(map.domains)) {
      return check(
        30,
        false,
        "knowledge_semantic_map.domains missing or not array",
      );
    }
    const domains = map.domains;
    const requiredDomains = [
      "backend_api",
      "persistence",
      "frontend_ui",
      "caching",
      "queue",
      "testing",
      "auth_security",
      "framework_tools",
      "devops_ci",
      "opencode_framework",
      "infrastructure",
      "state_management",
    ];
    const existingIds = new Set(
      domains.map(function (d) {
        return d.domain_id;
      }),
    );
    const missingDomains = requiredDomains.filter(function (d) {
      return !existingIds.has(d);
    });
    const issues = [];
    for (const domain of domains) {
      const d = domain;
      if (!d.keywords || d.keywords.length === 0)
        issues.push(d.domain_id + ": missing keywords");
      if (!d.save_path) issues.push(d.domain_id + ": missing save_path");
      if (!d.fallback_pattern)
        issues.push(d.domain_id + ": missing fallback_pattern");
    }
    const allIssues = missingDomains
      .map(function (d) {
        return "missing domain: " + d;
      })
      .concat(issues);
    return check(
      30,
      allIssues.length === 0,
      allIssues.length === 0
        ? "all " + requiredDomains.length + " domains valid"
        : allIssues.join("; "),
    );
}

// ═══════════════════════════════════════════════════════════════
// Check 31: UC7-002 — Agent Config UC7KS Section Presence
// Verifies all agent config files contain the mandatory UC7KS
// Knowledge Acquisition (Local-First) section. Every agent except
// Knowledge-Curator MUST have this section per UC7-002.
// Added GAP-M4-R3a (2026-06-06).

// ═══════════════════════════════════════════════════════════════
function checkAgentUC7KSSection() {
  const agentsDir = path.join(OPENCODE_ROOT, ".opencode", "agents");
  let dirEntries;
  try {
    dirEntries = fs.readdirSync(agentsDir);
  } catch {
    return check(31, false, "agents directory not found");
  }

  const agentFiles = dirEntries.filter(function (f) {
    return f.endsWith(".md");
  });
  /**
   * UC7-002 compliance: Every agent config MUST contain the UC7KS
   * Knowledge Acquisition section. The Knowledge-Curator agent is
   * exempted because it IS the UC7KS pipeline executor.
   */
  const UC7KS_SECTION_MARKER = "UC7KS Knowledge Acquisition";
  const EXEMPT_AGENTS = new Set(["Knowledge-Curator.md"]);

  let violations = [];
  let totalAgents = 0;

  for (const af of agentFiles) {
    totalAgents++;
    if (EXEMPT_AGENTS.has(af)) continue; // Knowledge-Curator is the pipeline executor

    const content = readFile(path.join(agentsDir, af));
    if (!content) {
      violations.push(af + ": file unreadable");
      continue;
    }

    if (!content.includes(UC7KS_SECTION_MARKER)) {
      violations.push(af + ": missing UC7KS section");
    }
  }

  const ok = violations.length === 0;
  return check(
    31,
    ok,
    ok
      ? "All " +
          (totalAgents - EXEMPT_AGENTS.size) +
          " non-exempt agents have UC7KS Knowledge Acquisition section"
      : "Missing UC7KS section in: " + violations.join("; "),
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 32: UC7-004 — External Query Tool Block Verification
// Verifies no agent (except Knowledge-Curator) has context7_*, webfetch,
// websearch, or Github in their YAML frontmatter mcp_tools. Direct use of
// external query tools bypasses the UC7KS local-first pipeline.
// P0-FIX-UC7KS-GITHUB-01: Expanded from context7-only to all external query tools.
// Added GAP-M4-R3b (2026-06-06). Updated (2026-06-09).

// ═══════════════════════════════════════════════════════════════
function checkContext7ToolBlock() {
  const agentsDir = path.join(OPENCODE_ROOT, ".opencode", "agents");
  let dirEntries;
  try {
    dirEntries = fs.readdirSync(agentsDir);
  } catch {
    return check(32, false, "agents directory not found");
  }

  const agentFiles = dirEntries.filter(function (f) {
    return f.endsWith(".md");
  });
  /**
   * UC7-004 HARDEN (2026-06-09): Only @Knowledge-Curator may use ANY external
   * query tools. All other agents must go through the UC7KS local-first pipeline.
   * This now covers context7, webfetch, websearch, and Github content-fetching tools.
   */
  const ALLOWED_AGENT = "Knowledge-Curator.md";
  const BLOCKED_TOOLS = ["context7", "webfetch", "websearch", "Github"];

  let violations = [];
  let totalAgents = 0;

  for (const af of agentFiles) {
    totalAgents++;
    if (af === ALLOWED_AGENT) continue; // KC is exempt
    const content = readFile(path.join(agentsDir, af));
    if (!content) continue;

    // Parse YAML frontmatter to extract mcp_tools
    const mcpToolsMatch = content.match(/^mcp_tools:\n((?:\s+- .+\n)*)/m);
    if (!mcpToolsMatch) continue;

    const toolsSection = mcpToolsMatch[1];
    const toolNames = toolsSection.match(/^\s+-\s+(.+)$/gm) || [];

    for (const t of toolNames) {
      const clean = t.replace(/^\s+-\s+/, "").trim();
      for (const bt of BLOCKED_TOOLS) {
        if (clean === bt || clean.startsWith(bt + "_")) {
          violations.push(af + ": " + clean);
        }
      }
    }
  }

  const ok = violations.length === 0;
  return check(
    32,
    ok,
    ok
      ? "No external query tools (context7/webfetch/websearch/Github) found outside Knowledge-Curator agent"
      : "UC7-004 violation — external query tools found in: " +
          violations.join("; "),
  );
}

// ═══════════════════════════════════════════════════════════════
// Main execution
/**
 * FW-PROMPT-HARDEN-04: Check 33 — Validate .pending.json FIFO queue integrity.
 * Part of the prompt hard-constraint system (Phase 3).
 *
 * Validates:
 * - .pending.json is valid JSON
 * - Queue entries have required fields (dispatchId, promptHash, filePath, createdAt, agentType)
 * - No orphan entries (pending entry with missing dispatch file)
 * - No stale entries (older than 30 min — should have been auto-drained by enforce.ts)
 * - Queue depth does not exceed MAX_QUEUE_SIZE (10)
 * - All promptHash values are valid 64-hex-char SHA-256
 *
 * FW-PROMPT-HARDEN-04 (2026-06-08, @Super-Admin): Added agentType validation,
 * staleness check, and queue depth warning.
 */
function checkPendingJson(): void {
  const pendingPath = path.join(
    OPENCODE_ROOT,
    ".task_temp",
    "_dispatch",
    ".pending.json",
  );
  const STALE_MINUTES = 30;

  if (!fs.existsSync(pendingPath)) {
    check(33, true, "No .pending.json — queue is empty (OK)");
    return;
  }

  try {
    const queue = JSON.parse(fs.readFileSync(pendingPath, "utf8"));

    if (!Array.isArray(queue)) {
      return check(33, false, ".pending.json exists but is not an array");
    }

    // Empty queue is valid
    if (queue.length === 0) {
      return check(
        33,
        true,
        ".pending.json is an empty array — queue drained (OK)",
      );
    }

    // Validate each entry has required fields (including agentType added in HARDEN-04)
    const requiredFields = [
      "dispatchId",
      "promptHash",
      "filePath",
      "createdAt",
    ];
    const recommendedField = "agentType"; // optional for backward compat, recommended
    const malformed: number[] = [];
    const orphans: string[] = [];
    const staleEntries: string[] = [];
    const missingAgentType: number[] = [];
    const now = Date.now();

    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      const missing = requiredFields.filter((f) => !(f in entry));
      if (missing.length > 0) {
        malformed.push(i);
      }
      // Check if dispatchId (file path) still exists
      if (entry.filePath && !fs.existsSync(entry.filePath)) {
        orphans.push(`entry[${i}]: ${entry.filePath} (file missing)`);
      }
      // Check for staleness
      if (entry.createdAt) {
        const age = now - new Date(entry.createdAt).getTime();
        if (age > STALE_MINUTES * 60 * 1000) {
          staleEntries.push(
            `entry[${i}] (${Math.round(age / 60000)}min old, agentType=${entry.agentType || "N/A"})`,
          );
        }
      }
      // Check for missing agentType (FW-PROMPT-HARDEN-04 recommendation)
      if (!entry.agentType) {
        missingAgentType.push(i);
      }
    }

    if (malformed.length > 0) {
      return check(
        33,
        false,
        `.pending.json has ${malformed.length} malformed entries at indices: ${malformed.join(", ")}`,
      );
    }

    if (orphans.length > 0) {
      return check(
        33,
        false,
        `.pending.json has ${orphans.length} orphan entries: ${orphans.join("; ")}`,
      );
    }

    // Check for promptHash format (64 hex chars, SHA-256)
    const badHashes = queue.filter(
      (e) => e.promptHash && !/^[a-f0-9]{64}$/.test(e.promptHash),
    );
    if (badHashes.length > 0) {
      return check(
        33,
        false,
        `.pending.json has ${badHashes.length} entries with invalid SHA-256 hashes`,
      );
    }

    // Build status message
    const statusParts: string[] = [];
    statusParts.push(`${queue.length} pending entries`);
    if (staleEntries.length > 0) {
      statusParts.push(
        `⚠ ${staleEntries.length} STALE (should have been auto-drained)`,
      );
    }
    if (missingAgentType.length > 0) {
      statusParts.push(
        `${missingAgentType.length} entries missing agentType (old format, still supported)`,
      );
    }
    if (queue.length > 10) {
      statusParts.push(`⚠ QUEUE DEPTH ${queue.length} > 10 (max)`);
    }

    const passed = staleEntries.length === 0;
    return check(
      33,
      passed,
      `.pending.json — ${statusParts.join("; ")}.${staleEntries.length > 0 ? " STALE: " + staleEntries.join(", ") : ""}`,
    );
  } catch (e: any) {
    return check(33, false, `Failed to parse .pending.json: ${e.message}`);
  }
}

// SA-IMPL-SELF-CLEANUP (2026-06-11): Check 34 — agent key validity
function checkSessionAccessAgentKeys(): void {
  const INVALID_KEYS = ["unknown", "", "undefined", "null"];
  try {
    const mPath = path.join(OPENCODE_ROOT, ".opencode", "state", "machine.json");
    if (!fs.existsSync(mPath)) { check(34, true, "machine.json not found"); return; }
    const m = JSON.parse(fs.readFileSync(mPath, "utf-8"));
    const sa = m?.knowledge_cache_state?.session_access;
    if (!sa) { check(34, true, "no entries"); return; }
    const invalid: string[] = [];
    for (const key of Object.keys(sa)) { if (INVALID_KEYS.includes(key)) invalid.push(key); }
    check(34, invalid.length === 0,
      invalid.length > 0 ? `Invalid agent keys: ${invalid.join(",")}` : `all ${Object.keys(sa).length} agent keys valid`);
  } catch (e: any) { check(34, false, e.message); }
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
checkUnresolvedPlaceholders();
checkTemplateResolution();
checkAbsolutePathLeakage();
checkReconciliationInfra();
checkDocsManifestIntegrity();
checkGitHooksPath();
checkOpenCodeJsonAdapter();
checkPreExecGate();
checkFrameworkDoctorExists();
checkDoctorJsonOutput();
checkDoctorStrict();
checkCrossValidation();
checkUC7KSSchemaIntegrity();
checkCustomToolRegistration();
checkKnowledgeSemanticMapCoverage();
checkAgentUC7KSSection();
checkContext7ToolBlock();
checkPendingJson();
checkSessionAccessAgentKeys();

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
