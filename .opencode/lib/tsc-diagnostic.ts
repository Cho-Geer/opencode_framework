// tsc-diagnostic.ts — RE-EXPORT BRIDGE
// All logic moved to service/file-guard/tsc-diagnostic.ts.
// Phase 1 migration (Batch 1).

export {
  runTscDiagnostic,
  parseAllTscOutput,
  parseTscOutput,
} from "../service/file-guard/tsc-diagnostic";
export type {
  TscDiagnosticResult,
  TscDiagnosticError,
} from "../service/file-guard/tsc-diagnostic";
