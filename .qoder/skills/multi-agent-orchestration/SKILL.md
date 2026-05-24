---
name: multi-agent-orchestration
description: Trigger and orchestrate the three-layer eight-role multi-agent system for complex development tasks. Use when user mentions "multi-agent mode", "multi-agent", or when tasks require full-lifecycle development (requirements analysis, architecture design, coding, testing, review, deployment). Automatically validates AGENTS.md alignment, verifies all 8 agent configurations, and initiates the standard multi-agent workflow.
---

# Multi-Agent Orchestration

## Trigger Conditions

Activate when user conversation contains any of:
- "multi-agent mode"
- "multi-agent"
- Complex full-lifecycle development tasks requiring multiple roles
- **Any new issue / bug / style inconsistency / error fix** (see automatic trigger rules below)

### 🚨 Automatic Trigger Rule

The following scenarios **automatically trigger** the multi-agent workflow, regardless of whether the user explicitly mentions "multi-agent":

| Scenario | Example | Triggered? |
|----------|---------|:-----------:|
| A verifiable **code problem or requirement** is described | "style inconsistency", "error occurred", "button not working" | ✅ Yes |
| The issue **involves code changes** (not a pure information query) | "fix this bug", "adjust layout" | ✅ Yes |
| The issue **spans multiple components/modules** | "frontend-backend integration issue", "dark/light mode theme color" | ✅ Yes |
| **Pure information query** | "what does this API parameter mean", "where is this documented" | ❌ No |

**If any of the above code-change scenarios is met** → the full multi-agent workflow is mandatory, **starting with dispatch of @Meta-Planner as the first action**.

## Pre-flight Validation

### Step 1: Verify AGENTS.md

1. Read `AGENTS.md` at project root
2. Confirm it exists and contains the 8-agent registry:
   - @Meta-Planner, @Orchestrator, @Architect, @Coder-FE, @Coder-BE, @Guardian, @Arbiter, @CI-CD-Agent
3. Verify the standard execution flow (Section 6) is present

### Step 2: Validate Agent Configurations

Check each agent file in `.qoder/agents/`:

| Agent | File | Expected Name |
|-------|------|---------------|
| Meta-Planner | `meta-planner.md` | Meta-Planner |
| Orchestrator | `orchestrator.md` | Orchestrator |
| Architect | `architect.md` | Architect |
| Coder-FE | `coder-fe.md` | Coder-FE |
| Coder-BE | `coder-be.md` | Coder-BE |
| Guardian | `guardian.md` | Guardian |
| Arbiter | `arbiter.md` | Arbiter |
| CI-CD-Agent | `ci-cd-agent.md` | CI-CD-Agent |

For each agent file verify:
- YAML frontmatter `name` field matches AGENTS.md declaration
- `skills` list is present and non-empty
- `model` field is set
- Core Responsibilities, Mandatory Constraints, Input Contract, Output Artifacts sections exist

### Step 3: Alignment Check

Compare AGENTS.md agent list (Sections 1 & 3) against actual `.qoder/agents/*.md` files:
- Count must match: 8 agents
- Names must match exactly (case-sensitive)
- Layer assignments must match (Meta/Execution/Validation)

If any misalignment found, report specific discrepancies and halt until resolved.

## Multi-Agent Execution Flow

Once validation passes, follow the standard flow from AGENTS.md Section 6:

### 8-Role → Qoder Subagent Type Map

| Framework Role | Qoder subagent_type | Dispatch Pattern |
|---------------|--------------------|-----------------|
| @Meta-Planner | Research | `Agent(subagent_type: Research, ...)` |
| @Orchestrator | Leader (Qoder itself) | Leader orchestrates directly |
| @Architect | Research/Coding | `Agent(subagent_type: Research, ...)` or `Agent(subagent_type: Coding, ...)` |
| @Coder-BE | Coding | `Agent(subagent_type: Coding, ...)` |
| @Coder-FE | Coding | `Agent(subagent_type: Coding, ...)` |
| @Guardian | Verify | `Agent(subagent_type: Verify, ...)` |
| @Arbiter | Research | `Agent(subagent_type: Research, ...)` |
| @CI-CD-Agent | Coding | `Agent(subagent_type: Coding, ...)` |

### Standard Execution Flow

```
0. [Entry Gate] Receive new work item → Check Task.DAG.json
   - No DAG → dispatch @Meta-Planner via Agent(subagent_type: Research, ...)
   - DAG exists with matching pending entry → Execute per DAG
1. @Meta-Planner reads requirements → Generates Project.graph + Task.DAG.json
2. @Orchestrator schedules → @Architect outputs contract.yaml (sole TDD basis)
3. [TDD-RED] @Coder-FE/@Coder-BE based on contract + requirements → Write failing test cases → Execute (must fail)
4. [TDD-GREEN] @Coder-FE/@Coder-BE based on tests → Write minimal code → All tests pass
5. [TDD-REFACTOR] @Coder-FE/@Coder-BE refactor → Regression tests (keep all passing)
6. @Guardian reviews (standards/security/architecture) → Conflicts resolved by @Arbiter
7. Code merge → @CI-CD-Agent deploys/self-heals → Results reported back to @Orchestrator
```

### TDD Enforcement (Absolute)

- No test cases = no business code
- RED: tests must fail first before development
- GREEN: write minimal code to pass tests only
- REFACTOR: only after all tests pass
- Gate: tests not 100% passing = no code review

### Collaboration Protocols

1. **Permission Isolation**: Each agent only calls its bound skills, no cross-authority
2. **DAG Scheduling**: @Orchestrator parses Task.DAG.json, schedules by dependency order via `Agent(subagent_type, ...)`
3. **Contract-Driven**: @Architect's contract.yaml is read-only, sole basis for dev/test/review
4. **Quality Gate**: All code must pass @Coder-FE/@Coder-BE tests + @Guardian review, no merge without pass
5. **Closed Loop**: @CI-CD-Agent reports back to @Orchestrator via `SendMessage`, @Arbiter reports to @Meta-Planner
6. **Context Governance**: Compress context after each phase, no pollution
7. **Dead-Loop Circuit Breaker**: 3 consecutive failures → @Arbiter intervenes
8. **Task Board Integration**: All agents update `TaskUpdate(taskId, status)` on state transitions
9. **Memory Persistence**: Agents call `update_memory` when discovering reusable patterns

## Compliance Requirements

All agents must strictly follow:
- `.qoder/rules/common-project.md`
- `.qoder/rules/mcp-compliance-guide.md`
- `.qoder/rules/skill-compliance-guide.md`
- All requirement documents in `.qoder/context/requirements/`

## Quick Reference: Agent Layer Map

```
Meta Layer
  ├── @Meta-Planner   → Project.graph, Task.DAG.json
  └── @Orchestrator   → Task scheduling ONLY (NO requirement analysis)

Execution Layer
  ├── @Architect      → contract.yaml, architecture docs
  ├── @Coder-FE       → Frontend code (pages, components)
  └── @Coder-BE       → Backend code (API, business logic, DB)

Validation Layer
  ├── @Guardian       → Code review, security scan, architecture check, test evidence validation
  ├── @Arbiter        → Conflict resolution, tech debt waiver
  └── @CI-CD-Agent    → CI/CD, deployment, incident response
```
