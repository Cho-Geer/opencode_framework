// gate-stale.ts — BRIDGE → service/gate/stale.ts
// Phase 1b migration: all logic moved to service/gate/stale.ts

export {
  readGateStaleThresholds,
  readGateStaleThreshold,
} from "../service/gate/stale";

export type { GateStaleThresholds } from "../service/gate/stale";
