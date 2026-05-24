---
name: circuit-breaker
description: P2 automated failure tracking and escalation guidance. Tracks per-task failure counts in framework-state.md and determines the correct escalation tier (auto-retry → narrower scope → architect review → human escalation) based on the retry protocol defined in framework-core.md.
agent_created: true
level: user
---

# circuit-breaker

## Purpose

Track task failure counts and guide escalation according to the Circuit-Breaker Retry Protocol. When a task fails repeatedly, the circuit breaker determines the appropriate escalation tier and provides actionable instructions.

## State Tracking

Failure counts are stored in `.workbuddy/memory/framework-state.md` under the `## Failure Tracking` section:

```
| Task ID | Failures | Last Failure | Tier | Status |
|---------|----------|-------------|------|--------|
| T-EXAMPLE | 2 | 2026-05-24 10:00:00 | narrower | active |
```

## Escalation Tiers

| Failures | Tier | Action |
|----------|------|--------|
| 1 | **auto-retry** | Re-attempt with same scope. Log failure reason. |
| 2 | **narrower** | Use Plan mode to break task into smaller sub-tasks. Retry each independently. |
| 3 | **architect** | Call `architect` to re-examine contract.yaml assumptions. Check for inconsistent assumptions between layers. |
| 4+ | **human** | Present full failure context: guardian report, code diff, test report, arbiter decisions. **Do not retry without user instruction.** |

## Workflow

### Step 1: Record Failure

When a task fails:

1. Read `framework-state.md` — check existing Failure Tracking section
2. If task already has a row: increment Failures, update Last Failure timestamp, recalculate Tier
3. If task is new: add row with Failures=1, Tier=auto-retry
4. Write updated `framework-state.md`

### Step 2: Determine Escalation

Read the failure count for the task and map to tier:

- **1 failure**: Provide auto-retry instructions
- **2 failures**: Instruct to break task into sub-tasks via Plan mode
- **3 failures**: Instruct to call `architect` for contract/design review
- **4+ failures**: Instruct to present full context to user and STOP

### Step 3: Reset on Success

When a previously-failed task succeeds:

1. Remove the task row from Failure Tracking table
2. Log success in invocation-log.md

## Output Format

```
Circuit Breaker — T-EXAMPLE
===========================================
Failures: 2 → Tier: narrower (narrower scope)
Action: Use Plan mode to break this task into smaller sub-tasks.
        Each sub-task should target ≤3 files. Retry each independently.

Last failure: 2026-05-24 10:00:00
Previous attempts:
  1st: auto-retry — <reason from 1st failure>
  2nd: narrower — pending
```

## Integration

Used by:
- `coder` agent — invoked on test failure, build failure, or gate rejection
- Main agent — invoked when any task fails to complete
- `guardian` agent — can check failure counts during gate confirm

## Usage

/circuit-breaker record <task_id> <reason>   — Record a failure and get escalation guidance
/circuit-breaker status <task_id>             — Show current failure count and tier
/circuit-breaker reset <task_id>              — Reset failure count on success
/circuit-breaker list                         — List all tasks with active failures
