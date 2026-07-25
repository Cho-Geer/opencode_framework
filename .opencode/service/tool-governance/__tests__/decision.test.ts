import { describe, test, expect } from "bun:test";

describe("ToolGovernanceDecision type", () => {
  test("outcome values are valid", () => {
    const outcomes = ["allow", "deny", "ask", "audit_only"];
    outcomes.forEach((o) => expect(typeof o).toBe("string"));
  });

  test("layer values are valid", () => {
    const layers = ["static-permission", "path-protection", "repo-policy", "impact-evidence", "grant", "tool-final-guard"];
    layers.forEach((l) => expect(typeof l).toBe("string"));
  });
});
