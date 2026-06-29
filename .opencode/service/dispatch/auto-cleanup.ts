// service/dispatch/auto-cleanup.ts — Auto-dispatch marker cleanup
// Source: dispatch-auto.ts plugin
// Handles: DB lease reclaim + queue/legacy marker cleanup.

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { atomicWriteJson } from "../../lib/state-utils";
import { dbCleanStaleLeases } from "../../lib/dispatch-db";

const SRC = "service-dispatch-auto-cleanup";
const QUEUE_NAME = ".auto-dispatch.json";
const LEGACY_NAME = ".auto-dispatch";
const MAX_AGE_MS = 300_000; // 5 minutes

/**
 * Reclaim stale dispatch leases and clean up auto-dispatch markers.
 * Called by dispatch-auto plugin after every tool execution.
 *
 * Steps:
 *   1. DB lease reclaim (dbCleanStaleLeases)
 *   2. Queue marker cleanup (.auto-dispatch.json)
 *   3. Legacy marker cleanup (.auto-dispatch)
 */
export function reclaimAutoDispatch(params: {
  sessionID: string;
  callID: string;
}): void {
  const root = process.env.OPENCODE_ROOT || process.cwd();
  const queuePath = path.join(root, ".task_temp", "_dispatch", QUEUE_NAME);
  const legacyPath = path.join(root, ".task_temp", "_dispatch", LEGACY_NAME);

  // ── A7: DB-canonical dispatch — reclaim stale DB leases ──
  try {
    const reclaimed = dbCleanStaleLeases();
    if (reclaimed > 0) {
      writeLog("dispatch-auto", "runtime", {
        sessionID: params.sessionID,
        callID: params.callID,
        event: "DISPATCH-QUEUE-LEASE-RECLAIMED",
        detail: `Reclaimed ${reclaimed} stale DB dispatch leases`,
      });
    }
  } catch {
    /* DB cleanup is best-effort */
  }

  // ── Queue-based marker (.auto-dispatch.json) ──
  if (fs.existsSync(queuePath)) {
    try {
      const raw = fs.readFileSync(queuePath, "utf8");
      let queue = JSON.parse(raw);
      if (!Array.isArray(queue)) {
        queue = [queue];
      }

      const now = Date.now();
      const fresh: any[] = [];
      let staleCount = 0;

      for (const entry of queue) {
        if (entry.createdAt && now - entry.createdAt > MAX_AGE_MS) {
          staleCount++;
        } else {
          fresh.push(entry);
        }
      }

      if (staleCount > 0) {
        writeLog("dispatch-auto", "runtime", {
          sessionID: params.sessionID,
          callID: params.callID,
          level: "WARN",
          event: "AUTO-DISPATCH-STALE-CLEANUP",
          detail: `Removed ${staleCount} stale entries, ${fresh.length} remain`,
        });
        if (fresh.length > 0) {
          atomicWriteJson(queuePath, fresh);
        } else {
          try { fs.unlinkSync(queuePath); } catch {}
        }
      }
      return;
    } catch {
      try { fs.unlinkSync(queuePath); } catch {}
      return;
    }
  }

  // ── Legacy single-entry marker (.auto-dispatch) ──
  if (!fs.existsSync(legacyPath)) return;

  let createdAt = 0;
  try {
    const raw = fs.readFileSync(legacyPath, "utf8");
    const entry = JSON.parse(raw);
    createdAt = entry.createdAt || 0;
  } catch {
    /* malformed — ignore */
  }

  if (createdAt && Date.now() - createdAt > MAX_AGE_MS) {
    writeLog("dispatch-auto", "runtime", {
      sessionID: params.sessionID,
      callID: params.callID,
      level: "WARN",
      event: "AUTO-DISPATCH-STALE",
      detail: `Legacy .auto-dispatch marker aged ${Math.round((Date.now() - createdAt) / 1000)}s — auto-cleaning`,
    });
    try { fs.unlinkSync(legacyPath); } catch {}
  }
}
