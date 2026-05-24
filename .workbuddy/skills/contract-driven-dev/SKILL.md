---
name: contract-driven-dev
description: P1 contract-driven development enforcement. Contract file paths and hash algorithms are read from project.yaml. Supports ANY contract format (OpenAPI, GraphQL, Protobuf, etc.). No hardcoded file paths.
agent_created: true
level: user
---

# contract-driven-dev

## Purpose

Enforce contract-first development: **no code generation before contract validation**. Contract format is NOT assumed — it can be OpenAPI YAML, GraphQL Schema, Protobuf, gRPC, or any other specification format.

## Configuration

Read from `.workbuddy/project.yaml`:

- `contracts.files` — list of contract file paths
- `contracts.hash_algorithm` — hash algorithm for integrity tracking (default: sha256)
- `layers.{layer}.api_docs_format` — documentation format per layer

## Workflow

### Step 1: Contract Validation (Pre-Code)

Before any code generation:

1. Read contract file paths from `project.yaml → contracts.files`
2. If no contracts configured: SKIP (not fail)
3. Validate each contract file exists and is parseable
4. Compute hash of each contract file using configured algorithm
5. Compare against stored hash in `framework-state.md → Contract Hashes`
6. If hash mismatch: flag as contract change, require architect review

### Step 2: Contract-to-Code Mapping

For each contract:

1. Extract interface specifications for the task scope
2. Verify corresponding test file exists (via `tdd-enforcer`)
3. Verify implementation aligns with contract spec
4. Flag any unauthorized deviations from contract

### Step 3: Contract Change Management

When contract changes:

1. Update hash in `framework-state.md → Contract Hashes`
2. Flag all dependent modules for review
3. Require `architect` approval before proceeding
4. Block implementation until contract is locked

## Integration

Used by:
- `architect` agent — contract authoring and validation
- `coder` agent — must pass contract validation before writing code
- `guardian` agent — gate confirm checks contract integrity
- `compliance-gate` — P0 rule: contract must be valid

## Usage

```text
/contract validate    — Validate all contract files and compute hashes
/contract lock        — Lock current contract version (sets hash in framework-state.md)
/contract diff        — Show differences from last locked contract
/contract status      — Show contract integrity status
```
