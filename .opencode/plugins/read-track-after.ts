/**
 * read-track-after.ts — READ-BEFORE-APPROVE plugin
 * Phase 3: Pure middleware — delegates to FileGuardService
 *
 * Records every read event to read_audit SQLite.
 * Compliance enforcement: without this, compliance-gate cannot verify
 * that an approver actually read HANDOVER.md before approving.
 *
 * @version 2.0.0 — Phase 3 hook purification
 */
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { trackReadEvent } from "../service/file-guard";

export default withPluginLifecycle("read-track-after", {
  "tool.execute.after": toolExecuteAfter,
});

async function toolExecuteAfter(input: any, _output: any) {
  const tool = input?.tool || "";
  if (tool !== "read" && tool !== "Read") return;
  const filePath = input?.args?.filePath || input?.args?.file_path || "";
  if (!filePath) return;

  trackReadEvent({
    sessionID: input?.sessionID || input?.sessionId || "",
    callID: input?.callID || input?.callId || "",
    filePath,
  });
}
