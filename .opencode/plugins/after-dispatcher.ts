// plugins/after-dispatcher.ts — Unified tool.execute.after dispatcher
// Reads execution order from project.config.json, runs handlers serially.
// All after handlers are fire-and-forget: errors caught and logged, never thrown.
// Phase 3 (2026-07-05): Slimmed from 13 to 8 handlers.

import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { writeLog } from "../lib/log-manager";
import { writeJsonl } from "../lib/jsonl-writer";
import { resolveAgent } from "../lib/agent-resolver";
import { getExecutionOrder } from "../plugin-handlers/shared/config-loader";

// ── Handler imports (Phase 3 slimmed) ──
import * as auditHandler from "../plugin-handlers/after/audit";
import * as dbHealthHandler from "../plugin-handlers/after/db-health";
import * as unifiedAuditHandler from "../plugin-handlers/after/unified-audit";
import * as skillAuditHandler from "../plugin-handlers/after/skill-audit";
import * as qualityContractHandler from "../plugin-handlers/after/quality-contract";
import * as dispatchTraceHandler from "../plugin-handlers/after/dispatch-trace";
import * as guidanceRecoveryHandler from "../plugin-handlers/after/guidance-recovery";

// ── Handler registry ──
type AfterFn = (input: any, output: any) => Promise<void>;

const HANDLER_MAP: Record<string, AfterFn> = {
  "db-health": dbHealthHandler.handle,
  "unified-audit": unifiedAuditHandler.handle,
  "skill-audit": skillAuditHandler.handle,
  "quality-contract": qualityContractHandler.handle,
  "dispatch-trace": dispatchTraceHandler.handle,
  "guidance-recovery": guidanceRecoveryHandler.handle,
};

// Removed from active order: audit (merged into unified-audit, not in execution_order)
// ── Tool filter metadata ──
const TOOL_FILTER: Record<string, string[]> = {
  "db-health": ["*"],
  "unified-audit": ["*"],
  "skill-audit": ["skill", "skill_read_attest"],
  "quality-contract": ["*"],
  "dispatch-trace": ["*"],
  "guidance-recovery": ["*"],
};

let _hotPathAfterCount = 0;

const DEFAULT_ORDER = [
  "unified-audit",
  "skill-audit",
  "quality-contract",
  "dispatch-trace",
  "db-health",
  "guidance-recovery",
];

function shouldRun(handlerName: string, toolName: string): boolean {
  const tools = TOOL_FILTER[handlerName];
  if (!tools) return false;
  if (tools.includes("*")) return true;
  return tools.includes(toolName);
}

// ── Plugin export ──
export default withPluginLifecycle("after-dispatcher", {
  "tool.execute.after": async (input: any, output: any) => {
    const toolName = input.tool ?? "unknown";
    _hotPathAfterCount = 0;
    const order = getExecutionOrder("after", DEFAULT_ORDER);

    for (const name of order) {
      const handler = HANDLER_MAP[name];
      if (!handler) continue;
      if (!shouldRun(name, toolName)) continue;

      _hotPathAfterCount++;
      try {
        await handler(input, output);
      } catch (err: any) {
        // After handlers never block — catch and log
        writeLog("after-dispatcher", "ERROR", {
          event: "HANDLER-ERROR", handler: name, tool: toolName,
          sessionID: input.sessionID,
          error: err.message?.substring(0, 200),
        });
      }
    }

    // HOT-PATH-COUNT: log after handler count for write tools
    if (["safe_edit", "safe_delete", "safe_shell", "safe_restore"].includes(toolName)) {
      writeJsonl("dispatch", {
        event: "HOT-PATH-AFTER-COUNT",
        tool: toolName,
        handlerCount: _hotPathAfterCount,
      }, { sessionID: input.sessionID, tool: toolName });
    }
  },
});
