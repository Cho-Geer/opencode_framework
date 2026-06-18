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
// @since 2026-06-18
// @author @Super-Admin

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";

const MARKER_NAME = ".auto-dispatch";
const MAX_AGE_MS = 300_000; // 5 minutes — stale marker cleanup

export default withPluginLifecycle("dispatch-auto", {
  "tool.execute.after": toolExecuteAfter,
});

async function toolExecuteAfter(input: any, _output: any): Promise<void> {
  const root = process.env.OPENCODE_ROOT || process.cwd();
  const markerPath = path.join(root, ".task_temp", "_dispatch", MARKER_NAME);

  if (!fs.existsSync(markerPath)) return;

  // Marker exists — check if it's stale
  let createdAt = 0;
  try {
    const raw = fs.readFileSync(markerPath, "utf8");
    const entry = JSON.parse(raw);
    createdAt = entry.createdAt || 0;
  } catch {
    // Malformed — remove
  }

  if (createdAt && (Date.now() - createdAt) > MAX_AGE_MS) {
    writeLog("dispatch-auto", "runtime", {
      sessionID: input.sessionID, callID: input.callID,
      level: "WARN", event: "AUTO-DISPATCH-STALE",
      detail: `.auto-dispatch marker aged ${Math.round((Date.now() - createdAt) / 1000)}s — auto-cleaning`,
    });
    try { fs.unlinkSync(markerPath); } catch {}
    return;
  }

  // Marker is fresh — LLM should call Task() soon. Don't clean yet.
  // It will be cleaned by task-before.ts when consumed.
}
