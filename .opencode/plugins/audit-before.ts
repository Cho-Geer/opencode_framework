// audit-before.ts — "tool.execute.before" plugin: write audit enforcement
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent, resolveTaskId } from "../lib/agent-resolver";
import { isModifyTool, getEffectivePathScopeFilePath } from "../lib/tool-scope";
import { isSourceFile } from "../lib/state-utils";
import { executeWriteAuditCheck } from "../lib/write-audit-lib";

export default withPluginLifecycle("audit-before", { "tool.execute.before": toolExecuteBefore });

async function toolExecuteBefore(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const taskId = resolveTaskId();
  if (!isModifyTool(input.tool)) return;
  const filePath = getEffectivePathScopeFilePath(input.tool, output.args || {});
  if (!filePath || !isSourceFile(filePath)) return;
  executeWriteAuditCheck([filePath], agent, taskId);
}
