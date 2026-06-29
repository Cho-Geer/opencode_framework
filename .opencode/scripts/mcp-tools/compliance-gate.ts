#!/usr/bin/env bun
"use strict";

// compliance-gate.ts — MCP Server thin shell
// ═══════════════════════════════════════════════════════════════
// Phase 4A: Business logic extracted to service/gate/mcp-*.ts
// This file only handles MCP protocol + dispatch to service layer.
// ═══════════════════════════════════════════════════════════════

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── Service layer imports ──
import { checkGateCompliance } from "../../service/gate/mcp-check";
import { confirmGateSession } from "../../service/gate/mcp-confirm";
import { completeGateWithRetry } from "../../service/gate/mcp-complete";
import { submitDeliverablesWithCrossCheck, approveDeliverablesWithAudit } from "../../service/gate/mcp-deliverables";
import { retryConfirmGateSession } from "../../service/gate/mcp-retry";
import { bulkReviewDeliverables } from "../../service/gate/mcp-bulk";
import { purgeStaleSessions, drainStaleSessions } from "../../service/gate/drain";

// ── Reminder text builder ──
function buildReminderText(gateSessionId: string, planSummary: string, expiresAt: string): string {
  const summarySnippet = (planSummary || "").trim().substring(0, 120);
  return (
    "\n\n══════════════════════════════════════════════════════════════\n" +
    "✅ GATE ARMED [session: " + gateSessionId + "]\n" +
    "══════════════════════════════════════════════════════════════\n" +
    "⚠️  REMINDER — YOU MUST DO THIS WHEN THE TASK FINISHES:\n" +
    "    Call:  compliance_gate_complete\n" +
    "    With:  { \"session_id\": \"" + gateSessionId + "\", \"execution_summary\": \"<what you actually accomplished>\" }\n\n" +
    "Plan (anchored): " + (summarySnippet || "(no summary provided)") + "\n" +
    "Expires at: " + (expiresAt || "(unknown)") + "\n\n" +
    "Failure to call compliance_gate_complete will leave the gate in armed state.\n" +
    "══════════════════════════════════════════════════════════════"
  );
}

// ── MCP Server ──
const gateServer = new McpServer({ name: "compliance-gate", version: "1.0.0" }, { capabilities: { tools: {} } });

// ── Tool 1: compliance_gate_check ──
gateServer.registerTool("compliance_gate_check", {
  description: "MANDATORY runtime compliance gate v2. Must be called BEFORE any task execution. Verifies skill exists, rules present, rule_registry digest compatibility. Returns passed=true when all checks clear.",
  inputSchema: {
    task_description: z.string(),
    task_id: z.string().optional(),
    plan_summary: z.string().optional().describe("OPTIONAL combined check+confirm flow. If provided AND check passes, gate is armed in single call."),
    agent: z.string().optional(),
  },
}, (args) => {
  const result = checkGateCompliance(args.task_description || "", args.task_id);
  const planSummary = args.plan_summary;
  if (planSummary && result.passed && result.gate_session_id) {
    if (planSummary.trim().length < 10) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ ...result, combined: true, combined_status: "rejected_plan_too_short" }, null, 2) }], isError: true };
    }
    const armResult = confirmGateSession(result.gate_session_id, planSummary, args.agent, args.task_id, (args as any).declared_deliverables);
    if (armResult.status === "armed") {
      const merged = { ...result, combined: true, combined_status: "armed", confirmed_at: armResult.confirmed_at, expires_at: armResult.expires_at };
      return { content: [{ type: "text" as const, text: JSON.stringify(merged, null, 2) + buildReminderText(result.gate_session_id, armResult.plan_summary, armResult.expires_at) }], isError: false };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify({ ...result, combined: true, combined_status: "arm_failed", combined_reason: armResult.reason }, null, 2) }], isError: true };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: !result.passed };
});

// ── Tool 2: compliance_gate_confirm ──
gateServer.registerTool("compliance_gate_confirm", {
  description: "Mark gate as armed after plan review. HARD CONSTRAINT: declared_deliverables required for non-exempt agents.",
  inputSchema: {
    session_id: z.string(),
    plan_summary: z.string(),
    declared_deliverables: z.string().optional(),
    task_id: z.string().optional(),
    agent: z.string().optional(),
  },
}, (args) => {
  const result = confirmGateSession(args.session_id, args.plan_summary, args.agent, args.task_id, args.declared_deliverables);
  if (result.status === "armed") {
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) + buildReminderText(result.gate_session_id!, result.plan_summary, result.expires_at!) }], isError: false };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: result.status !== "armed" };
});

// ── Tool 3: compliance_gate_complete ──
gateServer.registerTool("compliance_gate_complete", {
  description: "Mark gate session completed after task execution. Reads eslint_state, returns failed if dirty_modules exist.",
  inputSchema: {
    session_id: z.string(),
    execution_summary: z.string(),
  },
}, (args) => {
  const result = completeGateWithRetry(args.session_id, args.execution_summary);
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: result.status !== "completed" };
});

// ── Tool 4: compliance_gate_submit_deliverables ──
gateServer.registerTool("compliance_gate_submit_deliverables", {
  description: "Submit deliverables evidence. MUST be called BEFORE complete for non-exempt agents.",
  inputSchema: {
    session_id: z.string(),
    deliverables_evidence: z.string(),
  },
}, (args) => {
  const result = submitDeliverablesWithCrossCheck(args.session_id, args.deliverables_evidence);
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: result.status !== "delivered" };
});

// ── Tool 5: compliance_gate_approve_deliverables ──
gateServer.registerTool("compliance_gate_approve_deliverables", {
  description: "Approve/reject sub-agent deliverables. RESTRICTED to @Orchestrator/@Super-Admin.",
  inputSchema: {
    session_id: z.string(),
    approval_decision: z.enum(["approve", "reject"]),
    approval_note: z.string().optional(),
    execution_summary: z.string().optional(),
    agent_id: z.string().optional(),
    handover_sha256: z.string(),
    findings_reported: z.string().optional(),
  },
}, (args) => {
  const result = approveDeliverablesWithAudit(args.session_id, args.approval_decision, args.approval_note, args.execution_summary, args.agent_id, args.handover_sha256, args.findings_reported);
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: result.status === "rejected" };
});

// ── Tool 6: compliance_gate_purge ──
gateServer.registerTool("compliance_gate_purge", {
  description: "Force-purge all stale gate sessions.",
  inputSchema: {},
}, () => {
  const result = purgeStaleSessions();
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: false };
});

// ── Tool 7: compliance_gate_drain_stale ──
gateServer.registerTool("compliance_gate_drain_stale", {
  description: "Drain stale gate sessions (armed >24h, checked >48h).",
  inputSchema: {
    threshold_hours_armed: z.number().optional(),
    threshold_hours_checked: z.number().optional(),
  },
}, (args) => {
  const result = drainStaleSessions(args.threshold_hours_armed || 24, args.threshold_hours_checked || 48);
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: false };
});

// ── Tool 8: compliance_gate_retry_confirm ──
gateServer.registerTool("compliance_gate_retry_confirm", {
  description: "Re-arm failed/recoverable gate session. For recoverable: any agent. For failed: SA/Orchestrator only.",
  inputSchema: {
    session_id: z.string(),
    plan_summary: z.string(),
    task_id: z.string().optional(),
  },
}, (args) => {
  const result = retryConfirmGateSession(args.session_id, args.plan_summary, args.task_id);
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: result.status !== "armed" };
});

// ── Tool 9: compliance_gate_bulk_review_deliverables ──
gateServer.registerTool("compliance_gate_bulk_review_deliverables", {
  description: "Bulk approve/reject multiple gate sessions atomically.",
  inputSchema: {
    session_ids: z.array(z.string()),
    decision: z.enum(["approve", "reject"]),
    execution_summary: z.string().optional(),
    approval_note: z.string().optional(),
  },
}, (args) => {
  const result = bulkReviewDeliverables(args.session_ids, args.decision, args.execution_summary, args.approval_note);
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: result.status === "rejected" };
});

// ── Startup ──
async function main() {
  const transport = new StdioServerTransport();
  await gateServer.connect(transport);
  process.stderr.write("[compliance-gate] started (McpServer) — service layer delegated\n");
}

main().catch((err) => {
  process.stderr.write("[compliance-gate] fatal: " + err.message + "\n");
  process.exit(1);
});

process.on("SIGINT", () => {
  process.stderr.write("[compliance-gate] SIGINT received, shutting down\n");
  process.exit(0);
});

export { gateServer as server };
