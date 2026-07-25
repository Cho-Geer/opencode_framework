// service/dispatch/auto-cleanup.ts — Auto-dispatch marker cleanup
// Source: dispatch-auto.ts plugin
// Handles: DB lease reclaim only (file queues removed in DB-canonical migration).

import { writeLog } from "../../lib/log-manager";
import { dbCleanStaleLeases } from "../../lib/dispatch-db";

/**
 * Reclaim stale dispatch leases.
 * Called by dispatch-auto plugin after every tool execution.
 *
 * DB-canonical: only DB lease reclaim needed. File queue cleanup removed.
 */
export function reclaimAutoDispatch(params: {
  sessionID: string;
  callID: string;
}): void {
  // ── DB-canonical dispatch — reclaim stale DB leases ──
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
}
