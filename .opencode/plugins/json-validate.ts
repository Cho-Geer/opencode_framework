// json-validate.ts — "tool.execute.before" plugin: critical JSON file validation
//
// SA-IMPL-LEGACY-FIXES (2026-06-11): Validates project.config.json and
// opencode.json before writes. Uses tolerantParse() from lib/tolerant-json
// to detect trailing commas introduced by safe_edit operations that use
// JS-style formatting.
//
// Follows the identical 15-plugin pattern:
//   ensureLogDir() → writeLog(loaded) → updateIndex(PLUGIN-LOADED)
//   → export default → tool.execute.before handler
//
// WHY: safe_edit can introduce trailing commas (valid JS but invalid JSON).
// This plugin catches them BEFORE they are written, preventing framework
// breakage from unparseable config files.
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent } from "../lib/agent-resolver";
import { getModifyPath } from "../lib/tool-scope";
import { tolerantParse } from "../lib/tolerant-json";

// ── Constants ──

/** Critical JSON files that must pass strict validation before writes */
const CRITICAL_JSON_FILES = [
  ".opencode/project.config.json",
  "opencode.json",
];

// ── Plugin boilerplate ──
ensureLogDir();
writeLog("json-validate", "loaded", { event: "PLUGIN-LOADED", detail: "json-validate.ts" });
updateIndex("json-validate", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("json-validate", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.before" });
  return { "tool.execute.before": toolExecuteBefore };
}) as any;

// ── Hook handler ──
async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);

  writeLog("json-validate", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "TOOL-BEFORE",
    detail: `enter | tool=${input.tool}`,
  });

  // Only check content-writing tools
  if (input.tool !== "write" && input.tool !== "edit" && input.tool !== "safe_edit") {
    writeLog("json-validate", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: `exit (skip) non-content tool: ${input.tool}`,
    });
    return;
  }

  // Check if target is a critical JSON file
  const fp = getModifyPath(output.args || {});
  const normalized = (fp || "").replace(/\\/g, "/");
  const isCritical = CRITICAL_JSON_FILES.some(function (f) {
    return normalized.endsWith(f) || normalized === f.replace("./", "");
  });
  if (!isCritical) {
    writeLog("json-validate", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: `exit (skip) not critical: ${fp || "(none)"}`,
    });
    return;
  }

  // Validate the proposed new content
  const newContent = output.args?.content || output.args?.newString || "";
  if (!newContent) {
    // Partial edit (oldString/newString patch mode) — validated by safe_edit itself
    writeLog("json-validate", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: `exit (skip) partial edit, safe_edit validates: ${fp}`,
    });
    return;
  }

  try {
    tolerantParse(newContent);
    writeLog("json-validate", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: "TOOL-BEFORE",
      detail: `exit (pass) valid JSON: ${fp}`,
    });
  } catch (e: any) {
    writeLog("json-validate", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      level: "ERROR",
      event: "TOOL-BEFORE",
      detail: `BLOCKED | ${fp} | ${e.message}`,
    });
    throw new Error(
      `[FW-ENFORCE][JSON] Invalid JSON in ${fp}: ${e.message}. ` +
      `Fix trailing commas or syntax errors before writing.`,
    );
  }
}
