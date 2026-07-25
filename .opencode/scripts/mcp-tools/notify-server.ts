#!/usr/bin/env bun
"use strict";
/**
 * notify-server.ts — OpenCode Agent → QoderWork reverse notification channel.
 * 
 * Phase 4 refactor: thin MCP shell. All business logic delegated to service/notification/mcp-notify.
 * Pattern matches compliance-gate.ts (service layer delegated).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── Service layer imports ──
import { writeNotification, closeDb } from "../../service/notification/mcp-notify";
import { clearGuidance } from "../../service/enforcement/tool-tracker";
import { resolveSession as resolveEnforcementSession } from "../../service/notification/mcp-notify";

// ── MCP Server ──
const server = new McpServer(
  { name: "notify-server", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

// @ts-ignore: MCP SDK registerTool callback signature mismatch
(server as any).registerTool("acp_notify", {
  description: [
    "Push notification event to QoderWork (reverse channel).",
    "Call when task completes, important info discovered, or user input needed.",
    "Session ID resolved automatically from agent identity + task_id.",
  ].join(" "),
  inputSchema: {
    agent_name: z.string().describe("Agent name (e.g. Coder-BE, Orchestrator)"),
    task_id: z.string().optional().describe("DAG task ID (assigned at dispatch, optional)"),
    event_type: z.enum([
      "task_complete", "task_progress", "task_failed", "task_blocked",
      "question", "discovery", "info",
    ]).describe("Event type"),
    data: z.record(z.string(), z.any()).optional().describe("Event payload (free-form JSON)"),
  },
},
(args, _extra) => {
  const result = writeNotification({
    agent: args.agent_name,
    task_id: args.task_id,
    event_type: args.event_type,
    data: args.data,
  });

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        ok: result.ok,
        seq: result.seq,
        resolved: result.resolved,
        session_id: result.session_id || "(unresolved)",
      }),
    }],
    isError: !result.ok,
  };
});

// ── Clear Guidance Tool (single-phase enforcement gate) ──
server.registerTool("clear_guidance", {
  description: [
    "Clear the enforcement guidance gate after receiving a token from QoderWork.",
    "When your session is blocked by the anti-bypass enforcement gate,",
    "QoderWork will investigate and respond with a guidance_token.",
    "Call this tool with that token to reset failure counters and resume.",
  ].join(" "),
  inputSchema: {
    agent_name: z.string().describe("Your agent name (e.g. Super-Admin, Orchestrator)"),
    token: z.string().describe("The guidance token from QoderWork's response"),
  },
}, (args, _extra) => {
  // Resolve session ID from agent name via session_map
  const session = resolveEnforcementSession(args.agent_name);

  if (!session.resolved) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        ok: false,
        error: "Cannot resolve session for agent: " + args.agent_name + ". Make sure you are dispatched via the framework.",
      }) }],
      isError: true,
    };
  }

  const result = clearGuidance(session.session_id, args.agent_name, args.token);

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        ok: result.success,
        session_id: session.session_id,
        error: result.error || undefined,
        message: result.success
          ? "Guidance gate cleared. All failure counters reset to zero. You may resume normal operations."
          : undefined,
      }),
    }],
    isError: !result.success,
  };
});

// ── Startup ──
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[notify-server] started (McpServer) — service layer delegated\n");
}
main().catch((err) => {
  process.stderr.write("[notify-server] fatal: " + err.message + "\n");
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => { closeDb(); process.exit(0); });
process.on("SIGTERM", () => { closeDb(); process.exit(0); });

export { server };
