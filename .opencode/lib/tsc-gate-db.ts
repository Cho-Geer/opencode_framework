// tsc-gate-db.ts — RE-EXPORT BRIDGE
// All logic moved to service/file-guard/tsc-gate-locks.ts.
// Phase 1 migration (Batch 1).

export {
  acquireFileLock,
  releaseFileLock,
  releaseAllFileLocks,
  acquireTscMutex,
  releaseTscMutex,
  logTscGateEvent,
  resetTscGateLocks,
  cleanExpiredLocks,
} from "../service/file-guard/tsc-gate-locks";
