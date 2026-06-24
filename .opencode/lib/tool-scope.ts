// tool-scope.ts — Tool scope guard utilities (lib)
// BUN-CACHE-VERSION: 2026-06-18-UC7KS-BUGFIX (BUG-002 tee redirect filter, BUG-003 touch support, BUG-006 python3 -c bypass)
import * as fs from "node:fs";
// readJsonFile removed: inline fs read for OpenCode plugin runtime compatibility
import { STATE_PATHS, isSourceFile } from "./state-utils";
import * as path from "node:path";
import { normalize, toDisplayName } from "./agent-identity";

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
    tool === "safe_shell"
  );
}

export function getModifyPath(args: Record<string, unknown>): string {
  return (args?.filePath || args?.dirPath || args?.command || "") as string;
}

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
  const subCmds = splitShellCommand(cmd);
  const modifyRe =
    /^(cp|mv|rm|python3|node|bun|npx|tee|cat|sed|dd|sh|bash|touch)\b/;
  return subCmds.some((s) => modifyRe.test(s));
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

// ════════════════════════════════════════════════════════════
// PHASE 2 NEW (2026-06-18): Multi-path scope + UC7KS write targets
// ════════════════════════════════════════════════════════════

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
 *   sed -i 's/x/y/' file.ts           → [file.ts]
 *   sed -i.bak 's/x/y/' file.ts       → [file.ts]
 *   cp src dst                         → [dst]
 *   mv src dst                         → [src, dst]
 *   tee file.ts                        → [file.ts]
 *   dd if=a of=file.ts                 → [file.ts]
 *   node script.ts                     → read_only (script not a write target)
 *   node -e / bun -e (inline write)    → unparseable_modify_shell
 *   echo "x" >> file / heredoc         → unparseable_modify_shell
 *   sh -c "..."                        → unparseable_modify_shell
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

/** parseSingleCommand — the original per-command logic, extracted for sub-command iteration */
function parseSingleCommand(command: string): ScopePathResult {
  const trimmed = command.trim();
  const cmdMatch = trimmed.match(/^(\S+)/);
  if (!cmdMatch)
    return { applies: false, paths: [], reason: "read_only_shell" };
  const cmd = cmdMatch[1];

  // Non-modify commands
  if (
    !/^(cp|mv|rm|python3|node|bun|npx|tee|cat|sed|dd|sh|bash|touch)$/.test(cmd)
  ) {
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

  // cp src dst → [dst]
  if (cmd === "cp") {
    var cpParts = trimmed.split(/\s+/).filter(Boolean);
    if (cpParts.length >= 3) {
      var dst = cpParts[cpParts.length - 1];
      if (!dst.startsWith("-") && dst !== "cp") paths.push(dst);
    }
    return { applies: true, paths: paths, reason: "parsed" };
  }

  // mv src dst → [src, dst]
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

  // rm file → [file]
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

  // tee file.ts → [file.ts]
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

  // touch file → [file]
  if (cmd === "touch") {
    var touchParts = trimmed.split(/\s+/).filter(Boolean);
    for (var tchi = 1; tchi < touchParts.length; tchi++) {
      if (!touchParts[tchi].startsWith("-") && touchParts[tchi] !== "touch") {
        paths.push(touchParts[tchi]);
      }
    }
    return { applies: true, paths: paths, reason: "parsed" };
  }

  // dd if=a of=file.ts → extract of= paths
  if (cmd === "dd") {
    var ddMatch = trimmed.match(/of=(\S+)/);
    if (ddMatch) {
      paths.push(ddMatch[1]);
      return { applies: true, paths: paths, reason: "parsed" };
    }
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }

  // cat file > dst or cat file >> dst → unparseable_modify_shell
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

  // node -e / bun -e (inline eval, might write) → unparseable
  if (
    ((cmd === "node" || cmd === "bun") && trimmed.includes(" -e ")) ||
    (cmd === "python3" && trimmed.includes(" -c "))
  ) {
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }

  // node/bun/python3/npx script execution → unparseable_modify_shell
  // BACKUP-BYPASS-PREVENTION (2026-06-24): Script execution can perform
  // arbitrary file writes via fs.writeFileSync, bypassing safe_edit's
  // backup mechanism. Classify as unparseable to trigger scope-before
  // block in strict/locked mode. safe-bash-core.ts content scanning
  // still applies for allowed script paths.
  if (cmd === "node" || cmd === "bun" || cmd === "npx" || cmd === "python3") {
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }

  // sh -c "..." / bash -c "..." → unparseable
  if ((cmd === "sh" || cmd === "bash") && trimmed.includes("-c")) {
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }

  // sh script.sh / bash script.sh → read_only
  if (cmd === "sh" || cmd === "bash") {
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  return { applies: false, paths: [], reason: "read_only_shell" };
}

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
  if (tool !== "safe_shell") {
    var fp = getModifyPath(args);
    if (!fp) return { applies: false, paths: [], reason: "read_only_shell" };
    return { applies: true, paths: [fp], reason: "parsed" };
  }

  // safe_shell: parse command for write targets
  var cmd = (args?.command || "") as string;
  if (!cmd) return { applies: false, paths: [], reason: "read_only_shell" };

  // Check if it's a modify shell command at all
  if (!isModifyShell(args)) {
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  return parseShellWriteTargets(cmd);
}

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
 *   - .opencode/logs/**
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
  if (rel.startsWith(".opencode/logs/") || rel.startsWith("logs/")) return true;

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
