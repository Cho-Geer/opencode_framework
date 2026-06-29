/**
 * safe_diff.ts — Backup-Target Diff Tool
 * ======================================
 *
 * Exposes the `generateDiff()` function from safe-edit-core.ts as a callable
 * OpenCode custom tool. Reads a backup file (original) and a target file
 * (modified) and produces a unified diff.
 *
 * Design Rationale (@Super-Admin FW-ENHANCE-A2, 2026-06-03):
 *   - generateDiff() has existed in safe-edit-core.ts since v1.0 (L252, @public)
 *   - The analysis doc §7.1 flagged it as "🟡 中等" value — unused but valuable
 *   - This completes the TOCTOU safety suite: writeSafe → safe_restore → safe_diff
 *   - Enables LLM-initiated diff review before commit/restore decisions
 *
 * Pattern: Follows safe_restore.ts (55 lines) — minimal wrapper over lib function.
 * Conforms to OpenCode official custom tool spec (@opencode-ai/plugin tool() helper).
 *
 * @author @Super-Admin
 * @since 2026-06-03
 */

import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateDiff } from "../service/file-guard";
import { withInterruptGuard } from "../lib";

export default tool({
  description:
    "Generate a unified diff between two files OR between inline content and a file. " +
    "MODE 1 (two-file): Provide backupPath + targetPath to diff two files. " +
    "MODE 2 (inline-content): Provide fileA + content to diff a file against the given content string. " +
    "Useful for reviewing changes before committing, verifying file integrity, " +
    "or deciding whether to restore a backup.",
  args: {
    backupPath: tool.schema
      .string()
      .describe(
        "Absolute path to the backup file (original version). Used in MODE 1 with targetPath.",
      ),
    targetPath: tool.schema
      .string()
      .describe(
        "Absolute path of the target file (modified version). Used in MODE 1 with backupPath.",
      ),
    fileA: tool.schema
      .string()
      .describe(
        "Absolute path of the target file. Used in MODE 2 with content.",
      ),
    content: tool.schema
      .string()
      .describe(
        "Inline content string to diff against fileA. Used in MODE 2 with fileA. " +
          "When provided alongside fileA, reads the existing file and generates a diff " +
          "between its current content and the provided content string.",
      ),
  },
  async execute(args, context) {
    return withInterruptGuard("safe_diff", async () => {
      const agent = context.agent ?? "unknown";

      // MODE 2: inline content diff (fileA + content)
      if (args.content !== undefined && args.fileA) {
        const absFileA = path.resolve(args.fileA);

        if (!fs.existsSync(absFileA)) {
          throw new Error(`[safe_diff] Target file not found: ${absFileA}`);
        }

        const original = fs.readFileSync(absFileA, "utf-8");
        const result = generateDiff(original, args.content);

        if (!result.hasChanges) {
          return `[safe_diff] Content matches existing file ${absFileA} (agent: ${agent})`;
        }

        return [
          `[safe_diff] ${result.added} line(s) added, ${result.removed} line(s) removed (agent: ${agent})`,
          result.diff,
        ].join("\n");
      }

      // MODE 1: two-file diff (backupPath + targetPath)
      if (args.backupPath && args.targetPath) {
        const absBackup = path.resolve(args.backupPath);
        const absTarget = path.resolve(args.targetPath);

        if (!fs.existsSync(absBackup)) {
          throw new Error(`[safe_diff] Backup file not found: ${absBackup}`);
        }
        if (!fs.existsSync(absTarget)) {
          throw new Error(`[safe_diff] Target file not found: ${absTarget}`);
        }

        const original = fs.readFileSync(absBackup, "utf-8");
        const modified = fs.readFileSync(absTarget, "utf-8");

        const result = generateDiff(original, modified);

        if (!result.hasChanges) {
          return `[safe_diff] No differences between ${absBackup} and ${absTarget} (agent: ${agent})`;
        }

        return [
          `[safe_diff] ${result.added} line(s) added, ${result.removed} line(s) removed (agent: ${agent})`,
          result.diff,
        ].join("\n");
      }

      // Neither valid mode
      throw new Error(
        "[safe_diff] Invalid arguments. Provide either (backupPath + targetPath) for MODE 1 " +
          "or (fileA + content) for MODE 2.",
      );
    });
  },
});
