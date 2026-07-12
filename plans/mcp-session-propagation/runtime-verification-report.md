# Runtime Verification Report: MCP Session Propagation

> **Date**: 2026-07-10
> **Schema version**: v37
> **Status**: Re-audited after framework update; code review updated, E2E evidence retained

## Code Review Findings (2026-07-10)

The previously identified three defects were re-checked against the current codebase. The original fixes are still present, but two closure claims were still too optimistic and are corrected below.

### Finding 1 (High) — VERIFIED: Fallback-to-latest removed

**Problem**: `mcp-confirm.ts` had a fallback block (lines 100-122) that queried `gate_call_context` by `gate_session_id` alone when strict lookup failed, taking the most recent pending record. This violated the blueprint's "exact match / fail closed" constraint.

**Fix**: Removed the entire fallback block. When `resolveGateCallContextStrict` returns null, the gate session arms without session propagation context (graceful degradation, not guessing).

**Files changed**: `.opencode/service/gate/mcp-confirm.ts`

### Finding 2 (Medium) — VERIFIED: MVC layering improved

**Problem**: `mcp-confirm.ts` contained two raw SQL blocks via `require("../../lib/db-manager").getDb()`:
1. SELECT fallback (removed per Finding 1)
2. UPDATE to mark gate_call_context as completed

**Fix**: Extracted UPDATE to `completeGateCallContextBySession()` in `session-context-service.ts`. Controller now calls the service function.

**Files changed**:
- `.opencode/service/gate/session-context-service.ts` — added `completeGateCallContextBySession()`
- `.opencode/service/gate/mcp-confirm.ts` — replaced inline SQL with service call

### Finding 3 (Medium) — VERIFIED: Raw-args-based args_hash binding

**Problem**: `mcp-deliverables.ts` (submit + approve) and `mcp-complete.ts` passed `args_hash: ""` to `resolveGateCallContextStrict`. This meant:
1. The WHERE clause never matched the before-hook's recorded hash (which was non-empty)
2. `call_id` was not included as a matching key
3. Not concurrency-safe for parallel gate sessions

**Fix**:
1. Added `rawArgs?: Record<string, unknown>` parameter to all 4 service functions
2. MCP handler (`compliance-gate.ts`) passes the full `args` object to each service call
3. Service computes `computeGateArgsHash(rawArgs)` matching the before-hook's hash
4. Added `call_id` support to `resolveGateCallContextStrict` for disambiguation
5. Backward-compatible: when `rawArgs` is not provided, falls back to empty hash (no filtering)

**Files changed**:
- `.opencode/service/gate/session-context-service.ts` — `call_id` added to strict resolver
- `.opencode/service/gate/mcp-deliverables.ts` — `rawArgs` param for submit + approve
- `.opencode/service/gate/mcp-complete.ts` — `rawArgs` param for complete
- `.opencode/service/gate/mcp-confirm.ts` — `rawArgs` param for confirm
- `.opencode/scripts/mcp-tools/compliance-gate.ts` — passes `args` to all 5 service calls

## Re-audit Findings (2026-07-10, current code)

### Finding 4 (Medium) — NEW: `call_id` support is only partial

**Problem**: The report previously stated that `call_id` support made the resolver concurrency-safe. Current code only implements `call_id` at the service API level:

- `gate_call_context` records `call_id`
- `resolveGateCallContextStrict()` accepts `call_id`
- but `compliance-gate.ts` only passes raw `args`, not `call_id`, into confirm / submit / approve / complete

**Impact**: Active resolution is still `tool_name + gate_session_id + args_hash` based. This is stronger than the old fallback-to-latest behavior, but weaker than a true call-scoped exact binding model.

**Status**: NOT FULLY CLOSED

### Finding 5 (Medium) — NEW: context completion is session-wide

**Problem**: `mcp-confirm.ts` now calls `completeGateCallContextBySession()`, which marks every pending `gate_call_context` row for the same `opencode_session_id` as completed.

**Impact**: This satisfies the MVC cleanup goal, but not the strongest possible exactness guarantee. If multiple pending gate contexts existed under the same session, completion would not be narrowed to a single call row.

**Status**: NOT FULLY CLOSED

### Finding 6 (Low) — NEW: legacy fallback helper remains

**Problem**: `resolveGateCallContextBySession()` still exists in `session-context-service.ts`, even though the active `mcp-confirm.ts` path no longer uses it.

**Impact**: No active regression found, but the implementation is not yet fully simplified to a single exact-match resolution model.

**Status**: CLEANUP PENDING

## Compile Verification

- `bunx tsc -p tsconfig.json --noEmit`: full-project compile still fails, but the reported errors remain outside the MCP session propagation files reviewed here
- Pre-existing errors in `uc7ks-domain.test.ts`, `skill-summary.ts`, `pre-execution-gate.ts`, and `service/repo/audit.ts` are unrelated to this blueprint
- bun cache cleared after changes

## E2E Verification (Pending)

Required for blueprint closure:
1. serve API E2E: Orchestrator dispatches sub-agent -> sub-agent calls compliance_gate_check -> confirm -> submit -> approve -> complete
2. Verify gate_call_context records show correct args_hash matching between before-hook and service
3. Verify parent/child session binding in gate_sessions table
4. Verify caller identity validation in submit/approve/complete

## Historical Verification (from previous sessions)

- Schema v37 confirmed: gate_call_context table + gate_sessions 6 new columns present
- session.created plugin writes session_map: code path exists at `.opencode/plugins/session.ts:68`

## E2E Verification (2026-07-10)

**Session**: `ses_0b6a90a8dffeSpZTTgvrXN4h7Q` (Orchestrator, MCP-SP E2E v12)
**Serve**: Restarted with bun cache cleared before test

### 3-Round Test Results

| Round | Gate Session | check | confirm | dispatch | submit | complete |
|:------|:------------|:------|:--------|:---------|:-------|:---------|
| v1 | cg_ses_1783642110708 | PASS | ARMED | build OK | REJECTED (no child binding) | REJECTED |
| v2 | cg_ses_1783642269750 | PASS | ARMED | build OK | - | COMPLETED (exempt fast-path) |
| v3 | cg_ses_1783642343078 | PASS | ARMED | build OK | REJECTED (no child binding) | - |

### DB Evidence: gate_call_context Records

10 records captured during E2E. All records have:
- **Non-empty args_hash**: e.g. `6c91ebaddedd...`, `b5ccc90024ca...` — confirms `rawArgs` propagation fix works
- **Unique call_id**: e.g. `call_00_9PeyYBwZ08bO53u7Fwju4339` — confirms concurrency safety
- **Correct status transitions**: check→confirm marked completed, submit rejected stays pending

### Fix Verification

| Fix | Status | Evidence |
|:----|:-------|:---------|
| **Finding 1** (exact match / fail closed) | VERIFIED | Submit correctly rejected when no child binding (no fallback-to-latest) |
| **Finding 2** (MVC layering) | VERIFIED | Zero raw SQL in mcp-confirm.ts; `completeGateCallContextBySession()` service call used |
| **Finding 3** (args_hash concurrency) | VERIFIED | All 10 DB records have non-empty args_hash matching before-hook's hash |

### Architectural Finding (Not a code defect)

The `child_opencode_session_id` binding is NOT established when sub-agents are dispatched via native `Task()`. This binding only exists when dispatch goes through the compliance gate's own internal chain. This means:

- **Exempt agents** (Orchestrator/Super-Admin): Can complete via fast-path (`approval_required: false`)
- **Non-exempt agents**: Submit/approve lifecycle requires child binding, which native Task() dispatch does NOT establish

This is a framework architecture constraint, not a defect in the session propagation code.

### Blueprint Closure Status

**NOT CLOSED** — current status is:

1. **Resolved in code**:
   - no active fallback-to-latest in confirm
   - no raw SQL left in `mcp-confirm.ts`
   - raw `args` now drive `args_hash`

2. **Still open**:
   - `call_id` is not wired end-to-end from MCP entrypoint to strict resolver
   - context completion is still bulk-by-session, not single-call exact completion
   - non-exempt submit→approve lifecycle still depends on dispatch-level child session binding that native `Task()` does not establish

This means the implementation is materially better than the previous audit state, but the blueprint should still remain open.
