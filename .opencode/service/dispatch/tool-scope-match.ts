/**
 * Tool Scope — Matching Logic (tool-scope-match)
 *
 * Tool classification, shell command analysis, and UC7KS write target detection.
 * Functions that determine whether a tool/shell command modifies files and
 * whether file paths are enforcement targets.
 *
 * Split from lib/tool-scope.ts for modularity.
 * Cross-imports parseShellWriteTargets from ./tool-scope-paths (circular-safe:
 * all references are inside function bodies, resolved at call time).
 *
 * @module tool-scope-match
 */

import * as path from "node:path";
import { isSourceFile } from "../../lib/state-utils";
import { parseShellWriteTargets } from "./tool-scope-paths";

// ============================================================================
// Tool Classification
// ============================================================================

export function isModifyTool(tool: string): boolean {
  return (
    tool === "docker_run_container" ||
    tool === "docker_create_container" ||
    tool === "docker_recreate_container" ||
    tool === "docker_build_image" ||
    tool === "write" ||
    tool === "edit" ||
    tool === "safe_edit" ||
    tool === "safe_mkdir" ||
    tool === "safe_delete" ||
    tool === "safe_shell" ||
    // FW-EXPLORE-WRITE-BLOCK (2026-06-25): bash treated as modify tool
    // so scope-before.ts/gate-before.ts intercept write commands.
    // getEffectivePathScopePaths() uses isModifyShell() to distinguish
    // read-only bash (ls, cat) from write bash (echo >, rm, cp).
    tool === "bash"
  );
}

export function getModifyPath(args: Record<string, unknown>): string {
  return (args?.filePath || args?.dirPath || args?.command || "") as string;
}

// ============================================================================
// Shell Command Parsing & Classification
// ============================================================================

// Quote-aware: splits only when not inside '...' or "...".
export function splitShellCommand(command: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      current += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (
      ch === ";" ||
      ch === "|" ||
      ch === "&" ||
      ch === "<" ||
      ch === ">" ||
      ch === "\n"
    ) {
      if (current.trim()) result.push(current.trim());
      if (
        (ch === "&" || ch === "|" || ch === "<" || ch === ">") &&
        command[i + 1] === ch
      )
        i++;
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) result.push(current.trim());
  return result.length > 0 ? result : [command.trim()];
}

export function isModifyShell(args: Record<string, unknown>): boolean {
  const cmd = (args?.command || "") as string;
  if (!cmd) return false;
  const normalized = stripBenignFdRedirects(cmd);
  // FW-EXPLORE-WRITE-BLOCK (2026-06-25): Check for shell redirections (> >>)
  // that write to files, even from non-modify commands like echo.
  // GAP B1 (2026-06-27): strip benign stderr redirects first to avoid
  // false positives from 2>/dev/null, 2>&1, etc.
  if (/>>|>\s*[^\s&|]/.test(normalized)) return true;
  const subCmds = splitShellCommand(normalized);
  const modifyRe =
    /^(cp|mv|rm|python3|node|bun|npx|tee|cat|sed|dd|sh|bash|touch|mkdir)\b|^git\s+(add|commit|push|merge|rebase|reset)\b/;
  return subCmds.some((s) => modifyRe.test(s));
}

/**
 * Strip benign file descriptor redirects from a shell command string.
 * GAP B1 (2026-06-27): Prevents 2>/dev/null, 2>&1, 1>/dev/null etc.
 * from being misidentified as file write redirects.
 *
 * Preserves: >file, >>file, cat >file, tee file (actual write targets).
 */
function stripBenignFdRedirects(command: string): string {
  return command
    .replace(/\s+\d?>\s*\/dev\/null\b/g, "") // 2>/dev/null, >/dev/null
    .replace(/\s+\d?>&\d\b/g, "") // 2>&1, 1>&2
    .replace(/\s+\d?>>\s*\/dev\/null\b/g, ""); // 2>>/dev/null
}

/**
 * Shell command classification result.
 * GAP B2 (2026-06-27): Distinguished read-only commands from true writes,
 * enabling scope-before to only block actual write operations.
 */
export type ShellClassification =
  | { kind: "read_only"; reason: string }
  | { kind: "write"; paths: string[] }
  | { kind: "unparseable_write"; reason: string };

/**
 * Classify a shell command as read-only, known write, or unparseable write.
 * GAP B2/B3 (2026-06-27): Provides a single source of truth for shell
 * command classification, used by both scope-before and safe-bash.
 */
export function classifyShellCommand(command: string): ShellClassification {
  if (!command || typeof command !== "string") {
    return { kind: "read_only", reason: "empty command" };
  }

  const trimmed = command.trim();
  const normalized = stripBenignFdRedirects(trimmed);

  // Check for actual write redirects on normalized string
  if (/>>|>\s*[^\s&|]/.test(normalized)) {
    const scope = parseShellWriteTargets(normalized);
    if (scope.paths.length > 0) return { kind: "write", paths: scope.paths };
    return {
      kind: "unparseable_write",
      reason: "write redirect with unparseable target",
    };
  }

  // Read-only allowlist (GAP B2)
  const cmdMatch = normalized.match(/^(\S+)/);
  if (!cmdMatch) return { kind: "read_only", reason: "unparseable" };
  const cmd = cmdMatch[1];

  // Explicit read-only commands (no file modification)
  if (
    /^(ls|grep|rg|find|which|echo|cd|pwd|cat|head|tail|wc|diff|sha256sum|sort|uniq|env|printenv)$/.test(
      cmd,
    )
  ) {
    // Only allow cat if no write redirect (already handled above)
    return { kind: "read_only", reason: `command=${cmd}` };
  }

  // npx/bun/node with read-only flags
  if (cmd === "npx") {
    // npx tsc --noEmit, npx depcruise, npx prettier --check etc.
    if (
      /\b--noEmit\b/.test(normalized) ||
      /\b--check\b/.test(normalized) ||
      /\b--list-different\b/.test(normalized)
    ) {
      return { kind: "read_only", reason: "npx with read-only flag" };
    }
    return { kind: "unparseable_write", reason: "npx may modify files" };
  }

  if (cmd === "bun") {
    // bun --check file.ts, bun test (read-only if no write targets)
    if (/^\s*bun\s+--check\b/.test(normalized)) {
      return { kind: "read_only", reason: "bun --check" };
    }
    return { kind: "unparseable_write", reason: "bun may modify files" };
  }

  if (cmd === "node" || cmd === "python3") {
    // Check for -e / -c with inline code — inspect for write APIs
    if (
      (cmd === "node" && normalized.includes(" -e ")) ||
      (cmd === "python3" && normalized.includes(" -c "))
    ) {
      const writeApis =
        /writeFile|appendFile|fs\.write|fs\.append|fs\.rm|fs\.unlink|fs\.rename|fs\.mkdir|createWriteStream|child_process|exec\(|spawn\(|open\(/;
      if (writeApis.test(normalized)) {
        return {
          kind: "unparseable_write",
          reason: "inline code contains write APIs",
        };
      }
      // node -e/bun -e with only require/readFile is read-only
      return { kind: "read_only", reason: "inline code without write APIs" };
    }
    return {
      kind: "unparseable_write",
      reason: `${cmd} script execution may modify files`,
    };
  }

  // Known write commands
  const writeCmds = /^(cp|mv|rm|tee|sed|dd|touch|mkdir)$/;
  if (writeCmds.test(cmd)) {
    const scope = parseShellWriteTargets(trimmed);
    if (scope.paths.length > 0) return { kind: "write", paths: scope.paths };
    return {
      kind: "unparseable_write",
      reason: `write command ${cmd} with unparseable targets`,
    };
  }

  // sh/bash with explicit script
  if ((cmd === "sh" || cmd === "bash") && !normalized.includes("-c")) {
    return { kind: "read_only", reason: "script execution (no -c)" };
  }
  if ((cmd === "sh" || cmd === "bash") && normalized.includes("-c")) {
    return {
      kind: "unparseable_write",
      reason: "sh/bash -c with unparseable content",
    };
  }

  return { kind: "unparseable_write", reason: `unknown command ${cmd}` };
}

/**
 * Get the effective file path for path-scope checks, handling safe_shell
 * specially: only cp/mv/rm commands have a meaningful file path; other
 * shell commands return null (their args.command is an arbitrary string,
 * not a file path).
 *
 * @deprecated Phase 2 (2026-06-18): Use getEffectivePathScopePaths() for
 * multi-path support and shell write target parsing. This function is kept
 * as backward-compat wrapper.
 */
export function getEffectivePathScopeFilePath(
  tool: string,
  args: Record<string, any>,
): string | null {
  if (tool === "safe_shell")
    return isModifyShell(args) ? getModifyPath(args) : null;
  return getModifyPath(args);
}

// ============================================================================
// UC7KS Write Target Detection
// ============================================================================

/**
 * Determine if a file path triggers UC7-001 write-before-read enforcement.
 * Phase 2 (2026-06-18): Expanded beyond source files to include all
 * framework infrastructure, review/design docs, and root config files.
 *
 * Include:
 *   - Source files (via isSourceFile): .ts/.tsx/.js/.jsx/.html/.scss/.prisma
 *   - .opencode/** (all framework files, excluded logs)
 *   - docs/review/**
 *   - docs/design/**
 *   - AGENTS.md
 *   - contract.yaml
 *   - opencode.json
 *
 * Exclude:
 *   - .task_temp/_logs/**
 *   - logs/**
 *   - node_modules/**
 *   - .task_temp/**
 *   - task_temp/**
 */
export function isUC7KSWriteTarget(filePath: string): boolean {
  if (!filePath) return false;

  // Resolve relative to project root
  var root = process.env.OPENCODE_ROOT || ".";
  var resolved = filePath;
  if (!filePath.startsWith("/")) {
    resolved = path.resolve(root, filePath);
  }
  var rel = resolved;
  if (resolved.startsWith(root)) {
    rel = resolved.substring(root.length).replace(/^\//, "");
  }

  // Check exclusions first
  if (isUC7KSExcludedPath(rel)) return false;

  // Source files (existing coverage)
  if (isSourceFile(rel)) return true;

  // Framework files (.opencode/**, excluding logs)
  if (rel.startsWith(".opencode/")) return true;

  // Review and design docs
  if (rel.startsWith("docs/review/") || rel.startsWith("docs/design/"))
    return true;

  // Root config files
  if (rel === "AGENTS.md" || rel === "contract.yaml" || rel === "opencode.json")
    return true;

  return false;
}

/**
 * Determine if a file path is EXCLUDED from UC7-001 enforcement.
 * Phase 2 (2026-06-18): Excluded paths are log files, temp artifacts,
 * node_modules, and the knowledge cache itself (managed by KC + UC7-008).
 */
export function isUC7KSExcludedPath(filePath: string): boolean {
  if (!filePath) return false;

  var root = process.env.OPENCODE_ROOT || ".";
  var resolved = filePath;
  if (!filePath.startsWith("/")) {
    resolved = path.resolve(root, filePath);
  }
  var rel = resolved;
  if (resolved.startsWith(root)) {
    rel = resolved.substring(root.length).replace(/^\//, "");
  }

  // Logs
  if (rel.startsWith(".task_temp/_logs/") || rel.startsWith("task_temp/_logs/"))
    return true;

  // Temp artifacts
  if (rel.startsWith(".task_temp/") || rel.startsWith("task_temp/"))
    return true;

  // Node modules
  if (rel.startsWith("node_modules/") || rel.includes("/node_modules/"))
    return true;

  // Knowledge cache (managed by @Knowledge-Curator, UC7-008)
  if (rel.startsWith("docs/official_docs/")) return true;

  return false;
}
