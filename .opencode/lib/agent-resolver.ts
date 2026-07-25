// agent-resolver.ts — RE-EXPORT BRIDGE
// All logic moved to service/session/. This file preserves backward
// compatibility for 20+ existing import paths across the framework.
//
// Phase 1c migration: lib/ → service/session/
// Do NOT add business logic here — only re-exports.

export {
  resolveAgent,
  resolveTaskId,
  resolveTaskIdWithSource,
  resolveDomainId,
  resolveDomainIdWithSource,
  resolveLatestDispatchAgent,
  resolveCallerIdentity,
  resolveAgentFromSessionMap,
  readSessionMapEntry as getSessionMapEntry,
} from "../service/session";

export type { ResolvedWithSource } from "../service/session";

export function getSessionMapPath(): string {
  return path.join(
    process.env.OPENCODE_ROOT || ".",
    SESSION_MAP_DIR,
    SESSION_MAP_FILE,
  );
}

/**
 * FW-FIX-CHILD-SESSION-MAP (2026-06-21, @Super-Admin, Issue #117):
 * Helper to find the dag_task_id for a child agent that doesn't yet have its
 * own session_map row. Scans ctx/ files (per-dispatch, dagTaskId-keyed) and
 * falls back to the legacy .dispatch_ctx file.
 *
 * This enables the Priority 1.5 child slot lookup in resolveTaskIdWithSource
 * and resolveDomainIdWithSource: the child slot at session_id=
 * "dispatch:child:{dag_task_id}" stores domain_id and agent type proactively.
 *
 * Returns dag_task_id string or null if not found.
 */
function _findChildDagTaskId(): string | null {
  const dispatchDir = path.join(
    process.env.OPENCODE_ROOT || ".",
    ".task_temp",
    "_dispatch",
  );
  // Try ctx/ files first (per-dispatch, no race condition)
  try {
    const ctxDir = path.join(dispatchDir, "ctx");
    if (fs.existsSync(ctxDir)) {
      const files = fs.readdirSync(ctxDir).filter((f) => f.endsWith(".json"));
      if (files.length === 1) {
        const ctx = JSON.parse(
          fs.readFileSync(path.join(ctxDir, files[0]), "utf8"),
        );
        if (ctx?.dagTaskId) return ctx.dagTaskId;
      }
      // P0-FIX (2026-06-22, @Super-Admin): Multiple ctx files — cross-check
      // each against dispatch:child:{dagTaskId} child slot in session_map.
      // The previous heuristic (newest by createdAt) could return the wrong
      // dagTaskId during concurrent dispatches, causing resolveDomainId to
      // return null for non-KC agents (Issue: Coder-BE HANDOVER.md blocked).
      if (files.length > 1) {
        for (const file of files) {
          try {
            const ctx = JSON.parse(
              fs.readFileSync(path.join(ctxDir, file), "utf8"),
            );
            if (ctx?.dagTaskId) {
              const childSlot = dbReadSessionMap("dispatch:child:" + ctx.dagTaskId);
              if (childSlot?.domain_id) {
                return ctx.dagTaskId;
              }
            }
          } catch {}
        }
      }
    }
  } catch {}
  // Fall back to .dispatch_ctx (legacy)
  try {
    const ctxPath = path.join(dispatchDir, ".dispatch_ctx");
    if (fs.existsSync(ctxPath)) {
      const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
      if (ctx?.dagTaskId) return ctx.dagTaskId;
    }
  } catch {}
  return null;
}

export function resolveAgentFromSessionMap(sessionID: string): string {
  if (!sessionID) return "";
  try {
    const entry = dbReadSessionMap(sessionID);
    if (entry?.agent) {
      writeLog(SRC, "INFO", {
        event: "SESSION-MAP-HIT",
        agent: entry.agent,
        detail: `session map hit: ${sessionID} → ${entry.agent}`,
      });
      return entry.agent;
    }
  } catch {}
  return "";
}

export function resolveAgent(sessionID?: string): string {
  // 1) Session map — primary agent (chatMessageHook writes this).
  //    MOVED TO PRIORITY 1 (2026-06-12, @Super-Admin): Session map is
  //    session-specific, so there is NO race condition from parallel
  //    dispatches. Previously _dispatch_target.json was Priority 1, but
  //    it is a SINGLE shared file that gets overwritten by parallel
  //    dispatches (dispatch-before.ts writes, dispatch-after.ts deletes),
  //    causing wrong agent identity to be returned.
  //
  //    P0-4 enforcement gap root cause: When @Super-Admin was dispatched
  //    in parallel with @Coder-BE, _dispatch_target.json ended up with
  //    "@Coder-BE" (last write wins). resolveAgent() returned "@Coder-BE",
  //    so scope-before.ts P0-4 ROUTE-MISMATCH check was SKIPPED
  //    (agentNorm="coder-be", not "super-admin"), and isWriteAllowed()
  //    allowed the write because @Coder-BE has access to booking-backend/src/.
  if (sessionID) {
    const agent = resolveAgentFromSessionMap(sessionID);
    if (agent) {
      writeLog(SRC, "INFO", {
        event: "AGENT-RESOLVED",
        agent,
        detail: `resolveAgent: session map → ${agent}`,
      });
      return agent.startsWith("@") ? agent : `@${agent}`;
    }
  }

  // 2) _dispatch_target.json — fallback. CAUTION: single shared file,
  //    race condition when multiple Task() dispatches run in parallel.
  //    Only used when session map misses (rare — old entries evicted
  //    from 50-entry cap, or chatMessageHook hasn't fired yet).
  try {
    const p = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch_target.json",
    );
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      const currentRunId = process.env.OPENCODE_RUN_ID || "";
      if (currentRunId) {
        // P0-7: Use run_id comparison when OPENCODE_RUN_ID is available
        if (!d.run_id || d.run_id !== currentRunId) {
          try {
            fs.unlinkSync(p);
          } catch {}
          // stale dispatch, fall through
        } else if (d.agent) {
          writeLog(SRC, "INFO", {
            event: "AGENT-RESOLVED-DISPATCH",
            agent: d.agent,
            detail: `resolveAgent: dispatch target → ${d.agent}`,
          });
          return d.agent.startsWith("@") ? d.agent : `@${d.agent}`;
        }
      } else {
        // P0-7 FALLBACK: Timestamp-based staleness when OPENCODE_RUN_ID
        // is unset. _dispatch_target.json older than 30 min → stale.
        const STALE_MS = 30 * 60 * 1000;
        const mtime = fs.statSync(p).mtimeMs;
        if (Date.now() - mtime > STALE_MS) {
          try {
            fs.unlinkSync(p);
          } catch {}
          // stale dispatch, fall through
        } else if (d.agent) {
          writeLog(SRC, "INFO", {
            event: "AGENT-RESOLVED-DISPATCH",
            agent: d.agent,
            detail: `resolveAgent: dispatch target → ${d.agent}`,
          });
          return d.agent.startsWith("@") ? d.agent : `@${d.agent}`;
        }
      }
    }
  } catch {}

  return "";
}

/** P0-FIX-BUG-13-IDEM: Idempotency guard for duplicate Task() calls */
export const sessionLastDispatched = new Map<
  string,
  { agentType: string; ts: number }
>();

/**
 * Write per-dispatch context to a dagTaskId-keyed file (§3.3 dual-write).
 *
 * Phase 1 (current): Writes BOTH:
 *   a) .task_temp/_dispatch/ctx/{dagTaskId}.json — per-dispatch, race-free (NEW)
 *   b) .task_temp/_dispatch/.dispatch_ctx — shared singleton (LEGACY compat)
 *
 * Phase 2 (future): After all consumers migrate to per-dispatch ctx/ files,
 *   remove the legacy .dispatch_ctx write.
 *
 * Each dispatch gets its own ctx/ file — no cross-dispatch overwrites.
 *
 * IMPLEMENT-DISPATCH-CTX-FIX (2026-06-19, @Super-Admin):
 *   Eliminates the session_map race condition caused by the shared
 *   .dispatch_ctx singleton being overwritten by concurrent dispatches.
 *
 * §3.3 DUAL-WRITE (2026-06-20, @Super-Admin):
 *   Added legacy .dispatch_ctx write alongside per-dispatch ctx/ file.
 *   Consumers (gate-core.ts, dispatch-subagent.ts, task-after.ts) still
 *   rely on .dispatch_ctx as fallback for single-dispatch scenarios.
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
        dagTaskId,
        agentType,
        domainId: domainId || null,
        createdAt: Date.now(),
      }),
    );
    writeLog(SRC, "INFO", {
      event: "DISPATCH-CTX-WRITE",
      dagTaskId,
      agentType,
      domainId: domainId || null,
      detail: `Per-dispatch context written: ctx/${dagTaskId}.json`,
    });

    // §3.3: Dual-write legacy .dispatch_ctx for backward compatibility.
    // The per-dispatch ctx/{dagTaskId}.json is the new race-free format,
    // but existing consumers (gate-core.ts, dispatch-subagent.ts fallback,
    // task-after.ts) still read the shared .dispatch_ctx singleton.
    // Phase 1: write BOTH. Phase 2: migrate readers, then remove this block.
    const legacyCtxPath = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      ".dispatch_ctx",
    );
    fs.writeFileSync(
      legacyCtxPath,
      JSON.stringify({
        dagTaskId,
        agentType,
        domainId: domainId || null,
        createdAt: Date.now(),
      }),
    );
    writeLog(SRC, "INFO", {
      event: "DISPATCH-CTX-LEGACY-WRITE",
      dagTaskId,
      agentType,
      detail: "Legacy .dispatch_ctx dual-write for backward compat (§3.3)",
    });
  } catch (e: any) {
    // Best-effort; never block dispatch
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-CTX-WRITE-ERROR",
      dagTaskId,
      detail: `Failed to write per-dispatch ctx: ${e?.message ?? e}`,
    });
  }
}

/**
 * Metadata type for resolution source tracking.
 * FW-SESSION-HOOK-WRITE-CONSTRAINT (2026-06-21, @Super-Admin):
 *   Added to allow callers to distinguish exact per-session matches
 *   (session_map) from ambiguous/legacy sources (ctx_newest, dispatch_ctx,
 *   dispatch_target). The chat.message hook must only write dagTaskId/domainId
 *   to session_map when resolved_from === 'session_map' — writing from
 *   ambiguous sources could pollute the per-session mapping with data from
 *   a concurrent dispatch.
 */
export interface ResolvedWithSource<T> {
  value: T;
  resolved_from:
    | "session_map" // Exact per-session match from dbReadSessionMap()
    | "ctx_single" // Single ctx/ file — likely this session's dispatch
    | "ctx_exact" // Multiple ctx/ files, exact dagTaskId match found
    | "ctx_newest" // Multiple ctx/ files, picked newest (ambiguous!)
    | "dispatch_ctx" // Legacy .dispatch_ctx singleton (race condition!)
    | "dispatch_target" // Legacy _dispatch_target.json (even less reliable)
    | "child_slot" // dispatch:child:{dagTaskId} synthetic slot
    | "ctx_ambiguous" // Multiple ctx/ files, no exact match (returned null)
    | "none"; // No resolution — returned empty/null
}

/** Resolve task ID from session_map DB, per-dispatch ctx/ files, .dispatch_ctx, or _dispatch_target.json
 *  FW-DISPATCH-TASKID-IMMUTABLE: session_map DB is primary (per-session,
 *  immune to concurrent race conditions). Per-dispatch ctx/ is next (isolated
 *  per dagTaskId, no overwrites). .dispatch_ctx is legacy fallback.
 *  FW-CLEANUP-FRAMEWORK-TASK-ID (2026-06-18): FRAMEWORK_TASK_ID env Priority 0 removed.
 *  All dispatch-task-id communication now flows through session_map DB + ctx/ files.
 *
 *  IMPLEMENT-DISPATCH-CTX-FIX (2026-06-19, @Super-Admin): Priority 2 inserts
 *  per-dispatch ctx/ directory scan to eliminate the race condition from
 *  the shared .dispatch_ctx file.
 *
 *  FW-SESSION-HOOK-WRITE-CONSTRAINT (2026-06-21, @Super-Admin):
 *    Wraps resolveTaskIdWithSource() for backward compatibility.
 */
export function resolveTaskId(sessionId?: string): string {
  return resolveTaskIdWithSource(sessionId).value;
}

/**
 * Source-aware version of resolveTaskId — returns resolution metadata
 * so callers can distinguish exact session_map matches from ambiguous
 * ctx/ or legacy .dispatch_ctx sources.
 *
 * FW-SESSION-HOOK-WRITE-CONSTRAINT (2026-06-21, @Super-Admin):
 *   Chat.message hook MUST NOT write dagTaskId to session_map when
 *   resolved_from is anything other than 'session_map'. Writing from
 *   ctx_newest/dispatch_ctx/dispatch_target could pollute the per-session
 *   mapping with data from a concurrent dispatch.
 */
export function resolveTaskIdWithSource(
  sessionId?: string,
): ResolvedWithSource<string> {
  // Priority 1: session_map DB (per-session dag_task_id, immune to race)
  if (sessionId) {
    try {
      const entry = dbReadSessionMap(sessionId);
      if (entry?.dag_task_id) {
        writeLog(SRC, "INFO", {
          event: "TASKID-RESOLVED",
          dag_task_id: entry.dag_task_id,
          detail: `resolveTaskIdWithSource: session_map DB → ${entry.dag_task_id}`,
        });
        return { value: entry.dag_task_id, resolved_from: "session_map" };
      }
    } catch {}
  }

  // Priority 1.5: FW-FIX-CHILD-SESSION-MAP (2026-06-21, @Super-Admin, Issue #117)
  // When a child agent starts, its own session_map row hasn't been written yet.
  // Check the "dispatch:child:{dag_task_id}" synthetic slot that dispatch-subagent.ts
  // writes proactively at dispatch time.
  try {
    const childDagTaskId = _findChildDagTaskId();
    if (childDagTaskId) {
      const childSlotEntry = dbReadSessionMap(
        `dispatch:child:${childDagTaskId}`,
      );
      if (childSlotEntry?.dag_task_id) {
        writeLog(SRC, "INFO", {
          event: "TASKID-RESOLVED-CHILD-SLOT",
          dag_task_id: childSlotEntry.dag_task_id,
          detail: `resolveTaskIdWithSource: child slot ${childDagTaskId} → ${childSlotEntry.dag_task_id}`,
        });
        return {
          value: childSlotEntry.dag_task_id,
          resolved_from: "child_slot",
        };
      }
    }
  } catch {}

  // Priority 2 (NEW): Per-dispatch context files (dagTaskId-keyed, no overwrites)
  // Each dispatch writes its own {dagTaskId}.json — no race condition possible.
  try {
    const ctxDir = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      "ctx",
    );
    if (fs.existsSync(ctxDir)) {
      const files = fs.readdirSync(ctxDir).filter((f) => f.endsWith(".json"));
      if (files.length > 0) {
        // If only one dispatch context, use it directly
        if (files.length === 1) {
          const ctx = JSON.parse(
            fs.readFileSync(path.join(ctxDir, files[0]), "utf8"),
          );
          if (ctx?.dagTaskId) {
            writeLog(SRC, "INFO", {
              event: "DISPATCH-CTX-READ",
              dagTaskId: ctx.dagTaskId,
              detail: `resolveTaskIdWithSource: ctx/ single file → ${ctx.dagTaskId}`,
            });
            return { value: ctx.dagTaskId, resolved_from: "ctx_single" };
          }
        }
        // FW-SESSION-HOOK-WRITE-CONSTRAINT: Multiple dispatch contexts
        // → mark as ctx_newest (ambiguous). The chat.message hook
        // SHOULD NOT write this to session_map because we cannot
        // guarantee which dispatch this session belongs to.
        let newest: { dagTaskId: string; createdAt: number } | null = null;
        for (const file of files) {
          try {
            const ctx = JSON.parse(
              fs.readFileSync(path.join(ctxDir, file), "utf8"),
            );
            if (
              ctx?.dagTaskId &&
              (!newest || ctx.createdAt > newest.createdAt)
            ) {
              newest = ctx;
            }
          } catch {}
        }
        if (newest?.dagTaskId) {
          writeLog(SRC, "INFO", {
            event: "DISPATCH-CTX-READ",
            dagTaskId: newest.dagTaskId,
            detail: `resolveTaskIdWithSource: ctx/ newest → ${newest.dagTaskId}`,
          });
          return { value: newest.dagTaskId, resolved_from: "ctx_newest" };
        }
      }
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-CTX-READ-ERROR",
      detail: `resolveTaskIdWithSource ctx/ scan failed: ${e?.message ?? e}`,
    });
  }

  // Priority 3: .dispatch_ctx file (legacy fallback, subject to race condition
  // with concurrent dispatches but preserved for backward compatibility)
  try {
    const ctxPath = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      ".dispatch_ctx",
    );
    if (fs.existsSync(ctxPath)) {
      const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
      if (ctx && ctx.dagTaskId) {
        writeLog(SRC, "WARN", {
          event: "DISPATCH-CTX-FALLBACK",
          dagTaskId: ctx.dagTaskId,
          detail: `resolveTaskIdWithSource: LEGACY .dispatch_ctx fallback → ${ctx.dagTaskId}`,
        });
        return { value: ctx.dagTaskId, resolved_from: "dispatch_ctx" };
      }
    }
  } catch {}

  // Priority 4: _dispatch_target.json (legacy, no longer written)
  try {
    const p = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch_target.json",
    );
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      if (d.task_id)
        return { value: d.task_id, resolved_from: "dispatch_target" };
    }
  } catch {}
  return { value: "", resolved_from: "none" };
}

/** Resolve domain ID from session_map DB, per-dispatch ctx/ files, or .dispatch_ctx file.
 *  FW-UC7KS-DOMAIN-001: session_map DB is primary (per-session, immune to
 *  concurrent dispatch race conditions). Per-dispatch ctx/ is next (isolated
 *  per dagTaskId, no overwrites). .dispatch_ctx is legacy fallback.
 *  Returns null if no domain context is available.
 *
 *  GAP-1 (IMPLEMENT-DISPATCH-CTX-FIX, 2026-06-19, @Super-Admin):
 *    resolveDomainId() had the SAME race condition as resolveTaskId() —
 *    the shared .dispatch_ctx singleton was overwritten by concurrent
 *    dispatches. Fixed with ctx/ directory scan at Priority 2.
 *
 *  P2 FIX (fix_resolveDomainId_P2_v1, 2026-06-21, @Super-Admin):
 *    Priority 2 returned "newest by createdAt" when multiple ctx/ files
 *    existed — a heuristic that could return the wrong domain during
 *    concurrent dispatches. Fixed with dagTaskId exact match from
 *    session_map DB. If no match, returns null instead of guessing.
 */
export function resolveDomainId(sessionId?: string): string | null {
  return resolveDomainIdWithSource(sessionId).value;
}

/**
 * Source-aware version of resolveDomainId — returns resolution metadata
 * so callers can distinguish exact session_map matches from ambiguous
 * ctx/ or legacy .dispatch_ctx sources.
 *
 * FW-SESSION-HOOK-WRITE-CONSTRAINT (2026-06-21, @Super-Admin):
 *   Chat.message hook MUST NOT write domainId to session_map when
 *   resolved_from is anything other than 'session_map'. Writing from
 *   ctx_single/dispatch_ctx could pollute the per-session mapping
 *   with data from a concurrent dispatch.
 */
export function resolveDomainIdWithSource(
  sessionId?: string,
): ResolvedWithSource<string | null> {
  // Priority 1: session_map DB (per-session domain_id, immune to race)
  if (sessionId) {
    try {
      const entry = dbReadSessionMap(sessionId);
      if (entry?.domain_id) {
        writeLog(SRC, "INFO", {
          event: "DOMAIN-RESOLVED",
          domain_id: entry.domain_id,
          detail: `resolveDomainIdWithSource: session_map DB → ${entry.domain_id}`,
        });
        return { value: entry.domain_id, resolved_from: "session_map" };
      }
    } catch {}
  }

  // Priority 1.5: FW-FIX-CHILD-SESSION-MAP (2026-06-21, @Super-Admin, Issue #117)
  // When a child agent starts, its own session_map row hasn't been written yet
  // (session.ts chatMessageHook writes it later). But dispatch-subagent.ts writes
  // a "child dispatch slot" at session_id="dispatch:child:{dag_task_id}" that
  // contains the agent type and domain_id. This enables the child to resolve
  // its domain_id via session_map (Priority 1 semantics) before its own row exists.
  //
  // Strategy: Get dag_task_id from ctx/ files or .dispatch_ctx, construct the
  // synthetic session_id, and look it up in session_map.
  try {
    const childDagTaskId = _findChildDagTaskId();
    if (childDagTaskId) {
      const childSlotEntry = dbReadSessionMap(
        `dispatch:child:${childDagTaskId}`,
      );
      if (childSlotEntry?.domain_id) {
        writeLog(SRC, "INFO", {
          event: "DOMAIN-RESOLVED-CHILD-SLOT",
          domain_id: childSlotEntry.domain_id,
          detail: `resolveDomainIdWithSource: child slot ${childDagTaskId} → ${childSlotEntry.domain_id}`,
        });
        return {
          value: childSlotEntry.domain_id,
          resolved_from: "child_slot",
        };
      }
    }
  } catch {}

  // Priority 2 (NEW): Per-dispatch context files (dagTaskId-keyed, no overwrites)
  // Same ctx/ directory scan pattern as resolveTaskId() Priority 2.
  try {
    const ctxDir = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      "ctx",
    );
    if (fs.existsSync(ctxDir)) {
      const files = fs.readdirSync(ctxDir).filter((f) => f.endsWith(".json"));
      if (files.length === 1) {
        const ctx = JSON.parse(
          fs.readFileSync(path.join(ctxDir, files[0]), "utf8"),
        );
        if (ctx?.domainId) {
          writeLog(SRC, "INFO", {
            event: "DISPATCH-CTX-READ-DOMAIN",
            domainId: ctx.domainId,
            detail: `resolveDomainIdWithSource: ctx/ single file → ${ctx.domainId}`,
          });
          return { value: ctx.domainId, resolved_from: "ctx_single" };
        }
      }
      // Multiple: try dagTaskId exact match instead of returning newest by createdAt.
      // P2 FIX (fix_resolveDomainId_P2_v1, @Super-Admin): The "newest-by-createdAt"
      // heuristic could return the wrong domain when concurrent dispatches write
      // multiple ctx files. Instead: (a) try exact dagTaskId match from session_map DB,
      // (b) if no match, return null rather than guessing.
      if (files.length > 1) {
        // Look up dagTaskId from session_map DB using the sessionId
        let dagTaskId: string | null = null;
        if (sessionId) {
          try {
            const entry = dbReadSessionMap(sessionId);
            dagTaskId = entry?.dag_task_id || null;
          } catch {}
        }
        if (dagTaskId) {
          // ctx files are named {dagTaskId}.json — try exact match
          const exactFile = files.find((f) => f === dagTaskId + ".json");
          if (exactFile) {
            try {
              const ctx = JSON.parse(
                fs.readFileSync(path.join(ctxDir, exactFile), "utf8"),
              );
              if (ctx?.domainId) {
                writeLog(SRC, "INFO", {
                  event: "DISPATCH-CTX-READ-DOMAIN",
                  domainId: ctx.domainId,
                  detail: `resolveDomainId: ctx/ exact match → ${ctx.domainId} (dagTaskId=${dagTaskId})`,
                });
                return ctx.domainId;
              }
            } catch {}
          }
        }
        // No dagTaskId match found: ambiguous — return null instead of guessing
        writeLog(SRC, "WARN", {
          event: "DISPATCH-CTX-AMBIGUOUS",
          fileCount: files.length,
          detail: `resolveDomainId: ctx/ AMBIGUOUS (${files.length} files, no dagTaskId match)`,
        });
        return null;
      }
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DISPATCH-CTX-READ-ERROR",
      detail: `resolveDomainId ctx/ scan failed: ${e?.message ?? e}`,
    });
  }

  // Priority 3: .dispatch_ctx file (legacy fallback, subject to race)
  try {
    const ctxPath = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch",
      ".dispatch_ctx",
    );
    if (fs.existsSync(ctxPath)) {
      const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
      if (ctx && ctx.domainId) {
        writeLog(SRC, "WARN", {
          event: "DISPATCH-CTX-FALLBACK-DOMAIN",
          domainId: ctx.domainId,
          detail: `resolveDomainIdWithSource: LEGACY .dispatch_ctx fallback → ${ctx.domainId}`,
        });
        return { value: ctx.domainId, resolved_from: "dispatch_ctx" };
      }
    }
  } catch {}

  return { value: null, resolved_from: "none" };
}

/**
 * Resolve the likely dispatch agent for the current context from session_map DB.
 * Uses ORDER BY updated_at DESC LIMIT 1 — safe in SQLite WAL mode.
 *
 * This is a best-effort function: if the DB is unavailable, it returns
 * an empty string without throwing. The caller (compliance-gate.ts) treats
 * empty as "unknown agent → no bypass".
 *
 * Query strategy (no agent-type filter — caller decides):
 *   Priority 1: Exact dag_task_id match → returns actual agent for that task
 *   Priority 2: Latest session (ORDER BY updated_at DESC) → returns actual
 *               agent regardless of type
 *
 * The CALLER is responsible for agent-type validation. For bypass decisions,
 * compliance-gate.ts checks: bypassNorm === "super-admin" || bypassNorm === "orchestrator".
 * This two-layer design (resolver returns raw agent, caller decides) prevents
 * non-SA/Orch agents from being incorrectly identified as SA/Orch when:
 *   (a) the taskId does not match any SA/Orch session, AND
 *   (b) the fallback returns a stale SA/Orch session from a prior dispatch
 *
 * Design rationale:
 *   - Per-session rows → no shared-state race condition
 *   - ORDER BY updated_at DESC LIMIT 1 → no transaction needed
 *   - SQLite WAL mode → concurrent readers safe
 *   - No agent-type filter in queries → returns actual agent for caller evaluation
 *   - taskId parameter → precise dag_task_id lookup before ORDER BY fallback
 *
 * @param taskId - Optional DAG task ID for precise dag_task_id lookup
 * @returns Agent name with "@" prefix (e.g., "@Super-Admin"), or "" if unknown
 */
export function resolveLatestDispatchAgent(taskId?: string): string {
  try {
    const { getDb } = require("./db-manager");
    const db = getDb();
    // Priority 1: taskId → dag_task_id exact match (when available)
    // No agent-type filter — returns the actual agent for this dag_task_id.
    // The caller (compliance-gate.ts) checks the returned agent type to decide
    // whether to apply the bypass. This prevents non-SA/Orch agents from
    // falling through to Priority 2 and incorrectly receiving bypass.
    if (taskId) {
      const row = db
        .query(
          `SELECT agent FROM session_map
           WHERE dag_task_id = ?
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .get(taskId) as { agent: string } | null;
      if (row?.agent) {
        return row.agent.startsWith("@") ? row.agent : `@${row.agent}`;
      }
    }
    // Priority 2: latest session (fallback — no agent-type filter)
    // Returns the most recently updated agent regardless of type.
    // The caller is responsible for agent-type validation.
    const row = db
      .query(
        `SELECT agent FROM session_map
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get() as { agent: string } | null;
    if (row?.agent) {
      // Normalize: ensure "@" prefix (session_map stores with "@" prefix)
      return row.agent.startsWith("@") ? row.agent : `@${row.agent}`;
    }
  } catch (e: any) {
    // Non-blocking: if DB unavailable, return empty (bypass not applied)
    writeLog(SRC, "ERROR", {
      event: "SESSION-MAP-READ-FAILED",
      detail: `resolveLatestDispatchAgent: ${e.message}`,
    });
  }
  return "";
}
