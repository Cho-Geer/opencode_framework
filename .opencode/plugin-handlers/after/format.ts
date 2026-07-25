// ────────────────────────────────────────────────────────────────────
// DELEGATE HANDLER — NOT in execution_order but called by active handlers.
// Called by: unified-audit / quality-contract / dispatch-trace / guidance-recovery.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/format.ts — Auto-format on write
// Migrated from plugins/format-after.ts
import { writeLog } from "../../lib/log-manager";
import { isModifyTool, getModifyPath } from "../../lib/tool-scope";

export const name = "format";
export const tools = ["*"]; // isModifyTool() filters internally

export async function handle(input: any, _output: any): Promise<void> {
  if (!isModifyTool(input.tool)) return;
  const filePath = getModifyPath(input.args);
  if (!filePath) return;
  const ext = filePath.split(".").pop()?.toLowerCase();
  const formattableExts = ["ts","tsx","js","jsx","json","md","html","css","scss","yaml","yml"];
  if (!ext || !formattableExts.includes(ext)) return;
  try {
    const { runPrettierCheck } = require("../../scripts/mcp-tools/code-quality-lib");
    const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
    const result = runPrettierCheck(filePath, projectRoot, true);
    if (!result.pass) {
      writeLog("format-after","WARN",{event:"FORMAT-FAILED",filePath,detail:result.detail?.substring(0,200)});
    } else if (result.detail === "Prettier auto-fixed") {
      writeLog("format-after","INFO",{event:"FORMAT-FIXED",filePath});
    }
  } catch (err: any) {
    writeLog("format-after","ERROR",{event:"FORMAT-ERROR",filePath,detail:err.message?.substring(0,200)});
  }
}
