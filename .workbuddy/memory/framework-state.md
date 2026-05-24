# Framework State

_Quality dimensions and contract hashes. Replaces `.opencode/state/machine.json`._

---

## Quality Dimensions

| Dimension | Status | Last Check | Details |
|-----------|--------|------------|---------|
| lint | pending | — | Not yet checked |
| types | pending | — | Not yet checked |
| dependencies | pending | — | Not yet checked |
| format | pending | — | Not yet checked |
| tdd | pending | — | Not yet checked |
| write_audit | pending | — | Not yet checked |
| compliance | pending | — | Not yet checked |
| contracts | pending | — | Not yet checked |
| keystone_hashes | pending | — | Not yet checked |

---

## Contract Hashes

| File | Hash | Last Updated |
|------|------|-------------|
| *(none registered)* | — | — |

---

## Failure Tracking

_Circuit-breaker failure counts. Managed by circuit-breaker skill._

| Task ID | Failures | Last Failure | Tier | Status |
|---------|----------|-------------|------|--------|
| *(no active failures)* | — | — | — | — |

---

## Transaction Integrity

_Last transaction metadata. Auto-updated by PostToolUse hook._

| Field | Value |
|-------|-------|
| last_txn_at | — |
| last_gate_id | — |
| last_file | — |

---

## Enforcement Mode

Current: **strict** (from project.yaml)

- advisory: warnings only, non-blocking
- strict: blocks non-compliant actions (recommended)
- locked: prevents all changes without governance override
