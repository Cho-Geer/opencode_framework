import { describe, expect, test } from "bun:test";
import { safeBashTool } from "../shell-guard";
import { buildVerifiedCommandPlan } from "../shell-plan";

describe("safe shell execution planning", () => {
  test("builds a verified plan for pwd", () => {
    const result = buildVerifiedCommandPlan("pwd");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.executable.startsWith("/")).toBe(true);
    expect(result.plan.args).toEqual([]);
    expect(result.plan.outputMode).toBe("buffered");
  });

  test("rejects shell composition", () => {
    const result = buildVerifiedCommandPlan("pwd && whoami");
    expect(result.ok).toBe(false);
    if (result.ok === true) return;
    expect(result.ruleId).toBe("SHELL-COMPOSITION-DENY");
  });

  test("rejects wildcard expansion", () => {
    const result = buildVerifiedCommandPlan("ls *");
    expect(result.ok).toBe(false);
    if (result.ok === true) return;
    expect(result.ruleId).toBe("SHELL-GLOB-DENY");
  });
});

describe("safeBashTool", () => {
  test("executes pwd without invoking shell composition", async () => {
    const result = await safeBashTool({
      command: "pwd",
      agent: "@Orchestrator",
    });
    expect(result.allowed).toBe(true);
    expect(result.executed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  test("blocks multi-command execution", async () => {
    const result = await safeBashTool({
      command: "pwd && whoami",
      agent: "@Orchestrator",
    });
    expect(result.allowed).toBe(false);
    expect(result.executed).toBe(false);
    expect(result.blockedReason).toContain("SHELL-COMPOSITION-DENY");
  });

  test("streams find output through the verified executor", async () => {
    const result = await safeBashTool({
      command: "find . -maxdepth 1",
      agent: "@Orchestrator",
    });
    expect(result.allowed).toBe(true);
    expect(result.executed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(".");
  });
});
