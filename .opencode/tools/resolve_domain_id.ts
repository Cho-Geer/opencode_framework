// resolve_domain_id.ts — Custom MCP tool: resolve dispatch-assigned domain_id for agent self-check
// FW-UC7KS-DOMAIN-002: Wraps resolveDomainId() from agent-resolver.ts as a query tool.
// Agents call this in Step 0a (subagent-preamble.md) to verify their dispatch-assigned domain
// before calling module_scope_declare(), preventing domain mismatch errors.
// The underlying resolveDomainId() reads from session_map DB (primary) and .dispatch_ctx (fallback).
// Created: 2026-06-18 @Super-Admin (SA-ADD-DOMAIN-SELFCHECK-TOOL)

import { tool } from "@opencode-ai/plugin";
import { resolveDomainId } from "../lib/agent-resolver";

export default tool({
  description:
    "Resolve the dispatch-assigned knowledge domain ID for the current session. " +
    "Used for agent self-check: before calling module_scope_declare(), " +
    "agents can verify their dispatch-assigned domain_id to ensure consistency. " +
    "Reads from session_map DB (primary) and .dispatch_ctx file (fallback). " +
    "Returns the domain_id string or null if no domain context is available.",
  args: {
    sessionId: tool.schema
      .string()
      .optional()
      .describe(
        "Session ID to resolve domain for (optional; if omitted, uses context.sessionID)",
      ),
  },
  async execute(args, context) {
    var sessionId = args.sessionId || ((context as any)?.sessionID as string) || "";

    if (!sessionId) {
      return JSON.stringify({
        domain_id: null,
        error: "No sessionId available — cannot resolve domain without session context",
        resolved_from: "none",
      });
    }

    var domainId = resolveDomainId(sessionId);

    return JSON.stringify({
      domain_id: domainId,
      resolved_from: domainId ? "session_map" : "none",
      note:
        domainId
          ? "Use this domain_id as the 'module' argument for module_scope_declare()"
          : "No dispatch domain assigned — agent_domain_map may not have this agent type, or the dispatch hasn't been recorded yet",
    });
  },
});
