// service/session/compliance-audit.ts — Compliance audit for chat.message hook
// Extracted from plugins/session.ts (Batch 2)
// Encapsulates gate-armed + knowledge-attested compliance checks

import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";
import { isSuperAdmin } from "../../lib/agent-identity";
import { readSubState } from "../../lib/substate-manager";
import { getEnforcementMode } from "../../lib/gate-core";

const SRC = "service-session-compliance";

/**
 * Run FW-COMPLIANCE-AUDIT checks (audit-only, cannot physically block).
 * Called from session.ts chat.message hook.
 *
 * Checks:
 *   1. Gate session armed (gate_sessions with status='armed')
 *   2. Knowledge cache attested (knowledge_cache_state.status='attested')
 */
export function runComplianceAudit(sessionID: string, agent: string): void {
  const mode = getEnforcementMode();
  const isSA = isSuperAdmin(agent);

  if ((mode !== "strict" && mode !== "locked") || isSA || !sessionID) return;

  // Check 1: Gate session armed
  try {
    const db = getDb();
    if (db) {
      const armed = db
        .query("SELECT COUNT(*) AS c FROM gate_sessions WHERE status = ?")
        .get("armed") as { c: number } | null;
      const gateArmed = (armed?.c || 0) > 0;

      if (!gateArmed) {
        writeLog(SRC, "WARN", {
          sessionID, agent, event: "GATE-NOT-ARMED",
          detail: "No armed gate session — agent may have skipped compliance_gate_check",
        });
      }
    }
  } catch {
    /* non-fatal */
  }

  // Check 2: Knowledge cache attested
  try {
    const kcs = readSubState("knowledge_cache_state");
    const kcsAttested = kcs?.status === "attested";

    if (!kcsAttested) {
      writeLog(SRC, "WARN", {
        sessionID, agent, event: "KNOWLEDGE-NOT-ATTESTED",
        detail: "knowledge_cache_state not attested — agent may have skipped UC7-001",
      });
    }
  } catch {
    /* non-fatal */
  }
}
