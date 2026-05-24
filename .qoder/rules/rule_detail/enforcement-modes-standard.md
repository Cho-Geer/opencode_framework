---
type: model_decision
description: When configuring enforcement modes
trigger: always_on
alwaysApply: true
version: 1.0.0
status: active
---

# Enforcement Modes Standard v1.0

## 1. Overview

This file defines the **Enforcement Modes** for the multi-agent execution framework. Enforcement modes control the behavior levels of compliance gates, pre-commit hooks, pre-execution hooks, and ESLint audits across different environments. All Agents, hooks, and audit tools must adjust their blocking/warning strategies according to the currently active mode.

## 2. Three Enforcement Levels

### 2.1 Advisory

**Applicable Environment**: Local development, experimental branches, prototype phase

**Core Behavior**: All violations are **logged as warnings only** and do not block any operations.

| Checkpoint | Behavior |
|--------|------|
| `compliance_gate_check` | Always passes (`passed: true`); violations logged to `failed_items` but with `severity: WARNING` |
| `compliance_gate_confirm` | Always allows arming, even if the preceding check has warnings |
| `compliance_gate_complete` | Always marks as complete; ESLint dirty_modules are only logged, not blocking |
| `pre-commit` Layer 0: Gate Armed Check | Skipped — commits allowed even without gate session |
| `pre-commit` Layer 2: Keystone Validation | Runs validation; failures warn only, not blocking |
| `pre-commit` Layer 2.5: TDD Order Check | Violations warn only, not blocking commits |
| `pre-execution-hook.sh` DAG Gate | Missing DAG or non-existent task warns only, allows continuation |
| `eslint-audit` | Runs and reports violations but does not update `dirty_modules` aggregate state |
| `write_audit` role scope check | Out-of-scope writes are logged as warnings only |

**Identifier**: All tool outputs prefixed with `[ADVISORY]`, using the `⚠️` icon.

### 2.2 Strict

**Applicable Environment**: CI pipelines, pre-release/staging branches, code review phase

**Core Behavior**: All violations **block** non-compliant operations; fixes are required before proceeding.

| Checkpoint | Behavior |
|--------|------|
| `compliance_gate_check` | Missing rule files or unresolved role violations → `passed: false`, blocks continuation |
| `compliance_gate_confirm` | May only arm after check passes |
| `compliance_gate_complete` | ESLint dirty_modules exist → returns `failed`, blocks completion |
| `pre-commit` Layer 0: Gate Armed Check | No active gate session → blocks commit |
| `pre-commit` Layer 2: Keystone Validation | Contract hash mismatch or integrity chain failure → blocks commit |
| `pre-commit` Layer 2.5: TDD Order Check | Implementation file without corresponding test file → blocks commit |
| `pre-execution-hook.sh` DAG Gate | Missing DAG or task not in DAG or status not pending → blocks execution |
| `eslint-audit` | Violations written to `dirty_modules`, blocks gate_complete |
| `write_audit` role scope check | Out-of-scope write marked as BLOCKER, blocks subsequent operations |

**Identifier**: All tool outputs prefixed with `[STRICT]`, using the `❌` icon.

### 2.3 Locked

**Applicable Environment**: Production config branches, release tags, security-critical environments

**Core Behavior**: Same as Strict, with **additional** enforcements below, and **no waivers accepted**:

| Additional Checkpoint | Behavior |
|------------|------|
| Workspace root path enforcement | Any path in `machine.json` that is not the current `OPENCODE_ROOT` → blocks all read/write operations |
| gate-state sync enforcement | `gate-state.json.active_sessions` inconsistent with actual `sessions` state → blocks all gate operations until fixed |
| write_audit integrity verification | Every file write must have a corresponding write_audit record; missing record → blocks commit |
| Waiver policy | **All waivers are rejected**. `WAIVE.md` tech debt entries must include @Arbiter locked-mode override approval |
| Mode downgrade | Downgrading from Locked to Strict or Advisory is not allowed. Must execute `state-machine-reset.sh --force --unlock` with an @Arbiter-signed unlock token |

**Identifier**: All tool outputs prefixed with `[LOCKED]`, using the `🔒` icon.

## 3. Mode Behavior Matrix (Complete)

| Check Item | Advisory | Strict | Locked |
|--------|----------|--------|--------|
| Rule file existence | ⚠️ Warn | ❌ Block | ❌ Block |
| Role violation check | ⚠️ Warn | ❌ Block | ❌ Block |
| Gate armed check (pre-commit) | ⏭️ Skip | ❌ Block | ❌ Block |
| Keystone contract hash | ⚠️ Warn | ❌ Block | ❌ Block |
| Keystone integrity chain | ⚠️ Warn | ❌ Block | ❌ Block |
| TDD order check | ⚠️ Warn | ❌ Block | ❌ Block |
| DAG pre-check (pre-execution) | ⚠️ Warn | ❌ Block | ❌ Block |
| ESLint audit violation | ⚠️ Warn | ❌ Block gate_complete | ❌ Block gate_complete |
| Out-of-scope write (role scope) | ⚠️ Warn | ❌ Block | ❌ Block |
| Workspace-root path validation | ⏭️ Skip | ⚠️ Warn | ❌ Block |
| Gate-state sync validation | ⏭️ Skip | ⚠️ Warn | ❌ Block |
| Write-audit integrity | ⏭️ Skip | ⚠️ Warn | ❌ Block |
| Waiver acceptance | ✅ Accepted | ✅ Accepted (requires @Arbiter) | ❌ All rejected |
| Mode downgrade allowed | N/A | ✅ Allowed (requires reset) | ❌ Prohibited |

## 4. Mode Configuration

### 4.1 Configuration Location

The enforcement mode is defined in `project.config.json` under `template_resolution`:

```json
{
  "template_resolution": {
    "enforcement_mode": "advisory",
    "enforcement_config": {
      "advisory": {
        "description": "Warnings only, non-blocking. Suitable for local development.",
        "block_on": [],
        "log_level": "warn"
      },
      "strict": {
        "description": "Blocks non-compliant actions. Suitable for CI/staging.",
        "block_on": ["gate_armed", "keystone_hash", "tdd_order", "dag_gate", "eslint_audit", "role_scope"],
        "log_level": "error"
      },
      "locked": {
        "description": "Prevents all changes without governance override. Suitable for production config branches.",
        "block_on": ["gate_armed", "keystone_hash", "keystone_integrity", "tdd_order", "dag_gate", "eslint_audit", "role_scope", "workspace_root", "gate_state_sync", "write_audit_integrity"],
        "log_level": "error",
        "allow_waivers": false,
        "allow_downgrade": false
      }
    }
  }
}
```

### 4.2 Environment Variable Override

The environment variable `ENFORCEMENT_MODE` can override the configuration in `project.config.json`:

```bash
# Priority: ENFORCEMENT_MODE > project.config.json.template_resolution.enforcement_mode
export ENFORCEMENT_MODE=strict
```

**Security Constraints**:
- `ENFORCEMENT_MODE=locked` cannot be overridden by environment variable in `locked` mode (write-protected)
- `ENFORCEMENT_MODE=advisory` is ignored in `locked` mode

### 4.3 Runtime Query

```bash
# Query current enforcement mode
.qoder/scripts/enforcement-mode-check.sh

# Example output: ENFORCEMENT_MODE=strict
```

## 5. Mode Transition Rules

### 5.1 Allowed Transitions

```
advisory ──→ strict ──→ locked
    ↑           ↑           │
    │           │           │
    └───reset───┘           │
                            ↓
                      (no downgrade)
```

### 5.2 Transition Commands

| Transition Direction | Command |
|----------|------|
| advisory → strict | Modify `enforcement_mode` to `"strict"` in `project.config.json`, then commit |
| strict → locked | Same as above, change to `"locked"`; requires @Arbiter approval |
| strict → advisory | Execute `state-machine-reset.sh --force`, then modify `enforcement_mode` to `"advisory"` |
| locked → * | **Prohibited**. Must execute `state-machine-reset.sh --force --unlock` with an @Arbiter-signed unlock token |

### 5.3 Transition Audit

All mode transitions are recorded in `.qoder/state/machine.json.compliance_records.enforcement_transitions`:

```json
{
  "enforcement_transitions": [
    {
      "from": "advisory",
      "to": "strict",
      "timestamp": "2026-05-22T01:00:00Z",
      "agent": "@Architect",
      "task_id": "RVW-REVIEW-08",
      "reason": "Promoting to strict for initial testing"
    }
  ]
}
```

## 6. Integration Point Review

### 6.1 compliance_gate_check

In `runGateCheck()`:
1. Read `enforcement_mode`
2. If `advisory`: All failed items downgraded to `severity: WARNING`, returns `passed: true`
3. If `strict` or `locked`: All failed items retain original severity, returns `passed: false`

### 6.2 compliance_gate_complete

In `runGateComplete()`:
1. Read `enforcement_mode`
2. If `advisory`: Ignores `dirty_modules`, always marks as complete
3. If `strict` or `locked`: `dirty_modules` → returns `failed`

### 6.3 pre-commit Hook

In Layer 0 (Gate Armed Check):
1. If `advisory`: Skip check, display warning
2. If `strict` or `locked`: Execute full check; no session → exit 1

### 6.4 pre-execution-hook.sh

In DAG Gate check:
1. If `advisory`: Missing DAG/task → warning + exit 0
2. If `strict` or `locked`: Missing DAG/task → exit 1

## 7. Troubleshooting

| Symptom | Possible Cause | Solution |
|------|----------|----------|
| All commits blocked but advisory expected | `ENFORCEMENT_MODE=strict` has been set | `unset ENFORCEMENT_MODE` or check `project.config.json` |
| Locked mode cannot commit emergency fix | Mode downgrade is prohibited | Execute `state-machine-reset.sh --force --unlock` + @Arbiter token |
| Audit log not updated after mode transition | `compliance_records` not refreshed | Manually run `node .qoder/scripts/mcp-tools/compliance-gate.js` or wait for next gate operation |
| Environment variable not taking effect | `locked` mode is active | Environment variable override is disabled in locked mode; check `enforcement_config.locked.allow_downgrade` |

---

*Version History*:
- **v1.0** (2026-05-22): Initial version, defining advisory/strict/locked three-tier enforcement modes and complete behavior matrix.
