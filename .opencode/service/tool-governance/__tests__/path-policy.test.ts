import { describe, test, expect } from "bun:test";
import { evaluate } from "../policies/path-policy";
import type { ToolGovernanceContext } from "../context";

function makeCtx(
  tool: string,
  targetPaths: string[],
  extra: Partial<ToolGovernanceContext> = {},
): ToolGovernanceContext {
  return {
    sessionID: "test-sid",
    agent: "test-agent",
    tool,
    args: {},
    targetPaths,
    ...extra,
  };
}

describe("path-policy", () => {
  test("safe_edit on protected path => deny", () => {
    const d = evaluate(makeCtx("safe_edit", [".opencode/service/repo/classify.ts"]));
    expect(d).not.toBeNull();
    expect(d!.outcome).toBe("deny");
    expect(d!.ruleId).toBe("BEHAVIORAL-PATH-GUARD");
  });

  test("safe_edit on non-protected path => null", () => {
    expect(evaluate(makeCtx("safe_edit", ["src/index.ts"]))).toBeNull();
  });

  test("safe_edit with breakGlass => null", () => {
    const ctx = makeCtx("safe_edit", [".opencode/service/repo/classify.ts"]);
    ctx.args.breakGlass = true;
    expect(evaluate(ctx)).toBeNull();
  });

  test("safe_shell read-only command on protected path => null", () => {
    const ctx = makeCtx(
      "safe_shell",
      [".opencode/service/repo/classify.ts"],
      { command: "cat .opencode/service/repo/classify.ts" },
    );
    expect(evaluate(ctx)).toBeNull();
  });

  test("read tool => null (not a write tool)", () => {
    expect(evaluate(makeCtx("read", ["anything"]))).toBeNull();
  });
});
