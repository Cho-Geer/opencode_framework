# Test Execution Report Template

## 1. Run identity

| Field | Value |
|---|---|
| Specification | path/version |
| Code revision | |
| Runtime/config | |
| Environment | isolated DB/dir/service/session IDs |
| Seed/timezone | |
| Runner | |

## 2. Result ledger

| Test ID | Requirement IDs | Level actually run | Status | Oracle observation | Exact evidence | Gap / follow-up |
|---|---|---|---|---|---|---|
| T-001 | REQ-001 | unit/component/integration/runtime-smoke/live-E2E | PASS/FAIL/BLOCKED/NOT-RUN/INVALID | | command/log/artifact | |

## 3. Adversarial evidence

| Charter ID | Technique | Scope | Result | Evidence | Survived gap / defect |
|---|---|---|---|---|---|
| ADV-001 | mutation/fuzz/property/fault/differential/concurrency/security | | | seed/corpus/report/trace | |

## 4. Failure triage

| Failure ID | Classification | First-failure evidence | Reproduction | Fix / owner | Required reruns |
|---|---|---|---|---|---|
| F-001 | product/test/environment/requirement | | | | |

## 5. Coverage and acceptance

| Metric | Result |
|---|---|
| Critical PASS with evidence | x/y |
| High PASS with evidence | x/y |
| Blocked / invalid cases | IDs and owner |
| Adversarial charters executed | x/y |
| Highest achieved evidence level | per requirement |

**Acceptance decision**: `ACCEPT` / `REWORK` / `STOP`

**Open risk**: List explicit, user-approved risks only. `NOT-RUN` is never an
implicit acceptance.

