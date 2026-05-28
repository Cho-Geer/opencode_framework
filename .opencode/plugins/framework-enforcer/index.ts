/**
 * index.ts — Framework Enforcer Plugin custom tool: safe_edit
 *
 * Registers safe_edit as a custom tool that performs atomic file edits
 * with TOCTOU protection, backup, and rollback.
 *
 * @phase   TOOL-REGISTRATION
 */

import type { Plugin, PluginInput, Hooks, ToolResult } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { safeEdit } from "../../tools/safe-edit.js";
import { safeBashTool } from "../../tools/safe-bash.js";
import { validateTestReport } from "../../tools/safe-test.js";
import { tool } from "@opencode-ai/plugin";

const plugin: Plugin = async (_ctx: PluginInput): Promise<Hooks> => {
  return {
    tool: {
      safe_edit: tool({
        description:
          "Safe atomic file edit with TOCTOU protection, backup, and rollback. Use this instead of the built-in edit tool for all file modifications.",
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
        async execute(
          args,
          _context,
        ): Promise<ToolResult> {
          const absPath = path.resolve(args.filePath);

          let content: string;
          try {
            content = fs.readFileSync(absPath, "utf-8");
          } catch {
            throw new Error(
              `safe_edit failed: cannot read file at ${args.filePath}`,
            );
          }

          if (!content.includes(args.oldString)) {
            throw new Error(
              `safe_edit failed: oldString not found in ${args.filePath}`,
            );
          }

          const occurrences = content.split(args.oldString).length - 1;
          if (occurrences > 1) {
            throw new Error(
              `safe_edit failed: oldString found ${occurrences} times in ${args.filePath}, must be unique`,
            );
          }

          const newContent = content.replace(args.oldString, args.newString);

          const result = safeEdit(absPath, newContent);
          if (!result.success) {
            throw new Error(`safe_edit failed: ${result.error}`);
          }
          return `File edited successfully (backup: ${result.backupPath || "none"})`;
        },
      }),

      safe_bash: tool({
        description:
          "Allowlisted shell command execution. Only predefined safe commands are permitted. Use this for all shell/terminal operations instead of the built-in bash tool.",
        args: {
          command: tool.schema
            .string()
            .describe("Shell command to execute"),
          timeout: tool.schema
            .number()
            .optional()
            .describe("Timeout in milliseconds (default: 300000)"),
          dryRun: tool.schema
            .boolean()
            .optional()
            .describe("Validate without executing"),
        },
        async execute(
          args,
          _context,
        ): Promise<ToolResult> {
          const agent = process.env.FRAMEWORK_AGENT || "unknown";

          const result = safeBashTool({
            command: args.command,
            timeout: args.timeout,
            dryRun: args.dryRun,
            agent,
          });

          if (!result.allowed) {
            throw new Error(
              `safe_bash blocked: ${result.blockedReason}`,
            );
          }

          if (args.dryRun) {
            return `Command validated (dry run): ${args.command}`;
          }

          return JSON.stringify(result, null, 2);
        },
      }),

      safe_test: tool({
        description:
          "Validate test_report.json against TDD phase rules. Checks execution_evidence, exit_code, and coverage thresholds.",
        args: {
          taskId: tool.schema
            .string()
            .describe("Task ID whose test report to validate"),
          phase: tool.schema
            .string()
            .describe("TDD phase (red or green)"),
        },
        async execute(
          args,
          _context,
        ): Promise<ToolResult> {
          const result = validateTestReport(args.taskId, args.phase as "red" | "green");
          if (!result.passed) {
            throw new Error(
              `safe_test validation failed: ${result.violations.join("; ")}`,
            );
          }
          return `Validation passed for ${args.taskId} (${args.phase} phase)`;
        },
      }),
    },
  };
};

export default plugin;
