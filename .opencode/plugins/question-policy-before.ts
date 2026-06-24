/**
 * question-policy-before.ts — Sub-agent question tool policy enforcement
 * ======================================================================
 * PHYSICALLY blocks `question` tool calls from dispatched subagent sessions.
 * Part of the sub-agent question propagation mitigation (Phase 1, Issue #148).
 *
 * @plugin question-policy-before
 * @hook   tool.execute.before
 * @since  2026-06-21 (@Super-Admin, PHASE3-TEST-HARNESS)
 * @fix    2026-06-21 (@Super-Admin, E2E-HOTFIX-PLUGIN) — Rewrote to use
 *         STANDARD plugin pattern: resolveAgent(input.sessionID) + writeLog +
 *         getEnforcementMode. Fixes Orchestrator question blocking caused by
 *         unreliable toolContext.agent (undefined in many runtime contexts).
 * @fix    2026-06-21 (@Super-Admin, E2E-HOTFIX-V2) — Cascading agent resolution:
 *         1. resolveAgent(input.sessionID) — dispatched agents
 *         2. process.env.FRAMEWORK_AGENT — primary Orchestrator/Super-Admin
 *         3. "unknown" — default-permissive (ALLOW). Fixes a regression where
 *         resolveAgent() returned "" for primary Orchestrator question calls,
 *         causing the Orchestrator to be blocked from using the question tool.
 *
 * Context:
 * - `question` is an OpenCode built-in tool (permission key: "question")
 * - Subagents (Meta-Planner, Architect, Coder-BE, Coder-FE, Guardian, Arbiter,
 *   CI-CD-Agent, Knowledge-Curator) should NOT use question directly
 * - Instead, subagents record needed user input in HANDOVER.md
 * - Orchestrator and Super-Admin are the only agents allowed to use question
 *
 * Enforcement:
 * - Identifies the calling agent via resolveAgent(input.sessionID)
 * - Blocks `question` calls for all non-Orchestrator/non-Super-Admin agents
 * - Logs blocked attempts via writeLog for auditing
 * - In strict/locked mode, throws Error to physically block execution
 *
 * References:
 * - docs/review/framework-refactor/sub-agent-question-propagation-issue.md
 * - opencode.json agent.*.permission.question
 * - .opencode/subagent-preamble.md Step 0d
 * - .opencode/lib/agent-resolver.ts (resolveAgent)
 */

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { resolveAgent } from "../lib/agent-resolver";
import { getEnforcementMode } from "../lib/gate-core";
import { isPrivileged, normalize } from "../lib/agent-identity";

/**
 * question-policy-before — Standard plugin export using withPluginLifecycle.
 * Hooks into tool.execute.before to intercept `question` tool calls.
 */
export default withPluginLifecycle("question-policy-before", {
  "tool.execute.before": questionPolicyBefore,
});

/**
 * questionPolicyBefore — Prevent subagent `question` calls.
 *
 * Uses cascading agent resolution to identify the caller:
 * 1. resolveAgent(input.sessionID) — dispatched agents via session_map DB
 * 2. process.env.FRAMEWORK_AGENT — primary sessions (Orchestrator/Super-Admin)
 * 3. "unknown" fallback — default-permissive (ALLOW)
 *
 * The `question` tool input has shape:
 *   { questions: [{ question, header, options, multiple }] }
 *
 * @param {object} input — Tool execution input { tool, sessionID, callID }
 * @param {object} output — Tool execution output { args }
 */
async function questionPolicyBefore(input: any, output: any): Promise<void> {
  // Only enforce for the `question` tool
  if (input.tool !== "question") {
    return;
  }

  // Cascading agent resolution:
  // 1. resolveAgent(input.sessionID) — works for dispatched agents
  // 2. process.env.FRAMEWORK_AGENT — set for primary Orchestrator/Super-Admin
  const agent =
    resolveAgent(input.sessionID) || process.env.FRAMEWORK_AGENT || "unknown";
  const mode = getEnforcementMode();

  // When agent is unknown (can't determine), allow by default
  // (Safer to allow Orchestrator than to block it)
  if (agent === "unknown" || isPrivileged(agent)) {
    writeLog("question-policy-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent,
      agentType: agent,
      event:
        agent === "unknown"
          ? "QUESTION-ALLOWED-UNKNOWN"
          : "PRIMARY-QUESTION-ALLOWED",
      level: agent === "unknown" ? "WARN" : "INFO",
      detail: `allowed | agent=${agent} | resolution=cascade`,
    });
    return;
  }

  // BLOCK subagents
  writeLog("question-policy-before", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent,
    agentType: agent,
    event: "SUBAGENT-QUESTION-BLOCKED",
    level: "WARN",
    detail: `blocked | agent=${agent} | tool=question`,
  });

  const errorMsg =
    `[question-policy-before] BLOCKED: Agent "${agent}" attempted to use ` +
    `the built-in question tool. Subagents must NOT use question directly. ` +
    `Record user input needs in HANDOVER.md under ## Questions for User, ` +
    `## Assumptions, or ## Blocked Actions Requiring User Approval sections. ` +
    `See .opencode/subagent-preamble.md Step 0d.`;

  console.error(errorMsg);

  if (mode === "strict" || mode === "locked") {
    throw new Error(errorMsg);
  }
}
