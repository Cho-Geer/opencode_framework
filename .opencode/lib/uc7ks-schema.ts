/**
 * uc7ks-schema.ts — UC7KS nested session_access schema helpers
 * =============================================================
 * BUN-CACHE-VERSION: 2026-06-11-FW-BATCH-A (nested per-task-per-domain)
 *
 * Defines the nested `tasks[task_id].domains[domain_id]` schema and
 * backward-compatible reader/writer helpers. All UC7KS pipeline tools
 * and enforcement layers read through these functions.
 *
 * Schema:
 *   session_access[agent].tasks[task_id].domains[domain_id]:
 *     { declared_at, pipeline_status, kc_dispatched, cache_sufficiency }
 *
 * Legacy flat fields (pipeline_task_id, declared_scope, cache_sufficiency)
 * are kept as migration bridge but no longer written by new code.
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-11
 * @module uc7ks-schema
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ════════════════════════════════════════════════════════════
// CONFIGURATION KEYS (F7: parameterized per Templatization System)
// ════════════════════════════════════════════════════════════

/** template_resolution keys used by knowledge pipeline tools */
export const CONFIG_KEYS = {
  /** Controls log verbosity for debug/operational messages */
  LOGS_LEVEL: "logs.level",
  /** Log directory path */
  LOGS_DIR: "logs.dir",
  /** Log retention in days */
  LOGS_RETENTION_DAYS: "logs.retention_days",
} as const;

// ════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════

export interface CacheSufficiency {
  status: "sufficient" | "insufficient" | "undeclared";
  missing_topics: string[];
  declared_at: string | null;
  reason: string;
  files_read: string[];
  content_summary: string;
}

export interface DomainEntry {
  declared_at: string | null;
  pipeline_status: "declared" | "completed" | null;
  kc_dispatched?: boolean;
  cache_sufficiency: CacheSufficiency;
}

export interface TaskEntry {
  domains: Record<string, DomainEntry>;
}

/** Legacy flat agent entry (deprecated, read-only after migration) */
export interface LegacyAgentEntry {
  pipeline_task_id?: string;
  declared_scope?: string;
  pipeline_status?: string;
  declared_at?: string;
  cache_sufficiency?: Partial<CacheSufficiency>;
  last_read_at?: string;
  total_cache_reads?: number;
}

export interface AgentEntry extends LegacyAgentEntry {
  tasks?: Record<string, TaskEntry>;
  last_read_at: string;
  total_cache_reads: number;
}

export interface SessionAccess {
  [agent: string]: AgentEntry;
}

// ════════════════════════════════════════════════════════════
// PATH RESOLVERS
// ════════════════════════════════════════════════════════════

export function getMachinePath(): string {
  const root = process.env.OPENCODE_ROOT || ".";
  return path.resolve(root, ".opencode", "state", "machine.json");
}

// ════════════════════════════════════════════════════════════
// SCHEMA HELPERS
// ════════════════════════════════════════════════════════════

/** Ensure agent entry exists in session_access */
export function ensureAgentEntry(
  sa: SessionAccess,
  agent: string,
): AgentEntry {
  const agentKey = agent.replace(/^@/, "");
  // Merge any existing flat entry under either key
  const existing = sa[agent] || sa[agentKey] || {};
  sa[agent] = {
    last_read_at: existing.last_read_at || new Date().toISOString(),
    total_cache_reads: existing.total_cache_reads || 0,
    tasks: existing.tasks || {},
    // Preserve legacy flat fields for backward compat
    pipeline_task_id: existing.pipeline_task_id,
    declared_scope: existing.declared_scope,
    pipeline_status: existing.pipeline_status,
    declared_at: existing.declared_at,
    cache_sufficiency: existing.cache_sufficiency,
  } as AgentEntry;
  return sa[agent];
}

/** Get or create a domain entry for a specific task */
export function getDomainEntry(
  sa: SessionAccess,
  agent: string,
  taskId: string,
  domain: string,
): DomainEntry {
  const a = ensureAgentEntry(sa, agent);
  a.tasks = a.tasks || {};
  a.tasks[taskId] = a.tasks[taskId] || { domains: {} };
  a.tasks[taskId].domains[domain] = a.tasks[taskId].domains[domain] || {
    declared_at: null,
    pipeline_status: null,
    kc_dispatched: false,
    cache_sufficiency: {
      status: "undeclared",
      missing_topics: [],
      declared_at: null,
      reason: "",
      files_read: [],
      content_summary: "",
    },
  };
  return a.tasks[taskId].domains[domain];
}

/** Update agent-level rollups */
export function updateAgentRollups(
  sa: SessionAccess,
  agent: string,
): void {
  const a = ensureAgentEntry(sa, agent);
  a.last_read_at = new Date().toISOString();
  a.total_cache_reads = (a.total_cache_reads || 0) + 1;
}

// ════════════════════════════════════════════════════════════
// BACKWARD-COMPAT READER
// ════════════════════════════════════════════════════════════

/**
 * Read cache_sufficiency for a specific domain and task.
 * Tries nested path first, falls back to legacy flat fields.
 * Returns null if neither exists.
 */
export function readCacheSufficiency(
  sa: SessionAccess,
  agent: string,
  taskId: string,
  domain: string,
): CacheSufficiency | null {
  const a = sa[agent] || sa[agent.replace(/^@/, "")];
  if (!a) return null;

  // Try nested path
  const nested = a.tasks?.[taskId]?.domains?.[domain]?.cache_sufficiency;
  if (nested && nested.status && nested.status !== "undeclared") {
    return nested;
  }

  // Fall back to legacy flat
  const flat = a.cache_sufficiency;
  if (flat && flat.status && flat.status !== "undeclared") {
    return {
      status: flat.status,
      missing_topics: flat.missing_topics || [],
      declared_at: flat.declared_at || null,
      reason: flat.reason || "",
      files_read: flat.files_read || [],
      content_summary: flat.content_summary || "",
    };
  }

  return null;
}

/**
 * Find an agent that has completed the pipeline for a given task_id.
 * Searches nested tasks first, then legacy flat fields.
 * Used by compliance-gate.ts to match sessions to pipeline state.
 */
export function findPipelineAgent(
  sa: SessionAccess,
  taskId: string,
): string | null {
  const agents = Object.keys(sa);
  for (const agent of agents) {
    const a = sa[agent];
    // Check nested tasks
    if (a.tasks?.[taskId]) {
      const domains = Object.values(a.tasks[taskId].domains || {});
      if (domains.some((d) => d.pipeline_status === "completed")) {
        return agent;
      }
    }
    // Check legacy flat
    if (a.pipeline_task_id === taskId && a.pipeline_status === "completed") {
      return agent;
    }
  }
  return null;
}

/**
 * Check if a domain has completed the pipeline for a task.
 */
export function isPipelineCompleted(
  sa: SessionAccess,
  agent: string,
  taskId: string,
  domain: string,
): boolean {
  const a = sa[agent] || sa[agent.replace(/^@/, "")];
  if (!a) return false;
  // Check nested
  if (a.tasks?.[taskId]?.domains?.[domain]?.pipeline_status === "completed") {
    return true;
  }
  // Check legacy flat
  if (
    a.pipeline_task_id === taskId &&
    a.pipeline_status === "completed" &&
    a.declared_scope === domain
  ) {
    return true;
  }
  return false;
}

/**
 * Check if a domain has been declared for a task (before cache search).
 */
export function isPipelineDeclared(
  sa: SessionAccess,
  agent: string,
  taskId: string,
  domain: string,
): boolean {
  const a = sa[agent] || sa[agent.replace(/^@/, "")];
  if (!a) return false;
  // Check nested
  if (a.tasks?.[taskId]?.domains?.[domain]?.pipeline_status === "declared") {
    return true;
  }
  // Check legacy flat
  if (
    a.pipeline_task_id === taskId &&
    a.pipeline_status === "declared" &&
    a.declared_scope === domain
  ) {
    return true;
  }
  return false;
}

/**
 * Get all domains with sufficient cache for a task.
 * Used by compliance-gate.ts to validate multi-domain coverage.
 */
export function getSufficientDomains(
  sa: SessionAccess,
  taskId: string,
): Array<{ agent: string; domain: string; sufficiency: CacheSufficiency }> {
  const results: Array<{
    agent: string;
    domain: string;
    sufficiency: CacheSufficiency;
  }> = [];
  for (const agent of Object.keys(sa)) {
    const a = sa[agent];
    const tasks = a.tasks || {};
    for (const tid of Object.keys(tasks)) {
      if (tid !== taskId) continue;
      for (const domain of Object.keys(tasks[tid].domains || {})) {
        const d = tasks[tid].domains[domain];
        if (d.cache_sufficiency?.status === "sufficient") {
          results.push({
            agent,
            domain,
            sufficiency: d.cache_sufficiency,
          });
        }
      }
    }
    // Legacy flat fallback
    if (
      a.pipeline_task_id === taskId &&
      a.pipeline_status === "completed" &&
      a.cache_sufficiency?.status === "sufficient"
    ) {
      results.push({
        agent,
        domain: a.declared_scope || "unknown",
        sufficiency: {
          status: a.cache_sufficiency.status,
          missing_topics: a.cache_sufficiency.missing_topics || [],
          declared_at: a.cache_sufficiency.declared_at || null,
          reason: a.cache_sufficiency.reason || "",
          files_read: a.cache_sufficiency.files_read || [],
          content_summary: a.cache_sufficiency.content_summary || "",
        },
      });
    }
  }
  return results;
}

// ════════════════════════════════════════════════════════════
// ATOMIC WRITE (CAS)
// ════════════════════════════════════════════════════════════

/**
 * Write machine.json with CAS (compare-and-swap) on meta.revision.
 * Retries up to maxRetries on concurrent modification.
 * Returns true if write succeeded, false if retries exhausted.
 *
 * @param modifyFn — Called with parsed machine object, should modify in place
 * @param maxRetries — Max retry count (default 3)
 */
export function atomicWriteMachine(
  modifyFn: (machine: any) => void,
  maxRetries: number = 3,
): boolean {
  const machinePath = getMachinePath();
  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      if (!fs.existsSync(machinePath)) return false;
      const raw = fs.readFileSync(machinePath, "utf8");
      const machine = JSON.parse(raw);
      const prevRev = machine.meta?.revision || 0;

      modifyFn(machine);

      // Increment revision for CAS
      machine.meta = machine.meta || {};
      machine.meta.revision = prevRev + 1;

      const tmpPath = machinePath + ".tmp." + Date.now() + "." + retry;
      fs.writeFileSync(tmpPath, JSON.stringify(machine, null, 2), "utf8");
      fs.renameSync(tmpPath, machinePath);

      // Verify write took effect
      const postRaw = fs.readFileSync(machinePath, "utf8");
      const post = JSON.parse(postRaw);
      if ((post.meta?.revision || 0) === prevRev + 1) {
        return true;
      }
      // CAS failed — another writer modified it, retry
    } catch (e) {
      if (retry === maxRetries - 1) return false;
    }
  }
  return false;
}

// ════════════════════════════════════════════════════════════
// CAP MANAGEMENT
// ════════════════════════════════════════════════════════════

/** Max agent entries (F8: increased from 20 → 50 for multi-task expansion) */
export const MAX_AGENTS = 50;

/** Evict oldest agent entries when cap exceeded */
export function evictOldAgents(sa: SessionAccess): void {
  const keys = Object.keys(sa);
  if (keys.length <= MAX_AGENTS) return;

  const sorted = keys.sort((a, b) => {
    const ta = new Date(sa[a]?.last_read_at || sa[a]?.declared_at || 0).getTime();
    const tb = new Date(sa[b]?.last_read_at || sa[b]?.declared_at || 0).getTime();
    return ta - tb;
  });
  const toRemove = sorted.slice(0, keys.length - MAX_AGENTS);
  for (const k of toRemove) {
    delete sa[k];
  }
}
