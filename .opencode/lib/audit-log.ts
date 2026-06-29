// audit-log.ts — RE-EXPORT BRIDGE
// All logic moved to service/file-guard/audit.ts.
// Phase 1a migration.

export { writeAuditLogEntry, logAuditEntry, flushAuditTrail } from "../service/file-guard/audit";
