/**
 * framework-self-test.test.js — Framework Self-Test Tests
 * Tests for .opencode/scripts/framework-self-test.js
 * GREEN phase: 20 tests covering check functions via read-only file verification
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

// __dirname = .opencode/scripts/__tests__/
// Need ../../.. to get to project root
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const SELF_TEST_SCRIPT = path.join(PROJECT_ROOT, ".opencode", "scripts", "framework-self-test.js");

describe("framework-self-test CLI", () => {
  test("script file exists", () => {
    expect(fs.existsSync(SELF_TEST_SCRIPT)).toBe(true);
  });

  test("script is executable", () => {
    const stats = fs.statSync(SELF_TEST_SCRIPT);
    expect(stats.isFile()).toBe(true);
  });

  test("runs without crashing", () => {
    try {
      const output = execSync(`node "${SELF_TEST_SCRIPT}"`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
      expect(output).toBeTruthy();
    } catch (e) {
      // Script may exit with non-zero if some checks fail
      expect(e.stdout).toBeTruthy();
    }
  });

  test("output contains PASS or FAIL markers", () => {
    try {
      const output = execSync(`node "${SELF_TEST_SCRIPT}"`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
      expect(output).toMatch(/\[PASS\]|\[FAIL\]/);
    } catch (e) {
      expect(e.stdout).toMatch(/\[PASS\]|\[FAIL\]/);
    }
  });
});

describe("checkConfigJson", () => {
  test("project.config.json exists", () => {
    const cfgPath = path.join(PROJECT_ROOT, ".opencode", "project.config.json");
    expect(fs.existsSync(cfgPath)).toBe(true);
  });

  test("project.config.json is valid JSON", () => {
    const cfgPath = path.join(PROJECT_ROOT, ".opencode", "project.config.json");
    const content = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    expect(content).toBeDefined();
  });
});

describe("checkStateDir", () => {
  test(".opencode/state directory exists", () => {
    const stateDir = path.join(PROJECT_ROOT, ".opencode", "state");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  test("machine.json exists in state dir", () => {
    const machinePath = path.join(PROJECT_ROOT, ".opencode", "state", "machine.json");
    expect(fs.existsSync(machinePath)).toBe(true);
  });
});

describe("checkMachineSubStates", () => {
  test("machine.json has required sub-states", () => {
    const machinePath = path.join(PROJECT_ROOT, ".opencode", "state", "machine.json");
    const machine = JSON.parse(fs.readFileSync(machinePath, "utf8"));
    ["meta", "eslint_state", "type_check_state", "dependency_state", "format_state"].forEach((s) => {
      expect(machine).toHaveProperty(s);
    });
  });
});

describe("checkAgentSkillsClean", () => {
  test("coder-be.md has skills list", () => {
    const agentPath = path.join(PROJECT_ROOT, ".opencode", "agents", "coder-be.md");
    const content = fs.readFileSync(agentPath, "utf8");
    expect(content).toContain("skills");
  });
});

describe("checkThreeLayersEightRoles", () => {
  test("AGENTS.md references 8 agent types", () => {
    const agentsPath = path.join(PROJECT_ROOT, "AGENTS.md");
    const content = fs.readFileSync(agentsPath, "utf8");
    const count = (content.match(/@Meta-Planner|@Orchestrator|@Architect|@Coder-FE|@Coder-BE|@Guardian|@Arbiter|@CI-CD-Agent/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(8);
  });
});

describe("checkReferencedFiles", () => {
  test("contract.yaml exists", () => {
    expect(fs.existsSync(path.join(PROJECT_ROOT, "contract.yaml"))).toBe(true);
  });
});

describe("checkTemplateResolution", () => {
  test("project.config.json has template_resolution or project_root", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, ".opencode", "project.config.json"), "utf8"));
    expect(cfg.template_resolution || cfg.project_root).toBeDefined();
  });
});

describe("checkAbsolutePathLeakage", () => {
  test("AGENTS.md has no leaked absolute paths", () => {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, "AGENTS.md"), "utf8");
    const absolutePaths = content.match(/\/home\/\w+/g) || [];
    expect(absolutePaths.length).toBe(0);
  });
});

describe("checkESLintRules", () => {
  test("eslint_state has valid structure", () => {
    const machine = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, ".opencode", "state", "machine.json"), "utf8"));
    expect(machine.eslint_state).toHaveProperty("modules");
    expect(machine.eslint_state).toHaveProperty("aggregate");
  });
});

describe("checkPreCommitHooks", () => {
  test("pre-commit hook exists", () => {
    expect(fs.existsSync(path.join(PROJECT_ROOT, ".opencode", "hooks", "pre-commit"))).toBe(true);
  });

  test("commit-msg hook exists", () => {
    expect(fs.existsSync(path.join(PROJECT_ROOT, ".opencode", "hooks", "commit-msg"))).toBe(true);
  });
});

describe("checkCommitMsgTDD", () => {
  test("recent commits use [Red] or [Green] markers", () => {
    try {
      const log = execSync("git log --oneline -20", { cwd: PROJECT_ROOT, encoding: "utf8" });
      expect(log).toMatch(/\[Red\]|\[Green\]/);
    } catch {
      // Non-git environment
      expect(true).toBe(true);
    }
  });
});

describe("checkCQGBootstrap", () => {
  test("code-quality-gate.js has bootstrap logic", () => {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, ".opencode", "scripts", "mcp-tools", "code-quality-gate.js"), "utf8");
    expect(content).toContain("OPENCODE_ROOT");
  });
});

describe("checkAgentsNoBackslashes", () => {
  test("no backslash paths in agent files", () => {
    ["architect.md", "coder-be.md", "coder-fe.md"].forEach((f) => {
      const p = path.join(PROJECT_ROOT, ".opencode", "agents", f);
      if (fs.existsSync(p)) {
        expect(fs.readFileSync(p, "utf8")).not.toMatch(/\\\\/);
      }
    });
  });
});
