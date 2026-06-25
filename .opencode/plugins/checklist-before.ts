/**
 * checklist-before.ts — P0 checklist enforcement + parent-run fallback plugin
 * ═══════════════════════════════════════════════════════════════════════
 * Hooks into tool.execute.before for ALL tool calls. Implements:
 *
 *   1. Parent-run fallback (Option B, e2e-findings-root-cause-diagnosis.md §8):
 *      When a child session's checklist run has dispatch_payload items pending,
 *      looks up the parent session via session_map DB (dispatch:child:{taskId}),
 *      resolves the parent run, and if dispatch facts are passed there,
 *      copies them to the child run and auto-advances from dispatch_payload.
 *
 *   2. Auto-advance: when the current phase's blocking items are all passed,
 *      automatically advances the phase so the agent doesn't deadlock.
 *
 *   3. Phase block: in strict/locked mode, blocks tool execution if the
 *      current phase has unresolved blocking items. In advisory mode, logs
 *      a warning only.
 *
 * Design references:
 *   - resolveChecklistTaskId (P0-5 FIX): task ID resolution bridge between
 *     parent dispatch and child session. Implemented via resolveTaskId() from
 *     agent-resolver which now includes multi-source ctx/ fallback resolution.
 *   - docs/review/framework-refactor/e2e-acceptance-final-findings.md (F-A/P0-1)
 *   - docs/review/framework-refactor/db-canonical-p0-checklist-optimization-plan.md
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-25
 */
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent, resolveTaskId } from "../lib/agent-resolver";
import { getEnforcementMode } from "../lib/gate-core";
import {
  createChecklistRun,
  markChecklistPassed,
  requireChecklistPassed,
  advanceChecklistPhase,
  getChecklistSummary,
} from "../lib/execution-checklist";

const SRC = "checklist-before";

/**
 * Tool categories that should be allowed even when checklist phase is incomplete.
 * These are read-only or diagnostic tools that agents need to diagnose their state.
 */
const PASSTHROUGH_TOOLS = new Set([
  "checklist_status",
  "advance_checklist_phase",
  "resolve_domain_id",
  "knowledge_cache_search",
  "config_read_attest",
  "module_scope_declare",
  "todowrite",
  "question",
  "skill",
  "dispatch_subagent",
]);

/**
 * Resolve the checklist run for a session.
 * Creates one if it doesn't exist (lazy creation).
 */
function resolveRun(
  sessionID: string,
  agent: string,
  taskId: string | null,
): ReturnType<typeof createChecklistRun> | null {
  try {
    return createChecklistRun({
      opencode_session_id: sessionID,
      agent,
      task_id: taskId,
    });
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "CHECKLIST-RUN-RESOLVE-FAILED",
      detail: `session=${sessionID} error=${e.message}`,
    });
    return null;
  }
}

/**
 * Look up the parent session ID from session_map DB.
 * Uses the dispatch:child:{taskId} synthetic slot.
 */
function resolveParentSession(taskId: string): string | null {
  try {
    const { dbReadSessionMap } = require("../lib/db-state-manager");
    const childSlot = "dispatch:child:" + taskId;
    const childEntry = dbReadSessionMap(childSlot);
    if (childEntry && childEntry.session_id) {
      // The child slot's own session_id points to the parent.
      // Actually, dispatch:child:{taskId} IS mapped to the child session,
      // and we need the parent session from session_map.
      // The parent session is stored in ctx/{taskId}.json parentSessionId.
    }
    // Alternative: scan ctx/ file
    const fs = require("node:fs");
    const path = require("node:path");
    const root = process.env.OPENCODE_ROOT || ".";
    const ctxPath = path.join(
      root,
      ".task_temp",
      "_dispatch",
      "ctx",
      taskId + ".json",
    );
    if (fs.existsSync(ctxPath)) {
      const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
      if (ctx.parentSessionId) return ctx.parentSessionId;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Attempt parent-run fallback: when a child session's run is stuck in
 * dispatch_payload, look up the parent session's run and copy its
 * dispatch facts to the child run.
 *
 * This implements Option B from e2e-findings-root-cause-diagnosis.md §8.
 */
function tryParentRunFallback(
  childSessionID: string,
  agent: string,
  taskId: string | null,
  childRun: any,
): boolean {
  if (!taskId || childRun.phase !== "dispatch_payload") return false;

  const parentSession = resolveParentSession(taskId);
  if (!parentSession) {
    writeLog(SRC, "DEBUG", {
      event: "CHECKLIST-PARENT-NOT-FOUND",
      detail: `child=${childSessionID} task=${taskId} — no parent session found`,
    });
    return false;
  }

  writeLog(SRC, "INFO", {
    event: "CHECKLIST-PARENT-RUN-FALLBACK",
    detail: `child=${childSessionID} parent=${parentSession} task=${taskId}`,
  });

  try {
    const parentRun = createChecklistRun({
      opencode_session_id: parentSession,
      agent,
      task_id: taskId,
    });

    if (parentRun.phase === "dispatch_payload") {
      // Parent is also in dispatch_payload — nothing to copy
      return false;
    }

    // Parent has advanced past dispatch_payload — copy 3 dispatch facts
    const dispatchItems = [
      "payload_complete",
      "dispatch_token_created",
      "session_context_bound",
    ];

    let copied = 0;
    for (const itemKey of dispatchItems) {
      try {
        markChecklistPassed({
          run_id: childRun.run_id,
          item_key: itemKey,
          evidence_ref: `parent-run-fallback from ${parentSession}`,
          actor: agent,
        });
        copied++;
      } catch {
        /* item may already be passed */
      }
    }

    if (copied > 0) {
      writeLog(SRC, "INFO", {
        event: "CHECKLIST-DISPATCH-FACTS-COPIED",
        detail: `child=${childSessionID} copied=${copied} items from parent=${parentSession}`,
      });

      // Try auto-advance
      advanceChecklistPhase({
        run_id: childRun.run_id,
        current_phase: "dispatch_payload",
        next_phase: "preflight",
      });
      return true;
    }
  } catch (e: any) {
    writeLog(SRC, "WARN", {
      event: "CHECKLIST-PARENT-FALLBACK-FAILED",
      detail: `child=${childSessionID} error=${e.message}`,
    });
  }
  return false;
}

/**
 * Auto-advance the checklist phase if all blocking items for the
 * current phase are passed. This prevents agents from deadlocking
 * at phase boundaries.
 */
function tryAutoAdvance(run: ReturnType<typeof createChecklistRun>): boolean {
  const PHASE_ORDER = [
    "dispatch_payload",
    "preflight",
    "read_attest",
    "gate_armed",
    "execute",
    "deliver",
    "close",
  ];

  const idx = PHASE_ORDER.indexOf(run.phase);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return false;

  const nextPhase = PHASE_ORDER[idx + 1];
  const result = advanceChecklistPhase({
    run_id: run.run_id,
    current_phase: run.phase,
    next_phase: nextPhase,
  });

  if (result.advanced) {
    writeLog(SRC, "INFO", {
      event: "CHECKLIST-AUTO-ADVANCE",
      detail: `run=${run.run_id} from=${run.phase} to=${nextPhase}`,
    });
    return true;
  }
  return false;
}

// ── Plugin export ──────────────────────────────────────────────────

export default withPluginLifecycle(SRC, {
  "tool.execute.before": async (input: any) => {
    try {
      const sessionID = input?.sessionID || input?.sessionId || "";
      if (!sessionID) return;

      const toolName = input?.tool || input?.args?.tool || "unknown";

      // Passthrough: always allow diagnostic/read-only tools
      if (PASSTHROUGH_TOOLS.has(toolName)) return;

      // Resolve agent and task ID
      const agent = resolveAgent(sessionID) || input?.agent || "unknown";
      const taskId = resolveTaskId(sessionID) || null;

      // Resolve checklist run (lazy create)
      const run = resolveRun(sessionID, agent, taskId);
      if (!run) return;

      // Parent-run fallback for child sessions stuck in dispatch_payload
      if (run.phase === "dispatch_payload") {
        const advanced = tryParentRunFallback(sessionID, agent, taskId, run);
        if (advanced) {
          // Re-read run to get updated phase
          const updatedRun = resolveRun(sessionID, agent, taskId);
          if (updatedRun && updatedRun.phase !== "dispatch_payload") {
            // Advanced — allow tool to proceed
            return;
          }
        }
      }

      // Auto-advance if all items are passed
      tryAutoAdvance(run);

      // Check blocking items for current phase
      const mode = getEnforcementMode();
      const result = requireChecklistPassed({
        run_id: run.run_id,
        phase: run.phase,
      });

      if (!result.passed) {
        const blockers = result.blockers || [];
        if (mode === "advisory") {
          writeLog(SRC, "WARN", {
            event: "P0-CHECKLIST-BLOCKED-ADVISORY",
            sessionID,
            agent,
            taskId,
            tool: toolName,
            detail: `phase=${run.phase} blockers=[${blockers.join(",")}] — advisory mode, tool allowed`,
          });
          return; // Allow tool
        }

        // strict/locked: BLOCK
        writeLog(SRC, "ERROR", {
          event: "P0-CHECKLIST-BLOCKED",
          sessionID,
          agent,
          taskId,
          tool: toolName,
          detail: `phase=${run.phase} blockers=[${blockers.join(",")}]`,
        });

        const summary = getChecklistSummary({
          opencode_session_id: sessionID,
          agent,
          task_id: taskId,
        });
        throw new Error(
          `[FW-ENFORCE][P0-CHECKLIST] Tool "${toolName}" blocked. ` +
            `Checklist phase "${run.phase}" has ${blockers.length} unresolved items: ` +
            `${blockers.slice(0, 5).join(", ")}. ` +
            (summary?.next_action || "Clear all blockers before proceeding."),
        );
      }
    } catch (e: any) {
      // Re-throw enforcement errors; swallow unexpected errors in advisory
      if (e.message && e.message.startsWith("[FW-ENFORCE]")) throw e;
      writeLog(SRC, "ERROR", {
        event: "CHECKLIST-BEFORE-ERROR",
        detail: e.message,
      });
    }
  },
});
