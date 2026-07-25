// ────────────────────────────────────────────────────────────────────
// DELEGATE HANDLER — NOT in execution_order but called by active handlers.
// Called by: unified-audit / quality-contract / dispatch-trace / guidance-recovery.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/after/tdd.ts — post-write TDD verification
// Migrated from plugins/tdd-after.ts
import { verifyTddWrite } from "../../service/tdd";

export const name = "tdd";
export const tools = ["*"];

export async function handle(input: any, _output: any): Promise<void> {
  verifyTddWrite(
    input.sessionID,
    input.callID,
    input.tool,
    input.args || {},
  );
}
