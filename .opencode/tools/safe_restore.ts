/**
 * safe_restore.ts — Backup Restore Tool (UUID-based)
 * ====================================================
 *
 * Restores a file from a backup identified by UUID.
 * Backups are created by safe_edit and safe_delete via backup-manager.ts.
 * Uses atomic restore (tmp -> rename) for crash safety.
 *
 * @author @Super-Admin
 * @since 2026-06-24 — v2.0: UUID-based restore
 */

import { tool } from "@opencode-ai/plugin";
import {
  restoreBackup,
  getBackup,
  type BackupRecord,
} from "../service/file-guard";
import { withInterruptGuard } from "../lib";

export default tool({
  description:
    "Restore a file from a backup created by safe_edit or safe_delete. " +
    "Uses atomic restore (copy to temp -> rename) for crash safety. " +
    "Call this when you need to rollback a file modification.",
  args: {
    uuid: tool.schema.string().describe("UUID of the backup to restore from"),
  },
  async execute(args, context) {
    return withInterruptGuard("safe_restore", async () => {
      const agent = context.agent ?? "unknown";

      const result = restoreBackup(args.uuid);

      if (!result.success) {
        throw new Error(
          `[safe_restore] Restore failed for agent ${agent}: ${result.error}`,
        );
      }

      const record = getBackup(args.uuid);
      const fileName =
        record?.original_file_path?.split("/").pop() || "unknown";
      return `Restored ${fileName} from backup ${args.uuid} (agent: ${agent})`;
    });
  },
});
