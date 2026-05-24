---
type: model_decision
description: When working with state machine transitions
---

# State Machine Standard v1.0

**Created**: 2026-04-20  
**Version**: v1.0.0  
**Applicable Scope**: All projects using multi-agent collaboration

---

## 1. Overview

The state machine is the core mechanism for enforcing physical constraints in multi-agent systems. It ensures:

1. **Contract change traceability**: Any modification to interface contracts or data models must synchronously update hash fingerprints.
2. **Legal task state transitions**: Every state change in a task's lifecycle must follow predefined paths and be accompanied by required evidence files.

## 2. Core Principles

### 2.1 Single Source of Truth

`.qoder/state/machine.json` is the **sole configuration source** for the state machine. All validation rules are defined in this file; Git Hook reads this file directly for validation.

### 2.2 Physical Enforcement

State machine rules are enforced through **Git Pre-commit Hook**. Any commit that violates the rules will be rejected; Agents cannot bypass this through "declarations" or "self-reporting."

### 2.3 Evidence-Driven

Every state transition of a task must be accompanied by **verifiable evidence files** (e.g., test reports, review reports). Evidence file contents must conform to the Schema or content patterns defined in `machine.json`.

## 3. State Machine File Locations

| File            | Path                                          | Purpose                                                                                                                                                                                                                                                                                                            |
| :-------------- | :-------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project Config**    | `{project_root}/.qoder/state/machine.json` | Defines contract hashes, task lifecycle transition rules, and evidence requirements. `project_root` is defined by `project.config.json` (e.g., `booking_system_refactor`); falls back to `.qoder/state/machine.json` if not defined.                                                                                   |
| **Schema Validation** | `.qoder/state/machine.schema.json`         | Validates `machine.json` format correctness. This Schema is loaded during code-quality-gate.js bootstrap, ensuring all 9 sub-state segments (meta, eslint_state, type_check_state, dependency_state, format_state, write_audit_state, compliance_records, tdd_enforcement_state, contracts, keystone_hashes) have correct field types and required fields. |
| **Executor**      | `.qoder/hooks/pre-commit`                  | Git Hook that reads `machine.json` and executes validation                                                                                                                                                                                                                                                        |

### 3.1 Schema Validation Mechanism

`machine.schema.json` is based on JSON Schema Draft 2020-12 and validates at the following points:

1. **Bootstrap phase**: The `getMachine()` function in `code-quality-gate.js` automatically loads the schema for format validation when reading `machine.json`; validation failure outputs a warning but does not block startup (backward compatible).
2. **Write-Time Audit**: After each `run_write_check` execution, the `machine.json` written by `updateStates()` must conform to the schema definition; otherwise subsequent bootstrap validation will alert.
3. **Pre-Commit Hook**: Git Hook may optionally perform schema validation before checking `machine.json` hash synchronization to ensure file structure integrity.

The schema must cover all 9 sub-state segments with correct types; any missing or type-incorrect segment indicates a corrupted state machine configuration.

## 4. Generic Configuration Structure

`machine.json` must include the following core sections:

| Field                        | Required | Description                                                          |
| :-------------------------- | :--- | :------------------------------------------------------------ |
| `meta`                      | ✅   | Metadata (version, project name, last update time)                          |
| `contracts`                 | ✅   | Contract files and their SHA-256 hash values                                   |
| `taskLifecycle`             | ✅   | Task lifecycle definition, including state list and transition rules                      |
| `taskLifecycle.transitions` | ✅   | Transition rules array; each rule defines `from`, `to`, and `requiredEvidence` |

For specific field meanings and examples, refer to the project's `.qoder/state/machine.json`.

## 5. Collaboration with Git Hook

The Git Pre-commit Hook executes the following validation logic:

1. **Contract hash validation**: When files defined in `contracts` are modified, verifies that hash values in `machine.json` are synchronously updated and match actual file hashes.
2. **Task lifecycle validation**: When task status files (e.g., `Task.DAG.json`) are modified, verifies that state transition paths are legal and that required evidence files exist with conforming content.

Any validation failure results in commit rejection.

## 6. Extensibility

- **Adding new contract types**: Simply add new entries to `contracts`.
- **Adding new task states or transition rules**: Append rules to `taskLifecycle.transitions`.
- **Enhancing evidence validation**: Add `schema`, `contentMustContain`, and other fields to `requiredEvidence`.

All extensions only require modifying `machine.json`; no changes to Hook scripts are needed (Hook scripts are generically implemented).

## 7. Related Documents

| Document                           | Relationship                   |
| :----------------------------- | :--------------------- |
| `common-project.md`            | References this standard as a core principle |
| `.qoder/state/machine.json` | Project-specific configuration instance       |
| `.qoder/hooks/pre-commit`   | Physical executor             |

---

_This document will be continuously updated as the state machine evolves._
