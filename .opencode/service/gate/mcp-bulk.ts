// service/gate/mcp-bulk.ts — Bulk deliverables review logic
// ═══════════════════════════════════════════════════════════════
// Extracted from scripts/mcp-tools/compliance-gate.ts (handleBulkReviewDeliverables)
// Batch approve/reject up to 50 gate sessions via atomic DB updates.
// ═══════════════════════════════════════════════════════════════

import { writeLog } from "../../lib/log-manager";
import { dbAtomicUpdateGateSession } from "../../lib/db-state-manager";

const SRC = "service-gate-bulk";

export interface BulkReviewResult {
  status: string;
  applied: string[];
  failed: Array<{ session_id: string; reason: string }>;
  total_ms: number;
}

/**
 * Bulk approve or reject multiple gate sessions.
 * Each session is updated atomically via dbAtomicUpdateGateSession.
 * Max 50 sessions per call.
 */
export function bulkReviewDeliverables(
  sessionIds: string[],
  decision: "approve" | "reject",
  executionSummary?: string,
  approvalNote?: string,
): BulkReviewResult {
  const startMs = Date.now();

  // ── Validation ──
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return { status: "rejected", applied: [], failed: [], total_ms: Date.now() - startMs };
  }

  if (sessionIds.length > 50) {
    writeLog(SRC, "WARN", {
      event: "BULK-REVIEW-REJECTED",
      detail: `session_ids length ${sessionIds.length} exceeds max 50`,
    });
    return {
      status: "rejected",
      applied: [],
      failed: sessionIds.map((sid) => ({ session_id: sid, reason: "session_ids length exceeds max 50" })),
      total_ms: Date.now() - startMs,
    };
  }

  if (decision !== "approve" && decision !== "reject") {
    return {
      status: "rejected",
      applied: [],
      failed: sessionIds.map((sid) => ({
        session_id: sid,
        reason: `Invalid decision: "${decision}". Must be "approve" or "reject".`,
      })),
      total_ms: Date.now() - startMs,
    };
  }

  const applied: string[] = [];
  const failed: Array<{ session_id: string; reason: string }> = [];

  for (const sid of sessionIds) {
    try {
      const modifier = (row: any) => {
        if (decision === "approve") {
          return {
            status: executionSummary ? "completed" : "approved",
            consumed_at: Date.now(),
            completed_at: executionSummary ? Date.now() : row.completed_at,
            audit: {
              ...(row.audit || {}),
              approval_note: approvalNote || null,
              execution_summary: executionSummary || null,
              bulk_review: true,
            },
          };
        } else {
          return {
            status: "armed",
            consumed_at: null,
            completed_at: null,
            audit: {
              ...(row.audit || {}),
              rejection_note: approvalNote || null,
              bulk_review: true,
            },
          };
        }
      };

      const result = dbAtomicUpdateGateSession(sid, modifier);

      if (result.ok) {
        applied.push(sid);
        writeLog(SRC, "INFO", {
          event: "BULK-REVIEW-APPLIED",
          detail: `session=${sid} decision=${decision} newVersion=${result.newVersion}`,
        });
      } else {
        failed.push({ session_id: sid, reason: "Update failed (NOT_FOUND or lock exhaustion)" });
        writeLog(SRC, "WARN", {
          event: "BULK-REVIEW-FAILED",
          detail: `session=${sid} decision=${decision} result=${JSON.stringify(result)}`,
        });
      }
    } catch (err: any) {
      failed.push({ session_id: sid, reason: err.message || "Unknown error" });
      writeLog(SRC, "ERROR", {
        event: "BULK-REVIEW-ERROR",
        detail: `session=${sid} error=${err.message}`,
      });
    }
  }

  const totalMs = Date.now() - startMs;
  writeLog(SRC, "INFO", {
    event: "BULK-REVIEW-COMPLETE",
    detail: `decision=${decision} applied=${applied.length} failed=${failed.length} total_ms=${totalMs}`,
  });

  return {
    status: applied.length > 0 ? "ok" : "failed",
    applied,
    failed,
    total_ms: totalMs,
  };
}
