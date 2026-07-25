import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { repoShow } from "../service/repo/git";
import { auditRepoRead, auditRepoClassified } from "../service/repo/audit";
import { classifyGitArgv } from "../service/repo/classify";

export default tool({
  description: "Show a git object (commit, tree, blob) (read-only, no grant required)",
  args: {
    ref: tool.schema.string().describe("Git ref to show (commit SHA, branch name, tag, HEAD~1, etc.)"),
    paths: tool.schema.array(tool.schema.string()).optional().describe("Limit output to specific file paths"),
  },
  execute: async (args, context) => {
    return withInterruptGuard("safe_repo_show", async () => {
      const op = classifyGitArgv(["git", "show"]);
      auditRepoClassified(op, context.sessionID);

      const result = repoShow({ ref: args.ref, paths: args.paths });

      auditRepoRead(context.sessionID, context.agent || "unknown", "safe_repo_show", op, result.ok ? "success" : "failed");

      return JSON.stringify({
        ok: result.ok,
        tool: "safe_repo_show",
        operationKind: "read",
        provider: "git",
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
  },
});
