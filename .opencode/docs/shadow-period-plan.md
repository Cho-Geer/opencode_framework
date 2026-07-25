# Shadow Period Plan (Phase 5)

> **Created**: 2026-07-05
> **Phase**: 5

---

## Shadow Period Design

### Duration
Minimum 1 week or 50 tasks, whichever comes first.

### Method
1. Old Agent prompts archived in `.opencode/.trash-phase1/agents-pre-phase5/`
2. New alias manifests are the default
3. If alias manifest fails, restore from archive (git revert)

### Comparison Metrics
| Metric | How to Measure |
|--------|---------------|
| Task completion rate | Compare success/fail ratio |
| Tool call accuracy | Compare tool error rates |
| Skill invocation rate | Check skill-audit logs |
| QoderWork intervention count | Count acp_notify events |
| Agent confusion events | Count [FW-ENFORCE] blocks |

### Rollback Trigger
If any of these occur during shadow period:
1. Agent cannot complete ordinary safe_edit
2. question tool unavailable in any enforcement state
3. QoderWork cannot observe or inject guidance
4. dispatch_subagent cannot create child sessions
5. Alias cannot resolve to native executor

---

## T5.3: Legacy Prompt Status

**Status**: Legacy prompts are ALREADY replaced by alias manifests.
- Old prompts: archived in `.opencode/.trash-phase1/agents-pre-phase5/`
- New prompts: alias manifests (57 total body lines)
- Recovery: `git checkout` from pre-Phase 5 commit

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | Shadow period plan created |
