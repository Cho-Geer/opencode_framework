# WorkBuddy Development Framework

> This project uses the **WorkBuddy Development Framework** — a universal, config-driven multi-agent development governance system adapted for the WorkBuddy platform.

## Quick Start

1. **Configure your project**: Copy a template from `.workbuddy/templates/` to `.workbuddy/project.yaml` and fill in your project details
2. **Start work with Plan mode**: All work begins in WorkBuddy Plan mode — generate a task DAG
3. **Follow the gate lifecycle**: Every task must pass check → confirm → complete (enforced by hooks)
4. **Follow TDD**: RED → GREEN → REFACTOR (enforced by PreToolUse hook on Write/Edit)

## Configuration

All project-specific parameters are in **`.workbuddy/project.yaml`** — the single source of truth for:
- Tech stack (frameworks, languages, tools)
- Source/test paths per layer
- Quality thresholds
- Verification methods and tools
- Agent skill bindings
- Enforcement mode

## Enforcement

The framework uses **three hooks** for automated enforcement (configured in `.codebuddy/settings.json`):

| Hook | Trigger | What It Enforces |
|------|---------|-------------------|
| PreToolUse (Write/Edit) | Before file write | TDD check, guardian scope, gate check |
| PostToolUse (Write/Edit) | After file write | Automatic write audit logging |
| Stop | Before session ends | Compliance gate completion check |

**Conditional rules** in `.codebuddy/rules/` automatically inject layer-specific verification requirements based on which files are being edited.

## Agent Roles

| Agent | Role | Write Scope |
|-------|------|-------------|
| `architect` | Contract creation, API design | Full source code access |
| `coder` | Implementation (TDD + contracts) | Full source code access |
| `guardian` | Quality gates, verification | Read-only on source code (enforced by `disallowedTools`) |
| `arbiter` | Conflict resolution, waivers | Read-only on source code (enforced by `disallowedTools`) |
| `devops` | CI/CD, deployment | Full source code access |

## Skills

| Skill | Priority | Purpose |
|-------|----------|---------|
| `compliance-gate` | P0 | Gate lifecycle (check/confirm/complete) |
| `tdd-enforcer` | P0 | TDD discipline (RED→GREEN→REFACTOR) |
| `code-quality-gate` | P1 | Lint, types, deps, format |
| `contract-driven-dev` | P1 | Contract validation and integrity |
| `verification-suite` | P2 | 5-class × 3-layer verification matrix |
| `ci-cd-guardrails` | P2 | CI/CD best practices |
| `context7-first` | P3 | Tech documentation lookup |

## Verification Matrix

Every business code modification triggers verification across affected layers:

| Class | Frontend | Backend | Database |
|-------|----------|---------|----------|
| structure | Layout/component diff | API route validation | Schema structure |
| design | UI design compliance | API design compliance | DB design compliance |
| io | User input/output | Request/response contracts | CRUD operations |
| error | UI error states | API error propagation | Constraint violations |
| threshold | Performance metrics | API latency | Query performance |

## Key Files

```
.workbuddy/
├── project.yaml              # Single source of truth (config)
├── FRAMEWORK.md              # Governance document
├── agents/                   # 5 agent specifications
├── skills/                   # 7 skill definitions
├── templates/                # 4 project-type templates
├── memory/                   # State, sessions, audit trail
└── plans/                    # Migration and assessment reports

.codebuddy/
├── settings.json             # Hooks configuration
└── rules/                    # Conditional enforcement rules
    ├── framework-core.md     # Always-applied core rules
    ├── frontend-enforcement.md  # Frontend layer rules
    ├── backend-enforcement.md   # Backend layer rules
    └── database-enforcement.md  # Database layer rules
```
