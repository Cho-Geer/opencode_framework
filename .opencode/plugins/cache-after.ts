// cache-after.ts — "tool.execute.after" plugin: knowledge cache sync
import * as fs from "node:fs";
import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { isLocalCacheAvailable } from "../lib/uc7ks-utils";
import { STATE_PATHS } from "../lib/state-utils";

ensureLogDir();
writeLog("cache-after", "loaded", { event: "PLUGIN-LOADED", detail: "cache-after.ts" });
updateIndex("cache-after", "PLUGIN-LOADED");

const INDEX_PATH = "docs/official_docs/index.json";

export default (async (_ctx: any) => {
  writeLog("cache-after", "hooks", { event: "HOOK-REGISTERED", detail: "tool.execute.after" });
  return { "tool.execute.after": toolExecuteAfter };
}) as any;

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

  // Sync cache status to machine.json
  try {
    const mp = STATE_PATHS.machine();
    if (!fs.existsSync(mp)) return;
    const m = JSON.parse(fs.readFileSync(mp, "utf8"));
    m.knowledge_cache_state = m.knowledge_cache_state || {};
    m.knowledge_cache_state.cache_status = cacheAvail ? "healthy" : "degraded";
    m.knowledge_cache_state.last_index_check = new Date().toISOString();

    if (cacheAvail) {
      try {
        const idx = JSON.parse(fs.readFileSync(filePath, "utf8"));
        m.knowledge_cache_state.total_entries = idx.total_entries || 0;
      } catch {}
    }

    fs.writeFileSync(mp, JSON.stringify(m, null, 2), "utf8");
  } catch (err: any) {
    writeLog("cache-after", "runtime", {
      sessionID: input.sessionID, callID: input.callID,
      level: "ERROR", event: "TOOL-AFTER",
      detail: "cache-sync failed: " + err.message,
    });
  }
}
