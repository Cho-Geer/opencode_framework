// gate-checks.ts — BRIDGE → service/gate/checks.ts
// Phase 1b migration: all logic moved to service/gate/checks.ts

export {
  setPluginHooksCount,
  checkPluginIntegrity,
  findTaskInDag,
  isWriteAllowed,
  checkStaleSessions,
  autoDrainStaleSessions,
  checkRuleRegistryIntegrity,
  checkMachineCleanliness,
} from "../service/gate/checks";
