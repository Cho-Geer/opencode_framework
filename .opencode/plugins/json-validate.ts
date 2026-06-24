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
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { getModifyPath } from "../lib/tool-scope";
import { tolerantParse } from "../lib/tolerant-json";
import { readFileSync } from "fs";

// ── Constants ──

/** Critical JSON files that must pass strict validation before writes */
const CRITICAL_JSON_FILES = [
  ".opencode/project.config.json",
  "opencode.json",
];

/** Enforcement modes ordered from weakest to strongest */
const MODE_RANK: Record<string, number> = { advisory: 1, strict: 2, locked: 3 };

/** Keys in project.config.json.template_resolution that control enforcement */
const MODE_KEYS = ["develop_enforcement_mode", "runtime_enforcement_mode"];

// ── Plugin lifecycle ──
export default withPluginLifecycle("json-validate", { "tool.execute.before": toolExecuteBefore });

// ── Hook handler ──
async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);

  writeLog("json-validate", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent,
    event: "TOOL-BEFORE",
    detail: `enter | tool=${input.tool}`,
  });

  // Only check content-writing tools
  if (input.tool !== "write" && input.tool !== "edit" && input.tool !== "safe_edit") {
    writeLog("json-validate", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent,
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
      sessionID: input.sessionID, callID: input.callID, agent,
      event: "TOOL-BEFORE",
      detail: `exit (skip) not critical: ${fp || "(none)"}`,
    });
    return;
  }

  // Validate the proposed new content.
  // Overwrite mode (has `content`) → validate full content as JSON.
  // Patch mode (has `oldString`/`newString` but no `content`) →
  //   SKIP: newString is a file fragment, not valid JSON.
  //   safe_edit performs its own atomicity validation.
  //   (SA-JSON-VALIDATE-FIX-20250612: previous guard used || newString which
  //    was always truthy in patch mode, causing tolerantParse() to fail.)
  const isOverwrite = output.args?.content !== undefined;
  if (!isOverwrite) {
    writeLog("json-validate", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent,
      event: "TOOL-BEFORE",
      detail: `exit (skip) patch mode, safe_edit validates: ${fp}`,
    });
    return;
  }

  try {
    tolerantParse(output.args!.content);
    writeLog("json-validate", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent,
      event: "TOOL-BEFORE",
      detail: `exit (pass) valid JSON: ${fp}`,
    });

    // ── P1-5: Enforcement Mode Change Protection ──
    // Migrated from priority.md P1-5 (W4)
    //
    // project.config.json controls advisory/strict/locked enforcement modes.
    // Downgrading from strict or locked must require explicit governance
    // action (state-machine-reset.sh or @Arbiter-signed unlock). Upgrades
    // (advisory→strict, strict→locked) are allowed because they tighten
    // enforcement.
    if (normalized.endsWith(".opencode/project.config.json")) {
      const modeDowngrade = detectModeDowngrade(output.args!.content, fp);
      if (modeDowngrade) {
        writeLog("json-validate", "runtime", {
          sessionID: input.sessionID, callID: input.callID, agent,
          level: "ERROR",
          event: "TOOL-BEFORE",
          detail: `BLOCKED | ${fp} | ${modeDowngrade}`,
        });
        throw new Error(
          `[FW-ENFORCE][ENFORCEMENT-MODE] ${modeDowngrade}. ` +
          `Use state-machine-reset.sh --force for strict→advisory, ` +
          `or @Arbiter-signed unlock for locked changes.`,
        );
      }
    }
  } catch (e: any) {
    writeLog("json-validate", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent,
      level: "ERROR",
      event: "TOOL-BEFORE",
      detail: `BLOCKED | ${fp} | ${e.message}`,
    });
    // Preserve enforcement-mode errors without re-wrapping as JSON errors.
    if (e.message?.startsWith("[FW-ENFORCE][ENFORCEMENT-MODE]")) throw e;
    throw new Error(
      `[FW-ENFORCE][JSON] Invalid JSON in ${fp}: ${e.message}. ` +
      `Fix trailing commas or syntax errors before writing.`,
    );
  }
}

// ── Enforcement mode helpers ──

/**
 * Detects unauthorized enforcement-mode downgrades in a proposed
 * project.config.json content string.
 *
 * Missing keys are treated as "advisory" (the framework default).
 * Only downgrades FROM strict or locked are blocked; upgrades are allowed.
 *
 * @returns A descriptive error string if a blocked downgrade is detected,
 *          otherwise `null`.
 */
function detectModeDowngrade(newContent: string, filePath: string): string | null {
  let currentContent: string;
  try {
    currentContent = readFileSync(filePath, "utf8");
  } catch {
    // File does not exist yet; nothing to downgrade from.
    return null;
  }

  let current: any;
  let next: any;
  try {
    current = tolerantParse(currentContent);
    next = tolerantParse(newContent);
  } catch {
    // If current or proposed content fails to parse, the JSON syntax check
    // will report the proposed content error. Skip the mode comparison.
    return null;
  }

  for (const key of MODE_KEYS) {
    const from = current?.template_resolution?.[key] || "advisory";
    const to = next?.template_resolution?.[key] || "advisory";
    if (from === to) continue;
    if (MODE_RANK[to] < MODE_RANK[from] && (from === "strict" || from === "locked")) {
      return `${key} downgrade: ${from} → ${to}`;
    }
  }
  return null;
}
