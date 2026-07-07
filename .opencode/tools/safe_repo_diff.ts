import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { repoDiff } from "../service/repo/git";
import { auditRepoRead, auditRepoClassified } from "../service/repo/audit";
import { classifyGitArgv } from "../service/repo/classify";

export default tool({
  description: "Get git diff output (read-only, no grant required)",
  args: {
    paths: tool.schema.array(tool.schema.string()).optional().describe("Limit diff to specific file paths"),
    cached: tool.schema.boolean().optional().describe("Show staged changes (git diff --cached)"),
    stat: tool.schema.boolean().optional().describe("Show diffstat summary instead of full diff"),
  },
  execute: async (args, context) => {
    return withInterruptGuard("safe_repo_diff", async () => {
      const op = classifyGitArgv(["git", "diff"]);
      auditRepoClassified(op, context.sessionID);

      const result = repoDiff({ paths: args.paths, cached: args.cached, stat: args.stat });

      auditRepoRead(context.sessionID, context.agent || "unknown", "safe_repo_diff", op, result.ok ? "success" : "failed");

      return JSON.stringify({
        ok: result.ok,
        tool: "safe_repo_diff",
        operationKind: "read",
        provider: "git",
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        paths: args.paths,
      });
    });
  },
});
