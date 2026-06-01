import type { Plugin, PluginInput, Hooks, ToolResult } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Single source of truth: lib/ barrel export ──
import {
  safeEdit,
  writeSafeFull,
  safeDelete,
  safeMkdir,
  safeBashTool,
  validateTestReport,
} from "../../lib/index";

const plugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  // Load 14 hooks from framework-enforcer.ts
  const { default: frameworkEnforcer } = await import("./framework-enforcer.js");
  const enforcerHooks = await frameworkEnforcer(input);

  return {
    ...enforcerHooks,
    tool: {
      ...(enforcerHooks.tool || {}),

      // ═══════════════════════════════════════════════════════
      // safe_edit: patch + overwrite modes, TOCTOU retry
      // ═══════════════════════════════════════════════════════
      safe_edit: tool({
        description:
          "Safe atomic file edit with TOCTOU protection, backup, and rollback. " +
          "Supports patch mode (find-and-replace) and overwrite mode (full file).",
        args: {
          filePath: tool.schema.string()
            .describe("Absolute path of the file to edit"),
          mode: tool.schema.string().optional()
            .describe("Edit mode: 'patch' (default) or 'overwrite'"),
          oldString: tool.schema.string().optional()
            .describe("Exact string to find and replace (patch mode)"),
          newString: tool.schema.string().optional()
            .describe("New string to replace with (patch mode)"),
          content: tool.schema.string().optional()
            .describe("Entire file content (overwrite mode)"),
        },
        async execute(args, _context): Promise<ToolResult> {
          const absPath = path.resolve(args.filePath);
          const mode = args.mode ?? "patch";

          // ── overwrite mode ──
          if (mode === "overwrite") {
            if (!args.content) {
              throw new Error("safe_edit failed: content parameter is required for overwrite mode");
            }
            let result = writeSafeFull(absPath, args.content);
            // ★ TOCTOU: retry once on "first call establishes baseline"
            if (!result.success && result.error?.includes("first call establishes baseline")) {
              result = writeSafeFull(absPath, args.content);
            }
            if (!result.success) {
              throw new Error(`safe_edit failed: ${result.error}`);
            }
            return `File overwritten successfully (backup: ${result.backupPath || "none"})`;
          }

          // ── patch mode (default) ──
          let content: string;
          try {
            content = fs.readFileSync(absPath, "utf-8");
          } catch {
            throw new Error(`safe_edit failed: cannot read file at ${args.filePath}`);
          }
          if (!content.includes(args.oldString)) {
            throw new Error(`safe_edit failed: oldString not found in ${args.filePath}`);
          }
          const occurrences = content.split(args.oldString).length - 1;
          if (occurrences > 1) {
            throw new Error(
              `safe_edit failed: oldString found ${occurrences} times in ${args.filePath}, must be unique`,
            );
          }
          const newContent = content.replace(args.oldString, args.newString);
          let result = safeEdit(absPath, newContent);
          // ★ TOCTOU: retry once on "first call establishes baseline"
          if (!result.success && result.error?.includes("first call establishes baseline")) {
            result = safeEdit(absPath, newContent);
          }
          if (!result.success) {
            throw new Error(`safe_edit failed: ${result.error}`);
          }
          return `File edited successfully (backup: ${result.backupPath || "none"})`;
        },
      }),

      // ═══════════════════════════════════════════════════════
      // safe_bash: structured return format
      // ═══════════════════════════════════════════════════════
      safe_bash: tool({
        description: "Allowlisted shell command execution. Only predefined safe commands are permitted. Use this for all shell/terminal operations.",
        args: {
          command: tool.schema.string().describe("Shell command to execute"),
          timeout: tool.schema.number().optional().describe("Timeout in milliseconds (default: 300000)"),
          dryRun: tool.schema.boolean().optional().describe("Validate without executing"),
        },
        async execute(args, context): Promise<ToolResult> {
          const agent = context.agent ?? process.env.FRAMEWORK_AGENT ?? "unknown";
          const result = safeBashTool({
            command: args.command,
            timeout: args.timeout,
            dryRun: args.dryRun,
            agent,
          });
          if (!result.allowed) {
            throw new Error(`safe_bash blocked: ${result.blockedReason} (command: ${args.command})`);
          }
          if (args.dryRun) {
            return `Command validated and allowed: ${args.command}`;
          }
          // Structured return
          return JSON.stringify({
            output: result.stdout || "",
            metadata: {
              exitCode: result.exitCode,
              stderr: result.stderr,
              executed: result.executed,
              agent: result.agent,
            },
          }, null, 2);
        },
      }),

      // ═══════════════════════════════════════════════════════
      // safe_test: TDD phase validation
      // ═══════════════════════════════════════════════════════
      safe_test: tool({
        description: "Validate test_report.json against TDD phase rules. Checks execution_evidence, exit_code, and coverage thresholds.",
        args: {
          taskId: tool.schema.string().describe("Task ID to validate"),
          phase: tool.schema.string().describe("TDD phase (red or green)"),
        },
        async execute(args, _context): Promise<ToolResult> {
          const result = validateTestReport(args.taskId, args.phase);
          if (!result.passed) {
            throw new Error(`safe_test validation failed: ${result.violations.join("; ")}`);
          }
          return `Validation passed for ${args.taskId} (${args.phase} phase)`;
        },
      }),

      // ═══════════════════════════════════════════════════════
      // safe_delete: TOCTOU-protected file deletion
      // ═══════════════════════════════════════════════════════
      safe_delete: tool({
        description:
          "Safely delete a file with TOCTOU protection, backup, and rollback.",
        args: {
          filePath: tool.schema.string()
            .describe("Absolute path of the file to delete"),
        },
        async execute(args, _context): Promise<ToolResult> {
          const absPath = path.resolve(args.filePath);
          let result = safeDelete(absPath);
          if (!result.success && result.error?.includes("first call")) {
            result = safeDelete(absPath);
          }
          if (!result.success) {
            throw new Error("safe_delete failed: " + result.error);
          }
          return "File deleted (backup: " + (result.backupPath || "none") + ")";
        },
      }),

      // ═══════════════════════════════════════════════════════
      // safe_mkdir: atomic directory creation
      // ═══════════════════════════════════════════════════════
      safe_mkdir: tool({
        description:
          "Safely create a directory.",
        args: {
          dirPath: tool.schema.string()
            .describe("Absolute path of directory to create"),
          recursive: tool.schema.boolean().optional()
            .describe("Create parents (default: true)"),
        },
        async execute(args, _context): Promise<ToolResult> {
          const result = safeMkdir(args.dirPath, { recursive: args.recursive });
          if (!result.success) {
            throw new Error("safe_mkdir failed: " + result.error);
          }
          return "Directory created: " + result.path;
        },
      }),
    },
  };
};

export default plugin;
