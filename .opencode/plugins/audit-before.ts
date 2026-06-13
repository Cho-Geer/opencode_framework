// audit-before.ts — "tool.execute.before" plugin: write audit enforcement
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent, resolveTaskId } from "../lib/agent-resolver";
import { isModifyTool, getModifyPath } from "../lib/tool-scope";
import { isSourceFile } from "../lib/state-utils";
import { executeWriteAuditCheck } from "../lib/write-audit-lib";

ensureLogDir();
writeLog("audit-before", "loaded", { event: "PLUGIN-LOADED", detail: "audit-before.ts" });
updateIndex("audit-before", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("audit-before", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.before" });
  return { "tool.execute.before": toolExecuteBefore };
}) as any;

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const taskId = resolveTaskId();
  if (!isModifyTool(input.tool)) return;
  // safe_shell commands are arbitrary shell strings, not file paths.
  // Passing them to executeWriteAuditCheck causes false scope violations
  // whenever a command happens to end with a source extension (e.g.
  // "bun .opencode/scripts/framework-self-test.ts").
  if (input.tool === "safe_shell") return;
  const filePath = getModifyPath(output.args || {});
  if (!filePath || !isSourceFile(filePath)) return;
  executeWriteAuditCheck([filePath], agent, taskId);
}
