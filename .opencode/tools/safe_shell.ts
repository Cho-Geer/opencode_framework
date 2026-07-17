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
    __verified_command_plan: tool.schema.object({
      executable: tool.schema.string(),
      args: tool.schema.array(tool.schema.string()),
      cwd: tool.schema.string(),
      env: tool.schema.record(tool.schema.string(), tool.schema.string()),
      outputMode: tool.schema.enum(["buffered", "stream"]),
      timeoutMs: tool.schema.number(),
      maxOutputBytes: tool.schema.number(),
    }).optional().describe("Internal: auto-propagated by tool-governance before-hook. Do not set manually."),
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
      const result = await safeBashTool({
        command: args.command,
        timeout: args.timeout,
        dryRun: args.dryRun,
        agent,
        verifiedPlan: args.__verified_command_plan,
        signal: context.abort,
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
            signal: result.signal,
            timedOut: result.timedOut,
            aborted: result.aborted,
            truncated: result.truncated,
          },
        },
        null,
        2,
      );
    });
  },
});
