// dispatch-auto.ts — "tool.execute.after" plugin: clean up .auto-dispatch marker
// ====================================================================
// After dispatch_subagent tool returns, this plugin checks if the LLM
// properly invoked Task() by verifying the .auto-dispatch marker was
// consumed by task-before.ts. If the marker still exists after the LLM's
// next tool call, the LLM didn't invoke Task() — we log a warning.
//
// The heavy lifting is in task-before.ts: it detects the .auto-dispatch
// marker, reads the full prompt from the dispatch file, and uses that
// for DISPATCH_TOKEN hash verification instead of the LLM-provided prompt.
//
// FIX v2 (2026-06-19, @Super-Admin, SA-REVIEW-AUTO-DISPATCH-BUG):
// Changed from single-entry whole-file delete to per-entry stale cleanup.
// The queue-based marker (.auto-dispatch.json) requires per-entry aging,
// not whole-file deletion. Also added legacy format support.
//
// @since 2026-06-18
// @author @Super-Admin

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { atomicWriteJson } from "../lib/state-utils";

const QUEUE_NAME = ".auto-dispatch.json";
const LEGACY_NAME = ".auto-dispatch";
const MAX_AGE_MS = 300_000; // 5 minutes — stale marker cleanup

export default withPluginLifecycle("dispatch-auto", {
  "tool.execute.after": toolExecuteAfter,
});

async function toolExecuteAfter(input: any, _output: any): Promise<void> {
  const root = process.env.OPENCODE_ROOT || process.cwd();
  const queuePath = path.join(root, ".task_temp", "_dispatch", QUEUE_NAME);
  const legacyPath = path.join(root, ".task_temp", "_dispatch", LEGACY_NAME);

  // ── Queue-based marker (.auto-dispatch.json) ──
  if (fs.existsSync(queuePath)) {
    try {
      const raw = fs.readFileSync(queuePath, "utf8");
      let queue = JSON.parse(raw);
      if (!Array.isArray(queue)) {
        queue = [queue];
      }

      const now = Date.now();
      const fresh: any[] = [];
      let staleCount = 0;

      for (const entry of queue) {
        if (entry.createdAt && now - entry.createdAt > MAX_AGE_MS) {
          staleCount++;
        } else {
          fresh.push(entry);
        }
      }

      if (staleCount > 0) {
        writeLog("dispatch-auto", "runtime", {
          sessionID: input.sessionID,
          callID: input.callID,
          level: "WARN",
          event: "AUTO-DISPATCH-STALE-CLEANUP",
          detail: `Removed ${staleCount} stale entries, ${fresh.length} remain`,
        });
        if (fresh.length > 0) {
          atomicWriteJson(queuePath, fresh);
        } else {
          try {
            fs.unlinkSync(queuePath);
          } catch {}
        }
      }

      // If all entries fresh, log nothing — marker is expected to exist
      return;
    } catch {
      // Malformed queue — cleanup
      try {
        fs.unlinkSync(queuePath);
      } catch {}
      return;
    }
  }

  // ── Legacy single-entry marker (.auto-dispatch) — backward compat ──
  if (!fs.existsSync(legacyPath)) return;

  let createdAt = 0;
  try {
    const raw = fs.readFileSync(legacyPath, "utf8");
    const entry = JSON.parse(raw);
    createdAt = entry.createdAt || 0;
  } catch {
    // Malformed — remove
  }

  if (createdAt && Date.now() - createdAt > MAX_AGE_MS) {
    writeLog("dispatch-auto", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      level: "WARN",
      event: "AUTO-DISPATCH-STALE",
      detail: `Legacy .auto-dispatch marker aged ${Math.round((Date.now() - createdAt) / 1000)}s — auto-cleaning`,
    });
    try {
      fs.unlinkSync(legacyPath);
    } catch {}
    return;
  }

  // Fresh legacy marker — LLM should call Task() soon. Don't clean yet.
}
