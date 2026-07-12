// ────────────────────────────────────────────────────────────────────
// RETIRED-ROLLBACK — NOT in active execution_order; kept for rollback only
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/task.ts — task failure recording
// Migrated from plugins/task-after.ts
import { trackTaskComplete } from "../../service/gate";

export const name = "task";
export const tools = ["*"];

export async function handle(input: any, output: any): Promise<void> {
  trackTaskComplete({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    args: input.args || {},
    output,
  });
}
