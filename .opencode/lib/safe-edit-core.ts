// safe-edit-core.ts — RE-EXPORT BRIDGE
// All logic moved to service/file-guard/. Preserves backward compat.
// Phase 1a migration. Phase 6 cleanup: file-based backup helpers removed
// (only consumer diff-verify.ts switched to git-based backup in service/file-guard/backup.ts).

export {
  writeSafe, writeSafeFull, safeDelete, safeMkdir, restore,
  validateEdit, generateDiff, safeEdit,
} from "../service/file-guard/execute";
export { acquireLock } from "../service/file-guard/lock";
export {
  captureStat, statsEqual, clearRegistry,
} from "../service/file-guard/baseline";
export type {
  EditValidation, DiffResult, WriteOptions, WriteResult, RestoreResult,
  StatSnapshot,
} from "../service/file-guard";
