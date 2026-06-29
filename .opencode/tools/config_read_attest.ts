/**
 * config_read_attest.ts — Config Read Attestation (Thin Controller)
 * Delegates to SessionService.attestConfigRead()
 * @see service/session/config-attest.ts
 */

import { tool } from "@opencode-ai/plugin";
import { attestConfigRead } from "../service/session/";

export default tool({
  description:
    "Verify that the agent has read all 3 mandatory config files " +
    "(agent config, opencode.json, project.config.json) before being " +
    "allowed to write. Cross-checks against read_audit SQLite DB. " +
    "Writes result to config_read_state sub-state. " +
    "Called by agents during P0 Step 0e.",

  args: {
    task_id: tool.schema.string().describe("DAG task ID for session tracking"),
  },

  async execute(args: { task_id?: string }, context: any) {
    let agent = context.agent;
    const { sessionID, worktree } = context;

    // FRAMEWORK_AGENT fallback
    if (!agent) {
      agent = process.env.FRAMEWORK_AGENT || "";
    }

    const result = attestConfigRead({
      agent,
      sessionID,
      worktree,
      taskId: args.task_id || null,
    });

    return JSON.stringify(result);
  },
});
