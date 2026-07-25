// service/knowledge/cache-sync.ts — Knowledge cache state synchronization
// Source: cache-after.ts plugin
// Monitors index.json reads and docs/ writes, syncs cache state and audit counters.

import * as fs from "node:fs";
import { writeLog } from "../../lib/log-manager";
import { isLocalCacheAvailable } from "../../lib/uc7ks-utils";
import { atomicWriteSubState } from "../../lib/state-utils";
import { incrementAuditCounter, touchCacheCheck } from "../../lib/knowledge-audit";

const SRC = "service-cache-sync";
const INDEX_PATH = "docs/official_docs/index.json";
const DOCS_DIR = "docs/official_docs/";

/**
 * Sync cache state after tool execution.
 * Handles two paths:
 *   WRITE path: docs/official_docs/ writes → count external fetches
 *   READ path: index.json reads → sync cache_status, count cache checks
 *
 * Called by cache-after plugin.
 */
export function syncCacheState(params: {
  sessionID: string;
  callID: string;
  tool: string;
  filePath: string;
}): void {
  const filePath = params.filePath || "";

  // ── WRITE PATH: detect external doc fetches ──
  if (
    filePath &&
    filePath.includes(DOCS_DIR) &&
    !filePath.includes(INDEX_PATH)
  ) {
    const writeTools = ["write", "edit", "safe_edit", "safe_shell"];
    if (writeTools.indexOf(params.tool) !== -1) {
      writeLog("cache-after", "runtime", {
        sessionID: params.sessionID,
        callID: params.callID,
        event: "TOOL-AFTER",
        detail: `external-fetch-write | tool=${params.tool} | file=${filePath}`,
      });
      try { incrementAuditCounter("total_external_fetches"); } catch {}
      try { incrementAuditCounter("total_cache_checks"); } catch {}
      try { touchCacheCheck(); } catch {}
      return;
    }
  }

  // ── READ PATH: monitor index.json reads ──
  if (params.tool !== "read") return;
  if (!filePath.includes(INDEX_PATH)) return;

  const cacheAvail = isLocalCacheAvailable();

  writeLog("cache-after", "runtime", {
    sessionID: params.sessionID,
    callID: params.callID,
    event: "TOOL-AFTER",
    detail: `cache-check | available=${cacheAvail}`,
  });

  // Sync cache status to knowledge_cache_state substate
  try {
    atomicWriteSubState("knowledge_cache_state", (state: any) => {
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
      sessionID: params.sessionID,
      callID: params.callID,
      level: "ERROR",
      event: "TOOL-AFTER",
      detail: "cache-sync failed: " + err.message,
    });
  }

  // Non-fatal audit rollup
  try { incrementAuditCounter("total_cache_checks"); } catch {}
  try { touchCacheCheck(); } catch {}
}
