// ────────────────────────────────────────────────────────────────────
// DELEGATE HANDLER — NOT in execution_order but called by active handlers.
// Called by: unified-audit / quality-contract / dispatch-trace / guidance-recovery.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/codegraph.ts — Track codegraph_explore calls
// Migrated from plugins/codegraph-enforce.ts (tool.execute.after portion)
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { readImpactState, writeImpactState } from "../../service/file-guard/codegraph-state";

export const name = "codegraph";
export const tools = ["codegraph_explore"]; // only fires for codegraph_explore

export async function handle(input: any, output: any): Promise<void> {
  // Track codegraph_explore calls
  if (input.tool !== "codegraph_explore") return;

  const sessionId = input.sessionID || "unknown";
  const agent = resolveAgent(sessionId);
  const symbol = (output.args?.symbol || "unknown").toString();

  const state = readImpactState();
  if (!state.sessions[sessionId]) {
    state.sessions[sessionId] = { impact_called: false, at: 0 };
  }
  state.sessions[sessionId].impact_called = true;
  state.sessions[sessionId].at = Date.now();
  if (!state.sessions[sessionId].targets) {
    state.sessions[sessionId].targets = [];
  }
  state.sessions[sessionId].targets!.push(symbol);
  writeImpactState(state);

  writeLog("plugin-codegraph-enforce", "INFO", {
    event: "CODEGRAPH-IMPACT-TRACKED",
    agent,
    sessionId,
    symbol,
    detail: "codegraph_explore recorded for session — all code-modifying tools now allowed",
  });
}
