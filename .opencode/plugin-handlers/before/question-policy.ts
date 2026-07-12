// ────────────────────────────────────────────────────────────────────
// RETIRED-ROLLBACK — NOT in active execution_order; kept for rollback only
// Kept as delegate dependency or for rollback only.
// Do NOT call directly from dispatcher. See project.config.json
// plugin_execution_order for the active handler chain.
// ────────────────────────────────────────────────────────────────────
// plugin-handlers/before/question-policy.ts — Sub-agent question tool policy
// Migrated from plugins/question-policy-before.ts
import { writeLog } from "../../lib/log-manager";
import { resolveAgent } from "../../lib/agent-resolver";
import { isPrivileged } from "../../lib/agent-identity";
import { isQuestionAllowedForAll } from "../../service/enforcement/exemptions";

export const name = "question-policy";
export const tools = ["question"];

export async function handle(input: any, output: any): Promise<void> {
  if (input.tool !== "question") return;

  // Config-driven: allow all agents if question_policy.allow_all_agents is true
  if (isQuestionAllowedForAll()) {
    writeLog("question-policy-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID,
      event: "QUESTION-ALLOWED-ALL", level: "INFO",
      detail: "allowed | resolution=config-allow-all",
    });
    return;
  }

  const agent = resolveAgent(input.sessionID) || process.env.FRAMEWORK_AGENT || "unknown";
  if (agent === "unknown" || isPrivileged(agent)) {
    writeLog("question-policy-before", "runtime", {
      sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
      event: agent === "unknown" ? "QUESTION-ALLOWED-UNKNOWN" : "PRIMARY-QUESTION-ALLOWED",
      level: agent === "unknown" ? "WARN" : "INFO",
      detail: `allowed | agent=${agent} | resolution=cascade`,
    });
    return;
  }

  writeLog("question-policy-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID, agent, agentType: agent,
    event: "SUBAGENT-QUESTION-BLOCKED", level: "WARN",
    detail: `blocked | agent=${agent} | tool=question`,
  });

  const errorMsg =
    `[question-policy-before] BLOCKED: Agent "${agent}" attempted to use ` +
    `the built-in question tool. Subagents must NOT use question directly. ` +
    `Record user input needs in HANDOVER.md under ## Questions for User, ` +
    `## Assumptions, or ## Blocked Actions Requiring User Approval sections. ` +
    `See preflight-lite.\n[STOP] Do NOT attempt alternative tools, different commands, or workarounds to bypass this rule. This is a HARD CONSTRAINT violation.\n[REPORT] Immediately inform the user that this action was blocked. Do not continue the current task path.`;

  console.error(errorMsg);
  throw new Error(errorMsg);
}
