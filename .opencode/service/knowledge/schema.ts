// schema.ts — UC7KS session_access schema types and helpers
// Phase 1f: Split from uc7ks-schema.ts (845L → schema + prune-attest)

/**
 * UC7KS Knowledge Cache Schema — Session Access Types and Helpers
 *
 * Defines the schema for session-level knowledge cache tracking:
 * - SessionAccess: Top-level structure containing all agent entries
 * - AgentEntry: Per-agent record of domain knowledge caching
 * - DomainEntry: Per-domain discovery and attestation state
 * - CacheSufficiency: Aggregated cache readiness check result
 *
 * Also provides helper functions for:
 * - Schema navigation and mutation (ensureAgentEntry, getDomainEntry)
 * - Cache sufficiency reading (readCacheSufficiency)
 * - Pipeline status queries (findPipelineAgent, isPipelineCompleted)
 * - Agent cap management (evictOldAgents, normalizeAgentKey)
 *
 * @since 2026-06-23 (Phase 1f: Split from uc7ks-schema.ts)
 */

import * as path from "node:path";
// getAgentIdentity removed — agent-identity.ts provides normalize/toDisplayName, not state paths

const SRC = "uc7ks-schema";

// ── Configuration Keys ─────────────────────────────────────────────────

export const CONFIG_KEYS = {
  MAX_AGENTS_PER_SESSION: "max_agents_per_session",
  MAX_TASK_AGE_MS: "max_task_age_ms",
  ATTESTATION_REQUIRED: "attestation_required",
  MIN_FILES_FOR_SUFFICIENCY: "min_files_for_sufficiency",
} as const;

// ── Types ──────────────────────────────────────────────────────────────

export interface CacheSufficiency {
  is_sufficient: boolean;
  discovery_status: "undeclared" | "sufficient" | "insufficient";
  attestation_status: "unattested" | "attested" | "insufficient";
  discovered_files: string[];
  missing_topics: string[];
  ready_for_use: boolean;
}

export interface CacheDiscovery {
  status: "undeclared" | "sufficient" | "insufficient";
  discovered_files: string[];
  missing_topics: string[];
  discovered_at: string;
}

export interface CacheAttestation {
  status: "unattested" | "attested" | "insufficient";
  cache_sufficient: boolean;
  files_read: string[];
  content_summary: string;
  attested_at: number;
}

export interface DomainEntry {
  domain_id: string;
  discovery: CacheDiscovery;
  attestation: CacheAttestation;
  last_accessed: number;
  access_count: number;
}

export interface TaskEntry {
  task_id: string;
  session_id: string;
  created_at: number;
  last_accessed: number;
  domains: Record<string, DomainEntry>;
}

export interface LegacyAgentEntry {
  agent: string;
  tasks: Record<string, TaskEntry>;
}

export interface AgentEntry {
  agent_key: string;
  tasks: Record<string, TaskEntry>;
  last_activity: number;
}

export interface SessionAccess {
  session_id: string;
  agents: Record<string, AgentEntry>;
  last_updated: number;
}

// ── Machine Path Helper ────────────────────────────────────────────────

export function getMachinePath(): string {
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  return path.resolve(projectRoot, ".opencode", "state", "machine.json");
}

// ── Schema Helpers ─────────────────────────────────────────────────────

/**
 * Ensure an agent entry exists in the session access record.
 * Creates the entry if it doesn't exist, initializing with empty tasks.
 */
export function ensureAgentEntry(
  sessionAccess: SessionAccess,
  agentKey: string,
): AgentEntry {
  const normalizedKey = normalizeAgentKey(agentKey);
  if (!sessionAccess.agents[normalizedKey]) {
    sessionAccess.agents[normalizedKey] = {
      agent_key: normalizedKey,
      tasks: {},
      last_activity: Date.now(),
    };
  }
  return sessionAccess.agents[normalizedKey];
}

/**
 * Get a domain entry from an agent's task record.
 * Returns null if the domain doesn't exist in the task.
 */
export function getDomainEntry(
  taskEntry: TaskEntry,
  domainId: string,
): DomainEntry | null {
  return taskEntry.domains[domainId] || null;
}

/**
 * Update agent-level rollup statistics after domain changes.
 * Updates last_activity timestamp and ensures consistency.
 */
export function updateAgentRollups(
  sessionAccess: SessionAccess,
  agentKey: string,
): void {
  const normalizedKey = normalizeAgentKey(agentKey);
  const agent = sessionAccess.agents[normalizedKey];
  if (agent) {
    agent.last_activity = Date.now();
    sessionAccess.last_updated = Date.now();
  }
}

// ── Reader ─────────────────────────────────────────────────────────────

/**
 * Read cache sufficiency status for a specific domain from session access.
 * Aggregates discovery and attestation status to determine if cache is ready.
 */
export function readCacheSufficiency(
  sessionAccess: SessionAccess,
  agentKey: string,
  taskId: string,
  domainId: string,
): CacheSufficiency {
  const normalizedKey = normalizeAgentKey(agentKey);
  const agent = sessionAccess.agents[normalizedKey];
  if (!agent) {
    return {
      is_sufficient: false,
      discovery_status: "undeclared",
      attestation_status: "unattested",
      discovered_files: [],
      missing_topics: [],
      ready_for_use: false,
    };
  }

  const task = agent.tasks[taskId];
  if (!task) {
    return {
      is_sufficient: false,
      discovery_status: "undeclared",
      attestation_status: "unattested",
      discovered_files: [],
      missing_topics: [],
      ready_for_use: false,
    };
  }

  const domain = task.domains[domainId];
  if (!domain) {
    return {
      is_sufficient: false,
      discovery_status: "undeclared",
      attestation_status: "unattested",
      discovered_files: [],
      missing_topics: [],
      ready_for_use: false,
    };
  }

  const discovery = domain.discovery;
  const attestation = domain.attestation;

  return {
    is_sufficient: discovery.status === "sufficient",
    discovery_status: discovery.status,
    attestation_status: attestation.status,
    discovered_files: discovery.discovered_files,
    missing_topics: discovery.missing_topics,
    ready_for_use:
      discovery.status === "sufficient" && attestation.status === "attested",
  };
}

// ── Pipeline Helpers ───────────────────────────────────────────────────

/**
 * Find an agent entry by normalized key in session access.
 * Returns null if the agent doesn't exist.
 */
export function findPipelineAgent(
  sessionAccess: SessionAccess,
  agentKey: string,
): AgentEntry | null {
  const normalizedKey = normalizeAgentKey(agentKey);
  return sessionAccess.agents[normalizedKey] || null;
}

/**
 * Check if all domains for an agent's task have completed discovery.
 * Returns true if all domains have status "sufficient".
 */
export function isPipelineCompleted(
  sessionAccess: SessionAccess,
  agentKey: string,
  taskId: string,
): boolean {
  const agent = findPipelineAgent(sessionAccess, agentKey);
  if (!agent) return false;

  const task = agent.tasks[taskId];
  if (!task) return false;

  const domains = Object.values(task.domains);
  if (domains.length === 0) return false;

  return domains.every((d) => d.discovery.status === "sufficient");
}

/**
 * Check if all domains for an agent's task have been declared (discovered).
 * Returns true if no domains have status "undeclared".
 */
export function isPipelineDeclared(
  sessionAccess: SessionAccess,
  agentKey: string,
  taskId: string,
): boolean {
  const agent = findPipelineAgent(sessionAccess, agentKey);
  if (!agent) return false;

  const task = agent.tasks[taskId];
  if (!task) return false;

  const domains = Object.values(task.domains);
  if (domains.length === 0) return false;

  return domains.every((d) => d.discovery.status !== "undeclared");
}

/**
 * Get all domains with sufficient discovery status for an agent's task.
 * Returns array of DomainEntry objects that are ready for attestation.
 */
export function getSufficientDomains(
  sessionAccess: SessionAccess,
  agentKey: string,
  taskId: string,
): DomainEntry[] {
  const agent = findPipelineAgent(sessionAccess, agentKey);
  if (!agent) return [];

  const task = agent.tasks[taskId];
  if (!task) return [];

  return Object.values(task.domains).filter(
    (d) => d.discovery.status === "sufficient",
  );
}

// ── Cap Management ─────────────────────────────────────────────────────

export const MAX_AGENTS = 10;

/**
 * Normalize agent key by removing @ prefix and lowercasing.
 * Ensures consistent agent identification across the system.
 */
export function normalizeAgentKey(agent: string): string {
  return (agent || "").replace(/^@/, "").toLowerCase();
}

/**
 * Evict oldest agents when the count exceeds MAX_AGENTS.
 * Removes agents with oldest last_activity timestamps first.
 * Returns the number of agents evicted.
 */
export function evictOldAgents(sessionAccess: SessionAccess): number {
  const agents = Object.entries(sessionAccess.agents);
  if (agents.length <= MAX_AGENTS) {
    return 0;
  }

  // Sort by last_activity ascending (oldest first)
  agents.sort((a, b) => a[1].last_activity - b[1].last_activity);

  const toEvict = agents.length - MAX_AGENTS;
  let evicted = 0;

  for (let i = 0; i < toEvict; i++) {
    const [key] = agents[i];
    delete sessionAccess.agents[key];
    evicted++;
  }

  if (evicted > 0) {
    sessionAccess.last_updated = Date.now();
  }

  return evicted;
}
