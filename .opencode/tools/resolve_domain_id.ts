// resolve_domain_id.ts — Custom MCP tool: resolve dispatch-assigned domain_id for agent self-check
// FW-UC7KS-DOMAIN-002: Wraps resolveDomainId() from agent-resolver.ts as a query tool.
// Agents call this in Step 0a (subagent-preamble.md) to verify their dispatch-assigned domain
// before calling module_scope_declare(), preventing domain mismatch errors.
// The underlying resolveDomainId() reads from session_map DB (primary) and .dispatch_ctx (fallback).
// Created: 2026-06-18 @Super-Admin (SA-ADD-DOMAIN-SELFCHECK-TOOL)
// Updated: 2026-06-21 @Super-Admin — Issue #115: added dag_task_id optional param,
//   confidence field (high/medium/low/none), and more specific resolved_from sources.

import { tool } from "@opencode-ai/plugin";
import { resolveDomainId } from "../lib/agent-resolver";
import { dbReadSessionMap } from "../lib/db-state-manager";
import { getDb } from "../lib/db-manager";

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
          "look up the sessionId from session_map DB by dag_task_id before resolving the domain. " +
          "This enables domain resolution in dispatch contexts where only dag_task_id is known.",
      ),
  },
  async execute(args, context) {
    var sessionId =
      args.sessionId || ((context as any)?.sessionID as string) || "";
    var dagTaskId = (args.dag_task_id as string) || "";

    // If dag_task_id provided but no sessionId, try to resolve sessionId from session_map DB
    // by dag_task_id. This enables domain resolution when the caller only has dag_task_id.
    if (dagTaskId && !sessionId) {
      try {
        const db = getDb();
        const row = db
          .query(
            "SELECT session_id FROM session_map WHERE dag_task_id = ? ORDER BY updated_at DESC LIMIT 1",
          )
          .get(dagTaskId) as { session_id: string } | null;
        if (row?.session_id) {
          sessionId = row.session_id;
        }
      } catch (_e) {
        // Best-effort: if DB lookup fails, fall through with whatever sessionId we have
      }
    }

    if (!sessionId) {
      return JSON.stringify({
        domain_id: null,
        error:
          "No sessionId available — cannot resolve domain without session context. " +
          "Provide sessionId, dag_task_id, or ensure context.sessionID is set.",
        resolved_from: "none",
        confidence: "none",
      });
    }

    var domainId: string | null = null;
    var resolvedFrom = "none";
    var confidence = "none";

    // Confidence levels:
    //   "high"   — resolved directly from session_map DB (per-session, authoritative)
    //   "medium" — resolved from per-dispatch ctx/ or .dispatch_ctx fallback
    //   "low"    — reserved for future lower-confidence resolution sources
    //   "none"   — no resolution available
    //
    // Priority 1: Check session_map DB directly (high confidence).
    // We check this BEFORE calling resolveDomainId() so we can accurately report
    // the confidence level rather than just a binary resolved_from value.
    try {
      const entry = dbReadSessionMap(sessionId);
      if (entry?.domain_id) {
        domainId = entry.domain_id;
        resolvedFrom = "session_map";
        confidence = "high";
      }
    } catch (_e) {
      // Session map read failed — fall through to resolveDomainId()
    }

    // Priority 2: If not found in session_map, use resolveDomainId() which checks
    // per-dispatch ctx/ files and .dispatch_ctx legacy fallback.
    if (!domainId) {
      domainId = resolveDomainId(sessionId);
      if (domainId) {
        // resolveDomainId() found the domain from ctx/ files or .dispatch_ctx fallback.
        // These are less authoritative than session_map (medium confidence).
        resolvedFrom = "dispatch_ctx";
        confidence = "medium";
      }
    }

    return JSON.stringify({
      domain_id: domainId,
      resolved_from: resolvedFrom,
      confidence: confidence,
      note: domainId
        ? "Use this domain_id as the 'module' argument for module_scope_declare()"
        : "No dispatch domain assigned — agent_domain_map may not have this agent type, or the dispatch hasn't been recorded yet",
    });
  },
});
