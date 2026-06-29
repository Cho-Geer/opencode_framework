// service/knowledge/index.ts — Unified entry point for KnowledgeService
// Phase 1f: Re-exports from all knowledge service modules

// ── Knowledge Store (manifest CRUD + search + materialization) ────────
export type {
  KnowledgeFile,
  KnowledgeEntry,
  KnowledgeManifest,
  ManifestStats,
  AddEntryResult,
  SearchOptions,
  AddEntryParams,
  MaterializationJob,
} from "./types-paths";

export { getIndexPath, getDocsDir } from "./types-paths";

export {
  readManifest,
  writeManifest,
  getStats,
} from "./search-add";

export { materializeManifestFromDb } from "./manifest";

export {
  searchManifest,
  addEntry,
  searchByDomain,
  searchByTags,
  getEntryByLibraryId,
  searchByKeyword,
  materializeToFile,
} from "./search-add";

export {
  getPendingMaterializationJobs,
  retryFailedJobs,
  getIndexJsonPath,
  importManifestFileToDb,
} from "./jobs";

// ── Knowledge Audit ───────────────────────────────────────────────────
export {
  AGGREGATE_KEYS,
  getDefaultAuditState,
  readAuditState,
  writeAuditState,
  atomicUpdateKnowledgeAudit,
  incrementAuditCounter,
  pushAuditEvent,
  touchCacheCheck,
  touchKnowledgeAcquisition,
} from "./audit";
export type { AggregateKey } from "./audit";

// ── UC7KS Pipeline DB ─────────────────────────────────────────────────
export type {
  CacheDiscovery as PipelineCacheDiscovery,
  CacheAttestation as PipelineCacheAttestation,
  PipelineStateRow,
  PipelineDomainSummary,
} from "./pipeline-db";

export {
  resolvePipelineId,
  atomicUpsertDiscovery,
  readDiscoveryForAttest,
  atomicUpsertAttestation,
  queryAttestationForWriteGate,
  readPipelineState,
  queryAllAgentPipelineDomains,
} from "./pipeline-db";

// ── UC7KS Schema ──────────────────────────────────────────────────────
export type {
  CacheSufficiency,
  CacheDiscovery as SchemaCacheDiscovery,
  CacheAttestation as SchemaCacheAttestation,
  DomainEntry,
  TaskEntry,
  LegacyAgentEntry,
  AgentEntry,
  SessionAccess,
  PruneOptions,
  PruneResult,
} from "./schema";

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
