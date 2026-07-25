// service/file-guard/dirty-tracker.ts — Dirty module tracking
// Source: scope-after.ts plugin
// Tracks which source files have been modified (dirty) for ESLint re-check.

import { writeLog } from "../../lib/log-manager";
import { atomicWriteSubState, isSourceFile } from "../../lib/state-utils";
import { isModifyTool, getModifyPath } from "../../lib/tool-scope";

const SRC = "service-dirty-tracker";

/**
 * Track dirty module after file write.
 * Updates eslint_state.aggregate.dirty_modules with the modified file path.
 * Called by scope-after plugin.
 *
 * @returns true if tracking was performed, false if skipped
 */
export function trackDirtyModule(params: {
  sessionID: string;
  callID: string;
  tool: string;
  args: Record<string, unknown>;
}): boolean {
  if (!isModifyTool(params.tool)) return false;

  const filePath = getModifyPath(params.args);
  if (!filePath) return false;

  const skipSourceCheck = params.tool === "safe_delete";
  if (!skipSourceCheck && !isSourceFile(filePath)) return false;

  writeLog("scope-after", "runtime", {
    sessionID: params.sessionID,
    callID: params.callID,
    event: "TOOL-AFTER",
    detail: "tool=" + params.tool + " file=" + filePath,
  });

  try {
    atomicWriteSubState("eslint_state", (state: any) => {
      state.aggregate = state.aggregate || { dirty_modules: [] };
      state.aggregate.dirty_modules = state.aggregate.dirty_modules || [];
      if (!state.aggregate.dirty_modules.includes(filePath)) {
        state.aggregate.dirty_modules.push(filePath);
      }
    });
  } catch (err: any) {
    writeLog("scope-after", "runtime", {
      sessionID: params.sessionID,
      callID: params.callID,
      level: "ERROR",
      event: "TOOL-AFTER",
      detail: "state-update failed: " + err.message,
    });
  }

  return true;
}
