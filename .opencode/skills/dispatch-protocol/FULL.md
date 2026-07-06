---
name: dispatch-protocol
description: Dispatch protocol for child-agent work. Native Task is preferred; dispatch_subagent is legacy compatibility only.
---

# Dispatch Protocol

> Extracted from Orchestrator.md (Phase 1, 2026-07-05)

## 1. Native Task First

Default path: dispatch child work with native `Task()`.

Use `dispatch_subagent()` only when you explicitly need legacy wrapper behavior such as old queue bookkeeping or wrapper-specific resume flow.

Rule: one child dispatch operation must create exactly one child `Task()` call. No duplicate child sessions for the same handoff.

## 2. UNIQUE dag_task_id PER DISPATCH OPERATION

If you use `dag_task_id`, it must be unique per child dispatch operation. Reusing causes lineage confusion in legacy queue paths.

```
Task(Architect, "review-contracts", "...")                 ✅
Task(Architect, "review-contracts-v2", "...")              ✅
dispatch_subagent(Architect, "VERIFY-FINAL", "First")      ✅ (legacy compat)
dispatch_subagent(Architect, "VERIFY-FINAL", "Different")  ❌ (same dag_task_id)
```

If you MUST re-dispatch the same agent: use a new dag_task_id.

## 3. PLAN-FIRST Dispatch Protocol

Every dispatch of a non-DAG-exempt subagent (Architect, Coder-BE, Coder-FE, Guardian, Arbiter, CI-CD-Agent) MUST be backed by a task entry in `Task.DAG.json`.

**DAG-exempt agents** (may dispatch without DAG entry): Meta-Planner, Orchestrator, Super-Admin, Knowledge-Curator.

### When auto_plan_enabled=true
Legacy wrapper path only: set `auto_plan: true` on `dispatch_subagent` for automatic planning:
```
dispatch_subagent(agent_type="CI-CD-Agent", task_description="...", 
  dag_task_id="TASK-001", auto_plan=true)
```

### When auto_plan_enabled=false
Do NOT skip to DAG-exempt agent. ALWAYS dispatch @Meta-Planner first, then re-dispatch with planned dag_task_id.

## 4. Investigation-Task Pre-Dispatch Checklist

Before dispatching any task containing investigation keywords (investigation, audit, diagnosis, debug, troubleshoot, root-cause, 调查, 排查, 调试, 诊断, 根因):

- [ ] Task description includes explicit instruction to search runtime logs
- [ ] Target agent has `read` permission to relevant log paths
- [ ] Log paths match agent's permission scope
- [ ] Task description mentions at least one concrete log path

**Why**: Sub-agents default to code-only searches. Without explicit log instruction, investigation tasks produce incomplete conclusions.

## 5. Session Resume Protocol

When deliverables are rejected, resume the original session instead of creating new one:

```
dispatch_subagent(
  agent_type: "Coder-BE",
  task_description: "Fix deliverables: [rejection reason]",
  dag_task_id: "SAME-TASK-ID",           // MUST be same as original
  resume_session_id: "<session_id>"       // From session_log DB
)
```

**Constraints**:
- Same dag_task_id as original dispatch
- session_log DB entry must exist
- Only valid for sessions in `armed` or `delivered` state
- Maximum 3 resume attempts per session

## 6. Do Not Re-Centralize on dispatch_subagent

- For Scout/research help, use native `Task` directly.
- Do not require `subagent-preamble`.
- Do not add wrapper-only language to generic execution skills.
- Keep wrapper knowledge as compatibility guidance, not as the default mental model.
