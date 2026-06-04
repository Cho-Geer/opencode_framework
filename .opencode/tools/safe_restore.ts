/**
 * safe_restore.ts — Backup Restore Tool
 * ======================================
 *
 * Exposes the `restore()` function from safe-edit-core.ts as a callable
 * OpenCode custom tool. When `writeSafe` (safe_edit / safe_delete) creates
 * a backup before modifying a file, this tool enables LLM-initiated rollback
 * to the pre-modification state.
 *
 * Design Rationale (@Super-Admin FW-ENHANCE-A1, 2026-06-03):
 *   - restore() has existed in safe-edit-core.ts since v1.0 (L472, @public)
 *   - It has been tested but never exposed as a standalone tool
 *   - The analysis doc §7.1 flagged it as "🟡 中等" value — unused but valuable
 *   - This completes the TOCTOU safety suite: writeSafe → safeDelete → safe_restore
 *
 * Pattern: Follows safe_delete.ts (29 lines) — minimal wrapper over lib function.
 * Conforms to OpenCode official custom tool spec (@opencode-ai/plugin tool() helper).
 *
 * @author @Super-Admin
 * @since 2026-06-03
 */

import { tool } from "@opencode-ai/plugin"
import * as path from "node:path"
import { restore } from "../lib"

export default tool({
  description:
    "Restore a file from a backup created by safe_edit or safe_delete. " +
    "Uses atomic restore (copy to temp → rename) for crash safety. " +
    "Call this when you need to rollback a file modification.",
  args: {
    backupPath: tool.schema
      .string()
      .describe("Absolute path to the backup file to restore from"),
    targetPath: tool.schema
      .string()
      .describe("Absolute path of the target file to restore to"),
  },
  async execute(args, context) {
    const absBackup = path.resolve(args.backupPath)
    const absTarget = path.resolve(args.targetPath)
    const agent = context.agent ?? process.env.FRAMEWORK_AGENT ?? "unknown"

    const result = restore(absBackup, absTarget)

    if (!result.success) {
      throw new Error(
        `[safe_restore] Restore failed for agent ${agent}: ${result.error}`,
      )
    }

    return `Restored ${absTarget} from backup ${absBackup} (agent: ${agent})`
  },
})
