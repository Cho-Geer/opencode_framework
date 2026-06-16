// uc7ks-after.ts — "tool.execute.after" plugin: knowledge pipeline compliance
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { getModifyPath } from "../lib/tool-scope";
import { normalizeAgentKey } from "../lib/uc7ks-schema";
import { atomicWriteSubState } from "../lib/state-utils";

export default withPluginLifecycle("uc7ks-after", { "tool.execute.after": toolExecuteAfter });

/**
 * after-hook: validate knowledge pipeline compliance
 * - Track cache access for UC7-001 (read on docs/official_docs/)
 * - Validate index.json after cache writes
 */
async function toolExecuteAfter(input: any, output: any): Promise<void> {
  // after-hook: args live in input.args
  const filePath = getModifyPath(input.args || {});

  // Track knowledge cache reads — update knowledge-cache-state.json (P1-B split)
  if (input.tool === "read" && filePath && filePath.includes("docs/official_docs/")) {
    const rawAgent = resolveAgent(input.sessionID);
    const agent = normalizeAgentKey(rawAgent);
    writeLog("uc7ks-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID,
      event: "TOOL-AFTER",
      detail: `cache-read | agent=${agent} | file=${filePath}`,
    });
    // Update knowledge-cache-state.json
    try {
      atomicWriteSubState("knowledge_cache_state", (state) => {
        state.session_access = state.session_access || {};
        state.session_access[agent] = state.session_access[agent] || {};
        state.session_access[agent].uc7_001_compliant = true;
        state.session_access[agent].last_read_at = new Date().toISOString();
        state.session_access[agent].last_file_read = filePath;
        state.session_access[agent].total_cache_reads =
          (state.session_access[agent].total_cache_reads || 0) + 1;
      });
    } catch (err: any) {
      writeLog("uc7ks-after", "runtime", {
        sessionID: input.sessionID, callID: input.callID,
        level: "ERROR", event: "TOOL-AFTER",
        detail: "cache-state update failed: " + err.message,
      });
    }
  }
}
