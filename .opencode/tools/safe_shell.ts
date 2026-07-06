import { tool } from "@opencode-ai/plugin";
import { safeBashTool } from "../service/file-guard";
import { withInterruptGuard } from "../lib";
import { writeLog } from "../lib/log-manager";
import { writeJsonl } from "../lib/jsonl-writer";

export default tool({
  description:
    "Allowlisted shell command execution. Only predefined safe commands are permitted. " +
    "Use this for all shell/terminal operations. Replaces legacy safe_bash plugin tool.",
  args: {
    command: tool.schema.string().describe("Shell command to execute"),
    timeout: tool.schema
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 300000)"),
    dryRun: tool.schema
      .boolean()
      .optional()
      .describe("Validate without executing"),
    breakGlass: tool.schema
      .boolean()
      .optional()
      .describe("Emergency override: skip path restrictions, log audit trail."),
  },
  async execute(args, context) {
    return withInterruptGuard("safe_shell", async () => {
      // breakGlass audit logging (actual bypass is handled by behavioral-path-guard plugin)
      if (args.breakGlass) {
        writeLog("safe-shell", "WARN", {
          event: "BREAK-GLASS-SAFE-SHELL",
          command: args.command?.slice(0, 200),
          agent: context.agent ?? "unknown",
        });
        writeJsonl("break-glass", {
          event: "safe_shell_break_glass",
          command: args.command?.slice(0, 200),
        }, { tool: "safe_shell" });
      }
      const agent = context.agent ?? "unknown";
      const result = safeBashTool({
        command: args.command,
        timeout: args.timeout,
        dryRun: args.dryRun,
        agent,
      });

      if (!result.allowed) {
        throw new Error(
          `safe_shell blocked: ${result.blockedReason} (command: ${args.command})`,
        );
      }

      if (args.dryRun) {
        return `Command validated and allowed: ${args.command}`;
      }

      return JSON.stringify(
        {
          output: result.stdout || "",
          metadata: {
            exitCode: result.exitCode,
            stderr: result.stderr,
            executed: result.executed,
            agent: result.agent,
          },
        },
        null,
        2,
      );
    });
  },
});
