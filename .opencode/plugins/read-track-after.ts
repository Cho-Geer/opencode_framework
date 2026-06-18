/**
 * read-track-after.ts — READ-BEFORE-APPROVE plugin
 * ═══════════════════════════════════════════════════════════
 * Hooks into `tool.execute.after` for the `read` tool.
 * Records every read event to read_audit.jsonl via lib/read-audit.ts.
 *
 * This plugin is the physical enforcement layer for READ-BEFORE-APPROVE:
 * without it, compliance-gate.ts cannot verify that an approver actually
 * read HANDOVER.md before calling approve_deliverables.
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-18
 *
 * Design review: docs/review/framework-refactor/read-before-approve-plan.md
 */

import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { recordRead } from "../lib/read-audit";
import { writeLog } from "../lib/log-manager";
import { resolveAgent, resolveTaskId } from "../lib/agent-resolver";

const PLUGIN_ID = "read-track-after";

// ── Plugin export (withPluginLifecycle pattern) ────────────────

async function toolExecuteAfter(input: any, _output: any) {
  try {
    // Only intercept `read` tool invocations
    const tool = input?.tool || "";
    if (tool !== "read" && tool !== "Read") return;

    // Extract file path from read tool args
    // `read` tool after-hook: args = { filePath: "/path/to/file", ... }
    const args = input?.args || {};
    const filePath = args.filePath || args.file_path || "";
    if (!filePath) return;

    // Resolve caller identity via agent-resolver (session map → dispatch target → "")
    // Uses input.sessionID for session map lookup per the agent-resolver contract
    const sessionId = input?.sessionID || input?.sessionId || undefined;
    const agent = resolveAgent(sessionId);
    const taskId = resolveTaskId(sessionId || "");
    const callId = input?.callID || input?.callId || undefined;

    // Record the read event
    recordRead({
      timestamp: new Date().toISOString(),
      agent,
      filePath,
      sessionId,
      taskId,
      callId,
    });

    writeLog(PLUGIN_ID, "runtime", {
      event: "READ_TRACKED",
      agent,
      filePath,
      sessionId: sessionId || "—",
    });
  } catch (err: any) {
    writeLog(PLUGIN_ID, "ERROR", {
      event: "READ_TRACK_FAILED",
      error: err.message,
    });
  }
}

export default withPluginLifecycle(PLUGIN_ID, {
  "tool.execute.after": toolExecuteAfter,
});
