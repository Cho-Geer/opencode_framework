// scope-after.ts — "tool.execute.after" plugin: post-write state tracking
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { isModifyTool, getModifyPath } from "../lib/tool-scope";
import { isSourceFile, atomicWriteSubState } from "../lib/state-utils";

export default withPluginLifecycle("scope-after", { "tool.execute.after": toolExecuteAfter });

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

  // Update eslint-state.json dirty_modules (P1-B split)
  try {
    atomicWriteSubState("eslint_state", (state) => {
      state.aggregate = state.aggregate || { dirty_modules: [] };
      state.aggregate.dirty_modules = state.aggregate.dirty_modules || [];
      if (!state.aggregate.dirty_modules.includes(filePath)) {
        state.aggregate.dirty_modules.push(filePath);
      }
    });
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
