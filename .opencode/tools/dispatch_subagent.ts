// tools/dispatch_subagent.ts — Thin Controller
// Phase 2: Delegates to DispatchService.dispatch()
import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { resolveCallerIdentity } from "../service/session";
import { dispatch } from "../service/dispatch/router";

export default tool({
  description:
    "Generate a wrapped, compliance-enforced prompt for dispatching a sub-agent " +
    "via Task(). Runs dispatch-subagent.js to embed DISPATCH_TOKEN and P0 protocol. " +
    "Every dispatch creates a NEW session. Context between dispatches is carried " +
    "exclusively via HANDOVER.md files. Usable by @Orchestrator (all agents) and " +
    "@Super-Admin (@Knowledge-Curator only, UC7KS knowledge tasks).",
  args: {
    agent_type: tool.schema.string().describe(
      "Target agent type (e.g., 'Architect', 'Coder-BE', 'Meta-Planner'). " +
      "@Super-Admin may only target 'Knowledge-Curator' or '@Knowledge-Curator'."),
    task_description: tool.schema.string().describe("Task description to wrap with P0 protocol and DISPATCH_TOKEN"),
    dag_task_id: tool.schema.string().optional().describe(
      "DAG Task ID — must exist in Task.DAG.json for non-DAG-exempt agents."),
    session_namespace: tool.schema.string().optional().describe(
      "Output path namespace — used for .task_temp/{session_namespace}/ directory."),
    auto_plan: tool.schema.boolean().optional().describe(
      "PLAN-FIRST self-healing (opt-in). Auto-dispatches @Meta-Planner if task not in DAG."),
    resume_session_id: tool.schema.string().optional().describe(
      "Session ID of a previously dispatched sub-agent to resume."),
    dispatch_privilege: tool.schema.string().optional().describe(
      "Privilege type to grant the child (e.g., 'framework_maintenance'). " +
      "Orchestrator-only — router rejects non-Orchestrator callers. " +
      "Creates a one-time dispatch_privilege_grant bound to the child session. " +
      "Combined with CodeGraph impact evidence (double gate) for safe_framework_edit."),
    allowed_paths: tool.schema.array(tool.schema.string()).optional().describe(
      "Glob patterns the privilege grant may write to (e.g., ['.opencode/**']). " +
      "Required when dispatch_privilege is set. Relative to worktree."),
    privilege_reason: tool.schema.string().optional().describe(
      "Human-readable reason for the privilege grant (audit log)."),
  },
  async execute(args, context) {
    return withInterruptGuard("dispatch_subagent", async () => {
      const callerAgent = resolveCallerIdentity(
        (context as any)?.sessionID || "",
        (context as any)?.agent || "",
      );
      const result = await dispatch({
        agentType: args.agent_type,
        taskDescription: args.task_description,
        dagTaskId: args.dag_task_id,
        sessionNamespace: args.session_namespace,
        autoPlan: args.auto_plan,
        resumeSessionId: args.resume_session_id,
        callerAgent,
        sessionId: (context as any)?.sessionID || "",
        worktree: (context as any)?.worktree || process.cwd(),
        callId: (context as any)?.callID || undefined,
        dispatch_privilege: args.dispatch_privilege,
        allowed_paths: args.allowed_paths,
        privilege_reason: args.privilege_reason,
      });
      return result.prompt;
    });
  },
});
