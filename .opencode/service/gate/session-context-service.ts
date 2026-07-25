// service/gate/session-context-service.ts — Universal gate session context bridge
// v37: MCP session propagation — replaces process.env.OPENCODE_SESSION_ID
// Blueprint: plans/mcp-session-propagation/blueprint-mcp-session-propagation.md

import * as crypto from "node:crypto";
import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";
import type { GateCallContext } from "./store-types";

const SRC = "service-session-context";

// ── Args Hash (stable JSON serialization) ─────────────────────

export function computeGateArgsHash(args: Record<string, unknown>): string {
  const stable = JSON.stringify(args, Object.keys(args).sort());
  return crypto.createHash("sha256").update(stable).digest("hex");
}

// ── getParentSessionId ───────────────────────────────────────

export function getParentSessionId(sessionId: string): string | null {
  try {
    const db = getDb();
    const row = db
      .query("SELECT parent_id FROM session_map WHERE session_id = ?")
      .get(sessionId) as { parent_id: string } | null;
    return row?.parent_id || null;
  } catch {
    return null;
  }
}

// ── recordGateCallContext ──────────────────────────────────────

export function recordGateCallContext(params: {
  tool_name: string;
  gate_session_id?: string | null;
  opencode_session_id: string;
  parent_session_id?: string | null;
  call_id?: string | null;
  agent?: string | null;
  args_hash: string;
}): number | null {
  try {
    const db = getDb();
    const result = db.run(
      `INSERT INTO gate_call_context
       (tool_name, gate_session_id, opencode_session_id, parent_session_id, call_id, agent, args_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        params.tool_name,
        params.gate_session_id || null,
        params.opencode_session_id,
        params.parent_session_id || null,
        params.call_id || null,
        params.agent || null,
        params.args_hash,
        Date.now(),
      ],
    );

    if (result.changes > 0) {
      const id = db.query("SELECT last_insert_rowid() as id").get() as any;
      writeLog(SRC, "INFO", {
        event: "GATE_CALL_CONTEXT_RECORDED",
        context_id: id.id,
        tool_name: params.tool_name,
        gate_session_id: params.gate_session_id || "—",
        opencode_session_id: params.opencode_session_id,
        call_id: params.call_id || "—",
        agent: params.agent || "—",
        args_hash: params.args_hash,
        detail: "Gate call context recorded in DB",
      });
      return id.id;
    }

    writeLog(SRC, "WARN", {
      event: "GATE_CALL_CONTEXT_RECORD_FAILED",
      tool_name: params.tool_name,
      detail: "No rows inserted",
    });
    return null;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "GATE_CALL_CONTEXT_RECORD_ERROR",
      tool_name: params.tool_name,
      error: err.message,
      detail: `Failed to record gate call context: ${err.message}`,
    });
    return null;
  }
}

// ── backfillGateSessionIdForPendingCall ────────────────────────

export function backfillGateSessionIdForPendingCall(
  context_id: number,
  gate_session_id: string,
): boolean {
  try {
    const db = getDb();
    const result = db.run(
      `UPDATE gate_call_context
       SET gate_session_id = ?
       WHERE id = ? AND status = 'pending' AND gate_session_id IS NULL`,
      [gate_session_id, context_id],
    );

    if (result.changes > 0) {
      writeLog(SRC, "INFO", {
        event: "GATE_CALL_CONTEXT_BACKFILLED",
        context_id,
        gate_session_id,
        detail: "Gate session ID backfilled for pending context",
      });
      return true;
    }

    writeLog(SRC, "INFO", {
      event: "GATE_CALL_CONTEXT_BACKFILL_SKIPPED",
      context_id,
      gate_session_id,
      detail: "Context not found, not pending, or already has gate_session_id",
    });
    return false;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "GATE_CALL_CONTEXT_BACKFILL_ERROR",
      context_id,
      gate_session_id,
      error: err.message,
      detail: `Failed to backfill gate session ID: ${err.message}`,
    });
    return false;
  }
}

// ── completeGateCallContext ────────────────────────────────────

export function completeGateCallContext(context_id: number): boolean {
  try {
    const db = getDb();
    const result = db.run(
      `UPDATE gate_call_context
       SET status = 'completed', completed_at = ?
       WHERE id = ? AND status = 'pending'`,
      [Date.now(), context_id],
    );

    if (result.changes > 0) {
      writeLog(SRC, "INFO", {
        event: "GATE_CALL_CONTEXT_COMPLETED",
        context_id,
        detail: "Gate call context marked as completed",
      });
      return true;
    }

    writeLog(SRC, "INFO", {
      event: "GATE_CALL_CONTEXT_COMPLETE_SKIPPED",
      context_id,
      detail: "Context not found or not pending",
    });
    return false;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "GATE_CALL_CONTEXT_COMPLETE_ERROR",
      context_id,
      error: err.message,
      detail: `Failed to complete gate call context: ${err.message}`,
    });
    return false;
  }
}

// ── completeGateCallContextBySession ──────────────────────────────

export function completeGateCallContextBySession(opencode_session_id: string): number {
  try {
    const db = getDb();
    const result = db.run(
      `UPDATE gate_call_context SET status = 'completed', completed_at = ?
       WHERE opencode_session_id = ? AND status = 'pending' AND completed_at IS NULL`,
      [Date.now(), opencode_session_id],
    );

    if (result.changes > 0) {
      writeLog(SRC, "INFO", {
        event: "GATE_CALL_CONTEXT_COMPLETED_BY_SESSION",
        opencode_session_id,
        completed_count: result.changes,
      });
    }
    return result.changes;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "GATE_CALL_CONTEXT_COMPLETE_BY_SESSION_ERROR",
      opencode_session_id,
      error: err.message,
    });
    return 0;
  }
}

// ── interruptGateCallContextByCallId ───────────────────────────

export function interruptGateCallContextByCallId(call_id: string): number {
  try {
    const db = getDb();
    const result = db.run(
      `UPDATE gate_call_context
       SET status = 'interrupted', interrupted_at = ?
       WHERE call_id = ? AND status = 'pending'`,
      [Date.now(), call_id],
    );

    writeLog(SRC, "INFO", {
      event: "GATE_CALL_CONTEXT_INTERRUPTED_BY_CALLID",
      call_id,
      interrupted_count: result.changes,
      detail: `Interrupted ${result.changes} pending contexts for call_id`,
    });
    return result.changes;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "GATE_CALL_CONTEXT_INTERRUPT_ERROR",
      call_id,
      error: err.message,
      detail: `Failed to interrupt gate call contexts: ${err.message}`,
    });
    return 0;
  }
}

// ── resolveGateCallContextStrict ───────────────────────────────

export function resolveGateCallContextStrict(params: {
  tool_name: string;
  gate_session_id?: string | null;
  args_hash: string;
  opencode_session_id?: string | null;
  call_id?: string | null;
}): GateCallContext | null {
  try {
    const db = getDb();

    // Build WHERE clause based on available parameters
    const conditions: string[] = ["status = 'pending'", "consumed_at IS NULL"];
    const values: any[] = [];

    if (params.tool_name) {
      conditions.push("tool_name = ?");
      values.push(params.tool_name);
    }
    if (params.gate_session_id) {
      conditions.push("gate_session_id = ?");
      values.push(params.gate_session_id);
    }
    if (params.args_hash) {
      conditions.push("args_hash = ?");
      values.push(params.args_hash);
    }
    if (params.opencode_session_id) {
      conditions.push("opencode_session_id = ?");
      values.push(params.opencode_session_id);
    }
    if (params.call_id) {
      conditions.push("call_id = ?");
      values.push(params.call_id);
    }

    // Blueprint §1/§10.5: NO "ORDER BY ... DESC LIMIT 1". Exact match only.
    // call_id is globally unique → at most 1 row when supplied. On 0 or >1 rows
    // (ambiguous) we fail closed and return null — never guess the "most recent".
    const sql = `
      SELECT id, tool_name, gate_session_id, opencode_session_id, parent_session_id,
             call_id, agent, args_hash, status, created_at, completed_at, interrupted_at, consumed_at
      FROM gate_call_context
      WHERE ${conditions.join(" AND ")}
    `;

    const rows = db.query(sql).all(...values) as any[];

    writeLog(SRC, "INFO", {
      event: "GATE_CALL_CONTEXT_RESOLVE_STRICT",
      tool_name: params.tool_name || "—",
      call_id: params.call_id || "—",
      args_hash: params.args_hash || "—",
      matched: rows.length,
      detail: `${rows}`,
    });
    if (rows.length === 0) {
      writeLog(SRC, "WARN", {
        event: "GATE_CALL_CONTEXT_NOT_FOUND",
        tool_name: params.tool_name || "—",
        gate_session_id: params.gate_session_id || "—",
        call_id: params.call_id || "—",
        args_hash: params.args_hash || "—",
        detail: "No pending gate call context found matching criteria (fail closed)",
      });
      return null;
    }
    if (rows.length > 1) {
      writeLog(SRC, "ERROR", {
        event: "GATE_CALL_CONTEXT_AMBIGUOUS",
        tool_name: params.tool_name || "—",
        call_id: params.call_id || "—",
        args_hash: params.args_hash || "—",
        matched: rows.length,
        detail: "Multiple pending rows matched — refusing to guess, fail closed",
      });
      return null;
    }
    const row = rows[0];

    return {
      id: row.id,
      tool_name: row.tool_name,
      gate_session_id: row.gate_session_id,
      opencode_session_id: row.opencode_session_id,
      parent_session_id: row.parent_session_id,
      call_id: row.call_id,
      agent: row.agent,
      args_hash: row.args_hash,
      status: row.status,
      created_at: row.created_at,
      completed_at: row.completed_at,
      interrupted_at: row.interrupted_at,
      consumed_at: row.consumed_at,
    };
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "GATE_CALL_CONTEXT_RESOLVE_ERROR",
      tool_name: params.tool_name,
      error: err.message,
      detail: `Failed to resolve gate call context: ${err.message}`,
    });
    return null;
  }
}

// ── resolveGateCallContextBySession: REMOVED (blueprint §1) ──
// The loose "tool_name + opencode_session_id" fallback (ORDER BY created_at DESC LIMIT 1)
// violated exact-match / fail-closed. Identity is now resolved by call_id (globally
// unique) via resolveGateCallContextStrict, which returns null on 0 or >1 matches.

// ── bindGateParentChildSessions ────────────────────────────────

export function bindGateParentChildSessions(params: {
  gate_session_id: string;
  parent_opencode_session_id: string;
  child_opencode_session_id: string;
  agent?: string | null;
}): boolean {
  try {
    const db = getDb();
    const result = db.run(
      `UPDATE gate_sessions
       SET parent_opencode_session_id = ?,
           child_opencode_session_id = ?,
           agent = COALESCE(?, agent)
       WHERE session_id = ?`,
      [
        params.parent_opencode_session_id,
        params.child_opencode_session_id,
        params.agent || null,
        params.gate_session_id,
      ],
    );

    if (result.changes > 0) {
      writeLog(SRC, "INFO", {
        event: "GATE_SESSION_BINDING_ESTABLISHED",
        gate_session_id: params.gate_session_id,
        parent_opencode_session_id: params.parent_opencode_session_id,
        child_opencode_session_id: params.child_opencode_session_id,
        agent: params.agent || "—",
        detail: "Gate session parent/child binding established",
      });
      return true;
    }

    writeLog(SRC, "WARN", {
      event: "GATE_SESSION_BINDING_FAILED",
      gate_session_id: params.gate_session_id,
      detail: "Gate session not found or update failed",
    });
    return false;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "GATE_SESSION_BINDING_ERROR",
      gate_session_id: params.gate_session_id,
      error: err.message,
      detail: `Failed to bind gate session: ${err.message}`,
    });
    return false;
  }
}

// ── assertSubmitCallerMatchesChild ─────────────────────────────

export function assertSubmitCallerMatchesChild(params: {
  gate_session_id: string;
  caller_opencode_session_id: string;
}): { valid: boolean; reason?: string } {
  try {
    const db = getDb();
    const row = db.query(
      `SELECT child_opencode_session_id FROM gate_sessions WHERE session_id = ?`,
    ).get(params.gate_session_id) as any;

    if (!row) {
      return { valid: false, reason: "Gate session not found" };
    }

    if (!row.child_opencode_session_id) {
      return { valid: false, reason: "Gate session has no child_opencode_session_id binding" };
    }

    if (row.child_opencode_session_id !== params.caller_opencode_session_id) {
      writeLog(SRC, "WARN", {
        event: "SUBMIT_CALLER_MISMATCH",
        gate_session_id: params.gate_session_id,
        caller_session: params.caller_opencode_session_id,
        expected_child: row.child_opencode_session_id,
        detail: "Submit caller does not match bound child session",
      });
      return {
        valid: false,
        reason: `Caller session ${params.caller_opencode_session_id} does not match bound child session ${row.child_opencode_session_id}`,
      };
    }

    return { valid: true };
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "SUBMIT_CALLER_ASSERT_ERROR",
      gate_session_id: params.gate_session_id,
      error: err.message,
      detail: `Failed to assert submit caller: ${err.message}`,
    });
    return { valid: false, reason: `Assertion error: ${err.message}` };
  }
}

// ── assertApproveCallerMatchesParent ───────────────────────────

export function assertApproveCallerMatchesParent(params: {
  gate_session_id: string;
  caller_opencode_session_id: string;
  caller_agent?: string | null;
}): { valid: boolean; reason?: string } {
  try {
    const db = getDb();
    const row = db.query(
      `SELECT parent_opencode_session_id FROM gate_sessions WHERE session_id = ?`,
    ).get(params.gate_session_id) as any;

    if (!row) {
      return { valid: false, reason: "Gate session not found" };
    }

    if (!row.parent_opencode_session_id) {
      return { valid: false, reason: "Gate session has no parent_opencode_session_id binding" };
    }

    // Check agent privilege (Orchestrator or Super-Admin)
    const privilegedAgents = ["Orchestrator", "Super-Admin"];
    const isPrivileged = params.caller_agent && privilegedAgents.includes(params.caller_agent);

    if (!isPrivileged) {
      writeLog(SRC, "WARN", {
        event: "APPROVE_CALLER_NOT_PRIVILEGED",
        gate_session_id: params.gate_session_id,
        caller_agent: params.caller_agent || "—",
        detail: "Approve caller is not a privileged agent",
      });
      return { valid: false, reason: "Approve caller is not a privileged agent (Orchestrator or Super-Admin)" };
    }

    if (row.parent_opencode_session_id !== params.caller_opencode_session_id) {
      writeLog(SRC, "WARN", {
        event: "APPROVE_CALLER_MISMATCH",
        gate_session_id: params.gate_session_id,
        caller_session: params.caller_opencode_session_id,
        expected_parent: row.parent_opencode_session_id,
        detail: "Approve caller does not match bound parent session",
      });
      return {
        valid: false,
        reason: `Caller session ${params.caller_opencode_session_id} does not match bound parent session ${row.parent_opencode_session_id}`,
      };
    }

    return { valid: true };
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "APPROVE_CALLER_ASSERT_ERROR",
      gate_session_id: params.gate_session_id,
      error: err.message,
      detail: `Failed to assert approve caller: ${err.message}`,
    });
    return { valid: false, reason: `Assertion error: ${err.message}` };
  }
}

// ── assertCompleteCallerMatchesChild ───────────────────────────

export function assertCompleteCallerMatchesChild(params: {
  gate_session_id: string;
  caller_opencode_session_id: string;
}): { valid: boolean; reason?: string } {
  // Same logic as submit
  return assertSubmitCallerMatchesChild(params);
}

// ── markGateInterrupted ────────────────────────────────────────

export function markGateInterrupted(params: {
  gate_session_id: string;
  interruption_source: string;
}): boolean {
  try {
    const db = getDb();
    const result = db.run(
      `UPDATE gate_sessions
       SET interrupted_at = ?, interruption_source = ?
       WHERE session_id = ?`,
      [Date.now(), params.interruption_source, params.gate_session_id],
    );

    if (result.changes > 0) {
      writeLog(SRC, "INFO", {
        event: "GATE_SESSION_INTERRUPTED",
        gate_session_id: params.gate_session_id,
        interruption_source: params.interruption_source,
        detail: "Gate session marked as interrupted",
      });
      return true;
    }

    writeLog(SRC, "WARN", {
      event: "GATE_SESSION_INTERRUPT_SKIPPED",
      gate_session_id: params.gate_session_id,
      detail: "Gate session not found",
    });
    return false;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "GATE_SESSION_INTERRUPT_ERROR",
      gate_session_id: params.gate_session_id,
      error: err.message,
      detail: `Failed to mark gate interrupted: ${err.message}`,
    });
    return false;
  }
}

// ── handleGateSessionInterrupted ───────────────────────────────

export function handleGateSessionInterrupted(sessionID: string, reason: string): void {
  try {
    const db = getDb();

    // 1. Interrupt all pending gate_call_context for this session
    const contextResult = db.run(
      `UPDATE gate_call_context
       SET status = 'interrupted', interrupted_at = ?
       WHERE opencode_session_id = ? AND status = 'pending'`,
      [Date.now(), sessionID],
    );

    writeLog(SRC, "INFO", {
      event: "GATE_SESSION_INTERRUPT_CONTEXTS",
      session_id: sessionID,
      interrupted_count: contextResult.changes,
      reason,
      detail: `Interrupted ${contextResult.changes} pending contexts for session`,
    });

    // 2. Mark gate_sessions where this is parent or child
    const gateResult = db.run(
      `UPDATE gate_sessions
       SET interrupted_at = ?, interruption_source = ?
       WHERE parent_opencode_session_id = ? OR child_opencode_session_id = ?`,
      [Date.now(), reason, sessionID, sessionID],
    );

    writeLog(SRC, "INFO", {
      event: "GATE_SESSION_INTERRUPT_GATES",
      session_id: sessionID,
      interrupted_count: gateResult.changes,
      reason,
      detail: `Interrupted ${gateResult.changes} gate sessions for session`,
    });
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "GATE_SESSION_INTERRUPT_ERROR",
      session_id: sessionID,
      error: err.message,
      detail: `Failed to handle gate session interrupt: ${err.message}`,
    });
  }
}

// ── updateSubmitApproveSessionId ───────────────────────────────

export function updateLastSubmitSessionId(params: {
  gate_session_id: string;
  submit_session_id: string;
}): boolean {
  try {
    const db = getDb();
    const result = db.run(
      `UPDATE gate_sessions
       SET last_submit_session_id = ?
       WHERE session_id = ?`,
      [params.submit_session_id, params.gate_session_id],
    );

    return result.changes > 0;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "UPDATE_LAST_SUBMIT_ERROR",
      error: err.message,
    });
    return false;
  }
}

export function updateLastApproveSessionId(params: {
  gate_session_id: string;
  approve_session_id: string;
}): boolean {
  try {
    const db = getDb();
    const result = db.run(
      `UPDATE gate_sessions
       SET last_approve_session_id = ?
       WHERE session_id = ?`,
      [params.approve_session_id, params.gate_session_id],
    );

    return result.changes > 0;
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "UPDATE_LAST_APPROVE_ERROR",
      error: err.message,
    });
    return false;
  }
}

export { SRC };
