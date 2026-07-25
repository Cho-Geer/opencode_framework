// backup-manager.ts — RE-EXPORT BRIDGE
// All logic moved to service/file-guard/backup.ts.
// Phase 1a migration.

export {
  createBackup, getBackup, findLatestBackup,
  getBackupsByFile, getBackupsByAgent, getBackupsBySession,
  getBackupsByDagTask, restoreBackup, cleanupStaleBackups,
} from "../service/file-guard/backup";
export type { BackupCreateInput, BackupRecord } from "../service/file-guard/backup";
