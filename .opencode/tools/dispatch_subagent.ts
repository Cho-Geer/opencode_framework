// tools/dispatch_subagent.ts — Thin Controller
// Phase 2: Delegates to DispatchService.dispatch()
import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { resolveCallerIdentity } from "../service/session";
import { dispatch } from "../service/dispatch/router";
import type { FrameworkToolContext } from "./tool-context";

export default tool({
  description:
    "Generate a wrapped, compliance-enforced prompt for dispatching a sub-agent " +
    "via Task(). Runs dispatch-subagent.js to embed DISPATCH_TOKEN and P0 protocol. " +
    "Every dispatch creates a NEW session. Context between dispatches is carried " +
    "exclusively via HANDOVER.md files. Usable by @Orchestrator (all agents) and " +
    "@Super-Admin (@Knowledge-Curator only, UC7KS knowledge tasks).",
  args: {
    agent_type: tool.schema.string().describe(
      "Target agent type (e.g., 'Architect', 'Coder-BE', 'plan'). " +
      "@Super-Admin may only target 'Knowledge-Curator' or '@Knowledge-Curator'."),
    task_description: tool.schema.string().describe("Task description to wrap with P0 protocol and DISPATCH_TOKEN"),
    dag_task_id: tool.schema.string().optional().describe(
      "DAG Task ID — must exist in Task.DAG.json for non-DAG-exempt agents."),
    session_namespace: tool.schema.string().describe(
      "Output path namespace — used for .task_temp/{session_namespace}/ directory."),
    auto_plan: tool.schema.boolean().optional().describe(
      "PLAN-FIRST self-healing (opt-in). Auto-dispatches @plan if task not in DAG."),
    resume_session_id: tool.schema.string().optional().describe(
      "Session ID of a previously dispatched sub-agent to resume."),
    dispatch_privilege: tool.schema.string().optional().describe(
      "Privilege type to grant the child (e.g., 'framework_maintenance'). " +
      "Orchestrator-only — router rejects non-Orchestrator callers. " +
      "Creates a task-level dispatch_privilege_grant bound to the child session. " +
      "For framework_maintenance, the child must first run CodeGraph, then call " +
      "framework_maintenance_plan to declare planned paths, then use safe_framework_edit."),
    allowed_paths: tool.schema.array(tool.schema.string()).optional().describe(
      "Optional glob patterns that further narrow the privilege grant (e.g., ['.opencode/**']). " +
      "If omitted, framework_maintenance uses the default policy. Relative to worktree."),
    allowed_remotes: tool.schema.array(tool.schema.string()).optional().describe(
      "Optional remote names allowed for repo remote-write grants (e.g., ['origin'])."),
    privilege_reason: tool.schema.string().optional().describe(
      "Human-readable reason for the privilege grant (audit log)."),
    _frameworkMaintenance: tool.schema.boolean().optional().describe(
      "Internal compatibility flag for legacy framework-maintenance callers."),
  },
  async execute(args, context: FrameworkToolContext) {
    // Phase 2: ordinary path retirement - only explicit privilege dispatch remains on the wrapper
    const requestedPrivilege = (args.dispatch_privilege || process.env.DISPATCH_PRIVILEGE || "").trim();
    const isFrameworkMaintenance = requestedPrivilege === "framework_maintenance"
      || process.env.DISPATCH_PRIVILEGE_REASON?.includes("framework_maintenance")
      || args._frameworkMaintenance === true;
    const isRepoPrivilege = requestedPrivilege === "repo_maintenance"
      || requestedPrivilege === "remote_repo_write"
      || requestedPrivilege === "repo_destructive_emergency";
    if (!isFrameworkMaintenance && !isRepoPrivilege) {
      return JSON.stringify({
        output: "dispatch_subagent is retired for ordinary paths. Use native Task tool instead. "
          + "Privilege-bearing child work (framework_maintenance / repo_maintenance / "
          + "remote_repo_write / repo_destructive_emergency) may still use this wrapper.",
        metadata: { retired: true, alternative: "Task", requiresPrivilege: true },
      });
    }
    return withInterruptGuard("dispatch_subagent", async () => {
      const callerAgent = resolveCallerIdentity(
        context.sessionID || "",
        context.agent || "",
      );
      const result = await dispatch({
        agentType: args.agent_type,
        taskDescription: args.task_description,
        dagTaskId: args.dag_task_id,
        sessionNamespace: args.session_namespace,
        autoPlan: args.auto_plan,
        resumeSessionId: args.resume_session_id,
        callerAgent,
        sessionId: context.sessionID || "",
        worktree: context.worktree || process.cwd(),
        callId: context.callID || undefined,
        dispatch_privilege: args.dispatch_privilege,
        allowed_paths: args.allowed_paths,
        allowed_remotes: args.allowed_remotes,
        privilege_reason: args.privilege_reason,
      });
      return result.prompt;
    });
  },
});
