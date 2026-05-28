/**
 * index.ts — Framework Enforcer Plugin custom tool: safe_edit
 *
 * Registers safe_edit as a custom tool that performs atomic file edits
 * with TOCTOU protection, backup, and rollback.
 *
 * @phase   TOOL-REGISTRATION
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { safeEdit } from "../../tools/safe-edit.js";
import { tool } from "@opencode-ai/plugin";
const plugin = async (_ctx) => {
    return {
        tool: {
            safe_edit: tool({
                description: "Safe atomic file edit with TOCTOU protection, backup, and rollback. Use this instead of the built-in edit tool for all file modifications.",
                args: {
                    filePath: tool.schema
                        .string()
                        .describe("Absolute path of the file to edit"),
                    oldString: tool.schema
                        .string()
                        .describe("Exact string to find and replace"),
                    newString: tool.schema
                        .string()
                        .describe("New string to replace with"),
                },
                async execute(args, _context) {
                    const absPath = path.resolve(args.filePath);
                    let content;
                    try {
                        content = fs.readFileSync(absPath, "utf-8");
                    }
                    catch {
                        throw new Error(`safe_edit failed: cannot read file at ${args.filePath}`);
                    }
                    if (!content.includes(args.oldString)) {
                        throw new Error(`safe_edit failed: oldString not found in ${args.filePath}`);
                    }
                    const occurrences = content.split(args.oldString).length - 1;
                    if (occurrences > 1) {
                        throw new Error(`safe_edit failed: oldString found ${occurrences} times in ${args.filePath}, must be unique`);
                    }
                    const newContent = content.replace(args.oldString, args.newString);
                    const result = safeEdit(absPath, newContent);
                    if (!result.success) {
                        throw new Error(`safe_edit failed: ${result.error}`);
                    }
                    return `File edited successfully (backup: ${result.backupPath || "none"})`;
                },
            }),
        },
    };
};
export default plugin;
