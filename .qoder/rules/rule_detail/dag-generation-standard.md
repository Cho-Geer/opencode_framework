---
type: model_decision
description: When generating or updating DAGs
---

# DAG Generation Standard v1.1

**Created**: 2026-04-16
**Last Updated**: 2026-05-18
**Version**: v1.1.0 (Parameterization refactor — hardcoded module lists replaced with dynamic placeholders)
**Applicable Scope**: All tasks involving Task.DAG.json generation, updates, and review

---

## 1. Applicable Scope

All tasks involving `Task.DAG.json` generation, updates, and review must comply with this standard.

## 2. Mandatory Triggering Agents

| Agent | Trigger Scenario |
|-------|---------|
| **@Meta-Planner** | DAG generation, version upgrades, task additions |
| **@Guardian** | DAG coverage and completeness review |
| **@Orchestrator** | DAG execution monitoring, status sync verification |

---

## 3. Completeness Rules

### C1 - Full Requirements Coverage

DAG tasks must cover every verifiable clause from all 6 requirement documents:

| # | Requirement Document | File Path |
|------|---------|---------|
| 1 | system-architecture-design (SAD) | `.qoder/context/requirements/system-architecture-design.md` |
| 2 | api-design-specification | `.qoder/context/requirements/api-design-specification.md` |
| 3 | data-architecture | `.qoder/context/requirements/data-architecture.md` |
| 4 | security-architecture | `.qoder/context/requirements/security-architecture.md` |
| 5 | testing-strategy | `.qoder/context/requirements/testing-strategy.md` |
| 6 | operations-deployment | `.qoder/context/requirements/operations-deployment.md` |

**Violation Consequence**: Requirements omission; project cannot reach 100% completion.  
**Verification Method**: Guardian reviews by cross-checking requirement clauses against DAG task mappings.

### C2 - Contract Clause Mapping

Every endpoint, data model, and security rule in `contract.yaml` must have a corresponding DAG task.

Mapping requirements:
- Each API endpoint maps to at least 1 implementation task + 1 test task
- Each data model change maps to at least 1 migration task
- Each security rule maps to at least 1 security implementation task

### C3 - Module-Level Decomposition

Each backend module must generate at least **3 tasks**:

| Task Type | Content | Example |
|---------|------|------|
| Implementation task | controller + service + dto + module | `time-slots.controller.ts`, `time-slots.service.ts` |
| Test task | spec files (unit + integration) | `time-slots.service.spec.ts` |
| Integration task | wiring/connection with other modules | Register in `app.module.ts` |

**Applicable Modules**: All backend modules in the project, counted as `{BACKEND_MODULES_COUNT}` (derived by scanning `{PROJECT_ROOT}/backend_src/modules/` directory).
> Example (current project values): auth, users, services, time-slots, appointments, notifications, cache, rate-limiter, stats, health, email — 11 modules total

### C4 - Frontend Atomic Decomposition

Each frontend component family must generate at least **2 tasks**:

| Task Type | Content | Example |
|---------|------|------|
| Component implementation | ts + html + scss + spec | `login.component.ts`, `login.component.html` |
| Store wiring | NgRx Signals connection | `auth.store.ts` connected to component |

**Applicable Component Families**: All frontend component families in the project, counted as `{FRONTEND_COMPONENT_FAMILIES_COUNT}` (derived by analyzing frontend `features/` or page directory structure).
> Example (current project values): auth, booking, admin, shared — 4 component families total

### C5 - Independent Security Enhancements

Each security enhancement item must be an **independent task** and cannot be merged into other tasks.

The security items list consists of `{SECURITY_ITEMS_COUNT}` items, extracted from security-architecture (`.qoder/context/requirements/security-architecture.md`). Each item corresponds to an independent task, with priority following the definitions in security-architecture.

> Example (current project values, 4 items total): CSRF protection (P1), Rate limiting with Redis (P1), Token blacklisting (P1), Vault integration placeholder (P2)

### C6 - Independent DevOps

The following items must each be **independent tasks**.

The DevOps items list consists of `{DEVOPS_ITEMS_COUNT}` items, extracted from operations-deployment (`.qoder/context/requirements/operations-deployment.md`). Each item corresponds to an independent task, with priority following the definitions in operations-deployment.

> Example (current project values, 4 items total): Docker Compose configuration (P1), CI/CD Pipeline (GitHub Actions) (P1), Deployment configuration and environment variables (P2), Monitoring and health checks (P2)

---

## 4. Granularity Rules

### G1 - Single Task Workload Cap

A single task's `target_files` count must **not exceed 5**.

Determination formula: `task.target_files.length <= 5`

### G2 - Minimum Task Count Formula

Total task count must satisfy:

```
Total tasks >= Backend modules x 3 + Frontend component families x 2 + Security items + DevOps items
```

Placeholder definitions (resolved from the actual project structure during DAG generation):
- `{BACKEND_MODULES_COUNT}`: Total backend module count (scan `{PROJECT_ROOT}/backend_src/modules/`)
- `{FRONTEND_COMPONENT_FAMILIES_COUNT}`: Total frontend component family count (analyze frontend feature module directories)
- `{SECURITY_ITEMS_COUNT}`: Total security enhancement items (extracted from security-architecture)
- `{DEVOPS_ITEMS_COUNT}`: Total independent DevOps items (extracted from operations-deployment)

**Minimum tasks >= {BACKEND_MODULES_COUNT}x3 + {FRONTEND_COMPONENT_FAMILIES_COUNT}x2 + {SECURITY_ITEMS_COUNT} + {DEVOPS_ITEMS_COUNT}**

> Example (current project values): 11x3 + 4x2 + 4 + 4 = 49

### G3 - Independent Tests

Each business module must have an **independent test task** that cannot be merged into implementation tasks.

TDD iron rule requirements:
- Test tasks must precede implementation tasks (dependency relationship)
- Test tasks must be explicitly marked as the `TDD-RED` phase
- Implementation tasks must be marked as the `TDD-GREEN` phase

### G4 - Definition of Done

Each task must include clear completion criteria in the following format:

```json
{
  "definition_of_done": {
    "files_exist": ["expected file path 1", "expected file path 2"],
    "logic_complete": "business logic description",
    "tests_pass": "test case count and coverage requirements",
    "guardian_approved": true
  }
}
```

---

## 5. Traceability Rules

### T1 - Requirement Source Field

Each task must have a `requirement_source` field in the format:

```json
{
  "requirement_source": {
    "document": "requirement document name",
    "section": "specific section",
    "clause": "clause number or description"
  }
}
```

### T2 - Contract Reference Field

Each API/data task must reference the specific path in `contract.yaml`:

```json
{
  "contract_reference": {
    "path": "YAML path in contract.yaml",
    "type": "endpoint | data_model | security_rule | high_concurrency"
  }
}
```

### T3 - File Mapping Field

Each task must have a `target_files` field listing expected output file paths:

```json
{
  "target_files": [
    "booking-backend/src/modules/xxx/xxx.controller.ts",
    "booking-backend/src/modules/xxx/xxx.service.ts"
  ]
}
```

### T4 - Dependency Authenticity

Task dependencies must be based on **actual code import relationships**, not design assumptions.

Verification method: Guardian reviews by checking whether files from dependency tasks are imported by target tasks.

---

## 6. Dynamic Update Rules

### D1 - Status Synchronization

Task status changes must be consistent with actual file states.

Sync rules:
- File created and logic complete → Task status may change from `pending` to `in_progress`
- File logic complete and tests pass → Task status may change from `in_progress` to `completed`
- Guardian review passes → Task status confirmed as `completed`

### D2 - Gap Appendix

When Guardian review identifies uncovered requirements, new tasks are automatically generated and appended to the DAG.

Appendix process:
1. Guardian identifies uncovered requirement clauses
2. Generates new tasks including `requirement_source`, `target_files`, `definition_of_done`
3. Updates DAG version number
4. Notifies @Orchestrator to schedule new tasks

### D3 - Version Management

Each DAG update must:
- Increment the `meta.version` field (semantic versioning)
- Record the change reason in `meta.description`
- Add a changelog entry in `meta.changelog`
- Retain historical version files (`Task.DAG.v{version}.json`)

### D4 - Coverage Gate

When DAG coverage is < 100%, **entry into the execution phase is prohibited**.

Coverage calculation formula:

```
Coverage = (Number of requirement clauses covered by tasks / Total requirement clauses) x 100%
```

Total requirement clauses = Number of independently verifiable clauses extracted from 6 requirement documents  
Requirement clauses covered by tasks = Number of clauses referenced by at least one task

---

## 7. DAG JSON Schema Requirements

`Task.DAG.json` must include the following required fields:

```json
{
  "meta": {
    "version": "string (semantic versioning)",
    "project": "string",
    "generatedBy": "string",
    "generatedAt": "ISO 8601 datetime",
    "description": "string",
    "changelog": [
      {
        "version": "string",
        "date": "ISO 8601 datetime",
        "changes": ["string"]
      }
    ]
  },
  "tasks": [
    {
      "id": "string (e.g., T001)",
      "name": "string",
      "description": "string",
      "agent": "string (@AgentName)",
      "dependencies": ["string (task IDs)"],
      "outputs": ["string"],
      "priority": "P0 | P1 | P2",
      "status": "pending | in_progress | completed",
      "requirement_source": {
        "document": "string",
        "section": "string",
        "clause": "string"
      },
      "target_files": ["string"],
      "definition_of_done": {
        "files_exist": ["string"],
        "logic_complete": "string",
        "tests_pass": "string",
        "guardian_approved": "boolean"
      }
    }
  ]
}
```

---

## 8. Violation Handling

| Violation Type | Rule Violated | Resolution |
|---------|---------|---------|
| Requirements omission | C1, C2 | DAG generation fails; must regenerate |
| Insufficient granularity | C3, C4, G1, G2, G3 | @Guardian review fails; returned for re-decomposition |
| Vague definition | G4 | Task marked as "non-executable"; deadline to supplement DoD |
| Untraceable | T1, T2, T3, T4 | Task marked as "untraceable"; deadline to correct |
| Status out of sync | D1 | @Orchestrator suspends execution until fixed |
| Gap not appended | D2 | Guardian auto-generates supplementary tasks |
| Version chaos | D3 | Rollback to previous valid version |
| Insufficient coverage | D4 | Entry into execution phase prohibited |

---

## 9. Reference Relationships with Other Standards

| Standard Document | Reference Relationship |
|---------|---------|
| `common-project.md` | This standard is referenced by it with equal enforcement authority |
| `meta-planner.md` | @Meta-Planner must follow this standard to generate DAGs |
| `AGENTS.md` | References this standard in the multi-agent system |
| `test-coding-standard.md` | G3 independent tests synergize with its TDD iron rule |
| `backend-coding-standard.md` | C3 module-level decomposition synergizes with its modularization standard |
| `frontend-coding-standard.md` | C4 frontend atomic decomposition synergizes with its atomic design standard |

---

*This document will be continuously updated as the project evolves.*
# tamper-for-test
