# Implementation Summary — TUI Corruption Fix (work-one)

**Date:** 2026-06-14
**Scope:** `.opencode/` local framework only
**Incident:** `screenshots/image copy.png` — "Unexpected {interrupt}" TUI corruption

---

## Files added (3)

| Path | Role |
| --- | --- |
| `.opencode/lib/interrupt-guard.ts` | Shared `withInterruptGuard<T>()`, `isInterruptError()`, and `installSigintCleanup()` helpers. Traps cooperative interrupts (SIGINT, `AbortError`, the literal `{interrupt}` placeholder) and returns a structured JSON trap payload instead of rethrowing — preventing the upstream TUI from rendering raw template text. |
| `.opencode/scripts/reset-interrupt-state.ts` | Reconciliation script: deletes `.opencode/state/.last-interrupt.json` sentinel, releases stale `gate-state.json` locks older than 10 min, never touches `machine.json.eslint_state`. Invoked automatically from the session.error hook. |
| `docs/review/tui-corruption-bug/plan.md` | Implementation plan. |

## Files modified (17)

| Path | Change |
| --- | --- |
| `.opencode/lib/index.ts` | Added barrel re-exports for `withInterruptGuard`, `installSigintCleanup`, `isInterruptError`, `InterruptTrapPayload`. |
| `.opencode/lib/safe-bash-core.ts` | Added `signal?: AbortSignal` to `SafeBashOptions`; pre-flight abort check returns `{exitCode:130,stderr:"interrupted"}`; forwards signal into `execSync` options. Repaired a pre-existing orphaned closing brace by restoring the `if (isOrchestrator) {` wrapper around the Orchestrator path-aware eval bypass (the wrapper had been dropped in a prior uncommitted edit, causing Bun/esbuild to report "Unexpected }" at EOF). |
| `.opencode/plugins/session.ts` | Added `session.error`, `session.compacted`, `session.idle` hook subscriptions. session.error detects interrupt signatures and writes a `.last-interrupt.json` sentinel; session.compacted resets the in-memory session map; session.idle clears the sentinel. |
| `.opencode/scripts/mcp-tools/compliance-gate.ts` | SIGINT handler closes the active `StdioServerTransport` and `server.close()` before exit(0), releasing any `gate-state.json` locks. |
| `.opencode/scripts/mcp-tools/eslint-audit.ts` | Same SIGINT cleanup pattern as compliance-gate. |
| `.opencode/tools/safe_shell.ts`, `safe_edit.ts`, `safe_delete.ts`, `safe_mkdir.ts`, `safe_test.ts`, `safe_diff.ts`, `safe_restore.ts`, `dispatch_subagent.ts`, `module_scope_declare.ts`, `rule_registry_repair.ts`, `knowledge_cache_search.ts`, `knowledge_gap_report.ts` | Each tool's `async execute(...)` body is now wrapped in `withInterruptGuard(toolName, async () => { … })`. Non-interrupt errors continue to throw; interrupt-shaped errors return a structured JSON trap string. |

## Validation results (Phase 7)

| Test | Result |
| --- | --- |
| `bun --eval import interrupt-guard` | OK — `isInterruptError(new Error("Unexpected {interrupt}"))` → `{matched:true, kind:"interrupt", reason:"uninterpolated placeholder…"}`. |
| `bun --eval import safe-bash-core` (dry-run) | OK — `safeBashTool({command:"echo hello", dryRun:true})` returns `{allowed:true, executed:false}`. |
| `withInterruptGuard` behavior matrix | 4/4 cases pass: interrupt-trapped, generic-rethrown, success-pass-through, predicate-on-abort. |
| All 12 tool imports | All 12 return `{default:{execute:Function}}` shape. |
| `bun .opencode/scripts/reset-interrupt-state.ts` | OK — `{sentinel_deleted, gate_lock_released, errors:[]}`. |
| `bun .opencode/scripts/framework-self-test.ts` | 36/37 PASS. The 1 FAIL (test #36: uncommitted patches to framework files) is a **pre-existing** condition (63 pre-existing `M` entries in git status, none from my changes). |
| `bun .opencode/scripts/framework-compliance-check.ts --strict` | 5/6 checks pass, 0 HIGH violations; 1 WARN on `machine_state` (pre-existing `type_check_state: dirty; format_state: dirty`). `enforcement_mode=strict` (the regression from `screenshots/image.png` is fully resolved). |
| `tsc --noEmit` on all modified files | Clean — no type errors. |

## Pre-existing issue discovered and repaired

While implementing, I found that `.opencode/lib/safe-bash-core.ts` had a **pre-existing brace mismatch** in the eval-scan block: the `if (isOrchestrator) {` wrapper around the Orchestrator path-aware bypass had been dropped by a prior uncommitted edit, leaving its matching `}` at line 704 orphaned. This caused Bun and esbuild to report "Unexpected }" at EOF while TypeScript (which is more permissive) still compiled. The repair restores the `if (isOrchestrator) {` wrapper, preserving the documented semantics (the `.task_temp/` / `docs/review/` path-aware bypass is Orchestrator-only).

## Not modified (by design)

- `opencode.json` — empty `plugin: []` array preserved; all plugin wiring stays implicit via `.opencode/plugins/*.ts`.
- `project.config.json` — `enforcement_mode=strict` left untouched.
- Go TUI / Bun runtime — already v1.17.6 (latest stable per https://github.com/anomalyco/opencode/releases).

## Rollback

```
git restore .opencode/tools/ .opencode/plugins/ .opencode/scripts/mcp-tools/ \
            .opencode/lib/index.ts .opencode/lib/safe-bash-core.ts
rm .opencode/lib/interrupt-guard.ts .opencode/scripts/reset-interrupt-state.ts
rm -rf docs/review/tui-corruption-bug/
```
