# Redesign: PLAN-FIRST Dispatch Constraint for Non-DAG-Exempt Subagents

**Date**: 2026-06-14
**Author**: @Super-Admin (framework architect)
**Status**: DESIGN PROPOSAL — not yet implemented
**Supersedes**: the "three options" sketch in [`dispatch-session-bypass-investigation.md`](./dispatch-session-bypass-investigation.md)
**Companion**: [`diagnosis.md`](./diagnosis.md), [`flow-verification.md`](./flow-verification.md)

---

## 1. Design goal (verbatim from the user)

> Make dispatching Meta-Planner to create a task DAG before dispatching CI-CD-Agent a hardened enforcement constraint that could not be bypassed by Orchestrator, and also let Orchestrator know autonomously to dispatch Meta-Planner to create a corresponding task when the incident happens. Generalize to **all non-DAG-exempt subagents** (Architect, Coder-BE, Coder-FE, Guardian, Arbiter, CI-CD-Agent, Knowledge-Curator). Preserve the 9 framework subsystems.

Two properties are required:

1. **Unbypassable constraint** — the Orchestrator cannot dispatch a non-DAG-exempt subagent unless a corresponding task entry has been planned into `Task.DAG.json` by @Meta-Planner first.
2. **Autonomous self-healing** — when the constraint would block, the Orchestrator can trigger the framework to auto-dispatch @Meta-Planner, wait for the plan to land in the DAG, and then proceed with the original dispatch — all inside a single `dispatch_subagent` call.

The previous sketch treated these as independent options. The redesign **fuses them**: the constraint is hard-enforced at three independent layers, and self-healing is a controlled relaxation gated by a framework-level policy that the Orchestrator can invoke but cannot override.

---

## 2. Architecture overview

```
                       ┌─────────────────────────────────────────────┐
                       │           Orchestrator (caller)             │
                       └─────────────────┬───────────────────────────┘
                                         │ dispatch_subagent(agent_type=X,
                                         │   dag_task_id=ID, auto_plan=?)
                                         ▼
                       ┌─────────────────────────────────────────────┐
                       │  LAYER 1 — plugin hook                      │
                       │  dispatch-before.ts :: tool.execute.before  │
                       │  Reads dispatch_policy from project.config  │
                       │  Rejects if caller is not Orchestrator      │
                       └─────────────────┬───────────────────────────┘
                                         │
                                         ▼
                       ┌─────────────────────────────────────────────┐
                       │  LAYER 2 — tool-level pre-flight            │
                       │  dispatch_subagent.ts                       │
                       │   • if target ∈ DAG-exempt → allow          │
                       │   • else findTaskInDag(ID) must succeed     │
                       │   • else if auto_plan=true → self-heal      │
                       │   • else throw [FW-ENFORCE][PLAN-FIRST]     │
                       └─────────────────┬───────────────────────────┘
                                         │
                                         ▼
                       ┌─────────────────────────────────────────────┐
                       │  LAYER 3 — sub-agent tool-call audit        │
                       │  gate-before.ts :: P2-1 DAG audit           │
                       │  (unchanged — remains the authoritative     │
                       │  defense-in-depth check at modify-tool time)│
                       └─────────────────┬───────────────────────────┘
                                         │
                                         ▼
                       ┌─────────────────────────────────────────────┐
                       │  Sub-agent session for X                    │
                       └─────────────────────────────────────────────┘
```

**Why three layers, not one.**
- Layer 1 (plugin hook) is **policy-driven** — reads `project.config.json.dispatch_policy` and is enforced by the framework-enforcer as an untamperable plugin.
- Layer 2 (tool pre-flight) is **unconditional code** — runs for every caller, reads the DAG directly, cannot be disabled by config.
- Layer 3 (P2-1 at tool-call time) is **defense in depth** — even if an Orchestrator somehow bypasses layers 1 and 2 (it can't, but assume it could), the sub-agent's first modify call is still blocked.

Any one layer is sufficient; three layers make the constraint robust against future changes in any single component.

---

## 3. The DAG-exempt set (single source of truth)

Currently the exempt set is duplicated in three places with slightly different contents:

| Location | Current exempt set |
|---|---|
| `gate-before.ts:87` | `orchestrator`, `meta-planner`, `super-admin` |
| `pre-execution-gate.ts:360–362` | `Meta-Planner`, `Orchestrator`, `Knowledge-Curator` |
| `dispatch_subagent.ts` (ad-hoc) | `Meta-Planner`, `Orchestrator`, `Super-Admin` (handled case-by-case) |

**The redesign consolidates this into one canonical list** exported from a new file `.opencode/lib/dag-policy.ts`:

```typescript
// .opencode/lib/dag-policy.ts
export const DAG_EXEMPT_AGENTS = Object.freeze([
  "meta-planner",    // creates the DAG
  "orchestrator",    // manages the DAG
  "super-admin",     // framework maintenance outside DAG
]);

export function isDagExempt(agent: string): boolean {
  const normalized = agent.toLowerCase().replace(/^@/, "");
  return DAG_EXEMPT_AGENTS.includes(normalized);
}
```

**Note**: `Knowledge-Curator` is removed from the exempt set. In the current system it is exempt from the *pre-execution gate* (because UC7KS dispatches are not DAG tasks), but P2-1 still requires a DAG entry for modify tools. The redesign keeps that behavior and makes it explicit: Knowledge-Curator dispatches go through `--dispatch-session` (pre-execution skipped) but are **subject to P2-1** when they call modify tools. If the framework wants Knowledge-Curator to be fully exempt, add it to `DAG_EXEMPT_AGENTS` deliberately, with a documented reason.

All three existing gate locations are refactored to import `isDagExempt()` from `dag-policy.ts` instead of maintaining their own lists.

---

## 4. Layer 1 — `dispatch-before.ts` plugin hook

New plugin file `.opencode/plugins/dispatch-before.ts`:

```typescript
// dispatch-before.ts — "tool.execute.before" for dispatch_subagent
import { writeLog, updateIndex, ensureLogDir } from "../lib/log-manager";
import { resolveAgent } from "../lib/agent-resolver";
import { getEnforcementMode } from "../lib/gate-core";
import { isDagExempt, readDispatchPolicy } from "../lib/dag-policy";
import { findTaskInDag } from "../lib/gate-checks";

ensureLogDir();
writeLog("dispatch-before", "loaded", { event: "PLUGIN-LOADED", detail: "dispatch-before.ts" });
updateIndex("dispatch-before", "PLUGIN-LOADED");

export default (async (_ctx: any) => {
  writeLog("dispatch-before", "hooks", {
    event: "HOOK-REGISTERED", detail: "tool.execute.before (dispatch_subagent)",
  });
  return { "tool.execute.before": dispatchExecuteBefore };
}) as any;

async function dispatchExecuteBefore(input: any, output: any): Promise<void> {
  if (input.tool !== "dispatch_subagent") return;  // only intercept dispatches

  const caller = resolveAgent(input.sessionID);
  const mode = getEnforcementMode();
  const policy = readDispatchPolicy();

  writeLog("dispatch-before", "runtime", {
    sessionID: input.sessionID, callID: input.callID,
    event: "DISPATCH-BEFORE",
    detail: `enter | caller=${caller} | target=${output.args.agent_type} ` +
            `| dag_task_id=${output.args.dag_task_id || ""} ` +
            `| auto_plan=${output.args.auto_plan === true} | mode=${mode}`,
  });

  // Gate: only @Orchestrator should dispatch non-exempt agents,
  // but we enforce the DAG-existence rule regardless of caller.
  const target = output.args.agent_type || "";
  const dagTaskId = output.args.dag_task_id || "";

  if (isDagExempt(target)) {
    writeLog("dispatch-before", "runtime", {
      event: "DISPATCH-BEFORE", detail: `exit (pass) | target is DAG-exempt`,
    });
    return;
  }

  if (!policy.require_dag_entry) {
    // Policy allows dispatches without DAG entries (advisory setups only).
    writeLog("dispatch-before", "runtime", {
      event: "DISPATCH-BEFORE",
      level: "WARN",
      detail: `exit (pass) | dispatch_policy.require_dag_entry=false`,
    });
    return;
  }

  if (!dagTaskId) {
    // Empty dag_task_id is treated as "no DAG entry" — blocked under strict policy.
    if (mode === "strict" || mode === "locked") {
      throw new Error(
        `[FW-ENFORCE][PLAN-FIRST][LAYER-1] dispatch_subagent to @${target} ` +
          `requires a dag_task_id that exists in Task.DAG.json. ` +
          `Dispatch @Meta-Planner first to plan the task, or set auto_plan=true ` +
          `to let the framework plan automatically.`
      );
    }
    return;
  }

  const tc = findTaskInDag(dagTaskId);
  if (!tc.found) {
    // Layer 1 blocks the dispatch. Layer 2 will re-verify as defense in depth.
    if (mode === "strict" || mode === "locked") {
      throw new Error(
        `[FW-ENFORCE][PLAN-FIRST][LAYER-1] dag_task_id "${dagTaskId}" not found ` +
          `in Task.DAG.json (checked both dag.tasks[] and dag.execution_order). ` +
          `Dispatch @Meta-Planner first to plan the task, or set auto_plan=true.`
      );
    }
  }
  // Status check: pending or in_progress required (completed tasks cannot be re-dispatched)
  else if (tc.status !== "pending" && tc.status !== "in_progress") {
    if (mode === "strict" || mode === "locked") {
      throw new Error(
        `[FW-ENFORCE][PLAN-FIRST][LAYER-1] dag_task_id "${dagTaskId}" has status ` +
          `"${tc.status}"; expected "pending" or "in_progress".`
      );
    }
  }
}
```

**Unbypassability argument**: this is a registered `tool.execute.before` plugin. The OpenCode runtime invokes it before the tool's `execute` function runs. If it throws, the tool never executes. The Orchestrator cannot deregister plugins (that requires modifying `.opencode/plugins/`, which its permission matrix denies via `safe_edit: .opencode/**: deny`).

---

## 5. Layer 2 — tool-level pre-flight in `dispatch_subagent.ts`

Add the following block immediately after `savedTaskId = process.env.FRAMEWORK_TASK_ID`:

```typescript
// ── LAYER 2: PLAN-FIRST pre-flight ──
// Runs BEFORE the execFileSync() that spawns dispatch-subagent.ts.
// Defense-in-depth: even if Layer 1 is misconfigured or bypassed, this
// code rejects dispatches to non-DAG-exempt agents without a DAG entry.
import { isDagExempt, readDispatchPolicy, autoPlan } from "../lib/dag-policy";
import { findTaskInDag } from "../lib/gate-checks";

const targetAgent = args.agent_type || "";
const dagTaskId = args.dag_task_id || "";
const policy = readDispatchPolicy();

if (!isDagExempt(targetAgent) && policy.require_dag_entry) {
  if (!dagTaskId) {
    throw new Error(
      `[FW-ENFORCE][PLAN-FIRST][LAYER-2] dispatch_subagent to @${targetAgent} ` +
        `requires dag_task_id. Either provide a planned DAG ID or set auto_plan=true.`
    );
  }
  let tc = findTaskInDag(dagTaskId);
  if (!tc.found) {
    if (args.auto_plan === true && policy.auto_plan_enabled) {
      // Autonomous self-healing: dispatch @Meta-Planner, poll, re-check.
      const planned = await autoPlan({
        dagTaskId,
        targetAgent,
        taskDescription: args.task_description,
        timeoutMs: policy.auto_plan_timeout_ms,
        callerSession: context.sessionID,
      });
      if (!planned) {
        throw new Error(
          `[FW-ENFORCE][PLAN-FIRST][LAYER-2] auto_plan failed for dag_task_id ` +
            `"${dagTaskId}" after ${policy.auto_plan_timeout_ms}ms. ` +
            `Dispatch @Meta-Planner manually.`
        );
      }
      tc = findTaskInDag(dagTaskId);  // re-verify
    }
    if (!tc.found) {
      throw new Error(
        `[FW-ENFORCE][PLAN-FIRST][LAYER-2] dag_task_id "${dagTaskId}" not in ` +
          `Task.DAG.json after pre-flight. Dispatch @Meta-Planner first.`
      );
    }
  }
  // Audit: record that this dispatch passed PLAN-FIRST
  logDispatchPreFlight({
    caller: context.agent, target: targetAgent,
    dag_task_id: dagTaskId, source: tc.source, status: tc.status,
    auto_plan_used: args.auto_plan === true,
  });
}
```

**Unbypassability argument**: this code is inside the tool's `execute` function. The Orchestrator cannot skip it without modifying the tool, which its permission matrix denies.

---

## 6. The `auto_plan` self-healing flow

```typescript
// .opencode/lib/dag-policy.ts (continued)

export async function autoPlan(opts: {
  dagTaskId: string;
  targetAgent: string;
  taskDescription: string;
  timeoutMs: number;
  callerSession: string;
}): Promise<boolean> {
  const startedAt = Date.now();

  // 1. Record intent in machine.json.auto_plan_history (audit trail).
  recordAutoPlanAttempt(opts);

  // 2. Check rate limit.
  const policy = readDispatchPolicy();
  const attemptsThisSession = countAutoPlanAttempts(opts.callerSession);
  if (attemptsThisSession >= policy.auto_plan_max_per_session) {
    recordAutoPlanFailure(opts, "rate_limited");
    return false;
  }

  // 3. Synthesize a planning prompt.
  const planningPrompt = synthesizePlanningPrompt(opts);

  // 4. Dispatch @Meta-Planner via the tool's own mechanism.
  //    Meta-Planner is DAG-exempt, so the dispatch bypasses this check.
  //    The sub-agent runs in background; we poll the DAG for the new entry.
  const dispatchResult = await dispatchSubagentInternal({
    agent_type: "Meta-Planner",
    task_description: planningPrompt,
    dag_task_id: `PLAN-${opts.dagTaskId}`,  // distinct ID for the planning dispatch
    background: true,
  });

  // 5. Poll Task.DAG.json until dag_task_id appears or timeout.
  const pollInterval = 1000;
  while (Date.now() - startedAt < opts.timeoutMs) {
    await new Promise(r => setTimeout(r, pollInterval));
    const tc = findTaskInDag(opts.dagTaskId);
    if (tc.found && (tc.status === "pending" || tc.status === "in_progress")) {
      recordAutoPlanSuccess(opts, Date.now() - startedAt);
      return true;
    }
  }

  recordAutoPlanFailure(opts, "timeout");
  return false;
}
```

### 6.1 The planning prompt template

```markdown
# Planning request — auto-generated by PLAN-FIRST self-healing

## Required output
Add the following task to `Task.DAG.json` (either in `tasks[]` or in an
appropriate `execution_order` group):

- **task_id**: `${dagTaskId}`
- **owner**: `@${targetAgent}`
- **status**: `pending`
- **description**: ${taskDescription}
- **dependencies**: []  (unless inferable from description)
- **acceptance_criteria**: derive from description

## Constraints
- Do NOT change any other task in the DAG.
- Do NOT modify `project.config.json`, `opencode.json`, or any plugin file.
- Write only to `Task.DAG.json` and your `.task_temp/PLAN-${dagTaskId}/` directory.
- Produce a HANDOVER.md summarizing what you added.
```

### 6.2 Rate-limit and audit

Every auto-plan invocation is recorded in `machine.json.auto_plan_history`:

```json
{
  "auto_plan_history": [
    {
      "timestamp": "2026-06-14T12:00:00Z",
      "caller_session": "ses_xxx",
      "caller_agent": "@Orchestrator",
      "target_agent": "@CI-CD-Agent",
      "dag_task_id": "COMMIT-EXECORDER-FIX-002",
      "planning_dispatch_id": "PLAN-COMMIT-EXECORDER-FIX-002",
      "status": "success" | "timeout" | "rate_limited",
      "elapsed_ms": 12345
    }
  ]
}
```

This creates an immutable audit trail the Orchestrator cannot scrub (its `safe_edit` permission matrix denies `.opencode/state/**`).

---

## 7. The `dispatch_policy` in `project.config.json`

```jsonc
"dispatch_policy": {
  // Master switch: when true, non-DAG-exempt dispatches require a DAG entry.
  // Orchestrator cannot override this — it is read by the plugin and the tool.
  "require_dag_entry": true,

  // Self-healing: when true and a dispatch would block on a missing DAG entry,
  // the framework auto-dispatches @Meta-Planner to plan the task first.
  // Must be false in locked mode (human-in-the-loop required).
  "auto_plan_enabled": true,

  // Per-session rate limit — prevents runaway auto-plan loops.
  "auto_plan_max_per_session": 5,

  // Per-attempt timeout — bounds the planning sub-agent's execution time.
  "auto_plan_timeout_ms": 120000
}
```

**Hardening**: `framework-enforcer.ts` gains a new check (`DISPATCH-POLICY-TAMPER`) that rejects any edit to the `dispatch_policy` block from a non-@Super-Admin session. The Orchestrator's existing `safe_edit: .opencode/**: deny` already denies direct edits to `project.config.json`; this is a belt-and-braces check.

**Templatization alignment**: the block sits under `project.config.json`'s top level alongside `template_resolution`. Environments can override it via the standard `{env:...}` substitution mechanism, so CI vs. local dev can have different policies (e.g. `auto_plan_enabled: false` in CI to force explicit planning).

---

## 8. Alignment with the 9 framework subsystems

| # | Subsystem | How the redesign aligns |
|---|---|---|
| **S1** | Layout Architecture | New file `.opencode/lib/dag-policy.ts` (policy + helpers); new file `.opencode/plugins/dispatch-before.ts` (Layer 1 plugin); `dispatch_subagent.ts` gains pre-flight block. All inside existing directories; no structural change. |
| **S2** | Permission Matrix | No changes to `opencode.json` agent permissions — the Orchestrator's existing `task.Meta-Planner = allow` already authorizes the self-healing sub-dispatch. Orchestrator's `safe_edit: .opencode/**: deny` already prevents tool/plugin tampering. |
| **S3** | Concurrent session/dispatch write system | The planning sub-dispatch uses a distinct `dag_task_id = PLAN-<original>` so it doesn't collide with the original dispatch in the FIFO queue. `FRAMEWORK_TASK_ID` save/restore in `dispatch_subagent.ts` already handles the outer dispatch correctly. |
| **S4** | Hardened enforcement | Three independent enforcement layers (plugin / tool / P2-1). `framework-enforcer.ts` gains `DISPATCH-POLICY-TAMPER` check. Policy is enforced in strict/locked modes; advisory mode retains the warn-but-don't-block semantics documented in `enforcement-modes-standard.md`. |
| **S5** | Harness | `framework-self-test.ts` gains three new checks: (a) Layer-1 plugin registered and active; (b) Layer-2 pre-flight rejects a test dispatch to a non-exempt agent with missing DAG entry; (c) auto-plan rate limit honored. `framework-doctor.ts` gains Check 12 (dispatch-policy consistency). |
| **S6** | Central state | New field `machine.json.auto_plan_history` (audit trail) and `machine.json.dispatch_history` (per-dispatch outcome log). `machine.schema.json` extended to include both. `state-integrity-scan.ts` gains a check that auto_plan_history entries have matching DAG entries. |
| **S7** | Multi-agent system | `Orchestrator.md` gains a new section "PLAN-FIRST dispatch protocol" documenting: (a) always plan-then-dispatch for non-exempt agents; (b) set `auto_plan=true` to delegate planning to the framework; (c) how to interpret `[FW-ENFORCE][PLAN-FIRST]` errors. `AGENTS.md` gains the same protocol at the global level. |
| **S8** | Log central management | New events: `DISPATCH-BEFORE`, `DISPATCH-PRE-FLIGHT`, `AUTO-PLAN-ATTEMPT`, `AUTO-PLAN-SUCCESS`, `AUTO-PLAN-FAILURE`, `AUTO-PLAN-RATE-LIMITED`, `AUTO-PLAN-TIMEOUT`. All flow through `writeLog()` to `.task_temp/_logs/<date>/plugin-dispatch-before-runtime.log` and `plugin-dispatch-subagent-runtime.log`. |
| **S9** | Templatization | `dispatch_policy` is a new top-level block in `project.config.json`, documented in `TEMPLATE_VARIABLE_STANDARD.md`. Fields can reference `{env:...}` substitutions. The planning prompt template is templatized (task_id, target_agent, description are placeholders) so the framework can substitute any values. |

---

## 9. Concrete file changes

| File | Change type | Size estimate |
|---|---|---|
| `.opencode/lib/dag-policy.ts` | **NEW** — exports `DAG_EXEMPT_AGENTS`, `isDagExempt()`, `readDispatchPolicy()`, `autoPlan()`, `recordAutoPlan*()` helpers, planning-prompt synthesizer. | ~200 lines |
| `.opencode/plugins/dispatch-before.ts` | **NEW** — Layer 1 plugin (`tool.execute.before` for `dispatch_subagent`). | ~120 lines |
| `.opencode/tools/dispatch_subagent.ts` | MODIFY — add Layer 2 pre-flight block, new `auto_plan` parameter, `logDispatchPreFlight()` helper. | ~80 lines added |
| `.opencode/plugins/gate-before.ts` | MODIFY — refactor `isDagCreator` inline list to `isDagExempt()` from `dag-policy.ts`. | ~5 lines changed |
| `.opencode/scripts/pre-execution-gate.ts` | MODIFY — refactor exempt-agent list to `isDagExempt()` from `dag-policy.ts`. | ~5 lines changed |
| `.opencode/project.config.json` | MODIFY — add top-level `dispatch_policy` block. | ~15 lines added |
| `.opencode/state/machine.schema.json` | MODIFY — add `auto_plan_history` and `dispatch_history` field schemas. | ~30 lines added |
| `.opencode/scripts/framework-self-test.ts` | MODIFY — add three new checks (Layer-1 plugin registered, Layer-2 pre-flight, auto-plan rate limit). | ~80 lines added |
| `.opencode/scripts/framework-doctor.ts` | MODIFY — add Check 12 (dispatch-policy consistency). | ~30 lines added |
| `.opencode/scripts/state-integrity-scan.ts` | MODIFY — add cross-check that each `auto_plan_history` entry has a matching DAG entry. | ~25 lines added |
| `.opencode/agents/Orchestrator.md` | MODIFY — add "PLAN-FIRST dispatch protocol" section. | ~60 lines added |
| `AGENTS.md` | MODIFY — add PLAN-FIRST protocol at global level. | ~30 lines added |
| `.opencode/rules/rule_detail/TEMPLATE_VARIABLE_STANDARD.md` | MODIFY — document `dispatch_policy` block. | ~20 lines added |

**Total**: ~700 lines of new code and documentation across 13 files. Two new files, 11 modifications.

---

## 10. Why the Orchestrator cannot bypass this

| Attack vector | Why it fails |
|---|---|
| Call `dispatch_subagent` with `auto_plan=false` and a non-DAG ID | Layer 2 throws `[FW-ENFORCE][PLAN-FIRST][LAYER-2]`; tool never executes. |
| Edit `dispatch_subagent.ts` to remove the pre-flight | Orchestrator's `safe_edit: .opencode/**: deny` blocks the write at the permission layer. |
| Edit `dispatch-before.ts` plugin to deregister | Same permission denial. |
| Edit `project.config.json` to set `require_dag_entry: false` | Same permission denial, plus `framework-enforcer.ts` DISPATCH-POLICY-TAMPER check rejects the edit even if the permission layer were bypassed. |
| Skip `dag_task_id` entirely | Layer 1 and Layer 2 both reject under `require_dag_entry: true` strict mode. |
| Dispatch @Super-Admin to edit the policy | @Super-Admin is itself DAG-exempt, but its `safe_edit` scope allows `.opencode/**` only for **framework repair** patterns (`loadSARepairPatterns()`). Editing `dispatch_policy` doesn't match any repair pattern, so dispatch is rejected in strict mode. |
| Exhaust `auto_plan_max_per_session` then retry | Rate limit is enforced; retry returns `rate_limited` and the dispatch blocks. |
| Race two dispatches in parallel | `FRAMEWORK_TASK_ID` save/restore + distinct `PLAN-<id>` for the planning dispatch prevents cross-contamination. |

The constraint is **architecturally unbypassable** because enforcement lives in code the Orchestrator is forbidden to modify, backed by a policy the Orchestrator is forbidden to change, backed by a defense-in-depth check at the sub-agent's first modify call.

---

## 11. Why the Orchestrator can self-heal

The `auto_plan` parameter is the explicit hook for self-healing. When the Orchestrator sees a `[FW-ENFORCE][PLAN-FIRST]` error (or anticipates one by setting `auto_plan=true` up front), the framework:

1. dispatches @Meta-Planner with a synthesized planning prompt,
2. polls `Task.DAG.json` until the ID appears,
3. re-verifies with `findTaskInDag`,
4. proceeds with the original dispatch.

The Orchestrator needs no special knowledge of how @Meta-Planner works — it just sets `auto_plan=true` and the framework handles the nested dispatch. The `Orchestrator.md` update documents the protocol so the LLM learns to use it proactively rather than reactively.

**Proactive use** (preferred): Orchestrator always sets `auto_plan=true` for non-exempt targets. No error ever surfaces; planning is automatic.

**Reactive use** (fallback): Orchestrator sees `[FW-ENFORCE][PLAN-FIRST]`, re-calls `dispatch_subagent` with `auto_plan=true`, the framework plans and proceeds.

Both use the same code path. The only difference is whether the Orchestrator anticipated the need.

---

## 12. Implementation order (if approved)

1. **`.opencode/lib/dag-policy.ts`** (new) — establishes the shared primitives every other change depends on.
2. **Refactor `gate-before.ts` and `pre-execution-gate.ts`** to use `isDagExempt()` — validates the shared helper without changing behavior.
3. **Layer 2 pre-flight in `dispatch_subagent.ts`** (without `auto_plan` initially) — hard enforcement.
4. **Layer 1 plugin `dispatch-before.ts`** — defense in depth.
5. **`dispatch_policy` block in `project.config.json`** + `machine.schema.json` extension — policy + audit schema.
6. **`auto_plan()` implementation in `dag-policy.ts`** — self-healing.
7. **`Orchestrator.md` and `AGENTS.md` updates** — multi-agent protocol.
8. **`framework-self-test.ts`, `framework-doctor.ts`, `state-integrity-scan.ts` updates** — harness.
9. **`TEMPLATE_VARIABLE_STANDARD.md` update** — templatization docs.

Each step is independently committable; the framework remains functional at every intermediate state.

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Auto-plan loops (Meta-Planner fails, framework retries forever) | `auto_plan_max_per_session` rate limit + `auto_plan_timeout_ms` bound. |
| Planning sub-dispatch pollutes the outer dispatch's FIFO queue | Distinct `PLAN-<id>` prefix keeps the entries separate. |
| `dispatch_policy.require_dag_entry=true` breaks existing dispatches that don't set `dag_task_id` | Audit existing dispatch patterns before enabling; the field defaults to `false` during rollout, flipped to `true` only after a one-week observation window. |
| Auto-plan writes a DAG entry the human didn't want | `auto_plan_history` audit trail; `state-integrity-scan.ts` cross-check; humans can revoke the DAG entry manually. |
| Layer-1 plugin crashes on malformed `output.args` | Defensive null-handling throughout; plugin throws only on explicit policy violations. |
| `DAG_EXEMPT_AGENTS` change requires code edit | Accepted — this is a deliberate design decision. Exempt-agent changes should be rare and reviewed. |

---

## 14. Open questions for the user before implementation

1. **Is `Knowledge-Curator` DAG-exempt?** Currently it is exempt from the pre-execution gate but subject to P2-1. The redesign consolidates the exempt set; should Knowledge-Curator be in `DAG_EXEMPT_AGENTS`?
2. **Default value of `require_dag_entry`?** Recommended: `false` during rollout (observation window), `true` in strict mode after one week. The user may prefer immediate `true`.
3. **Should `auto_plan` be opt-in or opt-out?** Recommended: opt-in (`auto_plan=false` default, set `true` per call). This keeps the Orchestrator in explicit control.
4. **Rate limit value?** Recommended: 5 per session. Adjustable via `dispatch_policy.auto_plan_max_per_session`.
5. **Timeout value?** Recommended: 120 s per attempt. Adjustable via `dispatch_policy.auto_plan_timeout_ms`.
6. **Should `auto_plan` be disabled in `locked` enforcement mode?** Recommended: yes — locked mode is human-in-the-loop.

---

*This design supersedes the "three options" sketch in `dispatch-session-bypass-investigation.md`. If approved, implementation follows the order in §12.*
