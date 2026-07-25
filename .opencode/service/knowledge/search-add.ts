// search-add-bridge.ts — Re-export bridge for search-add module
// Replaces the original search-add.ts public API surface.
// All external consumers import from "./search-add" (this file).

export {
  readManifest,
  searchManifest,
  getStats,
  searchByDomain,
  searchByTags,
  getEntryByLibraryId,
  searchByKeyword,
  materializeToFile,
} from "./search-add-read";

export {
  writeManifest,
  addEntry,
} from "./search-add-write";
