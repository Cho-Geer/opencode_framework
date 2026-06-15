# Flow Verification: CI-CD-Agent Dispatch with `dag_task_id` After the Fix

**Date**: 2026-06-14
**Companion**: [`diagnosis.md`](./diagnosis.md), [`summary.md`](./summary.md)
**Scope**: read-only inspection of the dispatch → sub-agent → `safe_shell` flow after the four-prong fix. No files were modified for this analysis.

---

## Question

> After the fix, does this flow pass correctly?
> 1. Orchestrator calls `dispatch_subagent(agent_type="CI-CD-Agent", task_description=..., dag_task_id="COMMIT-EXECORDER-FIX-002")`
> 2. Sub-agent session starts.
> 3. Sub-agent calls `safe_shell` with `git add` / `git commit`.
>
> And how does `--dispatch-session` factor in? The dispatch tool's description says *"the pre-execution gate skips DAG coverage when --dispatch-session is set"* — so does the sub-agent's `safe_shell` call even reach the P2-1 audit?

---

## Answer — conditional on the exact `dag_task_id` value

| Dispatch `dag_task_id` | Will `safe_shell git` pass? | Reason |
|---|---|---|
| `"COMMIT-EXECORDER-FIX-001"` | ✅ **yes** | We added this exact ID to `Task.DAG.json.execution_order.fw_fix_commit_execorder` in Prong A. |
| `"COMMIT-EXECORDER-FIX-002"` | ❌ **no** | Not in the DAG. The gate-before P2-1 audit requires an **exact** ID match — no prefix/wildcard, no fuzzy match. Same blockage pattern as the original incident. |
| any other ID | ❌ **no** | Unless the ID exists somewhere in `dag.tasks[]` or `dag.execution_order` before the dispatch. |

The fix was surgical — it added exactly one ID (`COMMIT-EXECORDER-FIX-001`) to the DAG. It did **not** introduce any kind of auto-registration, prefix matching, or wildcard allowance. Every new dispatch still needs a DAG entry (or a DAG-exempt agent).

---

## Why the `--dispatch-session` flag doesn't help the sub-agent's `safe_shell` call

There are **two separate gates**, and `--dispatch-session` only affects one of them:

| Gate | File | When it runs | Does `--dispatch-session` skip DAG coverage? |
|---|---|---|---|
| **Pre-execution gate** | `scripts/pre-execution-gate.ts` (invoked by `dispatch-subagent.ts` via `execFileSync`) | **At dispatch time** — before the sub-agent session is created | ✅ yes (Check 2/6 DAG Coverage is skipped) |
| **P2-1 DAG audit** | `plugins/gate-before.ts` (invoked by OpenCode as a `tool.execute.before` plugin) | **On every modify-tool call** inside the sub-agent session (e.g. `safe_shell`, `safe_edit`, `safe_mkdir`, `safe_delete`) | ❌ **no** — no such flag; it unconditionally calls `findTaskInDag(FRAMEWORK_TASK_ID)` |

The dispatch tool's description is technically correct but easy to mis-read: the skip applies to the **pre-execution gate at dispatch time**, not to the **gate-before plugin at tool-call time**. The two gates have different responsibilities:

- The pre-execution gate is a one-shot shell hook that validates the dispatch itself is legitimate.
- The gate-before plugin is a per-tool-call audit that validates every modify operation inside the session.

The sub-agent inherits `FRAMEWORK_TASK_ID` from the parent (because Bun propagates `process.env` to child processes spawned by `Task()`), so the gate-before plugin sees the same ID the Orchestrator set on `dispatch_subagent`, regardless of the `--dispatch-session` flag.

---

## Trace: the exact code path for a `safe_shell git` call

### Step 1 — Orchestrator calls `dispatch_subagent`

```typescript
// .opencode/tools/dispatch_subagent.ts:221–223
const savedTaskId = process.env.FRAMEWORK_TASK_ID;
process.env.FRAMEWORK_DISPATCH_CONTEXT = "orchestrated";
if (args.dag_task_id) process.env.FRAMEWORK_TASK_ID = args.dag_task_id;
```

`FRAMEWORK_TASK_ID` is set to whatever `dag_task_id` the Orchestrator passed in.

### Step 2 — `dispatch_subagent` spawns `dispatch-subagent.ts` via `execFileSync`

```typescript
// .opencode/tools/dispatch_subagent.ts:386–399
const stdout = execFileSync(
  "bun",
  ["--no-cache", scriptPath, ...scriptArgs],
  {
    encoding: "utf8",
    timeout: 60000,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,                                        // ← FRAMEWORK_TASK_ID propagates
      DISPATCH_TASK_DESC: args.task_description,
      ...(dagTaskId ? { FRAMEWORK_TASK_ID: dagTaskId } : {}), // ← set again explicitly
    },
  },
);
```

The child `dispatch-subagent.ts` process inherits `FRAMEWORK_TASK_ID`.

### Step 3 — `dispatch-subagent.ts` calls `pre-execution-gate.ts` with `--dispatch-session`

```typescript
// .opencode/scripts/command-tools/dispatch-subagent.ts:154,159
`Running pre-execution-gate.ts for dispatch session '${taskId}' (--dispatch-session)...`,
`"${process.execPath}" "${gateScript}" "${taskId}" --dispatch-session`,
```

`pre-execution-gate.ts:964–968` sees the flag and skips Check 2/6 DAG Coverage:

```typescript
console.error("  Check 2/6 — DAG Coverage...");
if (isDispatchSession) {
  console.error(`    ⏭️  SKIPPED (--dispatch-session)`);
  checkResults.dag = "skipped";
}
```

Pre-execution gate passes. Dispatch file is written.

### Step 4 — Orchestrator reads the dispatch file and calls `Task()`

The sub-agent session is spawned. `FRAMEWORK_TASK_ID` is still set in the Orchestrator's `process.env`, and the sub-agent's Bun runtime inherits it.

### Step 5 — `dispatch_subagent.ts` restores `FRAMEWORK_TASK_ID` on the Orchestrator side

```typescript
// .opencode/tools/dispatch_subagent.ts:432–437
} finally {
  if (savedTaskId === undefined) {
    delete process.env.FRAMEWORK_TASK_ID;
  } else {
    process.env.FRAMEWORK_TASK_ID = savedTaskId;
  }
}
```

This restores the Orchestrator's env. It does **not** affect the already-spawned sub-agent's env — the sub-agent captured `FRAMEWORK_TASK_ID` at spawn time.

### Step 6 — Sub-agent calls `safe_shell` with `git add`

OpenCode invokes the `gate-before` plugin before the tool executes.

```typescript
// .opencode/plugins/gate-before.ts:45
if (isModifyTool(input.tool)) {          // safe_shell IS a modify tool
  // ... compliance gate armed check (layer 2) ...
}
// ...
// .opencode/plugins/gate-before.ts:76–89
if (isModifyTool(input.tool)) {
  const taskId = resolveTaskId();        // ← reads FRAMEWORK_TASK_ID
  const agentNorm = agent.toLowerCase().replace(/^@/, "");
  const isDagCreator =
    agentNorm === "orchestrator" || agentNorm === "meta-planner" || agentNorm === "super-admin";
  // CI-CD-Agent is NOT a DAG creator → gate applies

  if (taskId && !isDagCreator) {
    const tc = findTaskInDag(taskId);    // ← the live lookup
    if (!tc.found) {
      // strict/locked → throw "[FW-ENFORCE][DAG] Task … not found in Task.DAG.json
      // (checked both dag.tasks[] and dag.execution_order)"
    }
  }
}
```

`resolveTaskId()` reads `FRAMEWORK_TASK_ID` (`.opencode/lib/agent-resolver.ts:96–98`):

```typescript
export function resolveTaskId(): string {
  const envId = process.env.FRAMEWORK_TASK_ID || "";
  if (envId) return envId;
  // ...fallbacks...
}
```

`findTaskInDag()` scans BOTH `dag.tasks[]` and `dag.execution_order` (patched in `FW-FIX-EXECORDER-01`):

```typescript
// .opencode/lib/gate-checks.ts:95–138
if (Array.isArray(dag.tasks)) {
  const task = dag.tasks.find((t: any) => t.id === taskId);
  if (task) return { found: true, status: task.status, source: "tasks" };
}
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
```

### Step 7 — Outcome

| DAG state for the ID | `findTaskInDag` returns | P2-1 result |
|---|---|---|
| ID in `tasks[]` with status `"pending"` | `{ found: true, status: "pending", source: "tasks" }` | ✅ PASS — `safe_shell` executes |
| ID in `tasks[]` with status `"in_progress"` | `{ found: true, status: "in_progress", source: "tasks" }` | ✅ PASS |
| ID in `execution_order` group | `{ found: true, status: "pending", source: "execution_order" }` | ✅ PASS |
| ID in neither | `{ found: false, status: "unknown", source: "unknown" }` | ❌ BLOCKED |

For the fix-added ID `COMMIT-EXECORDER-FIX-001` (in `execution_order.fw_fix_commit_execorder`), the second row applies → **PASS**.

For `COMMIT-EXECORDER-FIX-002` (not in the DAG), the last row applies → **BLOCKED** with the new self-diagnosing error message:

```
[FW-ENFORCE][DAG] Task "COMMIT-EXECORDER-FIX-002" not found in Task.DAG.json
(checked both dag.tasks[] and dag.execution_order — neither contains this ID).
The FRAMEWORK_TASK_ID passed to dispatch_subagent is treated as a DAG task ID by this audit.
Remediation — pick ONE:
  1. Have @Meta-Planner add "COMMIT-EXECORDER-FIX-002" to Task.DAG.json (tasks[] or execution_order group).
  2. If this is a pure dispatch-session ID (not a real DAG task), re-dispatch without setting dag_task_id,
     or choose a value that does not collide with a non-existent DAG task.
  3. Use a DAG-exempt agent (@Orchestrator / @Meta-Planner / @Super-Admin) for this dispatch.
See docs/review/cicd-dag-block/diagnosis.md for the full analysis.
```

---

## Summary

**The flow will pass correctly if and only if the `dag_task_id` the Orchestrator passes to `dispatch_subagent` already exists in `Task.DAG.json`** — either in `tasks[]` or in any `execution_order` group. The fix added `COMMIT-EXECORDER-FIX-001`; it did not add any wildcard or auto-registration capability.

The `--dispatch-session` flag is a red herring for this question: it skips the **pre-execution gate at dispatch time**, not the **gate-before plugin at tool-call time**. The gate-before plugin is what actually blocks `safe_shell`, and it enforces DAG coverage unconditionally for non-DAG-exempt agents.

To make a new dispatch (e.g. `COMMIT-EXECORDER-FIX-002`) pass:
1. Have @Meta-Planner add the ID to `Task.DAG.json` (DAG-exempt — no chicken-and-egg), or
2. Dispatch @CI-CD-Agent without setting `dag_task_id` (loses the path-namespacing benefit), or
3. Use a DAG-exempt agent for the dispatch (changes the agent role).
