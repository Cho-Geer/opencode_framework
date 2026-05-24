---
name: tdd-enforcer
description: P0 mandatory TDD enforcement. The PreToolUse hook in .codebuddy/settings.json provides hard enforcement (blocks Write/Edit of source code without corresponding test). This Skill provides the TDD workflow and state tracking. Test file patterns are read from project.yaml, not hardcoded.
agent_created: true
level: user
---

# tdd-enforcer

## Purpose

Enforce strict Test-Driven Development discipline: **no implementation code without a failing test first**. Uses WorkBuddy's TaskCreate/TaskUpdate system for state tracking. Works for any language — test patterns are config-driven.

## Enforcement Model

TDD enforcement operates at two levels:

1. **Hard enforcement (PreToolUse hook)**: The `.codebuddy/settings.json` PreToolUse hook on Write/Edit **blocks the write operation** if the target is a source file without a corresponding test. This is platform-enforced and cannot be bypassed by the AI agent.

2. **Workflow enforcement (This Skill)**: Provides the RED→GREEN→REFACTOR workflow, task creation, and phase tracking. The Skill is the primary interface for following TDD discipline.

The PreToolUse hook determines whether a file is a test file by checking the path against common test patterns (*.spec.*, *.test.*, *_test.*, __tests__/*). If it's a source file and no corresponding test exists, the write is blocked.

## Configuration

Read from `.workbuddy/project.yaml`:

- `layers.{layer}.source_paths` — what counts as source code
- `layers.{layer}.test_paths` — what counts as test code
- `enforcement.tdd_enforcement` — whether TDD is enforced
- `quality.test_coverage.overall_min` — minimum coverage threshold

## TDD Lifecycle (RED → GREEN → REFACTOR)

```
[RED] Write failing test → [GREEN] Minimal code to pass → [REFACTOR] Clean up
     │                            │                              │
     ▼                            ▼                              ▼
 Task: "test-<feature>"     Task: "impl-<feature>"        Task: "refactor-<feature>"
```

## Workflow

### Phase 1: RED — Write Failing Test

1. Create a Task named `test-<feature_name>`
2. Write test file matching pattern from `project.yaml → layers.{layer}.test_paths`
3. Run the test — it MUST fail (TDD precondition)
4. Record test failure evidence
5. Mark `test-<feature_name>` as `completed`

**Enforcement:** No `impl-<feature_name>` task may start unless its corresponding `test-<feature_name>` is `completed`.

### Phase 2: GREEN — Minimal Implementation

1. Create a Task named `impl-<feature_name>` with `blockedBy: ["test-<feature_name>"]`
2. Write minimal code to make the failing test pass
3. Run the test — it MUST pass now
4. Mark `impl-<feature_name>` as `completed`

**Enforcement:** Implementation must be minimal (no extra features beyond test requirements).

### Phase 3: REFACTOR — Clean Up

1. Create a Task named `refactor-<feature_name>` with `blockedBy: ["impl-<feature_name>"]`
2. Refactor: remove duplication, improve naming, extract methods
3. Re-run tests — must still pass after refactoring
4. Mark `refactor-<feature_name>` as `completed`

**Enforcement:** Tests must remain green throughout refactoring.

## No Orphan Code Rule

Any file matching `source_paths` that does not have a corresponding file matching `test_paths` is flagged as orphan code. The pairing is determined by the path patterns configured in `project.yaml`, not by hardcoded file extensions.

**The framework does NOT assume any specific test file naming convention — it reads patterns from config.**

## Integration

Used by:
- `coder` agent — TDD discipline for all layers
- `guardian` agent — gate confirm verifies TDD compliance
- `compliance-gate` — P0 rule check

## Usage

```text
/tdd start <feature>     — Begin RED phase: create test task
/tdd implement <feature> — Begin GREEN phase: make test pass
/tdd refactor <feature>  — Begin REFACTOR phase: clean up
/tdd verify <feature>    — Verify complete TDD cycle for a feature
/tdd report              — Show TDD compliance status for current session
```
