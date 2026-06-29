# Compliance Gate State Machine Standard v1.0

**Version**: v1.0.0
**Created**: 2026-06-26
**Author**: @Super-Admin (SA-GATE-OPT-002)
**Status**: active
**Applies To**: All 10 agents
**Enforcement**: Physically enforced by `.opencode/scripts/mcp-tools/compliance-gate.ts`

---

## §1 Overview

This document defines the **complete state machine** for the compliance gate lifecycle, including all valid state transitions, role-specific paths, error recovery procedures, and implicit file requirements.

### §1.1 Purpose

Before this document, the compliance gate state machine was implicit — encoded in `compliance-gate.ts` source code but never documented. This caused agents to:

1. Call the wrong tool at the wrong state (e.g., `complete` on a `delivered` session)
2. Not know about implicit file requirements (e.g., `TASK_LOG.md` must exist but cannot be in `declared_deliverables`)
3. Not know the correct recovery procedure after a `recoverable` state

### §1.2 Design Principles

| Principle                       | Description                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Two completion paths**        | Exempt agents use a fast path; non-exempt agents use a full approval path                                                             |
| **Implicit file requirements**  | `HANDOVER.md` and `TASK_LOG.md` must exist on disk at submit/complete time, but only `HANDOVER.md` appears in `declared_deliverables` |
| **Recoverable is not terminal** | `recoverable` state allows self-repair via `retry_confirm` — the gate is not lost                                                     |
| **READ-BEFORE-APPROVE**         | Approvers must use the `read` tool (not `safe_hash`) to read `HANDOVER.md` within 5 minutes before approving                          |

---

## §2 State Diagram

```
                         ┌──────────────────────────────────────────────────┐
                         │                                                  │
                         ▼                                                  │
  ┌─────────┐    check    ┌─────────┐   confirm   ┌───────┐                 │
  │ (start)  │───────────▶│ checked │───────────▶│ armed │                 │
  └─────────┘             └─────────┘            └───┬───┘                 │
                                                    │                     │
                              ┌─────────────────────┼─────────────┐       │
                              │                     │             │       │
                              │ (exempt fast path)  │ (full path) │       │
                              │                     ▼             │       │
                              │              ┌──────────┐         │       │
                              │              │delivered │         │       │
                              │              └────┬─────┘         │       │
                              │                   │               │       │
                              │           ┌───────┴───────┐       │       │
                              │           │               │       │       │
                              │     (missing files)  (approve)    │       │
                              │           │               │       │       │
                              │           ▼               ▼       │       │
                              │     ┌─────────────┐ ┌─────────┐   │       │
                              │     │recoverable  │ │approved │   │       │
                              │     └──────┬──────┘ └────┬────┘   │       │
                              │            │             │        │       │
                              │     retry_confirm        │        │       │
                              │            │             │        │       │
                              │            └────▶ armed  │        │       │
                              │                           │        │       │
                              ▼                           ▼        ▼       │
                        ┌──────────┐              ┌──────────┐           │
                        │completed │◀─────────────│completed │           │
                        └──────────┘              └──────────┘           │
                                                         │                │
                                                    (ESLint/tsc fail)    │
                                                         │                │
                                                         ▼                │
                                                   ┌──────────┐          │
                                                   │  failed  │──────────┘
                                                   └──────────┘ (terminal)
```

---

## §3 States

| State         | Description                                             | Can transition to                                                                                                |
| ------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `checked`     | Gate check passed, not yet confirmed                    | `armed` (via confirm)                                                                                            |
| `armed`       | Plan confirmed, task in progress                        | `delivered` (via submit), `completed` (via complete, exempt only), `recoverable` (via submit with missing files) |
| `delivered`   | Artifacts submitted, awaiting approval                  | `approved` (via approve), `completed` (via approve with execution_summary)                                       |
| `recoverable` | Submit/complete failed due to missing artifacts         | `armed` (via retry_confirm)                                                                                      |
| `approved`    | Deliverables approved by Orchestrator/Super-Admin       | `completed` (via complete or auto-complete)                                                                      |
| `completed`   | Task finished, gate consumed                            | (terminal)                                                                                                       |
| `failed`      | Terminal failure (retries exhausted, ESLint/tsc errors) | (terminal)                                                                                                       |

---

## §4 Role-Specific Paths

### §4.1 Non-exempt Agents (Coder-BE, Coder-FE, Architect, Guardian, Arbiter, CI-CD-Agent, Knowledge-Curator, Meta-Planner)

```
check → confirm(declared_deliverables=[HANDOVER.md]) → submit → delivered
  → (wait for Orchestrator approve) → completed
```

**Key rules**:

- `declared_deliverables` is **required** at confirm time
- Must call `submit_deliverables` — cannot skip to `complete`
- Cannot call `approve_deliverables` — that's Orchestrator's job
- Cannot call `complete` — `approval_required=true` blocks it

### §4.2 Exempt Agents: Orchestrator & Super-Admin (own tasks)

```
check → confirm(optional declared_deliverables) → complete
```

**Key rules**:

- `declared_deliverables` is **optional** at confirm time
- Can call `complete` directly from `armed` state (fast path)
- `complete` still checks HANDOVER.md + TASK_LOG.md existence
- May also use the full path (submit → self-approve) if preferred

### §4.3 Exempt Agents: Approving Others' Deliverables

```
(read HANDOVER.md via `read` tool)
  → approve_deliverables(session_id, approval_decision="approve", handover_sha256=<hash>, execution_summary=<summary>)
  → auto-completed
```

**Key rules**:

- **MUST** use the `read` tool to read HANDOVER.md within 5 minutes before approving
- `safe_hash` alone is NOT sufficient — `read_audit` tracks `read` tool calls, not `safe_hash`
- If `execution_summary` is provided, approve auto-completes (approve + complete in one call)
- Restricted to @Orchestrator and @Super-Admin only

---

## §5 Implicit File Requirements

### §5.1 The HANDOVER.md / TASK_LOG.md Paradox

| File          | Must exist on disk? | Must be in declared_deliverables? | Must be in deliverables_evidence? |
| ------------- | :-----------------: | :-------------------------------: | :-------------------------------: |
| `HANDOVER.md` |       ✅ Yes        |              ✅ Yes               |              ✅ Yes               |
| `TASK_LOG.md` |       ✅ Yes        |               ❌ No               |               ❌ No               |

**Why the difference?**

- `HANDOVER.md` is the primary deliverable — it must be declared, submitted, and approved
- `TASK_LOG.md` is a working-memory scratch pad — it must exist (for audit) but is not a "deliverable" in the approval sense
- The `submit_deliverables` function checks both files exist on disk (L2153-2163), but only accepts evidence entries that match `declared_deliverables` (L2119-2140)

### §5.2 File Location

Both files must be at:

```
.task_temp/{task_id}/HANDOVER.md
.task_temp/{task_id}/TASK_LOG.md
```

Where `{task_id}` is the DAG task ID (or gate session ID if no DAG task ID was assigned).

---

## §6 Error Recovery Guide

### §6.1 recoverable State

**Cause**: `submit_deliverables` or `complete` found missing artifacts (HANDOVER.md or TASK_LOG.md).

**Recovery procedure**:

1. Create the missing file(s) under `.task_temp/{task_id}/`
2. Call `compliance_gate_retry_confirm(session_id, plan_summary)`
3. Re-call `compliance_gate_submit_deliverables` (or `complete` if exempt)

**Common mistake**: Re-calling `submit_deliverables` without `retry_confirm` first. This fails because the session is in `recoverable` state, not `armed`.

### §6.2 rejected Status

**Cause**: Various validation failures (wrong state, missing params, unauthorized agent).

**Recovery**: Read the `reason` field in the response — it now includes specific next-step guidance (SA-GATE-OPT-002 optimization).

### §6.3 READ-BEFORE-APPROVE Failure

**Cause**: Approver called `approve_deliverables` without reading HANDOVER.md via the `read` tool within the last 5 minutes.

**Recovery**:

1. Call the `read` tool on `.task_temp/{task_id}/HANDOVER.md`
2. Compute SHA-256 via `safe_hash`
3. Re-call `compliance_gate_approve_deliverables` with the hash

**Note**: `safe_hash` does NOT satisfy the read audit — only the `read` tool does.

### §6.4 Stale Armed Session

**Cause**: An armed session > 24h old blocks new gate creation for the same task_id.

**Recovery**: Call `compliance_gate_drain_stale` to drain the stale session, then start a new gate.

---

## §7 Tool-to-State Matrix

| Tool                                   | Required state                              | Resulting state                 | Who can call                                                  |
| -------------------------------------- | ------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `compliance_gate_check`                | (none)                                      | `checked`                       | All agents                                                    |
| `compliance_gate_confirm`              | `checked`                                   | `armed`                         | All agents                                                    |
| `compliance_gate_submit_deliverables`  | `armed`                                     | `delivered` or `recoverable`    | All agents                                                    |
| `compliance_gate_approve_deliverables` | `delivered`                                 | `approved` or `completed`       | @Orchestrator, @Super-Admin                                   |
| `compliance_gate_complete`             | `armed` (exempt) or `approved` (non-exempt) | `completed` or `failed`         | All agents (but non-exempt needs approval first)              |
| `compliance_gate_retry_confirm`        | `recoverable` or `failed`                   | `armed`                         | All agents (recoverable); @Super-Admin/@Orchestrator (failed) |
| `compliance_gate_drain_stale`          | (any)                                       | drains armed>24h or checked>48h | All agents                                                    |
| `compliance_gate_purge`                | (any)                                       | force-purge all stale           | All agents                                                    |

---

## §8 Related Documents

| Document                                                    | Relationship                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| `.opencode/scripts/mcp-tools/compliance-gate.ts`            | Implementation (single source of truth)                    |
| `.opencode/subagent-preamble.md`                            | Contains the compliance gate protocol summary              |
| `.opencode/rules/rule_detail/enforcement-modes-standard.md` | Defines advisory/strict/locked behavior                    |
| `.opencode/rules/rule_detail/state-machine-standard.md`     | General state machine standard (contracts, task lifecycle) |

---

## §9 Version History

| Date       | Version | Changes                                                                                                                  | Author                         |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 2026-06-26 | 1.0.0   | Initial creation. Documented all 7 states, 3 role-specific paths, implicit file requirements, error recovery procedures. | @Super-Admin (SA-GATE-OPT-002) |
