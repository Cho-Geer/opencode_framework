// tools/framework_maintenance_complete.ts — Complete a framework maintenance task
// Consumes the active framework maintenance grant and closes the active plan.

import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { hasGrant, completeGrant } from "../service/dispatch/privilege";
import { completeFrameworkMaintenancePlan } from "../service/dispatch/framework-maintenance-plan";

export default tool({
  description:
    "Mark a framework maintenance task as complete. This consumes the active grant " +
    "and closes the active plan. No further safe_framework_edit calls are allowed " +
    "after completion unless a new grant is created.",
  args: {
    summary: tool.schema
      .string()
      .optional()
      .describe("Summary of what was changed"),
  },
  async execute(args, context) {
    return withInterruptGuard("framework_maintenance_complete", async () => {
      const sessionId = context.sessionID || "unknown";
      const agent = context.agent || "unknown";

      const grant = hasGrant(sessionId, "framework_maintenance");
      if (!grant) {
        throw new Error(
          "[FW-ENFORCE][PRIVILEGE] No active framework_maintenance grant for this session."
        );
      }

      completeFrameworkMaintenancePlan(sessionId, grant.id);
      completeGrant(grant.id);

      return JSON.stringify({
        success: true,
        grantId: grant.id,
        summary: args.summary || "",
        writesUsed: grant.writes_used,
        maxWrites: grant.max_writes,
        agent,
      });
    });
  },
});
