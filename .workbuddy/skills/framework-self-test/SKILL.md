---
name: framework-self-test
description: P2 framework health verification. Validates project configuration, hooks, state files, agent/skill consistency, and template resolution. Replaces the original framework-self-test.js (38KB, 19+ checks) with a lightweight 7-check diagnostic suite.
agent_created: true
level: user
---

# framework-self-test

## Purpose

Verify the health and integrity of the WorkBuddy Development Framework configuration. Run this after initial setup, after any configuration changes, or when troubleshooting framework behavior.

## Checks

### Check 1: Project Configuration
**What**: `.workbuddy/project.yaml` exists and is parseable.
**Pass**: File exists, contains `project:`, `layers:`, `enforcement:` sections.
**Fail**: File missing, unparseable, or missing required sections.
**Action**: Create from `.workbuddy/templates/` if missing; fix YAML syntax if broken.

### Check 2: Hooks Configuration
**What**: `.codebuddy/settings.json` has PreToolUse, PostToolUse, and Stop hooks.
**Pass**: All three hook categories present with at least one hook each.
**Fail**: Missing hook category, empty hooks array, or malformed JSON.
**Action**: Restore from CODEBUDDY.md reference; validate JSON syntax.

### Check 3: State Files
**What**: Essential state files exist and are readable.
- `.workbuddy/memory/framework-state.md`
- `.workbuddy/memory/gate-sessions.md`
- `.workbuddy/memory/invocation-log.md`
**Pass**: All three files exist.
**Warn**: Any file missing (will be auto-created on first use).
**Fail**: None (missing files are auto-created, not a hard failure).

### Check 4: Layer Path Consistency
**What**: For each enabled layer in `project.yaml`, verify source_paths and test_paths are both present.
**Pass**: Every enabled layer has non-empty `source_paths` and `test_paths`.
**Warn**: Enabled layer has source_paths but empty test_paths (TDD enforcement may fail).
**Skip**: Layer not enabled.

### Check 5: Agent File Integrity
**What**: Agent `.md` files exist for all roles declared in `project.yaml -> agents`.
**Pass**: `.workbuddy/agents/{role}.md` exists for each role.
**Fail**: Agent file missing for a declared role.
**Action**: Create missing agent file from template.

### Check 6: Skill File Integrity
**What**: Skill `SKILL.md` files exist for all skills declared in `project.yaml -> agents.{role}.skills`.
**Pass**: `.workbuddy/skills/{skill}/SKILL.md` exists for each declared skill.
**Warn**: Skill file missing (agent may fail to invoke skill).
**Action**: Create missing skill from template or reference.

### Check 7: Framework Reference
**What**: `CODEBUDDY.md` references `.workbuddy/` directory.
**Pass**: CODEBUDDY.md contains `.workbuddy/` or references the framework.
**Warn**: CODEBUDDY.md does not reference the framework (framework may exist but not be auto-loaded).
**Fail**: CODEBUDDY.md does not exist (framework is not discoverable).

### Check 8: Transaction Integrity
**What**: Transaction log integrity and gate-session grouping.
- `.workbuddy/memory/transaction-log.md` exists and has entries
- `.workbuddy/memory/framework-state.md` has `## Transaction Integrity` section
- Transaction log entries include `gate:` prefix for gate-session grouping
**Pass**: Transaction log exists, framework-state has Transaction Integrity section.
**Warn**: Transaction log empty or missing gate-session grouping (auto-created on first write).
**Fail**: None (transaction log is auto-maintained by PostToolUse hook).

## Result Aggregation

| Result | Condition |
|--------|-----------|
| **PASS** | All checks pass (0 failures, 0-2 warnings) |
| **WARN** | 0 failures, 3+ warnings |
| **FAIL** | 1 or more hard failures |

## Output Format

```
WorkBuddy Framework Self-Test — <timestamp>
===========================================
[PASS] Check 1: Project Configuration — project.yaml valid (type: web-fullstack)
[PASS] Check 2: Hooks Configuration — PreToolUse, PostToolUse, Stop all present
[PASS] Check 3: State Files — framework-state.md, gate-sessions.md, invocation-log.md all exist
[WARN] Check 4: Layer Consistency — frontend test_paths is empty (TDD enforcement may fail)
[PASS] Check 5: Agent Integrity — 5/5 agent files present
[PASS] Check 6: Skill Integrity — 8/8 skill files present
[PASS] Check 7: Framework Reference — CODEBUDDY.md references .workbuddy/
===========================================
Result: 6 PASS, 1 WARN, 0 FAIL → PASS (with warnings)
```

## Integration

Used by:
- `devops` agent — CI pipeline health check before deployment
- `guardian` agent — pre-gate confirm framework integrity
- Main agent — troubleshooting when hooks don't fire or rules don't inject

## Usage

/framework-self-test          — Run all 7 checks
/framework-self-test check 1  — Run specific check
/framework-self-test report   — Show last test results
