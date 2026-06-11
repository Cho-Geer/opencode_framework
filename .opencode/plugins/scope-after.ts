// scope-after.ts — "tool.execute.after" plugin: post-write state tracking
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { isModifyTool, getModifyPath } from "../lib/tool-scope";
import { isSourceFile, STATE_PATHS } from "../lib/state-utils";
import * as fs from "node:fs";

ensureLogDir();
writeLog("scope-after", "loaded", { event: "PLUGIN-LOADED", detail: "scope-after.ts" });
updateIndex("scope-after", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("scope-after", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.after" });
  return { "tool.execute.after": toolExecuteAfter };
}) as any;

/**
 * after-hook: args live in input.args (before-hook uses output.args)
 * @see docs/official_docs/framework/mistake_precautions/double-hook-trigger-prevention.md
 */
async function toolExecuteAfter(input: any, output: any): Promise<void> {
  if (!isModifyTool(input.tool)) return;

  const filePath = getModifyPath(input.args || {});
  if (!filePath || !isSourceFile(filePath)) return;

  writeLog("scope-after", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    event: "TOOL-AFTER",
    detail: "tool=" + input.tool + " file=" + filePath,
  });

  // Update machine.json eslint_state dirty_modules
  try {
    const mp = STATE_PATHS.machine();
    if (!fs.existsSync(mp)) return;
    const raw = fs.readFileSync(mp, "utf8");
    const m = JSON.parse(raw);
    m.eslint_state = m.eslint_state || { aggregate: { dirty_modules: [] } };
    m.eslint_state.aggregate = m.eslint_state.aggregate || { dirty_modules: [] };
    if (!m.eslint_state.aggregate.dirty_modules.includes(filePath)) {
      m.eslint_state.aggregate.dirty_modules.push(filePath);
      fs.writeFileSync(mp, JSON.stringify(m, null, 2), "utf8");
    }
  } catch (err: any) {
    writeLog("scope-after", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      level: "ERROR",
      event: "TOOL-AFTER",
      detail: "state-update failed: " + err.message,
    });
  }
}
