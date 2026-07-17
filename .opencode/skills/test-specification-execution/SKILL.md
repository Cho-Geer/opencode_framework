---
name: test-specification-execution
description: "Executes a rigorous test specification against a codebase and produces evidence-backed test results. Use when the user asks to run a test specification/test plan, validate AI-written code, perform adversarial testing, fault injection, mutation/property/fuzz testing, or verify correctness and robustness beyond unit tests. 触发词：执行测试式样书、执行测试计划、测试验证、AI代码验证、对抗测试、故障注入、变异测试、属性测试、fuzz。"
version: 1.0.0
---

# Test Specification Execution

Execute a test specification as an evidence-producing investigation. A green
unit suite alone is not product correctness and never closes an E2E case.

## Non-negotiable rules

1. Use a test specification produced by `requirements-to-test-specification`,
   or first create an equivalent atomic requirement + oracle ledger.
2. Execute the case as written. Mark an unexecutable/ambiguous case `BLOCKED`
   or `INVALID`; do not quietly rewrite expected behavior to fit the code.
3. Keep evidence levels separate: `unit`, `component`, `integration`,
   `runtime-smoke`, and `live-E2E` are not interchangeable.
4. Record `PASS`, `FAIL`, `BLOCKED`, `NOT-RUN`, or `INVALID` for every case.
   Only an executed case with a satisfied independent oracle can be `PASS`.
5. Mock only uncontrollable boundaries. Use real internal collaboration and
   temporary/sandbox dependencies where practical. A fake boundary needs a
   contract test or documented equivalence.
6. Never classify a test as passing merely because it did not crash.

## Workflow

### 1. Admit the specification `[ANALYSIS]`

Check that every selected test ID has requirement traceability, an independent
oracle, expected observable result, prerequisites, and evidence requirements.
Build the run order: critical/security/data-loss first, then high, then normal.

If a case lacks an oracle or expected result, mark `INVALID` and return it to
the specification author. If an environment prerequisite is unavailable, mark
`BLOCKED`; do not convert it to `PASS` or `NOT-RUN`.

### 2. Map cases to executable boundaries `[ANALYSIS]`

For each test identify the public API/tool/UI entry point, affected persistent
state, external boundaries, and cleanup plan. Follow repository instructions
first (for example CodeGraph impact rules). Choose the strongest safe level:

| Need | Preferred level |
|---|---|
| Pure rule/invariant | unit or property |
| Internal collaborators | component with real collaborators |
| DB/files/queue/API adapter | integration using isolated real/sandbox dependency |
| Server startup/config/wiring | runtime-smoke |
| User entry through complete production-like chain | live-E2E |

### 3. Prepare a hermetic environment `[VERIFICATION]`

Create isolated test data and record the runtime identity: commit, config,
runtime version, seed, timezone, ports, fake/sandbox endpoints, and cleanup
method. Pin time/randomness where required; never share mutable state between
parallel cases unless testing concurrency.

Verified-by: environment setup command/output and isolated resource IDs.

> **注意**：源码分析回答“理论上会调用什么”；只有启动的服务、实际配置和真实依赖行为才能证明运行态。

### 4. Execute deterministic and negative cases `[VERIFICATION]`

Run happy, boundary, invalid-input, authorization, state-transition, and
regression cases. For every case capture the exact command/request, observed
response, state query, logs/traces, and oracle comparison. Confirm prohibited
side effects are absent, not merely unobserved.

Verified-by: per-case command/request + oracle observation + artifact path.

### 5. Execute adversarial charters `[VERIFICATION]`

Run the strongest applicable adversarial techniques for critical/high targets:

- property-based tests with seed and shrink artifact;
- fuzz tests with corpus/crash input retained;
- mutation tests that mutate predicates, authorization, error handling, and
  state transitions; report killed vs survived mutants;
- fault injection for timeout, partial persistence, retry, cancellation, and
  dependency error;
- differential/metamorphic tests against the chosen oracle;
- repeated/concurrent schedules for races and duplicate delivery;
- abuse cases for authorization, input encoding, path and command traversal.

If a selected technique cannot run, state why and report the resulting coverage
gap. Do not replace it with a happy-path unit test and call it equivalent.

Verified-by: tool output, seed/corpus/mutant report, fault trace, or schedule log.

> **合理化检测**：如果你发现自己在想“单元测试已经全绿，所以不用运行故障或端到端测试”，停下来。单元绿只能证明被执行的局部断言成立。

### 6. Execute integration and live path `[VERIFICATION]`

For any requirement marked integration/runtime/E2E, execute at that level.
Capture entry request, relevant structured logs/traces, durable state, and final
observable result. Treat component simulation as supporting evidence only.

Verified-by: live endpoint/session/process result + logs/traces + state query.

### 7. Triage and rerun `[OBSERVATION]`

Classify every non-pass as product defect, test defect, environment defect, or
unresolved requirement. For a product fix, rerun the originally failing case,
its nearest boundary/negative case, and the impacted regression subset. Keep
the first failure evidence; do not overwrite it with a later green result.

### 8. Publish the execution report `[OBSERVATION]`

Use [EXECUTION-REPORT-TEMPLATE.md](EXECUTION-REPORT-TEMPLATE.md). A feature is
eligible for acceptance only when all in-scope critical/high cases are either
`PASS` with required evidence or explicitly accepted as open risk by the user.

## Result semantics

| Status | Meaning |
|---|---|
| PASS | Case ran; independent oracle satisfied; evidence exists. |
| FAIL | Case ran; oracle disproved expected behavior. |
| BLOCKED | Required environment/authority/data unavailable. |
| NOT-RUN | Deliberately not started; retain a reason. |
| INVALID | Specification is ambiguous, contradictory, or lacks an oracle. |

## Quality gate checklist

- [ ] Every executed case has command/request, environment ID, oracle result, and artifact.
- [ ] Critical/high requirements have required adversarial coverage or a visible gap.
- [ ] No `PASS` is inferred from static review, compilation, or absence of crash.
- [ ] Integration/runtime/live-E2E labels match the actual execution boundary.
- [ ] Test data and cleanup are isolated and reproducible.
- [ ] Failures retain first-failure evidence and a reproducible command/seed.
- [ ] Regression reruns follow each product change.

