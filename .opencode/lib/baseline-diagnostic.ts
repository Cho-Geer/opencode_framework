// baseline-diagnostic.ts — RE-EXPORT BRIDGE
// All logic moved to service/file-guard/diagnostic-baseline.ts.
// Phase 1a migration.

export {
  captureBaseline, parseTscBaseline, hashTscOutput,
  compareWithBaseline, recordBaselineDrift,
} from "../service/file-guard/diagnostic-baseline";
