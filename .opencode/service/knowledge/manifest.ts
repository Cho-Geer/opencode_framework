// manifest-bridge.ts — Re-export bridge for manifest module
// Replaces the original manifest.ts public API surface.
// All external consumers import from "./manifest" (this file).

export {
  readManifestFromDb,
  upsertEntryInDb,
  getEntryFilesFromDb,
  getEntryTagsFromDb,
} from "./manifest-db";

export {
  materializeManifestFromDb,
} from "./manifest-materialize";
