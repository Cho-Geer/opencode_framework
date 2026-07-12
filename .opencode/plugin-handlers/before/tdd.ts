// ────────────────────────────────────────────────────────────────────
// RETIRED-ROLLBACK — NOT in active execution_order; kept for rollback only
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/before/tdd.ts — TDD per-write enforcement
// Migrated from plugins/tdd-before.ts
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { checkTddEnforcement } from "../../service/tdd";

export const name = "tdd";
export const tools = ["*"];

export async function handle(input: any, output: any): Promise<void> {
  const agent = resolveAgent(input.sessionID);
  const filePath = (output.args?.filePath as string) || "";

  const result = checkTddEnforcement(agent, input.tool, filePath);

  if (!result.allowed) {
    writeLog("tdd-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      level: "ERROR", event: "TOOL-BEFORE",
      detail: "BLOCKED | " + result.message,
    });
    throw new Error(result.message);
  }
}
