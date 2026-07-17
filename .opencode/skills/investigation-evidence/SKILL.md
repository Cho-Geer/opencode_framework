---
name: investigation-evidence
description: Enforce evidence-based investigation for debug, audit, analysis, root-cause, and troubleshooting tasks. Requires code evidence + log evidence + Logs Checked section. Use when task involves investigation, audit, diagnosis, debug, troubleshooting, root-cause, trace, forensic, 调查, 排查, 调试, 诊断, 根因, 审计, 追溯, 排错, 定位.
version: 1.0.0
---

# Investigation Evidence

For all investigation/debug/audit/root-cause tasks, you MUST gather multi-source evidence before drawing conclusions.

## Required Evidence Sources

> **步骤类型区分**：Code evidence 是 `[ANALYSIS]`（读源码、搜索模式、追踪调用链），Log evidence 是 `[VERIFICATION]`（运行态日志、DB 记录、状态文件）。根因结论必须基于至少一项 `[VERIFICATION]` 证据，不能仅凭 Code evidence 下结论。

1. **Code evidence** `[ANALYSIS]`: Read the relevant source files, search for patterns, trace call chains.
2. **Log evidence** `[VERIFICATION]` (minimum 2 sources):
   - `.task_temp/_logs/` — plugin runtime logs, JSONL audit trails
   - `gate-state.json` / `gate-state.history/` — compliance gate state transitions
   - `.opencode/state/framework-state.db` — DB records (via bun:sqlite)
   - `.task_temp/_dispatch/` — dispatch records

## Output Requirements

Your output MUST include:

### `## Logs Checked`
| Source | Path | Time Range | Findings |
|--------|------|------------|----------|
| Plugin logs | `.task_temp/_logs/2026-MM-DD/` | HH:MM-HH:MM | ... |
| Gate state | `.opencode/state/gate-state.json` | current | ... |

### `## Findings`
| Finding | Evidence | Confidence |
|---------|----------|------------|
| Root cause is X | file.ts:42 + log entry at 10:05 | High |

## Prohibited

- Speculative conclusions without evidence
- Single-source assertions
- Fabricating causes or guessing
