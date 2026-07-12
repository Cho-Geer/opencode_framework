import { describe, test, expect } from "bun:test";
import { evaluate } from "../policies/shell-policy";
import type { ToolGovernanceContext } from "../context";

function makeCtx(tool: string, command: string, agent: string = "unknown"): ToolGovernanceContext {
  return { sessionID: "test-sid", agent, tool, args: {}, command, targetPaths: [] };
}

describe("shell-policy", () => {
  test("non-shell tool => null", () => {
    expect(evaluate(makeCtx("safe_edit", "anything"))).toBeNull();
  });

  test("safe_shell with no command => null", () => {
    expect(evaluate(makeCtx("safe_shell", ""))).toBeNull();
  });

  test("safe_shell cat with unknown agent => null (cat is in DEFAULT_ALLOWLIST)", () => {
    expect(evaluate(makeCtx("safe_shell", "cat foo.txt", "unknown"))).toBeNull();
  });

  test("safe_shell ls with unknown agent => null (ls is in DEFAULT_ALLOWLIST)", () => {
    expect(evaluate(makeCtx("safe_shell", "ls -la", "unknown"))).toBeNull();
  });

  test("safe_shell unknown command => deny (NOT-IN-ALLOWLIST)", () => {
    const d = evaluate(makeCtx("safe_shell", "rmmod kernel", "unknown"));
    expect(d).not.toBeNull();
    expect(d!.outcome).toBe("deny");
    expect(d!.ruleId).toBe("NOT-IN-ALLOWLIST");
    expect(d!.layer).toBe("tool-final-guard");
  });
});
