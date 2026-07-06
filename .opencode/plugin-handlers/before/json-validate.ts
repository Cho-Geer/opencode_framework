// ────────────────────────────────────────────────────────────────────
// LEGACY HANDLER — NOT in active execution_order
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/before/json-validate.ts — Critical JSON file validation
// Migrated from plugins/json-validate.ts
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { getModifyPath } from "../../lib/tool-scope";
import { tolerantParse } from "../../lib/tolerant-json";

export const name = "json-validate";
export const tools = ["write", "edit", "safe_edit"];

const CRITICAL_JSON_FILES = [
  ".opencode/project.config.json",
  "opencode.json",
];

export async function handle(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);

  writeLog("json-validate", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent,
    event: "TOOL-BEFORE", detail: `enter | tool=${input.tool}`,
  });

  if (input.tool !== "write" && input.tool !== "edit" && input.tool !== "safe_edit") {
    return;
  }

  const fp = getModifyPath(output.args || {});
  const normalized = (fp || "").replace(/\\/g, "/");
  const isCritical = CRITICAL_JSON_FILES.some(function (f) {
    return normalized.endsWith(f) || normalized === f.replace("./", "");
  });
  if (!isCritical) return;

  // Overwrite mode (has content) → validate. Patch mode → skip.
  const isOverwrite = output.args?.content !== undefined;
  if (!isOverwrite) return;

  try {
    tolerantParse(output.args!.content);
    writeLog("json-validate", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent,
      event: "TOOL-BEFORE", detail: `exit (pass) valid JSON: ${fp}`,
    });
  } catch (e: any) {
    writeLog("json-validate", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent,
      level: "ERROR", event: "TOOL-BEFORE",
      detail: `BLOCKED | ${fp} | ${e.message}`,
    });
    throw new Error(
      `[FW-ENFORCE][JSON] Invalid JSON in ${fp}: ${e.message}. ` +
      `Fix trailing commas or syntax errors before writing.\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`,
    );
  }
}
