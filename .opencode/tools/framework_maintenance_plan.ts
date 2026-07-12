// tools/framework_maintenance_plan.ts — Declare a framework maintenance plan
// Orchestrator does NOT need to provide allowed_paths. The child agent runs
// CodeGraph first, then declares which paths it plans to modify.

import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { hasGrant } from "../service/dispatch/privilege";
import { createFrameworkMaintenancePlan } from "../service/dispatch/framework-maintenance-plan";
import { normalizeFrameworkPath } from "../service/dispatch/framework-maintenance-policy";

export default tool({
  description:
    "Declare a framework maintenance plan. Must be called from a child session " +
    "after CodeGraph impact analysis. The plan lists planned paths, CodeGraph targets, " +
    "and rationale. Each path must be within the framework maintenance policy and grant " +
    "allowlist. Required before using safe_framework_edit.",
  args: {
    planned_paths: tool.schema
      .array(tool.schema.string())
      .describe("List of paths the child agent intends to modify"),
    codegraph_targets: tool.schema
      .array(tool.schema.string())
      .describe("Symbols/files queried through CodeGraph that justify the plan"),
    rationale: tool.schema
      .string()
      .describe("Why these paths need to be modified"),
    risk_level: tool.schema
      .enum(["low", "medium", "high"])
      .optional()
      .describe("Risk level of the planned changes"),
  },
  async execute(args, context) {
    return withInterruptGuard("framework_maintenance_plan", async () => {
      const sessionId = context.sessionID || "unknown";
      const agent = context.agent || "unknown";

      const grant = hasGrant(sessionId, "framework_maintenance");
      if (!grant) {
        throw new Error(
          "[FW-ENFORCE][PRIVILEGE] No active framework_maintenance grant for this session. " +
          "Orchestrator must dispatch with dispatch_privilege=framework_maintenance first."
        );
      }

      const normalizedPaths = (args.planned_paths || []).map((p) =>
        normalizeFrameworkPath(p),
      );

      const result = createFrameworkMaintenancePlan({
        sessionId,
        grantId: grant.id,
        plannedPaths: normalizedPaths,
        codegraphTargets: args.codegraph_targets || [],
        rationale: args.rationale || "",
        riskLevel: args.risk_level || "medium",
      });

      return JSON.stringify({
        success: true,
        planId: result.id,
        grantId: result.grantId,
        plannedPaths: result.plannedPaths,
        maxWrites: grant.max_writes,
        writesUsed: grant.writes_used,
        remainingWrites: Math.max(0, grant.max_writes - grant.writes_used),
        agent,
      });
    });
  },
});
