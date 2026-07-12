// resolve_domain_id.ts — Resolve dispatch-assigned domain_id for agent self-check
// Thin Controller: delegates to SessionService.resolveDomainIdForTool()

import { tool } from "@opencode-ai/plugin";
import { resolveDomainIdForTool } from "../service/session/";
import { checklistWirePassed } from "../service/gate/checklist-hooks";
import { writeLog } from "../lib/log-manager";
import type { FrameworkToolContext } from "./tool-context";

export default tool({
  description:
    "Resolve the dispatch-assigned knowledge domain ID for the current session. " +
    "Used for agent self-check: before calling module_scope_declare(), " +
    "agents can verify their dispatch-assigned domain_id to ensure consistency. " +
    "Reads from session_map DB (primary) and .dispatch_ctx file (fallback). " +
    "Returns the domain_id string or null if no domain context is available. " +
    "Also returns confidence (high/medium/low/none) and resolved_from source identifier.",
  args: {
    sessionId: tool.schema
      .string()
      .optional()
      .describe(
        "Session ID to resolve domain for (optional; if omitted, uses context.sessionID)",
      ),
    dag_task_id: tool.schema
      .string()
      .optional()
      .describe(
        "Optional DAG task ID. If provided and sessionId is not, the tool will " +
          "look up the sessionId from session_map DB by dag_task_id before resolving the domain.",
      ),
  },
  async execute(args, context: FrameworkToolContext) {
    const sessionId = args.sessionId || context.sessionID || "";
    const dagTaskId = args.dag_task_id || "";
    const agentKey = context.agent || "";

    const result = resolveDomainIdForTool(sessionId, dagTaskId, agentKey);

    // P0-CHECKLIST: wire domain resolution to checklist
    if (result.domain_id) {
      try {
        checklistWirePassed(
          sessionId,
          agentKey,
          dagTaskId,
          "domain_resolved",
          `domain=${result.domain_id}`,
        );
      } catch (error: unknown) {
        writeLog("tool-resolve-domain-id", "WARN", {
          event: "CHECKLIST-WIRE-PASSED-FAILED",
          sessionId,
          agent: agentKey,
          dagTaskId,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return JSON.stringify({
      domain_id: result.domain_id,
      resolved_from: result.resolved_from,
      confidence: result.confidence,
      note: result.domain_id
        ? "Use this domain_id as the 'module' argument for module_scope_declare()"
        : "No dispatch domain assigned — agent_domain_map may not have this agent type, or the dispatch hasn't been recorded yet",
    });
  },
});
