# Blueprint: MCP Session Propagation (v37)

## Status: Mostly Implemented - Closure Still Pending

> **Last updated**: 2026-07-10 (re-audited after framework update)
> **Schema version**: v37

## Goal

Replace `process.env.OPENCODE_SESSION_ID` with DB-backed `gate_call_context` table for session identity propagation across the MCP gate lifecycle (check -> confirm -> submit -> approve -> complete).

## Architecture

### Data Model (v37 schema)

- **gate_call_context** table: Records each MCP tool invocation with:
  - `tool_name`, `gate_session_id`, `opencode_session_id`, `parent_session_id`
  - `call_id` (unique per tool call)
  - `agent`, `args_hash` (SHA-256 of full args)
  - `status` (pending / completed / interrupted / consumed)
  - Timestamps: `created_at`, `completed_at`, `interrupted_at`, `consumed_at`

- **gate_sessions** table (6 new columns):
  - `parent_opencode_session_id`, `child_opencode_session_id`
  - `last_submit_session_id`, `last_approve_session_id`
  - `interrupted_at`, `interruption_source`

### Lifecycle

```
before-hook (recordGateCallContext)
    |
    v
MCP tool handler (resolveGateCallContextStrict)
    |
    v
Service function (business logic)
    |
    v
completeGateCallContextBySession (mark completed)
```

## Design Principles

1. **Exact match / fail closed**: active code path no longer falls back to "latest pending by gate_session_id" when strict lookup misses.
2. **MVC layering**: Controllers (mcp-confirm.ts, mcp-deliverables.ts, mcp-complete.ts) MUST NOT contain raw SQL. All DB operations go through `session-context-service.ts`.
3. **Concurrency safety**: `args_hash` is computed from the full MCP tool args (matching the before-hook's hash). `call_id` exists in the service API, but is not yet wired from the MCP thin shell into resolver calls.
4. **Parent/child session binding**: Confirm establishes binding; submit/approve/complete validate caller identity against binding.

## Re-audit Summary (2026-07-10)

Verified against current code:

- v37 schema migration and DB columns are present.
- `mcp-confirm.ts` no longer contains the old `gate_session_id + latest pending` fallback block.
- `mcp-confirm.ts` no longer performs inline SQL; completion marking moved into `session-context-service.ts`.
- `compliance-gate.ts` now passes raw MCP args into confirm / submit / approve / complete, and those services recompute `args_hash` from the raw args.

Still not sufficient for blueprint closure:

1. **`call_id` is not actually used end-to-end**  
   `gate_call_context` records `call_id`, and `resolveGateCallContextStrict()` accepts it, but the MCP thin shell only passes `args`, not `call_id`, so active resolution still relies on `tool_name + gate_session_id + args_hash` rather than `call_id`-anchored lookup.

2. **Completion marking is still session-scoped, not call-scoped**  
   `completeGateCallContextBySession()` updates every pending `gate_call_context` row for the same `opencode_session_id`. That is better than inline SQL in the controller, but it is not yet a single-call exact completion model.

3. **A legacy fallback helper still exists in the service layer**  
   `resolveGateCallContextBySession()` is no longer used by the active confirm path, but it remains in the service file. This means the repository is closer to the blueprint, but not yet fully cleaned up to a single exact-match story.

## Implementation Checklist

- [x] v37 schema migration (gate_call_context table + gate_sessions columns)
- [x] session-context-service.ts: Full service layer with all CRUD operations
- [x] before-hook: gate-call-context.ts records context for all 5 gate tools
- [x] session.ts plugin: Writes session_map on session.created
- [x] mcp-confirm.ts: Exact match / fail-closed (no fallback-to-latest)
- [x] mcp-confirm.ts: No inline SQL (uses completeGateCallContextBySession)
- [x] mcp-deliverables.ts: Correct args_hash from raw MCP args
- [x] mcp-complete.ts: Correct args_hash from raw MCP args
- [x] compliance-gate.ts: Passes raw args to all service functions
- [x] resolveGateCallContextStrict: Supports `call_id` at API level
- [ ] MCP entrypoints pass `call_id` into strict resolver calls
- [ ] Context completion is narrowed from session-wide completion to single-call completion
- [ ] Remove dead fallback helper `resolveGateCallContextBySession()` if no longer needed

## Verification Requirements

See `runtime-verification-report.md` for E2E test results.

Required evidence for blueprint closure:
1. serve API E2E: Orchestrator dispatch -> sub-agent calls gate tools -> session propagation verified
2. Strict resolution: No fallback-to-latest in any code path
3. MVC compliance: Zero raw SQL in controller files
4. Concurrency: args_hash matches between before-hook and service
5. Resolver path uses `call_id` where available, or the blueprint is explicitly relaxed to accept args-hash-only resolution
6. Context completion is exact to the current call, not bulk-by-session
