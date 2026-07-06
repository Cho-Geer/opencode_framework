// ────────────────────────────────────────────────────────────────────
// DELEGATE HANDLER — NOT in execution_order but called by active handlers.
// Called by: unified-audit / quality-contract / dispatch-trace / guidance-recovery.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/dispatch.ts — dispatch lifecycle + auto-dispatch cleanup
// Migrated from plugins/dispatch-after.ts + plugins/dispatch-auto.ts (merged)
import { cleanupDispatch } from "../../service/dispatch";
import { reclaimAutoDispatch } from "../../service/dispatch";

export const name = "dispatch";
export const tools = ["*"];

export async function handle(input: any, _output: any): Promise<void> {
  // Original dispatch-after logic
  cleanupDispatch({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    args: input.args || {},
  });

  // Original dispatch-auto logic
  reclaimAutoDispatch({
    sessionID: input.sessionID,
    callID: input.callID,
  });
}
