// .opencode/tools/dispatch_subagent.ts
import { tool } from "@opencode-ai/plugin"
import { readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

export default tool({
  description:
    "Generate a wrapped, compliance-enforced prompt for dispatching a sub-agent " +
    "via Task(). Runs dispatch-subagent.js to embed DISPATCH_TOKEN and P0 protocol. " +
    "Every dispatch creates a NEW session. Context between dispatches is carried " +
    "exclusively via HANDOVER.md files. Only usable by @Orchestrator.",
  args: {
    agent_type: tool.schema.string()
      .describe("Target agent type (e.g., 'Architect', 'Coder-BE', 'Meta-Planner')"),
    task_description: tool.schema.string()
      .describe("Task description to wrap with P0 protocol and DISPATCH_TOKEN"),
    dag_task_id: tool.schema.string().optional()
      .describe("Dispatch session identifier — an ID assigned to the background sub-agent " +
                "process/delegation in OpenCode. Used for output path namespacing " +
                "(.task_temp/{dag_task_id}/) and session tracking. " +
                "Passed internally as FRAMEWORK_TASK_ID env var. " +
                "NOTE: This is NOT a DAG task ID — it is a dispatch session identifier " +
                "for OpenCode's sub-agent background process. Pre-execution gate skips " +
                "DAG coverage checks when this is set (--dispatch-session flag)."),
  },
  async execute(args, context) {
    // ── Security: Orchestrator-only ──
    const caller = context.agent || ""
    if (caller !== "Orchestrator" && caller !== "@Orchestrator") {
      throw new Error(
        `[FW-ENFORCE][LOCKED] dispatch_subagent restricted to @Orchestrator. ` +
        `Caller '${caller}' denied.`
      )
    }

    const worktree = context.worktree || process.cwd()
    const dagTaskId = args.dag_task_id || ""

    // ── Execute dispatch-subagent.js ──
    // Use execFileSync to bypass shell, preventing injection/misparsing of
    // special characters (newlines, backticks, CJK) in task_description.
    // task_description and dag_task_id passed via env vars (authoritative) AND
    // positional args (for CLI/test compatibility with the new 2-param pattern).
    const scriptPath = path.join(
      worktree, ".opencode", "scripts", "command-tools", "dispatch-subagent.js"
    )

    // Build argv: [scriptPath, agent_type, dag_task_id?, task_description?]
    // dag_task_id is passed as 2nd positional param so dispatch-subagent.js
    // can extract it when called with the 2-param pattern.
    const scriptArgs = [args.agent_type];
    if (dagTaskId) {
      scriptArgs.push(dagTaskId);
    }
    scriptArgs.push(args.task_description);

    let outputFilePath: string
    try {
      const stdout = execFileSync("node", [scriptPath, ...scriptArgs], {
        encoding: "utf8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          DISPATCH_TASK_DESC: args.task_description,
          ...(dagTaskId ? { FRAMEWORK_TASK_ID: dagTaskId } : {}),
        },
      })
      outputFilePath = stdout.trim()
    } catch (error) {
      const err = error as any
      throw new Error(
        `dispatch_subagent: dispatch-subagent.js failed (exit ${err.status || 1}): ` +
        `${err.stderr?.toString() || err.message}`
      )
    }

    const wrappedPrompt = await readFile(outputFilePath, "utf8")

    // ── Build structured response ──
    const header = [
      `/// DISPATCH RESULT`,
      `/// agent_type: ${args.agent_type}`,
      `/// dag_task_id: ${dagTaskId || "(none)"}`,
      `/// output_file: ${outputFilePath}`,
      `///`,
      `/// 🆕 Call Task() to dispatch (always new session):`,
      `///   Task({`,
      `///     subagent_type: "${args.agent_type}",`,
      `///     description: "<short description>",`,
      `///     prompt: <PROMPT BELOW>`,
      `///   })`,
      `///`,
      `/// 💡 Context between dispatches is carried via HANDOVER.md`,
      `///    (written by sub-agents to .task_temp/{dag_task_id}/HANDOVER.md)`,
      `///`,
    ]

    return [...header, ``, wrappedPrompt].join("\n")
  },
})
