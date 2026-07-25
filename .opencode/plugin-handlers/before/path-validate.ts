// plugin-handlers/before/path-validate.ts — Path structural validation
// Performs safety checks on file paths before write operations:
//   1. NULL BYTE — prevent null byte injection (%00 or \0)
//   2. PATH TRAVERSAL — prevent directory escape via ../ that leaves project root
//   3. WORKTREE BOUNDARY — ensure absolute paths stay within project root
//   4. PATH LENGTH — reject overly long paths (>4096 bytes)
//   5. INVALID CHARS — reject paths with control characters (0x00-0x1F except tab/newline)
//   6. RESERVED NAMES — warn about Windows reserved names (CON, NUL, etc.)
//
// v2.0 (2026-07-12) — Enhanced: multi-path extraction, normalization, symlink resolution

import { writeLog } from "../../lib/log-manager";
import { writeJsonl } from "../../lib/jsonl-writer";
import * as path from "path";
import * as fs from "fs";
import { extractShellLocalPaths } from "../../service/tool-governance/shell-targets";

const SRC = "plugin-path-validate";
const MAX_PATH_LENGTH = 4096;
const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();

const WRITE_TOOLS = new Set([
  "safe_edit", "safe_delete", "safe_restore", "safe_shell", "safe_mkdir", "safe_framework_edit",
]);

const REJECTED_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

const RESERVED_NAMES = /(^|\/|\\)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$|\/|\\)/i;

export const name = "path-validate";
export const tools = ["*"];

function extractFilePaths(tool: string, args: any): string[] {
  if (!args) return [];
  switch (tool) {
    case "safe_edit":
    case "safe_framework_edit": {
      const fp = (args.filePath || args.file_path || args.path || "").toString();
      return fp ? [fp] : [];
    }
    case "safe_delete":
    case "safe_restore": {
      const fp = (args.filePath || args.file_path || args.path || args.target || "").toString();
      return fp ? [fp] : [];
    }
    case "safe_mkdir": {
      const fp = (args.path || args.filePath || "").toString();
      return fp ? [fp] : [];
    }
    case "safe_shell": {
      const cmd = (args.command || "").toString();
      if (!cmd) return [];
      return extractShellLocalPaths(cmd);
    }
    default:
      return [];
  }
}

function containsNullByte(filePath: string): boolean {
  return filePath.includes("\0") || filePath.includes("%00");
}

function triesToEscapeWorktree(filePath: string): boolean {
  if (filePath.startsWith("/")) {
    const root = path.resolve(PROJECT_ROOT);
    return !filePath.startsWith(root);
  }
  if (filePath.includes("..")) {
    try {
      const resolved = path.resolve(PROJECT_ROOT, filePath);
      return !resolved.startsWith(PROJECT_ROOT);
    } catch {
      return true;
    }
  }
  return false;
}

function isOverlyLong(filePath: string): boolean {
  return Buffer.byteLength(filePath, "utf-8") > MAX_PATH_LENGTH;
}

function containsInvalidChars(filePath: string): boolean {
  return REJECTED_CHARS.test(filePath);
}

function matchesReservedName(filePath: string): boolean {
  return RESERVED_NAMES.test(filePath);
}

function normalizePath(rawPath: string): string {
  let normalized = path.normalize(rawPath);
  if (normalized.startsWith("/")) {
    normalized = path.resolve(normalized);
  }
  return normalized;
}

function resolveSymlinks(absPath: string): string {
  try {
    return fs.realpathSync.native(absPath);
  } catch {
    return absPath;
  }
}

function buildBlockMessage(toolName: string, checkPath: string, violations: string[]): string {
  return (
    `[PATH-VALIDATE] ${toolName} blocked: path validation failed.\n` +
    `Path: "${checkPath}"\n` +
    `Violations:\n` +
    violations.map((v) => `  - ${v}`).join("\n") + "\n\n" +
    `Use a valid path within the project root.`
  );
}

function logAndThrow(toolName: string, rawPath: string, checkPath: string, violations: string[], sessionID: string): never {
  const msg = buildBlockMessage(toolName, checkPath, violations);
  writeLog(SRC, "WARN", {
    event: "PATH-VALIDATE-BLOCKED",
    tool: toolName, path: checkPath, sessionID,
    violations,
  });
  writeJsonl("audit", {
    event: "path_validate_blocked",
    tool: toolName, path: checkPath, violations,
    result: "blocked",
  }, { sessionID, tool: toolName });
  throw new Error(msg);
}

export async function handle(input: any, _output: any): Promise<void> {
  const toolName = input.tool as string;
  const args = input.args || _output?.args || {};
  const sessionID = input.sessionID || "unknown";

  if (!WRITE_TOOLS.has(toolName)) return;

  const filePaths = extractFilePaths(toolName, args);

  if (filePaths.length === 0 && toolName === "safe_shell") return;
  if (filePaths.length === 0) return;

  for (const rawPath of filePaths) {
    if (containsNullByte(rawPath)) {
      logAndThrow(toolName, rawPath, rawPath, ["NULL_BYTE: path contains null byte injection"], sessionID);
    }

    if (containsInvalidChars(rawPath)) {
      logAndThrow(toolName, rawPath, rawPath, ["INVALID_CHARS: path contains control characters"], sessionID);
    }

    let checkPath = normalizePath(rawPath);

    if (checkPath.startsWith("/")) {
      checkPath = resolveSymlinks(checkPath);
    }

    const violations: string[] = [];

    if (checkPath.includes("..") && triesToEscapeWorktree(checkPath)) {
      violations.push(`PATH_TRAVERSAL: path escapes project root via "../"`);
    }

    if (checkPath.startsWith("/") && triesToEscapeWorktree(checkPath)) {
      violations.push(`WORKTREE_BOUNDARY: absolute path "${checkPath}" is outside project root`);
    }

    if (isOverlyLong(checkPath)) {
      violations.push(`PATH_LENGTH: path exceeds ${MAX_PATH_LENGTH} bytes`);
    }

    const reservedMatch = matchesReservedName(checkPath);
    if (reservedMatch) {
      writeLog(SRC, "WARN", {
        event: "PATH-VALIDATE-RESERVED-NAME",
        tool: toolName, path: checkPath, sessionID,
        detail: "path contains reserved Windows name (cross-platform safety)",
      });
    }

    if (violations.length > 0) {
      logAndThrow(toolName, rawPath, checkPath, violations, sessionID);
    }

    writeJsonl("audit", {
      event: "path_validate_allowed",
      tool: toolName, path: checkPath, result: "allowed",
    }, { sessionID, tool: toolName });
  }
}
