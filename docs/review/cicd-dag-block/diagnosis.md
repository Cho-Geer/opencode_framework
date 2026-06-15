# Diagnosis: CI-CD-Agent `safe_shell git` Blocked by DAG Check

**Date**: 2026-06-14
**Author**: @Super-Admin (framework repair)
**Incident**: `COMMIT-EXECORDER-FIX-001` dispatch to `@CI-CD-Agent`
**Log evidence**: `.task_temp/_logs/2026-06-14/plugin-gate-before-runtime.log` lines 3278–3303
**Reported symptom (user)**: *"safe_shell git commands blocked because COMMIT-EXECORDER-FIX-001 is not in Task.DAG.json v5.7.0"*
**Reported diagnosis (user)**: *"Layer ③ runs an independent DAG check that only scans `dag.tasks[]` — NOT `dag.execution_order`. This is a fourth code path that was never patched."*

---

## 1. Executive Summary

**The user's diagnosis is incorrect.** There is no unpatched fourth code path. The two DAG-checking code paths that matter — `findTaskInDag()` in `gate-checks.ts` (called by the `gate-before` plugin) and `checkDagCoverage()` in `pre-execution-gate.ts` (called by the shell hook) — **both** scan `dag.tasks[]` *and* `dag.execution_order`. The patches are in place and working.

**The actual root cause is data, not code**: the task ID `COMMIT-EXECORDER-FIX-001` does **not exist anywhere** in `Task.DAG.json`. Not in `dag.tasks[]` (which is empty), and not in `dag.execution_order` (which contains only `VALIDATE-*`, `BUG-SENDCODE-*`, `B-MSG-*`, `T-RETEST-*` IDs). The `findTaskInDag()` fallback searched both structures correctly and correctly reported "not found".

There is also **no chicken-and-egg problem**. @Meta-Planner is exempt from the DAG coverage check (both in `pre-execution-gate.ts` lines 358–369 and in `gate-before.ts` line 87). The Orchestrator can dispatch @Meta-Planner to add the missing task without triggering the same gate.

---

## 2. Evidence — What the logs actually show

### 2.1 Timeline of the failing dispatch

| Timestamp | Event | Source |
|---|---|---|
| `10:32:18.943Z` | Orchestrator invokes `dispatch_subagent` for `@CI-CD-Agent` with `dag_task_id=COMMIT-EXECORDER-FIX-001` and the `--dispatch-session` flag | `dispatch.log:3799` |
| `10:32:18.972Z` | `pre-execution-gate.ts` runs for the dispatch session → `dag: "skipped"` (because of `--dispatch-session`), all other checks pass | `plugin-script-pre-execution-gate-runtime.log:35` |
| `10:32:19.007Z` | Dispatch output file created; DIAG entry registered with hash `5f6be7a89fad` | `dispatch.log:3809` |
| `10:32:48.560Z` | Orchestrator consumes the dispatch file via `Task()` → subagent session `ses_13a4f0d47ffe…` spawned | `plugin-dispatch-before-runtime.log:2852` |
| `10:33:21.427Z` | **First** `safe_shell` call by `@CI-CD-Agent` → `gate-before.ts` runs its P2-1 DAG Task Existence check → `findTaskInDag("COMMIT-EXECORDER-FIX-001")` returns `{found:false, source:"unknown"}` → `BLOCKED | DAG-TASK-NOT-FOUND` | `plugin-gate-before-runtime.log:3276–3278` |
| `10:33:26`–`10:34:12` | **Five more** `safe_shell` retries, all blocked by the same P2-1 check with the same `DAG-TASK-NOT-FOUND` detail | `plugin-gate-before-runtime.log:3279–3303` |
| `10:34:18` | `@CI-CD-Agent` pivots to non-modify tools (`read`, `grep`, `compliance_gate_confirm`) — all pass because `isModifyTool()` excludes them from the DAG check | `plugin-gate-before-runtime.log:3304–3309` |

### 2.2 The exact code path that blocked the call

The blocker lives in `.opencode/plugins/gate-before.ts` lines 65–125 (P2-1: DAG Task Existence/Status Audit):

```typescript
if (isModifyTool(input.tool)) {                  // safe_shell IS a modify tool
  const taskId = resolveTaskId();                // → "COMMIT-EXECORDER-FIX-001"
  const agentNorm = agent.toLowerCase().replace(/^@/, "");
  const isDagCreator =
    agentNorm === "orchestrator" || agentNorm === "meta-planner" || agentNorm === "super-admin";
  // ↑ CI-CD-Agent is NOT a DAG creator → gate applies

  if (taskId && !isDagCreator) {
    const tc = findTaskInDag(taskId);            // ← THE LOOKUP
    if (!tc.found) {
      // mode=strict → throw "[FW-ENFORCE][DAG] Task … not found in Task.DAG.json"
    }
  }
}
```

And `findTaskInDag()` in `.opencode/lib/gate-checks.ts` lines 86–141:

```typescript
export function findTaskInDag(taskId: string) {
  const dag = readJsonFile<any>(STATE_PATHS.dag());
  if (!dag) return { found: false, status: "unknown", source: "unknown" };

  // 1) Search tasks array first (traditional DAG structure)
  if (Array.isArray(dag.tasks)) {
    const task = dag.tasks.find((t: any) => t.id === taskId);
    if (task) return { found: true, status: task.status, source: "tasks" };
  }

  // 2) Fallback: scan execution_order groups (flat arrays + nested objects)
  const eo = dag.execution_order as Record<string, unknown> | undefined;
  if (eo) {
    for (const [groupName, group] of Object.entries(eo)) {
      if (Array.isArray(group)) {
        if (group.includes(taskId)) return { found: true, status: "pending", source: "execution_order" };
      } else if (group && typeof group === "object") {
        for (const [subName, subgroup] of Object.entries(group as Record<string, unknown>)) {
          if (Array.isArray(subgroup) && subgroup.includes(taskId)) {
            return { found: true, status: "pending", source: "execution_order" };
          }
        }
      }
    }
  }
  return { found: false, status: "unknown", source: "unknown" };
}
```

**This function scans both `tasks[]` and `execution_order`** — including nested object groups like `phase_2_parallel.backend`. The patch (`FW-FIX-EXECORDER-01`, 2026-06-14) is already in place.

### 2.3 The second DAG check is also patched

`checkDagCoverage()` in `.opencode/scripts/pre-execution-gate.ts` lines 355–447 does its own independent lookup. Since `FW-REPAIR-021` (2026-06-14), it also scans `execution_order` when `tasks[]` doesn't match:

```typescript
let task = dag.data.tasks.find((t) => t.id === taskId);

const executionOrderIds = new Set();
if (dag.data.execution_order && typeof dag.data.execution_order === "object") {
  for (const group of Object.values(dag.data.execution_order)) {
    if (Array.isArray(group)) {
      group.forEach((id) => executionOrderIds.add(id));
    }
  }
}

if (!task) {
  if (executionOrderIds.has(taskId)) return true;   // ← fallback works
  // ... emitError("Task not found (checked both tasks[] and execution_order)")
}
```

### 2.4 Other DAG helpers (not in the hot path)

`.opencode/lib/gate-core.ts` also exports three utility functions — `checkDagExists()`, `checkTaskInDag()`, `checkDagProgress()` — that only look at `dag.tasks[]`. **None of them is called by any runtime enforcement code.** They are unused helpers migrated from `framework-validation.cjs` (see `FW-ENHANCE-A2-A5-EXTRAS`):

```
$ grep -rn "checkTaskInDag\|checkDagExists\|checkDagProgress" .opencode/
.opencode/lib/gate-core.ts:1067: export function checkDagExists …
.opencode/lib/gate-core.ts:1092: export function checkTaskInDag …
.opencode/lib/gate-core.ts:1116: export function checkDagProgress …
```

Three definitions, zero call sites. These are **dead code**, not a hidden fourth path.

### 2.5 The actual state of `Task.DAG.json` at incident time

```
line 8:   "tasks": [],           ← EMPTY
line ~N:  "execution_order": {
            "validate_baseline_parallel": ["VALIDATE-SUB-BASELINE", "VALIDATE-SUB-AUDIT"],
            "validate_configs_all":       ["VALIDATE-SUB-MP-CONFIG", ...],
            ...
            "phase_0_bugfix":             ["BUG-SENDCODE-ANALYSIS"],
            "phase_0b_bugfix_red":        ["BUG-SENDCODE-RED"],
            "phase_0c_bugfix_green":      ["BUG-SENDCODE-GREEN"],
            "phase_0d_bugfix_review":     ["BUG-SENDCODE-REVIEW"],
            "phase_1_backend":            ["B-MSG-CONTRACT", "B-MSG-RED-001"],
            "phase_2_parallel": { "backend": ["B-MSG-GREEN-001"], "frontend": ["B-MSG-RED-FE"] }
          }
```

`grep -c "COMMIT-EXECORDER-FIX-001" Task.DAG.json` → **0**. The ID is absent from both structures.

---

## 3. Why the user's diagnosis was plausible but wrong

| Claim in the report | Why it seemed right | What actually happens |
|---|---|---|
| "Layer ③ runs an independent DAG check" | Correct — `gate-before.ts` is a different plugin from `pre-execution-gate.ts` | Also correct — the two are independent |
| "Layer ③ only scans `dag.tasks[]`" | Would explain the blockage IF true | **False** — `findTaskInDag()` scans `execution_order` since `FW-FIX-EXECORDER-01` |
| "This is a fourth code path that was never patched" | `gate-core.ts` has unused helpers that look like a fourth path | Those helpers are dead code (0 call sites); the only live lookup is `findTaskInDag()`, which IS patched |
| "Chicken-and-egg: fixing the gate requires going through the gate" | A real concern in some framework self-modification scenarios | **Not applicable here** — @Meta-Planner is DAG-exempt, so adding a task to the DAG never triggers the gate |

The symptom ("safe_shell git blocked … not in Task.DAG.json") is **real** and the log proves it. The *explanation* ("Layer ③ only scans `tasks[]`") is a misattribution — the log shows `BLOCKED | DAG-TASK-NOT-FOUND`, which is the correct result of a correctly-functioning lookup on a DAG that simply doesn't contain the requested ID.

---

## 4. The actual root cause — data, not code

| Layer | Status | Detail |
|---|---|---|
| Layer ① — `dispatch_subagent` tool | ✅ PASS | Orchestrator invoked it with `dag_task_id=COMMIT-EXECORDER-FIX-001` |
| Layer ② — `pre-execution-gate.ts` | ✅ PASS (skipped DAG) | `--dispatch-session` flag set → DAG coverage skipped correctly |
| Layer ③ — `gate-before.ts` P2-1 | ✅ CORRECT block | `findTaskInDag("COMMIT-EXECORDER-FIX-001")` correctly returned `{found:false, source:"unknown"}` because the ID is not in the DAG |

**The Orchestrator invented a dispatch session ID (`COMMIT-EXECORDER-FIX-001`) that @Meta-Planner never added to the DAG.** The framework is behaving correctly — the gate is doing its job by refusing to let a non-DAG task perform modify operations.

### 4.1 Why this is a data issue, not a framework bug

`dispatch_subagent.ts` uses `dag_task_id` for two distinct purposes that are **explicitly documented as the same thing**:

```typescript
dag_task_id: tool.schema.string().optional().describe(
  "Dispatch session identifier — an ID assigned to the background sub-agent " +
  "process/delegation in OpenCode. Used for output path namespacing " +
  "(.task_temp/{dag_task_id}/) and session tracking. " +
  "Passed internally as FRAMEWORK_TASK_ID env var. " +
  "NOTE: This is NOT a DAG task ID — it is a dispatch session identifier " +
  "for OpenCode's sub-agent background process. Pre-execution gate skips " +
  "DAG coverage checks when this is set (--dispatch-session flag).",
),
```

Note the tension in the description:
- *"This is NOT a DAG task ID"* — true for the pre-execution gate (which is skipped via `--dispatch-session`)
- But the `gate-before.ts` P2-1 audit treats `FRAMEWORK_TASK_ID` as a DAG task ID and enforces DAG coverage on it

This is a **contract mismatch between the two layers**, not an unpatched code path. The pre-execution gate and the gate-before plugin disagree on what `FRAMEWORK_TASK_ID` means.

---

## 5. Fix Plan

The fix has three independent prongs. Any one of them resolves the immediate incident; all three together prevent recurrence.

### Prong A — Immediate fix: add the task to the DAG (data fix, ~5 min)

**Action**: Dispatch @Meta-Planner (who is DAG-exempt) with a request to add `COMMIT-EXECORDER-FIX-001` to `Task.DAG.json.execution_order`.

```
@Meta-Planner: Please add a task entry for COMMIT-EXECORDER-FIX-001 to Task.DAG.json.
  - owner: @CI-CD-Agent
  - status: pending
  - purpose: fix execution_order-scanning logic so git commits from CI-CD-Agent
    are not blocked by the P2-1 DAG audit
```

**Why this works**: @Meta-Planner bypasses the DAG coverage check in both `pre-execution-gate.ts` (line 358) and `gate-before.ts` (line 87), so it can edit `Task.DAG.json` without triggering the same gate. Once the ID exists in `execution_order`, `findTaskInDag()` returns `{found:true, status:"pending", source:"execution_order"}` and the CI-CD-Agent's `safe_shell` calls pass.

**This is NOT a chicken-and-egg**: the repair dispatch bypasses the gate that the repair is meant to satisfy.

### Prong B — Prevent recurrence: clarify the `dag_task_id` contract (doc fix, ~15 min)

**Action**: Update the description of `dag_task_id` in `.opencode/tools/dispatch_subagent.ts` to make explicit that:

1. When `dag_task_id` is set, the ID **must already exist** in `Task.DAG.json` (either in `tasks[]` or in `execution_order`), OR
2. The caller must dispatch @Meta-Planner first to add the ID to the DAG, OR
3. The caller must use a `FRAMEWORK_TASK_ID`-exempt agent (@Orchestrator, @Meta-Planner, @Super-Admin).

Currently the description says *"This is NOT a DAG task ID"* — which is only half true. It's not a DAG task ID for the pre-execution gate, but it IS one for the P2-1 audit.

**Suggested revised description**:

```
"Dispatch session identifier. Used for: (a) output path namespacing
(.task_temp/{dag_task_id}/); (b) FRAMEWORK_TASK_ID env var, which the
pre-execution gate skips when --dispatch-session is set; AND (c) the
gate-before P2-1 DAG audit, which REQUIRES this ID to exist in
Task.DAG.json (tasks[] or execution_order). If the ID does not yet exist
in the DAG, dispatch @Meta-Planner first to add it."
```

### Prong C — Harden `findTaskInDag()` error reporting (code fix, ~20 min)

**Action**: When `findTaskInDag()` returns `{found:false}`, the error message in `gate-before.ts` line 99 currently says:

```
[FW-ENFORCE][DAG] Task "COMMIT-EXECORDER-FIX-001" not found in Task.DAG.json.
Ensure @Meta-Planner has planned this task.
```

Improve it to include the diagnostic detail that both structures were searched:

```
[FW-ENFORCE][DAG] Task "COMMIT-EXECORDER-FIX-001" not found in Task.DAG.json
(checked both dag.tasks[] and dag.execution_order). Either:
  (a) dispatch @Meta-Planner to add this task to the DAG, or
  (b) if this is a pure dispatch-session ID (not a DAG task), the caller
      must not set FRAMEWORK_TASK_ID to a value that collides with a
      non-existent DAG task.
```

This makes the mis-diagnosis the user made ("Layer ③ only scans `tasks[]`") self-evidently wrong at the point of failure.

### 5.1 Optional: delete the dead helpers in `gate-core.ts` (~10 min)

The three unused helpers (`checkDagExists`, `checkTaskInDag`, `checkDagProgress`) in `.opencode/lib/gate-core.ts` lines 1060–1126 look exactly like an "unpatched fourth code path" to anyone reading the source. They don't scan `execution_order`, they're never called, and they're the obvious suspect in a mis-diagnosis like the one in the report.

**Action**: delete them, or add an `execution_order` fallback to `checkTaskInDag()` and route `findTaskInDag()` through it. Either way removes the visual trap.

---

## 6. Risk Assessment

| Risk | Probability | Mitigation |
|---|---|---|
| Adding the task to the DAG regresses the DAG schema | Low — @Meta-Planner is the canonical DAG author and the change is additive | Run `framework-self-test.ts` and `framework-doctor.ts --strict` after the edit |
| `gate-before.ts` error-message change affects downstream parsers | Low — the message is human-facing | Grep the codebase for the old message string to confirm no parsers |
| Deleting dead `gate-core.ts` helpers breaks a future caller | Low — `grep -rn` confirms zero callers today | Keep them but deprecate with JSDoc `@deprecated` instead of deleting |
| `dag_task_id` contract clarification surfaces more blocked dispatches | Medium — any Orchestrator that was previously "lucky" (ID happened to match a DAG task) will now be explicit | This is desirable — silent correctness is worse than explicit failure |

---

## 7. Verification

After applying Prongs A + B + C:

1. Re-dispatch @CI-CD-Agent with `dag_task_id=COMMIT-EXECORDER-FIX-001`. Expected: `safe_shell` with `git add`, `git commit` passes; `plugin-gate-before-runtime.log` shows `DAG task verified | task=COMMIT-EXECORDER-FIX-001 status=pending source=execution_order`.
2. Run `bun .opencode/scripts/framework-doctor.ts --strict`. Expected: 11/11 PASS.
3. Run `bun .opencode/scripts/framework-self-test.ts`. Expected: ≥ 36/37 PASS (the 1 FAIL on Check 36 — uncommitted backups — is pre-existing).
4. Run `bun .opencode/scripts/state-integrity-scan.ts`. Expected: 0 HIGH inconsistencies.

---

## 8. Conclusion

**There is no chicken-and-egg problem, no fourth unpatched code path, and no framework regression.** The incident is a data-state issue (missing DAG entry) combined with a documentation ambiguity (what `dag_task_id` means to the two different gates). The framework's DAG lookup is working correctly — correctly reporting that a task does not exist is not the same as being broken.

Apply Prong A to unblock the immediate dispatch. Apply Prongs B and C to make the next such incident self-diagnosing.

---

## 9. Resolution (executed 2026-06-14)

All four prongs were executed, and verification surfaced two additional bugs of the same class that were patched as bonus fixes.

### Prong A — DAG entry added (data)
Added `COMMIT-EXECORDER-FIX-001` to `Task.DAG.json` inside a new `fw_fix_commit_execorder` group under `execution_order`:
```json
"fw_fix_commit_execorder": [ "COMMIT-EXECORDER-FIX-001" ]
```
JSON validity confirmed (`node -e "require('./Task.DAG.json')"` — no error).

### Prong B — `dag_task_id` contract clarified (doc)
- `.opencode/tools/dispatch_subagent.ts:197–208` — description rewritten to document the dual semantics explicitly.
- `.opencode/tools/dispatch_subagent.ts:412–428` — `DISPATCH RESULT` header now reminds the Orchestrator that the ID must exist in the DAG.

### Prong C — Error message hardened (code)
`.opencode/plugins/gate-before.ts:90–110` — the `[FW-ENFORCE][DAG]` error now:
- explicitly states **both** `dag.tasks[]` and `dag.execution_order` were searched,
- lists three actionable remediation paths (add to DAG / re-dispatch without the ID / use a DAG-exempt agent),
- links to this diagnosis document.

### Optional — Dead helpers deprecated (code)
`.opencode/lib/gate-core.ts:1060–1126` — the three unused helpers (`checkDagExists`, `checkTaskInDag`, `checkDagProgress`) now carry `@deprecated` JSDoc tags pointing to `findTaskInDag()` in `gate-checks.ts` as the live replacement. They are retained (not deleted) for backwards compatibility with any future caller.

### Bonus fixes surfaced by verification

Running `framework-doctor.ts --strict` as the first validation step surfaced **two additional bugs of the same "tasks[]-only scan" class** in offline diagnostic scripts — neither was in the runtime hot path, but both produced false HIGH/WARNING findings for sessions whose `task_id` lived in `execution_order` only.

1. **`.opencode/scripts/state-reconciliation.ts`** — three `taskMap` construction sites (`checkArmedSessionDagReference`, `checkOrphanedSessions`, `fixForceDrainOrphanedSessions`) previously only scanned `dag.tasks[]`. Extracted a shared `buildTaskMap(dag)` helper (inserted after `normalizeGateV3()` at line ~109) that scans both structures, and wired all three sites through it. Patch `FW-REPAIR-STATE-RECON-EXECORDER` (2026-06-14).

2. **`.opencode/scripts/state-integrity-scan.ts`** — the `orphaned_task_ref` check (around line 198) previously built `taskIds = new Set(dag.tasks.map(t => t.id))`. Replaced with an execution_order-aware builder that handles both flat-array groups and nested-object groups. Patch `FW-REPAIR-STATE-INTEGRITY-EXECORDER` (2026-06-14).

### Final validation

| Check | Result |
|---|---|
| `framework-doctor.ts --strict` | ✅ **11/11 PASS** (was 10/11 before the state-reconciliation fix) |
| `state-integrity-scan.ts` | ✅ **0 HIGH**, 1 WARNING (pre-existing `meta.total_tasks missing` in `Task.DAG.json` — unrelated to this incident) |
| `framework-self-test.ts` | ✅ **36/37 PASS** (the 1 FAIL on Check 36 — uncommitted backup diffs — is pre-existing and unrelated to this fix) |

### Residual cleanup

Three stale armed sessions from earlier smoke tests (`SMOKE-TEST-EXECORDER`, `DAG-GATE-SMOKE-001`, `FIX-CLOSEOUT-001`) were drained to `gate-state.drained_sessions` with `drain_reason: "manual_stale_closeout"` so that Check 4 (state reconciliation) reports clean. The `COMMIT-EXECORDER-FIX-001` session (`cg_ses_1781433201246`) remains armed and correctly references a task that now exists in the DAG.

---

## Sources

- `.opencode/plugins/gate-before.ts` — the P2-1 DAG audit (lines 65–125)
- `.opencode/lib/gate-checks.ts` — `findTaskInDag()` (lines 86–141, patch `FW-FIX-EXECORDER-01`)
- `.opencode/scripts/pre-execution-gate.ts` — `checkDagCoverage()` (lines 355–447, patch `FW-REPAIR-021`)
- `.opencode/lib/gate-core.ts` — dead helpers `checkDagExists/checkTaskInDag/checkDagProgress` (lines 1060–1126, zero callers)
- `.opencode/tools/dispatch_subagent.ts` — `dag_task_id` description (lines 197–208)
- `.task_temp/_logs/2026-06-14/plugin-gate-before-runtime.log:3276–3303` — incident log
- `.task_temp/_logs/2026-06-14/plugin-script-pre-execution-gate-runtime.log:35` — dispatch-time gate result
- `Task.DAG.json` — current DAG state (empty `tasks[]`, `execution_order` does not contain `COMMIT-EXECORDER-FIX-001`)
