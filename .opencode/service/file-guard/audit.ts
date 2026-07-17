// service/file-guard/audit.ts — Write audit check + audit log

import { writeLog } from "../../lib/log-manager";
import { dbWriteAuditLogEntry } from "../../lib/db-state-manager";

const SRC = "service-audit";

// ── Audit Log (from audit-log.ts) ──────────────────────────────

export function writeAuditLogEntry(entry: Record<string, unknown>): void {
  try {
    dbWriteAuditLogEntry({
      session_id: (entry.sessionID as string) || undefined,
      agent: (entry.agent as string) || undefined,
      event_type: (entry.event as string) || (entry.eventType as string) || "audit",
      detail: entry,
      timestamp: entry.timestamp ? Date.parse(entry.timestamp as string) : Date.now(),
    });
  } catch { /* DB write failed */ }
}

// ── Write Audit Trail (from audit-after hook) ─────────────────
// Records each file modification to write_audit_state history.
// Called by audit-after plugin after safe_edit/safe_delete/safe_shell.

export function recordWriteAudit(params: {
  sessionID: string;
  callID: string;
  tool: string;
  filePath: string;
}): void {
  let agent = "unknown";
  try {
    const { resolveAgent } = require("../../lib/agent-resolver");
    agent = resolveAgent(params.sessionID);
  } catch {}

  writeLog("audit-after", "runtime", {
    sessionID: params.sessionID,
    callID: params.callID,
    agent,
    event: "TOOL-AFTER",
    detail: `audit-track | tool=${params.tool} | file=${params.filePath}`,
  });

  try {
    const { atomicWriteSubState } = require("../../lib/state-utils");
    atomicWriteSubState("write_audit_state", (state: any) => {
      state.enabled = state.enabled ?? true;
      state.current_session = state.current_session ?? null;
      state.history = state.history ?? [];
      state.history.push({
        file: params.filePath,
        tool: params.tool,
        agent,
        sessionID: params.sessionID,
        timestamp: new Date().toISOString(),
      });
      if (state.history.length > 200) {
        state.history = state.history.slice(-200);
      }
    });
  } catch (err: any) {
    writeLog("audit-after", "runtime", {
      sessionID: params.sessionID,
      callID: params.callID,
      agent,
      level: "ERROR",
      event: "TOOL-AFTER",
      detail: "audit-state update failed: " + err.message,
    });
  }
}
