import {
  execFile,
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
} from "node:child_process";
import type { Readable } from "node:stream";
import type { VerifiedCommandPlan } from "./shell-plan";

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
}

function killProcessTree(child: ChildProcess | ChildProcessByStdio<any, any, any>): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
    return;
  } catch {
    // fall through
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // ignore kill failures
  }
}

function collectStream(
  stream: Readable | null,
  sink: "stdout" | "stderr",
  state: {
    stdout: string;
    stderr: string;
    totalBytes: number;
    truncated: boolean;
    aborted: boolean;
  },
  maxOutputBytes: number,
  onLimit: () => void,
): void {
  if (!stream) return;
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    const bytes = Buffer.byteLength(chunk, "utf8");
    state.totalBytes += bytes;
    state[sink] += chunk;
    if (state.totalBytes > maxOutputBytes && !state.truncated) {
      state.truncated = true;
      onLimit();
    }
  });
}

function executeBuffered(
  plan: VerifiedCommandPlan,
  signal?: AbortSignal,
): Promise<CommandExecutionResult> {
  return new Promise((resolve) => {
    let timedOut = false;
    let aborted = Boolean(signal?.aborted);
    let settled = false;
    const child = execFile(
      plan.executable,
      [...plan.args],
      {
        cwd: plan.cwd,
        env: { ...plan.env },
        encoding: "utf8",
        maxBuffer: plan.maxOutputBytes,
        shell: false,
        timeout: plan.timeoutMs,
        windowsHide: true,
        detached: true,
      },
      (error, stdout, stderr) => {
        if (settled) return;
        settled = true;
        cleanup();
        const anyErr = error as NodeJS.ErrnoException & {
          code?: string | number;
          signal?: NodeJS.Signals;
          killed?: boolean;
        };
        const exitCode =
          typeof anyErr?.code === "number" ? anyErr.code : anyErr ? 1 : 0;
        const signalName =
          typeof anyErr?.signal === "string" ? anyErr.signal : null;
        resolve({
          stdout: stdout || "",
          stderr: stderr || (anyErr?.message ?? ""),
          exitCode,
          signal: signalName,
          timedOut,
          aborted,
          truncated: anyErr?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        });
      },
    );

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, plan.timeoutMs + 25);

    const onAbort = () => {
      aborted = true;
      killProcessTree(child);
    };

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function executeStreaming(
  plan: VerifiedCommandPlan,
  signal?: AbortSignal,
): Promise<CommandExecutionResult> {
  return new Promise((resolve) => {
    const child = spawn(plan.executable, [...plan.args], {
      cwd: plan.cwd,
      env: { ...plan.env },
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const state = {
      stdout: "",
      stderr: "",
      totalBytes: 0,
      truncated: false,
      aborted: Boolean(signal?.aborted),
    };
    let timedOut = false;
    let settled = false;

    const finalize = (exitCode: number, signalName: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        stdout: state.stdout,
        stderr: state.stderr,
        exitCode,
        signal: signalName,
        timedOut,
        aborted: state.aborted,
        truncated: state.truncated,
      });
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, plan.timeoutMs);

    const onAbort = () => {
      state.aborted = true;
      killProcessTree(child);
    };

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    collectStream(child.stdout, "stdout", state, plan.maxOutputBytes, () => {
      killProcessTree(child);
    });
    collectStream(child.stderr, "stderr", state, plan.maxOutputBytes, () => {
      killProcessTree(child);
    });

    child.on("error", (error: Error) => {
      state.stderr += state.stderr ? `\n${error.message}` : error.message;
      finalize(1, null);
    });
    child.on("close", (code, signalName) => {
      finalize(code ?? 1, signalName);
    });

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export async function executeVerifiedCommandPlan(
  plan: VerifiedCommandPlan,
  signal?: AbortSignal,
): Promise<CommandExecutionResult> {
  if (plan.outputMode === "stream") {
    return executeStreaming(plan, signal);
  }
  return executeBuffered(plan, signal);
}
