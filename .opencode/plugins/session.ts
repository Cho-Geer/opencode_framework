// session.ts — Plugin: session management + chat.message hook
// ═══════════════════════════════════════════════════════════════
// Logs session lifecycle and manages session-agent mapping.
// Part of framework log system v2.0.
//
// Hook events:
//   - chat.message: Track session → agent mapping
//
// @author @Super-Admin
// @version 2.0.0
// @since 2026-06-10
// ═══════════════════════════════════════════════════════════════

import {
  writeLog,
  updateIndex,
  ensureLogDir,
} from "../lib/log-manager";
import * as path from "node:path";
import * as fs from "node:fs";
import { getSessionMapPath } from "../lib/agent-resolver";

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
    detail: "chat.message",
  });

  return {
    "chat.message": chatMessageHook,
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
