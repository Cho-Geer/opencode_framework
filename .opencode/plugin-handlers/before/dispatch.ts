// ────────────────────────────────────────────────────────────────────
// LEGACY HANDLER — NOT in active execution_order
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/before/dispatch.ts — PLAN-FIRST dispatch policy enforcement
// Migrated from plugins/dispatch-before.ts
import { validateDispatchBefore } from "../../service/dispatch";

export const name = "dispatch";
export const tools = ["*"];

export async function handle(input: any, output: any): Promise<void> {
  const result = validateDispatchBefore(input, output);
  if (result.blocked) {
    throw new Error(result.message);
  }
}
