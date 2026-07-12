import { describe, test, expect } from "bun:test";
import { evaluate } from "../policies/permission-policy";
import type { ToolGovernanceContext } from "../context";

function makeCtx(tool: string, command: string, agent: string = "unknown"): ToolGovernanceContext {
  return { sessionID: "test-sid", agent, tool, args: {}, command, targetPaths: [] };
}

describe("permission-policy", () => {
  test("non-shell tool => null", () => {
    expect(evaluate(makeCtx("safe_edit", "anything"))).toBeNull();
  });

  test("safe_shell with no command => null", () => {
    expect(evaluate(makeCtx("safe_shell", ""))).toBeNull();
  });

  test("safe_shell cat with unknown agent => null (no deny/ask rules match)", () => {
    const d = evaluate(makeCtx("safe_shell", "cat foo.txt", "unknown"));
    expect(d).toBeNull();
  });
});
