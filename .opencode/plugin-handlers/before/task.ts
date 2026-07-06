// ────────────────────────────────────────────────────────────────────
// LEGACY HANDLER — NOT in active execution_order
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/before/task.ts — DISPATCH-INTEGRITY validation
// Migrated from plugins/task-before.ts
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { consumeDispatchMarker } from "../../service/dispatch";

export const name = "task";
export const tools = ["task", "Task"];

export async function handle(input: any, output: any): Promise<void> {
  const isTask = input.tool === "task" || input.tool === "Task";
  if (!isTask) return;

  const agent = resolveAgent(input.sessionID) || "unknown";
  const prompt = output?.args?.prompt || "";
  const nativeExecutorMatch = prompt.match(/^\/\/NATIVE_EXECUTOR:([a-z-]+)$/m);
  const subagentType = nativeExecutorMatch?.[1] || output?.args?.subagent_type || "";

  if (nativeExecutorMatch && output?.args) {
    output.args.subagent_type = nativeExecutorMatch[1];
  }

  const result = consumeDispatchMarker({
    sessionID: input.sessionID,
    callID: input.callID,
    prompt,
    subagentType,
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
