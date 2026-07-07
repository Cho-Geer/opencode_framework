import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import Database from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  toRepoRelativePath,
  isPathAllowedByPatterns,
  assertNoRuntimeStatePaths,
} from "../grants";

describe("toRepoRelativePath", () => {
  test("converts absolute path to relative", () => {
    const result = toRepoRelativePath("/project/src/file.ts", "/project");
    expect(result).toBe("src/file.ts");
  });

  test("returns relative path as-is", () => {
    const result = toRepoRelativePath("src/file.ts", "/project");
    expect(result).toBe("src/file.ts");
  });

  test("returns input for path outside root", () => {
    const result = toRepoRelativePath("/other/src/file.ts", "/project");
    expect(result).toBe("/other/src/file.ts");
  });
});

describe("isPathAllowedByPatterns", () => {
  test("exact match", () => {
    expect(isPathAllowedByPatterns("src/file.ts", ["src/file.ts"])).toBe(true);
  });

  test("no match", () => {
    expect(isPathAllowedByPatterns("src/other.ts", ["src/file.ts"])).toBe(false);
  });

  test("glob /** match", () => {
    expect(isPathAllowedByPatterns("src/components/Button.tsx", ["src/**"])).toBe(true);
  });

  test("glob /** does not match unrelated", () => {
    expect(isPathAllowedByPatterns("lib/utils.ts", ["src/**"])).toBe(false);
  });

  test("glob /* match single level", () => {
    expect(isPathAllowedByPatterns("src/file.ts", ["src/*"])).toBe(true);
  });

  test("glob /* does not match nested", () => {
    expect(isPathAllowedByPatterns("src/components/Button.tsx", ["src/*"])).toBe(false);
  });

  test("handles backslash paths", () => {
    expect(isPathAllowedByPatterns("src\\file.ts", ["src/file.ts"])).toBe(true);
  });
});

describe("assertNoRuntimeStatePaths", () => {
  test("allows normal source paths", () => {
    expect(() => assertNoRuntimeStatePaths(["src/file.ts", "lib/utils.ts"])).not.toThrow();
  });

  test("blocks .opencode/state.db", () => {
    expect(() => assertNoRuntimeStatePaths([".opencode/state.db"])).toThrow(/REPO-RUNTIME-PATH-BLOCKED/);
  });

  test("blocks .opencode/state/ paths", () => {
    expect(() => assertNoRuntimeStatePaths([".opencode/state/framework-state.db"])).toThrow(/REPO-RUNTIME-PATH-BLOCKED/);
  });

  test("blocks .task_temp/ paths", () => {
    expect(() => assertNoRuntimeStatePaths([".task_temp/test.txt"])).toThrow(/REPO-RUNTIME-PATH-BLOCKED/);
  });

  test("blocks node_modules/ paths", () => {
    expect(() => assertNoRuntimeStatePaths(["node_modules/pkg/index.js"])).toThrow(/REPO-RUNTIME-PATH-BLOCKED/);
  });

  test("blocks .opencode/_test_framework/ paths", () => {
    expect(() => assertNoRuntimeStatePaths([".opencode/_test_framework/helper.ts"])).toThrow(/REPO-RUNTIME-PATH-BLOCKED/);
  });

  test("blocks path traversal with ..", () => {
    expect(() => assertNoRuntimeStatePaths(["../etc/passwd"])).toThrow(/REPO-PATH-TRAVERSAL-BLOCKED/);
  });

  test("allows mixed valid and throws on first invalid", () => {
    expect(() => assertNoRuntimeStatePaths(["src/file.ts", ".task_temp/bad.txt"])).toThrow(/REPO-RUNTIME-PATH-BLOCKED/);
  });
});
