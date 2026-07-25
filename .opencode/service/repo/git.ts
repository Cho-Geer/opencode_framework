import { execFileSync } from "node:child_process";
import { writeLog } from "../../lib/log-manager";
import { assertNoRuntimeStatePaths } from "./grants";

const SRC = "repo-git-service";
const DEFAULT_TIMEOUT_MS = 30000;

export interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  argv: string[];
}

export function execGit(argv: string[], timeoutMs?: number): GitExecResult {
  const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;
  try {
    const stdout = execFileSync("git", argv, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

    return {
      ok: true,
      stdout: stdout || "",
      stderr: "",
      exitCode: 0,
      argv,
    };
  } catch (e: any) {
    const exitCode = e.status ?? 1;
    const stderr = e.stderr || e.message || "";
    const stdout = e.stdout || "";

    writeLog(SRC, "WARN", {
      event: "GIT-EXEC-FAILED",
      argv,
      exitCode,
      stderr: String(stderr).slice(0, 500),
    });

    return {
      ok: false,
      stdout: String(stdout),
      stderr: String(stderr),
      exitCode,
      argv,
    };
  }
}

export function repoStatus(porcelain?: boolean): GitExecResult {
  const args = porcelain ? ["status", "--porcelain=v1"] : ["status", "--short"];
  return execGit(args);
}

export function repoDiff(input: { paths?: string[]; cached?: boolean; stat?: boolean }): GitExecResult {
  const args: string[] = ["diff"];
  if (input.cached) args.push("--cached");
  if (input.stat) args.push("--stat");
  if (input.paths && input.paths.length > 0) {
    args.push("--");
    args.push(...input.paths);
  }
  return execGit(args);
}

export function repoLog(input: { maxCount?: number; paths?: string[] }): GitExecResult {
  const maxCount = Math.min(input.maxCount || 20, 50);
  const args: string[] = ["log", `--max-count=${maxCount}`, "--oneline", "--decorate"];
  if (input.paths && input.paths.length > 0) {
    args.push("--");
    args.push(...input.paths);
  }
  return execGit(args);
}

export function repoShow(input: { ref: string; paths?: string[] }): GitExecResult {
  const args: string[] = ["show", input.ref];
  if (input.paths && input.paths.length > 0) {
    args.push("--");
    args.push(...input.paths);
  }
  return execGit(args);
}

export function repoBranch(input: { mode: "current" | "list" }): GitExecResult {
  if (input.mode === "current") {
    return execGit(["branch", "--show-current"]);
  }
  return execGit(["branch", "--list", "--no-color"]);
}

export function repoStage(paths: string[]): GitExecResult {
  if (!paths || paths.length === 0) {
    return {
      ok: false,
      stdout: "",
      stderr: "[REPO-STAGE-EMPTY] paths must not be empty",
      exitCode: 1,
      argv: ["add"],
    };
  }

  for (const p of paths) {
    if (p === "." || p === "*" || p === ":/") {
      return {
        ok: false,
        stdout: "",
        stderr: `[REPO-STAGE-WILDCARD-BLOCKED] Wildcard path "${p}" is not allowed. Specify exact file paths.`,
        exitCode: 1,
        argv: ["add", ...paths],
      };
    }
    if (p.includes("..")) {
      return {
        ok: false,
        stdout: "",
        stderr: `[REPO-PATH-TRAVERSAL-BLOCKED] Path "${p}" contains path traversal.`,
        exitCode: 1,
        argv: ["add", ...paths],
      };
    }
  }

  assertNoRuntimeStatePaths(paths);

  return execGit(["add", "--", ...paths]);
}

export function repoUnstage(paths: string[]): GitExecResult {
  if (!paths || paths.length === 0) {
    return {
      ok: false,
      stdout: "",
      stderr: "[REPO-UNSTAGE-EMPTY] paths must not be empty",
      exitCode: 1,
      argv: ["restore", "--staged"],
    };
  }

  return execGit(["restore", "--staged", "--", ...paths]);
}

export function getStagedFiles(): string[] {
  const result = execGit(["diff", "--cached", "--name-only"]);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function assertStagedFilesAllowed(expectedPaths: string[]): void {
  const staged = getStagedFiles();

  if (staged.length === 0) {
    throw new Error("[REPO-STAGED-EMPTY] No files are staged for commit.");
  }

  const normalizedExpected = new Set(
    expectedPaths.map((p) => p.replace(/\\/g, "/")),
  );

  for (const s of staged) {
    const normalized = s.replace(/\\/g, "/");
    if (!normalizedExpected.has(normalized)) {
      throw new Error(
        `[REPO-STAGED-FILES-MISMATCH] Staged file "${normalized}" is not in expectedPaths. ` +
        `Expected: [${[...normalizedExpected].join(", ")}]. ` +
        `Unstage unexpected files before committing.`,
      );
    }
  }
}

export function repoCommit(message: string): GitExecResult & { commitSha?: string } {
  if (!message || message.trim().length === 0) {
    return {
      ok: false,
      stdout: "",
      stderr: "[REPO-COMMIT-EMPTY-MESSAGE] Commit message must not be empty.",
      exitCode: 1,
      argv: ["commit"],
    };
  }

  const msgLower = message.toLowerCase();
  if (msgLower.includes("--no-verify") || msgLower.includes("[bypass") ||
      msgLower.includes("core.hookspath") || msgLower.includes("core.skiphooks")) {
    return {
      ok: false,
      stdout: "",
      stderr: "[REPO-HOOK-BYPASS-BLOCKED] Commit message contains hook bypass indicators.",
      exitCode: 1,
      argv: ["commit"],
    };
  }

  const result = execGit(["commit", "-m", message]);
  if (!result.ok) {
    return result;
  }

  const shaResult = execGit(["rev-parse", "HEAD"]);
  const commitSha = shaResult.ok ? shaResult.stdout.trim() : undefined;

  return { ...result, commitSha };
}
