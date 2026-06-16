// cache-after.ts — "tool.execute.after" plugin: knowledge cache sync
import * as fs from "node:fs";
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { isLocalCacheAvailable } from "../lib/uc7ks-utils";
import { atomicWriteSubState } from "../lib/state-utils";

const INDEX_PATH = "docs/official_docs/index.json";

export default withPluginLifecycle("cache-after", { "tool.execute.after": toolExecuteAfter });

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  // Only fire after reads of the knowledge cache index
  if (input.tool !== "read") return;
  const filePath = (input.args as any)?.filePath || "";
  if (!filePath.includes(INDEX_PATH)) return;

  const cacheAvail = isLocalCacheAvailable();

  writeLog("cache-after", "runtime", {
    sessionID: input.sessionID, callID: input.callID,
    event: "TOOL-AFTER",
    detail: `cache-check | available=${cacheAvail}`,
  });

  // Sync cache status to knowledge-cache-state.json (P1-B split)
  try {
    atomicWriteSubState("knowledge_cache_state", (state) => {
      state.cache_status = cacheAvail ? "healthy" : "degraded";
      state.last_index_check = new Date().toISOString();

      if (cacheAvail) {
        try {
          const idx = JSON.parse(fs.readFileSync(filePath, "utf8"));
          state.total_entries = idx.total_entries || 0;
        } catch {}
      }
    });
  } catch (err: any) {
    writeLog("cache-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID,
      level: "ERROR", event: "TOOL-AFTER",
      detail: "cache-sync failed: " + err.message,
    });
  }
}
