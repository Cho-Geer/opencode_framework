/**
 * framework-doctor.test.js — Framework Doctor Tests
 * Tests for .opencode/scripts/framework-doctor.ts
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const DOCTOR_SCRIPT = path.join(
  PROJECT_ROOT,
  ".opencode",
  "scripts",
  "framework-doctor.ts",
);
const DOCTOR_RUNNER = process.execPath;

describe("framework-doctor CLI", () => {
  test("script file exists", () => {
    expect(fs.existsSync(DOCTOR_SCRIPT)).toBe(true);
  });

  test("runs without crashing (default mode)", () => {
    try {
      const output = execSync(`${DOCTOR_RUNNER} "${DOCTOR_SCRIPT}"`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
      expect(output).toBeTruthy();
      // Should contain PASS or FAIL markers
      expect(output).toMatch(/\[PASS\]|\[FAIL\]/);
    } catch (e) {
      // May exit non-zero if some checks fail; still must have output
      expect(e.stdout).toBeTruthy();
      expect(e.stdout).toMatch(/\[PASS\]|\[FAIL\]/);
    }
  });
});

describe("framework-doctor --strict flag", () => {
  test("--strict exits 1 when any check fails", () => {
    // We can't guarantee all 10 checks pass on every project,
    // so --strict should exit 1 if any check fails.
    try {
      execSync(`${DOCTOR_RUNNER} "${DOCTOR_SCRIPT}" --strict`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
      // If it gets here, all checks passed — that's fine too
    } catch (e) {
      // --strict exits 1 on failure — expected behavior
      expect(e.status).toBe(1);
      expect(e.stdout).toBeTruthy();
    }
  });

  test("--strict output contains PASS or FAIL markers", () => {
    try {
      const output = execSync(`${DOCTOR_RUNNER} "${DOCTOR_SCRIPT}" --strict`, {
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

describe("framework-doctor --json flag", () => {
  test("--json produces valid JSON", () => {
    let output;
    try {
      output = execSync(`${DOCTOR_RUNNER} "${DOCTOR_SCRIPT}" --json`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
    } catch (e) {
      output = e.stdout;
    }
    expect(output).toBeTruthy();
    let parsed;
    expect(() => {
      parsed = JSON.parse(output);
    }).not.toThrow();
    expect(parsed).toHaveProperty("version");
    expect(parsed).toHaveProperty("checks");
    expect(parsed).toHaveProperty("summary");
  });

  test("--json output contains 14 checks", () => {
    let output;
    try {
      output = execSync(`${DOCTOR_RUNNER} "${DOCTOR_SCRIPT}" --json`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
    } catch (e) {
      output = e.stdout;
    }
    const parsed = JSON.parse(output);
    expect(parsed.checks).toBeInstanceOf(Array);
    expect(parsed.checks.length).toBe(14);
  });

  test("--json each check has id, name, status fields", () => {
    let output;
    try {
      output = execSync(`${DOCTOR_RUNNER} "${DOCTOR_SCRIPT}" --json`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
    } catch (e) {
      output = e.stdout;
    }
    const parsed = JSON.parse(output);
    for (const check of parsed.checks) {
      expect(check).toHaveProperty("id");
      expect(check).toHaveProperty("name");
      expect(check).toHaveProperty("status");
      expect(["PASS", "FAIL"]).toContain(check.status);
    }
  });
});

describe("framework-doctor --check flag", () => {
  test("--check 1 runs only check 1 (opencode.json sync)", () => {
    let output;
    try {
      output = execSync(`${DOCTOR_RUNNER} "${DOCTOR_SCRIPT}" --check 1`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
    } catch (e) {
      output = e.stdout;
    }
    // Should only contain check 1 output
    expect(output).toMatch(/Check 1/);
    // Should mention opencode.json
    expect(output).toMatch(/opencode\.json/);
  });

  test("--check 9 runs only check 9 (encoding scan)", () => {
    let output;
    try {
      output = execSync(`${DOCTOR_RUNNER} "${DOCTOR_SCRIPT}" --check 9`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
    } catch (e) {
      output = e.stdout;
    }
    expect(output).toMatch(/Check 9/);
    expect(output).toMatch(/UTF-8|encoding|mojibake/i);
  });

  test("--check with invalid index warns and continues", () => {
    let output;
    try {
      output = execSync(`${DOCTOR_RUNNER} "${DOCTOR_SCRIPT}" --check 99`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
    } catch (e) {
      output = e.stdout;
    }
    // Should either warn about invalid check or just show summary
    expect(output).toBeTruthy();
  });
});

describe("framework-doctor --json --check N", () => {
  test("--json --check 3 outputs single check in JSON format", () => {
    let output;
    try {
      output = execSync(`${DOCTOR_RUNNER} "${DOCTOR_SCRIPT}" --json --check 3`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
    } catch (e) {
      output = e.stdout;
    }
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("version");
    expect(parsed).toHaveProperty("checks");
    expect(parsed.checks.length).toBe(1);
    expect(parsed.checks[0].id).toBe(3);
  });
});

describe("framework-doctor JSON report output", () => {
  test("doctor writes JSON report to .task_temp/_global/doctor-report.json", () => {
    let output;
    try {
      output = execSync(`${DOCTOR_RUNNER} "${DOCTOR_SCRIPT}"`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: "utf8",
      });
    } catch (e) {
      output = e.stdout;
    }
    const reportPath = path.join(
      PROJECT_ROOT,
      ".task_temp",
      "_global",
      "doctor-report.json",
    );
    expect(fs.existsSync(reportPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    expect(report).toHaveProperty("version");
    expect(report).toHaveProperty("checks");
    expect(report).toHaveProperty("summary");
  });
});

describe("FX-DIAG-CONS-1: DAG field name validation", () => {
  const dagPath = path.join(PROJECT_ROOT, "Task.DAG.json");
  let originalDagContent = null;

  beforeAll(() => {
    if (fs.existsSync(dagPath)) {
      originalDagContent = fs.readFileSync(dagPath, "utf-8");
    }
  });

  afterAll(() => {
    if (originalDagContent !== null) {
      fs.writeFileSync(dagPath, originalDagContent, "utf-8");
    } else if (fs.existsSync(dagPath)) {
      fs.unlinkSync(dagPath);
    }
  });

  it('should accept tasks with "name" field per dag-generation-standard.md §7 (RED: fails because doctor requires "title")', () => {
    const mockDag = {
      meta: { total_tasks: 2, completed_tasks: 1, pending_tasks: 1 },
      tasks: [
        { id: "T001", name: "Task using standard name field", agent: "@Coder-BE", dependencies: [], priority: "P1", status: "pending", target_files: ["src/test.ts"], definition_of_done: { files_exist: [], logic_complete: "", tests_pass: "", guardian_approved: false } },
        { id: "T002", name: "Another task", agent: "@Coder-FE", dependencies: ["T001"], priority: "P2", status: "pending", target_files: ["src/test.ts"], definition_of_done: { files_exist: [], logic_complete: "", tests_pass: "", guardian_approved: false } }
      ]
    };
    fs.writeFileSync(dagPath, JSON.stringify(mockDag, null, 2), "utf-8");
    let output;
    try {
      output = execSync(`${DOCTOR_RUNNER} "${DOCTOR_SCRIPT}" --json --check 2`, { cwd: PROJECT_ROOT, timeout: 30000, encoding: "utf8" });
    } catch (e) { output = e.stdout || ""; }
    const parsed = JSON.parse(output);
    const dagCheck = parsed.checks.find(c => c.id === 2);
    expect(dagCheck).toBeDefined();
    // RED: currently FAILS because doctor.js expects "title" not "name"
    expect(dagCheck.status).toBe("PASS");
  });
});


