# Investigation: Does `--dispatch-session` Bypass the DAG Audit for Non-Exempt Subagents?

**Date**: 2026-06-14
**Author**: @Super-Admin (framework repair)
**Scope**: read-only inspection of the two DAG-check gates to verify the user's premise. No files were modified.
**Companion**: [`diagnosis.md`](./diagnosis.md), [`flow-verification.md`](./flow-verification.md)

---

## Question (verbatim)

> If Orchestrator dispatches a subagent with the `--dispatch-session` flag, both in Pre-execution-gate and in P2-1 DAG audit, DAG audit can be bypassed for any subagent dispatch.
>
> Investigate and formulate a fix plan without breaking the 9 subsystems.

## Executive summary — the premise is **half correct**

| Gate | Does `--dispatch-session` bypass DAG audit? | Evidence |
|---|---|---|
| **Pre-execution gate** (`pre-execution-gate.ts`) | ✅ **YES** — Check 2/6 DAG Coverage and Check 3/6 Gate Lifecycle are both skipped | `pre-execution-gate.ts:963–974` |
| **P2-1 DAG audit** (`gate-before.ts`) | ❌ **NO** — there is no `--dispatch-session` branch; the audit runs unconditionally on every modify-tool call for non-DAG-exempt agents | `gate-before.ts:76–125`; `grep -c "isDispatchSession" plugins/gate-before.ts` → **0** |

`grep -c "dispatch-session" .opencode/plugins/gate-before.ts` returns exactly **1** hit, and that one hit is inside the **error message text** Prong C added — it is not a conditional branch. The string `isDispatchSession` (the variable that controls the bypass in `pre-execution-gate.ts`) does **not appear at all** in `gate-before.ts`.

So the actual state of enforcement is:

- The pre-execution gate at dispatch time is skipped for dispatch sessions (by design — dispatch-session IDs are OpenCode-internal process identifiers, not DAG task IDs).
- The gate-before plugin at tool-call time enforces DAG coverage unconditionally for any non-DAG-exempt agent whose `FRAMEWORK_TASK_ID` is set.

A non-DAG-exempt subagent (Architect, Coder-BE, Coder-FE, Guardian, Arbiter, CI-CD-Agent, Knowledge-Curator) that is dispatched with `--dispatch-session` **will still be blocked by P2-1 the first time it calls a modify tool**, exactly as the CI-CD-Agent incident demonstrated.

---

## Evidence trace

### 1. Where `--dispatch-session` IS honored

`.opencode/scripts/pre-execution-gate.ts:833–835, 964–974`:

```typescript
// Check for --dispatch-session flag (dispatch session IDs are NOT DAG task IDs)
if (process.argv.includes("--dispatch-session")) {
  isDispatchSession = true;
}
// ...
console.error("  Check 2/6 — DAG Coverage...");
if (isDispatchSession) {
  console.error(`    ⏭️  SKIPPED (--dispatch-session)`);
  checkResults.dag = "skipped";
} else if (!checkDagCoverage(taskId)) { allPassed = false; }
// ...
console.error("  Check 3/6 — Gate Lifecycle...");
if (isDispatchSession) {
  console.error(`    ⏭️  SKIPPED (--dispatch-session)`);
    checkResults.gate = "skipped";
} else if (checkGateLifecycle(taskId)) { ... }
```

This gate is invoked by `dispatch-subagent.ts:159`:
```typescript
`"${process.execPath}" "${gateScript}" "${taskId}" --dispatch-session`,
```

So **every** `dispatch_subagent` call passes `--dispatch-session`, and the pre-execution gate always skips DAG coverage for these calls. This is **by design** (documented in the tool description the user quoted).

### 2. Where `--dispatch-session` IS NOT honored

`.opencode/plugins/gate-before.ts:76–125` — the entire P2-1 block:

```typescript
if (isModifyTool(input.tool)) {
  const taskId = resolveTaskId();                       // ← reads FRAMEWORK_TASK_ID
  const agentNorm = agent.toLowerCase().replace(/^@/, "");
  const isDagCreator =
    agentNorm === "orchestrator" || agentNorm === "meta-planner" || agentNorm === "super-admin";

  if (taskId && !isDagCreator) {
    const tc = findTaskInDag(taskId);
    if (!tc.found) {
      // ... strict/locked → throw [FW-ENFORCE][DAG]
    } else if (tc.status !== "pending" && tc.status !== "in_progress") {
      // ... strict/locked → throw [FW-ENFORCE][DAG]
    }
  }
}
```

There are **only two bypass conditions**:

| Condition | Who benefits |
|---|---|
| `taskId === ""` (no `FRAMEWORK_TASK_ID` env var) | Any agent whose dispatch did not set `dag_task_id` — they lose path namespacing but are not blocked. |
| `isDagCreator === true` (agent is Orchestrator / Meta-Planner / Super-Admin) | The three DAG-exempt agents. |

No other flag, env var, session marker, or context field short-circuits P2-1. In particular:

- `process.argv.includes("--dispatch-session")` — not checked (and irrelevant in a plugin context; the plugin runs inside OpenCode's Bun runtime, not as a separate process).
- `process.env.FRAMEWORK_DISPATCH_CONTEXT === "orchestrated"` — not checked.
- `input.sessionID` being a dispatch session ID — not checked (the plugin has no way to distinguish dispatch sessions from primary sessions at this layer).
- `context.agentType` other than the three exempt agents — no bypass.

### 3. Why the user's premise seemed plausible

The dispatch tool's description says:
> *"The pre-execution gate (pre-execution-gate.ts) skips DAG coverage when `--dispatch-session` is set."*

This is **correct** for the pre-execution gate. The mistake is extrapolating to the P2-1 audit, which is a **different component** running at a **different time** in a **different process**. The tool description does not mention P2-1 because P2-1 was never designed to honor `--dispatch-session`.

The CI-CD-Agent incident (`docs/review/cicd-dag-block/diagnosis.md`) is concrete proof:
- Layer ① dispatch_subagent passed.
- Layer ② pre-execution gate passed (DAG skipped via `--dispatch-session`).
- Layer ③ P2-1 audit **blocked** `safe_shell git` calls six times in a row with `BLOCKED | DAG-TASK-NOT-FOUND`.

If `--dispatch-session` bypassed P2-1, that blockage would never have happened.

---

## The **actual** bypass paths through P2-1

| Bypass path | Who can use it | Is it a vulnerability? |
|---|---|---|
| Agent is `@Orchestrator` / `@Meta-Planner` / `@Super-Admin` | Only the three DAG-exempt agents | **No** — by design (these agents create/manage/maintain the DAG). |
| `dag_task_id` not set on the dispatch (→ `FRAMEWORK_TASK_ID` empty) | Any caller | **Sort of** — the sub-agent loses `.task_temp/{dag_task_id}/` namespacing and the audit trail, but modify tools are allowed through. This is the only genuine "hole" in the current enforcement. |
| Enforcement mode is `advisory` | Any caller | **No** — advisory mode is the explicit "warn but don't block" mode, documented in `enforcement-modes-standard.md`. In `strict` or `locked` the call throws. |
| `Task.DAG.json` is missing or unreadable | — | The `findTaskInDag()` function returns `{found:false}`, which **does** trigger the block in strict/locked mode. Not a bypass. |

The **only live bypass** that a non-exempt agent can actually exploit is "don't set `dag_task_id`". Everything else is either a documented design feature or not a bypass at all.

---

## Is a fix needed?

**For the specific claim in the question (`--dispatch-session` bypasses P2-1):** no fix is needed, because the claim is false. P2-1 already enforces DAG coverage unconditionally for non-exempt agents.

**For the genuine "don't set `dag_task_id`" bypass:** a fix may be warranted if the framework wants to guarantee that every non-exempt dispatch is backed by a DAG entry. Three options, in increasing order of intrusiveness:

### Option A — Harden P2-1 (minimal, 15 min)

Tighten the condition in `gate-before.ts:89` from `if (taskId && !isDagCreator)` to `if (!isDagCreator)`. When `taskId` is empty for a non-exempt agent in strict/locked mode, throw:

```
[FW-ENFORCE][DAG] FRAMEWORK_TASK_ID not set for non-DAG-exempt agent "@CI-CD-Agent".
Every non-exempt dispatch MUST set dag_task_id to an ID that exists in Task.DAG.json.
Remediation: dispatch @Meta-Planner first to plan the task and register the ID.
```

This closes the "don't set `dag_task_id`" hole. The trade-off is that dispatches which currently use `dag_task_id = undefined` (losing only the path-namespacing benefit) now fail hard. Audit existing dispatch patterns before enabling.

**9-subsystem impact:**
- Layout Architecture — unchanged.
- Permission Matrix — unchanged (agent allowlists unaffected).
- Concurrent session/dispatch write system — unchanged.
- Hardened enforcement — **tighter** (closes a bypass).
- Harness — `framework-self-test.ts` should add a test that P2-1 blocks non-exempt agents with empty `FRAMEWORK_TASK_ID`.
- Central state — unchanged.
- Multi-agent system — @Orchestrator must now always dispatch @Meta-Planner first for non-exempt targets.
- Log central management — new event `BLOCKED | DAG-TASK-EMPTY` added to `gate-before-runtime.log`.
- Templatization — unchanged.

### Option B — Add a pre-flight check to `dispatch_subagent.ts` (defense-in-depth, 30 min)

Before spawning the sub-agent, verify `dag_task_id` exists in the DAG when the target is non-exempt. Fail fast with a descriptive error rather than wasting a sub-agent session that will block on its first modify call:

```typescript
if (!isTargetDagExempt(args.agent_type) && args.dag_task_id) {
  const tc = findTaskInDag(args.dag_task_id);
  if (!tc.found) {
    throw new Error(
      `[FW-ENFORCE][DISPATCH-PREFLIGHT] Cannot dispatch @${args.agent_type}: ` +
      `dag_task_id "${args.dag_task_id}" is not in Task.DAG.json ` +
      `(checked both dag.tasks[] and dag.execution_order). ` +
      `Dispatch @Meta-Planner first to plan the task.`
    );
  }
}
```

This is belt-and-braces on top of P2-1: the sub-agent is never even spawned when the dispatch would block. P2-1 remains the authoritative gate; the pre-flight is a UX improvement that surfaces the error earlier.

**9-subsystem impact:** same as Option A, plus the dispatch flow now has two validation points.

### Option C — Autonomous self-healing (advanced, 90 min)

Add an optional `auto_plan: boolean` parameter to `dispatch_subagent.ts`. When the pre-flight check detects a missing DAG entry and `auto_plan` is true, the tool programmatically dispatches @Meta-Planner with a generated planning prompt, waits for the DAG to be updated, verifies the new entry, and then proceeds with the original dispatch.

Implementation sketch:
```typescript
if (auto_plan && !tc.found && !isTargetDagExempt(args.agent_type)) {
  // 1. Dispatch @Meta-Planner with "plan task X for agent Y" prompt
  // 2. Poll Task.DAG.json until dag_task_id appears (with timeout)
  // 3. Re-run findTaskInDag() to confirm
  // 4. Proceed with the original dispatch
  // 5. Log "auto-plan triggered by @Orchestrator for dag_task_id X"
}
```

This teaches @Orchestrator to self-heal without requiring it to recognize the error and manually re-dispatch @Meta-Planner. It needs:
- A guardrail: max 1 auto-plan per dispatch (prevent infinite loops).
- A guardrail: the Orchestrator's permission matrix already allows `task` to `Meta-Planner` (`"task": { "*": "deny", "Meta-Planner": "allow" }` in `opencode.json:83–86`), so the dispatch itself is authorized.
- A guardrail: audit every auto-plan invocation to `machine.json.auto_plan_history` for traceability.
- A guardrail: `auto_plan` defaults to `false` so the behavior is opt-in, preserving backward compatibility.

**9-subsystem impact:**
- Layout Architecture — unchanged.
- Permission Matrix — unchanged; the Orchestrator's existing `task.Meta-Planner = allow` covers the self-dispatch.
- Concurrent session/dispatch write system — two nested dispatches in one call; ensure FRAMEWORK_TASK_ID save/restore remains correct.
- Hardened enforcement — unchanged; the sub-dispatch to @Meta-Planner still goes through P2-1 (which exempts Meta-Planner).
- Harness — add a test that auto-plan successfully plans and then dispatches.
- Central state — new `machine.json.auto_plan_history` field; add to `machine.schema.json`.
- Multi-agent system — @Orchestrator gains the ability to trigger planning autonomously; document in `Orchestrator.md`.
- Log central management — new events `AUTO-PLAN-TRIGGERED`, `AUTO-PLAN-COMPLETED`, `AUTO-PLAN-TIMEOUT`.
- Templatization — `auto_plan` becomes a new `project.config.json` toggle under `template_resolution` so enforcement mode can gate it (e.g. `auto_plan_enabled: true` only when `develop_enforcement_mode !== "locked"`).

---

## Recommendation

The user's specific premise is **false** — no fix is required for the `--dispatch-session` bypass because that bypass does not exist. P2-1 is already tight for non-exempt agents.

If the goal is to **further harden** the dispatch pipeline so that @Orchestrator cannot accidentally dispatch a non-exempt agent without a DAG entry, the right fix is **Option A** (tighten P2-1 to block empty `FRAMEWORK_TASK_ID`) plus **Option B** (pre-flight check in `dispatch_subagent.ts`) for defense in depth.

**Option C** (autonomous self-healing) is a separate feature, not a hardening fix. It should be a follow-up ticket because it expands @Orchestrator's capabilities rather than constraining them, and it requires careful design of the auto-plan loop guardrails.

### Suggested order of execution

1. **No action needed** for the `--dispatch-session` premise — the investigation has shown P2-1 is already tight.
2. **If hardening is desired**: implement Option A (P2-1 tightening) first — smallest surface area, closes the only real bypass.
3. **If UX improvement is desired**: add Option B (pre-flight check) so the error surfaces at dispatch time, not at first modify-tool call.
4. **If autonomous planning is desired**: implement Option C as a separate feature, gated behind a `project.config.json` toggle, with a full harness test covering the nested-dispatch lifecycle.

---

## Sources

- `.opencode/plugins/gate-before.ts` — the P2-1 DAG audit (lines 65–125); zero references to `--dispatch-session` as a bypass
- `.opencode/scripts/pre-execution-gate.ts` — the pre-execution gate (lines 963–974); the only component that honors `--dispatch-session`
- `.opencode/scripts/command-tools/dispatch-subagent.ts:159` — where `--dispatch-session` is passed
- `.opencode/tools/dispatch_subagent.ts` — where `FRAMEWORK_TASK_ID` is set/restored
- `.opencode/lib/gate-checks.ts` — `findTaskInDag()` (scans both `dag.tasks[]` and `dag.execution_order`)
- `.opencode/lib/agent-resolver.ts` — `resolveTaskId()` (reads `FRAMEWORK_TASK_ID`)
- `opencode.json:83–86` — Orchestrator's `task` permission already allows `Meta-Planner`
- `docs/review/cicd-dag-block/diagnosis.md` — the CI-CD-Agent incident that proves P2-1 is not bypassed by `--dispatch-session`
