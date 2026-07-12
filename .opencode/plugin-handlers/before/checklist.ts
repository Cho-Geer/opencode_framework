// ────────────────────────────────────────────────────────────────────
// RETIRED-ROLLBACK — NOT in active execution_order; kept for rollback only
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/before/checklist.ts — P0 checklist enforcement
// Migrated from plugins/checklist-before.ts
import { validateChecklistBefore } from "../../service/gate";

export const name = "checklist";
export const tools = ["*"];

export async function handle(input: any, output: any): Promise<void> {
process.stderr.write(`[CHECKLIST-BEFORE] ENTER tool=${input?.tool} session=${input?.sessionID}\n`);
  const toolName = input?.tool || "unknown";
  const sessionID = input?.sessionID || "unknown";
  process.stderr.write(`[CHECKLIST-BEFORE] ENTER tool=${toolName} session=${sessionID}\n`);
  try {
    const result = validateChecklistBefore(input, output);
    process.stderr.write(`[CHECKLIST-BEFORE] result blocked=${result.blocked} msg=${(result.message || "").slice(0, 120)}\n`);
    if (result.blocked) {
      throw new Error(result.message);
    }
  } catch (err: any) {
    if (err.message?.startsWith("[FW-ENFORCE")) {
      throw err; // re-throw enforcement blocks
    }
    process.stderr.write(`[CHECKLIST-BEFORE] ERROR: ${err.message}\n`);
    // Don't swallow - rethrow so framework knows
    throw err;
  }
}
