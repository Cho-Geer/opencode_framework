// audit-after.ts — "tool.execute.after" plugin: audit trail management
// Phase 3: Pure middleware — delegates to FileGuardService
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { recordWriteAudit } from "../service/file-guard";

export default withPluginLifecycle("audit-after", {
  "tool.execute.after": toolExecuteAfter,
});

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  recordWriteAudit({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    filePath: (input.args as any)?.filePath || "",
  });
}
