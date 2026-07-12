import { describe, test, expect } from "bun:test";
import { evaluate } from "../policies/grant-policy";
import type { ToolGovernanceContext } from "../context";

function makeCtx(tool: string): ToolGovernanceContext {
  return { sessionID: "test-sid", agent: "test-agent", tool, args: {}, targetPaths: [] };
}

describe("grant-policy", () => {
  test("non-grant tool => null", () => {
    expect(evaluate(makeCtx("safe_edit"))).toBeNull();
  });

  test("safe_repo_stage => audit_only", () => {
    const d = evaluate(makeCtx("safe_repo_stage"));
    expect(d).not.toBeNull();
    expect(d!.outcome).toBe("audit_only");
    expect(d!.ruleId).toBe("GRANT-CHECK-DELEGATED");
    expect(d!.layer).toBe("grant");
  });

  test("safe_repo_push => audit_only", () => {
    const d = evaluate(makeCtx("safe_repo_push"));
    expect(d).not.toBeNull();
    expect(d!.outcome).toBe("audit_only");
  });

  test("safe_gh_pr_create => audit_only", () => {
    const d = evaluate(makeCtx("safe_gh_pr_create"));
    expect(d).not.toBeNull();
    expect(d!.outcome).toBe("audit_only");
  });
});
