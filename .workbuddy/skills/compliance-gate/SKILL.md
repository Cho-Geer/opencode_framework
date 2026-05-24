---
name: compliance-gate
description: P0 mandatory compliance gate enforcing check/confirm/complete lifecycle for every task. The Stop hook in .codebuddy/settings.json provides hard enforcement (blocks session end if gate incomplete). This Skill provides the workflow and state management.
agent_created: true
level: user
---

# compliance-gate

## Purpose

Enforce a mandatory compliance gate lifecycle on every task: **check → confirm → complete**. The gate is BLOCKING in strict/locked mode — no task can start or complete without passing.

## Enforcement Model

Compliance gate enforcement operates at two levels:

1. **Hard enforcement (Stop hook)**: The `.codebuddy/settings.json` Stop hook **blocks session end** if any compliance gate session has not reached `complete` phase. This is platform-enforced and cannot be bypassed by the AI agent.

2. **Workflow enforcement (This Skill)**: Provides the check/confirm/complete workflow, state persistence, and manual invocation. The Skill is the primary interface for interacting with the gate lifecycle.

The Stop hook reads `gate-sessions.md` and checks for incomplete sessions. This Skill maintains the state that the hook validates.

## Configuration

All configuration is read from `.workbuddy/project.yaml`:

- `enforcement.mode` — advisory (warn) | strict (block) | locked (block all)
- `enforcement.compliance_gate_required` — whether gate is enforced
- `enforcement.tdd_enforcement` — whether TDD rule is checked
- `enforcement.write_audit` — whether writes are logged

## Gate Lifecycle

```
Gate Check (task start)  →  Gate Confirm (pre-completion)  →  Gate Complete (post-completion)
       │                            │                                │
       ▼                            ▼                                ▼
   Validate entry               Verify all rules               Record gate result
   Block if prior gate          Warn if P1 violations          Transition gate state
   is pending/failed            Block if P0 violations         Log to gate-sessions.md
```

## State Persistence

Gate state is tracked in `.workbuddy/memory/gate-sessions.md` — NOT a separate JSON file. This eliminates the "split brain" problem from the original dual-state design (machine.json + gate-state.json).

## Workflow

### Step 1: Gate Check (Entry)

Before any task starts:

1. Read `project.yaml → enforcement.mode`
2. Read `gate-sessions.md` for prior gate states
3. If enforcement mode is `advisory`: log warning only, allow entry
4. If enforcement mode is `strict` or `locked`:
   - Check no prior task has a `failed` gate result
   - Check no prior task has a `pending` gate that has not timed out
   - If blocked: HALT and report which prior task is blocking
5. Record gate session in `gate-sessions.md` with phase `check`
6. Log invocation in `invocation-log.md`

### Step 2: Gate Confirm (Pre-Completion)

Before marking a task as completed:

1. Verify all P0 rules are satisfied:
   - Compliance gate has been checked (this session exists)
   - TDD discipline followed (if `enforcement.tdd_enforcement: true`)
   - Contract integrity validated (if contract files configured)
   - Verification suite passed for affected layers (if business code modified)
2. Verify P1 rules and collect warnings:
   - Code quality gate passed (lint, types, deps)
   - Write audit trail exists
3. Record gate session phase `confirm` in `gate-sessions.md`
4. If any P0 rule fails: BLOCK, do not complete
5. If P1 rule fails: WARN but allow with note

### Step 3: Gate Complete (Post-Completion)

After task completion:

1. Record final gate result (passed / failed / bypassed-with-note)
2. Update gate session phase to `complete` in `gate-sessions.md`
3. Log invocation in `invocation-log.md`
4. Update `framework-state.md` compliance dimension

## Integration

This skill is invoked by:
- The main agent (orchestrator role) before dispatching any task
- `guardian` agent for quality enforcement
- WorkBuddy Plan mode for DAG entry validation

## Usage

```text
/compliance-gate check     — Run entry gate check before starting work
/compliance-gate confirm   — Run pre-completion verification
/compliance-gate complete  — Finalize gate and record result
/compliance-gate status    — Show current gate state for active session
```
