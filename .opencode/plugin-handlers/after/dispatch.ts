// ────────────────────────────────────────────────────────────────────
// DELEGATE HANDLER — NOT in execution_order but called by active handlers.
// Called by: unified-audit / quality-contract / dispatch-trace / guidance-recovery.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/dispatch.ts — dispatch lifecycle + auto-dispatch cleanup
// Migrated from plugins/dispatch-after.ts + plugins/dispatch-auto.ts (merged)
import { cleanupDispatch } from "../../service/dispatch";
import { reclaimAutoDispatch } from "../../service/dispatch";
import { writeLog } from "../../lib/log-manager";

export const name = "dispatch";
export const tools = ["*"];

// Marker-consume gap diagnostic:
// Track sessions that called dispatch_subagent but never called Task().
// Helps identify when Orchestrator LLM forgets to pass the returned prompt to Task().
// In-memory map; cleared on serve restart (acceptable for diagnostic).
const pendingDispatchSessions = new Map<string, { callID: string; ts: number }>();

export async function handle(input: any, _output: any): Promise<void> {
  const tool = input.tool as string;
  const sid = input.sessionID || "";

  // ── Diagnostic: track dispatch_subagent / Task() pairing ──
  if (tool === "dispatch_subagent" && sid) {
    pendingDispatchSessions.set(sid, { callID: input.callID || "", ts: Date.now() });
    writeLog("dispatch-after", "runtime", {
      sessionID: sid, callID: input.callID, event: "DIAG-DISPATCH-SUBAGENT-RECORDED",
      detail: "expecting Task() call with returned prompt to create child session",
    });
  }
  if ((tool === "task" || tool === "Task") && sid) {
    if (pendingDispatchSessions.delete(sid)) {
      writeLog("dispatch-after", "runtime", {
        sessionID: sid, callID: input.callID, event: "DIAG-TASK-PAIRED",
        detail: "Task() called after dispatch_subagent — marker-consume path will activate",
      });
    }
  }

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

/**
 * Called by session.idle hook (if wired) to detect unpaired dispatch_subagent.
 * Exposed for external callers; safe to invoke at any time.
 */
export function checkUnpairedDispatch(sessionID: string): boolean {
  const pending = pendingDispatchSessions.get(sessionID);
  if (!pending) return false;
  // Grace period: if dispatch was < 5s ago, LLM may still be reasoning
  if (Date.now() - pending.ts < 5000) return false;
  writeLog("dispatch-after", "WARN", {
    sessionID, callID: pending.callID, event: "DIAG-UNPAIRED-DISPATCH",
    detail: "dispatch_subagent called but Task() was never invoked — child session NOT created. " +
            "Orchestrator.md rule 7 mandates Task(<returned prompt>) after dispatch_subagent.",
  });
  pendingDispatchSessions.delete(sessionID);
  return true;
}
