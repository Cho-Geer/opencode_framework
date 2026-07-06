// plugin-handlers/before/codegraph.ts — CodeGraph impact analysis enforcement
// Migrated from plugins/codegraph-enforce.ts (tool.execute.before portion)
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { isCodeGraphExemptAgent, getCodeGraphExemptPatterns } from "../../service/enforcement/exemptions";
import { shouldBlock } from "../../service/enforcement/rule-disposition";
import { readImpactState } from "../../service/file-guard/codegraph-state";

export const name = "codegraph";
export const tools = ["safe_edit", "safe_delete", "safe_restore", "safe_shell", "bash"];

const INTERCEPTED_TOOLS = new Set(["safe_edit", "safe_delete", "safe_restore", "safe_shell", "bash"]);

function toRelative(filePath: string): string {
  const root = process.env.OPENCODE_ROOT || process.cwd();
  const normalizedRoot = root.endsWith("/") ? root.slice(0, -1) : root;
  if (filePath.startsWith(normalizedRoot + "/")) {
    return filePath.slice(normalizedRoot.length + 1);
  }
  // Fix: try realpath resolution for symlink mismatches
  try {
    const real = require('fs').realpathSync(filePath);
    if (real.startsWith(normalizedRoot + '/')) {
      return real.slice(normalizedRoot.length + 1);
    }
  } catch {}
  // Fix: extract path after project root name as fallback
  const rootName = normalizedRoot.split('/').pop();
  if (rootName && filePath.includes('/' + rootName + '/')) {
    const idx = filePath.indexOf('/' + rootName + '/');
    return filePath.slice(idx + rootName.length + 2);
  }
  return filePath;
}

function isExemptPath(filePath: string): boolean {
  if (!filePath) return false;
  const relPath = toRelative(filePath);
  // Fix: if relPath is still absolute, also check with includes() for exempt segments
  const checkAbsolute = relPath.startsWith('/');
  // Config-driven: reads from enforcement_exemptions.codegraph.exempt_path_patterns
  const patterns = getCodeGraphExemptPatterns();
  if (patterns.length > 0) return patterns.some((re) => re.test(relPath) || (checkAbsolute && re.test(relPath.replace(/^.*\/(?=\.task_temp|docs|\.opencode|\.understand-anything|\.codegraph)/, ''))));
  // Fallback to hardcoded defaults
  const exempt = [
    /^\.task_temp\//, /^docs\//, /^\.opencode\/agents\/.*\.md$/,
    /^\.understand-anything\//, /^\.codegraph\//,
  ];
  return exempt.some((re) => {
    if (re.test(relPath)) return true;
    // Fix: for absolute paths, extract the relevant segment and re-test
    if (checkAbsolute) {
      const segment = relPath.replace(/^.*\/(?=\.task_temp|docs|\.opencode|\.understand-anything|\.codegraph)/, '');
      if (segment !== relPath && re.test(segment)) return true;
    }
    return false;
  });
}

function extractFilePath(tool: string, args: any): string {
  if (!args) return "";
  switch (tool) {
    case "safe_edit":
      return (args.filePath || args.file_path || args.path || "").toString();
    case "safe_delete":
    case "safe_restore":
      return (args.filePath || args.file_path || args.path || args.target || "").toString();
    case "safe_shell":
      return extractShellTarget(args.command || "").toString();
    default:
      return "";
  }
}

function extractShellTarget(command: string): string {
  if (!command) return "";
  const patterns = [
    /(?:cp|mv)\s+\S+\s+(\S+)/,
    /(?:sed|cat|tee)\s+.*?(\S+\.(?:ts|js|tsx|jsx|mjs|cjs|vue|svelte|astro|md|json|yaml|yml))/,
    /(?:node|bun|npx)\s+(\S+\.(?:ts|js|tsx|jsx|mjs|cjs|md))/,
    /(?:chmod|chown)\s+\S+\s+(\S+)/,
  ];
  for (const re of patterns) {
    const m = command.match(re);
    if (m?.[1]) return m[1];
  }
  return command.length > 120 ? command.slice(0, 120) + "..." : command;
}

export async function handle(input: any, output: any): Promise<void> {
  const tool = input.tool;
  if (!INTERCEPTED_TOOLS.has(tool)) return;

  const sessionId = input.sessionID || "unknown";
  const agent = resolveAgent(sessionId);

  // Config-driven: reads from enforcement_exemptions.codegraph.exempt_agents
  if (isCodeGraphExemptAgent(agent)) return;
  if (!shouldBlock("source-edit-without-codegraph")) return;

  const filePath = extractFilePath(tool, input.args || output.args || {});
  if (isExemptPath(filePath)) return;

  const state = readImpactState();
  const sessionRecord = state.sessions[sessionId];

  if (sessionRecord?.impact_called) {
    writeLog("plugin-codegraph-enforce", "INFO", {
      event: "CODEGRAPH-ENFORCE-PASS", agent, sessionId, tool,
      detail: `codegraph_explore was called in this session — ${tool} allowed`,
    });
    return;
  }

  writeLog("plugin-codegraph-enforce", "WARN", {
    event: "CODEGRAPH-ENFORCE-BLOCK", agent, sessionId, tool, filePath,
    detail: `${tool} blocked: codegraph_explore not called in this session`,
  });

  throw new Error(
    `[CODEGRAPH-ENFORCE] ${tool} blocked: you must call codegraph_explore before modifying code.\n` +
    "Agent: " + agent + "\nTool: " + tool + "\nTarget: " + filePath + "\n\n" +
    "Required steps:\n" +
    "  1. codegraph_query(\"<target_symbol>\") — locate the symbol\n" +
    "  2. codegraph_explore(\"<target_symbol>\") — assess change impact\n" +
    "  3. Review affected files\n" +
    "  4. Then retry " + tool + "\n\n" +
    "Exemptions: .task_temp/**, docs/**, .opencode/agents/*.md, @Super-Admin" +
    "\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path."
  );
}
