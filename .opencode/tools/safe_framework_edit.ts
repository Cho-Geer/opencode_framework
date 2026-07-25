// tools/safe_framework_edit.ts — Controlled framework maintenance write tool
// Requires: active framework_maintenance grant bound to this session,
//           an active framework maintenance plan, and the target path must be
//           in the plan. Writes are budgeted; the grant is consumed when the
//           budget is exhausted or when framework_maintenance_complete is called.

import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";
import { writeSafeFull } from "../service/file-guard";
import { withInterruptGuard } from "../lib";
import { writeLog } from "../lib/log-manager";
import { hasGrant, recordGrantWrite } from "../service/dispatch/privilege";
import { assertPathInActivePlan } from "../service/dispatch/framework-maintenance-plan";
import {
  getFrameworkMaintenancePolicy,
  isFrameworkPathAllowed,
  normalizeFrameworkPath,
} from "../service/dispatch/framework-maintenance-policy";

const SRC = "tool-safe-framework-edit";

export default tool({
  description:
    "Controlled framework maintenance write tool. " +
    "Requires an active framework_maintenance grant bound to this session, " +
    "an active framework_maintenance_plan, and the target path must be listed in the plan. " +
    "Each successful write consumes one write from the grant budget. " +
    "Use framework_maintenance_complete when finished.",
  args: {
    filePath: tool.schema
      .string()
      .describe("Target file path (must be in the active framework maintenance plan)"),
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
      .describe("Validate grant, plan, and path without writing"),
  },
  async execute(args, context) {
    return withInterruptGuard("safe_framework_edit", async () => {
      const sessionId = context.sessionID || "unknown";
      const agent = context.agent || "unknown";
      const resolvedPath = path.resolve(args.filePath);

      // 1. Normalize path
      const root = process.env.OPENCODE_ROOT || process.cwd();
      const relPath = resolvedPath.startsWith(root + "/")
        ? resolvedPath.slice(root.length + 1)
        : normalizeFrameworkPath(args.filePath, root);

      const policy = getFrameworkMaintenancePolicy();

      // 2. Policy path check
      if (!isFrameworkPathAllowed(relPath, policy.defaultAllowedPaths, policy.blockedPaths)) {
        writeLog(SRC, "WARN", {
          event: "FRAMEWORK-EDIT-PATH-BLOCKED",
          agent, sessionId, filePath: relPath,
        });
        throw new Error(
          `[FW-ENFORCE][PRIVILEGE][PATH-BLOCKED] safe_framework_edit target is outside framework maintenance policy.\n` +
          `Target: ${relPath}`
        );
      }

      // 3. Grant check
      const grant = hasGrant(sessionId, "framework_maintenance", relPath);
      if (!grant) {
        writeLog(SRC, "WARN", {
          event: "FRAMEWORK-EDIT-NO-GRANT",
          agent, sessionId, filePath: relPath,
        });
        throw new Error(
          `[FW-ENFORCE][PRIVILEGE][NO-GRANT] No active framework_maintenance grant for this session + path.\n` +
          `Agent: ${agent}\nSession: ${sessionId}\nTarget: ${relPath}\n\n` +
          `Required: Orchestrator must create a dispatch_privilege grant before dispatching this task.`
        );
      }

      if (grant.writes_used >= grant.max_writes) {
        throw new Error(
          `[FW-ENFORCE][PRIVILEGE][WRITE-BUDGET-EXHAUSTED] Grant write budget exhausted. ` +
          `Writes: ${grant.writes_used}/${grant.max_writes}. Call framework_maintenance_complete.`
        );
      }

      // 4. Plan check
      assertPathInActivePlan(sessionId, grant.id, relPath);

      // 5. Dry-run
      if (args.dryRun) {
        return JSON.stringify({
          dryRun: true,
          grantId: grant.id,
          filePath: resolvedPath,
          relPath,
          allowed: true,
          remainingWrites: grant.max_writes - grant.writes_used,
          message: "Grant, plan, and path valid. Write skipped (dry-run).",
        });
      }

      // 6. Write via file-guard
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

      // 7. Record write (consumes one budget; consumes grant if budget reached)
      recordGrantWrite(grant.id);
      const remainingWrites = Math.max(0, grant.max_writes - (grant.writes_used + 1));

      writeLog(SRC, "INFO", {
        event: "FRAMEWORK-EDIT-SUCCESS",
        agent, sessionId, filePath: resolvedPath,
        grantId: grant.id, backupPath: result.backupPath,
      });

      return JSON.stringify({
        success: true,
        grantId: grant.id,
        filePath: resolvedPath,
        relPath,
        writesUsed: grant.writes_used + 1,
        maxWrites: grant.max_writes,
        remainingWrites,
        backupPath: result.backupPath || null,
      });
    });
  },
});
