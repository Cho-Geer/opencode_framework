// lib/state-compactor.ts — BRIDGE (Batch 6)
// Logic migrated to service/gate/compactor-core.ts + compactor-schedule.ts
export { StateCompactorBase, COMPACTION_CONFIG, SRC, dbRegenerateGateFiles } from "../service/gate/compactor-core";
export { StateCompactor } from "../service/gate/compactor-schedule";
