// plugins/before-dispatcher.ts — Unified tool.execute.before dispatcher
// Reads execution order from project.config.json, runs handlers serially.
// First throw = early termination (framework semantics preserved).
// Phase 3 (2026-07-05): Slimmed from 14 to 7 handlers.
// Phase 4 (2026-07-07): Re-added task handler for dispatch marker consumption (8 handlers).

import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { writeLog } from "../lib/log-manager";
import { writeJsonl } from "../lib/jsonl-writer";
import { resolveAgent } from "../lib/agent-resolver";
import { getExecutionOrder } from "../plugin-handlers/shared/config-loader";

// ── Handler imports (Phase 3 slimmed) ──
import * as codegraph from "../plugin-handlers/before/codegraph";
import * as scope from "../plugin-handlers/before/scope";
import * as uc7ks from "../plugin-handlers/before/uc7ks";
import * as guidanceBridge from "../plugin-handlers/before/guidance-bridge";
import * as permissionSafety from "../plugin-handlers/before/permission-safety";
import * as dispatchSignal from "../plugin-handlers/before/dispatch-signal";
import * as skillPolicy from "../plugin-handlers/before/skill-policy";
import * as behavioralPathGuard from "../plugin-handlers/before/behavioral-path-guard";
import * as task from "../plugin-handlers/before/task";

// ── Handler registry ──
type BeforeFn = (input: any, output: any) => Promise<void>;

const HANDLER_MAP: Record<string, BeforeFn> = {
  "codegraph": codegraph.handle,
  "scope": scope.handle,
  "guidance-bridge": guidanceBridge.handle,
  "permission-safety": permissionSafety.handle,
  "dispatch-signal": dispatchSignal.handle,
  "skill-policy": skillPolicy.handle,
  "behavioral-path-guard": behavioralPathGuard.handle,
  "task": task.handle,
};

// Removed from active order: uc7ks (audit_only, not in execution_order)
// ─ Tool filter metadata ──
const TOOL_FILTER: Record<string, string[]> = {
  "codegraph": ["safe_edit", "safe_delete", "safe_restore", "safe_shell", "bash"],
  "scope": ["*"],
  "guidance-bridge": ["*"],
  "permission-safety": ["*"],
  "dispatch-signal": ["*"],
  "skill-policy": ["*"],
  "behavioral-path-guard": ["safe_edit", "safe_delete", "safe_restore", "safe_shell", "safe_mkdir"],
  "task": ["task", "Task"],
};

// ── Default execution order (Phase 3 slimmed) ──
// Hot-path instrumentation: count handlers per tool call
let _hotPathBeforeCount = 0;

const DEFAULT_ORDER = [
  "guidance-bridge",
  "task",
  "permission-safety",
  "behavioral-path-guard",
  "scope",
  "codegraph",
  "skill-policy",
  "dispatch-signal",
];

function shouldRun(handlerName: string, toolName: string): boolean {
  const tools = TOOL_FILTER[handlerName];
  if (!tools) return false;
  if (tools.includes("*")) return true;
  return tools.includes(toolName);
}

// ── Plugin export ──
export default withPluginLifecycle("before-dispatcher", {
  "tool.execute.before": async (input: any, output: any) => {
    const toolName = input.tool ?? "unknown";
    _hotPathBeforeCount = 0;
    const order = getExecutionOrder("before", DEFAULT_ORDER);

    for (const name of order) {
      const handler = HANDLER_MAP[name];
      if (!handler) continue;
      if (!shouldRun(name, toolName)) continue;

      _hotPathBeforeCount++;
      writeLog("before-dispatcher", "runtime", {
        event: "HANDLER-START", handler: name, tool: toolName,
        sessionID: input.sessionID,
      });

      await handler(input, output);
    }

    // HOT-PATH-COUNT: log before handler count for write tools
    if (["safe_edit", "safe_delete", "safe_shell", "safe_restore"].includes(toolName)) {
      writeJsonl("dispatch", {
        event: "HOT-PATH-BEFORE-COUNT",
        tool: toolName,
        handlerCount: _hotPathBeforeCount,
        handlers: "see HANDLER-START events",
      }, { sessionID: input.sessionID, tool: toolName });
    }
  },
});
