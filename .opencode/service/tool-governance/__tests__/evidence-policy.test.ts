import { describe, test, expect } from "bun:test";
import { evaluate } from "../policies/evidence-policy";
import type { ToolGovernanceContext } from "../context";

function makeCtx(tool: string, targetPaths: string[], sessionID: string = "test-sid-no-impact"): ToolGovernanceContext {
  return { sessionID, agent: "test-agent", tool, args: {}, targetPaths };
}

describe("evidence-policy", () => {
  test("non-source-edit tool => null", () => {
    expect(evaluate(makeCtx("safe_shell", []))).toBeNull();
  });

  test("safe_edit with no target path => null", () => {
    expect(evaluate(makeCtx("safe_edit", []))).toBeNull();
  });

  test("safe_edit with non-protected path => deny (no impact_called)", () => {
    const d = evaluate(makeCtx("safe_edit", ["src/index.ts"]));
    expect(d).not.toBeNull();
    expect(d!.outcome).toBe("deny");
    expect(d!.ruleId).toBe("CODEGRAPH-ENFORCE");
    expect(d!.layer).toBe("impact-evidence");
  });
});
