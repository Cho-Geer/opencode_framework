// service/file-guard/tsc-gate.ts — TSC gate lock management
// Wraps tsc-gate-locks for Service layer invariant

import { writeLog } from "../../lib/log-manager";
import {
  cleanExpiredLocks,
  resetTscGateLocks,
  acquireFileLock,
  releaseFileLock,
  releaseAllFileLocks,
  acquireTscMutex,
  releaseTscMutex,
  logTscGateEvent,
} from "./tsc-gate-locks";

const SRC = "service-tsc-gate";

// Re-export all lock operations for plugin/tool consumption
export {
  acquireFileLock,
  releaseFileLock,
  releaseAllFileLocks,
  acquireTscMutex,
  releaseTscMutex,
  logTscGateEvent,
  resetTscGateLocks,
  cleanExpiredLocks,
};

/**
 * Clean expired locks + release ALL remaining locks.
 * Used by tsc-gate-reset tool (Super-Admin emergency reset).
 */
export function resetAllTscGateLocks(): { cleaned: number; released: number } {
  const cleaned = cleanExpiredLocks();
  const released = resetTscGateLocks();

  writeLog(SRC, "runtime", {
    event: "TSC-GATE-RESET-ALL",
    detail: `cleaned=${cleaned} released=${released}`,
  });

  return { cleaned, released };
}
