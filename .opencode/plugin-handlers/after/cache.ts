// ────────────────────────────────────────────────────────────────────
// LEGACY HANDLER — NOT in active execution_order
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/cache.ts — knowledge cache sync
// Migrated from plugins/cache-after.ts
import { syncCacheState } from "../../service/knowledge";

export const name = "cache";
export const tools = ["*"];

export async function handle(input: any, _output: any): Promise<void> {
  const filePath = (input.args as any)?.filePath || "";
  syncCacheState({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    filePath,
  });
}
