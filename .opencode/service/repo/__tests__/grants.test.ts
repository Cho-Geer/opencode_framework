import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  toRepoRelativePath,
  isPathAllowedByPatterns,
  assertNoRuntimeStatePaths,
  createRepoGrant,
  confirmLatestRepoGrantForParent,
} from "../grants";
import { closeDb, getDb } from "../../../lib/db-manager";

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

describe("confirmLatestRepoGrantForParent", () => {
  let tempDir = "";

  beforeEach(() => {
    closeDb();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-grants-"));
    process.env.FRAMEWORK_DB_PATH = path.join(tempDir, "framework-state.db");
    getDb({ forceReset: true });
  });

  afterEach(() => {
    closeDb();
    delete process.env.FRAMEWORK_DB_PATH;
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("confirms latest matching remote grant for parent session", () => {
    const older = createRepoGrant({
      dispatch_key: "dispatch-older",
      parent_session_id: "parent-1",
      agent_type: "build",
      privilege: "remote_repo_write",
      allowed_tools: ["safe_repo_push"],
      allowed_paths: [],
      allowed_remotes: ["backup"],
      reason: "older",
      requires_human_confirmation: true,
    });
    expect(older).not.toBeNull();

    const newer = createRepoGrant({
      dispatch_key: "dispatch-newer",
      parent_session_id: "parent-1",
      agent_type: "build",
      privilege: "remote_repo_write",
      allowed_tools: ["safe_repo_push"],
      allowed_paths: [],
      allowed_remotes: ["origin"],
      reason: "newer",
      requires_human_confirmation: true,
    });
    expect(newer).not.toBeNull();

    const confirmed = confirmLatestRepoGrantForParent(
      {
        parent_session_id: "parent-1",
        privilege: "remote_repo_write",
        agent_type: "build",
        allowed_remote: "origin",
      },
      "orchestrator-session",
      "user explicitly approved push",
    );

    expect(confirmed).not.toBeNull();
    expect(confirmed?.id).toBe(newer?.id);
    expect(confirmed?.human_confirmed_at).toBeGreaterThan(0);

    const dbRow = getDb().query(
      "SELECT human_confirmed_at FROM repo_operation_grants WHERE id = ?",
    ).get(newer?.id) as { human_confirmed_at: number | null };
    expect(dbRow.human_confirmed_at).toBeGreaterThan(0);
  });

  test("returns null when no pending/bound grant matches requested remote", () => {
    const grant = createRepoGrant({
      dispatch_key: "dispatch-only",
      parent_session_id: "parent-2",
      agent_type: "build",
      privilege: "remote_repo_write",
      allowed_tools: ["safe_repo_push"],
      allowed_paths: [],
      allowed_remotes: ["origin"],
      reason: "only origin",
      requires_human_confirmation: true,
    });
    expect(grant).not.toBeNull();

    const confirmed = confirmLatestRepoGrantForParent(
      {
        parent_session_id: "parent-2",
        privilege: "remote_repo_write",
        agent_type: "build",
        allowed_remote: "upstream",
      },
      "orchestrator-session",
      "user explicitly approved upstream push",
    );

    expect(confirmed).toBeNull();
  });
});
