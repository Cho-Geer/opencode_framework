# E2E Framework Acceptance Findings — Discovery Process

**Task ID**: `SAVE-E2E-FINDINGS`  
**Agent**: @Super-Admin  
**Date**: 2026-06-23  
**Enforcement Mode**: strict  
**Source E2E Tasks**: `E2E-FRAMEWORK-STATIC-VFY`, `E2E-FRAMEWORK-RUNTIME-VFY`

## 1. Purpose

This document records **how** the recent DB-canonical P0 checklist E2E acceptance testing discovered each finding. It focuses on the **discovery method, evidence chain, and reproduction context**, so future repairs can re-run the same verification steps and confirm fixes.

## 2. Scope & Methodology

### 2.1 Acceptance Plans Used

| Plan                                        | File                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| DB-canonical P0 checklist optimization plan | `docs/review/framework-refactor/db-canonical-p0-checklist-optimization-plan.md`                 |
| Implementation audit & fix plan             | `docs/review/framework-refactor/db-canonical-p0-checklist-implementation-audit-and-fix-plan.md` |
| SA unresolved findings RCA                  | `docs/review/framework-refactor/sa-unresolved-findings-root-cause-analysis.md`                  |

### 2.2 E2E Verification Split

Because the runtime checklist flow was already suspected to deadlock, the acceptance was split into two dispatches:

1. `E2E-FRAMEWORK-STATIC-VFY` — read-only code audit.
2. `E2E-FRAMEWORK-RUNTIME-VFY` — execute diagnostic scripts.

The split was itself a workaround: the static verifier could not run Bun scripts because `safe_shell` was blocked in the `dispatch_payload` phase.

### 2.3 Evidence Artifacts

| Artifact            | Path                                                    |
| ------------------- | ------------------------------------------------------- |
| Static HANDOVER     | `.task_temp/E2E-FRAMEWORK-STATIC-VFY/HANDOVER.md`       |
| Static test report  | `.task_temp/E2E-FRAMEWORK-STATIC-VFY/test_report.json`  |
| Runtime HANDOVER    | `.task_temp/E2E-FRAMEWORK-RUNTIME-VFY/HANDOVER.md`      |
| Runtime test report | `.task_temp/E2E-FRAMEWORK-RUNTIME-VFY/test_report.json` |

## 3. Findings Discovery Process

### 3.1 F-A / P0-1 — `dispatch_payload` to `preflight` phase deadlock

**Severity**: P0 / HIGH  
**First observed in**: `E2E-FRAMEWORK-STATIC-VFY` Step 1

**Discovery steps**:

1. Coder-BE called `checklist_status(task_id=E2E-FRAMEWORK-STATIC-VFY)` and received phase `dispatch_payload` with pending blockers `payload_complete`, `dispatch_token_created`, `session_context_bound`.
2. The agent attempted to run `bun .opencode/scripts/framework-self-test.ts` via `safe_shell`.
3. `checklist-before.ts` blocked the call because the run had not reached `preflight`.
4. Static code audit of `.opencode/scripts/command-tools/dispatch-subagent.ts` showed intended calls to `checklistWirePassed(...)` for the three dispatch facts.
5. The file did not import or define `checklistWirePassed`; the call throws and is swallowed by a local `catch` that only logs a warning.
6. This matches prior RCA `sa-unresolved-findings-root-cause-analysis.md` sections F-A and F-D.

**Evidence**:

- `.task_temp/E2E-FRAMEWORK-STATIC-VFY/test_report.json` step 1 status `PENDING`.
- `.task_temp/E2E-FRAMEWORK-STATIC-VFY/HANDOVER.md` Finding F1.
- `sa-unresolved-findings-root-cause-analysis.md` lines 69-99 and 181-214.

**Why it cascades**: Because modify tools require `preflight`/`read_attest` items, the subagent cannot execute Bun commands, write files, or call `config_read_attest`. This blocked Steps 1 and 7 of static acceptance and prevented deeper runtime probes.

### 3.2 F1 — `framework-self-test` Checks 26/27 fail (orphan armed sessions)

**Severity**: HIGH (transient)  
**First observed in**: `E2E-FRAMEWORK-RUNTIME-VFY` Step 1

**Discovery steps**:

1. Coder-BE ran `bun --no-cache .opencode/scripts/framework-self-test.ts`.
2. Result: 61/64 passed, 3 failed.
3. Failures included Check 26 (`framework-doctor --strict` Check 4) and Check 27 (reconciler inconsistencies).
4. Step 3 ran `framework-doctor.ts --strict` directly; Check 4 reported 2 orphan armed sessions.
5. Cross-referencing `gate-state.json` showed the armed sessions were the E2E verification tasks themselves, which are not in `Task.DAG.json`.

**Evidence**:

- `.task_temp/E2E-FRAMEWORK-RUNTIME-VFY/test_report.json` `step1_framework_self_test.failures`.
- `.task_temp/E2E-FRAMEWORK-RUNTIME-VFY/HANDOVER.md` Failed Checks table F1/F2/F4.

**Interpretation**: Expected artifacts of the E2E dispatch flow, not framework regressions.

### 3.3 F2 — `framework-self-test` Check 35 fails (stale pre-HARDEN cache entries)

**Severity**: MEDIUM (cosmetic)  
**First observed in**: `E2E-FRAMEWORK-RUNTIME-VFY` Step 1

**Discovery steps**:

1. Same `framework-self-test.ts` run reported Check 35 failure.
2. Failure message: `3 stale pre-HARDEN entries: Knowledge-Curator, Orchestrator, Coder-BE`.
3. These entries live in `knowledge_cache_state` inside `machine.json` and predate the UC7-001c schema hardening migration.

**Evidence**:

- `.task_temp/E2E-FRAMEWORK-RUNTIME-VFY/test_report.json` step 1 third failure.
- `sa-unresolved-findings-root-cause-analysis.md` section 2.2.

**Interpretation**: Does not affect runtime behavior, but keeps self-test red until cleaned.

### 3.4 F3/F4/F5/F6 — `state-reconciliation` HIGH inconsistencies

**Severity**: HIGH (transient)  
**First observed in**: `E2E-FRAMEWORK-RUNTIME-VFY` Step 4

**Discovery steps**:

1. Coder-BE ran `bun --no-cache .opencode/scripts/state-reconciliation.ts --fix`.
2. Output showed 2 HIGH inconsistencies and `auto_fixable: false`.
3. Inconsistencies mapped gate sessions `cg_ses_1782171559662` and `cg_ses_1782172137168` to tasks `E2E-FRAMEWORK-STATIC-VFY` and `E2E-FRAMEWORK-RUNTIME-VFY`.
4. These session IDs match the gate sessions created by the two E2E dispatches.

**Evidence**:

- `.task_temp/E2E-FRAMEWORK-RUNTIME-VFY/test_report.json` `step4_state_reconciliation.inconsistencies`.
- `.task_temp/E2E-FRAMEWORK-RUNTIME-VFY/HANDOVER.md` Findings F5/F6.

**Interpretation**: Same root cause as F1. The armed sessions are transient.

### 3.5 Phase J DISPATCH_TOKEN hash — verified fixed

**Severity**: INFO (resolved)  
**Verified in**: `E2E-FRAMEWORK-RUNTIME-VFY` Step 2

**Discovery steps**:

1. Earlier RCA identified a regex bug in `task-before.ts` that stripped all trailing newlines from `resolvedPrompt`, causing a permanent SHA-256 mismatch.
2. Runtime Step 2 performed a logical round-trip test with both trailing-newline and no-trailing-newline prompts.
3. Both cases passed.

**Evidence**:

- `.task_temp/E2E-FRAMEWORK-RUNTIME-VFY/test_report.json` `step2_dispatch_token_hash`.
- `.task_temp/E2E-FRAMEWORK-STATIC-VFY/HANDOVER.md` Step 7 / Finding F4.

**Interpretation**: Phase J1 fix is present and correct.

### 3.6 Phase K `resolveChecklistTaskId` bridge — verified fixed

**Severity**: INFO (resolved)  
**Verified in**: `E2E-FRAMEWORK-STATIC-VFY` Step 6

**Discovery steps**:

1. Static audit read `.opencode/plugins/checklist-before.ts` lines 138-168.
2. Confirmed `resolveChecklistTaskId(input)` resolves explicit args first, then falls back to `dbReadSessionMap`.
3. Called at line 168 before role/event audit so all tools use the bridge.
4. Old Task-only bridge removed.

**Evidence**:

- `.task_temp/E2E-FRAMEWORK-STATIC-VFY/test_report.json` Step 6.
- `.task_temp/E2E-FRAMEWORK-STATIC-VFY/HANDOVER.md` Finding F3.

**Interpretation**: Prevents modify tools from creating a separate `task_id=null` checklist run.

### 3.7 Phase H / I / G — not exercised

| Phase | Coverage | Why not tested |
|-------|----------|----------------|
| H | `session_map` agent-identity pollution | Requires multiple sequential dispatches; blocked by F-A |
| I | UC7-001 shell parsing bypass | Requires crafted `safe_shell` chains; blocked by F-A |
| G | Dispatch prompt refinement | Requires measuring dispatch files; blocked by F-A |

These remain assumed fixed by code audit but not behaviorally verified.

## 4. What Passed Without Issue

| Check | Discovery Method |
|-------|-----------------|
| Schema v18 tables exist | Read `.opencode/lib/execution-checklist.ts` header |
| `checklist-before.ts` registered | Read `opencode.json` line 882 and plugin file |
| `checklist_status.ts` wired | Read tool file and `opencode.json` permissions |
| `execution-checklist.ts` zero JSON writes | `grep` returned 0 matches for `writeFileSync`/`appendFileSync` |
| Knowledge janitor integrity | Ran `knowledge/janitor.ts --integrity` |
| Plugin health | Inspected `.task_temp/_logs/index.json` |

## 5. Cross-Finding Interaction

```text
F-A / P0-1  --> dispatch_payload cannot advance
                    |
                    v
              modify tools blocked
                    |
                    v
       Static Steps 1,7 PENDING; H/I/G not testable
                    |
                    v
       E2E tasks create armed gate sessions
                    |
                    v
       F1/F3/F4/F5/F6 transient reconciler failures
```

The framework infrastructure is largely correct; the E2E dispatch flow itself is the main source of observed failures.

## 6. Recommended Next Steps

1. Fix F-A / P0-1 in `.opencode/scripts/command-tools/dispatch-subagent.ts`: import `checklistWirePassed` or use a typed helper, and make marking failure fatal in strict/locked.
2. Drain transient armed sessions from the E2E verification flow.
3. Clear Check 35 stale entries via `knowledge_cache_search` re-run or janitor cleanup.
4. Re-run static and runtime E2E acceptance.
5. After F-A is resolved, behaviorally verify Phase H, I, and G.

## 7. Evidence File Index

| File | Role |
|------|------|
| `.task_temp/E2E-FRAMEWORK-STATIC-VFY/HANDOVER.md` | Static verification narrative |
| `.task_temp/E2E-FRAMEWORK-STATIC-VFY/test_report.json` | Static verification structured evidence |
| `.task_temp/E2E-FRAMEWORK-RUNTIME-VFY/HANDOVER.md` | Runtime verification narrative |
| `.task_temp/E2E-FRAMEWORK-RUNTIME-VFY/test_report.json` | Runtime verification structured evidence |
| `docs/review/framework-refactor/db-canonical-p0-checklist-optimization-plan.md` | Target architecture and acceptance criteria |
| `docs/review/framework-refactor/db-canonical-p0-checklist-implementation-audit-and-fix-plan.md` | Prior audit with P0-1..P0-8 and Phase G/H/I/J/K |
| `docs/review/framework-refactor/sa-unresolved-findings-root-cause-analysis.md` | F-A..F-J consolidated root causes |

## 8. Change Log

| Date | Version | Change |
|------|---------|--------|
| 2026-06-23 | 1.0.0 | Initial discovery-process document |
