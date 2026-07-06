/**
 * skill_read_attest.ts — Skill Read Attestation (Thin Controller)
 * Delegates to SessionService.attestSkillRead()
 * @see service/session/skill-attest.ts
 */

import { tool } from "@opencode-ai/plugin";
import { attestSkillRead } from "../service/session/";

export default tool({
  description:
    "Verify that the agent has read all required skill files " +
    "before being allowed to proceed past initial_read phase. " +
    "Cross-checks against read_audit SQLite DB. " +
    "Required skills are configured in project.config.json template_resolution.required_skill_reads. " +
    "Called by agents during Phase 0 (initial_read).",

  args: {
    task_id: tool.schema.string().describe("DAG task ID for session tracking"),
  },

  async execute(args: { task_id?: string }, context: any) {
    let agent = context.agent;
    const { sessionID, worktree } = context;

    if (!agent) {
      agent = process.env.FRAMEWORK_AGENT || "";
    }

    const result = attestSkillRead({
      agent,
      sessionID,
      worktree,
      taskId: args.task_id || null,
    });

    return JSON.stringify(result);
  },
});
