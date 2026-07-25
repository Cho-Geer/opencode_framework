// ────────────────────────────────────────────────────────────────────
// DELEGATE HANDLER — NOT in execution_order but called by active handlers.
// Called by: unified-audit / quality-contract / dispatch-trace / guidance-recovery.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/scope.ts — post-write state tracking
// Migrated from plugins/scope-after.ts
import { trackDirtyModule } from "../../service/file-guard";

export const name = "scope";
export const tools = ["*"]; // all tools

export async function handle(input: any, _output: any): Promise<void> {
  trackDirtyModule({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    args: input.args || {},
  });
}
