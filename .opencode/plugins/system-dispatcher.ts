// plugins/system-dispatcher.ts — Unified experimental.chat.system.transform dispatcher
// Merges: anti-bypass system transform + (future: context-trimmer system transform)
// Order: anti-bypass injects directives last (ensures they survive trimming).

import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { writeLog } from "../lib/log-manager";
import { getExecutionOrder } from "../plugin-handlers/shared/config-loader";

import * as antiBypassSystem from "../plugin-handlers/system/anti-bypass";
import * as skillSummarySystem from "../plugin-handlers/system/skill-summary";

type SystemFn = (input: any, output: any) => Promise<void>;

const HANDLER_MAP: Record<string, SystemFn> = {
  "anti-bypass": antiBypassSystem.handle,
  "skill-summary": skillSummarySystem.handle,
};

const DEFAULT_ORDER = ["anti-bypass", "skill-summary"];

export default withPluginLifecycle("system-dispatcher", {
  "experimental.chat.system.transform": async (input: any, output: any) => {
    const order = getExecutionOrder("system", DEFAULT_ORDER);

    for (const name of order) {
      const handler = HANDLER_MAP[name];
      if (!handler) continue;

      try {
        await handler(input, output);
      } catch (err: any) {
        writeLog("system-dispatcher", "ERROR", {
          event: "HANDLER-ERROR", handler: name,
          error: err.message?.substring(0, 200),
        });
      }
    }
  },
});
