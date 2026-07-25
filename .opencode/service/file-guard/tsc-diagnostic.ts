/**
 * tsc-diagnostic.ts — ESM-safe TypeScript diagnostic utilities
 * ═══════════════════════════════════════════════════════════════════════
 * Extracted from code-quality-lib.ts (MCP CJS-style tool) per GAP 4
 * (lsp-diagnostic-gate-e2e-acceptance-gaps.md §4.4).
 *
 * Provides runTscDiagnostic() and parseTscOutput() as ESM exports.
 * Used by tsc-diag-track.ts plugin (static import) and re-exported by
 * code-quality-lib.ts for backward-compatible MCP tool access.
 *
 * @author @Super-Admin
 * @since 2026-06-27 (GAP 4 extraction)
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

/**
 * Result type for runTscDiagnostic.
 */
export interface TscDiagnosticResult {
  pass: boolean;
  errors?: TscDiagnosticError[];
  elapsed?: number;
  detail?: string;
  /** "target_clean_project_dirty" when target has no errors but project does */
  diagnostic_status?: string;
  /** G-7 (2026-06-27): SHA-256 of sorted tsc output (for L4 drift detection) */
  rawOutputHash?: string;
  /** G-7 (2026-06-27): ALL parsed errors across project (for baseline capture) */
  allErrors?: TscDiagnosticError[];
}

export interface TscDiagnosticError {
  message: string;
  line: number;
  character: number;
  code: string;
}

// ═══════════════════════════════════════════════════════════════
// runTscDiagnostic
// ═══════════════════════════════════════════════════════════════

const TSC_TIMEOUT_MS = 30000;
const TSC_BUILDINFO = ".opencode/state/.tsbuildinfo";

/**
 * Run tsc --noEmit --incremental on the ENTIRE project (root tsconfig).
 * Three-state return:
 *   1. pass=true, no diagnostic_status → tsc fully clean
 *   2. pass=false, errors populated → target file has TS errors
 *   3. pass=true, diagnostic_status="target_clean_project_dirty" → target
 *      clean but project has other errors
 *   4. pass=false, diagnostic_status="unknown" → tsc timed out / crashed
 *
 * @param absPath - absolute path to changed file (for error scoping)
 * @param projectRoot - project root directory (cwd for tsc)
 */
export function runTscDiagnostic(
  absPath: string,
  projectRoot: string,
): TscDiagnosticResult {
  if (!fs.existsSync(absPath)) {
    return { pass: true, detail: `File not found: ${absPath}` };
  }
  if (!absPath.endsWith(".ts") && !absPath.endsWith(".tsx")) {
    return { pass: true, detail: "Not a TypeScript file" };
  }

  try {
    const start = Date.now();
    execSync(
      `npx tsc --noEmit --incremental --pretty false --tsBuildInfoFile ${TSC_BUILDINFO}`,
      {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: TSC_TIMEOUT_MS,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const elapsed = Date.now() - start;
    return {
      pass: true,
      elapsed,
      detail: `tsc passed (${elapsed}ms)`,
      rawOutputHash: "",
      allErrors: [],
    };
  } catch (e: any) {
    const output = e.stdout || e.stderr || e.message || "";
    const errors = parseTscOutput(output, absPath);
    const allErrors = parseAllTscOutput(output);
    const rawOutputHash = computeOutputHash(output);

    // Distinguish timeout/crash from project-level errors
    if (
      e.killed ||
      e.signal === "SIGTERM" ||
      /timed out/i.test(e.message || "")
    ) {
      return {
        pass: false,
        errors: [],
        allErrors,
        rawOutputHash,
        diagnostic_status: "unknown",
        detail: `tsc timed out or crashed: ${output.substring(0, 300)}`,
      };
    }
    if (errors.length > 0) {
      return {
        pass: false,
        errors,
        allErrors,
        rawOutputHash,
        detail: output.substring(0, 500),
      };
    }
    // tsc failed but target file has no errors → project-level only
    return {
      pass: true,
      errors: [],
      allErrors,
      rawOutputHash,
      diagnostic_status: "target_clean_project_dirty",
      detail: output.substring(0, 500),
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// parseTscOutput
// ═══════════════════════════════════════════════════════════════

function computeOutputHash(output: string): string {
  const normalized = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .sort()
    .join("\n");
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Parse tsc output to extract ALL errors across the project.
 */
export function parseAllTscOutput(output: string): TscDiagnosticError[] {
  const errors: TscDiagnosticError[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(
      /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/,
    );
    if (!match) continue;
    const [, , lineNum, charNum, severity, code, message] = match;
    if (severity !== "error") continue;
    errors.push({
      message: message.trim(),
      line: parseInt(lineNum, 10),
      character: parseInt(charNum, 10),
      code,
    });
  }
  return errors;
}

/**
 * Parse tsc output to extract errors for a specific file.
 * Format: file.ts(line,col): error TSXXXX: message
 */
export function parseTscOutput(
  output: string,
  targetFile: string,
): TscDiagnosticError[] {
  const errors: TscDiagnosticError[] = [];
  const targetAbs = path.resolve(targetFile);
  const lines = output.split("\n");

  for (const line of lines) {
    const match = line.match(
      /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/,
    );
    if (!match) continue;
    const [, filePath, lineNum, charNum, severity, code, message] = match;
    if (severity !== "error") continue;
    const absFilePath = path.resolve(filePath);
    if (absFilePath === targetAbs) {
      errors.push({
        message: message.trim(),
        line: parseInt(lineNum, 10),
        character: parseInt(charNum, 10),
        code,
      });
    }
  }
  return errors;
}
