# Handler Manifest (Phase 2 — 2026-07-12)

**Authoritative status table for every plugin handler file.**
**Source of truth:** `project.config.json` `plugin_execution_order` + dispatcher `HANDLER_MAP` + dynamic `require()` delegate edges.

**Status vocabulary (one status per file):**
- `active-direct` — registered in a dispatcher `HANDLER_MAP` and executed directly.
- `active-delegate` — not in a top-level `HANDLER_MAP`, but reached via `require()` from an `active-direct` handler.
- `retired-rollback` — labelled `RETIRED-ROLLBACK`, not in any active `HANDLER_MAP`, not a delegate target. Kept for rollback only (NOT deleted — deletion is a later phased commit).
- `archived` — removed from the working tree (deleted), retained only in git history.

## Before chain (dispatcher: before-dispatcher.ts — 11 active in HANDLER_MAP)

| Handler file | Status | Basis |
|---|---|---|
| gate-call-context.ts | active-direct | in HANDLER_MAP |
| codegraph.ts | active-direct | in HANDLER_MAP |
| scope.ts | active-direct | in HANDLER_MAP (also delegate target of after/unified-audit) |
| guidance-bridge.ts | active-direct | in HANDLER_MAP; delegates to `./anti-bypass` |
| permission-safety.ts | active-direct | in HANDLER_MAP; delegates to `./config-guard`, `./git-guard` |
| dispatch-signal.ts | active-direct | in HANDLER_MAP |
| skill-policy.ts | active-direct | in HANDLER_MAP |
| behavioral-path-guard.ts | active-direct | in HANDLER_MAP |
| task.ts | active-direct | in HANDLER_MAP |
| tool-governance-handler.ts | active-direct | in HANDLER_MAP (key `tool-governance`) |
| path-validate.ts | active-direct | in HANDLER_MAP |
| anti-bypass.ts | active-delegate | required by `guidance-bridge` (relabelled LEGACY→DELEGATE this phase) |
| config-guard.ts | active-delegate | required by `permission-safety` (already DELEGATE) |
| git-guard.ts | active-delegate | required by `permission-safety` (already DELEGATE) |
| uc7ks.ts | retired-rollback | dead dispatcher import removed; not in HANDLER_MAP |
| tdd.ts | retired-rollback | no active caller |
| dispatch.ts | retired-rollback | superseded by `dispatch-signal` |
| question-policy.ts | retired-rollback | no active caller |
| checklist.ts | retired-rollback | no active caller |
| json-validate.ts | retired-rollback | no active caller |
| phase0-enforce.ts | retired-rollback | no active caller |
| gate.ts | archived | deleted from tree |

## After chain (dispatcher: after-dispatcher.ts — 7 active in HANDLER_MAP)

| Handler file | Status | Basis |
|---|---|---|
| gate-call-context.ts | active-direct | in HANDLER_MAP |
| db-health.ts | active-direct | in HANDLER_MAP |
| unified-audit.ts | active-direct | in HANDLER_MAP; delegates to `./read-track`, `./scope`, `./codegraph` |
| skill-audit.ts | active-direct | in HANDLER_MAP |
| quality-contract.ts | active-direct | in HANDLER_MAP; delegates to `./format`, `./tdd` |
| dispatch-trace.ts | active-direct | in HANDLER_MAP; delegates to `./dispatch` |
| guidance-recovery.ts | active-direct | in HANDLER_MAP; delegates to `./anti-bypass` |
| anti-bypass.ts | active-delegate | required by `guidance-recovery` (already DELEGATE) |
| dispatch.ts | active-delegate | required by `dispatch-trace` (already DELEGATE) |
| scope.ts | active-delegate | delegate target of `unified-audit` (already DELEGATE) |
| codegraph.ts | active-delegate | delegate target of `unified-audit` (already DELEGATE) |
| format.ts | active-delegate | delegate target of `quality-contract` (already DELEGATE) |
| read-track.ts | active-delegate | delegate target of `unified-audit` (already DELEGATE) |
| tdd.ts | active-delegate | delegate target of `quality-contract` (already DELEGATE) |
| cache.ts | retired-rollback | no active caller |
| uc7ks.ts | retired-rollback | no active caller |
| task.ts | retired-rollback | superseded by before/task |
| audit.ts | retired-rollback | merged into `unified-audit`; dead dispatcher import removed |
| gate.ts | archived | deleted from tree |

## System chain (dispatcher: system-dispatcher.ts)

| Handler file | Status | Basis |
|---|---|---|
| skill-summary.ts | active-direct | in system HANDLER_MAP |
| anti-bypass.ts | active-direct | in system HANDLER_MAP (canonical active anti-bypass) |

## Delegate-reachability summary (dynamic require() edges)

| Requiring handler (active) | Required target | Target status |
|---|---|---|
| before/guidance-bridge.ts:8 | `./anti-bypass` | active-delegate |
| before/permission-safety.ts:8 | `./config-guard` | active-delegate |
| before/permission-safety.ts:19 | `./git-guard` | active-delegate |
| after/guidance-recovery.ts:8 | `./anti-bypass` | active-delegate |
| after/dispatch-trace.ts:14 | `./dispatch` | active-delegate |
| after/unified-audit.ts:16 | `./read-track`, `./scope`, `./codegraph` | active-delegate (all three) |
| after/quality-contract.ts:201 | `./format`, `./tdd` | active-delegate (both) |

No `retired-rollback` file is a `require()` target of any active or delegate handler.

## Dead dispatcher imports removed this phase

- `before-dispatcher.ts`: removed `import * as uc7ks from "../plugin-handlers/before/uc7ks";` — imported but **not** placed in `HANDLER_MAP` (confirmed dead; `uc7ks` is `retired-rollback`).
- `after-dispatcher.ts`: removed `import * as auditHandler from "../plugin-handlers/after/audit";` — imported but **not** placed in `HANDLER_MAP` (confirmed dead; `audit` is `retired-rollback`).

## Validation

- `rg -n "LEGACY HANDLER" .opencode/plugin-handlers` → zero results (all handler `.ts` files relabelled `DELEGATE HANDLER` or `RETIRED-ROLLBACK`).
- `bun build` on each changed `.ts` file → no syntax errors.
- Every handler in `plugin_execution_order` exists in its `HANDLER_MAP`; every dynamic delegate is documented above.
