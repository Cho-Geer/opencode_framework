import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { safeEdit, writeSafeFull } from "../service/file-guard";
import { withInterruptGuard } from "../lib";
import { writeLog } from "../lib/log-manager";
import { writeJsonl } from "../lib/jsonl-writer";

export default tool({
  description:
    "Safe atomic file edit with TOCTOU protection, backup, and rollback. " +
    "Supports patch mode (find-and-replace) and overwrite mode (full file). " +
    "Use this for all file modifications instead of the built-in edit/write tools.",
  args: {
    filePath: tool.schema
      .string()
      .describe("Absolute path of the file to edit"),
    mode: tool.schema
      .string()
      .optional()
      .describe("Edit mode: 'patch' (default) or 'overwrite'"),
    oldString: tool.schema
      .string()
      .optional()
      .describe("Exact string to find and replace (patch mode)"),
    newString: tool.schema
      .string()
      .optional()
      .describe("New string to replace with (patch mode)"),
    content: tool.schema
      .string()
      .optional()
      .describe("Entire file content (overwrite mode)"),
    dryRun: tool.schema
      .boolean()
      .optional()
      .describe("Validate without executing"),
    breakGlass: tool.schema
      .boolean()
      .optional()
      .describe("Emergency override: skip path restrictions, log audit trail. Use only when authorized."),
  },
  async execute(args, context) {
    return withInterruptGuard("safe_edit", async () => {
      const absPath = path.resolve(args.filePath);
      const mode = args.mode ?? "patch";
      const agent = context.agent ?? "unknown";

      // breakGlass audit logging (actual bypass is handled by behavioral-path-guard plugin)
      if (args.breakGlass) {
        writeLog("safe-edit", "WARN", {
          event: "BREAK-GLASS-SAFE-EDIT",
          path: absPath,
          mode,
          agent,
          sessionID: context.sessionID || "unknown",
        });
        writeJsonl("break-glass", {
          event: "safe_edit_break_glass",
          path: absPath,
          mode,
        }, { sessionID: context.sessionID || "unknown", tool: "safe_edit" });
      }

      // ── overwrite mode ──
      if (mode === "overwrite") {
        if (!args.content) {
          throw new Error(
            "safe_edit failed: content parameter is required for overwrite mode",
          );
        }
        if (args.dryRun) {
          return `Validated overwrite mode for: ${absPath}`;
        }
        let result = writeSafeFull(absPath, args.content, { agentType: agent });
        if (
          !result.success &&
          result.error?.includes("first call establishes baseline")
        ) {
          result = writeSafeFull(absPath, args.content, { agentType: agent });
        }
        if (!result.success) {
          throw new Error(`safe_edit failed: ${result.error}`);
        }
        return `File overwritten successfully (backup: ${result.backupPath || "none"})`;
      }

      // ── patch mode (default) ──
      if (!args.oldString) {
        throw new Error("safe_edit failed: oldString is required for patch mode");
      }

      let fileContent: string;
      try {
        fileContent = fs.readFileSync(absPath, "utf-8");
      } catch {
        throw new Error(`safe_edit failed: cannot read file at ${args.filePath}`);
      }

      if (!fileContent.includes(args.oldString)) {
        throw new Error(
          `safe_edit failed: oldString not found in ${args.filePath}`,
        );
      }

      const occurrences = fileContent.split(args.oldString).length - 1;
      if (occurrences > 1) {
        throw new Error(
          `safe_edit failed: oldString found ${occurrences} times in ${args.filePath}, must be unique`,
        );
      }

      const newContent = fileContent.replace(
        args.oldString,
        args.newString ?? "",
      );

      if (args.dryRun) {
        return `Validated patch mode for: ${absPath}`;
      }

      let result = safeEdit(absPath, newContent, { agentType: agent });
      if (
        !result.success &&
        result.error?.includes("first call establishes baseline")
      ) {
        result = safeEdit(absPath, newContent, { agentType: agent });
      }
      if (!result.success) {
        throw new Error(`safe_edit failed: ${result.error}`);
      }
      return `File edited successfully (backup: ${result.backupPath || "none"})`;
    });
  },
});
