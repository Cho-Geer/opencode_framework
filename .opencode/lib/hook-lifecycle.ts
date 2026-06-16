// hook-lifecycle.ts — Plugin lifecycle boilerplate elimination
//
// All 16 plugins share the same init pattern:
//   ensureLogDir(); writeLog(name, "loaded", ...); updateIndex(name, "PLUGIN-LOADED");
//   export default (async (_ctx) => { writeLog(name, "hooks", ...); return hooks; }) as any;
//
// withPluginLifecycle() collapses this to a single call.

import { writeLog, updateIndex, ensureLogDir } from "./log-manager";

interface PluginHooks { [event: string]: (...args: any[]) => any; }

export function withPluginLifecycle(name: string, hooks: PluginHooks) {
  ensureLogDir();
  writeLog(name, "loaded", { event: "PLUGIN-LOADED", detail: `${name}.ts` });
  updateIndex(name, "PLUGIN-LOADED");
  return (async (_ctx: any) => {
    writeLog(name, "hooks", { event: "HOOK-REGISTERED", detail: Object.keys(hooks).join(",") });
    return hooks;
  }) as any;
}
