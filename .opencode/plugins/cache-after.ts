// cache-after.ts — "tool.execute.after" plugin: knowledge cache sync
// KC-08 (2026-06-21): Extended to handle BOTH reads (index.json monitoring)
// AND writes (detecting KC external fetches → total_external_fetches).
//
// Architecture:
//   - READ path: index.json access → sync cache_status, count cache_checks
//   - WRITE path: docs/official_docs/ writes → count external_fetches
//   - All audit counter updates are non-fatal (inner try-catch per counter)
import * as fs from "node:fs";
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { isLocalCacheAvailable } from "../lib/uc7ks-utils";
import { atomicWriteSubState } from "../lib/state-utils";
import { incrementAuditCounter, touchCacheCheck } from "../lib/knowledge-audit";

const INDEX_PATH = "docs/official_docs/index.json";
const DOCS_DIR = "docs/official_docs/";

export default withPluginLifecycle("cache-after", {
  "tool.execute.after": toolExecuteAfter,
});

async function toolExecuteAfter(input: any, output: any): Promise<void> {
  const filePath = (input.args as any)?.filePath || "";

  // ── KC-08 (2026-06-21): WRITE PATH — detect external doc fetches ──
  // When any tool writes to docs/official_docs/ (e.g., KC's webfetch/context7
  // results being saved by safe_edit/write tools), count as external fetch.
  if (
    filePath &&
    filePath.includes(DOCS_DIR) &&
    !filePath.includes(INDEX_PATH)
  ) {
    const writeTools = ["write", "edit", "safe_edit", "safe_shell"];
    if (writeTools.indexOf(input.tool) !== -1) {
      writeLog("cache-after", "runtime", {
        sessionID: input.sessionID,
        callID: input.callID,
        event: "TOOL-AFTER",
        detail: `external-fetch-write | tool=${input.tool} | file=${filePath}`,
      });
      // Non-fatal: count external fetches
      try {
        incrementAuditCounter("total_external_fetches");
      } catch {}
      // Also count as a cache check (writes imply cache update)
      try {
        incrementAuditCounter("total_cache_checks");
      } catch {}
      try {
        touchCacheCheck();
      } catch {}
      return;
    }
  }

  // ── READ PATH: monitor index.json reads ──
  if (input.tool !== "read") return;
  if (!filePath.includes(INDEX_PATH)) return;

  const cacheAvail = isLocalCacheAvailable();

  writeLog("cache-after", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
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
      sessionID: input.sessionID,
      callID: input.callID,
      level: "ERROR",
      event: "TOOL-AFTER",
      detail: "cache-sync failed: " + err.message,
    });
  }

  // KC-02 (2026-06-21): Non-fatal audit rollup — count cache checks
  try {
    incrementAuditCounter("total_cache_checks");
  } catch {}
  try {
    touchCacheCheck();
  } catch {}
}
