---
name: dispatch-protocol
description: Dispatch protocol for child-agent work. Native Task is the default path; dispatch_subagent remains required for privilege-bearing child work and other legacy compatibility flows. Covers PLAN-FIRST/DAG rules, dag_task_id uniqueness, session resume, investigation-task checklist, and wrapper usage. Triggers: dispatch, 派遣, dispatch_subagent, sub-agent, child task.
---

# dispatch-protocol

Mandatory protocol for child dispatches. Prefer native `Task`; use `dispatch_subagent()` when a privilege-bearing child task needs framework repo/framework grant setup, or when legacy wrapper behavior is explicitly needed.

> Full documentation: read `.opencode/skills/dispatch-protocol/FULL.md`
