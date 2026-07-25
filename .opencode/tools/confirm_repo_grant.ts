import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { resolveCallerIdentity } from "../service/session";
import {
  confirmLatestRepoGrantForParent,
  type RepoPrivilege,
} from "../service/repo/grants";
import type { FrameworkToolContext } from "./tool-context";

const ALLOWED_PRIVILEGES = new Set<RepoPrivilege>([
  "repo_maintenance",
  "remote_repo_write",
  "repo_destructive_emergency",
]);

export default tool({
  description:
    "Confirm the latest pending/bound repo grant created by the current Orchestrator session. " +
    "Use after dispatch_subagent for privilege-bearing repo work and before Task()/tool execution " +
    "when human approval is required.",
  args: {
    privilege: tool.schema.string().describe(
      "Repo privilege to confirm: repo_maintenance, remote_repo_write, or repo_destructive_emergency.",
    ),
    agent_type: tool.schema.string().optional().describe(
      "Optional child agent type filter (for example: build).",
    ),
    remote: tool.schema.string().optional().describe(
      "Optional remote name filter for remote_repo_write grants (for example: origin).",
    ),
    approval_note: tool.schema.string().describe(
      "Short note citing the explicit human approval or instruction that authorizes this repo action.",
    ),
  },
  async execute(
    args: {
      privilege: string;
      agent_type?: string;
      remote?: string;
      approval_note: string;
    },
    context: FrameworkToolContext,
  ) {
    return withInterruptGuard("confirm_repo_grant", async () => {
      const callerAgent = resolveCallerIdentity(
        context.sessionID || "",
        context.agent || "",
      );
      if (callerAgent !== "orchestrator") {
        throw new Error(
          `[FW-ENFORCE][REPO-GRANT-CONFIRM] Only Orchestrator can confirm repo grants. Caller: ${callerAgent}`,
        );
      }

      const privilege = args.privilege as RepoPrivilege;
      if (!ALLOWED_PRIVILEGES.has(privilege)) {
        throw new Error(
          `[REPO-GRANT-CONFIRM-INVALID-PRIVILEGE] Unsupported repo privilege: ${args.privilege}`,
        );
      }

      const confirmed = confirmLatestRepoGrantForParent(
        {
          parent_session_id: context.sessionID || "",
          privilege,
          agent_type: args.agent_type,
          allowed_remote: args.remote,
        },
        context.sessionID || "",
        args.approval_note,
      );

      if (!confirmed) {
        throw new Error(
          `[REPO-GRANT-CONFIRM-NO-MATCH] No pending/bound ${privilege} grant found for parent session `
          + `${context.sessionID || "(unknown)"}. Dispatch the privileged child first, then confirm it.`,
        );
      }

      return JSON.stringify({
        ok: true,
        tool: "confirm_repo_grant",
        grantId: confirmed.id,
        privilege: confirmed.privilege,
        parentSessionId: confirmed.parent_session_id,
        childSessionId: confirmed.child_session_id,
        humanConfirmedAt: confirmed.human_confirmed_at,
        requiredHumanConfirmation: confirmed.requires_human_confirmation === 1,
        allowedRemotes: JSON.parse(confirmed.allowed_remotes || "[]"),
      });
    });
  },
});
