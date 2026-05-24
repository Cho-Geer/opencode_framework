---
name: verification-suite
description: P2 mandatory 5-class verification across all three layers (frontend, backend, database). Every business code modification MUST pass verification for all affected layers. Methods and tools are read from project.yaml — zero hardcoded technology assumptions.
agent_created: true
level: user
---

# verification-suite

## Purpose

Universal verification framework covering **5 verification classes across 3 layers** (frontend, backend, database). This is a BLOCKING requirement for every business code modification: all applicable classes must pass for each affected layer.

## Configuration

All verification parameters are read from `.workbuddy/project.yaml`:

- `verification.classes` — 5-class verification matrix with per-layer methods, tools, thresholds
- `layers.{layer}.enabled` — whether each layer is active
- `layers.{layer}.source_paths` — what counts as code in each layer (determines which layers are affected)
- `quality.performance.*` — performance threshold values

## Trigger Logic

1. After any business code modification, determine affected layers by matching changed file paths against `project.yaml → layers.{layer}.source_paths`
2. For each affected layer with `enabled: true`, run all 5 verification classes
3. If a layer is `enabled: false`, skip that layer entirely
4. If a verification class has no `tool` configured for a layer, emit WARNING (not failure)

## 5-Class Verification Matrix

### Class 1: Structure

Verifies structural integrity and layout correctness.

| Layer | What It Validates | Example Methods |
|-------|-------------------|-----------------|
| Frontend | Visual layout, component hierarchy, responsive breakpoints | Screenshot diff, component tree comparison |
| Backend | API route structure, endpoint inventory | Route listing diff, OpenAPI schema comparison |
| Database | Schema structure, migration safety | Schema validation, migration dry-run |

**Pass criteria**: Structural changes are intentional (matched against task scope), no unintended regressions.

### Class 2: Design

Verifies design compliance and consistency.

| Layer | What It Validates | Example Methods |
|-------|-------------------|-----------------|
| Frontend | Design token compliance, UI consistency, accessibility | Token extraction, visual regression, axe-core |
| Backend | API design compliance, naming conventions, versioning | OpenAPI lint, Spectral, naming convention checker |
| Database | DB design compliance, normalization, naming conventions | Normalization check, naming convention lint, index review |

**Pass criteria**: Design conforms to project standards, no unauthorized deviations.

### Class 3: I/O

Verifies input/output correctness and boundary conditions.

| Layer | What It Validates | Example Methods |
|-------|-------------------|-----------------|
| Frontend | Form validation, user interactions, boundary values | Interaction testing, form validation, boundary tests |
| Backend | Request/response contracts, serialization, boundary values | Contract testing, boundary value analysis, fuzzing |
| Database | CRUD operations, query results, constraint enforcement | CRUD test matrix, constraint validation, seed data verification |

**Pass criteria**: All inputs validated, outputs match contracts, boundary values handled, constraints enforced.

### Class 4: Error

Verifies error handling and recovery paths.

| Layer | What It Validates | Example Methods |
|-------|-------------------|-----------------|
| Frontend | Error states, user-facing messages, graceful degradation | Error state rendering, message validation, fallback testing |
| Backend | Error codes, error propagation, recovery paths | Error scenario testing, propagation verification, recovery validation |
| Database | Constraint violations, migration failures, data corruption handling | Constraint violation tests, migration rollback, integrity checks |

**Pass criteria**: All error paths produce user-friendly output, error recovery works, no unhandled exceptions.

### Class 5: Threshold

Verifies performance and resource thresholds.

| Layer | What It Validates | Example Methods |
|-------|-------------------|-----------------|
| Frontend | FCP, Lighthouse score, bundle size | Performance profiling, Lighthouse CI, bundle analysis |
| Backend | API latency, memory stability, throughput | Load testing, memory profiling, concurrent request testing |
| Database | Query performance, index coverage, connection pool | EXPLAIN ANALYZE, index coverage scan, pool monitoring |

**Pass criteria**: All performance thresholds from `project.yaml → quality.performance.*` are met.

## Execution Pipeline

```
Business code modification detected
         │
         ▼
  [1] Determine affected layers (match file paths vs source_paths)
         │
         ▼
  [2] For each affected layer:
      │
      ├── [2a] Structure verification
      ├── [2b] Design verification
      ├── [2c] I/O verification
      ├── [2d] Error verification
      └── [2e] Threshold verification
         │
         ▼
  [3] Aggregate results
         │
         ├── All classes pass → verification PASSED
         └── Any class fails → verification FAILED (BLOCKING)
```

## Failure Handling

| Failure Class | Action |
|---------------|--------|
| Structure regression | Flag for review, compare against intended changes |
| Design inconsistency | Fix styles/design, re-verify |
| I/O test failure | Fix component/service, re-run test suite |
| Error path missing | Add error handling, re-verify |
| Threshold exceeded | Optimize code/query/config, re-measure |

## Integration

Used by:
- `coder` agent — auto-triggered on code changes
- `guardian` agent — executes verification suite as part of gate confirm
- `compliance-gate` — P0 rule: verification must pass before gate complete

## Usage

```text
/verify structure  --layer <frontend|backend|database|all>  — Run structure verification
/verify design     --layer <frontend|backend|database|all>  — Run design verification
/verify io         --layer <frontend|backend|database|all>  — Run I/O verification
/verify error      --layer <frontend|backend|database|all>  — Run error verification
/verify threshold  --layer <frontend|backend|database|all>  — Run threshold verification
/verify all        --layer <frontend|backend|database|all>  — Run all 5 classes
/verify report     — Show last verification results
```
