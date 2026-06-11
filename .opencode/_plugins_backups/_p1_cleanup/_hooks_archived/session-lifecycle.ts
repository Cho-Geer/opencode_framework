/**
 * hooks/session-lifecycle.ts — Session Lifecycle Hooks
 * Extracted from framework-enforcer.ts §FW-HARNESS-SESSION-HOOKS (lines ~1371-1560)
 * STATUS: ✅ EXTRACTED — 5 hooks live
 * @since Wave 3.1 (R5) + 3.2 (R5b)
 */
import {
  writeAuditLogEntry, logAuditEntry,
} from "../utils/audit-log";
import { isStaleSession, STATE_PATHS } from "../utils/state-utils";
// Imported at plugin level: readJsonFile, getEnforcementMode
type GateState = Record<string, unknown>;
type ReadJsonFn = <T>(p: string) => T | null;
type ModeFn = () => "advisory" | "strict" | "locked";

export async function sessionCreated(
  input: { sessionID: string }, _output: void,
  _deps?: { readJsonFile?: ReadJsonFn; getEnforcementMode?: ModeFn }
): Promise<void> {
  const sid = input.sessionID;
  writeAuditLogEntry({ event: "session.created", session_id: sid, action: "session_created" });
  logAuditEntry({ event: "silent_audit", detail: "[FW-ENFORCE][AUDIT] Session created: " + sid });
}

export async function sessionError(
  input: { sessionID: string; error: Error }, _output: void
): Promise<void> {
  const { sessionID, error } = input;
  writeAuditLogEntry({ event: "session.error", session_id: sessionID, error_message: error.message, error_stack: error.stack });
  if (error.message && /gate|tamper|integrity/i.test(error.message)) {
    logAuditEntry({ event: "auto_recovery", session_id: sessionID, message: error.message });
  }
}

export async function sessionIdle(
  input: { sessionID: string }, _output: void,
  readJsonFile: ReadJsonFn, getEnforcementMode: ModeFn
): Promise<void> {
  const mode = getEnforcementMode();
  try {
    const gate = readJsonFile<GateState>(STATE_PATHS.gateState());
    if (gate?.sessions) {
      const staleSessions = Object.values(gate.sessions as Record<string,{session_id?:string;confirmed_at?:string|null;consumed_at?:string|null}>).filter(isStaleSession);
      for (const stale of staleSessions) {
        logAuditEntry({ event: "session.idle_drain", session_id: stale.session_id, reason: "idle_timeout" });
        if (mode === "strict" || mode === "locked") {
          logAuditEntry({ event: "stale_session_drain", session_id: stale.session_id });
        }
      }
    }
  } catch {}
  logAuditEntry({ event: "session_idle_audit", session_id: input.sessionID });
}

export async function sessionCompacted(
  input: { sessionID: string }, _output: void
): Promise<void> {
  logAuditEntry({ tool: "session.compacted", sessionID: input.sessionID, action: "compacted" });
  
  // FW-REPAIR-12: Opportunistic state archival on LLM context compaction
  // Non-blocking, best-effort — primary trigger is compliance_gate_complete
  try {
    const { StateCompactor } = require("../../../lib/dist/state-compactor");
    const compactor = new StateCompactor();
    await compactor.onSessionCompacted(input.sessionID);
  } catch {
    // Silently ignore — compiled module may not exist; primary trigger handles it
  }
}

/** Wave 3.2: Inject framework state into LLM compaction context */
export async function sessionCompacting(
  _input: unknown, output: { context: string[]; prompt?: string }
) {
  let g = "unavailable";
  try { const h=JSON.parse(fs.readFileSync(".opencode/state/gate-state.json","utf8")); g=h.meta?.active_count+" active, "+h.meta?.recent_count+" recent"; } catch {}
  output.context.push("## Framework State (injected by framework-enforcer)\n- Active gate sessions: "+g+"\n- Enforcement mode: "+(process.env.ENFORCEMENT_MODE||"advisory"));
}
