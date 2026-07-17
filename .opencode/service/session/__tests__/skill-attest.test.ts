// service/session/__tests__/skill-attest.test.ts — PT-WM-00R: Skill read attestation hard gate tests
import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// We need to use a temp DB for testing
describe("attestSkillRead PT-WM-00R Hard Gate Contract", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalDbPath: string | undefined;
  let originalHardGate: string | undefined;

  beforeAll(() => {
    originalCwd = process.cwd();
    originalHardGate = process.env.FRAMEWORK_SKILL_READ_HARD_GATE;
  });

  beforeEach(() => {
    // Create temp worktree
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-attest-test-"));
    // Create .opencode directory structure
    const opencodeDir = path.join(tempDir, ".opencode");
    const skillsDir = path.join(opencodeDir, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });

    // Create 4 required skills with dummy SKILL.md
    const requiredSkills = ["preflight-lite", "codegraph-first", "requirements-to-test-specification", "test-specification-execution"];
    for (const skill of requiredSkills) {
      const skillDir = path.join(skillsDir, skill);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${skill}\nTest content for ${skill}\n`);
    }

    // Create minimal project.config.json
    const projectConfig = {
      template_resolution: {
        required_skill_reads: requiredSkills,
      },
    };
    fs.writeFileSync(path.join(opencodeDir, "project.config.json"), JSON.stringify(projectConfig, null, 2));

    // Change to temp dir
    process.chdir(tempDir);

    // Set hard gate enabled
    process.env.FRAMEWORK_SKILL_READ_HARD_GATE = "1";

    // Use a temp DB path
    originalDbPath = process.env.FRAMEWORK_DB_PATH;
    process.env.FRAMEWORK_DB_PATH = path.join(tempDir, "test-framework-state.db");
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
    // Cleanup temp dirs
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("T-PT-039: Missing agent returns verified:false", async () => {
    const { attestSkillRead } = await import("../skill-attest");
    const result = attestSkillRead({
      agent: "",
      sessionID: "test-session-1",
      worktree: tempDir,
      taskId: "test-task-1",
    });
    expect(result.verified).toBe(false);
    expect(result.error).toContain("Missing required identity fields");
  });

  test("T-PT-039: Missing taskId is allowed for root sessions (PT-WM-00R2 canonical identity)", async () => {
    // PT-WM-00R2: taskId is optional for root sessions. Canonical identity is session:<sessionID>
    // The attestation should proceed but fail because skills haven't been read yet.
    const { attestSkillRead } = await import("../skill-attest");
    const result = attestSkillRead({
      agent: "build",
      sessionID: "test-session-2",
      worktree: tempDir,
      taskId: null,
    });
    // Should fail because skills not read, NOT because taskId is missing
    expect(result.verified).toBe(false);
    expect(result.error).toContain("Missing read audit records");
  });

  test("T-PT-039: Hard gate enabled with empty required list returns verified:false", async () => {
    // Override config to have empty required list
    const opencodeDir = path.join(tempDir, ".opencode");
    const emptyConfig = { template_resolution: { required_skill_reads: [] } };
    fs.writeFileSync(path.join(opencodeDir, "project.config.json"), JSON.stringify(emptyConfig, null, 2));

    const { attestSkillRead } = await import("../skill-attest");
    const result = attestSkillRead({
      agent: "build",
      sessionID: "test-session-3",
      worktree: tempDir,
      taskId: "test-task-3",
    });
    expect(result.verified).toBe(false);
    expect(result.error).toContain("required_skill_reads is empty");
  });

  test("T-PT-040: Any unread file returns verified:false and invalidates old state", async () => {
    const { attestSkillRead, validateSkillAttestation } = await import("../skill-attest");
    
    // First attest without reading anything - should fail
    const result1 = attestSkillRead({
      agent: "build",
      sessionID: "test-session-4",
      worktree: tempDir,
      taskId: "test-task-4",
    });
    expect(result1.verified).toBe(false);
    expect(result1.unread_files?.length).toBeGreaterThan(0);

    // Validation should also fail
    const valid1 = validateSkillAttestation({
      agent: "build",
      sessionID: "test-session-4",
      worktree: tempDir,
      taskId: "test-task-4",
    });
    expect(valid1.valid).toBe(false);
    expect(valid1.ruleId).toBe("skill-read-attest-required");
  });

  test("validateSkillAttestation returns valid only when all fields match", async () => {
    const { validateSkillAttestation } = await import("../skill-attest");
    
    // Without valid state, validation fails
    const result = validateSkillAttestation({
      agent: "build",
      sessionID: "nonexistent-session",
      worktree: tempDir,
      taskId: "test-task-5",
    });
    expect(result.valid).toBe(false);
    expect(result.ruleId).toBe("skill-read-attest-required");
  });

  test("T-PT-042: Hard gate disabled allows all tools (backward compatible)", async () => {
    delete process.env.FRAMEWORK_SKILL_READ_HARD_GATE;
    const { validateSkillAttestation } = await import("../skill-attest");
    
    const result = validateSkillAttestation({
      agent: "build",
      sessionID: "anysession",
      worktree: tempDir,
      taskId: "anytask",
    });
    expect(result.valid).toBe(true);
  });
});
