---
name: review-arbitration
description: Circuit-breaker retry policy and escalation strategy.
---

# Review Arbitration

> Extracted from Orchestrator.md (Phase 1, 2026-07-05)

## Retry Decision Matrix

| Failure Count | Strategy | Additional Action |
|---|---|---|
| 1 | Original Agent auto-retry | Log failure to TASK_LOG.md |
| 2 | Degraded retry (@Meta-Planner re-decompose) | Update DAG task granularity |
| 3 | @Arbiter circuit-break + Expert switch | @Architect re-examines contract |
| 4 | @Arbiter second circuit-break + Human standby | Attach full failure context |

## Escalation Strategies

### 1. Degraded Retry (High Priority)
- Call @Meta-Planner to re-evaluate and generate smaller task
- Use when: scope too large, dependencies complex, difficulty exceeds expectations

### 2. Expert Switch (Medium Priority)
- Backend failures → @Architect re-examine contract.yaml
- Frontend failures → Check HANDOVER.md assumptions vs backend
- Use when: contract design unreasonable, front/back assumptions inconsistent

### 3. Human Standby (Low Priority, Final Fallback)
- @mention project lead with complete failure context:
  - @Guardian review report (all violations)
  - @Coder code diff + test report
  - HANDOVER.md summary
  - @Arbiter adjudication explanation
