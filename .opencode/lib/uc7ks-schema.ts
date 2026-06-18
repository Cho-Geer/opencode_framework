/**
 * uc7ks-schema.ts — UC7KS nested session_access schema helpers
 * =============================================================
 * BUN-CACHE-VERSION: 2026-06-18-UC7KS-PHASE0 (discovery/attestation dual-structure)
 *
 * Defines the nested `tasks[task_id].domains[domain_id]` schema and
 * backward-compatible reader/writer helpers. All UC7KS pipeline tools
 * and enforcement layers read through these functions.
 *
 * Schema:
 *   session_access[agent].tasks[task_id].domains[domain_id]:
 *     { declared_at, pipeline_status, kc_dispatched, cache_sufficiency: {
 *         discovery: { status, discovered_files, discovered_at },
 *         attestation: { status, reason, files_read, content_summary, attested_at }
 *       }
 *     }
 *
 * Phase 0 (2026-06-18): Separated machine discovery (knowledge_cache_search)
 * from agent read evidence (knowledge_cache_attest). Legacy flat fields
 * (pipeline_task_id, declared_scope, cache_sufficiency) kept for migration
 * bridge but no longer used as authoritative write-block evidence.
 *
 * @author @Super-Admin
 * @version 1.0.0
 * @since 2026-06-11
 * @module uc7ks-schema
 */

import * as fs from "node:fs";
import * as path from "node:path";

// CONFIGURATION KEYS (F7: parameterized per Templatization System)

/** template_resolution keys used by knowledge pipeline tools */
export const CONFIG_KEYS = {
  /** Controls log verbosity for debug/operational messages */
  LOGS_LEVEL: "logs.level",
  /** Log directory path */
  LOGS_DIR: "logs.dir",
  /** Log retention in days */
  LOGS_RETENTION_DAYS: "logs.retention_days",
} as const;

// TYPES

export interface CacheSufficiency {
  status: "sufficient" | "insufficient" | "undeclared";
  missing_topics: string[];
  declared_at: string | null;
  reason: string;
  files_read: string[];
  content_summary: string;
  /** Phase 0 NEW (2026-06-18): Machine-generated cache coverage discovery */
  discovery?: CacheDiscovery;
  /** Phase 0 NEW (2026-06-18): Agent-submitted verified read evidence */
  attestation?: CacheAttestation;
}

/**
 * Phase 0 NEW (2026-06-18): Machine-generated cache coverage discovery.
 * Written by knowledge_cache_search tool. Records what the cache CONTAINS,
 * not what was read by the agent.
 */
export interface CacheDiscovery {
  status: "sufficient" | "insufficient" | "undeclared";
  missing_topics: string[];
  discovered_files: string[];
  discovered_at: string;
}

/**
 * Phase 0 NEW (2026-06-18): Agent-submitted read evidence.
 * Written by knowledge_cache_attest tool after cross-verification against
 * read_audit.jsonl. In strict/locked mode, attestation.status="attested"
 * is the ONLY authoritative source for UC7-001 write-block decisions.
 */
export interface CacheAttestation {
  status: "attested" | "pending" | "skipped" | "legacy_discovered_only";
  reason: string;
  files_read: string[];
  content_summary: string;
  attested_at: string;
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

// PATH RESOLVERS

export function getMachinePath(): string {
  const root = process.env.OPENCODE_ROOT || ".";
  return path.resolve(root, ".opencode", "state", "machine.json");
}

// SCHEMA HELPERS

/** Ensure agent entry exists in session_access */
export function ensureAgentEntry(
  sa: SessionAccess,
  agent: string,
): AgentEntry {
  const agentKey = normalizeAgentKey(agent);
  // Merge any existing flat entry under either the raw key or its normalized form
  const existing = sa[agentKey] || sa[agent] || {};
  sa[agentKey] = {
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
  return sa[agentKey];
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

// BACKWARD-COMPAT READER

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
  const agentKey = normalizeAgentKey(agent);
  const a = sa[agentKey] || sa[agent];
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
  const agentKey = normalizeAgentKey(agent);
  const a = sa[agentKey] || sa[agent];
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
  const agentKey = normalizeAgentKey(agent);
  const a = sa[agentKey] || sa[agent];
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
// CAP MANAGEMENT
// ════════════════════════════════════════════════════════════

/** Max agent entries (F8: increased from 20 → 50 for multi-task expansion) */
export const MAX_AGENTS = 50;

/**
 * Normalize an agent name to the canonical PascalCase key used in
 * machine.json.knowledge_cache_state.session_access.
 *
 * Rules:
 *   - Strip leading "@" prefix
 *   - Map known lowercase/kebab aliases to canonical names
 *   - Leave already-canonical names untouched
 *
 * Examples:
 *   "@super-admin" → "Super-Admin"
 *   "@Coder-BE"    → "Coder-BE"
 *   "orchestrator" → "Orchestrator"
 *   "Super-Admin"  → "Super-Admin"
 */
export function normalizeAgentKey(raw: string): string {
  const stripped = (raw || "").replace(/^@/, "");
  const map: Record<string, string> = {
    "meta-planner": "Meta-Planner",
    "orchestrator": "Orchestrator",
    "architect": "Architect",
    "coder-be": "Coder-BE",
    "coder-fe": "Coder-FE",
    "guardian": "Guardian",
    "arbiter": "Arbiter",
    "ci-cd-agent": "CI-CD-Agent",
    "knowledge-curator": "Knowledge-Curator",
    "super-admin": "Super-Admin",
    "plan": "Meta-Planner", // legacy misnomer: "plan" scope was recorded as agent
  };
  return map[stripped.toLowerCase()] || stripped;
}

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

// ════════════════════════════════════════════════════════════
// PHASE 0 NEW (2026-06-18): Discovery/Attestation Helpers
// UC7-001 READ-BEFORE-WRITE — separates machine discovery from
// agent-read evidence. Used by checkUC7KSWrite() in uc7ks-utils.ts
// and by knowledge_cache_attest tool.
// ════════════════════════════════════════════════════════════

/**
 * Read the cache discovery for a specific domain+task.
 * Tries nested path first, falls back to legacy cache_sufficiency.
 * Returns null if no discovery exists.
 */
export function readCacheDiscovery(
  sa: SessionAccess,
  agent: string,
  taskId: string,
  domain: string,
): CacheDiscovery | null {
  const agentKey = normalizeAgentKey(agent);
  const a = sa[agentKey] || sa[agent];
  if (!a) return null;

  // Try nested discovery field
  const nested = a.tasks?.[taskId]?.domains?.[domain];
  if (nested?.cache_sufficiency?.discovery) {
    return nested.cache_sufficiency.discovery;
  }

  // Fall back to legacy cache_sufficiency as discovery (migration bridge)
  const legacy = nested?.cache_sufficiency || a.cache_sufficiency;
  if (legacy && legacy.status && legacy.status !== "undeclared") {
    return {
      status: legacy.status,
      missing_topics: legacy.missing_topics || [],
      discovered_files: legacy.files_read || [],
      discovered_at: legacy.declared_at || new Date(0).toISOString(),
    };
  }

  return null;
}

/**
 * Read the cache attestation for a specific domain+task.
 * Returns null if no attestation exists (not yet attested by agent).
 */
export function readCacheAttestation(
  sa: SessionAccess,
  agent: string,
  taskId: string,
  domain: string,
): CacheAttestation | null {
  const agentKey = normalizeAgentKey(agent);
  const a = sa[agentKey] || sa[agent];
  if (!a) return null;

  const nested = a.tasks?.[taskId]?.domains?.[domain];
  if (nested?.cache_sufficiency?.attestation) {
    return nested.cache_sufficiency.attestation;
  }

  // Legacy data: auto-migrate to "legacy_discovered_only" (not "attested")
  const legacy = nested?.cache_sufficiency;
  if (legacy?.status === "sufficient") {
    // Legacy sufficient without attestation → treated as unverified
    return {
      status: "legacy_discovered_only",
      reason: "Auto-migrated from legacy cache_sufficiency (not verified against read_audit.jsonl)",
      files_read: legacy.files_read || [],
      content_summary: legacy.content_summary || "",
      attested_at: legacy.declared_at || "",
    };
  }

  return null;
}

/**
 * Check if a domain has been attested (verified read evidence).
 * In strict/locked mode, returns true ONLY for status="attested".
 * In advisory mode, also accepts legacy_discovered_only.
 *
 * §2.7 Legacy compat: only "attested" passes write-block in strict/locked.
 */
export function isDomainKnowledgeAttested(
  sa: SessionAccess,
  agent: string,
  taskId: string,
  domain: string,
  mode: string,
): boolean {
  const att = readCacheAttestation(sa, agent, taskId, domain);
  if (!att) return false;
  if (att.status === "attested") return true;
  // Advisory mode: accept legacy data as attested for transition period
  if (mode === "advisory" && att.status === "legacy_discovered_only") return true;
  return false;
}

/**
 * Write discovery data to the domain entry. Only updates discovery fields.
 * Does NOT touch attestation or legacy reason/files_read/content_summary.
 */
export function writeCacheDiscovery(
  sa: SessionAccess,
  agent: string,
  taskId: string,
  domain: string,
  discovery: CacheDiscovery,
): void {
  const entry = getDomainEntry(sa, agent, taskId, domain);
  entry.cache_sufficiency.discovery = discovery;
  // Sync legacy status for backward compat display
  entry.cache_sufficiency.status = discovery.status;
  entry.cache_sufficiency.missing_topics = discovery.missing_topics;
  entry.cache_sufficiency.declared_at = discovery.discovered_at;
  // Legacy reason/files_read/content_summary are NOT set — they must be
  // agent-written via knowledge_cache_attest tool
}

/**
 * Write attestation data to the domain entry. Verifies discovery exists.
 * Returns true on success, false if discovery is insufficient.
 */
export function writeCacheAttestation(
  sa: SessionAccess,
  agent: string,
  taskId: string,
  domain: string,
  attestation: CacheAttestation,
): boolean {
  const entry = getDomainEntry(sa, agent, taskId, domain);
  const discovery = entry.cache_sufficiency.discovery;
  if (!discovery || discovery.status !== "sufficient") {
    return false;
  }
  entry.cache_sufficiency.attestation = attestation;
  return true;
}

/**
 * Read uc7ks_attestation_required from project.config.json.
 * Defaults to "advisory" for gray-scale rollout. Locked mode
 * always requires attestation regardless of config.
 */
export function readAttestationRequired(): "advisory" | "strict" {
  try {
    const root = process.env.OPENCODE_ROOT || ".";
    const configPath = path.resolve(root, ".opencode", "project.config.json");
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const val = cfg.uc7ks_attestation_required;
      if (val === "strict") return "strict";
    }
  } catch { /* fall through */ }
  return "advisory";
}
