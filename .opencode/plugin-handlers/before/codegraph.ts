// plugin-handlers/before/codegraph.ts — CodeGraph impact analysis enforcement
// Migrated from plugins/codegraph-enforce.ts (tool.execute.before portion)
import * as fs from "node:fs";
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { isCodeGraphExemptAgent, getCodeGraphExemptPatterns } from "../../service/enforcement/exemptions";
import { shouldBlock } from "../../service/enforcement/rule-disposition";
import { readImpactState } from "../../service/file-guard/codegraph-state";
import { extractShellEvidenceTarget } from "../../service/tool-governance/shell-targets";
// repo-op / GitHub MCP write adjudication moved to service/tool-governance
// (tool-governance-handler → repo-policy). codegraph is now a pure evidence adapter.

export const name = "codegraph";
export const tools = [
  "safe_edit",
  "safe_delete",
  "safe_restore",
  "safe_shell",
  "bash",
  "safe_framework_edit",
];

const INTERCEPTED_TOOLS = new Set([
  "safe_edit",
  "safe_delete",
  "safe_restore",
  "safe_shell",
  "bash",
  "safe_framework_edit",
]);

/**
 * Keep the active hook fail-closed for direct GitHub MCP writes while still
 * allowing read-only MCP investigation tools.
 */
function isInterceptedTool(tool: string): boolean {
  return INTERCEPTED_TOOLS.has(tool);
}

function toRelative(filePath: string): string {
  const root = process.env.OPENCODE_ROOT || process.cwd();
  const normalizedRoot = root.endsWith("/") ? root.slice(0, -1) : root;
  if (filePath.startsWith(normalizedRoot + "/")) {
    return filePath.slice(normalizedRoot.length + 1);
  }
  // Fix: try realpath resolution for symlink mismatches
  try {
    const real = fs.realpathSync(filePath);
    if (real.startsWith(normalizedRoot + "/")) {
      return real.slice(normalizedRoot.length + 1);
    }
  } catch {
    // The target may not exist yet or may be shell-derived; fall through to string heuristics.
  }
  // Fix: extract path after project root name as fallback
  const rootName = normalizedRoot.split("/").pop();
  if (rootName && filePath.includes("/" + rootName + "/")) {
    const idx = filePath.indexOf("/" + rootName + "/");
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
    // Phase 8: 非源码配置文件豁免 --codegraph 只校验源码文件
    /^\.gitignore$/, /^\.gitattributes$/,
    /^\.env\.example$/, /^\.env\.template$/,
    /^package\.json$/, /^package-lock\.json$/, /^bun\.lock$/, /^bun\.lockb$/,
    /^README\.md$/, /^LICENSE$/, /^CHANGELOG\.md$/,
    /^tsconfig\.json$/, /^\.editorconfig$/,
    /^\.opencode\/project\.config\.json$/,
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
    case "safe_framework_edit":
      return (args.filePath || args.file_path || args.path || "").toString();
    case "safe_delete":
    case "safe_restore":
      return (args.filePath || args.file_path || args.path || args.target || "").toString();
    case "safe_shell":
    case "bash":
      return extractShellEvidenceTarget((args.command || "").toString());
    default:
      return "";
  }
}

export async function handle(input: any, output: any): Promise<void> {
  const tool = input.tool;
  writeLog("plugin-codegraph-enforce", "INFO", {
    event: "CODEGRAPH-HANDLE",
    tool: input.tool,
    sessionId: input.sessionID || "unknown",
  });
  writeLog("plugin-codegraph-enforce", "INFO", {
    event: "CODEGRAPH-HANDLER-ENTER",
    tool: tool,
    sessionId: input.sessionID || "unknown",
    detail: `codegraph handler entered for tool=${tool}`,
  });
  if (!isInterceptedTool(tool)) return;

  const sessionId = input.sessionID || "unknown";
  const agent = resolveAgent(sessionId);

  writeLog("plugin-codegraph-enforce", "INFO", {
    event: "CODEGRAPH-AGENT-RESOLVED",
    agent, sessionId, tool,
    detail: `resolved agent=${agent} for session=${sessionId}`,
  });

  writeLog("plugin-codegraph-enforce", "INFO", {
    event: "CODEGRAPH-CHECK", agent, sessionId, tool,
    detail: `codegraph intercept for ${tool}`,
  });

  // Repo-op / GitHub MCP write adjudication moved to service/tool-governance
  // (tool-governance-handler → repo-policy). codegraph is now a pure evidence adapter.

  // Config-driven: reads from enforcement_exemptions.codegraph.exempt_agents
  if (isCodeGraphExemptAgent(agent)) return;
  if (!shouldBlock("source-edit-without-codegraph")) return;

  const filePath = extractFilePath(tool, input.args || output.args || {});
  if ((tool === "safe_shell" || tool === "bash") && !filePath) {
    return;
  }
  writeLog("plugin-codegraph-enforce", "INFO", {
    event: "CODEGRAPH-EXEMPT-PATH", agent, sessionId, tool, filePath,
    detail: `codegraph exempt path check for ${filePath}`,
  });
  if (isExemptPath(filePath)) return;

  writeLog("plugin-codegraph-enforce", "INFO", {
    event: "CODEGRAPH-ENFORCE-CHECK", agent, sessionId, tool, filePath,
    detail: `proceeding to impact state check for non-exempt path`,
  });

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
    "Exemptions: configured path exemptions only. Repo writes require safe_repo_* grant." +
    "\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path."
  );
}
