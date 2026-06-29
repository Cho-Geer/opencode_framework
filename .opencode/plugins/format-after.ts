// format-after.ts — Auto-format on write (tool.execute.after)
/** Phase 1 of code-quality-cleanup-plan.md (SA-IMPLEMENT-CODE-QUALITY-CLEANUP) */
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { isModifyTool, getModifyPath } from "../lib/tool-scope";

export default withPluginLifecycle("format-after", { "tool.execute.after": formatAfterHook });

async function formatAfterHook(input: any, output: any): Promise<void> {
  if (!isModifyTool(input.tool)) return;
  const filePath = getModifyPath(input.args);
  if (!filePath) return;
  const ext = filePath.split(".").pop()?.toLowerCase();
  const formattableExts = ["ts","tsx","js","jsx","json","md","html","css","scss","yaml","yml"];
  if (!ext || !formattableExts.includes(ext)) return;
  try {
    const { runPrettierCheck } = require("../scripts/mcp-tools/code-quality-lib");
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
