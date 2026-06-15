# Summary — Subagent Session Reuse via `task_id`

**Date**: 2026-06-14
**Full investigation**: [`investigation.md`](./investigation.md)

---

## Question

> Can the Orchestrator dispatch a subagent with a task ID or session ID such that the subagent session is **continuously reused** via `dispatch_subagent.ts` + `Task()`?

## Answer

**YES upstream, NO locally.**

- **Upstream OpenCode** supports it natively: the `Task` tool has an optional `task_id` parameter documented as *"This should only be set if you mean to resume a previous task"* ([`packages/opencode/src/tool/task.ts`](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/task.ts)). When `task_id` is provided, the tool looks up an existing subagent session by that ID and appends the new prompt to the session's message thread. The session ID is returned to the caller via `metadata.sessionId`.
- **Local framework** explicitly forbids it:
  - `dispatch_subagent.ts` description: *"Every dispatch creates a NEW session."*
  - `dispatch-subagent.ts` `P0-FIX-BUG-15-L1`: fatally rejects reuse of the same `dag_task_id` for different task descriptions.
  - `framework-enforcer.ts` `TASK-PROMPT-MISMATCH`: would reject an augmented `Task()` call.

## Three independent blockers in the local framework

| # | Mechanism | Location | Effect |
|---|-----------|----------|--------|
| 1 | Description + header claim | `dispatch_subagent.ts:184`, lines 412–428 | LLM is instructed to call `Task({...})` with no `task_id` |
| 2 | `P0-FIX-BUG-15-L1` fatal exit | `dispatch-subagent.ts:835–873` | Same `dag_task_id` + different prompt hash → process.exit(1) |
| 3 | `TASK-PROMPT-MISMATCH` gate | `framework-enforcer.ts` | Prompt hash would change if `task_id` were added to `Task()` |

## Recommended path to enable (~2.5 hours)

1. Add optional `resume_session_id` argument to `dispatch_subagent.ts` (separate from `dag_task_id`).
2. Soften `P0-FIX-BUG-15-L1` to allow resume (keep idempotent dedup).
3. Update `framework-enforcer.ts` to exclude the resume `task_id` from hash comparison.
4. Surface the returned session ID via `.task_temp/{dag_task_id}/SESSION_ID.md`.
5. Update Orchestrator.md / AGENTS.md to document the resume protocol.
6. Extend HANDOVER.md contract with `SESSION_ID: <id>`.

## If declined

Keep the current "always new session" contract; continue using HANDOVER.md as the cross-dispatch continuity channel. Document the decision explicitly so future maintainers know the upstream capability was considered.

## Sources

- [`packages/opencode/src/tool/task.ts`](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/task.ts) — Task tool source (key quote: `task_id: Schema.optional(Schema.String).annotate({ description: 'This should only be set if you mean to resume a previous task' })`)
- [Agents — OpenCode docs](https://opencode.ai/docs/agents/)
- [GitHub issue #6907](https://github.com/anomalyco/opencode/issues/6907) — direct chat with subagent sessions was removed in v1.1.1; resume via `Task(task_id)` is the programmatic equivalent
- [GitHub issue #6573](https://github.com/anomalyco/opencode/issues/6573) — confirms each `Task()` invocation generates unique identifiers rather than reusing the parent
- Local files: `.opencode/tools/dispatch_subagent.ts`, `.opencode/scripts/command-tools/dispatch-subagent.ts`, `.opencode/plugins/framework-enforcer.ts`
