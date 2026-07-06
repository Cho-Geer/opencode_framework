// ────────────────────────────────────────────────────────────────────
// LEGACY HANDLER — NOT in active execution_order
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/uc7ks.ts — knowledge pipeline compliance
// Migrated from plugins/uc7ks-after.ts
import { trackKnowledgeAfter } from "../../service/knowledge";

export const name = "uc7ks";
export const tools = ["*"];

export async function handle(input: any, output: any): Promise<void> {
  trackKnowledgeAfter({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    args: input.args || {},
    output,
  });
}
