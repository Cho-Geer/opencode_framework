// plugin-handlers/after/gate-call-context.ts
// v37: After-hook for gate MCP tools.
// 1. Backfills gate_session_id from check tool return value
// 2. Marks gate_call_context as completed

import { writeLog } from "../../lib/log-manager";
import {
  backfillGateSessionIdForPendingCall,
  completeGateCallContext,
} from "../../service/gate/session-context-service";

const SRC = "after-gate-call-context";

function extractGateSessionIdFromOutput(output: any): string | null {
  if (!output) return null;
  // compliance_gate_check returns { session_id: "..." } or similar
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output);
      return parsed.session_id || parsed.gate_session_id || null;
    } catch {
      return null;
    }
  }
  if (typeof output === "object") {
    return output.session_id || output.gate_session_id || null;
  }
  return null;
}

export async function handle(input: any, output: any): Promise<void> {
  const contextId = input._gateCallContextId;
  if (!contextId) return;

  const toolName = input.tool;

  // For compliance_gate_check, backfill gate_session_id from return value
  if (toolName === "compliance-gate_compliance_gate_check" || toolName === "compliance_gate_check") {
    const gateSessionId = extractGateSessionIdFromOutput(output);
    if (gateSessionId) {
      backfillGateSessionIdForPendingCall(contextId, gateSessionId);
    }
  }

  // Mark context as completed for all gate tools
  completeGateCallContext(contextId);

  writeLog(SRC, "INFO", {
    event: "GATE_CALL_CONTEXT_AFTER",
    tool: toolName,
    sessionID: input.sessionID,
    callID: input.callID,
    contextId,
    gateSessionId: extractGateSessionIdFromOutput(output) || "—",
  });
}
