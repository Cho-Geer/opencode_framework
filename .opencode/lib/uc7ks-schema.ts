// uc7ks-schema.ts — Bridge → service/knowledge/schema + prune-attest
// ═══════════════════════════════════════════════════════════════════════
// Phase 1f: Thin re-export bridge. Original 845L file split into:
//   - service/knowledge/schema.ts       (types, helpers, cap management)
//   - service/knowledge/prune-attest.ts (pruning, attestation)
// ═══════════════════════════════════════════════════════════════════════

// ── Types ─────────────────────────────────────────────────────────────
export type {
  CacheSufficiency,
  CacheDiscovery,
  CacheAttestation,
  DomainEntry,
  TaskEntry,
  LegacyAgentEntry,
  AgentEntry,
  SessionAccess,
} from "../service/knowledge/schema";

export type {
  PruneOptions,
  PruneResult,
} from "../service/knowledge/prune-attest";

// ── Schema helpers (from schema.ts) ───────────────────────────────────
export {
  CONFIG_KEYS,
  getMachinePath,
  ensureAgentEntry,
  getDomainEntry,
  updateAgentRollups,
  readCacheSufficiency,
  findPipelineAgent,
  isPipelineCompleted,
  isPipelineDeclared,
  getSufficientDomains,
  MAX_AGENTS,
  normalizeAgentKey,
  evictOldAgents,
} from "../service/knowledge/schema";

// ── Pruning + Attestation (from prune-attest.ts) ──────────────────────
export {
  pruneSessionAccess,
  pruneSessionAccessFromDB,
  readCacheAttestation,
  isDomainKnowledgeAttested,
  readAttestationRequired,
} from "../service/knowledge/prune-attest";
