import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { repoLog } from "../service/repo/git";
import { auditRepoRead, auditRepoClassified } from "../service/repo/audit";
import { classifyGitArgv } from "../service/repo/classify";

export default tool({
  description: "Get git commit log (read-only, no grant required, max 50 entries)",
  args: {
    maxCount: tool.schema.number().optional().describe("Maximum number of commits to show (default 20, max 50)"),
    paths: tool.schema.array(tool.schema.string()).optional().describe("Limit log to specific file paths"),
  },
  execute: async (args, context) => {
    return withInterruptGuard("safe_repo_log", async () => {
      const op = classifyGitArgv(["git", "log"]);
      auditRepoClassified(op, context.sessionID);

      const result = repoLog({ maxCount: args.maxCount, paths: args.paths });

      auditRepoRead(context.sessionID, context.agent || "unknown", "safe_repo_log", op, result.ok ? "success" : "failed");

      return JSON.stringify({
        ok: result.ok,
        tool: "safe_repo_log",
        operationKind: "read",
        provider: "git",
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
  },
});
