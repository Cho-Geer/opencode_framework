---
name: requirements-to-test-specification
description: "Transforms requirements documents, PRDs, acceptance criteria, and change requests into a rigorous, traceable test specification. Use when the user asks to design test cases from requirements, create a test specification/test plan, define acceptance tests, or improve AI-code correctness before implementation. 触发词：需求文档、PRD、测试式样书、测试规格、测试用例设计、验收测试、需求转测试。"
version: 1.0.0
---

# Requirements to Test Specification

Create a test specification that can expose incorrect AI-generated code. The
output is a **test design artifact**, not proof that the product works.

## Non-negotiable rules

1. Requirements are evidence, not guesses. Missing or ambiguous requirements
   become `OPEN` questions; never invent expected behavior.
2. Every test has an independent oracle: requirement rule, reference result,
   invariant, metamorphic relation, or explicitly approved manual oracle.
3. Test observable behavior, persisted state, and external effects. Do not
   prescribe or assert private helper calls unless the call itself is a contract.
4. Mock only an uncontrollable system boundary. Prefer a real temporary DB,
   temporary directory, sandbox service, or contract-tested fake over mocking
   internal business collaborators.
5. A test case cannot be `PASS` in this skill. Its status is `DESIGNED`,
   `OPEN`, or `BLOCKED`; execution evidence belongs to
   `test-specification-execution`.

## Workflow

### 1. Establish the input boundary `[ANALYSIS]`

Read the requirement document and project instructions. Record:

- source path/version and in-scope feature;
- actors, data, states, integrations, security/availability constraints;
- explicit non-goals and unresolved decisions.

Split requirements into atomic IDs (`REQ-001`, `REQ-002` ...). Each ID must
state a condition, required behavior, and observable result. Quote the source
section or line for every ID.

> **注意**：阅读需求只能说明“作者想要什么”；不能证明实现存在、更不能证明它正确。

### 2. Build a risk model `[ANALYSIS]`

For every atomic requirement, identify the cheapest plausible failure:

| Risk dimension | Ask |
|---|---|
| Boundary | Empty, zero, min/max, duplicate, unicode, timezone, overflow? |
| Negative | Invalid type, missing data, malformed input, forbidden action? |
| State | Retry, partial completion, cancellation, idempotency, recovery? |
| Security | Authorization, tenant/path escape, injection, secret leakage? |
| Dependency | Timeout, unavailable service, stale/conflicting data, bad response? |
| Concurrency | Double submit, race, ordering, lease/transaction loss? |
| Compatibility | Upgrade, migration, old client, configuration override? |

Mark severity: `critical` (safety/data/security/money), `high`, `normal`, or
`low`. A critical/high requirement needs at least one negative or adversarial
case in addition to its happy path.

### 3. Define independent oracles `[ANALYSIS]`

Choose the strongest applicable oracle, in this order:

1. Explicit requirement or externally visible contract.
2. Invariant (for example, balance equals credits minus debits).
3. Reference implementation or differential result.
4. Property/metamorphic relation (round-trip, monotonicity, idempotency,
   permutation invariance).
5. Approved manual oracle with an exact inspection procedure.

Do not use “the implementation returned this value” as an oracle.

### 4. Design the test matrix `[ANALYSIS]`

Use [TEST-SPEC-TEMPLATE.md](TEST-SPEC-TEMPLATE.md). Create one row per
observable behavior and include all applicable categories:

- happy path, boundary, invalid input, authorization/security;
- state transition, idempotency/retry, dependency failure, concurrency;
- property/fuzz, differential/metamorphic, regression.

For each case specify preconditions, inputs, exact oracle, expected response,
state changes, prohibited side effects, observability, required test level, and
test data isolation. Specify the intended boundary fake/sandbox only where one
is needed.

### 5. Add adversarial test charters `[ANALYSIS]`

For each critical/high area, add a charter that intentionally attempts to make
the system wrong. Select applicable techniques:

- property-based generation and shrinking;
- fuzzing parsers/protocols/input boundaries;
- mutation testing for predicates, error paths, permission checks, and status
  transitions;
- fault injection (timeouts, partial writes, dropped messages);
- differential testing against a reference or prior version;
- concurrency scheduling/repeat runs;
- security abuse cases and path/command/serialization bypass variants.

State the kill condition: what incorrect result must make the test fail.

### 6. Run the specification quality gate `[VERIFICATION]`

Calculate and report, from the completed document:

- atomic requirement count and traceability coverage;
- requirements with happy + negative/boundary coverage;
- critical/high requirements with adversarial coverage;
- test cases missing an independent oracle;
- `OPEN`/`BLOCKED` decisions and their owner.

The gate fails if an in-scope requirement has no test, a critical/high case has
no adversarial test, or any test lacks an oracle. Do not silently lower scope.

Verified-by: test-spec completeness report with IDs and counts.

> **合理化检测**：如果你发现自己在想“需求已经很清楚，不必写负向或边界测试”，停下来。AI 最容易在未写明的边界和失败路径上产生貌似合理的错误。

### 7. Produce the handoff `[OBSERVATION]`

Deliver the specification, an explicit execution order, required environment,
and the minimum evidence each case needs. Hand off to
`test-specification-execution`; do not mark product behavior as verified.

## Required output

The document must contain, in this order:

1. scope, source, non-goals, and open questions;
2. atomic requirement ledger with source traceability;
3. risk matrix and independent oracle catalog;
4. test-case matrix and adversarial charters;
5. test data/environment/isolation plan;
6. coverage gate report and execution handoff.

Use statuses exactly: `DESIGNED`, `OPEN`, `BLOCKED`. Never use `PASS`.

## Quality gate checklist

- [ ] Every in-scope atomic requirement has one or more test IDs.
- [ ] Every test ID names an observable result and an independent oracle.
- [ ] Critical/high requirements have happy, negative/boundary, and adversarial coverage.
- [ ] State-changing behavior includes retry/idempotency or a documented reason it does not apply.
- [ ] Security-sensitive behavior includes unauthorized and bypass attempts.
- [ ] External failures and partial completion are covered where dependencies exist.
- [ ] No test depends on mocked internal business helpers.
- [ ] Open decisions are visible and prevent false completion claims.

