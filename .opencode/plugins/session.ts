// session.ts — Plugin: session management + chat.message hook
// ═══════════════════════════════════════════════════════════════
// Slimmed to pure Middleware: delegates all business logic to
// service/session/. Only orchestration + compliance audit remain.
//
// Hook events:
//   - chat.message:     Track session → agent mapping
//   - session.error:    Detect cooperative interrupts; write sentinel
//   - session.compacted: Reset in-memory session map after compaction
//   - session.idle:     Clear interrupt sentinel when session idles
//
// @version 3.1.0  Phase 2: Compliance audit delegated to service/session
// ═══════════════════════════════════════════════════════════════

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import {
  runStartupCleanup,
  resetConfigReadPerRound,
  writeSessionMapWithConstraint,
  runPreflightAutoMark,
  handleSessionError,
  handleSessionCompacted,
  handleSessionIdle,
  updateMemorySessionMap,
  getMemorySessionMapSize,
  runComplianceAudit,
} from "../service/session";

export default withPluginLifecycle("session", {
  "chat.message": chatMessageHook,
  "session.error": handleSessionError,
  "session.compacted": handleSessionCompacted,
  "session.idle": handleSessionIdle,
});

// ═══════════════════════════════════════════════════════════════
// chat.message hook — orchestration only, all logic in Service
// ═══════════════════════════════════════════════════════════════

async function chatMessageHook(input: any, _output: any) {
  const agent = input.agent || "";
  const sid = input.sessionID || "";

  writeLog("session", "runtime", {
    sessionID: sid, agent, event: "CHAT-HOOK", detail: "enter",
  });

  if (!sid || !agent) {
    writeLog("session", "runtime", {
      sessionID: sid, agent, event: "CHAT-HOOK", detail: "exit (no sid/agent)",
    });
    return;
  }

  writeLog("session", "INFO", {
    sessionID: sid, agent, event: "ROUND-START",
    detail: "new conversation round detected",
  });

  // Step 1-9: Startup cleanup
  try {
    runStartupCleanup(sid, agent);
  } catch {
    /* startup cleanup must never block chat.message hook */
  }

  // Step 10: Config read attestation reset (strict/locked only)
  try {
    resetConfigReadPerRound(sid, agent);
  } catch {
    /* config read reset must never block chat.message hook */
  }

  // FW-COMPLIANCE-AUDIT: Gate armed + knowledge cache compliance audit
  try {
    runComplianceAudit(sid, agent);
  } catch {
    /* compliance audit must never block chat.message hook */
  }

  // Session map write + preflight auto-mark
  try {
    writeSessionMapWithConstraint(sid, agent);
    runPreflightAutoMark(sid, agent);
    updateMemorySessionMap(sid, agent);

    writeLog("session", "runtime", {
      sessionID: sid, agent, event: "CHAT-HOOK",
      detail: `exit (ok) map size=${getMemorySessionMapSize()}`,
    });
  } catch (err: any) {
    writeLog("session", "runtime", {
      sessionID: sid, agent, level: "ERROR", event: "CHAT-HOOK",
      detail: `exit (error) ${err.message}`,
    });
  }
}
