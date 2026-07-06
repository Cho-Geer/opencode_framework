// ────────────────────────────────────────────────────────────────────
// LEGACY HANDLER — NOT in active execution_order
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/audit.ts — audit trail management
// Migrated from plugins/audit-after.ts
import { recordWriteAudit } from "../../service/file-guard";

export const name = "audit";
export const tools = ["*"];

export async function handle(input: any, _output: any): Promise<void> {
  recordWriteAudit({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    filePath: (input.args as any)?.filePath || "",
  });
}
