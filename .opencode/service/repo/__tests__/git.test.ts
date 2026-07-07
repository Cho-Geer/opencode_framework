import { describe, test, expect } from "bun:test";
import {
  repoStage,
  repoUnstage,
  repoCommit,
  repoStatus,
  repoDiff,
  repoLog,
  repoBranch,
  getStagedFiles,
  assertStagedFilesAllowed,
  execGit,
} from "../git";

describe("execGit", () => {
  test("git version returns ok", () => {
    const result = execGit(["version"]);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("git version");
  });

  test("invalid git subcommand returns ok=false", () => {
    const result = execGit(["totally-invalid-subcommand"]);
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });
});

describe("repoStage", () => {
  test("rejects empty paths", () => {
    const result = repoStage([]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("REPO-STAGE-EMPTY");
  });

  test("rejects wildcard .", () => {
    const result = repoStage(["."]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("REPO-STAGE-WILDCARD-BLOCKED");
  });

  test("rejects wildcard *", () => {
    const result = repoStage(["*"]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("REPO-STAGE-WILDCARD-BLOCKED");
  });

  test("rejects path traversal", () => {
    const result = repoStage(["../etc/passwd"]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("REPO-PATH-TRAVERSAL-BLOCKED");
  });

  test("rejects runtime state paths", () => {
    expect(() => repoStage([".opencode/state.db"])).toThrow(/REPO-RUNTIME-PATH-BLOCKED/);
  });

  test("rejects .task_temp paths", () => {
    expect(() => repoStage([".task_temp/test.txt"])).toThrow(/REPO-RUNTIME-PATH-BLOCKED/);
  });

  test("rejects node_modules paths", () => {
    expect(() => repoStage(["node_modules/pkg/index.js"])).toThrow(/REPO-RUNTIME-PATH-BLOCKED/);
  });
});

describe("repoUnstage", () => {
  test("rejects empty paths", () => {
    const result = repoUnstage([]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("REPO-UNSTAGE-EMPTY");
  });
});

describe("repoCommit", () => {
  test("rejects empty message", () => {
    const result = repoCommit("");
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("REPO-COMMIT-EMPTY-MESSAGE");
  });

  test("rejects whitespace-only message", () => {
    const result = repoCommit("   ");
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("REPO-COMMIT-EMPTY-MESSAGE");
  });

  test("rejects --no-verify in message", () => {
    const result = repoCommit("fix: something --no-verify");
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("REPO-HOOK-BYPASS-BLOCKED");
  });

  test("rejects core.hooksPath in message", () => {
    const result = repoCommit("fix: something core.hookspath=/dev/null");
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("REPO-HOOK-BYPASS-BLOCKED");
  });

  test("rejects core.skipHooks in message", () => {
    const result = repoCommit("fix: something core.skipHooks=true");
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("REPO-HOOK-BYPASS-BLOCKED");
  });

  test("rejects [BYPASS in message", () => {
    const result = repoCommit("[BYPASS] emergency fix");
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("REPO-HOOK-BYPASS-BLOCKED");
  });
});

describe("repoStatus (read-only, safe to call)", () => {
  test("returns status output", () => {
    const result = repoStatus();
    expect(result.argv).toContain("--short");
  });

  test("porcelain mode uses v1 format", () => {
    const result = repoStatus(true);
    expect(result.argv).toContain("--porcelain=v1");
  });
});

describe("repoDiff (read-only, safe to call)", () => {
  test("builds correct argv for basic diff", () => {
    const result = repoDiff({});
    expect(result.argv).toContain("diff");
  });

  test("builds correct argv with cached flag", () => {
    const result = repoDiff({ cached: true });
    expect(result.argv).toContain("--cached");
  });

  test("builds correct argv with stat flag", () => {
    const result = repoDiff({ stat: true });
    expect(result.argv).toContain("--stat");
  });

  test("builds correct argv with paths", () => {
    const result = repoDiff({ paths: ["src/file.ts"] });
    expect(result.argv).toContain("--");
    expect(result.argv).toContain("src/file.ts");
  });
});

describe("repoLog (read-only, safe to call)", () => {
  test("limits max count to 50", () => {
    const result = repoLog({ maxCount: 100 });
    const maxCountArg = result.argv.find((a) => a.startsWith("--max-count="));
    expect(maxCountArg).toBe("--max-count=50");
  });

  test("defaults to 20", () => {
    const result = repoLog({});
    const maxCountArg = result.argv.find((a) => a.startsWith("--max-count="));
    expect(maxCountArg).toBe("--max-count=20");
  });
});

describe("repoBranch (read-only, safe to call)", () => {
  test("current mode uses --show-current", () => {
    const result = repoBranch({ mode: "current" });
    expect(result.argv).toContain("--show-current");
  });

  test("list mode uses --list", () => {
    const result = repoBranch({ mode: "list" });
    expect(result.argv).toContain("--list");
  });
});
