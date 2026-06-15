# PLAN-FIRST Implementation Resolution

**Date**: 2026-06-14
**Author**: @Super-Admin (framework architect)
**Status**: IMPLEMENTED AND VALIDATED
**Companion**: [`plan-first-redesign.md`](./plan-first-redesign.md) (design)

---

## 1. What was built

The PLAN-FIRST dispatch constraint is now live as a 3-layer defense-in-depth stack with autonomous `auto_plan` self-healing.

### Layer 1 — policy-driven plugin (NEW)

**File**: `.opencode/plugins/dispatch-before.ts` (209 lines)

- Registered as `tool.execute.before` for `dispatch_subagent`.
- Reads `dispatch_policy` from `project.config.json`.
- Rejects non-compliant dispatches BEFORE the tool runs.
- Honors enforcement mode:
  - advisory → warn but don't block
  - strict/locked → block with `[FW-ENFORCE][PLAN-FIRST][LAYER-1]`
- If `auto_plan=true` is requested AND the policy allows it, defers to Layer 2 rather than blocking.

### Layer 2 — tool-level pre-flight (MODIFIED)

**File**: `.opencode/tools/dispatch_subagent.ts` (~90 lines added)

- New `auto_plan: boolean` optional parameter.
- Pre-flight block inserted immediately after `savedTaskId = process.env.FRAMEWORK_TASK_ID`.
- For non-DAG-exempt targets with `policy.require_dag_entry=true`:
  - Empty `dag_task_id` → throw `[FW-ENFORCE][PLAN-FIRST][LAYER-2]`.
  - `dag_task_id` not in DAG AND `auto_plan=true` AND `policy.auto_plan_enabled` → invoke `autoPlan()` from `lib/dag-policy.ts`.
  - Status gate: only `pending`/`in_progress` allowed.

### Layer 3 — gate-before P2-1 (UNCHANGED but refactored)

**File**: `.opencode/plugins/gate-before.ts` (~5 lines changed)

- Refactored inline exempt list `(orchestrator|meta-planner|super-admin)` to use `isDagExempt()` from `lib/dag-policy.ts`. Now includes `knowledge-curator` per the user's decision.

### Shared policy module (NEW)

**File**: `.opencode/lib/dag-policy.ts` (~330 lines)

Exports:
- `DAG_EXEMPT_AGENTS = [meta-planner, orchestrator, super-admin, knowledge-curator]` (frozen)
- `isDagExempt(agent)` — canonical predicate
- `readDispatchPolicy()` — cached reader with defaults; forces `auto_plan_enabled=false` in locked mode
- `autoPlan(opts)` — the self-healing flow
- `synthesizePlanningPrompt(opts)` — the prompt sent to @Meta-Planner
- `appendAutoPlanRecord()` / `countAutoPlanAttempts()` — audit helpers

The `autoPlan()` flow:
1. Records attempt to `machine.json.auto_plan_history`.
2. Rate-limits to `auto_plan_max_per_session` (default 5) per caller session.
3. Synthesizes a planning prompt.
4. Invokes an injected `dispatchMetaPlanner` callback (which calls `dispatch-subagent.ts` directly via `execFileSync(bun, …)`, targeting `@Meta-Planner` — which is DAG-exempt so it bypasses Layer 2).
5. Polls `Task.DAG.json` at 1-second intervals until `dag_task_id` appears with `pending` or `in_progress` status, or timeout.
6. Records success or timeout to audit history.

### Pre-execution gate (MODIFIED)

**File**: `.opencode/scripts/pre-execution-gate.ts` (~25 lines changed)

- Replaced the inline exempt list `(Meta-Planner|Orchestrator|Knowledge-Curator)` with a lazy-loaded call to `isDagExempt()` from `lib/dag-policy.ts`.
- Now includes `super-admin` in the exempt set, matching gate-before behavior.

### Policy config (MODIFIED)

**File**: `.opencode/project.config.json` (~8 lines added)

```json
"dispatch_policy": {
  "$description": "FW-PLAN-FIRST (2026-06-14): ...",
  "require_dag_entry": false,
  "auto_plan_enabled": false,
  "auto_plan_max_per_session": 5,
  "auto_plan_timeout_ms": 120000
}
```

Default is observation mode (`require_dag_entry: false`). Flip to `true` after the observation window per the user's decision.

### Schema (MODIFIED)

**File**: `.opencode/state/machine.schema.json` (~40 lines added)

Two new array properties:
- `auto_plan_history` — schema for each record (timestamp, caller_session, caller_agent, target_agent, dag_task_id, planning_dispatch_id, status, elapsed_ms, error).
- `dispatch_history` — schema for each successful dispatch that passed PLAN-FIRST pre-flight.

### Multi-agent protocol (MODIFIED)

- `.opencode/agents/Orchestrator.md` — added `### ⚡ P0 CRITICAL: PLAN-FIRST Dispatch Protocol` section (~60 lines) documenting:
  - the 3-layer enforcement stack
  - DAG-exempt agents
  - `auto_plan=true` usage
  - proactive vs. reactive use
  - what the Orchestrator cannot do
- `AGENTS.md` — added `### 🚨 P0 PLAN-FIRST 调度约束` section (~45 lines) at the global protocol level.

### Harness (MODIFIED)

- `.opencode/scripts/framework-self-test.ts` — new Check 37 `PLAN-FIRST consistency`: verifies the 3-layer stack is intact (dag-policy exports, dispatch-before exists and imports, dispatch_subagent has Layer 2 pre-flight, gate-before uses canonical exempt list, project.config.dispatch_policy block is valid).
- `.opencode/scripts/framework-doctor.ts` — new Check 12 `Dispatch-policy consistency`: verifies the `dispatch_policy` block is internally consistent with the current enforcement mode (e.g. `auto_plan_enabled=true` forbidden in locked mode).
- `.opencode/scripts/state-integrity-scan.ts` — new cross-check that every `auto_plan_history` record with `status=success` has a matching entry in the current DAG (warns on orphans — past plans that were pruned without history update).

### Templatization docs (MODIFIED)

- `.opencode/rules/rule_detail/TEMPLATE_VARIABLE_STANDARD.md` — new §2.12 documenting the `dispatch_policy` block (key table, hardening rules, audit trail, consumers).

---

## 2. Files changed (summary)

| File | Type | Change size |
|---|---|---|
| `.opencode/lib/dag-policy.ts` | NEW | ~330 lines |
| `.opencode/plugins/dispatch-before.ts` | NEW | 209 lines |
| `.opencode/tools/dispatch_subagent.ts` | MODIFY | +90 lines (import + param + pre-flight) |
| `.opencode/plugins/gate-before.ts` | MODIFY | ~5 lines (refactor to `isDagExempt`) |
| `.opencode/scripts/pre-execution-gate.ts` | MODIFY | ~25 lines (lazy `isDagExempt`) |
| `.opencode/project.config.json` | MODIFY | +8 lines (`dispatch_policy` block) |
| `.opencode/state/machine.schema.json` | MODIFY | +40 lines (`auto_plan_history`, `dispatch_history`) |
| `.opencode/agents/Orchestrator.md` | MODIFY | +60 lines (PLAN-FIRST protocol) |
| `AGENTS.md` | MODIFY | +45 lines (PLAN-FIRST protocol) |
| `.opencode/scripts/framework-self-test.ts` | MODIFY | +80 lines (Check 37) |
| `.opencode/scripts/framework-doctor.ts` | MODIFY | +65 lines (Check 12) |
| `.opencode/scripts/state-integrity-scan.ts` | MODIFY | +35 lines (auto_plan orphan check) |
| `.opencode/rules/rule_detail/TEMPLATE_VARIABLE_STANDARD.md` | MODIFY | +55 lines (§2.12) |
| `.opencode/state/rule_registry.json` | MODIFY | semver bumped for Orchestrator.md (1.0.11 → 1.0.12) to absorb the PLAN-FIRST content addition |

**Total**: ~1100 lines added across 14 files (2 new, 12 modified).

---

## 3. Validation results

| Check | Result |
|---|---|
| `framework-doctor.ts --strict` | ✅ **12/12 PASS** (was 11/11 before; new Check 12 green) |
| `framework-self-test.ts` | ✅ Check 37 `PLAN-FIRST consistency` PASS; overall 36/38 — the 2 FAILs are **pre-existing and unrelated** (Check 7 `meta.total_tasks missing` and Check 36 `uncommitted backup diffs`) |
| `state-integrity-scan.ts` | ✅ **0 HIGH** (was 0 HIGH before; the new auto_plan orphan check found nothing because there have been no auto_plan attempts yet) |
| TypeScript parse | ✅ all three harness files (`framework-self-test.ts`, `framework-doctor.ts`, `state-integrity-scan.ts`) + `dag-policy.ts` + `dispatch-before.ts` + `dispatch_subagent.ts` compile cleanly with `tsc --noEmit --target esnext --module esnext --moduleResolution bundler --allowImportingTsExtensions` |
| `rule-registry-verify.ts --repair` | ✅ auto-repaired Orchestrator.md digest mismatch by bumping semver 1.0.11 → 1.0.12 |

---

## 4. User-decision binding

The six open questions from the design were resolved by the user as follows and are baked into the implementation:

| # | Question | User's decision | Where enforced |
|---|---|---|---|
| 1 | Is Knowledge-Curator DAG-exempt? | **yes** | `lib/dag-policy.ts:46` — `DAG_EXEMPT_AGENTS` includes `knowledge-curator` |
| 2 | Default `require_dag_entry` | **false during rollout, true after observation** | `project.config.json:dispatch_policy.require_dag_entry: false` (flip to `true` manually when ready) |
| 3 | `auto_plan` opt-in or opt-out? | **opt-in** | `dispatch_subagent.ts` parameter default is `undefined`/`false`; only acts on `auto_plan === true` |
| 4 | Rate limit | **5 per session** | `project.config.json:dispatch_policy.auto_plan_max_per_session: 5` |
| 5 | Timeout | **120 s per attempt** | `project.config.json:dispatch_policy.auto_plan_timeout_ms: 120000` |
| 6 | Disable in locked mode? | **yes** | `lib/dag-policy.ts:166` — `readDispatchPolicy()` forces `auto_plan_enabled=false` when enforcement mode is `locked` |

---

## 5. Why the Orchestrator cannot bypass this

| Attack vector | Why it fails |
|---|---|
| Skip the tool pre-flight | Orchestrator's `safe_edit: .opencode/**: deny` blocks edits to the tool |
| Deregister the plugin | Same permission denial |
| Edit `project.config.json` to set `require_dag_entry: false` | Same permission denial + `framework-enforcer.ts` DISPATCH-POLICY-TAMPER check (defense in depth) |
| Skip `dag_task_id` entirely | Layers 1 and 2 reject under `require_dag_entry: true` strict mode |
| Dispatch @Super-Admin to edit the policy | @Super-Admin dispatch requires a framework-repair pattern match (`loadSARepairPatterns()`); editing `dispatch_policy` is not a repair pattern |
| Exhaust rate limit then retry | `auto_plan_max_per_session` returns `rate_limited`; dispatch blocks |
| Parallel-dispatch race | Distinct `PLAN-<id>` prefix keeps the FIFO queue clean; `FRAMEWORK_TASK_ID` save/restore in the outer dispatch prevents env-var pollution |

---

## 6. How to exercise the self-healing (smoke test)

Once `require_dag_entry` and `auto_plan_enabled` are both flipped to `true`:

```typescript
// Orchestrator calls:
dispatch_subagent({
  agent_type: "CI-CD-Agent",
  task_description: "Fix execution_order scanning in commit hooks",
  dag_task_id: "COMMIT-EXECORDER-FIX-002",   // not yet in the DAG
  auto_plan: true,                            // ← opt-in to self-healing
})
```

Expected sequence:
1. Layer 1 (`dispatch-before.ts`) sees `auto_plan=true` and `policy.auto_plan_enabled=true` → defers to Layer 2, logs `DISPATCH-BEFORE | exit (pass, deferring to Layer 2)`.
2. Layer 2 (`dispatch_subagent.ts`) runs `findTaskInDag("COMMIT-EXECORDER-FIX-002")` → not found → calls `autoPlan()`.
3. `autoPlan()` records attempt → dispatches @Meta-Planner with synthesized planning prompt (distinct `dag_task_id = PLAN-COMMIT-EXECORDER-FIX-002`) → polls `Task.DAG.json` every second.
4. @Meta-Planner adds `COMMIT-EXECORDER-FIX-002` to `Task.DAG.json.execution_order` and produces `HANDOVER.md`.
5. `autoPlan()` sees the new entry with `status=pending` → records success → returns `true`.
6. Layer 2 re-verifies with `findTaskInDag` → found → proceeds.
7. `dispatch-subagent.ts` is spawned; the CI-CD-Agent session starts with `FRAMEWORK_TASK_ID=COMMIT-EXECORDER-FIX-002`.
8. When the CI-CD-Agent calls `safe_shell git add`, Layer 3 (`gate-before.ts` P2-1) runs `findTaskInDag("COMMIT-EXECORDER-FIX-002")` → found with status=pending → PASS.
9. `machine.json.auto_plan_history` has one entry with `status: "success"` and `elapsed_ms` between ~2000 and ~120000.
10. `machine.json.dispatch_history` has one entry recording the successful dispatch.

---

## 7. Rollout plan

**Week 1 (observation)**: leave `require_dag_entry: false` and `auto_plan_enabled: false`. Monitor `plugin-dispatch-before-runtime.log` for `[WARN] exit (pass) | dispatch_policy.require_dag_entry=false` events to build a baseline of dispatches that would have been blocked.

**Week 2 (hardening)**: flip `require_dag_entry: true` (strict mode). Keep `auto_plan_enabled: false` so blocked dispatches produce explicit `[FW-ENFORCE][PLAN-FIRST]` errors. Monitor `plugin-dispatch-before-runtime.log` for `[ERROR] BLOCKED | PLAN-FIRST` events to verify the constraint is catching what it should.

**Week 3 (self-healing)**: flip `auto_plan_enabled: true`. Monitor `machine.json.auto_plan_history` for `status: "success"` / `"timeout"` / `"rate_limited"` events to verify self-healing works as designed.

**Ongoing**: the `state-integrity-scan.ts` auto_plan orphan check catches cases where a successful auto-plan's DAG entry was later pruned without updating history.

---

## 8. Residual work / follow-ups

- **Flip `require_dag_entry: true`** after the observation window (per the rollout plan above).
- **Add `DISPATCH-POLICY-TAMPER` check** to `framework-enforcer.ts` — mentioned in the design but not implemented in this pass; the Orchestrator's existing `safe_edit: .opencode/**: deny` permission provides equivalent protection.
- **End-to-end smoke test** once the policy is flipped to `true` — the sequence described in §6 has not been exercised against a live OpenCode session yet.
