// plugin-handlers/before/__tests__/skill-policy.test.ts — PT-WM-00R: Skill policy hard gate tests
import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("skill-policy before handler PT-WM-00R Hard Block", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalHardGate: string | undefined;
  let originalDbPath: string | undefined;

  beforeAll(() => {
    originalCwd = process.cwd();
    originalHardGate = process.env.FRAMEWORK_SKILL_READ_HARD_GATE;
  });

  beforeEach(() => {
    // Create temp worktree with minimal config
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-policy-test-"));
    const opencodeDir = path.join(tempDir, ".opencode");
    const skillsDir = path.join(opencodeDir, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });

    // Create required skills
    const requiredSkills = ["preflight-lite", "codegraph-first", "requirements-to-test-specification", "test-specification-execution"];
    for (const skill of requiredSkills) {
      const skillDir = path.join(skillsDir, skill);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${skill}\nTest content\n`);
    }

    const projectConfig = { template_resolution: { required_skill_reads: requiredSkills } };
    fs.writeFileSync(path.join(opencodeDir, "project.config.json"), JSON.stringify(projectConfig, null, 2));

    process.chdir(tempDir);
    process.env.FRAMEWORK_SKILL_READ_HARD_GATE = "1";
    originalDbPath = process.env.FRAMEWORK_DB_PATH;
    process.env.FRAMEWORK_DB_PATH = path.join(tempDir, "test.db");
  });

  afterAll(() => {
    process.chdir(originalCwd);
    if (originalHardGate === undefined) {
      delete process.env.FRAMEWORK_SKILL_READ_HARD_GATE;
    } else {
      process.env.FRAMEWORK_SKILL_READ_HARD_GATE = originalHardGate;
    }
    if (originalDbPath === undefined) {
      delete process.env.FRAMEWORK_DB_PATH;
    } else {
      process.env.FRAMEWORK_DB_PATH = originalDbPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("T-PT-041: Pre-attest allowlist tools (read/glob/grep/question/skill/attest) pass without attestation", async () => {
    // Test through the handle function - allowlist is internal implementation detail
    const skillPolicy = await import("../skill-policy");
    
    const allowedTools = ["read", "glob", "grep", "question", "skill", "config_read_attest", "skill_read_attest", "rule_read_attest"];
    
    for (const tool of allowedTools) {
      let threw = false;
      try {
        await skillPolicy.handle({ tool, sessionID: "test-session", args: {} }, {});
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    }
  });

  test("T-PT-041: Write tools (safe_edit/safe_shell/safe_framework_edit/dispatch_subagent) are blocked without attestation", async () => {
    const skillPolicy = await import("../skill-policy");
    
    const blockedTools = ["safe_edit", "safe_shell", "safe_framework_edit", "dispatch_subagent", "write", "edit", "bash", "safe_repo_commit"];
    
    for (const tool of blockedTools) {
      let threw = false;
      let errorMessage = "";
      try {
        await skillPolicy.handle({ tool, sessionID: "test-session-block", args: {}, agent: "build" }, {});
      } catch (e: any) {
        threw = true;
        errorMessage = e.message;
      }
      expect(threw).toBe(true);
      expect(errorMessage).toContain("skill-read-attest-required");
    }
  });

  test("T-PT-042: Unknown/future tools are blocked by default (fail-closed)", async () => {
    const skillPolicy = await import("../skill-policy");
    
    const unknownTools = ["future_new_tool_xyz", "unknown_write_tool", "custom_plugin_tool"];
    
    for (const tool of unknownTools) {
      let threw = false;
      try {
        await skillPolicy.handle({ tool, sessionID: "test-session-unknown", args: {}, agent: "build" }, {});
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    }
  });

  test("ADV-PT-008: Exceptions propagate out of handler (not caught internally)", async () => {
    const skillPolicy = await import("../skill-policy");
    
    // Try a write tool without attestation - the error MUST leave the handler
    let caughtError: any = null;
    try {
      await skillPolicy.handle({ tool: "safe_edit", sessionID: "test-session-propagate", args: {}, agent: "build" }, {});
    } catch (e) {
      caughtError = e;
    }
    
    expect(caughtError).not.toBeNull();
    expect(caughtError.message).toContain("skill-read-attest-required");
  });

  test("T-PT-046: When hard gate is disabled, handler allows all tools (backward compatible)", async () => {
    delete process.env.FRAMEWORK_SKILL_READ_HARD_GATE;
    // Need to reimport? Since env checked on each call, it should be fine
    const skillPolicy = await import("../skill-policy");
    
    let threw = false;
    try {
      await skillPolicy.handle({ tool: "safe_edit", sessionID: "test-session-nohardgate", args: {}, agent: "build" }, {});
    } catch (e) {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
