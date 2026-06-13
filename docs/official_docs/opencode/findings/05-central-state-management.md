# OpenCode Central State Management — machine.json & State Synchronization

**Date**: 2026-06-11
**Source**: Official OpenCode docs + Project analysis
**Cache sources**: enforcement-modes-standard.md, state-machine-standard.md, UC7KS-PIPELINE-STANDARD.md, framework-enforcer code analysis

---

## 1. Overview

OpenCode's **upstream framework** does not have a built-in `machine.json` or `gate-state.json`. These are **project-specific constructs** (part of the custom multi-agent governance system) that provide:

1. **Centralized state tracking** for multi-agent task lifecycles
2. **Contract hash validation** via keystone mechanism
3. **Compliance gate session management** via gate-state.json
4. **Enforcement mode control** (advisory/strict/locked)

---

## 2. `machine.json` Schema

### Location
```
.opencode/state/machine.json
```

### Core Sections (9 required)

| Section | Required | Description |
|---------|----------|-------------|
| `meta` | ✅ | Version, project name, last updated timestamp |
| `contracts` | ✅ | Contract files and their SHA-256 hashes |
| `taskLifecycle` | ✅ | Task lifecycle definition with states and transitions |
| `taskLifecycle.transitions` | ✅ | Transition rules with `from`, `to`, and `requiredEvidence` |
| `eslint_state` | ✅ | ESLint audit results |
| `write_audit_state` | ✅ | Write audit tracking (per-agent file modification logs) |
| `knowledge_cache_state` | ✅ | UC7KS knowledge cache sufficiency tracking |
| `compliance_records` | ✅ | Compliance gate session audit trail |
| `tdd_enforcement_state` | ✅ | TDD RED/GREEN phase enforcement |

### Example Structure

```json
{
  "meta": {
    "version": "1.0.0",
    "project": "booking-system",
    "last_updated": "2026-06-11T00:00:00Z"
  },
  "contracts": {
    "contract.yaml": "sha256:<64-char-hex>"
  },
  "taskLifecycle": {
    "states": ["pending", "in_progress", "completed", "failed", "blocked"],
    "transitions": [
      {
        "from": "pending",
        "to": "in_progress",
        "requiredEvidence": ["task_assignment_proof"]
      },
      {
        "from": "in_progress",
        "to": "completed",
        "requiredEvidence": ["test_report.json", "guardian_approval"]
      }
    ]
  }
}
```

---

## 3. `gate-state.json` Schema

### Location
```
.opencode/state/gate-state.json
```

### Purpose

Tracks active compliance gate sessions for the `compliance_gate_check` → `compliance_gate_confirm` → `compliance_gate_complete` lifecycle.

### Core Structure

```json
{
  "active_sessions": [
    {
      "session_id": "cg_ses_<timestamp>",
      "task_id": "T-001",
      "task_description": "Task description",
      "status": "armed",
      "agent": "@AgentType",
      "created_at": "2026-06-11T00:00:00Z",
      "confirmed_at": "2026-06-11T00:01:00Z",
      "expires_at": "2026-06-12T00:00:00Z"
    }
  ],
  "drained_sessions": [],
  "meta": {
    "version": "2.0.0",
    "last_pruned": "2026-06-11T00:00:00Z"
  }
}
```

### Session Status Lifecycle

```
checked (gate_check called)
  → armed (gate_confirm called)
    → completed (gate_complete called)
    → drained (stale after 24h armed / 48h checked)
```

---

## 4. Enforcement Modes

Three modes control the behavior of all state enforcement gates:

| Mode | Behavior | Block On |
|------|----------|----------|
| **Advisory** | Warnings only | Nothing — all informational |
| **Strict** | Blocks violations | gate_armed, keystone_hash, tdd_order, dag_gate, eslint_audit, role_scope |
| **Locked** | Complete lockdown | Everything + workspace_root, gate_state_sync, write_audit_integrity |

### Configuration

```json
{
  "template_resolution": {
    "develop_enforcement_mode": "advisory",
    "runtime_enforcement_mode": "advisory"
  }
}
```

Environment variable override: `ENFORCEMENT_MODE=strict` (except Locked mode which cannot be overridden).

---

## 5. Keystone Hash Validation

### Purpose

Ensures **contract integrity** — any change to `contract.yaml` or requirement documents must be accompanied by a hash update.

### Mechanism

```bash
# Compute keystone hash
node .opencode/scripts/mcp-tools/keystone-validate.js --hash contract.yaml
```

The hash is stored in `machine.json.contracts` and validated by pre-commit hook.

### Validation Points

| Check Point | What It Validates |
|-------------|-------------------|
| Pre-commit | Contract hash matches actual file hash |
| gate_complete | Task evidence completeness |
| Guardian review | Hash synchronized after changes |

---

## 6. Write Audit State

### Purpose

Tracks every file write/modification by agent, enabling rollback and scope enforcement.

### Structure (in machine.json)

```json
{
  "write_audit_state": {
    "counts_checks_run": 150,
    "files_changed": 75,
    "last_tool_executed": "safe_edit",
    "violations": [],
    "last_updated": "2026-06-11T00:00:00Z"
  }
}
```

### Enforcement

- **P0 constraint**: Every write/edit must be preceded by write-scope check
- **Violation**: Write to unauthorized path → blocked with `[FW-ENFORCE][UC7-008]` error
- **Recovery**: Safe_restore from backup (backups created by safe_edit/safe_delete)

---

## 7. TDD Enforcement State

### Purpose

Ensures RED → GREEN → REFACTOR cycle compliance.

### State Tracking

```json
{
  "tdd_enforcement_state": {
    "current_phase": "red",
    "phase_files": ["booking-backend/src/...spec.ts"],
    "last_verified": "2026-06-11T00:00:00Z"
  }
}
```

### Enforcement Rules

| Phase | Rule |
|-------|------|
| RED | Only test files (.spec.ts) may be created/modified |
| GREEN | Business code changes must correspond to an existing test |
| REFACTOR | All tests must pass before refactoring |

---

## 8. Knowledge Cache State (UC7KS)

### Purpose

Tracks whether the agent has searched the local knowledge cache (UC7-001 compliance).

### Structure

```json
{
  "knowledge_cache_state": {
    "last_accessed": "2026-06-11T00:00:00Z",
    "search_domain": "opencode_framework",
    "cache_sufficiency": {
      "status": "sufficient",
      "reason": "Found 22 matching entries...",
      "files_read": ["file1.md", "file2.md"],
      "content_summary": "Summary of findings"
    }
  }
}
```

---

## 9. Git Hook Integration

### Pre-Commit Hook Validation Layers

| Layer | Check | Enforces |
|-------|-------|----------|
| Layer 0 | Gate Armed Check | Active gate session exists |
| Layer 2 | Keystone Validation | Contract hash matches |
| Layer 2.5 | TDD Order Check | RED phase only test files |
| Layer 2.6 | UC7KS Docs Consistency | index.json validity, no orphans |

### State Machine Reset

```bash
# Reset state machine (for emergency recovery)
.opencode/scripts/state-machine-reset.sh --force
# Unlock from locked mode (requires @Arbiter token)
.opencode/scripts/state-machine-reset.sh --force --unlock
```

---

## 10. Key Takeaways

1. **`machine.json` and `gate-state.json` are project-specific** — not upstream OpenCode
2. **9 required sections** in machine.json covering contracts, tasks, ESLint, writes, knowledge cache, compliance, TDD
3. **3 enforcement modes**: advisory, strict, locked — configurable per environment
4. **Keystone hashing** ensures contract integrity across agent sessions
5. **Write audit** enables rollback and scope enforcement
6. **TDD enforcement** ensures RED → GREEN → REFACTOR compliance
7. **Knowledge cache state** tracks UC7-001 local-first compliance
8. **Pre-commit hook** validates 4+ layers before allowing commits
9. **Gate sessions expire**: 24h for armed, 48h for checked (unconfirmed)
