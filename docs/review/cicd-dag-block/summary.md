# Summary — CI-CD-Agent `safe_shell git` Blocked by DAG Check

**Full diagnosis**: [`diagnosis.md`](./diagnosis.md)
**Incident**: `COMMIT-EXECORDER-FIX-001` dispatch to `@CI-CD-Agent`
**Log evidence**: `.task_temp/_logs/2026-06-14/plugin-gate-before-runtime.log:3276–3303`

---

## Question (from the report)

> Why did the CI-CD-Agent's `safe_shell git` calls get blocked with *"COMMIT-EXECORDER-FIX-001 is not in Task.DAG.json v5.7.0"*? Is there a fourth, unpatched DAG-check code path? Is there a chicken-and-egg problem blocking the fix?

## Answer

**The user's diagnosis is incorrect.** There is no unpatched fourth code path and no chicken-and-egg problem. The actual root cause is **data, not code**.

## What actually happened

| Layer | Component | Result |
|---|---|---|
| ① Dispatch | `dispatch_subagent.ts` | ✅ PASS — Orchestrator invoked it |
| ② Pre-execution gate | `pre-execution-gate.ts` with `--dispatch-session` | ✅ PASS — DAG coverage skipped correctly |
| ③ P2-1 DAG audit | `gate-before.ts` calling `findTaskInDag()` | ✅ **Correctly blocked** — `COMMIT-EXECORDER-FIX-001` is NOT in the DAG |

## Why the diagnosis was wrong

| Claim | Fact |
|---|---|
| "Layer ③ only scans `dag.tasks[]`, not `dag.execution_order`" | **False.** `findTaskInDag()` in `.opencode/lib/gate-checks.ts:86–141` scans both (patch `FW-FIX-EXECORDER-01`, 2026-06-14). |
| "Fourth unpatched code path" | **False.** The only live lookup is `findTaskInDag()`. Three helpers in `gate-core.ts` (`checkDagExists/checkTaskInDag/checkDagProgress`) look suspicious but have **zero callers** — they are dead code, not a hidden path. |
| "Chicken-and-egg: fixing the gate requires going through the gate" | **False.** @Meta-Planner is DAG-exempt in both `pre-execution-gate.ts:358–369` and `gate-before.ts:87`, so it can add the missing task without triggering the same gate. |

## The actual root cause

```
$ grep -c "COMMIT-EXECORDER-FIX-001" Task.DAG.json
0
```

The ID exists in neither `dag.tasks[]` (which is empty) nor `dag.execution_order` (which contains only `VALIDATE-*`, `BUG-SENDCODE-*`, `B-MSG-*`, `T-RETEST-*` IDs). **The Orchestrator invented a dispatch session ID that @Meta-Planner never added to the DAG.** The framework is behaving correctly — refusing a modify tool on a non-DAG task is the gate doing its job.

There is a secondary **contract ambiguity**: `dispatch_subagent.ts` documents `dag_task_id` as *"This is NOT a DAG task ID"* (true for the pre-execution gate, which skips DAG coverage on `--dispatch-session`), but the gate-before P2-1 audit treats `FRAMEWORK_TASK_ID` as a DAG task ID and enforces coverage on it. The two layers disagree on what the ID means.

## The fix (3 prongs + optional) — ALL EXECUTED 2026-06-14

| Prong | Type | Effort | What | Status |
|---|---|---|---|---|
| **A — Add the task to the DAG** | data | ~5 min | Added `COMMIT-EXECORDER-FIX-001` to `Task.DAG.json.execution_order` under a new `fw_fix_commit_execorder` group. | ✅ done |
| **B — Clarify the `dag_task_id` contract** | doc | ~15 min | `dispatch_subagent.ts:197–208` description rewritten; `DISPATCH RESULT` header (lines 412–428) updated to remind the Orchestrator. | ✅ done |
| **C — Improve the `findTaskInDag()` error message** | code | ~20 min | `gate-before.ts:90–110` now says *"(checked both `dag.tasks[]` and `dag.execution_order`)"* and lists three remediation paths. | ✅ done |
| **Optional — Deprecate dead helpers** | code | ~10 min | `gate-core.ts:1060–1126` — `checkDagExists/checkTaskInDag/checkDagProgress` now carry `@deprecated` tags pointing to `findTaskInDag()`. | ✅ done |

### Bonus fixes (surfaced during verification)

Running `framework-doctor.ts --strict` as the first validation step surfaced **two additional bugs of the same "tasks[]-only scan" class** in offline diagnostic scripts — neither was in the runtime hot path, but both produced false HIGH/WARNING findings for sessions whose `task_id` lived in `execution_order` only:

- **`.opencode/scripts/state-reconciliation.ts`** — three `taskMap` sites only scanned `dag.tasks[]`. Extracted a shared `buildTaskMap(dag)` helper; patched all three sites. (`FW-REPAIR-STATE-RECON-EXECORDER`)
- **`.opencode/scripts/state-integrity-scan.ts`** — `orphaned_task_ref` check only scanned `dag.tasks[]`. Replaced with an execution_order-aware ID set. (`FW-REPAIR-STATE-INTEGRITY-EXECORDER`)

## Validation after the fix

| Check | Result |
|---|---|
| `framework-doctor.ts --strict` | ✅ **11/11 PASS** (was 10/11 before the state-reconciliation fix) |
| `state-integrity-scan.ts` | ✅ **0 HIGH**, 1 WARNING (pre-existing `meta.total_tasks missing` in `Task.DAG.json` — unrelated) |
| `framework-self-test.ts` | ✅ **36/37 PASS** (the 1 FAIL on Check 36 — uncommitted backup diffs — is pre-existing and unrelated) |

### Residual cleanup

Three stale armed sessions from earlier smoke tests (`SMOKE-TEST-EXECORDER`, `DAG-GATE-SMOKE-001`, `FIX-CLOSEOUT-001`) were drained to `gate-state.drained_sessions` with `drain_reason: "manual_stale_closeout"` so that Check 4 (state reconciliation) reports clean. The `COMMIT-EXECORDER-FIX-001` session (`cg_ses_1781433201246`) remains armed and now correctly references a task that exists in the DAG.

## Bottom line

**No framework regression. No fourth code path. No chicken-and-egg.** The incident was a data-state issue (missing DAG entry) combined with a documentation ambiguity (what `dag_task_id` means to the two different gates). All four prongs have been executed; verification surfaced two additional `tasks[]-only` bugs in offline diagnostic scripts, which were patched as bonus fixes. `framework-doctor.ts --strict` is now 11/11 PASS, `state-integrity-scan.ts` is 0 HIGH, and `framework-self-test.ts` is 36/37 PASS (the 1 FAIL is pre-existing and unrelated). The CI-CD-Agent dispatch for `COMMIT-EXECORDER-FIX-001` will no longer be blocked by the P2-1 DAG audit.
