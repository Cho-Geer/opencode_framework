// ────────────────────────────────────────────────────────────────────
// plugin-handlers/before/task.ts — DISPATCH-INTEGRITY validation
// Phase 4 (2026-07-07): Re-activated in before-dispatcher execution_order.
// Handles Task marker consumption, DISPATCH_TOKEN verification,
// and NATIVE_EXECUTOR subagent_type resolution.
// ────────────────────────────────────────────────────────────────────
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { consumeDispatchMarker } from "../../service/dispatch";
import * as crypto from "node:crypto";

export const name = "task";
export const tools = ["task", "Task"];

export async function handle(input: any, output: any): Promise<void> {
  const isTask = input.tool === "task" || input.tool === "Task";
  if (!isTask) return;

  const agent = resolveAgent(input.sessionID) || "unknown";
  const prompt = output?.args?.prompt || "";
  const nativeExecutorMatch = prompt.match(/^\/\/NATIVE_EXECUTOR:([a-z-]+)$/m);
  const subagentType = nativeExecutorMatch?.[1] || output?.args?.subagent_type || "";
  const dispatchTokenMatch = prompt.match(/\/\/DISPATCH_TOKEN:([a-f0-9]{64})/);
  const queueIdMatch = prompt.match(/\/\/QUEUE_ID:(\d+)/);
  const promptHash = crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16);

  writeLog("task-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent,
    event: "TASK-HANDLER-ENTRY",
    NATIVE_EXECUTOR: nativeExecutorMatch?.[1] || "none",
    DISPATCH_TOKEN: dispatchTokenMatch ? dispatchTokenMatch[1].slice(0, 16) + "..." : "none",
    QUEUE_ID: queueIdMatch?.[1] || "none",
    promptHash,
    subagentType,
    promptLength: prompt.length,
    detail: `Task handler invoked | executor=${subagentType || "unspecified"} hasToken=${!!dispatchTokenMatch} queueId=${queueIdMatch?.[1] || "none"}`,
  });

  if (nativeExecutorMatch && output?.args) {
    output.args.subagent_type = nativeExecutorMatch[1];
  }

  const result = consumeDispatchMarker({
    sessionID: input.sessionID,
    callID: input.callID,
    prompt,
    subagentType,
    queueId: queueIdMatch ? parseInt(queueIdMatch[1], 10) : undefined,
  });

  writeLog("task-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent,
    event: "TASK-HANDLER-RESULT",
    blocked: result.blocked,
    hasResolvedPrompt: !!result.resolvedPrompt,
    detail: result.blocked
      ? `BLOCKED: ${result.message}`
      : result.resolvedPrompt
        ? `Marker consumed, prompt resolved`
        : `Marker consumed (no prompt change)`,
  });

  // Update prompt if service resolved a new one from auto-dispatch marker
  if (result.resolvedPrompt && output?.args) {
    output.args.prompt = result.resolvedPrompt;
  }

  if (result.blocked) {
    writeLog("task-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent,
      level: "ERROR", event: "TOOL-BEFORE",
      detail: "BLOCKED | " + result.message,
    });
    throw new Error(result.message);
  }
}
