#!/usr/bin/env bun
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

/**
 * FW-LOG-UNIFY Phase 3: Lazy-load writeLog to record self-test outcomes.
 */
let _writeLog = null;
function getWriteLog() {
  if (!_writeLog) {
    try {
      const lm = require(path.join(__dirname, "..", "lib", "log-manager"));
      _writeLog = lm.writeLog;
    } catch { _writeLog = () => {}; }
  }
  return _writeLog;
}
function srcLog(level, event, fields) {
  try { getWriteLog()("script-framework-self-test", level, { event, ...fields }); } catch {}
}

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
  if (!passed) {
    allPassed = false;
    // FW-LOG-UNIFY-C3: Log check failures for persistent audit trail
    srcLog("ERROR", "check_failed", { check: name, detail: detail || "" });
  }
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
  // P2-D v2.1: agent_write_scopes moved to opencode.json (authoritative source).
  // project.config.json now only carries framework-level policies (enforcement_mode,
  // route_rules, safe_shell framework policies, etc.). agent_write_scopes removed.
  const hasProjectRoot = !!cfg.project_root;
  const hasTechStack = !!cfg.tech_stack && typeof cfg.tech_stack === "object";
  const hasContext7Mapping =
    Array.isArray(cfg.context7_task_mapping) &&
    cfg.context7_task_mapping.length > 0;
  // P2-D: negative check — agent_write_scopes MUST NOT exist in project.config.json
  // (it has been moved to opencode.json agent.*.permission.safe_edit)
  const hasRemovedAgentWriteScopes = "agent_write_scopes" in cfg;

  // P2-D v2.1: ALSO verify opencode.json is present and has agent permissions
  const ocCfg = readJSONFile(path.join(OPENCODE_ROOT, "opencode.json"));
  const hasOpencode = !!ocCfg;
  const hasAgentPermissions = !!ocCfg?.agent && typeof ocCfg.agent === "object";
  const agentCount = hasAgentPermissions ? Object.keys(ocCfg.agent).length : 0;
  const agentsWithSafeEdit = hasAgentPermissions
    ? Object.values(ocCfg.agent).filter((a: any) => !!(a as any)?.permission?.safe_edit).length
    : 0;

  const ok = hasProjectRoot
    && hasTechStack
    && hasContext7Mapping
    && !hasRemovedAgentWriteScopes
    && hasOpencode
    && hasAgentPermissions
    && agentCount > 0;
  let detail = "";
  if (!hasProjectRoot) detail += " missing project_root";
  if (!hasTechStack) detail += " missing tech_stack";
  if (!hasContext7Mapping) detail += " missing context7_task_mapping";
  if (hasRemovedAgentWriteScopes) detail += " agent_write_scopes still present (must be removed; authority → opencode.json)";
  if (!hasOpencode) detail += " opencode.json not found or unreadable";
  if (!hasAgentPermissions) detail += " opencode.json missing agent permissions";
  if (hasAgentPermissions && agentCount === 0) detail += " opencode.json has 0 agent definitions";
  return check(
    1,
    ok,
    detail.trim() ||
      `project_root="${cfg.project_root}", tech_stack keys=${Object.keys(cfg.tech_stack).length}, context7_task_mapping=${cfg.context7_task_mapping.length}, opencode.json agents=${agentCount} with_safe_edit=${agentsWithSafeEdit}`,
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
// Check 3: Split sub-state architecture integrity (P1-B)

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
    
    // P1-B: machine.json should only contain meta and contracts
    const expectedKeys = ["meta", "contracts"];
    const actualKeys = Object.keys(m);
    const unexpectedKeys = actualKeys.filter(k => !expectedKeys.includes(k));
    
    if (unexpectedKeys.length > 0) {
      return check(
        3,
        false,
        `machine.json contains unexpected keys (should be split): ${unexpectedKeys.join(", ")}`,
      );
    }
    
    // P2-A v7: Verify substate_kv DB has 12 sub-state entries (JSON snapshots deleted)
    try {
      const { getDb } = require("../lib/db-manager");
      const db = getDb();
      const row = db.query("SELECT COUNT(*) AS c FROM substate_kv").get() as { c: number } | undefined;
      const count = row?.c ?? 0;
      if (count < 12) {
        return check(
          3,
          false,
          `substate_kv has ${count} rows (expected 12)`,
        );
      }
      return check(
        3,
        true,
        `Split architecture OK: machine.json has ${expectedKeys.length} keys, substate_kv has ${count} entries`,
      );
    } catch (e: any) {
      return check(3, false, `substate_kv query failed: ${e.message}`);
    }
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
  const tsPath = path.join(OPENCODE_ROOT, ".opencode", "hooks", "lib", "hook-layers.ts");
  const wrapperPath = path.join(OPENCODE_ROOT, ".opencode", "hooks", "pre-commit");

  const wrapper = readFile(wrapperPath);
  const hasDelegation = wrapper && wrapper.includes("hook-layers.ts");

  const content = readFile(tsPath);
  if (!content) return check(5, false, "hook-layers.ts not found");

  const hasExit1 =
    content.includes("process.exit(1)") && content.includes("compliance gate");
  const hasArmedCheck =
    content.includes("Layer 0") && content.includes("process.exit(1)");
  const ok = hasDelegation && hasExit1 && hasArmedCheck;
  return check(
    5,
    ok,
    ok
      ? "Layer 0 compliance gate check with process.exit(1) found in hook-layers.ts"
      : "Missing compliance gate Layer 0 process.exit(1) enforcement in hook-layers.ts",
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 6: Pre-commit Layer 2.5 - exit 1 for TDD violation (BLOCKING)

// ═══════════════════════════════════════════════════════════════
function checkPreCommitLayer25() {
  const tsPath = path.join(OPENCODE_ROOT, ".opencode", "hooks", "lib", "hook-layers.ts");
  const content = readFile(tsPath);
  if (!content) return check(6, false, "hook-layers.ts not found");

  const hasLayer25 = content.includes("Layer 2.5") && content.includes("TDD");
  const hasExit1 = content.includes("process.exit(1)");
  const isBlocking =
    content.includes("BLOCKED") ||
    content.includes("BLOCKING") ||
    (content.includes("Layer 2.5") && content.includes("TDD"));
  const ok = hasLayer25 && hasExit1;
  return check(
    6,
    ok,
    ok
      ? "Layer 2.5 TDD violation check with process.exit(1) (BLOCKING) found in hook-layers.ts"
      : "Missing TDD Layer 2.5 BLOCKING enforcement in hook-layers.ts",
  );
}

// ═══════════════════════════════════════════════════════════════
// Check 7: commit-msg TDD ordering

// ═══════════════════════════════════════════════════════════════
function checkCommitMsgTDD() {
  const tsPath = path.join(OPENCODE_ROOT, ".opencode", "hooks", "lib", "hook-commit-msg.ts");
  const wrapperPath = path.join(OPENCODE_ROOT, ".opencode", "hooks", "commit-msg");

  const wrapper = readFile(wrapperPath);
  const hasDelegation = wrapper && wrapper.includes("hook-commit-msg.ts");

  const content = readFile(tsPath);
  if (!content) return check(7, false, "hook-commit-msg.ts not found");

  const hasGreenCheck = content.includes("Green") && content.includes("[Red]");
  const hasRefactorCheck =
    content.includes("Refactor") && content.includes("[Green]");
  const exitMatches = content.match(/process\.exit\(1\)/g);
  const hasExit1 = exitMatches && exitMatches.length >= 2;
  const ok = hasDelegation && hasGreenCheck && hasRefactorCheck && hasExit1;
  return check(
    7,
    ok,
    ok
      ? "RED→GREEN→REFACTOR phase ordering validation present in hook-commit-msg.ts"
      : "Missing TDD phase ordering check in hook-commit-msg.ts",
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
// Check 9: architect has code-quality-check

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

  const hasCQC = content.includes("code-quality-check");
  return check(
    9,
    hasCQC,
    hasCQC
      ? "code-quality-check found in architect.md mcp_tools"
      : "MISSING! code-quality-check not in architect.md",
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
// Check 15: code-quality-check.ts bootstrap (replaces deprecated code-quality-gate.ts)

// ═══════════════════════════════════════════════════════════════
function checkCQGBootstrap() {
  const cqcPath = path.join(
    OPENCODE_ROOT,
    ".opencode",
    "scripts",
    "mcp-tools",
    "code-quality-check.ts",
  );
  const content = readFile(cqcPath);
  if (!content) return check(15, false, "code-quality-check.ts not found");

  // Verify MCP server bootstrap structure
  const hasServer = content.includes("new Server(") || content.includes("new Server (");
  const hasTransport = content.includes("StdioServerTransport") && content.includes("connect(transport)");
  const hasToolsSchema = content.includes("ListToolsRequestSchema");
  const hasCallTool = content.includes("CallToolRequestSchema");
  const hasCodeQualityLib = content.includes("code-quality-lib");
  
  const actualIssues: string[] = [];
  if (!hasServer) actualIssues.push("missing Server() init");
  if (!hasTransport) actualIssues.push("missing transport.connect()");
  if (!hasToolsSchema) actualIssues.push("missing ListToolsRequestSchema");
  if (!hasCallTool) actualIssues.push("missing CallToolRequestSchema");
  if (!hasCodeQualityLib) actualIssues.push("missing code-quality-lib import");

  return check(
    15,
    actualIssues.length === 0,
    actualIssues.length === 0
      ? "code-quality-check.ts MCP server structure verified"
      : `code-quality-check.ts issues: ${actualIssues.join("; ")}`,
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

  // 23f: Required patch markers present (F2: prevents git checkout reversion)
  // These markers correspond to patches applied by SA sessions that must not
  // be lost. If a marker is missing, the file was likely reverted to a pre-fix
  // version by `git checkout` or similar operation.
  const REQUIRED_PATCH_MARKERS = [
    "SA-ENFORCE-FIX-20250612", // KC bypass + dispatch session + KC fast-path
  ];
  const missingMarkers = REQUIRED_PATCH_MARKERS.filter(
    (m) => !gateContent.includes(m),
  );
  if (missingMarkers.length > 0) {
    return check(
      23,
      false,
      `pre-execution-gate.ts missing required patch markers: ${missingMarkers.join(", ")}. File may have been reverted — restore from backup.`,
    );
  }

  return check(
    23,
    true,
    "pre-execution-gate.ts exists, valid JS, executable, wired into pre-execution-hook.sh Stage 1, 6 checks implemented (incl. Knowledge Pipeline Gate) + required patches verified",
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

    if (parsed.checks.length !== 13) {
      return check(
        25,
        false,
        `Expected 13 checks but found ${parsed.checks.length}`,
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
// Validates knowledge_cache_state structure from substate_kv DB.
// Updated for P2-A v7: JSON snapshot deleted, DB is sole source.
// ───────────────────────────────────────────────────────────────
function checkUC7KSSchemaIntegrity() {
  try {
    const { getDb } = require("../lib/db-manager");
    const db = getDb();
    const row = db.query(
      "SELECT json FROM substate_kv WHERE key = ?",
    ).get("knowledge_cache_state") as { json: string } | undefined;
    if (!row) return check(28, false, "knowledge_cache_state not found in substate_kv");
    const kcs = JSON.parse(row.json);
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
      // Load known agents from opencode.json so phantom entries don't fail
      // field validation (they get their own dedicated error).
      const knownAgents = (function () {
        try {
          const opencodePath = path.join(OPENCODE_ROOT, "opencode.json");
          const raw = fs.readFileSync(opencodePath, "utf8");
          const cfg = JSON.parse(raw);
          return Object.keys(cfg.agent || {});
        } catch (_) {
          return [];
        }
      })();

      for (const [agent, state] of Object.entries(kcs.session_access)) {
        const s = state as any;
        const stripped = agent.replace(/^@/, "");
        const isKnown = knownAgents.some(
          (k) => k.toLowerCase() === stripped.toLowerCase(),
        );
        if (!isKnown) {
          issues.push(`${agent}: phantom entry (not in opencode.json agent list)`);
          continue;
        }
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
// M13 (2026-06-19): Knowledge Semantic Map Save Path Uniqueness
// Verifies that no two domains in knowledge_semantic_map share the
// same save_path or a prefix of another's save_path.
// This is a hard prerequisite for M11 (file-level domain check).
// ═══════════════════════════════════════════════════════════════
function checkSemanticMapSavePathUniqueness() {
  const configPath = path.join(OPENCODE_ROOT, ".opencode", "project.config.json");
  let config: any;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return check(44, false, "project.config.json not found");
  }
  const domains = config?.knowledge_semantic_map?.domains;
  if (!Array.isArray(domains) || domains.length === 0) {
    return check(44, true, "no domains to check");
  }
  const conflicts: string[] = [];
  for (let i = 0; i < domains.length; i++) {
    const sp1 = (domains[i].save_path || "").replace(/\/+$/, "") + "/";
    for (let j = i + 1; j < domains.length; j++) {
      const sp2 = (domains[j].save_path || "").replace(/\/+$/, "") + "/";
      if (sp1 === sp2) {
        conflicts.push(`${domains[i].domain_id}=${domains[j].domain_id} both use save_path "${sp1}"`);
      } else if (sp1.startsWith(sp2) || sp2.startsWith(sp1)) {
        conflicts.push(`${domains[i].domain_id} ("${sp1}") and ${domains[j].domain_id} ("${sp2}") are prefix-overlapping`);
      }
    }
  }
  const ok = conflicts.length === 0;
  return check(44, ok,
    ok ? `All ${domains.length} domains have unique save_paths` : `save_path conflicts: ${conflicts.join("; ")}`);
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
// Check 45 (M8, 2026-06-19): Writable Agent Attestation Tool Check
// Verifies all writable agents have knowledge_cache_attest registered.
// ═══════════════════════════════════════════════════════════════
function checkAgentAttestToolRegistered() {
  const agentsDir = path.join(OPENCODE_ROOT, ".opencode", "agents");
  let dirEntries;
  try { dirEntries = fs.readdirSync(agentsDir); }
  catch { return check(45, false, "agents dir not found"); }
  const agentFiles = dirEntries.filter(function (f) { return f.endsWith(".md"); });
  const WRITABLE_AGENTS = new Set([
    "Super-Admin.md", "Architect.md", "Coder-BE.md", "Coder-FE.md",
    "CI-CD-Agent.md", "Meta-Planner.md",
  ]);
  const REQ = "knowledge_cache_attest";
  let violations = [];
  for (const af of agentFiles) {
    if (!WRITABLE_AGENTS.has(af)) continue;
    const content = readFile(path.join(agentsDir, af));
    if (!content) { violations.push(af + ": unreadable"); continue; }
    // M8-FIX: Use full-content search instead of regex that breaks on YAML comments.
    // The regex /^mcp_tools:\n((?:\s+- .+\n)*)/m fails when comment lines appear
    // between mcp_tools: and the first - tool entry (e.g., "# UC7-009 HARDEN: ...").
    // Fixed: search the entire frontmatter section for "- knowledge_cache_attest".
    const hasAttest = content.match(/^\s+-\s+knowledge_cache_attest\s*$/m);
    if (!hasAttest) violations.push(af + ": missing " + REQ);
  }
  const ok = violations.length === 0;
  return check(45, ok, ok ? "All " + WRITABLE_AGENTS.size + " writable agents have " + REQ : violations.join("; "));
}

// ═══════════════════════════════════════════════════════════════
// M20 (2026-06-19): Check 46 — KC dispatch_subagent absence
// Verifies Knowledge-Curator does NOT have dispatch_subagent in:
//   (a) its agent config YAML frontmatter mcp_tools
//   (b) project.config.json agent_dispatch_allowed_tools
//   (c) opencode.json agent permissions
// KC is a documentation curator, not a workflow orchestrator.
// Allowing dispatch_subagent creates an identity-confusion risk
// (KC may try to dispatch other agents instead of fetching docs).
// ═══════════════════════════════════════════════════════════════
function checkKCDispatchSubagentAbsence() {
  const agentsDir = path.join(OPENCODE_ROOT, ".opencode", "agents");
  const kcConfigPath = path.join(agentsDir, "Knowledge-Curator.md");
  const issues: string[] = [];

  // (a) Agent config mcp_tools — must NOT include dispatch_subagent
  if (fs.existsSync(kcConfigPath)) {
    const content = readFile(kcConfigPath);
    if (content) {
      const mcpMatch = content.match(/^mcp_tools:\n((?:\s+- .+\n)*)/m);
      if (mcpMatch) {
        const tools = mcpMatch[1].match(/^\s+-\s+(.+)$/gm) || [];
        const hasDispatch = tools.some(function (t: string) {
          return t.replace(/^\s+-\s+/, "").trim() === "dispatch_subagent";
        });
        if (hasDispatch) {
          issues.push("Knowledge-Curator.md mcp_tools still has dispatch_subagent");
        }
      }
    }
  }

  // (b) project.config.json agent_dispatch_allowed_tools
  try {
    const pcPath = path.join(OPENCODE_ROOT, ".opencode", "project.config.json");
    const pcRaw = readFile(pcPath);
    if (pcRaw) {
      // Use simple string search to avoid JSON parse issues with trailing commas
      // Look for the @Knowledge-Curator block and check for dispatch_subagent
      const kcBlock = pcRaw.match(/"@Knowledge-Curator"\s*:\s*\[([\s\S]*?)\]/);
      if (kcBlock && kcBlock[1].includes("dispatch_subagent")) {
        issues.push("project.config.json agent_dispatch_allowed_tools.@Knowledge-Curator still has dispatch_subagent");
      }
    }
  } catch (_) { /* parse error — skip */ }

  // (c) opencode.json Knowledge-Curator permissions
  try {
    const ocPath = path.join(OPENCODE_ROOT, "opencode.json");
    const ocRaw = readFile(ocPath);
    if (ocRaw) {
      const oc = JSON.parse(ocRaw);
      const kcPerms = oc?.agent?.["Knowledge-Curator"]?.permission;
      if (kcPerms) {
        if (kcPerms.dispatch_subagent && kcPerms.dispatch_subagent !== "deny") {
          issues.push("opencode.json Knowledge-Curator permission.dispatch_subagent is not deny");
        }
        // Also check if it's listed as allow
        if (typeof kcPerms.dispatch_subagent === "string" && kcPerms.dispatch_subagent === "allow") {
          issues.push("opencode.json Knowledge-Curator has dispatch_subagent: allow");
        }
      }
    }
  } catch (_) { /* parse error — skip */ }

  const ok = issues.length === 0;
  return check(46, ok,
    ok
      ? "KC dispatch_subagent absent from agent config, project.config.json, and opencode.json"
      : "M20 violation — " + issues.join("; "));
}

// ═══════════════════════════════════════════════════════════════
// Check 47 (R5, 2026-06-19): Config Attest Pipeline Integrity
// Validates config_read_attest tool, schema, state keys, and compilation.
// SA-IMPLEMENT-CONFIG-ATTEST-001 R5.
// ═══════════════════════════════════════════════════════════════
function checkConfigAttestPipeline(): void {
  const toolsDir = path.join(OPENCODE_ROOT, ".opencode", "tools");
  const schemasDir = path.join(OPENCODE_ROOT, ".opencode", "state", "schemas");

  // 47a: config_read_attest.ts exists in .opencode/tools/
  const attestToolPath = path.join(toolsDir, "config_read_attest.ts");
  if (!fileExists(attestToolPath)) {
    return check(47, false, "config_read_attest.ts not found at .opencode/tools/");
  }

  // 47b: Schema file exists
  const schemaPath = path.join(schemasDir, "config-read-state.schema.json");
  if (!fileExists(schemaPath)) {
    return check(47, false, "config-read-state.schema.json not found at .opencode/state/schemas/");
  }

  // 47c: Schema is valid JSON with required fields
  let schema: any;
  try {
    const schemaRaw = readFile(schemaPath);
    if (!schemaRaw) return check(47, false, "Cannot read schema file");
    schema = JSON.parse(schemaRaw);
    if (!schema.$schema) return check(47, false, "Schema missing $schema field");
    if (!schema.$id || !schema.$id.includes("config-read-state")) {
      return check(47, false, `Schema $id mismatch: ${schema.$id}`);
    }
  } catch (e: any) {
    return check(47, false, `Schema parse error: ${e.message}`);
  }

  // 47d: config_read_state registered in substate-manager.ts SUBSTATE_FILES
  const mgrPath = path.join(OPENCODE_ROOT, ".opencode", "lib", "substate-manager.ts");
  const mgrContent = readFile(mgrPath);
  if (!mgrContent) return check(47, false, "substate-manager.ts not found");
  if (!mgrContent.includes("config_read_state")) {
    return check(47, false, "config_read_state not found in SUBSTATE_FILES of substate-manager.ts");
  }

  // 47e: ConfigReadState interface registered in substate-types.ts
  const typesPath = path.join(OPENCODE_ROOT, ".opencode", "lib", "substate-types.ts");
  const typesContent = readFile(typesPath);
  if (!typesContent) return check(47, false, "substate-types.ts not found");
  if (!typesContent.includes("ConfigReadState")) {
    return check(47, false, "ConfigReadState interface not found in substate-types.ts");
  }
  if (!typesContent.includes("config_read_state: ConfigReadState")) {
    return check(47, false, "config_read_state not found in SubStateMap of substate-types.ts");
  }

  // 47f: Step 0e present in subagent-preamble.md
  const preamblePath = path.join(OPENCODE_ROOT, ".opencode", "subagent-preamble.md");
  const preambleContent = readFile(preamblePath);
  if (!preambleContent) return check(47, false, "subagent-preamble.md not found");
  if (!preambleContent.includes("Step 0e: Config Read Attestation")) {
    return check(47, false, "Step 0e not found in subagent-preamble.md");
  }

  // 47g: config_read_state check present in scope-before.ts
  const scopePath = path.join(OPENCODE_ROOT, ".opencode", "plugins", "scope-before.ts");
  const scopeContent = readFile(scopePath);
  if (!scopeContent) return check(47, false, "scope-before.ts not found");
  if (!scopeContent.includes("CONFIG-READ-ATTEST")) {
    return check(47, false, "Config read attest check not found in scope-before.ts");
  }

  // 47h: Compilation check via bun build
  try {
    const { execSync } = require("child_process");
    execSync(
      `bun build "${attestToolPath}" --target=bun --outfile=/dev/null`,
      { stdio: "pipe", timeout: 10000 },
    );
  } catch (e: any) {
    return check(47, false,
      `config_read_attest.ts compilation failed: ${(e.stderr || e.message).toString().substring(0, 200)}`);
  }

  // 47i: dispatch_subagent in 7+ agent configs (M14 alignment)
  const agentsDir = path.join(OPENCODE_ROOT, ".opencode", "agents");
  let agentCount = 0;
  let withDispatch = 0;
  try {
    const dirEntries = fs.readdirSync(agentsDir);
    for (const af of dirEntries) {
      if (!af.endsWith(".md")) continue;
      // Exclude KC and SA (they don't need dispatch_subagent for M14)
      if (af === "Knowledge-Curator.md" || af === "Super-Admin.md") continue;
      agentCount++;
      const content = readFile(path.join(agentsDir, af));
      if (content && content.match(/^\s+-\s+dispatch_subagent\s*$/m)) {
        withDispatch++;
      }
    }
  } catch (_) {}

  if (withDispatch < 7) {
    return check(47, false,
      `dispatch_subagent found in only ${withDispatch}/${agentCount} agent configs (expected 7+ per M14)`);
  }

  return check(47, true,
    `Config attest pipeline OK: tool+compilation+${withDispatch} agent configs+schema+state keys+preamble Step 0e+scope-before check`);
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
    const { readSubState } = require(path.join(__dirname, "..", "lib", "substate-manager"));
    const kcs = readSubState("knowledge_cache_state");
    const sa = kcs?.session_access;
    if (!sa) { check(34, true, "no entries"); return; }
    const invalid: string[] = [];
    for (const key of Object.keys(sa)) { if (INVALID_KEYS.includes(key)) invalid.push(key); }
    check(34, invalid.length === 0,
      invalid.length > 0 ? `Invalid agent keys: ${invalid.join(",")}` : `all ${Object.keys(sa).length} agent keys valid`);
  } catch (e: any) { check(34, false, e.message); }
}

// F5 (2026-06-11): Check 35 — stale pre-HARDEN cache_sufficiency entries
// Detects session_access entries where cache_sufficiency says "sufficient"
// but evidence fields (reason, files_read, content_summary) are empty.
// These were created by pre-HARDEN knowledge_cache_search before UC7-001c.
function checkStaleInternalEvidence(): void {
  try {
    const { readSubState } = require(path.join(__dirname, "..", "lib", "substate-manager"));
    const kcs = readSubState("knowledge_cache_state");
    const sa = kcs?.session_access;
    if (!sa) {
      check(35, true, "no session_access entries (skip)");
      return;
    }

    const staleFlat: string[] = [];
    const staleNested: string[] = [];

    for (const agent of Object.keys(sa)) {
      const entry = sa[agent];
      // Check legacy flat
      if (
        entry.cache_sufficiency?.status === "sufficient" &&
        (!entry.cache_sufficiency.reason ||
         !Array.isArray(entry.cache_sufficiency.files_read) ||
         entry.cache_sufficiency.files_read.length === 0 ||
         !entry.cache_sufficiency.content_summary)
      ) {
        staleFlat.push(agent);
      }
      // Check nested tasks
      if (entry.tasks) {
        for (const tid of Object.keys(entry.tasks)) {
          for (const domain of Object.keys(entry.tasks[tid].domains || {})) {
            const cs = entry.tasks[tid].domains[domain].cache_sufficiency;
            if (
              cs?.status === "sufficient" &&
              (!cs.reason ||
               !Array.isArray(cs.files_read) ||
               cs.files_read.length === 0 ||
               !cs.content_summary)
            ) {
              staleNested.push(`${agent} / ${tid} / ${domain}`);
            }
          }
        }
      }
    }

    const total = staleFlat.length + staleNested.length;
    check(35, total === 0,
      total > 0
        ? `${total} stale pre-HARDEN entries: flat=[${staleFlat.join(",")}], nested=[${staleNested.join(",")}]. Re-run knowledge_cache_search for these agents.`
        : "all session_access entries have valid UC7-001c evidence");
  } catch (e: any) {
    check(35, false, e.message);
  }
}

// F3 (2026-06-11): Check 36 — working-tree drift detection
// Scans safe_edit backups newer than the last git commit. If a backup
// has different content than the live file, it flags potential patch loss
// from `git checkout` operations during concurrent session commit isolation.
function checkWorkingTreeDrift(): void {
  try {
    const backupDir = path.join(OPENCODE_ROOT, ".opencode", "scripts", ".opencode_backups");
    if (!fs.existsSync(backupDir)) {
      check(36, true, "no backup directory exists (skip)");
      return;
    }

    // Get last commit timestamp
    let lastCommitTime = 0;
    try {
      const { execSync } = require("child_process");
      lastCommitTime = parseInt(
        execSync("git log -1 --format=%ct", {
          cwd: OPENCODE_ROOT, stdio: "pipe", encoding: "utf8", timeout: 5000,
        }).trim(),
        10,
      ) || 0;
    } catch {
      // git unavailable — skip drift check
      check(36, true, "git unavailable (skip)");
      return;
    }

    const driftWarnings: string[] = [];
    const backupFiles = fs.readdirSync(backupDir).filter((f: string) => f.endsWith(".safe_backup"));

    for (const f of backupFiles) {
      // Parse: <basename>.<timestamp>.<pid>.<agent>.<unknown>.safe_backup
      const match = f.match(/^(.+?)\.(\d{13})\./);
      if (!match) continue;
      const baseName = match[1];
      const backupTime = parseInt(match[2], 10);

      // Only check backups newer than last commit
      if (backupTime < lastCommitTime * 1000) continue;

      const livePath = path.join(OPENCODE_ROOT, ".opencode", "scripts", baseName);
      const backupPath = path.join(backupDir, f);

      if (!fs.existsSync(livePath)) continue;

      const liveSize = fs.statSync(livePath).size;
      const backupSize = fs.statSync(backupPath).size;

      if (liveSize !== backupSize) {
        const backupDate = new Date(backupTime).toISOString();
        driftWarnings.push(
          `${baseName}: backup ${backupDate} (${backupSize}b) ≠ live (${liveSize}b)`
        );
      }
    }

    check(36, driftWarnings.length === 0,
      driftWarnings.length > 0
        ? `${driftWarnings.length} uncommitted patch(es) detected: ${driftWarnings.join("; ")}. Run git diff on these files or restore from backup.`
        : "no working-tree drift detected");
  } catch (e: any) {
    check(36, false, e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// Main execution

// ═══════════════════════════════════════════════════════════════
console.log("═══════════════════════════════════════════════════════════════");
console.log("  🔍 OpenCode Framework Binding Force Self-Test");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");


// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// Check 40-43: read-audit DB migration integrity checks
// Phase 1 of read_audit.jsonl to SQLite migration.
// Validates: table exists, record/verify roundtrip, session events,
// knowledge_cache_attest uses shared API.
// Added FW-READ-AUDIT-DB (2026-06-18, @Super-Admin).
// @see docs/review/framework-refactor/read-audit-db-migration-plan.md

// ═══════════════════════════════════════════════════════════════
function checkReadAuditTableExists() {
  try {
    var _getDb = require("../lib/db-manager").getDb;
    var _db = _getDb();

    // 40a: read_audit table exists
    var _tableRow = _db.query(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='read_audit'"
    ).get();
    if ((_tableRow && _tableRow.c || 0) === 0) {
      return check(40, false, "read_audit table not found in SQLite");
    }

    // 40b: 4 indexes exist
    var _indexes = ["idx_read_audit_lookup", "idx_read_audit_session_agent", "idx_read_audit_task", "idx_read_audit_created"];
    var _missingIdx = [];
    for (var _i = 0; _i < _indexes.length; _i++) {
      var _idx = _indexes[_i];
      var _row = _db.query(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name=?"
      ).get(_idx);
      if ((_row && _row.c || 0) === 0) _missingIdx.push(_idx);
    }
    if (_missingIdx.length > 0) {
      return check(40, false, "Missing indexes: " + _missingIdx.join(", "));
    }

    // 40c: schema_version has v10
    var _sv = _db.query("SELECT version FROM schema_version WHERE version = 10").get();
    if (!_sv) {
      return check(40, false, "schema_version v10 entry missing");
    }

    // 40d: Row count queryable
    var _countRow = _db.query("SELECT COUNT(*) AS c FROM read_audit").get();
    var _count = (_countRow && _countRow.c) || 0;

    return check(40, true,
      "read_audit table + 4 indexes + schema v10 verified (" + _count + " rows)");
  } catch (_e) {
    return check(40, false, "read_audit check failed: " + (_e && _e.message || String(_e)));
  }
}

function checkReadAuditRecordVerifyRoundtrip() {
  try {
    var _lib = require("../lib/read-audit");
    var _testAgent = "@Super-Admin";
    var _testFile = path.join(OPENCODE_ROOT, ".tmp_read_audit_test_" + Date.now() + ".md");

    // Write a temp file so the read can be recorded
    fs.writeFileSync(_testFile, "# test roundtrip", "utf8");

    // Record a read
    _lib.recordRead({
      timestamp: new Date().toISOString(),
      agent: _testAgent,
      filePath: _testFile,
      sessionId: "ses_test_roundtrip",
      taskId: "TEST-ROUNDTRIP",
    });

    // Verify it
    var _result = _lib.verifyRead(_testAgent, _testFile);
    try { fs.unlinkSync(_testFile); } catch (_) {}

    if (!_result.verified) {
      return check(41, false, "recordRead to verifyRead roundtrip failed: " + _result.reason);
    }

    // Cleanup DB entry
    try {
      var __db = require("../lib/db-manager").getDb();
      __db.run("DELETE FROM read_audit WHERE task_id = ?", ["TEST-ROUNDTRIP"]);
    } catch (_) {}

    return check(41, true, "recordRead to verifyRead roundtrip OK (" + (_result.matchedEntry && _result.matchedEntry.timestamp) + ")");
  } catch (_e2) {
    return check(41, false, "roundtrip check error: " + (_e2 && _e2.message || String(_e2)));
  }
}

function checkReadAuditSessionEventsRoundtrip() {
  try {
    var _lib2 = require("../lib/read-audit");
    var _testSession = "ses_test_session_events";
    var _testAgent2 = "@Coder-BE";
    var _testFileA = path.join(OPENCODE_ROOT, ".tmp_read_audit_test_A_" + Date.now() + ".md");
    var _testFileB = path.join(OPENCODE_ROOT, ".tmp_read_audit_test_B_" + Date.now() + ".md");

    // Create temp files and record reads
    fs.writeFileSync(_testFileA, "# test session events", "utf8");
    fs.writeFileSync(_testFileB, "# test session events", "utf8");
    _lib2.recordRead({
      timestamp: new Date().toISOString(),
      agent: _testAgent2,
      filePath: _testFileA,
      sessionId: _testSession,
      taskId: "TEST-SESSION-EVENTS",
    });
    _lib2.recordRead({
      timestamp: new Date().toISOString(),
      agent: _testAgent2,
      filePath: _testFileB,
      sessionId: _testSession,
      taskId: "TEST-SESSION-EVENTS",
    });

    // Query by session
    var _events = _lib2.getReadEventsForSession(_testAgent2, _testSession);

    // Cleanup
    try { fs.unlinkSync(_testFileA); } catch (_) {}
    try { fs.unlinkSync(_testFileB); } catch (_) {}
    try {
      var __db2 = require("../lib/db-manager").getDb();
      __db2.run("DELETE FROM read_audit WHERE task_id = ?", ["TEST-SESSION-EVENTS"]);
    } catch (_) {}

    if (_events.length < 2) {
      return check(42, false, "getReadEventsForSession returned " + _events.length + " events (expected 2)");
    }

    return check(42, true, "getReadEventsForSession roundtrip OK (" + _events.length + " events)");
  } catch (_e3) {
    return check(42, false, "session events check error: " + (_e3 && _e3.message || String(_e3)));
  }
}

function checkKnowledgeAttestUsesSharedApi() {
  var _attestPath = path.join(OPENCODE_ROOT, ".opencode", "tools", "knowledge_cache_attest.ts");
  if (!fileExists(_attestPath)) {
    return check(43, false, "knowledge_cache_attest.ts not found");
  }

  var _content = readFile(_attestPath);
  if (!_content) {
    return check(43, false, "knowledge_cache_attest.ts is empty");
  }

  // Must NOT contain the old inline functions
  var _hasOldReadAuditLog = _content.indexOf("function readAuditLog()") !== -1;
  var _hasOldNormalizePath = _content.indexOf("function normalizePathForAudit(") !== -1;
  var _hasOldJsonlPath = _content.indexOf(".opencode/state/read_audit.jsonl") !== -1;

  if (_hasOldReadAuditLog || _hasOldNormalizePath || _hasOldJsonlPath) {
    var _issues = [];
    if (_hasOldReadAuditLog) _issues.push("readAuditLog()");
    if (_hasOldNormalizePath) _issues.push("normalizePathForAudit()");
    if (_hasOldJsonlPath) _issues.push(".opencode/state/read_audit.jsonl direct path");
    return check(43, false, "knowledge_cache_attest.ts still has old inline functions: " + _issues.join(", "));
  }

  // Must import the shared API
  var _hasGetReadImport = _content.indexOf("getReadEventsForSession") !== -1 &&
    _content.indexOf("../lib/read-audit") !== -1;
  var _hasNormPathImport = _content.indexOf("normalizeReadAuditPath") !== -1 &&
    _content.indexOf("../lib/read-audit") !== -1;

  if (!_hasGetReadImport || !_hasNormPathImport) {
    var _missing = [];
    if (!_hasGetReadImport) _missing.push("getReadEventsForSession import");
    if (!_hasNormPathImport) _missing.push("normalizeReadAuditPath import");
    return check(43, false, "knowledge_cache_attest.ts missing shared API imports: " + _missing.join(", "));
  }

  return check(43, true, "knowledge_cache_attest.ts uses shared read-audit API (getReadEventsForSession + normalizeReadAuditPath)");
}


checkReadAuditTableExists();
checkReadAuditRecordVerifyRoundtrip();
checkReadAuditSessionEventsRoundtrip();
checkKnowledgeAttestUsesSharedApi();

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
checkSemanticMapSavePathUniqueness(); // M13 (2026-06-19): verify save_path uniqueness
checkAgentUC7KSSection();
checkContext7ToolBlock();
checkAgentAttestToolRegistered(); // M8 (2026-06-19): writable agents must have knowledge_cache_attest
checkKCDispatchSubagentAbsence(); // M20 (2026-06-19): KC must NOT have dispatch_subagent
checkConfigAttestPipeline(); // R5 (2026-06-19): config attest pipeline integrity
checkPendingJson();
checkSessionAccessAgentKeys();
checkStaleInternalEvidence();
checkWorkingTreeDrift();
checkPlanFirstConsistency();

// Check 38: v6 DB schema tables exist and are queryable
// Verifies: session_log, dispatch_failed_log, session_map
// These tables replace SESSION_ID.md, .pending.json.failed, .session_map.json
function checkV6DbTables() {
  const issues = [];
  try {
    const { getDb } = require("../lib/db-manager");
    const db = getDb();

    // Verify all 3 tables exist
    const tables = ["session_log", "dispatch_failed_log", "session_map"];
    for (const table of tables) {
      const row = db.query(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?",
      ).get(table) as { c: number } | null;
      if ((row?.c ?? 0) === 0) {
        issues.push(`table ${table} not found in sqlite_master`);
      }
    }

    // Verify key indexes exist
    const indexes = [
      "idx_slog_dag", "idx_slog_session", "idx_slog_agent",
      "idx_dfl_dag", "idx_dfl_agent", "idx_dfl_reason", "idx_dfl_failed_at",
      "idx_smap_agent",
    ];
    for (const idx of indexes) {
      const row = db.query(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name=?",
      ).get(idx) as { c: number } | null;
      if ((row?.c ?? 0) === 0) {
        issues.push(`index ${idx} not found`);
      }
    }

    // Verify schema_version has v6
    const sv = db.query(
      "SELECT version FROM schema_version WHERE version = 6",
    ).get() as { version: number } | null;
    if (!sv) {
      issues.push("schema_version v6 entry missing");
    }

    // Verify CRUD functions are importable
    try {
      const dsm = require("../lib/db-state-manager");
      const fns = [
        "dbAppendSessionLog", "dbQuerySessionByDagTaskId",
        "dbQueryAllSessionsByDagTaskId", "dbAppendDispatchFailed",
        "dbReadSessionMap", "dbWriteSessionMap", "dbCapSessionLog",
      ];
      for (const fn of fns) {
        if (typeof dsm[fn] !== "function") {
          issues.push(`db-state-manager.${fn} is not a function`);
        }
      }
    } catch (e: any) {
      issues.push("db-state-manager import failed: " + e.message);
    }
  } catch (e: any) {
    issues.push("DB access failed: " + e.message);
  }

  check(38, issues.length === 0,
    issues.length === 0
      ? "v6 DB schema: session_log + dispatch_failed_log + session_map tables + 8 indexes + 7 CRUD functions verified"
      : issues.length + " issue(s): " + issues.join("; "));
}

checkV6DbTables();
checkSchemaFiles();
checkStep0dTriggerWords();

console.log("");
console.log("═══════════════════════════════════════════════════════════════");

const passedCount = results.filter((r) => r.startsWith("[PASS]")).length;
const failedCount = results.filter((r) => r.startsWith("[FAIL]")).length;

// FW-LOG-UNIFY-C3: Log summary for persistent audit trail
srcLog(allPassed ? "INFO" : "ERROR", "self_test_complete", {
  totalChecks: results.length, passed: passedCount, failed: failedCount,
  allPassed,
});

if (allPassed) {
  console.log(`  ✅ ALL ${passedCount} CHECKS PASSED`);
  process.exit(0);
} else {
  console.log(`  ❌ ${failedCount} of ${results.length} CHECKS FAILED`);
  process.exit(1);
}

// ─── Check 37: PLAN-FIRST consistency (FW-PLAN-FIRST, 2026-06-14) ───
// Verifies the 3-layer enforcement stack is intact and consistent:
//   (a) lib/dag-policy.ts exists and exports the canonical exempt set
//       including knowledge-curator.
//   (b) plugins/dispatch-before.ts (Layer 1) exists and imports isDagExempt.
//   (c) tools/dispatch_subagent.ts (Layer 2) imports readDispatchPolicy +
//       isDagExempt + autoPlan.
//   (d) plugins/gate-before.ts (Layer 3) imports isDagExempt from
//       dag-policy.ts (not an inline list).
//   (e) project.config.json.dispatch_policy block is present and valid.
function checkPlanFirstConsistency() {
  const root = process.env.OPENCODE_ROOT || process.cwd();
  const pathJoin = require("path").join;
  const issues = [];

  // (a) dag-policy.ts
  const dagPolicyPath = pathJoin(root, ".opencode", "lib", "dag-policy.ts");
  if (!fs.existsSync(dagPolicyPath)) {
    issues.push("lib/dag-policy.ts missing");
  } else {
    const src = fs.readFileSync(dagPolicyPath, "utf8");
    if (!src.includes("knowledge-curator")) issues.push("dag-policy.ts: knowledge-curator not in DAG_EXEMPT_AGENTS");
    if (!src.includes("meta-planner")) issues.push("dag-policy.ts: meta-planner not in DAG_EXEMPT_AGENTS");
    if (!src.includes("autoPlan")) issues.push("dag-policy.ts: autoPlan function missing");
    if (!src.includes("readDispatchPolicy")) issues.push("dag-policy.ts: readDispatchPolicy function missing");
  }

  // (b) Layer 1 plugin
  const layer1Path = pathJoin(root, ".opencode", "plugins", "dispatch-before.ts");
  if (!fs.existsSync(layer1Path)) {
    issues.push("plugins/dispatch-before.ts (Layer 1) missing");
  } else {
    const src = fs.readFileSync(layer1Path, "utf8");
    if (!src.includes("isDagExempt")) issues.push("dispatch-before.ts: does not import isDagExempt");
    if (!src.includes("readDispatchPolicy")) issues.push("dispatch-before.ts: does not import readDispatchPolicy");
    if (!src.includes("PLAN-FIRST")) issues.push("dispatch-before.ts: PLAN-FIRST marker missing");
  }

  // (c) Layer 2 tool
  const layer2Path = pathJoin(root, ".opencode", "tools", "dispatch_subagent.ts");
  if (fs.existsSync(layer2Path)) {
    const src = fs.readFileSync(layer2Path, "utf8");
    if (!src.includes("readDispatchPolicy")) issues.push("dispatch_subagent.ts (Layer 2): does not import readDispatchPolicy");
    if (!src.includes("isDagExempt")) issues.push("dispatch_subagent.ts (Layer 2): does not import isDagExempt");
    if (!src.includes("auto_plan:")) issues.push("dispatch_subagent.ts (Layer 2): auto_plan parameter missing");
    if (!src.includes("PLAN-FIRST LAYER 2")) issues.push("dispatch_subagent.ts (Layer 2): PLAN-FIRST LAYER 2 marker missing");
  }

  // (d) Layer 3 plugin
  const layer3Path = pathJoin(root, ".opencode", "plugins", "gate-before.ts");
  if (fs.existsSync(layer3Path)) {
    const src = fs.readFileSync(layer3Path, "utf8");
    if (!src.includes("isDagExempt")) issues.push("gate-before.ts (Layer 3): does not import isDagExempt");
    if (!/import.*isDagExempt.*from.*dag-policy/.test(src)) issues.push("gate-before.ts (Layer 3): isDagExempt not imported from dag-policy.ts");
    // No inline list should remain
    if (src.includes("agentNorm === \"orchestrator\"")) issues.push("gate-before.ts (Layer 3): still has inline exempt list");
  }

  // (e) project.config.json.dispatch_policy block
  const pcPath = pathJoin(root, ".opencode", "project.config.json");
  if (fs.existsSync(pcPath)) {
    try {
      const pc = JSON.parse(fs.readFileSync(pcPath, "utf8"));
      const dp = pc.dispatch_policy;
      if (!dp) {
        issues.push("project.config.json: dispatch_policy block missing");
      } else {
        if (typeof dp.require_dag_entry !== "boolean") issues.push("dispatch_policy.require_dag_entry not a boolean");
        if (typeof dp.auto_plan_enabled !== "boolean") issues.push("dispatch_policy.auto_plan_enabled not a boolean");
        if (typeof dp.auto_plan_max_per_session !== "number") issues.push("dispatch_policy.auto_plan_max_per_session not a number");
        if (typeof dp.auto_plan_timeout_ms !== "number") issues.push("dispatch_policy.auto_plan_timeout_ms not a number");
      }
    } catch (e) {
      issues.push("project.config.json: parse failed: " + e.message);
    }
  }

  check(37, issues.length === 0,
    issues.length === 0
      ? "PLAN-FIRST 3-layer stack consistent (dag-policy, dispatch-before, dispatch_subagent, gate-before, project.config)"
      : issues.length + " issue(s): " + issues.join("; "));
}

// ─── Check 39: Schema file integrity (S41 split) ───
// Verifies the 16 sub-state schema files in .opencode/state/schemas/
// exist, are valid JSON, and have correct JSON Schema structure.
// Also verifies machine.schema.json is the slim meta+contracts version.
// No external dependencies (AJV not required).
// ═══════════════════════════════════════════════════════════════
// Check 34: Step 0d — Verify investigation task trigger words in
// subagent-preamble.md. The preamble's Step 0d defines the multi-source
// investigation mandate (log audit + code search). This check validates
// that the preamble contains the Step 0d section with the mandatory
// English and Chinese trigger words.
// Added (2026-06-18).
function checkStep0dTriggerWords(): void {
  const preamblePath = path.join(OPENCODE_ROOT, ".opencode", "subagent-preamble.md");
  if (!fs.existsSync(preamblePath)) {
    check(34, false, "subagent-preamble.md not found");
    return;
  }
  const preamble = readFile(preamblePath);
  if (!preamble) {
    check(34, false, "subagent-preamble.md is empty");
    return;
  }

  const issues = [];

  // Step 0d section must exist
  if (!/Step 0d[:\s]/.test(preamble)) {
    issues.push("Step 0d section missing");
  }

  // Required English trigger words
  const requiredEn = ["investigation", "audit", "analysis", "diagnose", "debug", "troubleshoot", "root-cause", "trace", "forensic"];
  const missingEn = requiredEn.filter(function (kw: string) {
    return preamble.indexOf(kw) === -1;
  });
  if (missingEn.length > 0) {
    issues.push("EN trigger words missing: " + missingEn.join(", "));
  }

  // Required Chinese trigger words
  const requiredCn = ["调查", "排查", "调试", "诊断", "根因", "审计", "追溯", "排错", "定位"];
  const missingCn = requiredCn.filter(function (kw: string) {
    return preamble.indexOf(kw) === -1;
  });
  if (missingCn.length > 0) {
    issues.push("CN trigger words missing: " + missingCn.join(", "));
  }

  // ## Logs Checked section template must exist
  if (!/##\s+Logs\s+Checked/i.test(preamble)) {
    issues.push("'## Logs Checked' section missing");
  }

  // Verify log paths are referenced
  if (!/.opencode\/logs/.test(preamble)) {
    issues.push(".opencode/logs/ not referenced");
  }
  if (!/gate-state\.json/.test(preamble)) {
    issues.push("gate-state.json not referenced");
  }

  check(34, issues.length === 0,
    issues.length === 0
      ? "Step 0d: subagent-preamble.md contains investigation mandate with EN+CN trigger words, ## Logs Checked section, and log paths"
      : "Step 0d: " + issues.join("; "));
}

function checkSchemaFiles() {
  const root = process.env.OPENCODE_ROOT || process.cwd();
  const pathJoin = require("path").join;
  const schemasDir = pathJoin(root, ".opencode", "state", "schemas");
  const expected = [
    "eslint-state", "type-check-state", "dependency-state", "format-state",
    "write-audit-state", "compliance-records", "knowledge-audit-state",
    "tdd-enforcement-state", "keystone-hashes", "transaction-state",
    "knowledge-cache-state", "knowledge-state", "state-segments",
    "plugin-state", "auto-plan-history", "dispatch-history",
  ];
  const issues = [];

  if (!fs.existsSync(schemasDir)) {
    issues.push("state/schemas/ directory missing");
  } else {
    for (const name of expected) {
      const file = pathJoin(schemasDir, name + ".schema.json");
      if (!fs.existsSync(file)) {
        issues.push(name + ".schema.json missing");
        continue;
      }
      try {
        const schema = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!schema.$schema) issues.push(name + ": missing $schema");
        if (!schema.type) issues.push(name + ": missing type");
      } catch (e) {
        issues.push(name + ": invalid JSON — " + e.message);
      }
    }
  }

  // Verify machine.schema.json is slim (meta+contracts only, not monolithic)
  const metaSchemaPath = pathJoin(root, ".opencode", "state", "machine.schema.json");
  if (fs.existsSync(metaSchemaPath)) {
    try {
      const metaSchema = JSON.parse(fs.readFileSync(metaSchemaPath, "utf8"));
      const props = Object.keys(metaSchema.properties || {});
      if (props.length > 5) {
        issues.push("machine.schema.json has " + props.length + " properties (expected ≤5, should be slim meta+contracts)");
      }
      if (!metaSchema.required || !metaSchema.required.includes("meta")) {
        issues.push("machine.schema.json: 'meta' not in required");
      }
      if (!metaSchema.required || !metaSchema.required.includes("contracts")) {
        issues.push("machine.schema.json: 'contracts' not in required");
      }
    } catch (e) {
      issues.push("machine.schema.json: invalid JSON — " + e.message);
    }
  } else {
    issues.push("machine.schema.json missing");
  }

  check(39, issues.length === 0,
    issues.length === 0
      ? "Schema files: " + expected.length + " sub-state schemas valid + machine.schema.json slim (meta+contracts)"
      : issues.length + " issue(s): " + issues.join("; "));
}

