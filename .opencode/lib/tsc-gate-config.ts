// tsc-gate-config.ts — RE-EXPORT BRIDGE
// All logic moved to service/file-guard/tsc-gate-config.ts.
// Phase 1 migration (Batch 1).

export { getTscGateConfig } from "../service/file-guard/tsc-gate-config";
export type { TscGateConfig } from "../service/file-guard/tsc-gate-config";
