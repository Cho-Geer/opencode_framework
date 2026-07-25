// service/file-guard/diagnostic-baseline.ts — TSC diagnostic baseline
// Source: baseline-diagnostic.ts (full migration, imports updated)

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import * as path from "node:path";
import { readSubState } from "../../lib/substate-manager";
import { atomicWriteSubState } from "../../lib/state-utils";
import { writeLog } from "../../lib/log-manager";
import type { DiagnosticBaselineEntry } from "../../lib/substate-types";

const SRC = "service-baseline-diagnostic";

/**
 * Capture current tsc baseline into diagnostic_baseline substate.
 */
export function captureBaseline(opts: {
  projectRoot: string;
  source: string;
  taskId?: string;
}): boolean {
  const { projectRoot, source, taskId } = opts;
  const TSC_TIMEOUT_MS = 120_000;

  let stdout = "";
  try {
    stdout = execSync(
      "npx tsc --noEmit --pretty false --incremental false 2>&1; exit 0",
      {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: TSC_TIMEOUT_MS,
        maxBuffer: 50 * 1024 * 1024,
      },
    );
  } catch (e: any) {
    stdout = e.stdout || e.stderr || "";
  }

  const errors = parseTscBaseline(stdout, projectRoot);
  const bucketCounts: Record<string, number> = {};
  for (const e of errors) {
    const rel = path.relative(projectRoot, e.file).replace(/^\.opencode\//, "");
    const seg = rel.split("/");
    const bucket =
      seg[0] === "lib" && seg[1] === "__tests__"
        ? "lib/__tests__"
        : seg[0] === "scripts" && seg[1] === "mcp-tools"
          ? "scripts/mcp-tools"
          : seg[0] === "scripts" && seg[1] === "command-tools"
            ? "scripts/command-tools"
            : seg[0];
    bucketCounts[bucket] = (bucketCounts[bucket] || 0) + 1;
  }

  const hash = hashTscOutput(stdout);
  const tscVersion = readTscVersion(projectRoot);

  const ok = atomicWriteSubState("diagnostic_baseline", (state: any) => {
    state.hash = hash;
    state.total_errors = errors.length;
    state.bucket_counts = bucketCounts;
    state.errors = errors;
    state.captured_at = new Date().toISOString();
    state.tsc_version = tscVersion;
    state.source = source;
    state.task_id = taskId;
  });

  writeLog(SRC, "INFO", {
    event: "BASELINE-CAPTURED",
    detail: `source=${source} total=${errors.length} hash=${hash.slice(0, 12)} taskId=${taskId || "n/a"}`,
  });
  return ok;
}

/**
 * Parse baseline tsc output into structured entries.
 */
export function parseTscBaseline(
  output: string,
  projectRoot: string,
): DiagnosticBaselineEntry[] {
  const entries: DiagnosticBaselineEntry[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/);
    if (!m) continue;
    const [, rawFile, ln, ch, code, msg] = m;
    const abs = path.resolve(projectRoot, rawFile);
    entries.push({
      file: abs,
      code,
      message: msg.trim().slice(0, 200),
      line: parseInt(ln, 10),
      character: parseInt(ch, 10),
    });
  }
  return entries;
}

export function hashTscOutput(output: string): string {
  const normalized = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .sort()
    .join("\n");
  return createHash("sha256").update(normalized).digest("hex");
}

function readTscVersion(projectRoot: string): string {
  try {
    return execSync("npx tsc --version", {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Compare target's current errors against baseline.
 * v2: Only for progress tracking — zero-tolerance gate does NOT use this for blocking.
 */
export function compareWithBaseline(
  targetAbsPath: string,
  currentErrors: DiagnosticBaselineEntry[],
): {
  verdict:
    | "clean"
    | "new_error"
    | "error_count_increased"
    | "error_count_decreased"
    | "unchanged";
  baselineCount: number;
  currentCount: number;
  newErrors: DiagnosticBaselineEntry[];
} {
  const baseline = readSubState("diagnostic_baseline") as any;
  const baselineErrors = (
    (baseline?.errors || []) as DiagnosticBaselineEntry[]
  ).filter((e) => e.file === targetAbsPath);
  const baselineCount = baselineErrors.length;
  const currentCount = currentErrors.length;

  if (currentCount === 0 && baselineCount === 0) {
    return { verdict: "clean", baselineCount: 0, currentCount: 0, newErrors: [] };
  }
  if (currentCount > 0 && baselineCount === 0) {
    return { verdict: "new_error", baselineCount: 0, currentCount, newErrors: currentErrors };
  }
  if (currentCount > baselineCount) {
    const baseSet = new Set(
      baselineErrors.map((e) => `${e.line}|${e.code}|${e.message}`),
    );
    const newErrors = currentErrors.filter(
      (e) => !baseSet.has(`${e.line}|${e.code}|${e.message}`),
    );
    return { verdict: "error_count_increased", baselineCount, currentCount, newErrors };
  }
  if (currentCount < baselineCount) {
    return { verdict: "error_count_decreased", baselineCount, currentCount, newErrors: [] };
  }
  return { verdict: "unchanged", baselineCount, currentCount, newErrors: [] };
}

/**
 * Record project-wide baseline drift (L4) — advisory observability only.
 */
export function recordBaselineDrift(opts: {
  sessionID: string;
  callID?: string;
  currentHash: string;
  targetAbsPath: string;
}): void {
  const baseline = readSubState("diagnostic_baseline") as any;
  if (!baseline?.hash) return;
  if (baseline.hash === opts.currentHash) return;

  writeLog(SRC, "WARN", {
    sessionID: opts.sessionID,
    callID: opts.callID,
    event: "BASELINE-DRIFT",
    detail:
      `target=${opts.targetAbsPath} ` +
      `baseline_hash=${baseline.hash.slice(0, 12)} ` +
      `current_hash=${opts.currentHash.slice(0, 12)} ` +
      `baseline_total=${baseline.total_errors}`,
  });
}
