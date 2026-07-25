/**
 * rule_read_attest.ts — Rule Read Attestation (Thin Controller)
 * Delegates to SessionService.attestRuleRead()
 * @see service/session/rule-attest.ts
 */

import { tool } from "@opencode-ai/plugin";
import { attestRuleRead } from "../service/session/";
import type { FrameworkToolContext } from "./tool-context";

export default tool({
  description:
    "Verify that the agent has read all required rule files " +
    "before being allowed to proceed past initial_read phase. " +
    "Cross-checks against read_audit SQLite DB. " +
    "Required rules are configured in project.config.json template_resolution.required_rule_reads. " +
    "Called by agents during Phase 0 (initial_read).",

  args: {
    task_id: tool.schema.string().describe("DAG task ID for session tracking"),
  },

  async execute(args: { task_id?: string }, context: FrameworkToolContext) {
    let agent = context.agent;
    const { sessionID, worktree } = context;

    if (!agent) {
      agent = process.env.FRAMEWORK_AGENT || "";
    }

    const result = attestRuleRead({
      agent,
      sessionID,
      worktree,
      taskId: args.task_id || null,
    });

    return JSON.stringify(result);
  },
});
