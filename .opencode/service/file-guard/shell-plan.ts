import * as fs from "node:fs";
import * as path from "node:path";
import { splitRepoShellCommand } from "../repo/classify";

export interface VerifiedCommandPlan {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  outputMode: "buffered" | "stream";
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ShellPlanFailure {
  ok: false;
  ruleId: string;
  message: string;
}

export interface ShellPlanSuccess {
  ok: true;
  plan: VerifiedCommandPlan;
}

export type ShellPlanResult = ShellPlanFailure | ShellPlanSuccess;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1 * 1024 * 1024;
const STREAM_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

const EXECUTABLE_CANDIDATES: Record<string, string[]> = {
  bash: ["/usr/bin/bash", "/bin/bash"],
  bun: ["/home/zhaoge/.bun/bin/bun", "/usr/bin/bun", "/bin/bun"],
  cat: ["/usr/bin/cat", "/bin/cat"],
  cp: ["/usr/bin/cp", "/bin/cp"],
  date: ["/usr/bin/date", "/bin/date"],
  dd: ["/usr/bin/dd", "/bin/dd"],
  diff: ["/usr/bin/diff", "/bin/diff"],
  file: ["/usr/bin/file", "/bin/file"],
  find: ["/usr/bin/find", "/bin/find"],
  git: ["/usr/bin/git", "/bin/git"],
  grep: ["/usr/bin/grep", "/bin/grep"],
  head: ["/usr/bin/head", "/bin/head"],
  ls: ["/usr/bin/ls", "/bin/ls"],
  md5sum: ["/usr/bin/md5sum", "/bin/md5sum"],
  mkdir: ["/usr/bin/mkdir", "/bin/mkdir"],
  mv: ["/usr/bin/mv", "/bin/mv"],
  node: [process.execPath, "/usr/bin/node", "/bin/node"],
  npx: ["/usr/bin/npx", "/bin/npx"],
  pwd: ["/usr/bin/pwd", "/bin/pwd"],
  python: ["/usr/bin/python", "/bin/python"],
  python3: ["/usr/bin/python3", "/bin/python3"],
  rm: ["/usr/bin/rm", "/bin/rm"],
  sed: ["/usr/bin/sed", "/bin/sed"],
  sha256sum: ["/usr/bin/sha256sum", "/bin/sha256sum"],
  sh: ["/usr/bin/sh", "/bin/sh"],
  sort: ["/usr/bin/sort", "/bin/sort"],
  stat: ["/usr/bin/stat", "/bin/stat"],
  tail: ["/usr/bin/tail", "/bin/tail"],
  tee: ["/usr/bin/tee", "/bin/tee"],
  touch: ["/usr/bin/touch", "/bin/touch"],
  uname: ["/usr/bin/uname", "/bin/uname"],
  uniq: ["/usr/bin/uniq", "/bin/uniq"],
  wc: ["/usr/bin/wc", "/bin/wc"],
  which: ["/usr/bin/which", "/bin/which"],
  whoami: ["/usr/bin/whoami", "/bin/whoami"],
};

const STREAM_COMMANDS = new Set(["find"]);

function stripOuterQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function decodeToken(raw: string): string {
  const stripped = stripOuterQuotes(raw);
  return stripped.replace(/\\(["'\\ ])/g, "$1");
}

function isQuoted(raw: string): boolean {
  return (
    raw.length >= 2 &&
    ((raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith('"') && raw.endsWith('"')))
  );
}

function containsGlob(raw: string): boolean {
  if (isQuoted(raw)) return false;
  return /[*?\[]/.test(raw);
}

function resolveExecutable(token: string): string | null {
  if (path.isAbsolute(token)) {
    return fs.existsSync(token) ? token : null;
  }

  const candidates = EXECUTABLE_CANDIDATES[token];
  if (!candidates) return null;
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function buildMinimalEnv(executableName: string): Readonly<Record<string, string>> {
  const env: Record<string, string> = {
    HOME: process.env.HOME || "/tmp",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || process.env.LANG || "C.UTF-8",
    PATH: "/usr/bin:/bin:/home/zhaoge/.bun/bin:/home/zhaoge/.local/bin",
    PWD: process.cwd(),
    TMPDIR: process.env.TMPDIR || "/tmp",
  };

  if (process.env.TERM) env.TERM = process.env.TERM;
  if (executableName === "git") env.GIT_TERMINAL_PROMPT = "0";
  if (executableName === "gh") env.GH_PROMPT_DISABLED = "1";

  return env;
}

export function buildVerifiedCommandPlan(
  command: string,
  options?: { cwd?: string; timeoutMs?: number; maxOutputBytes?: number },
): ShellPlanResult {
  const argvRaw = splitRepoShellCommand(command);
  if (argvRaw === null) {
    return {
      ok: false,
      ruleId: "SHELL-COMPOSITION-DENY",
      message:
        "Command requires shell composition, redirection, or multi-step execution. " +
        "Use a first-class tool or an audited repository script instead.",
    };
  }

  if (argvRaw.length === 0) {
    return {
      ok: false,
      ruleId: "SHELL-EMPTY-COMMAND",
      message: "Command is empty after parsing.",
    };
  }

  for (const raw of argvRaw) {
    if (/[`]/.test(raw) || /\$\(|\$\{|\$[A-Za-z_]/.test(raw)) {
      return {
        ok: false,
        ruleId: "SHELL-EXPANSION-DENY",
        message:
          "Command requires shell expansion or substitution. Use explicit arguments instead.",
      };
    }
    if (containsGlob(raw)) {
      return {
        ok: false,
        ruleId: "SHELL-GLOB-DENY",
        message:
          "Wildcard expansion is not allowed in safe_shell. Use explicit paths or a dedicated tool.",
      };
    }
  }

  const executableToken = decodeToken(argvRaw[0]);
  if (!executableToken || /^[A-Za-z_][A-Za-z0-9_]*=/.test(executableToken)) {
    return {
      ok: false,
      ruleId: "SHELL-EXECUTABLE-DENY",
      message: "Environment-prefixed commands are not supported in safe_shell.",
    };
  }

  const executable = resolveExecutable(executableToken);
  if (!executable) {
    return {
      ok: false,
      ruleId: "SHELL-EXECUTABLE-DENY",
      message: `Executable "${executableToken}" is not in the verified executable map.`,
    };
  }

  const args = argvRaw.slice(1).map(decodeToken);
  const cwd = path.resolve(options?.cwd || process.cwd());
  const outputMode = STREAM_COMMANDS.has(executableToken) ? "stream" : "buffered";
  const timeoutMs = Math.max(1, options?.timeoutMs || DEFAULT_TIMEOUT_MS);
  const maxOutputBytes =
    options?.maxOutputBytes ||
    (outputMode === "stream" ? STREAM_MAX_OUTPUT_BYTES : DEFAULT_MAX_OUTPUT_BYTES);

  return {
    ok: true,
    plan: {
      executable,
      args,
      cwd,
      env: buildMinimalEnv(executableToken),
      outputMode,
      timeoutMs,
      maxOutputBytes,
    },
  };
}

export function isVerifiedCommandPlan(value: unknown): value is VerifiedCommandPlan {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.executable !== "string" || !path.isAbsolute(candidate.executable)) {
    return false;
  }
  if (!Array.isArray(candidate.args) || candidate.args.some((arg) => typeof arg !== "string")) {
    return false;
  }
  if (typeof candidate.cwd !== "string" || !path.isAbsolute(candidate.cwd)) {
    return false;
  }
  if (
    !candidate.env ||
    typeof candidate.env !== "object" ||
    Object.values(candidate.env as Record<string, unknown>).some((v) => typeof v !== "string")
  ) {
    return false;
  }
  if (candidate.outputMode !== "buffered" && candidate.outputMode !== "stream") {
    return false;
  }
  if (
    typeof candidate.timeoutMs !== "number" ||
    candidate.timeoutMs <= 0 ||
    typeof candidate.maxOutputBytes !== "number" ||
    candidate.maxOutputBytes <= 0
  ) {
    return false;
  }
  return true;
}
