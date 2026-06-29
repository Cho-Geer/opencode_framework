// service/gate/drain.ts — Stale session drain (atomic DB transaction)
// Source: gate-core.ts (drainStaleSessions)

import { getDb } from "../../lib/db-manager";
import {
  loadGateStore,
  saveGateStore,
  writeLogSafe,
  type GateStore,
} from "./store";

const SRC = "service-gate-drain";

/**
 * Drain stale sessions with configurable thresholds.
 * Uses atomic DB transaction for archive + status update.
 */
export function drainStaleSessions(
  armedHours = 24,
  checkedHours = 48,
  root?: string,
): {
  purged: number;
  drained_sessions: string[];
  remaining_active: number;
  remaining_total: number;
  drained_armed: number;
  drained_checked: number;
  drained_delivered: number;
} {
  const store = loadGateStore(root);

  const nowTs = Date.now();
  let drainedArmed = 0;
  let drainedChecked = 0;
  let drainedDelivered = 0;
  const drainedIds: string[] = [];

  // Phase 1: Collect sessions to drain (no DB writes yet)
  const toDrain: Array<{
    sid: string;
    ses: any;
    reason: string;
    drainType: string;
  }> = [];

  for (const sid of Object.keys(store.sessions)) {
    const ses = store.sessions[sid];
    if (!ses) continue;

    let shouldDrain = false;
    let reason = "";
    let drainType = "";

    // Armed drain: covers both normal timeout and interrupt orphans
    if (ses.gate_status === "armed" && !ses.consumed_at) {
      const refTime = ses.confirmed_at || ses.created_at;
      const age = nowTs - new Date(refTime).getTime();
      if (age > armedHours * 3600000) {
        shouldDrain = true;
        drainType = "STALE_ARMED";
        reason = `armed for ${Math.floor(age / 3600000)}h without completion (threshold: ${armedHours}h)${!ses.confirmed_at ? " [orphan: no confirmed_at]" : ""}`;
      }
    }

    if (ses.gate_status === "checked" && !ses.confirmed_at) {
      const age = nowTs - new Date(ses.created_at).getTime();
      if (age > checkedHours * 3600000) {
        shouldDrain = true;
        drainType = "STALE_CHECKED";
        reason = `checked for ${Math.floor(age / 3600000)}h without confirmation (threshold: ${checkedHours}h)`;
      }
    }

    // Delivered/Approved state: drain after 4 hours without Orchestrator review
    if (
      (ses.gate_status === "delivered" || ses.gate_status === "approved") &&
      ses.submitted_deliverables
    ) {
      const submittedAt = ses.submitted_deliverables[0]?.submitted_at;
      if (submittedAt) {
        const age = nowTs - new Date(submittedAt).getTime();
        if (age > 4 * 3600000) {
          shouldDrain = true;
          drainType = "STALE_DELIVERED";
          reason = `delivered for ${Math.floor(age / 3600000)}h without Orchestrator approval (threshold: 4h)`;
        }
      }
    }

    if (shouldDrain) {
      toDrain.push({ sid, ses, reason, drainType });
    }
  }

  // Phase 2: Single DB transaction — archive + status update
  if (toDrain.length > 0) {
    try {
      const db = getDb();
      const txn = db.transaction(() => {
        for (const { sid, ses, reason, drainType } of toDrain) {
          db.run(
            `INSERT INTO gate_audit_history (session_id, task_desc, reason, drain_type, snapshot, archived_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              sid,
              ses.task_description || "",
              reason,
              drainType,
              JSON.stringify(ses),
              Date.now(),
            ],
          );
          db.run(
            `UPDATE gate_sessions SET status = 'drained', updated_at = ? WHERE session_id = ?`,
            [Date.now(), sid],
          );
        }
      });
      txn();

      // Phase 3: Clean in-memory store (only after DB transaction succeeds)
      for (const { sid, drainType } of toDrain) {
        delete store.sessions[sid];
        drainedIds.push(sid);
        if (drainType === "STALE_ARMED") drainedArmed++;
        if (drainType === "STALE_CHECKED") drainedChecked++;
        if (drainType === "STALE_DELIVERED") drainedDelivered++;
      }

      store.active_sessions = store.active_sessions.filter(
        (a: string) => !drainedIds.includes(a),
      );
      store.last_updated = new Date().toISOString();
      saveGateStore(store, root);

      writeLogSafe(SRC, "INFO", {
        event: "DRAIN-STALE-ATOMIC",
        detail: `Drained ${toDrain.length} sessions (armed=${drainedArmed}, checked=${drainedChecked}, delivered=${drainedDelivered}) in single transaction`,
      });
    } catch (e: any) {
      writeLogSafe(SRC, "ERROR", {
        event: "DRAIN-STALE-TRANSACTION-FAILED",
        detail: `Transaction rollback: ${e.message}. No sessions were drained.`,
      });
    }
  }

  const purged = drainedIds.length;
  return {
    purged,
    drained_sessions: drainedIds,
    drained_armed: drainedArmed,
    drained_checked: drainedChecked,
    drained_delivered: drainedDelivered,
    remaining_active: store.active_sessions.length,
    remaining_total: Object.keys(store.sessions).length,
  };
}
