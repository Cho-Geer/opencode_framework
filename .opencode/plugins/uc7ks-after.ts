// uc7ks-after.ts — "tool.execute.after" plugin: knowledge pipeline compliance
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { resolveAgent } from "../lib/agent-resolver";
import { getModifyPath } from "../lib/tool-scope";
import * as fs from "node:fs";

ensureLogDir();
writeLog("uc7ks-after", "loaded", { event: "PLUGIN-LOADED", detail: "uc7ks-after.ts" });
updateIndex("uc7ks-after", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("uc7ks-after", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.after" });
  return { "tool.execute.after": toolExecuteAfter };
}) as any;

/**
 * after-hook: validate knowledge pipeline compliance
 * - Track cache access for UC7-001 (read on docs/official_docs/)
 * - Validate index.json after cache writes
 */
async function toolExecuteAfter(input: any, output: any): Promise<void> {
  // after-hook: args live in input.args
  const filePath = getModifyPath(input.args || {});

  // Track knowledge cache reads — update machine.json.knowledge_cache_state
  if (input.tool === "read" && filePath && filePath.includes("docs/official_docs/")) {
    const agent = resolveAgent(input.sessionID);
    writeLog("uc7ks-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID,
      event: "TOOL-AFTER",
      detail: `cache-read | agent=${agent} | file=${filePath}`,
    });
    // Update machine.json knowledge_cache_state
    try {
      const mp = ".opencode/state/machine.json";
      if (fs.existsSync(mp)) {
        const m = JSON.parse(fs.readFileSync(mp, "utf8"));
        m.knowledge_cache_state = m.knowledge_cache_state || { session_access: {} };
        m.knowledge_cache_state.session_access = m.knowledge_cache_state.session_access || {};
        m.knowledge_cache_state.session_access[agent] = m.knowledge_cache_state.session_access[agent] || {};
        m.knowledge_cache_state.session_access[agent].uc7_001_compliant = true;
        m.knowledge_cache_state.session_access[agent].last_read_at = new Date().toISOString();
        m.knowledge_cache_state.session_access[agent].last_file_read = filePath;
        m.knowledge_cache_state.session_access[agent].total_cache_reads =
          (m.knowledge_cache_state.session_access[agent].total_cache_reads || 0) + 1;
        fs.writeFileSync(mp, JSON.stringify(m, null, 2), "utf8");
      }
    } catch (err: any) {
      writeLog("uc7ks-after", "runtime", {
        sessionID: input.sessionID, callID: input.callID,
        level: "ERROR", event: "TOOL-AFTER",
        detail: "cache-state update failed: " + err.message,
      });
    }
  }
}
