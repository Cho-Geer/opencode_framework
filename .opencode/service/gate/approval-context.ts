// service/gate/approval-context.ts — Session-bound approval context bridge
// Source: approval-read-context.ts (imports updated for service/gate/ location)

import * as crypto from "node:crypto";
import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";

const SRC = "service-approval-read-context";

// ── Canonical Builder (GA-D-G3, 2026-06-27) ─────────────────────

/**
 * Build a canonical args hash input that normalizes the key name
 * difference between gate-before.ts (uses `session_id`) and
 * compliance-gate.ts (uses `gate_session_id`).
 */
export function buildApprovalArgsHashInput(args: {
  gate_session_id?: string;
  session_id?: string;
  approval_decision?: string;
  handover_sha256?: string;
  agent_id?: string;
}): Record<string, string> {
  return {
    gate_session_id: args.gate_session_id || args.session_id || "",
    approval_decision: args.approval_decision || "reject",
    handover_sha256: args.handover_sha256 || "",
    agent_id: args.agent_id || "",
  };
}

// ── Types ──────────────────────────────────────────────────────

export interface ApprovalReadContext {
  id: number;
  gate_session_id: string;
  opencode_session_id: string;
  call_id: string | null;
  agent: string | null;
  tool_name: string;
  args_hash: string;
  created_at: number;
  consumed_at: number | null;
}

// ── Args Hash (stable JSON serialization) ─────────────────────

export function computeApprovalArgsHash(args: Record<string, unknown>): string {
  const stable = JSON.stringify(args, Object.keys(args).sort());
  return crypto.createHash("sha256").update(stable).digest("hex");
}

// ── recordApprovalContext ──────────────────────────────────────

export function recordApprovalContext(
  gate_session_id: string,
  opencode_session_id: string,
  call_id: string | null,
  agent: string | null,
  args_hash: string,
): boolean {
  try {
    const db = getDb();
    const result = db.run(
      `INSERT OR IGNORE INTO approval_read_context
       (gate_session_id, opencode_session_id, call_id, agent, tool_name, args_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        gate_session_id,
        opencode_session_id,
        call_id || null,
        agent || null,
        "compliance-gate_compliance_gate_approve_deliverables",
        args_hash,
        Date.now(),
      ],
    );

    if (result.changes > 0) {
      writeLog(SRC, "INFO", {
        event: "APPROVAL_READ_CONTEXT_RECORDED",
        gate_session_id,
        opencode_session_id,
        call_id: call_id || "—",
        agent: agent || "—",
        args_hash,
        detail: "Approval read context recorded in DB",
      });
      return true;
    }

    writeLog(SRC, "INFO", {
      event: "APPROVAL_READ_CONTEXT_DUPLICATE",
      gate_session_id,
      args_hash,
      detail:
        "Duplicate approval context — already recorded (idempotent guard)",
    });
    return false;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "APPROVAL_READ_CONTEXT_RECORD_FAILED",
      gate_session_id,
      error: err.message,
      detail: `Failed to record approval context: ${err.message}`,
    });
    return false;
  }
}

// ── getApprovalContext ────────────────────────────────────────

export function getApprovalContext(
  gate_session_id: string,
  args_hash: string,
): ApprovalReadContext | null {
  try {
    const db = getDb();
    const row = db
      .query(
        `SELECT id, gate_session_id, opencode_session_id, call_id, agent,
                tool_name, args_hash, created_at, consumed_at
         FROM approval_read_context
         WHERE gate_session_id = ? AND args_hash = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(gate_session_id, args_hash) as Record<string, unknown> | null;

    if (!row) {
      writeLog(SRC, "INFO", {
        event: "APPROVAL_READ_CONTEXT_MISSING",
        gate_session_id,
        args_hash,
        detail: "No approval context found for this gate session + args hash",
      });
      return null;
    }

    if (row.consumed_at != null) {
      writeLog(SRC, "INFO", {
        event: "APPROVAL_READ_CONTEXT_ALREADY_CONSUMED",
        gate_session_id,
        args_hash,
        consumed_at: row.consumed_at as string | number,
        detail: "Approval context already consumed — cannot reuse",
      });
      return null;
    }

    return {
      id: row.id as number,
      gate_session_id: row.gate_session_id as string,
      opencode_session_id: row.opencode_session_id as string,
      call_id: row.call_id as string | null,
      agent: row.agent as string | null,
      tool_name: row.tool_name as string,
      args_hash: row.args_hash as string,
      created_at: row.created_at as number,
      consumed_at: null,
    };
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "APPROVAL_READ_CONTEXT_LOOKUP_FAILED",
      gate_session_id,
      error: err.message,
      detail: `Failed to lookup approval context: ${err.message}`,
    });
    return null;
  }
}

// ── markApprovalContextConsumed ─────────────────────────────────

export function markApprovalContextConsumed(
  gate_session_id: string,
  args_hash: string,
): boolean {
  try {
    const db = getDb();
    const result = db.run(
      `UPDATE approval_read_context
       SET consumed_at = ?
       WHERE gate_session_id = ? AND args_hash = ? AND consumed_at IS NULL`,
      [Date.now(), gate_session_id, args_hash],
    );

    if (result.changes > 0) {
      writeLog(SRC, "INFO", {
        event: "APPROVAL_READ_CONTEXT_CONSUMED",
        gate_session_id,
        args_hash,
        detail: "Approval context marked as consumed",
      });
      return true;
    }

    writeLog(SRC, "INFO", {
      event: "APPROVAL_READ_CONTEXT_CONSUME_SKIPPED",
      gate_session_id,
      args_hash,
      detail: "Context not found or already consumed",
    });
    return false;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "APPROVAL_READ_CONTEXT_CONSUME_FAILED",
      gate_session_id,
      error: err.message,
      detail: `Failed to mark context as consumed: ${err.message}`,
    });
    return false;
  }
}

export { SRC };
