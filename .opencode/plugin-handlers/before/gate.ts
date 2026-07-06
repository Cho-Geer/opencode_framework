// ────────────────────────────────────────────────────────────────────
// LEGACY HANDLER — NOT in active execution_order
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/before/gate.ts — gate & DAG enforcement + auto-arm
// Migrated from plugins/gate-before.ts
import { autoArmGateSession, validateGateBefore } from "../../service/gate";

export const name = "gate";
export const tools = ["*"];

// Auto-arm gate session on module load (same as original)
autoArmGateSession();

export async function handle(input: any, output: any): Promise<void> {
  const result = validateGateBefore(input, output);
  if (result.blocked) {
    throw new Error(result.message);
  }
}
