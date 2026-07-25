import { describe, test, expect } from "bun:test";
import { isModifyTool } from "../tool-scope-match";
import { getEffectivePathScopePaths } from "../tool-scope-paths";

describe("tool scope for safe_framework_edit", () => {
  test("isModifyTool recognizes safe_framework_edit", () => {
    expect(isModifyTool("safe_framework_edit")).toBe(true);
  });

  test("getEffectivePathScopePaths extracts path from safe_framework_edit", () => {
    const result = getEffectivePathScopePaths("safe_framework_edit", { filePath: ".opencode/lib/foo.ts" });
    expect(result.applies).toBe(true);
    expect(result.paths).toEqual([".opencode/lib/foo.ts"]);
    expect(result.reason).toBe("parsed");
  });
});
