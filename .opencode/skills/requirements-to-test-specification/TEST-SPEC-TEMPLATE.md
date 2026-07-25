# Test Specification Template

## 1. Scope and sources

| Field | Value |
|---|---|
| Feature / change | |
| Requirement sources | path, version, section/line |
| In scope | |
| Non-goals | |
| Environment assumptions | |
| Open decisions | ID, owner, deadline, blocked cases |

## 2. Atomic requirement ledger

| Requirement ID | Source | Condition | Required behavior | Observable result | Risk |
|---|---|---|---|---|---|
| REQ-001 | | | | | critical/high/normal/low |

## 3. Oracle catalog

| Oracle ID | Type | Independent source / invariant | Applies to |
|---|---|---|---|
| ORA-001 | contract/invariant/reference/property/manual | | |

## 4. Test-case matrix

| Test ID | Requirement IDs | Category | Level | Preconditions and isolated data | Input / steps | Oracle ID and expected result | Expected state / prohibited side effect | Boundary strategy | Evidence required | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| T-001 | REQ-001 | happy/boundary/negative/state/security/fault/concurrency/property/regression | unit/component/integration/runtime-smoke/E2E | | | | | real temp DB/fake boundary/etc. | command, log, artifact | DESIGNED/OPEN/BLOCKED |

## 5. Adversarial charters

| Charter ID | Targets | Technique | Generated faults/inputs | Kill condition | Required evidence |
|---|---|---|---|---|---|
| ADV-001 | REQ-001 | mutation/fuzz/property/fault/differential/concurrency/security | | | |

## 6. Coverage gate

| Metric | Result | Gate |
|---|---:|---|
| In-scope requirements traced | x/y | 100% |
| Critical/high with adversarial coverage | x/y | 100% |
| Tests with independent oracle | x/y | 100% |
| Open / blocked decisions | IDs | must be explicit |

## 7. Execution handoff

1. Execute in risk order: critical → high → normal → low.
2. Keep `PASS`, `FAIL`, `BLOCKED`, `NOT-RUN`, and `INVALID` separate.
3. Record the exact command/request, environment identity, result artifact, and
   oracle observation for every executed case.

