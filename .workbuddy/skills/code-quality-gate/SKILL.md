---
name: code-quality-gate
description: P1 code quality enforcement gate. The PreToolUse hook in .codebuddy/settings.json provides scope enforcement (blocks guardian from writing source code). This Skill provides lint/typecheck/dependency checks. All commands read from project.yaml — zero hardcoded tool names.
agent_created: true
level: user
---

# code-quality-gate

## Purpose

Enforce code quality standards as a P1 gate. Violations produce warnings (non-blocking in advisory mode, blocking in strict mode). All tool commands are read from `project.yaml` — zero hardcoded assumptions about which linter, type checker, or package manager is used.

## Enforcement Model

Scope enforcement operates at two levels:

1. **Hard enforcement (PreToolUse hook + agent disallowedTools)**: The `guardian` and `arbiter` agents have `disallowedTools: Write, Edit` in their frontmatter, which is enforced by WorkBuddy at the platform level. The PreToolUse hook additionally checks scope rules before any Write/Edit.

2. **Workflow enforcement (This Skill)**: Provides lint, typecheck, dependency, and build verification checks. The Skill is the primary interface for running quality gates.

## Configuration

Read from `.workbuddy/project.yaml`:

- `layers.{layer}.lint_command` — lint command for each enabled layer
- `layers.{layer}.typecheck_command` — typecheck command for each enabled layer
- `layers.{layer}.build_command` — build command for each enabled layer
- `quality.lint.severity_threshold` — what severity blocks
- `quality.typecheck.strict` — strict mode enforcement

NOTE: Scope enforcement (which agents can write to which files) is now handled natively by `disallowedTools` frontmatter in agent .md files and the PreToolUse hook in `.codebuddy/settings.json`. The previous `write_scopes` field in project.yaml is deprecated and no longer used.

## Quality Checks

### 1. Scope Check

Agent write scope is enforced at the platform level:

- `disallowedTools: Write, Edit` in agent frontmatter (guardian, arbiter) prevents those agents from using Write/Edit tools
- PreToolUse hook in `.codebuddy/settings.json` additionally validates scope rules before any Write/Edit
- No manual scope checking is needed — the platform enforces this deterministically

### 2. Lint Check

Run the configured lint command for the affected layer.

- Read command from `project.yaml → layers.{layer}.lint_command`
- If no command configured for the layer: SKIP (not fail)
- If command fails: result depends on `quality.lint.severity_threshold`

### 3. Type Check

Run the configured typecheck command for the affected layer.

- Read command from `project.yaml → layers.{layer}.typecheck_command`
- If no command configured: SKIP
- If `quality.typecheck.strict: true` — any type error is BLOCKING

### 4. Dependency Audit

Check for known vulnerabilities in dependencies.

- Use the package manager's audit command (auto-detected or configured)
- If audit command fails: WARN (not block — dependency issues are advisory)

### 5. Build Verification

Run the configured build command to verify no build errors.

- Read command from `project.yaml → layers.{layer}.build_command`
- If no command configured: SKIP
- Build failure: BLOCKING in strict mode

## Result Classification

| Status | Condition | Action |
|--------|-----------|--------|
| **CLEAN** | 0 errors, 0 warnings | Gate passes |
| **WARN** | 0 errors, >0 warnings | Gate passes with warnings logged |
| **BLOCKED** | >0 errors | Gate fails, task cannot complete |

## Integration

Used by:
- `coder` agent — must pass before marking implementation complete
- `guardian` agent — gate confirm phase runs all quality checks
- `devops` agent — CI pipeline runs full quality gate

## Usage

```text
/quality lint     — Run lint check for affected layers
/quality types    — Run typecheck for affected layers
/quality deps     — Run dependency audit
/quality build    — Run build verification
/quality full     — Run all quality checks
/quality report   — Show last quality gate results
```
