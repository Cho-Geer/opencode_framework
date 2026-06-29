// service/session/resolver.ts — Agent identity resolution chain
// Full resolution: session_map → child_slot → ctx/ files → env fallback
// Source: agent-resolver.ts (resolve functions)

import * as fs from "node:fs";
import * as path from "node:path";
import { writeLog } from "../../lib/log-manager";
import { dbReadSessionMap } from "../../lib/db-state-manager";
import { resolveAgentFromSessionMap, normalizeAgent } from "./session-map";
import { toDisplayName } from "../../lib/agent-identity";

const SRC = "lib-agent-resolver";

// ── Metadata type for resolution source tracking ───────────────────
// FW-SESSION-HOOK-WRITE-CONSTRAINT: callers distinguish exact per-session
// matches (session_map) from ambiguous sources (ctx_newest, child_slot).

export interface ResolvedWithSource<T> {
  value: T;
  resolved_from:
    | "session_map"
    | "ctx_single"
    | "ctx_exact"
    | "ctx_newest"
    | "child_slot"
    | "ctx_ambiguous"
    | "none";
}

// ── Internal helpers ───────────────────────────────────────────────

function _findChildDAGTaskId(): string | null {
  const dispatchDir = path.join(
    process.env.OPENCODE_ROOT || ".",
    ".task_temp",
    "_dispatch",
  );
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
      // Multiple ctx files: cross-check with child slot in session_map
      if (files.length > 1) {
        for (const file of files) {
          try {
            const ctx = JSON.parse(
              fs.readFileSync(path.join(ctxDir, file), "utf8"),
            );
            if (ctx?.dagTaskId) {
              const childSlot = dbReadSessionMap(
                "dispatch:child:" + ctx.dagTaskId,
              );
              if (childSlot?.domain_id) {
                return ctx.dagTaskId;
              }
            }
          } catch {}
        }
      }
    }
  } catch {}
  return null;
}

interface CtxEntry {
  dagTaskId: string;
  domainId?: string;
  createdAt: number;
}

function _scanCtxDir(): CtxEntry[] {
  const ctxDir = path.join(
    process.env.OPENCODE_ROOT || ".",
    ".task_temp",
    "_dispatch",
    "ctx",
  );
  if (!fs.existsSync(ctxDir)) return [];
  const files = fs.readdirSync(ctxDir).filter((f) => f.endsWith(".json"));
  const entries: CtxEntry[] = [];
  for (const file of files) {
    try {
      const ctx = JSON.parse(fs.readFileSync(path.join(ctxDir, file), "utf8"));
      if (ctx?.dagTaskId) {
        entries.push({
          dagTaskId: ctx.dagTaskId,
          domainId: ctx.domainId || undefined,
          createdAt: ctx.createdAt || 0,
        });
      }
    } catch {}
  }
  return entries;
}

// ── resolveAgent ───────────────────────────────────────────────────

export function resolveAgent(sessionID?: string): string {
  if (sessionID) {
    const agent = resolveAgentFromSessionMap(sessionID);
    if (agent) {
      writeLog(SRC, "INFO", {
        event: "AGENT-RESOLVED",
        agent,
        detail: `resolveAgent: session map -> ${agent}`,
      });
      return normalizeAgent(agent);
    }
  }
  // FRAMEWORK_AGENT env var — last-resort fallback
  const frameworkAgent = process.env.FRAMEWORK_AGENT || "";
  if (frameworkAgent) {
    writeLog(SRC, "WARN", {
      event: "AGENT-RESOLVED-FRAMEWORK-FALLBACK",
      agent: frameworkAgent,
      detail: `resolveAgent: FRAMEWORK_AGENT fallback -> ${frameworkAgent}`,
    });
    return normalizeAgent(frameworkAgent);
  }
  writeLog(SRC, "ERROR", {
    event: "AGENT-RESOLUTION-FAILED",
    detail: "resolveAgent: ALL sources exhausted",
  });
  return "";
}

// ── resolveTaskId ──────────────────────────────────────────────────

export function resolveTaskId(sessionId?: string): string {
  return resolveTaskIdWithSource(sessionId).value;
}

export function resolveTaskIdWithSource(
  sessionId?: string,
): ResolvedWithSource<string> {
  // Priority 1: session_map DB
  if (sessionId) {
    try {
      const entry = dbReadSessionMap(sessionId);
      if (entry?.dag_task_id) {
        writeLog(SRC, "INFO", {
          event: "TASKID-RESOLVED",
          dag_task_id: entry.dag_task_id,
          detail: `resolveTaskIdWithSource: session_map DB -> ${entry.dag_task_id}`,
        });
        return { value: entry.dag_task_id, resolved_from: "session_map" };
      }
    } catch {}
  }
  // Priority 1.5: child slot
  try {
    const childDagTaskId = _findChildDAGTaskId();
    if (childDagTaskId) {
      const childSlot = dbReadSessionMap(
        `dispatch:child:${childDagTaskId}`,
      );
      if (childSlot?.dag_task_id) {
        writeLog(SRC, "INFO", {
          event: "TASKID-RESOLVED-CHILD-SLOT",
          dag_task_id: childSlot.dag_task_id,
          detail: `resolveTaskIdWithSource: child slot -> ${childSlot.dag_task_id}`,
        });
        return {
          value: childSlot.dag_task_id,
          resolved_from: "child_slot",
        };
      }
    }
  } catch {}
  // Priority 2: per-dispatch ctx/ files
  const entries = _scanCtxDir();
  if (entries.length === 1) {
    writeLog(SRC, "INFO", {
      event: "DISPATCH-CTX-READ",
      dagTaskId: entries[0].dagTaskId,
      detail: `resolveTaskIdWithSource: ctx/ single file -> ${entries[0].dagTaskId}`,
    });
    return { value: entries[0].dagTaskId, resolved_from: "ctx_single" };
  }
  if (entries.length > 1) {
    const newest = entries.reduce((a, b) =>
      a.createdAt >= b.createdAt ? a : b,
    );
    writeLog(SRC, "INFO", {
      event: "DISPATCH-CTX-READ",
      dagTaskId: newest.dagTaskId,
      detail: `resolveTaskIdWithSource: ctx/ newest -> ${newest.dagTaskId}`,
    });
    return { value: newest.dagTaskId, resolved_from: "ctx_newest" };
  }
  writeLog(SRC, "INFO", {
    event: "TASKID-RESOLUTION-FAILED",
    detail: "resolveTaskIdWithSource: ALL sources exhausted",
  });
  return { value: "", resolved_from: "none" };
}

// ── resolveDomainId ────────────────────────────────────────────────

export function resolveDomainId(sessionId?: string): string | null {
  const result = resolveDomainIdWithSource(sessionId);
  return result ? result.value : null;
}

export function resolveDomainIdWithSource(
  sessionId?: string,
): ResolvedWithSource<string | null> {
  // Priority 1: session_map DB
  if (sessionId) {
    try {
      const entry = dbReadSessionMap(sessionId);
      if (entry?.domain_id) {
        writeLog(SRC, "INFO", {
          event: "DOMAIN-RESOLVED",
          domain_id: entry.domain_id,
          detail: `resolveDomainIdWithSource: session_map DB -> ${entry.domain_id}`,
        });
        return { value: entry.domain_id, resolved_from: "session_map" };
      }
    } catch {}
  }
  // Priority 1.5: child slot
  try {
    const childDagTaskId = _findChildDAGTaskId();
    if (childDagTaskId) {
      const childSlot = dbReadSessionMap(
        `dispatch:child:${childDagTaskId}`,
      );
      if (childSlot?.domain_id) {
        writeLog(SRC, "INFO", {
          event: "DOMAIN-RESOLVED-CHILD-SLOT",
          domain_id: childSlot.domain_id,
          detail: `resolveDomainIdWithSource: child slot -> ${childSlot.domain_id}`,
        });
        return {
          value: childSlot.domain_id,
          resolved_from: "child_slot",
        };
      }
    }
  } catch {}
  // Priority 2: per-dispatch ctx/ files
  const entries = _scanCtxDir();
  if (entries.length === 1) {
    const domain = entries[0].domainId || null;
    writeLog(SRC, "INFO", {
      event: "DISPATCH-CTX-READ-DOMAIN",
      domain_id: domain,
      detail: `resolveDomainIdWithSource: ctx/ single file -> ${domain}`,
    });
    return { value: domain, resolved_from: "ctx_single" };
  }
  if (entries.length > 1) {
    // Try exact dagTaskId match from session_map
    let dagTaskId: string | null = null;
    if (sessionId) {
      try {
        const entry = dbReadSessionMap(sessionId);
        dagTaskId = entry?.dag_task_id || null;
      } catch {}
    }
    if (dagTaskId) {
      const exact = entries.find((e) => e.dagTaskId === dagTaskId);
      if (exact?.domainId) {
        writeLog(SRC, "INFO", {
          event: "DISPATCH-CTX-READ-DOMAIN",
          domain_id: exact.domainId,
          detail: `resolveDomainId: ctx/ exact match -> ${exact.domainId}`,
        });
        return { value: exact.domainId, resolved_from: "ctx_exact" };
      }
    }
    writeLog(SRC, "WARN", {
      event: "DISPATCH-CTX-AMBIGUOUS",
      fileCount: entries.length,
      detail: `resolveDomainId: ctx/ AMBIGUOUS (${entries.length} files)`,
    });
    return { value: null, resolved_from: "ctx_ambiguous" };
  }
  return { value: null, resolved_from: "none" };
}

// ── resolveLatestDispatchAgent ─────────────────────────────────────

export function resolveLatestDispatchAgent(taskId?: string): string {
  try {
    const { getDb } = require("../../lib/db-manager");
    const db = getDb();
    // Priority 1: taskId -> dag_task_id exact match
    if (taskId) {
      const row = db
        .query(
          "SELECT agent FROM session_map WHERE dag_task_id = ? ORDER BY updated_at DESC LIMIT 1",
        )
        .get(taskId) as { agent: string } | null;
      if (row?.agent) return normalizeAgent(row.agent);
    }
    // Priority 2: latest session (fallback)
    const row = db
      .query(
        "SELECT agent FROM session_map ORDER BY updated_at DESC LIMIT 1",
      )
      .get() as { agent: string } | null;
    if (row?.agent) return normalizeAgent(row.agent);
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "SESSION-MAP-READ-FAILED",
      detail: `resolveLatestDispatchAgent: ${e.message}`,
    });
  }
  return "";
}

// ── resolveCallerIdentity ──────────────────────────────────────────
// GA-D-G6: Unified Caller Identity Resolver.
// Priority: context.agent -> session_map -> gate_session -> latest dispatch -> UNRESOLVED

export function resolveCallerIdentity(
  sessionID?: string,
  contextAgent?: string,
): string {
  if (contextAgent && contextAgent.trim() !== "") {
    const norm = normalizeAgent(contextAgent);
    writeLog(SRC, "INFO", {
      event: "CALLER-IDENTITY-RESOLVED",
      agent: norm,
      detail: "context.agent -> " + norm,
    });
    return norm;
  }
  if (sessionID) {
    try {
      const agent = resolveAgentFromSessionMap(sessionID);
      if (agent) {
        const n = normalizeAgent(agent);
        writeLog(SRC, "INFO", {
          event: "CALLER-IDENTITY-RESOLVED",
          agent: n,
          detail: "session_map -> " + n,
        });
        return n;
      }
    } catch {}
    try {
      const { getDb } = require("../../lib/db-manager");
      const db = getDb();
      const r = db
        .query(
          "SELECT agent FROM gate_sessions WHERE opencode_session_id=? AND status IN ('armed','delivered','approved') ORDER BY created_at DESC LIMIT 1",
        )
        .get(sessionID) as any;
      if (r?.agent) {
        const n = normalizeAgent(r.agent);
        writeLog(SRC, "INFO", {
          event: "CALLER-IDENTITY-RESOLVED",
          agent: n,
          detail: "gate_session -> " + n,
        });
        return n;
      }
    } catch {}
  }
  try {
    const { getDb } = require("../../lib/db-manager");
    const db = getDb();
    const r = db
      .query(
        "SELECT agent FROM session_map ORDER BY updated_at DESC LIMIT 1",
      )
      .get() as any;
    if (r?.agent) {
      const n = normalizeAgent(r.agent);
      writeLog(SRC, "WARN", {
        event: "CALLER-IDENTITY-FALLBACK",
        agent: n,
        detail: "latest dispatch -> " + n,
      });
      return n;
    }
  } catch {}
  // FRAMEWORK_AGENT env var fallback (GA-D-G6-FIX)
  const frameworkAgent = process.env.FRAMEWORK_AGENT || "";
  if (frameworkAgent) {
    const n = normalizeAgent(frameworkAgent);
    writeLog(SRC, "WARN", {
      event: "CALLER-IDENTITY-FALLBACK",
      agent: n,
      detail: "FRAMEWORK_AGENT -> " + n,
    });
    return n;
  }
  writeLog(SRC, "WARN", {
    event: "CALLER-IDENTITY-UNRESOLVED",
    sessionID: sessionID || "(none)",
    detail: "All sources exhausted",
  });
  return "CALLER-IDENTITY-UNRESOLVED";
}

// ── resolveDomainIdForTool ─────────────────────────────────────────
// Full domain resolution for the resolve_domain_id tool.
// Wraps resolveDomainIdWithSource (priorities 1-2) + dag_task_id lookup
// + agent_domain_map fallback (priority 3).

export function resolveDomainIdForTool(
  sessionId: string,
  dagTaskId: string,
  agentKey: string,
): { domain_id: string | null; resolved_from: string; confidence: string } {
  let effectiveSessionId = sessionId;

  // If dag_task_id provided but no sessionId, resolve sessionId from session_map
  if (dagTaskId && !effectiveSessionId) {
    try {
      const { getDb } = require("../../lib/db-manager");
      const db = getDb();
      const row = db
        .query(
          "SELECT session_id FROM session_map WHERE dag_task_id = ? ORDER BY updated_at DESC LIMIT 1",
        )
        .get(dagTaskId) as { session_id: string } | null;
      if (row?.session_id) {
        effectiveSessionId = row.session_id;
      }
    } catch {}
  }

  if (!effectiveSessionId) {
    return { domain_id: null, resolved_from: "none", confidence: "none" };
  }

  // Priorities 1-2: session_map → child_slot → ctx/ files
  const resolved = resolveDomainIdWithSource(effectiveSessionId);
  if (resolved.value) {
    const confidence =
      resolved.resolved_from === "session_map" ? "high" : "medium";
    return {
      domain_id: resolved.value,
      resolved_from: resolved.resolved_from,
      confidence,
    };
  }

  // Priority 3: agent_domain_map fallback from project.config.json
  try {
    const root = process.env.OPENCODE_ROOT || ".";
    const cfg = JSON.parse(
      fs.readFileSync(
        path.join(root, ".opencode", "project.config.json"),
        "utf8",
      ),
    );
    const agentMap = cfg?.agent_domain_map;
    if (agentMap && typeof agentMap === "object") {
      const name = toDisplayName(agentKey);
      const domainId =
        agentMap[name] || agentMap["@" + name] || agentMap[agentKey];
      if (domainId) {
        return { domain_id: domainId, resolved_from: "agent_domain_map", confidence: "medium" };
      }
    }
  } catch {}

  return { domain_id: null, resolved_from: "none", confidence: "none" };
}
