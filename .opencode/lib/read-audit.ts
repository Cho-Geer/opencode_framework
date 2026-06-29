// read-audit.ts — RE-EXPORT BRIDGE
// All logic moved to service/file-guard/read-audit-write.ts + read-audit-verify.ts.
// Phase 1a migration.

export { recordRead, normalizeReadAuditPath, normalizeAgent, makeEventKey } from "../service/file-guard/read-audit-write";
export type { ReadAuditEntry } from "../service/file-guard/read-audit-write";
export { verifyRead, verifyNonEmptyReadSet, getReadEventsForSession, getReadMaxAgeMs, READ_MAX_AGE_MS } from "../service/file-guard/read-audit-verify";
export type { ReadVerifyResult } from "../service/file-guard/read-audit-verify";
