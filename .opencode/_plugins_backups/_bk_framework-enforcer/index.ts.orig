import type { Plugin } from "@opencode-ai/plugin";
import {
  toolExecuteBefore,
  toolExecuteAfter,
  chatMessageHook,
} from "./enforce";
import { setPluginHooksCount } from "./gate-checks";

// ═══════════════════════════════════════════════════════════════════════════
// FW-DIAG-PLUGIN-INDEX (2026-06-10, @Super-Admin): Plugin entry point heartbeat.
// If enforce.ts import fails, this still fires from index.ts.
// Verify: grep PLUGIN-LOADED .task_temp/_dispatch/chat_message_hook.log
// ═══════════════════════════════════════════════════════════════════════════
try {
  const fs = require("fs");
  const path = require("path");
  const dp = path.join(process.env.OPENCODE_ROOT || ".", ".task_temp", "_dispatch", "chat_message_hook.log");
  const dir = path.dirname(dp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(dp, `[${new Date().toISOString()}][INFO] [PLUGIN-LOADED] framework-enforcer/index.ts | pid=${process.pid} | cwd=${process.cwd()}\n`, "utf8");
} catch (_) {}

// VERSION: 4.7.3-NAMED-EXPORT — FIX: changed from default export to named export per official OpenCode plugin spec (2026-06-10 @Super-Admin)
// ROOT CAUSE: OpenCode loads plugins by scanning for NAMED exports matching Plugin type.
// The previous default export (v4.7.1-CLEANUP) caused the plugin to silently fail loading.
// See: docs/official_docs/opencode/framework/plugins.md — all examples use "export const"
// P0-FIX-QUAD-02: drained_sessions array→object
// P0-FIX-QUAD-05: read-causes-dirty_modules gate in _executeWriteAuditCheck
// P1-FIX-QUAD-04: agent identity fail-open hardening
const HOOKS_COUNT = 3; // chat.message + tool.execute.before + tool.execute.after
setPluginHooksCount(HOOKS_COUNT);

export const FrameworkEnforcer: Plugin = async (ctx: any) => {
  return {
    "chat.message": chatMessageHook,
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
  } as any;
};
