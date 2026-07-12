# Plugin Handler Manifest (Phase 2 — 2026-07-12)

**Source of truth:** `project.config.json` `execution_order` + dispatcher `HANDLER_MAP` + dynamic `require()` delegate edges.

**Status vocabulary:**
- `active-direct` — registered in a dispatcher `HANDLER_MAP` and executed directly.
- `active-delegate` — not in a top-level `HANDLER_MAP`, but reached via `require()` from an `active-direct` handler.
- `retired-rollback` — labelled `LEGACY HANDLER`, not in any active `HANDLER_MAP`, not a delegate target. Kept for rollback only.
- `deleted` — removed from the tree (archive / cleanup).

## Before chain (dispatcher: before-dispatcher.ts, 11 active)

| Handler file | Status | Notes |
|---|---|---|
| gate-call-context.ts | active-direct | in HANDLER_MAP |
| codegraph.ts | active-direct | in HANDLER_MAP |
| scope.ts | active-direct | in HANDLER_MAP (also a delegate target) |
| guidance-bridge.ts | active-direct | in HANDLER_MAP; delegates to before/anti-bypass |
| permission-safety.ts | active-direct | in HANDLER_MAP; delegates to config-guard, git-guard |
| dispatch-signal.ts | active-direct | in HANDLER_MAP |
| skill-policy.ts | active-direct | in HANDLER_MAP |
| behavioral-path-guard.ts | active-direct | in HANDLER_MAP |
| task.ts | active-direct | in HANDLER_MAP (dispatch marker consumption) |
| tool-governance-handler.ts | active-direct | in HANDLER_MAP |
| path-validate.ts | active-direct | in HANDLER_MAP |
| anti-bypass.ts | active-delegate | required by guidance-bridge (relabelled LEGACY→DELEGATE this phase) |
| config-guard.ts | active-delegate | required by permission-safety (relabelled LEGACY→DELEGATE this phase) |
| git-guard.ts | active-delegate | required by permission-safety (relabelled LEGACY→DELEGATE this phase) |
| uc7ks.ts | retired-rollback | imported by dispatcher but excluded from HANDLER_MAP; audit_only |
| tdd.ts | retired-rollback | LEGACY, no active caller |
| dispatch.ts | retired-rollback | LEGACY; superseded by dispatch-signal |
| question-policy.ts | retired-rollback | LEGACY, no active caller |
| checklist.ts | retired-rollback | LEGACY, no active caller |
| json-validate.ts | retired-rollback | LEGACY, no active caller |
| phase0-enforce.ts | retired-rollback | LEGACY, no active caller |
| gate.ts | deleted | removed from tree (rollback-only) |

## After chain (dispatcher: after-dispatcher.ts, 7 active)

| Handler file | Status | Notes |
|---|---|---|
| gate-call-context.ts | active-direct | in HANDLER_MAP |
| db-health.ts | active-direct | in HANDLER_MAP |
| unified-audit.ts | active-direct | in HANDLER_MAP; delegates to read-track / scope / codegraph |
| skill-audit.ts | active-direct | in HANDLER_MAP |
| quality-contract.ts | active-direct | in HANDLER_MAP; delegates to format / tdd |
| dispatch-trace.ts | active-direct | in HANDLER_MAP; delegates to after/dispatch |
| guidance-recovery.ts | active-direct | in HANDLER_MAP; delegates to after/anti-bypass |
| anti-bypass.ts | active-delegate | required by guidance-bridge / guidance-recovery (already DELEGATE) |
| dispatch.ts | active-delegate | required by dispatch-trace (already DELEGATE) |
| scope.ts | active-delegate | delegate target (already DELEGATE) |
| codegraph.ts | active-delegate | delegate target (already DELEGATE) |
| format.ts | active-delegate | delegate target (already DELEGATE) |
| read-track.ts | active-delegate | delegate target (already DELEGATE) |
| tdd.ts | active-delegate | delegate target (already DELEGATE) |
| cache.ts | retired-rollback | LEGACY, no active caller |
| uc7ks.ts | retired-rollback | LEGACY, no active caller |
| task.ts | retired-rollback | LEGACY; superseded by before/task |
| audit.ts | retired-rollback | LEGACY; merged into unified-audit |
| gate.ts | deleted | removed from tree |

## System chain (dispatcher: system-dispatcher.ts)

| Handler file | Status | Notes |
|---|---|---|
| skill-summary.ts | active-direct | in system HANDLER_MAP |
| anti-bypass.ts | active-direct | in system HANDLER_MAP (canonical active anti-bypass) |

## Unused dispatcher imports removed this phase
- `before-dispatcher.ts`: removed `import * as uc7ks` (excluded from HANDLER_MAP).
- `after-dispatcher.ts`: removed `import * as auditHandler` (excluded from HANDLER_MAP).

## Validation
- `rg -n "LEGACY HANDLER" .opencode/plugin-handlers` → only retired-rollback files remain labelled LEGACY.
- `bun test .opencode/plugin-handlers` → green.
- Every handler in `plugin_execution_order` exists in `HANDLER_MAP`; every dynamic delegate is documented above.
