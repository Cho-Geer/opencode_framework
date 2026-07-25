// plugin-handlers/before/gate-call-context.ts
// v37: Records gate_call_context for all 5 compliance_gate MCP tools.
// Runs in before-dispatcher BEFORE any other handler, so context is available.

import { resolveAgent } from "../../lib/agent-resolver";
import { writeLog } from "../../lib/log-manager";
import {
  recordGateCallContext,
  computeGateArgsHash,
  getParentSessionId,
} from "../../service/gate/session-context-service";

const SRC = "before-gate-call-context";

const GATE_TOOLS = [
  "compliance-gate_compliance_gate_check",
  "compliance-gate_compliance_gate_confirm",
  "compliance-gate_compliance_gate_submit_deliverables",
  "compliance-gate_compliance_gate_approve_deliverables",
  "compliance-gate_compliance_gate_complete",
];

function normalizeGateToolName(toolName: string): string {
  return toolName.replace(/^compliance-gate_/, "");
}

function extractGateSessionId(args: Record<string, unknown>): string | null {
  return (
    (args.gate_session_id as string) ||
    (args.session_id as string) ||
    null
  );
}

export async function handle(input: any, output: any): Promise<void> {
  const toolName = input.tool;
  if (!GATE_TOOLS.includes(toolName)) return;

  const sessionId = input.sessionID;
  const callId = input.callID;
  const agent = resolveAgent(sessionId);
  const args: Record<string, unknown> = output?.args || input.args || {};

  const gateSessionId = extractGateSessionId(args);
  const parentSessionId = getParentSessionId(sessionId);
  const argsHash = computeGateArgsHash(args);

  const contextId = recordGateCallContext({
    tool_name: normalizeGateToolName(toolName),
    gate_session_id: gateSessionId,
    opencode_session_id: sessionId,
    parent_session_id: parentSessionId,
    call_id: callId,
    agent,
    args_hash: argsHash,
  });

  // Store context_id on input for after-hook to consume
  if (contextId) {
    input._gateCallContextId = contextId;
  }

  // Fix (blueprint §1/§10.5): propagate call_id into output.args so the MCP tool
  // handler can read it. The MCP handler only receives the parsed args (NOT the hook
  // input), so without this injection the call_id never reaches confirmGateSession and
  // it falls back to the "ORDER BY created_at DESC LIMIT 1" guess. call_id is the
  // globally-unique per-call identifier used for exact-match gate_call_context resolution.
  if (callId) {
    output.args = output.args || {};
    (output.args as Record<string, unknown>).call_id = callId;
    (output.args as Record<string, unknown>).tool_name = normalizeGateToolName(toolName);
    (output.args as Record<string, unknown>).opencode_session_id = sessionId;
  }

  writeLog(SRC, "INFO", {
    event: "GATE_CALL_CONTEXT_BEFORE",
    tool: toolName,
    sessionID: sessionId,
    callID: callId,
    agent: agent || "—",
    contextId: contextId || "—",
    gateSessionId: gateSessionId || "—",
    parentSessionId: parentSessionId || "—",
    argsHash,
  });
}
