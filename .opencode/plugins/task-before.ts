// task-before.ts — "tool.execute.before" plugin: DISPATCH-INTEGRITY validation
// Phase 3: Middleware — delegates to DispatchService for marker consumption
// and integrity verification. Hook interprets block/pass and updates prompt.
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { getEnforcementMode } from "../lib/gate-core";
import { consumeDispatchMarker } from "../service/dispatch";

export default withPluginLifecycle("task-before", {
  "tool.execute.before": taskExecuteBefore,
});

async function taskExecuteBefore(input: any, output: any): Promise<void> {
  const isTask = input.tool === "task" || input.tool === "Task";
  if (!isTask) return;

  const agent = resolveAgent(input.sessionID) || "unknown";
  const mode = getEnforcementMode();
  const prompt = output?.args?.prompt || "";
  const subagentType = output?.args?.subagent_type || "";

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

  // Block if service detected integrity violation
  if (result.blocked) {
    writeLog("task-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      level: "ERROR",
      event: "TOOL-BEFORE",
      detail: "BLOCKED | " + result.message,
    });
    throw new Error(result.message);
  }
}
