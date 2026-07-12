// plugin-handlers/before/tool-governance-handler.ts
// Thin handler that delegates to service/tool-governance/controller.ts
// This handler belongs to the Service layer (called by Controller-layer dispatcher).
import { writeLog } from "../../lib/log-manager";
import { evaluate } from "../../service/tool-governance/controller";
import type { ToolGovernanceContext } from "../../service/tool-governance/context";
import { classifyRepoShellCommand, classifyGithubMcpTool } from "../../service/repo/classify";
import { getEffectivePathScopePaths } from "../../service/dispatch/tool-scope-paths";
import { resolveAgent } from "../../lib/agent-resolver";

export const name = "tool-governance";
export const tools = ["*"];

export async function handle(input: any, output: any): Promise<void> {
  const toolName = input.tool ?? "unknown";
  const sessionID = input.sessionID ?? "unknown";
  const agent = resolveAgent(sessionID) ?? "unknown";
  const args = input.args || output.args || {};
  const command = (args.command || "").toString();

  // Build targetPaths from tool args
  let targetPaths: string[] = [];
  const filePath = (args.filePath || args.path || args.file_path || "").toString();
  if (filePath) {
    targetPaths.push(filePath);
  } else {
    // For safe_shell, try to extract paths from command
    try {
      const scopeResult = getEffectivePathScopePaths(toolName, args);
      if (scopeResult.paths && scopeResult.paths.length > 0) {
        targetPaths = scopeResult.paths;
      }
    } catch {
      // fall through
    }
  }

  // Build repo operation if applicable
  let repoOperation = null;
  if (command && (toolName === "safe_shell" || toolName === "bash")) {
    repoOperation = classifyRepoShellCommand(command);
  } else if (
    toolName.startsWith("github_") ||
    /^mcp_+github_/i.test(toolName)
  ) {
    // Live GitHub MCP tools are exposed as `mcp_GitHub_*` (OpenCode MCP naming);
    // classifyGithubMcpTool normalizes them back to the `github_*` form.
    repoOperation = classifyGithubMcpTool(toolName, args);
  }

  const ctx: ToolGovernanceContext = {
    sessionID,
    callID: input.callID,
    agent,
    tool: toolName,
    args,
    command: command || undefined,
    targetPaths,
    repoOperation,
  };

  try {
    evaluate(ctx);
  } catch (e: any) {
    writeLog("tool-governance-handler", "runtime", {
      sessionID,
      callID: input.callID,
      agent,
      tool: toolName,
      level: "WARN",
      event: "HANDLER-BLOCK",
      detail: String(e.message).slice(0, 200),
    });
    throw e;
  }
}
