// FW-DIAG-FLAT: Minimal flat plugin to verify OpenCode auto-discovery.
// If this loads, the issue is with the framework-enforcer/ subdirectory loading.
// Verify: grep PLUGIN-FLAT .task_temp/_dispatch/chat_message_hook.log
import * as fs from "node:fs";
import * as path from "node:path";

export const FlatDiagPlugin = async (_ctx: any) => {
  try {
    const dp = path.join(process.env.OPENCODE_ROOT || ".", ".task_temp", "_dispatch", "chat_message_hook.log");
    const dir = path.dirname(dp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(dp, `[${new Date().toISOString()}][INFO] [PLUGIN-FLAT] flat-diag.ts loaded | pid=${process.pid} | cwd=${process.cwd()}\n`, "utf8");
  } catch (_) {}
  return {};
};
