---
description: Emergency Super-Admin dispatch. Usage: /dispatch "<task_description>"
agent: Super-Admin
subtask: true
---

# 🚨 EMERGENCY DISPATCH AUTHORIZED

| Field | Value |
|-------|-------|
| **Authorization** | Human operator invoked `/dispatch` |
| **Agent** | Super-Admin |
| **Privileges** | Full bypass (DAG gate, TDD, write scope) |
| **Task** | $ARGUMENTS |

## Your Mission

Execute the emergency framework repair described above.

## Immediate Protocol

1. Call `compliance_gate_check(task_description="$ARGUMENTS")` — establish audit session
2. Present repair plan to human operator and await explicit confirmation
3. Upon confirmation, call `compliance_gate_confirm(session_id="<sid>", plan_summary="<summary>")`
4. Execute the repair with minimal, focused changes
5. Call `compliance_gate_complete(session_id="<sid>", execution_summary="<what was done>")`
6. Write `HANDOVER.md` to `.task_temp/{taskId}/` with full change documentation
7. Run `node .opencode/scripts/framework-self-test.js` to verify integrity

## Reminders

- ❌ Do NOT modify business code (booking-backend/src/, booking-frontend/src/)
- ❌ Do NOT change enforcement_mode without @Arbiter approval
- ❌ Do NOT auto-commit without human approval
- ✅ All destructive operations require `question` tool confirmation
- ✅ Every file change needs JSDoc explaining the **why**

Begin emergency repair immediately.
