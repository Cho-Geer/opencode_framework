// service/knowledge/index.ts — Unified entry point for KnowledgeService
// Phase 1f: Re-exports from all knowledge service modules

// ── Knowledge Store (manifest CRUD + search + materialization) ────────
export type {
  CacheSufficiency,
  CacheDiscovery,
  CacheAttestation,
  DomainEntry,
  TaskEntry,
  LegacyAgentEntry,
  AgentEntry,
  SessionAccess,
} from "./schema";

export type {
  PruneOptions,
  PruneResult,
} from "./prune-attest";

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
} from "./schema";

// ── Pruning + Attestation ─────────────────────────────────────────────
export {
  pruneSessionAccess,
  pruneSessionAccessFromDB,
  readCacheAttestation,
  isDomainKnowledgeAttested,
  readAttestationRequired,
} from "./prune-attest";

// ── Cache Check + Enforcement ─────────────────────────────────────────
export {
  readCacheIndex,
  isLocalCacheAvailable,
  readCachedSessionAccess,
  buildUC7KSError,
  checkUC7KS,
} from "./cache-check";

export { checkUC7KSWrite } from "./enforcement";

// ── Module Scope Declaration ──────────────────────────────────────
export { declareModuleScope } from "./declare-scope";
export type { DeclareModuleScopeInput, DeclareModuleScopeResult } from "./declare-scope";

// ── Gap Report ────────────────────────────────────────────────────
export { gapReport } from "./gap-report";
export type { GapReportResult } from "./gap-report";

// ── Cache Search ────────────────────────────────────────────────────
export { searchCache } from "./cache-search";
export type { SearchCacheInput, SearchCacheResult } from "./cache-search";

// ── Cache Attestation ───────────────────────────────────────────────
export { attestCache } from "./cache-attest";
export type { AttestCacheInput, AttestCacheResult } from "./cache-attest";

// ── Maintenance (Janitor + Nightly Compaction) ──────────────────────
export { runJanitor, nightlyCompaction } from "./maintenance";
export type { RunJanitorOptions, JanitorReport, NightlyCompactionOptions, CompactionReport } from "./maintenance";

// ── Phase 3: After-Hook Tracking (from uc7ks-after hook) ──
export { trackKnowledgeAfter } from "./after-track";

// ── Cache Sync (from cache-after hook) ──────────────────────────────
export { syncCacheState } from "./cache-sync";
