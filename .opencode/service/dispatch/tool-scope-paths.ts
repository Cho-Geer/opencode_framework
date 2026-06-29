/**
 * Tool Scope — Path Resolution (tool-scope-paths)
 *
 * Shell write target parsing, effective path scope resolution,
 * dispatch tool allowlist management, and tool permission checking.
 *
 * Split from lib/tool-scope.ts for modularity.
 * Cross-imports matching functions from ./tool-scope-match.
 *
 * @module tool-scope-paths
 */

import * as fs from "node:fs";
import { STATE_PATHS } from "../../lib/state-utils";
import { normalize, toDisplayName } from "../../lib/agent-identity";
import {
  isModifyTool,
  getModifyPath,
  isModifyShell,
  splitShellCommand,
} from "./tool-scope-match";

// ============================================================================
// PHASE 2 (2026-06-18): Multi-path scope + UC7KS write targets
// ============================================================================

/**
 * Result of parsing a shell command for write target paths.
 */
export type ScopePathResult =
  | { applies: false; paths: []; reason: "read_only_shell" }
  | { applies: true; paths: string[]; reason: "parsed" }
  | { applies: true; paths: []; reason: "unparseable_modify_shell" };

/**
 * Parse write target paths from a safe_shell command.
 * Returns multiple target paths for commands that write to multiple files.
 *
 * Supported patterns:
 *   sed -i 's/x/y/' file.ts           -> [file.ts]
 *   sed -i.bak 's/x/y/' file.ts       -> [file.ts]
 *   cp src dst                         -> [dst]
 *   mv src dst                         -> [src, dst]
 *   tee file.ts                        -> [file.ts]
 *   dd if=a of=file.ts                 -> [file.ts]
 *   node script.ts                     -> read_only (script not a write target)
 *   node -e / bun -e (inline write)    -> unparseable_modify_shell
 *   echo "x" >> file / heredoc         -> unparseable_modify_shell
 *   sh -c "..."                        -> unparseable_modify_shell
 */
export function parseShellWriteTargets(command: string): ScopePathResult {
  if (!command || typeof command !== "string") {
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  // FW-FIX-I2: iterate ALL sub-commands, aggregate targets
  const subCmds = splitShellCommand(command);
  const allPaths: string[] = [];
  let anyUnparseable = false;
  for (const subCmd of subCmds) {
    const subResult = parseSingleCommand(subCmd);
    if (subResult.reason === "unparseable_modify_shell") anyUnparseable = true;
    if (subResult.applies) {
      for (const p of subResult.paths) allPaths.push(p);
    }
  }
  if (anyUnparseable)
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  if (allPaths.length === 0)
    return { applies: false, paths: [], reason: "read_only_shell" };
  return { applies: true, paths: allPaths, reason: "parsed" };
}

/** parseSingleCommand — the original per-command parser, extracted for sub-command iteration */
function parseSingleCommand(command: string): ScopePathResult {
  const trimmed = command.trim();
  const cmdMatch = trimmed.match(/^(\S+)/);
  if (!cmdMatch)
    return { applies: false, paths: [], reason: "read_only_shell" };
  const cmd = cmdMatch[1];

  // Non-modify commands
  // FW-EXPLORE-WRITE-BLOCK (2026-06-25): Added mkdir to modify commands.
  // echo is handled separately via redirection detection below.
  if (
    !/^(cp|mv|rm|python3|node|bun|npx|tee|cat|sed|dd|sh|bash|touch|mkdir)$/.test(
      cmd,
    )
  ) {
    // FW-EXPLORE-WRITE-BLOCK: echo with redirection (> >>) is a write operation.
    // splitShellCommand splits on >, so echo redirect reaches here as just "echo".
    // Check if the ORIGINAL command (before split) had redirection — if so, treat
    // as unparseable_modify_shell (we can't extract the target path after split).
    if (cmd === "echo") {
      return { applies: true, paths: [], reason: "unparseable_modify_shell" };
    }
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  var paths: string[] = [];

  // sed -i 's/x/y/' file.ts  or  sed -i.bak 's/x/y/' file.ts
  if (cmd === "sed") {
    // Extract the file path: sed [-i[.ext]] ['s/pattern/repl/'] file
    // Match the last non-option, non-script argument as file path
    var sedParts = trimmed.split(/\s+/).filter(function (p) {
      return p.length > 0;
    });
    // Filter out: 'sed', -i*, quoted regex patterns, flags
    var sedFiles: string[] = [];
    for (var si = 1; si < sedParts.length; si++) {
      var sp = sedParts[si];
      if (sp === "sed") continue;
      if (sp.startsWith("-i")) continue; // -i or -i.bak
      if (sp.startsWith("'") || sp.startsWith('"')) continue; // quoted pattern
      if (/^[a-zA-Z0-9_./-]+\.[a-zA-Z]+$/.test(sp)) sedFiles.push(sp);
    }
    if (sedFiles.length === 0) {
      return { applies: true, paths: [], reason: "unparseable_modify_shell" };
    }
    return { applies: true, paths: sedFiles, reason: "parsed" };
  }

  // cp src dst -> [dst]
  if (cmd === "cp") {
    var cpParts = trimmed.split(/\s+/).filter(Boolean);
    if (cpParts.length >= 3) {
      var dst = cpParts[cpParts.length - 1];
      if (!dst.startsWith("-") && dst !== "cp") paths.push(dst);
    }
    return { applies: true, paths: paths, reason: "parsed" };
  }

  // mv src dst -> [src, dst]
  if (cmd === "mv") {
    var mvParts = trimmed.split(/\s+/).filter(Boolean);
    if (mvParts.length >= 3) {
      var mvSrc = mvParts[1];
      var mvDst = mvParts[mvParts.length - 1];
      if (!mvSrc.startsWith("-")) paths.push(mvSrc);
      if (!mvDst.startsWith("-") && mvDst !== mvSrc) paths.push(mvDst);
    }
    return { applies: true, paths: paths, reason: "parsed" };
  }

  // rm file -> [file]
  if (cmd === "rm") {
    var rmParts = trimmed.split(/\s+/).filter(Boolean);
    if (rmParts.length >= 2) {
      for (var ri = 1; ri < rmParts.length; ri++) {
        if (!rmParts[ri].startsWith("-") && rmParts[ri] !== "rm") {
          paths.push(rmParts[ri]);
        }
      }
    }
    return { applies: true, paths: paths, reason: "parsed" };
  }

  // tee file.ts -> [file.ts]
  if (cmd === "tee") {
    var teeParts = trimmed.split(/\s+/).filter(Boolean);
    for (var ti = 1; ti < teeParts.length; ti++) {
      var tp = teeParts[ti];
      if (tp !== "tee" && !tp.startsWith("-") && !/^[<>|&]|^\d+>/.test(tp)) {
        paths.push(tp);
      }
    }
    return { applies: true, paths: paths, reason: "parsed" };
  }

  // touch file -> [file]
  if (cmd === "touch") {
    var touchParts = trimmed.split(/\s+/).filter(Boolean);
    for (var tchi = 1; tchi < touchParts.length; tchi++) {
      if (!touchParts[tchi].startsWith("-") && touchParts[tchi] !== "touch") {
        paths.push(touchParts[tchi]);
      }
    }
    return { applies: true, paths: paths, reason: "parsed" };
  }

  // mkdir -p dir -> [dir]
  // FW-EXPLORE-WRITE-BLOCK (2026-06-25): mkdir creates directories — treat as modify.
  if (cmd === "mkdir") {
    var mkdirParts = trimmed.split(/\s+/).filter(Boolean);
    for (var mi = 1; mi < mkdirParts.length; mi++) {
      if (!mkdirParts[mi].startsWith("-") && mkdirParts[mi] !== "mkdir") {
        paths.push(mkdirParts[mi]);
      }
    }
    return { applies: true, paths: paths, reason: "parsed" };
  }

  // mkdir -p dir -> [dir]
  // FW-EXPLORE-WRITE-BLOCK (2026-06-25): mkdir creates directories — treat as modify.
  if (cmd === "mkdir") {
    var mkdirParts = trimmed.split(/\s+/).filter(Boolean);
    for (var mi = 1; mi < mkdirParts.length; mi++) {
      if (!mkdirParts[mi].startsWith("-") && mkdirParts[mi] !== "mkdir") {
        paths.push(mkdirParts[mi]);
      }
    }
    return { applies: true, paths: paths, reason: "parsed" };
  }

  // mkdir [-p] dir -> [dir]
  // FW-EXPLORE-WRITE-BLOCK (2026-06-25): mkdir creates directories — treat as modify.
  if (cmd === "mkdir") {
    var mkdirParts = trimmed.split(/\s+/).filter(Boolean);
    for (var mi = 1; mi < mkdirParts.length; mi++) {
      if (!mkdirParts[mi].startsWith("-") && mkdirParts[mi] !== "mkdir") {
        paths.push(mkdirParts[mi]);
      }
    }
    return { applies: true, paths: paths, reason: "parsed" };
  }

  // dd if=a of=file.ts -> extract of= paths
  if (cmd === "dd") {
    var ddMatch = trimmed.match(/of=(\S+)/);
    if (ddMatch) {
      paths.push(ddMatch[1]);
      return { applies: true, paths: paths, reason: "parsed" };
    }
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }

  // cat file > dst or cat file >> dst -> unparseable_modify_shell
  // cat alone is read-only
  if (cmd === "cat") {
    if (trimmed.includes(">")) {
      return { applies: true, paths: [], reason: "unparseable_modify_shell" };
    }
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  // FW-FIX-I3 (P0-6): Heredoc (<<), stdin redirect (<), and dash-from-stdin (-)
  // are all opaque input forms that can carry arbitrary writes.
  const stdinOrHeredocRe =
    /(<<\s*['"]?\w+['"]?|<<\s*\\?\w+|\s<\s+\S+|\s-\s*$|\s-\s)/;
  if (stdinOrHeredocRe.test(trimmed)) {
    if (
      cmd === "node" ||
      cmd === "bun" ||
      cmd === "python3" ||
      cmd === "sh" ||
      cmd === "bash"
    ) {
      return { applies: true, paths: [], reason: "unparseable_modify_shell" };
    }
  }

  // node -e / bun -e (inline eval, might write) -> unparseable
  if (
    ((cmd === "node" || cmd === "bun") && trimmed.includes(" -e ")) ||
    (cmd === "python3" && trimmed.includes(" -c "))
  ) {
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }

  // node/bun/python3/npx script execution -> unparseable_modify_shell
  // BACKUP-BYPASS-PREVENTION (2026-06-24): Script execution can perform
  // arbitrary file writes via fs.writeFileSync, bypassing safe_edit's
  // backup mechanism. Classify as unparseable to trigger scope-before
  // block in strict/locked mode. safe-bash-core.ts content scanning
  // still applies for allowed script paths.
  if (cmd === "node" || cmd === "bun" || cmd === "npx" || cmd === "python3") {
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }

  // sh -c "..." / bash -c "..." -> unparseable
  if ((cmd === "sh" || cmd === "bash") && trimmed.includes("-c")) {
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }

  // sh script.sh / bash script.sh -> read_only
  if (cmd === "sh" || cmd === "bash") {
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  return { applies: false, paths: [], reason: "read_only_shell" };
}

// ============================================================================
// Effective Path Scope Resolution
// ============================================================================

/**
 * Get all effective file paths for path-scope checks.
 * For non-shell tools, returns a single-element array [filePath] or [dirPath].
 * For safe_shell, parses the command to extract write targets.
 * Returns null if the tool is not a modify tool or targets cannot be determined.
 *
 * Phase 2 (2026-06-18): Replaces getEffectivePathScopeFilePath() for
 * multi-path shell write target support.
 */
export function getEffectivePathScopePaths(
  tool: string,
  args: Record<string, any>,
): ScopePathResult {
  // Non-modify tools
  if (!isModifyTool(tool)) {
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  // Non-shell modify tools: safe_edit, safe_mkdir, safe_delete, write, edit
  if (tool !== "safe_shell" && tool !== "bash") {
    var fp = getModifyPath(args);
    if (!fp) return { applies: false, paths: [], reason: "read_only_shell" };
    return { applies: true, paths: [fp], reason: "parsed" };
  }

  // safe_shell / bash: parse command for write targets
  var cmd = (args?.command || "") as string;
  if (!cmd) return { applies: false, paths: [], reason: "read_only_shell" };

  // Check if it's a modify shell command at all
  if (!isModifyShell(args)) {
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  return parseShellWriteTargets(cmd);
}

// ============================================================================
// Dispatch Tool Allowlist Management
// ============================================================================

export function readDispatchAllowedTools(agent: string): string[] | "*" {
  // V6.2 FIX (2026-06-23, @Super-Admin): Expanded FALLBACK from 7 to 20 tools.
  // The old FALLBACK only had 7 tools: task, read, todowrite, 3 gate tools, dispatch_subagent.
  // This caused agents without explicit agent_dispatch_allowed_tools config to be unable
  // to use safe_edit, safe_shell, knowledge tools, glob/grep, question, write, etc.
  // New FALLBACK covers all commonly needed agent operations.
  const FALLBACK = [
    "task",
    "read",
    "todowrite",
    "write",
    "edit",
    "compliance_gate_check",
    "compliance_gate_confirm",
    "compliance_gate_complete",
    "compliance_gate_submit_deliverables",
    "compliance_gate_approve_deliverables",
    "dispatch_subagent",
    "safe_edit",
    "safe_shell",
    "safe_delete",
    "safe_mkdir",
    "safe_diff",
    "safe_restore",
    "knowledge_cache_search",
    "knowledge_cache_attest",
    "module_scope_declare",
    "config_read_attest",
    "question",
    "glob",
    "grep",
  ];
  try {
    let cfg: any = null;
    try {
      cfg = JSON.parse(fs.readFileSync(STATE_PATHS.projectConfig(), "utf8"));
    } catch {}
    // OPT-08 (2026-06-23): FALLBACK dynamic — override from project.config.json.dispatch_policy.fallback_tools
    const configFallback = cfg?.dispatch_policy?.fallback_tools;
    const effectiveFallback =
      Array.isArray(configFallback) && configFallback.length > 0
        ? configFallback
        : FALLBACK;
    const tools = cfg?.agent_dispatch_allowed_tools;
    if (!tools || typeof tools !== "object") return effectiveFallback;
    const displayName = toDisplayName(agent);
    const atForm = "@" + displayName;
    const plainForm = displayName;
    const entry =
      tools[atForm] ||
      tools[plainForm] ||
      tools[normalize(agent)] ||
      tools[agent.replace(/^@/, "")];
    if (!entry) return FALLBACK;
    if (
      entry === "*" ||
      (Array.isArray(entry) && entry.length === 1 && entry[0] === "*")
    )
      return "*";
    if (Array.isArray(entry)) return entry;
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export function isToolAllowed(
  allowedList: string[] | "*",
  tool: string,
): boolean {
  if (allowedList === "*") return true;
  if (!Array.isArray(allowedList)) return false;
  if (allowedList.includes(tool)) return true;
  const shortName = tool.replace(/^[a-zA-Z0-9-]+_/, "");
  if (shortName !== tool && allowedList.includes(shortName)) return true;
  return false;
}
