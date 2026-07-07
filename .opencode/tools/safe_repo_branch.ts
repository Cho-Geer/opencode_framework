import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { repoBranch } from "../service/repo/git";
import { auditRepoRead, auditRepoClassified } from "../service/repo/audit";
import { classifyGitArgv } from "../service/repo/classify";

export default tool({
  description: "Get current branch or list branches (read-only, no grant required)",
  args: {
    mode: tool.schema.enum(["current", "list"]).describe("'current' returns current branch name, 'list' returns all branches"),
  },
  execute: async (args, context) => {
    return withInterruptGuard("safe_repo_branch", async () => {
      const op = classifyGitArgv(["git", "branch"]);
      auditRepoClassified(op, context.sessionID);

      const result = repoBranch({ mode: args.mode });

      auditRepoRead(context.sessionID, context.agent || "unknown", "safe_repo_branch", op, result.ok ? "success" : "failed");

      return JSON.stringify({
        ok: result.ok,
        tool: "safe_repo_branch",
        operationKind: "read",
        provider: "git",
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
  },
});
