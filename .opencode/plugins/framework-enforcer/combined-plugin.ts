import type { Plugin, PluginInput, Hooks, ToolResult } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { safeEdit } from "../../tools/safe-edit.js";
import { safeBashTool } from "../../tools/safe-bash.js";

// Import hooks from framework-enforcer.ts
// We'll re-export them

const CombinedPlugin: Plugin = async (ctx: PluginInput): Promise<Hooks> => {
  // Load the original framework-enforcer hooks
  const { default: frameworkEnforcer } = await import("./framework-enforcer.js");
  const hooks = await frameworkEnforcer(ctx);

  return {
    ...hooks,
    tool: {
      safe_edit: tool({
        description: "Safe atomic file edit with TOCTOU protection, backup, and rollback. Use this instead of the built-in edit tool.",
        args: {
          filePath: tool.schema.string().describe("Absolute path of the file to edit"),
          oldString: tool.schema.string().describe("Exact string to find and replace"),
          newString: tool.schema.string().describe("New string to replace with"),
        },
        async execute(args, context): Promise<ToolResult> {
          const absPath = path.resolve(args.filePath);

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
            throw new Error(`safe_edit failed: oldString found ${occurrences} times, must be unique`);
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
        description: "Allowlisted shell command execution. Only predefined safe commands are permitted.",
        args: {
          command: tool.schema.string().describe("Shell command to execute"),
          timeout: tool.schema.number().optional().describe("Timeout in milliseconds (default: 300000)"),
          dryRun: tool.schema.boolean().optional().describe("Validate without executing"),
        },
        async execute(args, context): Promise<ToolResult> {
          const agent = process.env.FRAMEWORK_AGENT || "unknown";

          const result = safeBashTool({
            command: args.command,
            timeout: args.timeout,
            dryRun: args.dryRun,
            agent,
          });

          if (!result.allowed) {
            throw new Error(`safe_bash blocked: ${result.blockedReason}`);
          }

          if (args.dryRun) {
            return `Command validated (dry run): ${args.command}`;
          }

          return JSON.stringify(result, null, 2);
        },
      }),
    },
  };
};

export default CombinedPlugin;
