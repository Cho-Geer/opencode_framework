// service/file-guard/diagnostic-tracker.ts — TSC diagnostic state tracking
// Source: tsc-diag-track.ts plugin
// Handles: diagnostic_state substate updates (clear errors / record errors).

import { writeLog } from "../../lib/log-manager";
import { atomicWriteSubState } from "../../lib/state-utils";

const SRC = "service-diagnostic-tracker";

/**
 * Update diagnostic_state after tsc check.
 * Called by tsc-diag-track plugin (both before and after hooks).
 *
 * @param filePath - Absolute path to the checked file
 * @param errors - Array of tsc errors (empty = clean)
 * @param source - "before-write-gate" or "after-write-gate"
 * @param sessionID - Current session ID
 */
export function updateDiagnosticState(params: {
  filePath: string;
  errors: any[];
  source: string;
  sessionID: string;
}): void {
  try {
    atomicWriteSubState("diagnostic_state", (state: any) => {
      state.files = state.files || {};
      if (params.errors.length > 0) {
        // Record errors
        state.files[params.filePath] = {
          errors: params.errors,
          updated_at: new Date().toISOString(),
          source: params.source,
          session_id: params.sessionID,
        };
      } else {
        // Clean — clear errors for this file
        if (state.files[params.filePath]) {
          delete state.files[params.filePath];
        }
      }
      state.last_updated = new Date().toISOString();
      state.schema_version = "2.0";
    });
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "DIAGNOSTIC-STATE-FAIL",
      detail: `diagnostic_state update failed for ${params.filePath}: ${err.message}`,
    });
  }
}
