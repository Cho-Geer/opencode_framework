/**
 * codegraph-enforce.ts — "tool.execute.before" plugin: CodeGraph impact analysis enforcement
 * ===========================================================================================
 *
 * Hard enforcement: blocks code-modifying tool calls unless codegraph_impact was
 * called in the same session first. Ensures agents always assess change impact
 * before modifying code.
 *
 * Intercepted tools:
 *   - safe_edit    (file edit / overwrite)
 *   - safe_delete  (file deletion)
 *   - safe_restore (backup restore → file overwrite)
 *   - safe_shell   (shell commands that may modify files: cp, mv, sed, node, etc.)
 *
 * Mechanism:
 *   - tool.execute.after: records codegraph_impact calls per session
 *   - tool.execute.before: blocks intercepted tools if no prior codegraph_impact
 *
 * State tracking: .task_temp/.codegraph-impact-sessions.json
 *   { "sessions": { "<session_id>": { "impact_called": true, "at": <timestamp> } } }
 *
 * Exemptions:
 *   - @Super-Admin (framework maintenance, may need to bypass for repairs)
 *   - File paths: .task_temp/**, docs/**, .opencode/agents/*.md (non-structural)
 *   - Sessions where codegraph_status shows index unavailable
 *
 * Registry: auto-discovered from .opencode/plugins/ directory
 * Hooks: tool.execute.before, tool.execute.after
 *
 * @author @Super-Admin
 * @since 2026-06-28 — CodeGraph Phase 3 hard enforcement
 * @updated 2026-06-28 — Expanded to safe_delete/safe_restore/safe_shell
 * @updated 2026-06-29 — Batch 2: state I/O delegated to service/file-guard
 * @module codegraph-enforce
 */

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { isSuperAdmin } from "../lib/agent-identity";
import { readImpactState, writeImpactState } from "../service/file-guard/codegraph-state";

const SRC = "plugin-codegraph-enforce";

/** Tools that modify code files and require prior codegraph_impact analysis */
const INTERCEPTED_TOOLS = new Set([
  "safe_edit",
  "safe_delete",
  "safe_restore",
  "safe_shell",
]);

/** Check if a file path is exempt from CodeGraph enforcement */
function isExemptPath(filePath: string): boolean {
  if (!filePath) return false;
  const exempt = [
    /^\.task_temp\//,
    /^docs\//,
    /^\.opencode\/agents\/.*\.md$/,
    /^\.understand-anything\//,
    /^\.codegraph\//,
  ];
  return exempt.some((re) => re.test(filePath));
}

/** Extract the target file path from tool arguments */
function extractFilePath(tool: string, args: any): string {
  if (!args) return "";
  switch (tool) {
    case "safe_edit":
      return (args.file_path || args.path || "").toString();
    case "safe_delete":
      return (args.file_path || args.path || args.target || "").toString();
    case "safe_restore":
      return (args.file_path || args.path || args.target || "").toString();
    case "safe_shell":
      // safe_shell uses command arg; extract file paths from command patterns
      return extractShellTarget(args.command || "").toString();
    default:
      return "";
  }
}

/** Extract file targets from a shell command string */
function extractShellTarget(command: string): string {
  if (!command) return "";
  // Match common file-modifying patterns: cp X Y, mv X Y, sed -i ... FILE, node FILE, bun FILE
  const patterns = [
    /(?:cp|mv)\s+\S+\s+(\S+)/,           // cp/mv target
    /(?:sed|cat|tee)\s+.*?(\S+\.(?:ts|js|tsx|jsx|mjs|cjs|vue|svelte|astro))/, // text tools with code file
    /(?:node|bun|npx)\s+(\S+\.(?:ts|js|tsx|jsx|mjs|cjs))/,  // script execution
    /(?:chmod|chown)\s+\S+\s+(\S+)/,      // permission changes
  ];
  for (const re of patterns) {
    const m = command.match(re);
    if (m?.[1]) return m[1];
  }
  // Fallback: return the full command for logging (conservative — will not be exempt)
  return command.length > 120 ? command.slice(0, 120) + "..." : command;
}

export default withPluginLifecycle("codegraph-enforce", {
  "tool.execute.before": toolExecuteBefore,
  "tool.execute.after": toolExecuteAfter,
});

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const tool = input.tool;
  if (!INTERCEPTED_TOOLS.has(tool)) return;

  const sessionId = input.sessionID || "unknown";
  const agent = resolveAgent(sessionId);

  // Exempt: @Super-Admin (framework maintenance)
  if (isSuperAdmin(agent)) return;

  // Exempt: file path is non-code
  const filePath = extractFilePath(tool, output.args);
  if (isExemptPath(filePath)) return;

  // Check if codegraph_impact was called in this session
  const state = readImpactState();
  const sessionRecord = state.sessions[sessionId];

  if (sessionRecord?.impact_called) {
    // Impact was called — allow
    writeLog(SRC, "INFO", {
      event: "CODEGRAPH-ENFORCE-PASS",
      agent,
      sessionId,
      tool,
      detail: `codegraph_impact was called in this session — ${tool} allowed`,
    });
    return;
  }

  // Block: codegraph_impact not called
  writeLog(SRC, "WARN", {
    event: "CODEGRAPH-ENFORCE-BLOCK",
    agent,
    sessionId,
    tool,
    filePath,
    detail: `${tool} blocked: codegraph_impact not called in this session`,
  });

  throw new Error(
    `[CODEGRAPH-ENFORCE] ${tool} blocked: you must call codegraph_impact before modifying code.\n` +
    "Agent: " + agent + "\n" +
    "Tool: " + tool + "\n" +
    "Target: " + filePath + "\n\n" +
    "Required steps:\n" +
    "  1. codegraph_search(\"<target_symbol>\") — locate the symbol\n" +
    "  2. codegraph_impact(\"<target_symbol>\") — assess change impact\n" +
    "  3. Review affected files\n" +
    "  4. Then retry " + tool + "\n\n" +
    "Exemptions: .task_temp/**, docs/**, .opencode/agents/*.md, @Super-Admin"
  );
}

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  // Track codegraph_impact calls
  if (input.tool !== "codegraph_impact") return;

  const sessionId = input.sessionID || "unknown";
  const agent = resolveAgent(sessionId);
  const symbol = (output.args?.symbol || "unknown").toString();

  const state = readImpactState();
  if (!state.sessions[sessionId]) {
    state.sessions[sessionId] = { impact_called: false, at: 0 };
  }
  state.sessions[sessionId].impact_called = true;
  state.sessions[sessionId].at = Date.now();
  if (!state.sessions[sessionId].targets) {
    state.sessions[sessionId].targets = [];
  }
  state.sessions[sessionId].targets!.push(symbol);
  writeImpactState(state);

  writeLog(SRC, "INFO", {
    event: "CODEGRAPH-IMPACT-TRACKED",
    agent,
    sessionId,
    symbol,
    detail: "codegraph_impact recorded for session — all code-modifying tools now allowed",
  });
}
