---
name: preflight-lite
description: Lightweight preflight for all tasks. Classify risk, select execution skills, use TodoWrite as working memory. Use before any task execution.
version: 2.0.0
---

# preflight-lite

Always run this quick preflight before task execution.

1. Restate the user goal in one sentence.
2. Classify risk: trivial / standard / high-risk / blocked.
3. Decide execution state:
   - trivial -> no TodoWrite required
   - standard -> create 3-5 actionable todos
   - high-risk -> create 5-8 todos including evidence, validation, rollback/handoff
   - blocked -> create one blocked todo and ask question/QoderWork
4. Select execution skills:
   - unclear/design/risk -> brainstorming
   - source edit/refactor/debug -> codegraph-first
   - framework/plugin/hook/agent -> customize-opencode + codegraph-first
   - dispatch/subagent/handoff -> dispatch-protocol
   - deliverables/review/approval -> deliverable-contract
   - CI/deploy/container -> ci-cd-guardrails + cross-directory-ci
   - database/schema/seed -> cicd-database-seeding
   - external API/framework/library/version -> context7-first or local authoritative docs
   - complex research/conflicting evidence/stuck -> escalate to Scout via native Task
5. Decide knowledge freshness: if external APIs, framework behavior, dependency versions, CLI flags, config formats, or current best practices matter, gather Context7/local authoritative evidence before planning or editing.
6. If the task is audit/debug/investigation/root-cause oriented, including keywords such as investigation, audit, analysis, diagnose, debug, troubleshoot, root-cause, trace, tracing, forensic, 调查, 排查, 调试, 诊断, 根因, 审计, 追溯, 排错, 定位, search code plus at least two log or state sources before conclusions. Typical sources: `.task_temp/_logs/`, `gate-state.json`, `framework-state.db`, `session_log`. Deliverables should include a `## Logs Checked` section.
7. For framework/agent/plugin/permission work, read the authoritative config files first: `.opencode/agents/<agent>.md`, `opencode.json`, `.opencode/project.config.json`. When child task context exists, call `config_read_attest(task_id)` after the reads.
8. Keep exactly one todo in_progress; each write/validation/Scout action must map to current in_progress todo.
9. On tool failure, update the todo with recovery intent before retrying.
10. Gather minimum local evidence before conclusions.
11. If requirements are unclear or risky, ask with question/QoderWork before writing. If blocked, create one blocked todo and state assumptions or user-facing blockers explicitly in deliverables/handover.
12. Before writes, rely on active hooks for scope/codegraph/permission; do not bypass blocks.
13. Use native Task directly when Scout/research help is needed; do not depend on legacy subagent-preamble or dispatch_subagent wrappers.
14. For small safe tasks, proceed without DAG/gate/checklist.
