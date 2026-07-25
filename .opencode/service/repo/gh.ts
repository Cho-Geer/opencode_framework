import { execFileSync } from "node:child_process";
import { writeLog } from "../../lib/log-manager";

const SRC = "repo-gh-service";
const DEFAULT_TIMEOUT_MS = 30000;

export interface GhExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  argv: string[];
}

export function execGh(argv: string[], timeoutMs?: number): GhExecResult {
  const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;
  try {
    const stdout = execFileSync("gh", argv, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
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
      event: "GH-EXEC-FAILED",
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

export function ghPrCreate(input: {
  title: string;
  body?: string;
  base?: string;
  head?: string;
  dryRun?: boolean;
}): GhExecResult {
  const args: string[] = ["pr", "create", "--title", input.title];
  if (input.body) args.push("--body", input.body);
  if (input.base) args.push("--base", input.base);
  if (input.head) args.push("--head", input.head);
  if (input.dryRun) args.push("--dry-run");
  return execGh(args);
}

export function ghPrComment(input: {
  pr: string | number;
  body: string;
}): GhExecResult {
  return execGh(["pr", "comment", String(input.pr), "--body", input.body]);
}

export function ghIssueComment(input: {
  issue: string | number;
  body: string;
}): GhExecResult {
  return execGh(["issue", "comment", String(input.issue), "--body", input.body]);
}
