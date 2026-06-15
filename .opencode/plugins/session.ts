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

import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import { isInterruptError } from "../lib/interrupt-guard";
import * as path from "node:path";
import * as fs from "node:fs";
import { getSessionMapPath } from "../lib/agent-resolver";

const PROJECT_ROOT = process.env.OPENCODE_ROOT || process.cwd();
const INTERRUPT_SENTINEL_PATH = path.join(
  PROJECT_ROOT,
  ".opencode",
  "state",
  ".last-interrupt.json",
);

// In-memory session map — reset on session.compacted to avoid stale scope.
let _sessionMap: Record<string, { agent: string; ts: string }> = {};

// ═══════════════════════════════════════════════════════════════
// [PLUGIN-LOADED] Module top-level — triggered at import time
// ═══════════════════════════════════════════════════════════════
ensureLogDir();
writeLog("session", "loaded", {
  event: "PLUGIN-LOADED",
  detail: "session.ts module loaded",
});
updateIndex("session", "PLUGIN-LOADED");

// ═══════════════════════════════════════════════════════════════
// [HOOK-REGISTERED] Inside export default function body
// ═══════════════════════════════════════════════════════════════
export default (async (_ctx: any) => {
  writeLog("session", "hooks", {
    event: "HOOK-REGISTERED",
    detail: "chat.message,session.error,session.compacted,session.idle",
  });

  return {
    "chat.message": chatMessageHook,
    "session.error": sessionErrorHook,
    "session.compacted": sessionCompactedHook,
    "session.idle": sessionIdleHook,
  };
}) as any;

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
    const mp = getSessionMapPath();
    const dir = path.dirname(mp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let map: Record<string, { agent: string; ts: string }> = {};
    if (fs.existsSync(mp)) {
      try { map = JSON.parse(fs.readFileSync(mp, "utf8")); } catch {}
    }
    map[sid] = { agent, ts: new Date().toISOString() };
    const keys = Object.keys(map);
    if (keys.length > 50) {
      const sorted = keys.sort((a, b) =>
        (map[b]?.ts || "").localeCompare(map[a]?.ts || ""),
      );
      for (const k of sorted.slice(50)) delete map[k];
    }
    fs.writeFileSync(mp, JSON.stringify(map, null, 2), "utf8");

    writeLog("session", "runtime", {
      sessionID: sid,
      agent,
      agentType: agent,
      event: "CHAT-HOOK",
      detail: `exit (ok) map size=${Object.keys(map).length}`,
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
//
// Rationale: when the upstream OpenCode interrupt handler throws using an
// uninterpolated template like "Unexpected {interrupt}", the raw string
// surfaces in the TUI and ToolRegistry-derived state (session map, gate
// locks) can be left stale. Subscribing to `session.error` lets us:
//   1. Log the event through the framework log manager so it shows up in
//      .task_temp/_logs/<date>/plugin-session-runtime.log.
//   2. Heuristically detect the interrupt signature and write a sentinel
//      file (.opencode/state/.last-interrupt.json) that the rest of the
//      framework can read to know "previous tool invocation was cancelled".
//   3. On session.compacted, reset the in-memory session map to avoid
//      stale scope leakage (mirrors upstream `compaction.*` semantics).
//   4. On session.idle, clear the sentinel so the next run starts clean.

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
  // Reset the in-memory session map — compaction means prior agent bindings
  // may no longer be valid and we must not reuse them for new messages.
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
    const dir = path.dirname(INTERRUPT_SENTINEL_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload = {
      interrupted: true,
      sessionID: info.sessionID,
      reason: info.reason,
      kind: info.kind,
      raw_message: info.raw,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(
      INTERRUPT_SENTINEL_PATH,
      JSON.stringify(payload, null, 2),
      "utf8",
    );
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
