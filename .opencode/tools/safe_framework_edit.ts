// tools/safe_framework_edit.ts — Controlled framework maintenance write tool
// Requires: active dispatch privilege grant (bound) AND CodeGraph impact evidence (double-gate)
// Only writes to .opencode/** paths. One-time use per grant.

import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";
import { writeSafeFull } from "../service/file-guard";
import { withInterruptGuard } from "../lib";
import { writeLog } from "../lib/log-manager";
import { hasGrant, consumeGrant } from "../service/dispatch/privilege";

const SRC = "tool-safe-framework-edit";

export default tool({
  description:
    "Controlled framework maintenance write tool. " +
    "Requires an active dispatch privilege grant (framework_maintenance) bound to this session. " +
    "Only allows writes under .opencode/ paths. Grant is consumed after successful write (one-time use).",
  args: {
    filePath: tool.schema
      .string()
      .describe("Target file path (must be under .opencode/)"),
    content: tool.schema
      .string()
      .describe("Full file content to write"),
    reason: tool.schema
      .string()
      .optional()
      .describe("Reason for this framework maintenance write"),
    dryRun: tool.schema
      .boolean()
      .optional()
      .describe("Validate grant and path without writing"),
  },
  async execute(args, context) {
    return withInterruptGuard("safe_framework_edit", async () => {
      const sessionId = context.sessionID || "unknown";
      const agent = context.agent || "unknown";
      const resolvedPath = path.resolve(args.filePath);

      // 1. Path restriction: only .opencode/**
      const root = process.env.OPENCODE_ROOT || process.cwd();
      const relPath = resolvedPath.startsWith(root + "/")
        ? resolvedPath.slice(root.length + 1)
        : args.filePath;

      if (!relPath.startsWith(".opencode/") && !relPath.startsWith(".opencode\\")) {
        writeLog(SRC, "WARN", {
          event: "FRAMEWORK-EDIT-PATH-OUTSIDE-SCOPE",
          agent, sessionId, filePath: resolvedPath, relPath,
        });
        throw new Error(
          "[FW-ENFORCE][PRIVILEGE] safe_framework_edit only allows writes under .opencode/\n" +
          "Target: " + resolvedPath + "\nRelative: " + relPath
        );
      }

      // 2. Grant check: must have bound grant for this session + relative path
      const grant = hasGrant(sessionId, "framework_maintenance", relPath);
      if (!grant) {
        writeLog(SRC, "WARN", {
          event: "FRAMEWORK-EDIT-NO-GRANT",
          agent, sessionId, filePath: relPath,
        });
        throw new Error(
          "[FW-ENFORCE][PRIVILEGE] No active framework_maintenance grant for this session + path.\n" +
          "Agent: " + agent + "\nSession: " + sessionId + "\nTarget: " + relPath + "\n\n" +
          "Required: Orchestrator must create a dispatch_privilege grant before dispatching this task."
        );
      }

      // 3. Dry-run: validate only
      if (args.dryRun) {
        return JSON.stringify({
          dryRun: true,
          grantId: grant.id,
          filePath: resolvedPath,
          allowed: true,
          message: "Grant valid, path allowed. Write skipped (dry-run).",
        });
      }

      // 4. Write via file-guard (reuses backup/atomic/audit pipeline)
      const result = writeSafeFull(resolvedPath, args.content, {
        agentType: agent,
        taskId: grant.dag_task_id || "framework_maintenance",
      });

      if (!result.success) {
        writeLog(SRC, "ERROR", {
          event: "FRAMEWORK-EDIT-WRITE-FAILED",
          agent, sessionId, filePath: resolvedPath,
          error: result.error,
        });
        return `Write failed: ${result.error}`;
      }

      // 5. Consume grant (one-time use)
      consumeGrant(grant.id);

      writeLog(SRC, "INFO", {
        event: "FRAMEWORK-EDIT-SUCCESS",
        agent, sessionId, filePath: resolvedPath,
        grantId: grant.id, backupPath: result.backupPath,
      });

      return JSON.stringify({
        success: true,
        grantId: grant.id,
        grantConsumed: true,
        filePath: resolvedPath,
        backupPath: result.backupPath || null,
      });
    });
  },
});
