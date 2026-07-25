// knowledge-store.ts — Bridge → service/knowledge/*
// ═══════════════════════════════════════════════════════════════════════
// Phase 1f: Thin re-export bridge. Original 1572L file split into:
//   - service/knowledge/types-paths.ts (types, paths, lock)
//   - service/knowledge/manifest.ts    (DB core, readManifest, writeManifest, getStats)
//   - service/knowledge/search-add.ts  (searchManifest, addEntry, convenience)
//   - service/knowledge/jobs.ts        (materialization jobs, retry)
// All existing import paths remain valid through this bridge.
// ═══════════════════════════════════════════════════════════════════════

// ── Types ─────────────────────────────────────────────────────────────
export type {
  KnowledgeFile,
  KnowledgeEntry,
  KnowledgeManifest,
  ManifestStats,
  AddEntryResult,
  SearchOptions,
  AddEntryParams,
  MaterializationJob,
} from "../service/knowledge/types-paths";

// ── Manifest I/O ──────────────────────────────────────────────────────
export {
  readManifest,
  writeManifest,
  getStats,
} from "../service/knowledge/search-add";

// ── Search + Add ──────────────────────────────────────────────────────
export {
  searchManifest,
  addEntry,
  searchByDomain,
  searchByTags,
  getEntryByLibraryId,
  searchByKeyword,
  materializeToFile,
} from "../service/knowledge/search-add";

// ── Jobs + Paths ──────────────────────────────────────────────────────
export {
  getPendingMaterializationJobs,
  retryFailedJobs,
  getIndexJsonPath,
  importManifestFileToDb,
} from "../service/knowledge/jobs";
