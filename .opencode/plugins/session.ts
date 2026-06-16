// session.ts — Plugin: session management + chat.message hook
// ═══════════════════════════════════════════════════════════════
// Logs session lifecycle and manages session-agent mapping.
// Part of framework log system v2.0.
//
// Hook events:
//   - chat.message:     Track session → agent mapping
//   - session.error:    Detect cooperative interrupts; write sentinel
//   - session.compacted: Reset in-memory session map after compaction
//   - session.idle:     Clear interrupt sentinel when session idles
//
// @author @Super-Admin
// @version 2.1.0
// @since 2026-06-10
// @since 2026-06-14  FW-INTERRUPT-GUARD — added session.error / compacted / idle
// ═══════════════════════════════════════════════════════════════

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { isInterruptError } from "../lib/interrupt-guard";
import { atomicWriteJson } from "../lib/state-utils";
import { dbWriteSessionMap } from "../lib/db-state-manager";
import * as path from "node:path";
import * as fs from "node:fs";

const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const INTERRUPT_SENTINEL_PATH = path.join(
  PROJECT_ROOT,
  ".opencode",
  "state",
  ".last-interrupt.json",
);

// In-memory session map — reset on session.compacted to avoid stale scope.
let _sessionMap: Record<string, { agent: string; ts: string }> = {};

export default withPluginLifecycle("session", {
  "chat.message": chatMessageHook,
  "session.error": sessionErrorHook,
  "session.compacted": sessionCompactedHook,
  "session.idle": sessionIdleHook,
});

// ═══════════════════════════════════════════════════════════════
// [RUNTIME] Inside hook function body — triggered on event
// ═══════════════════════════════════════════════════════════════
async function chatMessageHook(input: any, _output: any) {
  const agent = input.agent || "";
  const sid = input.sessionID || "";

  writeLog("session", "runtime", {
    sessionID: sid,
    agent,
    agentType: agent,
    event: "CHAT-HOOK",
    detail: "enter",
  });

  if (!sid || !agent) {
    writeLog("session", "runtime", {
      sessionID: sid,
      agent,
      agentType: agent,
      event: "CHAT-HOOK",
      detail: "exit (no sid/agent)",
    });
    return;
  }

  try {
    // S25-v4: Write session → agent mapping to DB (replaces .session_map.json)
    // dbWriteSessionMap handles upsert (INSERT OR REPLACE) and preserves created_at.
    dbWriteSessionMap(sid, agent);

    // Keep in-memory map for session.compacted reset
    _sessionMap[sid] = { agent, ts: new Date().toISOString() };

    writeLog("session", "runtime", {
      sessionID: sid,
      agent,
      agentType: agent,
      event: "CHAT-HOOK",
      detail: `exit (ok) map size=${Object.keys(_sessionMap).length}`,
    });
  } catch (err: any) {
    writeLog("session", "runtime", {
      sessionID: sid,
      agent,
      agentType: agent,
      level: "ERROR",
      event: "CHAT-HOOK",
      detail: `exit (error) ${err.message}`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// [FW-INTERRUPT-GUARD 2026-06-14] session.error / compacted / idle
// ═══════════════════════════════════════════════════════════════

async function sessionErrorHook(input: any, _output: any) {
  const sid = input?.sessionID || input?.session?.id || "";
  const error = input?.error ?? input?.message ?? "";
  const errorStr =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : JSON.stringify(error);

  const detection = isInterruptError(error);

  writeLog("session", "runtime", {
    sessionID: sid,
    event: "SESSION-ERROR",
    kind: detection.matched ? "interrupt" : "error",
    detail: errorStr.slice(0, 500),
  });

  if (detection.matched) {
    writeInterruptSentinel({
      sessionID: sid,
      reason: detection.reason,
      kind: detection.kind,
      raw: errorStr.slice(0, 500),
    });
  }
}

async function sessionCompactedHook(input: any, _output: any) {
  const sid = input?.sessionID || input?.session?.id || "";
  _sessionMap = {};
  writeLog("session", "runtime", {
    sessionID: sid,
    event: "SESSION-COMPACTED",
    detail: "in-memory session map reset",
  });
}

async function sessionIdleHook(input: any, _output: any) {
  const sid = input?.sessionID || input?.session?.id || "";
  clearInterruptSentinel();
  writeLog("session", "runtime", {
    sessionID: sid,
    event: "SESSION-IDLE",
    detail: "interrupt sentinel cleared",
  });
}

function writeInterruptSentinel(info: {
  sessionID: string;
  reason: string;
  kind: string;
  raw: string;
}): void {
  try {
    const payload = {
      interrupted: true,
      sessionID: info.sessionID,
      reason: info.reason,
      kind: info.kind,
      raw_message: info.raw,
      timestamp: new Date().toISOString(),
    };
    atomicWriteJson(INTERRUPT_SENTINEL_PATH, payload);
  } catch {
    /* sentinel write must never break the hook */
  }
}

function clearInterruptSentinel(): void {
  try {
    if (fs.existsSync(INTERRUPT_SENTINEL_PATH)) {
      fs.unlinkSync(INTERRUPT_SENTINEL_PATH);
    }
  } catch {
    /* ignore */
  }
}
