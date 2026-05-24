---
alwaysApply: true
---

# WorkBuddy Development Framework — Core Rules

These rules are ALWAYS applied in every session. They define the core governance of the WorkBuddy Development Framework.

## Framework Overview

This project uses the WorkBuddy Development Framework — a universal, config-driven multi-agent development governance system. All project-specific parameters are in `.workbuddy/project.yaml`.

## P0 Mandatory Rules (BLOCKING)

These rules are enforced by **PreToolUse hooks** and the `compliance-gate` Skill. Violation BLOCKS the operation.

1. **Compliance Gate**: Every task must pass check → confirm → complete lifecycle. The Stop hook prevents session end if gate is incomplete.
2. **Plan Mode Entry**: All work starts with WorkBuddy Plan mode generating a task DAG.
3. **Dispatch Protocol**: Sub-agents dispatched only via WorkBuddy Agent tool or TeamCreate.
4. **TDD Iron Law**: RED (write failing test) → GREEN (make it pass) → REFACTOR (clean up). The PreToolUse hook on Write/Edit blocks source code writes without corresponding tests.

## P1 Strong Rules (WARN + LOG)

Enforced by `code-quality-gate` Skill and **PostToolUse hooks**.

5. **Code Quality Gate**: Lint, typecheck, dependency audit before task completion.
6. **Contract-Driven Development**: contract.yaml must be validated before code generation.
7. **Write Audit**: All file writes are automatically logged to `.workbuddy/memory/invocation-log.md` via PostToolUse hook.
8. **No Orphan Code**: No implementation without corresponding test.

## P2 Advisory Rules (INFO)

9. **Performance Thresholds**: Configured in `project.yaml → quality.performance.*`.
10. **Bundle Budget**: Configured in `project.yaml → verification.classes.threshold`.
11. **Commit Convention**: Conventional Commits format enforced via CI.

## Agent Roles

| Agent | Responsibility | Write Scope |
|-------|---------------|-------------|
| architect | Contract creation, API design | Source code (per project.yaml) |
| coder | Implementation (TDD + contracts) | Source code (per project.yaml) |
| guardian | Quality gates, verification | `.workbuddy/memory/` ONLY (read-only on source code) |
| arbiter | Conflict resolution, waivers | `.workbuddy/memory/` ONLY |
| devops | CI/CD, deployment | Config files, scripts |

## Configuration Source

All parameters are in `.workbuddy/project.yaml`. Framework files contain ZERO hardcoded technology references. Read from config at runtime.

## Hooks Enforcement

The framework uses three hooks for automated enforcement:

| Hook | Trigger | Enforcement |
|------|---------|-------------|
| PreToolUse (Write/Edit) | Before file write | TDD check, scope check, gate check |
| PostToolUse (Write/Edit) | After file write | Automatic write audit logging |
| Stop | Before session ends | Compliance gate completion check |

## Verification Matrix

Every business code modification triggers verification across all affected layers. Layer detection is automatic via conditional rules in `.codebuddy/rules/`.

| Class | Frontend | Backend | Database |
|-------|----------|---------|----------|
| structure | Layout/component diff | API route validation | Schema structure validation |
| design | UI design compliance | API design compliance | DB design compliance |
| io | User input/output | Request/response contracts | CRUD operations |
| error | UI error states | API error propagation | Constraint violations |
| threshold | Performance metrics | API latency | Query performance |

## Quick Commands

```text
/compliance-gate check     — Run entry gate check
/compliance-gate confirm   — Run pre-completion verification
/compliance-gate complete  — Finalize gate and record result
/tdd start <feature>       — Begin RED phase
/tdd implement <feature>   — Begin GREEN phase
/tdd refactor <feature>    — Begin REFACTOR phase
/verify all --layer <layer> — Run all 5 verification classes
/quality full              — Run all quality checks
/contract validate         — Validate all contract files
```
