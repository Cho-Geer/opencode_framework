#!/usr/bin/env node
/**
 * plugin-entry.ts — Combined Framework Enforcer Plugin Entry Point
 * ==========================================================================
 *
 * Combines:
 *  1. All framework governance hooks from framework-enforcer.ts
 *     (tool.execute.before, tool.execute.after, shell.env, file.edited,
 *      session.*, permission.*, command.executed, tui.command.execute, etc.)
 *  2. safe_edit custom tool — atomic file edit with TOCTOU protection,
 *     backup, and rollback.
 *  3. safe_bash custom tool — allowlisted shell command execution with
 *     dangerous pattern blocking and agent-specific extensions.
 *
 * Uses the official OpenCode plugin pattern with TypeScript types.
 *
 * @author  @Architect, @Coder-BE
 * @version 1.0.0
 * @phase   PLUGIN-ENTRY-COMBINED
 */

import type { Plugin, PluginInput, Hooks, ToolResult } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import { PermissionIsolation } from "../../lib/permission-isolation-core";

// ---------------------------------------------------------------------------
// 1. Import framework enforcer plugin (hooks-only)
// ---------------------------------------------------------------------------

import frameworkEnforcerPlugin from "./framework-enforcer.js";

// ---------------------------------------------------------------------------
// 2. Import safe-edit helper
// ---------------------------------------------------------------------------

import { safeEdit, writeSafeFull } from "../../lib/safe-edit-core";

// ---------------------------------------------------------------------------
// 3. Import safe-bash helper (CJS module — use namespace import)
// ---------------------------------------------------------------------------

import { safeBashTool } from "../../lib/safe-bash-core";

// ---------------------------------------------------------------------------
// 4. Combined plugin
// ---------------------------------------------------------------------------

const combinedPlugin: Plugin = async (
  input: PluginInput,
  options?: Record<string, unknown>,
): Promise<Hooks> => {
  // Obtain all hooks from the framework enforcer (DAG/gate/TDD/audit/etc.)
  const hooks = await frameworkEnforcerPlugin(input, options);

  // Merge with custom tools
  return {
    ...hooks,
    tool: {
      ...(hooks.tool || {}),

      // ── safe_edit ──────────────────────────────────────────────────────
      safe_edit: tool({
        description:
          "Safe atomic file edit with TOCTOU protection, backup, and rollback. " +
          "Use this instead of the built-in edit tool for all file modifications.",
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
        async execute(args, context): Promise<ToolResult> {
          const absPath = path.resolve(args.filePath);

          // Write-scope validation (G6 fix: @Arbiter WARNING)
          const permissionIsolation = new PermissionIsolation();
          const scopeResult = await permissionIsolation.checkWriteScope(
            (context as any)?.agent || 'unknown',
            absPath,
          );
          if (!scopeResult.allowed) {
            throw new Error(
              `safe_edit blocked: ${scopeResult.reason || 'Write scope violation'}`,
            );
          }

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

      // ── safe_bash ──────────────────────────────────────────────────────
      safe_bash: tool({
        description:
          "Safe bash command execution with allowlist and dangerous pattern blocking. " +
          "Only allowlisted commands may execute. Agent-specific extensions are applied automatically.",
        args: {
          command: tool.schema
            .string()
            .describe("Shell command to execute"),
          timeout: tool.schema
            .number()
            .optional()
            .describe("Timeout in milliseconds (default: 300000 = 5 min)"),
          dryRun: tool.schema
            .boolean()
            .optional()
            .describe("If true, only validate without executing"),
        },
        async execute(args, context): Promise<ToolResult> {
          const result = safeBashTool({
            command: args.command,
            timeout: args.timeout ?? 300000,
            dryRun: args.dryRun ?? false,
            agent: context.agent,
          });

          if (!result.allowed) {
            throw new Error(
              `safe_bash blocked: ${result.blockedReason} (command: ${args.command})`,
            );
          }

          if (args.dryRun) {
            return `Command validated and allowed: ${args.command}`;
          }

          return {
            output: result.stdout || "",
            metadata: {
              exitCode: result.exitCode,
              stderr: result.stderr,
              executed: result.executed,
              agent: result.agent,
            },
          };
        },
      }),
    },
  };
};

// ---------------------------------------------------------------------------
// 5. Default export
// ---------------------------------------------------------------------------

export default combinedPlugin;
