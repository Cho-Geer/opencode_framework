import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { repoStatus } from "../service/repo/git";
import { auditRepoRead, auditRepoClassified } from "../service/repo/audit";
import { classifyGitArgv } from "../service/repo/classify";

export default tool({
  description: "Get git repository status (read-only, no grant required)",
  args: {
    porcelain: tool.schema.boolean().optional().describe("Use porcelain v1 output format"),
  },
  execute: async (args, context) => {
    return withInterruptGuard("safe_repo_status", async () => {
      const op = classifyGitArgv(["git", "status"]);
      auditRepoClassified(op, context.sessionID);

      const result = repoStatus(args.porcelain);

      auditRepoRead(context.sessionID, context.agent || "unknown", "safe_repo_status", op, result.ok ? "success" : "failed");

      return JSON.stringify({
        ok: result.ok,
        tool: "safe_repo_status",
        operationKind: "read",
        provider: "git",
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    });
  },
});
