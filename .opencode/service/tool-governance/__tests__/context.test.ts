import { describe, test, expect } from "bun:test";

describe("ToolGovernanceContext type", () => {
  test("required fields exist", () => {
    const ctx = {
      sessionID: "test",
      agent: "test",
      tool: "safe_shell",
      args: {},
      targetPaths: [],
    };
    expect(ctx.sessionID).toBe("test");
    expect(ctx.tool).toBe("safe_shell");
  });
});
