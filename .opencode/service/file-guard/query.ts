// service/file-guard/query.ts — Read-only query interface
// Only SELECT operations for Plugin (Middleware) consumption
// 禁止任何 INSERT/UPDATE/DELETE

import { resolveBaseline, captureStat, type StatSnapshot } from "./baseline";
import { getBackup, findLatestBackup as findLatestGitBackup, type BackupRecord } from "./backup";
import { getReadEventsForSession, verifyRead, type ReadAuditEntry, type ReadVerifyResult } from "./read-audit-verify";

export {
  // Baseline queries
  resolveBaseline as getFileBaseline,
  captureStat,
  // Backup queries
  getBackup as getBackupInfo,
  findLatestGitBackup,
  // Read audit queries
  getReadEventsForSession,
  verifyRead,
};

export type { StatSnapshot, BackupRecord, ReadAuditEntry, ReadVerifyResult };
