# E2E Findings Root-Cause Diagnosis

**Task ID**: `E2E-ACCEPTANCE-FINDINGS-DOC`  
**Agent**: @Super-Admin  
**Date**: 2026-06-23  
**Subject**: Root-cause diagnosis of problems in `e2e-framework-acceptance-findings-discovery.md`

## 1. Framework Context

The OpenCode multi-agent framework is **DB-canonical**: runtime state, execution phases, evidence, and enforcement decisions live in `framework-state.db` (SQLite, schema v18), not in mutable JSON files. The P0 checklist is a DB state machine with phases:

```
dispatch_payload -> preflight -> read_attest -> gate_armed -> execute -> deliver -> close
```

Each phase has blocking items that must be marked `passed` before the run advances. The `checklist-before.ts` plugin enforces this by resolving the active checklist run via `input.sessionID` (the OpenCode session of the tool caller) and blocking modify tools whose run has not reached the required phase.

Central state management (`machine.json`, `gate-state.json`) remains healthy and is NOT the source of the observed failures. The problem is entirely within the **checklist DB state machine's session-binding logic**.

## 2. Root-Cause Summary

**The dispatch fact writer and the enforcement reader operate on different checklist runs due to a session-identity split.**

- `dispatch-subagent.ts` marks dispatch facts using `process.env.OPENCODE_SESSION_ID` (parent session).
- `checklist-before.ts` enforces using `input.sessionID` (child session).
- Different sessions resolve to different `execution_checklist_runs` rows. The child's run never receives the marked dispatch facts.
- The marking "succeeds" (logs `Checklist items marked`), but on the wrong run. The non-fatal `try/catch` masks the failure.

## 3. Evidence

### 3.1 Dispatch marking succeeds (on parent run)

`plugin-dispatch-subagent-runtime.log`:

```
23:38:32 | Checklist items marked for agent=Coder-BE task=E2E-FRAMEWORK-STATIC-VFY
23:47:36 | Checklist items marked for agent=Coder-BE task=E2E-FRAMEWORK-RUNTIME-VFY
```

Import fix present at `dispatch-subagent.ts` line 54. Marking no longer throws.

### 3.2 Child sessions remain blocked

`plugin-tool-advance-checklist-phase-runtime.log`:

```
ses_10e4ca5d... | Coder-BE | ADVANCE-CHECKLIST-PHASE-BLOCKED | phase=dispatch_payload blockers=dispatch_token_created,payload_complete,session_context_bound
```

### 3.3 Test sessions advance successfully

Same log: `test_fa_tool_... | Architect | ADVANCE-CHECKLIST-PHASE | from=dispatch_payload to=preflight`

### 3.4 Code evidence

`dispatch-subagent.ts:983` uses parent session: `const sessionId2 = process.env.OPENCODE_SESSION_ID || "";`  
`checklist-before.ts:196` uses child session: `resolveChecklistRun(input.sessionID, agent, taskId);`  
`checklist-hooks.ts:43` creates run keyed by passed session: `createChecklistRun({ opencode_session_id: sessionID, ... })`

### 3.5 .dispatch_ctx investigation

The `.dispatch_ctx` file is a **legacy bridge** (Phase 1 dual-write) passing `dagTaskId` from `dispatch_subagent.ts` to `task-after.ts`. Source code confirms:

- **Writer** (`dispatch_subagent.ts:664-688`): Writes `{dagTaskId, domainId, createdAt}` before calling `Task()`.
- **Dual-write** (`dispatch_subagent.ts:690-709`): Also writes isolated `ctx/{dagTaskId}.json`.
- **Consumer** (`task-after.ts:174-188`): Reads then immediately `unlinkSync()` deletes.
- **Fallback readers** priority: (1) session_map DB, (2) ctx/{dagTaskId}.json, (3) .dispatch_ctx legacy.
  - `agent-resolver.ts:432-452`, `resolve_domain_id.ts:84-108`, `gate-core.ts:816-889`.
- **Risk**: `.dispatch_ctx` is singleton; concurrent dispatches overwrite it.
- **Future**: Phase 2 will remove `.dispatch_ctx` entirely.

**Key insight**: `.dispatch_ctx` passes `dagTaskId` (task identity) but NOT the child session ID. The session-identity split is orthogonal — it's about `opencode_session_id` mismatch, not `task_id` mismatch (Phase K already fixed `task_id` bridging).

## 4. Why framework-self-test Passes

Checks 64a-64e verify static wiring only. They do NOT exercise cross-session dispatch handoff. The self-test creates runs and marks items on the same session, never hitting the split.

## 5. Mapping to Findings

| Finding    | Root Cause                                                                      |
| ---------- | ------------------------------------------------------------------------------- |
| F-A / P0-1 | Session-identity split: dispatch facts on parent run, child run never sees them |
| F1 / F3-F6 | Transient: orphan armed gate sessions from E2E tasks not in DAG                 |
| F2         | Pre-existing: stale pre-HARDEN knowledge cache entries                          |
| Phase J    | Verified fixed                                                                  |
| Phase K    | Verified fixed; bridges task_id but NOT session_id                              |

## 6. The Remaining Gap

Phase K fixed **task_id** bridging but NOT **session_id** bridging. `createChecklistRun` uses different `opencode_session_id` values (parent vs child), creating different runs.

## 7. Fix Direction (Conforming to All 11 Framework Subsystems)

### 7.1 Layout Architecture Subsystem

**Constraint**: Files must reside in `.opencode/lib/`, `.opencode/plugins/`, `.opencode/tools/`, or `.opencode/scripts/`. No new top-level directories.

**Fix impact**: Modify existing files only:

- `.opencode/scripts/command-tools/dispatch-subagent.ts` (dispatch fact marking)
- `.opencode/lib/checklist-hooks.ts` (accept optional child session parameter)
- `.opencode/plugins/checklist-before.ts` (fall back to parent run when child run lacks dispatch facts)

### 7.2 Permission Matrix Subsystem

**Constraint**: `opencode.json` is the authoritative permission source. No new permission keys.

**Fix impact**: None. Existing `checklist_status: allow` and `advance_checklist_phase: allow` already granted to all agents.

### 7.3 Session/Same-Agent/Different-Agent/Task Concurrency Safe

**Constraint**: Concurrent dispatches must not race. Use DB-canonical `session_map`, not file-based `.dispatch_ctx`.

**Fix impact**: The fix must resolve the child session ID via `session_map` DB (`dispatch:child:{taskId}` slot) or `ctx/{dagTaskId}.json` — both concurrency-safe. The legacy `.dispatch_ctx` singleton must NOT be used for child session resolution.

**Implementation**: `dispatch-subagent.ts` should write `childSessionId` into `ctx/{dagTaskId}.json` (already written at line 690-709) as an additional field. The `checklist-before.ts` enforcement reads this to find the parent run that has the dispatch facts.

### 7.4 Hardened Enforcement Subsystem

**Constraint**: Fail-closed in strict/locked mode. Marking failure must be fatal, not swallowed.

**Fix impact**: The `try/catch` around `checklistWirePassed` calls in `dispatch-subagent.ts:984-1014` must re-throw in strict/locked mode. Currently it only logs `logWarn("Checklist marking skipped")` and continues, masking the session-identity split.

### 7.5 Framework Harness Subsystem

**Constraint**: Plugins use `withPluginLifecycle` + `export default`. Hooks defined in same module. Bun cache unreliable — rename file or clear cache after changes.

**Fix impact**: `checklist-before.ts` already uses `withPluginLifecycle`. No structural changes needed. After modifying the plugin, clear Bun cache (`rm -rf ~/.cache/bun`) to ensure recompilation.

### 7.6 Central State Management Subsystem

**Constraint**: `machine.json` and `gate-state.json` are project-specific constructs. Enforcement modes (advisory/strict/locked) control blocking behavior.

**Fix impact**: No changes to `machine.json` or `gate-state.json`. The fix operates entirely within the DB-canonical checklist state machine. The enforcement mode behavior matrix is unchanged — strict/locked blocks, advisory warns.

### 7.7 Multi-Agent Subsystem

**Constraint**: Parent/child session relationship via `session_map` DB. Plugin hooks lack agent identity natively — workaround via `process.env.FRAMEWORK_AGENT`. Child sessions have their own `sessionID`.

**Fix impact**: The fix must bridge the parent-child session gap. Two options:

**Option A (recommended)**: `dispatch-subagent.ts` marks dispatch facts on BOTH the parent run AND the child run. After marking the parent run (current behavior), also create/mark a run keyed by the child session ID (resolved from `ctx/{dagTaskId}.json` or `session_map` DB `dispatch:child:{taskId}` slot).

**Option B**: `checklist-before.ts` falls back to the parent session's run when the child session's run has no dispatch facts. Resolve parent session via `session_map` DB lookup of `dispatch:child:{taskId}`.

Option A is preferred because it keeps the enforcement reader simple (no cross-session lookup) and makes the dispatch facts visible on the run the child actually uses.

### 7.8 Log Central Management Subsystem

**Constraint**: Plugins and custom tools use `writeLog()`. MCP servers use `process.stderr.write()`. No `console.log` in plugins.

**Fix impact**: All new state changes must call `writeLog("checklist-hooks", "runtime", { event: "...", detail: "..." })`. The dispatch fact marking on the child run should log `CHECKLIST-DISPATCH-FACTS-PROPAGATED` with both parent and child session IDs for audit traceability.

### 7.9 DB-canonical Management Subsystem

**Constraint**: All checklist state in SQLite (schema v18). No JSON state files. Dual-write migration pattern (Phase 1 coexistence, Phase 2 removal).

**Fix impact**: The fix adds rows to `execution_checklist_items` and `execution_checklist_events` for the child run — all via existing `markChecklistPassed()` DB API. No JSON files. The `.dispatch_ctx` legacy file is NOT used for the fix; only `ctx/{dagTaskId}.json` (already DB-canonical safe) or `session_map` DB.

### 7.10 Templatization and Parameterization Universality Subsystem

**Constraint**: Fix uses existing template variables. No new placeholders. `project.config.json` is the source of truth.

**Fix impact**: None. The fix does not introduce new template variables or modify `project.config.json`. The `p0_checklist_policy` section already defines monitored and excluded write targets; the fix operates within these boundaries.

### 7.11 TypeScript + Bun Based Runtime Subsystem

**Constraint**: TypeScript with Bun runtime. CJS/ESM freely mixable. `require(.ts)` works natively. No transpilation needed.

**Fix impact**: All code changes are in `.ts` files executed by Bun. The `require("../../lib/checklist-hooks")` pattern (CJS) in `dispatch-subagent.ts` and the `import` pattern (ESM) in `checklist-before.ts` both work natively under Bun. No module system changes needed.

## 8. Implementation Summary (v2.1.0 — 2026-06-25: checklist-before.ts created)

### Completed (2026-06-25)

| Step | File                             | Change                                                             |      Status       |
| ---- | -------------------------------- | ------------------------------------------------------------------ | :---------------: |
| 1    | `dispatch-subagent.ts`           | childSessionId in ctx/{dagTaskId}.json                             |        ✅         |
| 2    | `plugins/checklist-before.ts`    | **NEW**: Option B parent-run fallback + auto-advance + phase block |        ✅         |
| 3    | `opencode.json`                  | checklist-before.ts registered in plugin array                     |        ✅         |
| 4    | `dispatch-subagent.ts:1032-1049` | Fatal marking in strict/locked                                     | ✅ (pre-existing) |

### Original Plan (2026-06-23)

| Step | File                   | Change                             | Subsystem                 |
| ---- | ---------------------- | ---------------------------------- | ------------------------- |
| 1    | `dispatch-subagent.ts` | childSessionId in ctx              | Session Concurrency       |
| 2    | `dispatch-subagent.ts` | Mark child run with dispatch facts | Multi-Agent, DB-canonical |
| 3    | `dispatch-subagent.ts` | Fatal marking in strict/locked     | Hardened Enforcement      |
| 4    | `checklist-hooks.ts`   | Optional childSessionId parameter  | Multi-Agent               |
| 5    | `checklist-before.ts`  | Parent-run fallback (Option B)     | Framework Harness         |

## 9. Verification Plan

1. After fix, run `bun --no-cache .opencode/scripts/framework-self-test.ts` — all 64 checks should still pass.
2. Add Check 67: spawn `dispatch-subagent.ts` with `OPENCODE_SESSION_ID`, then query `execution_checklist_items` for BOTH parent and child runs — all 3 dispatch facts must be `passed` on both runs.
3. Dispatch a real subagent in strict mode and confirm `checklist_status` returns `phase=preflight` (not `dispatch_payload`).
4. Confirm `advance_checklist_phase` succeeds for the child session.

## 10. References

- `docs/review/framework-refactor/db-canonical-p0-checklist-optimization-plan.md`
- `docs/review/framework-refactor/db-canonical-p0-checklist-implementation-audit-and-fix-plan.md`
- `docs/review/framework-refactor/sa-unresolved-findings-root-cause-analysis.md`
- `docs/review/framework-refactor/e2e-framework-acceptance-findings-discovery.md`
- `.task_temp/_logs/2026-06-22/plugin-dispatch-subagent-runtime.log`
- `.task_temp/_logs/2026-06-22/plugin-tool-advance-checklist-phase-runtime.log`
- `.opencode/tools/dispatch_subagent.ts:664-709` (.dispatch_ctx writer)
- `.opencode/plugins/task-after.ts:174-188` (.dispatch_ctx consumer)
- `.opencode/lib/agent-resolver.ts:432-452` (.dispatch_ctx fallback reader)
- `.opencode/tools/resolve_domain_id.ts:84-108` (session_map first, ctx fallback)
- `.opencode/lib/gate-core.ts:816-889` (session_map DB first, ctx/ then .dispatch_ctx)

## 11. Change Log

| Date       | Version | Change                                                                                                     |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| 2026-06-23 | 1.0.0   | Initial root-cause diagnosis                                                                               |
| 2026-06-23 | 2.0.0   | Updated fix directions conforming to all 11 framework subsystems; incorporated .dispatch_ctx investigation |

## 7. Fix Direction (Conforming to All 11 Framework Subsystems)

### 7.1 Layout Architecture Subsystem

**Constraint**: Files must reside in `.opencode/lib/`, `.opencode/plugins/`, `.opencode/tools/`, or `.opencode/scripts/`. No new top-level directories.

**Fix impact**: Modify existing files only:

- `.opencode/scripts/command-tools/dispatch-subagent.ts` — dispatch fact marking
- `.opencode/lib/checklist-hooks.ts` — accept optional child session parameter
- `.opencode/plugins/checklist-before.ts` — fall back to parent run when child run lacks dispatch facts

### 7.2 Permission Matrix Subsystem

**Constraint**: `opencode.json` is authoritative. No new permission keys.

**Fix impact**: None. Existing `checklist_status: allow` and `advance_checklist_phase: allow` already granted to all agents.

### 7.3 Session/Same-Agent/Different-Agent/Task Concurrency Safe

**Constraint**: Concurrent dispatches must not race. Use DB-canonical `session_map`, not file-based `.dispatch_ctx`.

**Fix impact**: Resolve child session ID via `session_map` DB (`dispatch:child:{taskId}` slot) or `ctx/{dagTaskId}.json` — both concurrency-safe. The legacy `.dispatch_ctx` singleton must NOT be used for child session resolution.

**Implementation**: `dispatch-subagent.ts` should write `childSessionId` into `ctx/{dagTaskId}.json` (already written at line 690-709) as an additional field. `checklist-before.ts` reads this to find the parent run when the child run has no dispatch facts.

### 7.4 Hardened Enforcement Subsystem

**Constraint**: Fail-closed in strict/locked mode. Marking failure must be fatal, not swallowed.

**Fix impact**: Remove the `try/catch` around `checklistWirePassed` calls in `dispatch-subagent.ts:984-1014`. In strict/locked mode, throw if marking fails. In advisory mode, log warning and continue.

### 7.5 Framework Harness Subsystem

**Constraint**: Plugins use `withPluginLifecycle` + `export default`. Hooks defined in same module. Bun cache may not invalidate on small changes.

**Fix impact**: `checklist-before.ts` already uses `withPluginLifecycle`. No structural changes needed. After modifying the plugin, clear Bun cache (`rm -rf ~/.cache/bun`) or rename file to force recompilation.

### 7.6 Central State Management Subsystem

**Constraint**: `machine.json` and `gate-state.json` are project-specific constructs. Enforcement modes (advisory/strict/locked) control blocking behavior.

**Fix impact**: No changes to `machine.json` or `gate-state.json`. The fix operates entirely within the checklist DB state machine. Enforcement mode behavior is preserved: strict/locked blocks on missing dispatch facts; advisory warns.

### 7.7 Multi-Agent Subsystem

**Constraint**: Parent/child session relationship. Plugin hooks lack agent identity — workaround via `process.env.FRAMEWORK_AGENT`. Child sessions have their own `sessionID`.

**Fix impact**: The fix must bridge the parent-child session gap. Two approaches:

- **Option A (recommended)**: `dispatch-subagent.ts` marks dispatch facts on BOTH the parent run AND the child run. The child run is created by `checklist-before.ts` when the child session first calls a modify tool. To mark on the child run, `dispatch-subagent.ts` must know the child session ID — but at dispatch time, the child session does not yet exist (Task() hasn't been called yet).
- **Option B (pragmatic)**: `checklist-before.ts` adds a fallback: when a child session's run has no dispatch facts passed, look up the parent session via `session_map` DB (`dispatch:child:{taskId}` -> parent session), resolve the parent's run, and check if dispatch facts are passed there. If yes, copy them to the child run (or treat them as satisfied).

**Recommended**: Option B, because the child session ID is not known at dispatch time. The fallback in `checklist-before.ts` is:

1. Resolve `taskId` via `resolveChecklistTaskId(input)` (Phase K bridge).
2. Resolve child run via `resolveChecklistRun(input.sessionID, agent, taskId)`.
3. If child run has dispatch items pending, look up parent session via `dbReadSessionMap("dispatch:child:" + taskId)`.
4. If parent session found, resolve parent run via `resolveChecklistRun(parentSession, agent, taskId)`.
5. If parent run has dispatch items passed, mark them passed on child run (or auto-advance child run past `dispatch_payload`).

### 7.8 Log Central Management Subsystem

**Constraint**: Plugins use `writeLog()`. MCP tools use `process.stderr.write()`. No `console.log` in plugins.

**Fix impact**: All new state changes in the fix must call `writeLog("checklist-before", "runtime", { ... })` with appropriate event names:

- `CHECKLIST-PARENT-RUN-FALLBACK` — when falling back to parent run
- `CHECKLIST-DISPATCH-FACTS-COPIED` — when dispatch facts are copied from parent to child run
- `CHECKLIST-DISPATCH-MARKING-FATAL` — when marking failure is treated as fatal in strict/locked

### 7.9 DB-canonical Management Subsystem

**Constraint**: All checklist state in SQLite (schema v18). No JSON state files. Dual-write migration pattern (Phase 1 coexistence, Phase 2 removal).

**Fix impact**: The fix uses existing `execution_checklist_runs`, `execution_checklist_items`, and `execution_checklist_events` tables. No schema changes needed. The `ctx/{dagTaskId}.json` file is a temporary bridge (like `.dispatch_ctx`), not a state source — the DB remains canonical.

### 7.10 Templatization and Parameterization Universality Subsystem

**Constraint**: Fix must not introduce project-specific hardcoding. Use template variables where applicable.

**Fix impact**: None. The fix operates on session IDs and task IDs, which are runtime values, not project-configurable parameters. No new template variables needed.

### 7.11 TypeScript + Bun Based Runtime Subsystem

**Constraint**: CJS/ESM freely mixable. `require(.ts)` works natively. No transpilation needed. `module.exports` for MCP servers.

**Fix impact**: All modified files are TypeScript executed by Bun. The `require("../../lib/checklist-hooks")` pattern (CJS-style require in TS) is already used and supported by Bun. No module system changes needed.

## 8. Implementation Summary

### Recommended Fix: Option B — Parent-Run Fallback in checklist-before.ts

```
When child session's checklist run has dispatch_payload items pending:
  1. Resolve taskId via resolveChecklistTaskId(input) [Phase K bridge]
  2. Look up parent session: dbReadSessionMap("dispatch:child:" + taskId)
  3. If parent session found:
     a. Resolve parent run: resolveChecklistRun(parentSession, agent, taskId)
     b. Check if parent run has dispatch items passed
     c. If yes: mark same items passed on child run + write CHECKLIST-DISPATCH-FACTS-COPIED event
     d. Auto-advance child run from dispatch_payload to preflight
  4. If no parent session or parent run lacks dispatch facts: block as before
```

### Additional Fix: Fatal Marking in strict/locked

In `dispatch-subagent.ts:984-1014`, remove the `try/catch` swallow. In strict/locked mode, `throw` if `checklistWirePassed` fails. In advisory mode, keep the warning log.

### Self-Test Enhancement

Add a check to `framework-self-test.ts` that:

1. Creates a parent session + run
2. Marks dispatch facts on parent run
3. Creates a child session + run (different `opencode_session_id`)
4. Simulates `checklist-before.ts` enforcement on child run
5. Verifies the parent-run fallback finds and copies the dispatch facts
6. Verifies child run advances past `dispatch_payload`

## 9. .dispatch_ctx Phase 2 Migration Note

The `.dispatch_ctx` file is on a Phase 1 dual-write path. The fix in Section 7 does NOT depend on `.dispatch_ctx` — it uses `session_map` DB and `ctx/{dagTaskId}.json` only. This aligns with the Phase 2 plan to remove `.dispatch_ctx` entirely. The fix is forward-compatible: when `.dispatch_ctx` is removed, the parent-run fallback still works because it reads from `session_map` DB, not from `.dispatch_ctx`.

## 10. References

- `docs/review/framework-refactor/db-canonical-p0-checklist-optimization-plan.md` — target architecture
- `docs/review/framework-refactor/db-canonical-p0-checklist-implementation-audit-and-fix-plan.md` — P0-1..P0-8, Phase G/H/I/J/K
- `docs/review/framework-refactor/sa-unresolved-findings-root-cause-analysis.md` — F-A..F-J consolidated RCA
- `docs/review/framework-refactor/e2e-framework-acceptance-findings-discovery.md` — discovery process
- `.task_temp/_logs/2026-06-22/plugin-dispatch-subagent-runtime.log` — marking success evidence
- `.task_temp/_logs/2026-06-22/plugin-tool-advance-checklist-phase-runtime.log` — child session block evidence
- `.opencode/tools/dispatch_subagent.ts:664-709` — .dispatch_ctx writer
- `.opencode/plugins/task-after.ts:174-204` — .dispatch_ctx consumer
- `.opencode/lib/agent-resolver.ts:432-452` — .dispatch_ctx fallback reader
- `.opencode/tools/resolve_domain_id.ts:80-108` — session_map + ctx fallback
- `.opencode/lib/gate-core.ts:816-889` — session_map + ctx + .dispatch_ctx fallback
- `docs/official_docs/opencode/findings/04-layout-architecture.md` — Layout Architecture subsystem
- `docs/official_docs/opencode/findings/06-multi-agent-system.md` — Multi-Agent subsystem
- `docs/official_docs/opencode/findings/03-permission-matrix.md` — Permission Matrix subsystem
- `docs/official_docs/opencode/findings/02-harness-system.md` — Framework Harness subsystem
- `docs/official_docs/opencode/findings/01-log-central-management.md` — Log Central Management subsystem
- `docs/official_docs/opencode/findings/05-central-state-management.md` — Central State Management subsystem
- `docs/official_docs/opencode/sessions/opencode-session-api.md` — Session management API
- `docs/official_docs/bun/bun-module-resolution.md` — TypeScript + Bun runtime
- `docs/official_docs/framework/state-mgmt/read-audit-db-migration-summary.md` — DB-canonical migration pattern

## 11. Change Log

| Date       | Version | Change                                                                                                                                                                                                                                              |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-23 | 1.0.0   | Initial root-cause diagnosis                                                                                                                                                                                                                        |
| 2026-06-23 | 1.1.0   | Updated fix directions to conform to all 11 framework subsystems; incorporated .dispatch_ctx investigation findings; added Option B parent-run fallback; added fatal marking requirement; added self-test enhancement; added Phase 2 migration note |
