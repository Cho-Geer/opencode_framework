// service/session/dispatch-context.ts — Dispatch context file writing
// Per-dispatch ctx/{dagTaskId}.json + idempotency guard
// Source: agent-resolver.ts (writeDispatchCtx + sessionLastDispatched)

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";

const SRC = "service-dispatch-ctx";

/**
 * Write per-dispatch context to a dagTaskId-keyed file.
 * Writes to .task_temp/_dispatch/ctx/{dagTaskId}.json
 * Each dispatch gets its own file — no cross-dispatch overwrites.
 *
 * Source: agent-resolver.ts writeDispatchCtx()
 * OPT-02 (2026-06-23): DB-canonical — legacy .dispatch_ctx dual-write removed.
 */
export function writeDispatchCtx(
  dagTaskId: string,
  agentType: string,
  domainId?: string,
): void {
  try {
    const ctxDir = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      "ctx",
    );
    fs.mkdirSync(ctxDir, { recursive: true });
    const ctxFile = path.join(ctxDir, dagTaskId + ".json");
    fs.writeFileSync(
      ctxFile,
      JSON.stringify({
        dag_task_id: dagTaskId,
        agentType,
        domainId: domainId || null,
        createdAt: Date.now(),
      }),
    );
    writeLog(SRC, "INFO", {
      event: "DISPATCH-CTX-WRITE",
      dag_task_id: dagTaskId,
      agentType,
      domainId: domainId || undefined,
      detail: `Per-dispatch context written: ctx/${dagTaskId}.json`,
    });
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-CTX-WRITE-ERROR",
      dagTaskId,
      detail: `Failed to write per-dispatch ctx: ${e?.message ?? e}`,
    });
  }
}

/**
 * Idempotency guard for duplicate Task() calls.
 * Tracks when each session was last dispatched to prevent duplicates.
 *
 * Source: agent-resolver.ts sessionLastDispatched
 */
export const sessionLastDispatched = new Map<
  string,
  { agentType: string; ts: number }
>();
