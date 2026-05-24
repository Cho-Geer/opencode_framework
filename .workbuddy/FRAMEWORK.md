# FRAMEWORK.md — WorkBuddy Development Framework Governance

This document defines the multi-agent development framework adapted for the WorkBuddy platform. It replaces the original `AGENTS.md` with a universal, config-driven approach.

---

## Architecture: 3 Layers, 5 Agents + 2 Native

| Layer | Agent | WorkBuddy Type | Responsibility |
|-------|-------|----------------|-----------------|
| Meta-Cognitive | *(WorkBuddy Plan mode)* | Native | DAG planning, task breakdown |
| Meta-Cognitive | *(WorkBuddy Task Management)* | Native | Task coordination, progress tracking |
| Execution | `architect` | general-purpose | Contract creation, API design, tech specs |
| Execution | `coder` | general-purpose | Implementation following TDD + contracts (all layers) |
| Validation | `guardian` | general-purpose | Quality gates, verification suite execution |
| Validation | `arbiter` | general-purpose | Conflict resolution, waiver approval |
| Validation | `devops` | general-purpose | CI/CD, deployment, infrastructure |

---

## Enforcement Architecture

The framework uses a **three-layer enforcement model** combining WorkBuddy native hooks, conditional rules, and skills:

### Layer 1: Hooks (Hard Enforcement — BLOCKING)

Hooks are configured in `.codebuddy/settings.json` and provide **deterministic, platform-enforced** blocking. They cannot be bypassed by the AI agent.

| Hook | Trigger | Enforcement | Effect |
|------|---------|-------------|--------|
| **PreToolUse** (Write/Edit) | Before file write | TDD check + Scope check + Gate check | **Blocks** the Write/Edit operation if rules are violated |
| **PostToolUse** (Write/Edit) | After file write | Write audit logging | Automatically logs all file writes to `invocation-log.md` |
| **Stop** | Before session ends | Gate completion check | **Blocks** session end if compliance gate is incomplete |

### Layer 2: Conditional Rules (Automatic Context Injection)

Rules are configured in `.codebuddy/rules/` and provide **automatic layer detection** without AI judgment.

| Rule | Paths | Trigger |
|------|-------|---------|
| `framework-core.md` | *(alwaysApply)* | Always injected — P0/P1/P2 rules |
| `frontend-enforcement.md` | `src/frontend/**/*.{ts,tsx,html,css,...}` | Auto-injected when editing frontend files |
| `backend-enforcement.md` | `src/backend/**/*.{ts,js,py,go,...}` | Auto-injected when editing backend files |
| `database-enforcement.md` | `prisma/**/*, migrations/**/*, sql/**/*` | Auto-injected when editing database files |

### Layer 3: Skills (Workflow Guidance — Advisory)

Skills provide step-by-step workflows and can be invoked manually or by agents. They complement hooks but do not replace them.

| Skill | Priority | Primary Enforcement Via |
|-------|----------|------------------------|
| `compliance-gate` | P0 | Stop hook blocks completion |
| `tdd-enforcer` | P0 | PreToolUse hook blocks non-TDD writes |
| `code-quality-gate` | P1 | PreToolUse hook (blocks when prior quality failures in framework-state.md) |
| `contract-driven-dev` | P1 | PostToolUse hook (auto-recomputes contract hashes on edit) |
| `verification-suite` | P2 | Conditional rules inject requirements |
| `ci-cd-guardrails` | P2 | Skill invocation (advisory) |
| `framework-self-test` | P2 | Skill invocation (diagnostic) |
| `circuit-breaker` | P2 | Failure tracking + escalation guidance |
| `dag-quality` | P2 | DAG structural validation (4 constraints) |
| `context7-first` | P3 | Skill invocation (advisory) |

---

## P0 Mandatory Rules (BLOCKING — Enforced by Hooks)

These rules are enforced by **PreToolUse hooks** and the `compliance-gate` Skill. Violation BLOCKS the operation at the platform level.

1. **Compliance Gate**: Every task must pass check → confirm → complete lifecycle. The **Stop hook** prevents session end if gate is incomplete.
2. **Plan Mode Entry**: All work starts with WorkBuddy Plan mode generating a task DAG.
3. **Dispatch Protocol**: Sub-agents dispatched only via WorkBuddy Agent tool or TeamCreate.
4. **TDD Iron Law**: RED (write failing test) → GREEN (make it pass) → REFACTOR (clean up). The **PreToolUse hook** on Write/Edit blocks source code writes without corresponding tests.

## P1 Strong Rules (WARN + LOG — Enforced by Hooks + Skills)

5. **Code Quality Gate**: Lint, typecheck, dependency audit before task completion.
6. **Contract-Driven Development**: contract.yaml must be validated before code generation.
7. **Write Audit**: All file writes are automatically logged to `.workbuddy/memory/invocation-log.md` via **PostToolUse hook**.
8. **No Orphan Code**: No implementation without corresponding test.

## P2 Advisory Rules (INFO — Enforced by Skills)

9. **Performance Thresholds**: Configured in `project.yaml → quality.performance.*`.
10. **Bundle Budget**: Configured in `project.yaml → verification.classes.threshold`.
11. **Commit Convention**: Conventional Commits format enforced via CI.

---

## Mandatory Verification Suite

Every business code modification triggers the **verification-suite** Skill across all affected layers. Layer detection is **automatic** via conditional rules in `.codebuddy/rules/`.

| Class | Frontend | Backend | Database |
|-------|----------|---------|----------|
| **structure** | Layout/component diff | API route validation | Schema structure validation |
| **design** | UI design compliance | API design compliance | DB design compliance |
| **io** | User input/output | Request/response contracts | CRUD operations |
| **error** | UI error states | API error propagation | Constraint violations |
| **threshold** | Performance metrics | API latency | Query performance |

**Blocking**: All applicable classes must pass. Layer applicability is **automatically determined** by conditional rules matching file paths, supplemented by `project.yaml → layers.{layer}.source_paths`.

---

## Agent Tool Scoping (Enforced by Platform)

Agent write permissions are enforced at the platform level using native `tools` and `disallowedTools` frontmatter:

| Agent | `tools` | `disallowedTools` | Effective Scope |
|-------|---------|-------------------|-----------------|
| architect | Full toolset | — | Can read + write source code |
| coder | Full toolset | — | Can read + write source code |
| guardian | Full toolset minus Write/Edit | **Write, Edit** | Read-only on source code (can write to memory/ via Bash) |
| arbiter | Full toolset minus Write/Edit | **Write, Edit** | Read-only on source code (can write to memory/ via Bash) |
| devops | Full toolset | — | Can read + write source code |

This replaces the previous `write_scopes` custom YAML field, which was documentation-only and not enforced by the platform.

---

## Execution Flow (10 Steps)

1. **Plan**: Use WorkBuddy Plan mode to analyze request, design approach, create task DAG
2. **DAG Quality**: Run `/dag-quality validate` to verify DAG meets completeness, granularity, traceability, and coverage constraints
3. **Gate Check**: Invoke `compliance-gate check` — validate entry conditions (PreToolUse hook also validates)
4. **Contract**: `architect` defines/validates contract for the task scope
5. **TDD Red**: `coder` writes failing test per `tdd-enforcer` Skill (PreToolUse hook enforces test-first)
6. **TDD Green**: `coder` implements minimal code to pass the test
7. **TDD Refactor**: `coder` cleans up while keeping tests green
8. **Quality Gate**: `guardian` runs `code-quality-gate` (lint, types, deps)
9. **Verification Suite**: `guardian` runs `verification-suite` for all affected layers (conditional rules auto-inject)
10. **Gate Confirm**: Invoke `compliance-gate confirm` — verify all rules satisfied
11. **Gate Complete**: Invoke `compliance-gate complete` — record result, close session (Stop hook validates completion)
12. **On Failure**: Run `/circuit-breaker record <task_id> <reason>` — tracks failure count and escalates per retry protocol

---

## Configuration

All project-specific parameters are in `.workbuddy/project.yaml`. This file is the **single source of truth** for:

- Tech stack (frameworks, languages, tools)
- Source/test paths per layer
- Quality thresholds
- Verification methods and tools
- Agent skill bindings
- Enforcement mode

Templates for common project types are available in `.workbuddy/templates/`.

---

## State Management

Framework state is tracked in `.workbuddy/memory/` (Markdown, not JSON):

| File | Purpose | Replaces |
|------|---------|----------|
| `framework-state.md` | Quality dimensions, contract hashes | `machine.json` |
| `gate-sessions.md` | Compliance gate session records | `gate-state.json` |
| `tech-debt-registry.md` | Tech debt tracking | `TECH_DEBT_REGISTRY.md` |
| `invocation-log.md` | Audit trail (auto-populated by PostToolUse hook) | `write_audit_state` |

---

## Auto-Discovery

- **`CODEBUDDY.md`**: Auto-loaded at session start. Provides framework overview, quick commands, and key file locations.
- **`.codebuddy/rules/framework-core.md`**: Always-applied rule with P0/P1/P2 definitions.
- **`.codebuddy/rules/{layer}-enforcement.md`**: Auto-triggered when editing files in that layer's source paths.

---

## What This Framework Does NOT Do

The following are handled by WorkBuddy natively and are NOT reimplemented:

- **Planning**: WorkBuddy Plan mode (not a separate Meta-Planner agent)
- **Task management**: TaskCreate/TaskGet/TaskUpdate/TaskList (not custom DAG scripts)
- **Agent dispatch**: WorkBuddy Agent tool / TeamCreate (not dispatch-subagent.js)
- **Memory**: `.workbuddy/memory/` system (not custom state files)
- **Git operations**: GitHub Connector (not custom git hooks)
- **Content safety**: WorkBuddy built-in content policy (not custom enforcement)
- **Tool scoping**: Native `tools`/`disallowedTools` frontmatter (not custom write_scopes)
- **Layer detection**: Conditional rules with `paths` frontmatter (not manual path matching)
