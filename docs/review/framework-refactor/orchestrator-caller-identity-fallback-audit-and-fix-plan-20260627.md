# Orchestrator Caller Identity Fallback Audit And Fix Plan (2026-06-27)

## Scope

This document audits the following claim against current code, current DB state, `.task_temp/_logs/2026-06-27/`, and the last 2 hours of `.task_temp/.backups/` snapshots:

> "The problem is in `task-after.ts` or `session.ts` - after `Task()` returns, the `session_map.agent` field is overwritten with the last executed sub-agent. Actually, `session_map.agent` should only record the original dispatcher (Orchestrator), and must not be overwritten by the child agent."

## Verdict

The analysis is **partially true on the symptom, but false on the root cause**.

What is true:

- `dispatch-before.ts` did later see `caller=@Knowledge-Curator` and blocked `Super-Admin` dispatches with M14.
- The blocked calls happened in the same Orchestrator session `ses_0f85732e1ffevhohXKtRBBD1br`.

What is not supported by evidence:

- I do **not** have sufficient evidence that `task-after.ts` or `session.ts` overwrote the Orchestrator session row in `session_map` with `Knowledge-Curator`.
- The stronger evidence points to a different failure mode:
  1. exact caller resolution for the Orchestrator session failed,
  2. `resolveCallerIdentity()` fell back to the global "latest dispatch" query,
  3. that fallback returned `@Knowledge-Curator`,
  4. M14 then blocked `Super-Admin`.

## Evidence

### 1. The observed symptom is real

In `dispatch-before.ts`, privileged routing depends on `resolveCallerIdentity(input.sessionID)`:

- [.opencode/plugins/dispatch-before.ts:69](/home/zhaoge/workspace/opencode/work-one/.opencode/plugins/dispatch-before.ts:69)
- [.opencode/plugins/dispatch-before.ts:105](/home/zhaoge/workspace/opencode/work-one/.opencode/plugins/dispatch-before.ts:105)

Relevant code:

```ts
const caller = resolveCallerIdentity(input.sessionID) || "";
const isOrchestratorOrSA = isPrivileged(caller);
if (!isOrchestratorOrSA && target && !isKCTarget) {
```

The log shows the same Orchestrator session first dispatching `Super-Admin` successfully, then later being interpreted as `@Knowledge-Curator`:

- [.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log:121](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log:121)
  - `enter | caller=@Orchestrator | target=Super-Admin | dag_task_id=FIX-TSC-LOGFIELDS-001`
- [.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log:129](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log:129)
  - `enter | caller=@Orchestrator | target=Super-Admin | dag_task_id=FIX-TSC-LOGFIELDS-002`
- [.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log:135](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log:135)
  - `enter | caller=@Knowledge-Curator | target=Super-Admin | dag_task_id=FIX-TSC-LOGFIELDS-003`
- [.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log:136](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log:136)
  - `M14 BLOCKED | caller=@Knowledge-Curator is a sub-agent, only target=Knowledge-Curator is allowed. Attempted target=Super-Admin.`
- [.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log:139](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log:139)
  - `enter | caller=@Knowledge-Curator | target=Super-Admin | dag_task_id=FIX-TSC-LOGFIELDS-003`
- [.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log:141](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log:141)
  - `enter | caller=@Knowledge-Curator | target=Super-Admin | dag_task_id=FIX-TSC-ALL-004`

### 2. The current implementation does not support the claimed overwrite theory

`resolveCallerIdentity()` currently uses this order:

- `context.agent`
- exact `session_map` row for `sessionID`
- matching `gate_sessions.opencode_session_id`
- **global latest session_map row**
- `FRAMEWORK_AGENT`

See:

- [.opencode/lib/agent-resolver.ts:636](/home/zhaoge/workspace/opencode/work-one/.opencode/lib/agent-resolver.ts:636)
- [.opencode/lib/agent-resolver.ts:653](/home/zhaoge/workspace/opencode/work-one/.opencode/lib/agent-resolver.ts:653)
- [.opencode/lib/agent-resolver.ts:685](/home/zhaoge/workspace/opencode/work-one/.opencode/lib/agent-resolver.ts:685)

Relevant code:

```ts
// Priority: context.agent -> session_map -> gate_session -> latest dispatch -> UNRESOLVED marker.
```

At the blocked timestamps, resolver logs show that exact session resolution failed first, and the chosen value came from the unsafe global fallback:

- [.task_temp/_logs/2026-06-27/plugin-lib-agent-resolver-runtime.log:39000](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-lib-agent-resolver-runtime.log:39000)
  - `AGENT-RESOLUTION-FAILED | resolveAgent: ALL sources exhausted ...`
- [.task_temp/_logs/2026-06-27/plugin-lib-agent-resolver-runtime.log:39002](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-lib-agent-resolver-runtime.log:39002)
  - `CALLER-IDENTITY-FALLBACK | latest dispatch -> @Knowledge-Curator`
- [.task_temp/_logs/2026-06-27/plugin-lib-agent-resolver-runtime.log:39111](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-lib-agent-resolver-runtime.log:39111)
  - `CALLER-IDENTITY-FALLBACK | latest dispatch -> @Knowledge-Curator`

This is incompatible with the overwrite claim. If the same-session row had really been overwritten to `Knowledge-Curator`, the resolver would have logged `session_map -> @Knowledge-Curator`, not `latest dispatch -> @Knowledge-Curator`.

### 3. The current cleanup logic can delete valid primary-session rows

`session.ts` startup cleanup currently deletes any `session_map` row whose `session_id` is absent from `session_log`:

- [.opencode/plugins/session.ts:280](/home/zhaoge/workspace/opencode/work-one/.opencode/plugins/session.ts:280)
- [.opencode/plugins/session.ts:285](/home/zhaoge/workspace/opencode/work-one/.opencode/plugins/session.ts:285)

Relevant code:

```ts
DELETE FROM session_map
WHERE session_id NOT IN (
  SELECT DISTINCT session_id FROM session_log WHERE session_id IS NOT NULL
)
```

That is unsafe for primary sessions, because current evidence shows the affected Orchestrator session is **not** represented in `session_log`.

Shell query result used in this audit:

```text
ses_0f85732e1ffevhohXKtRBBD1br    0
ses_0f7cdac7fffeXOVJCLlnvIEtYc    0
ses_0f7cd30c9ffevXquo43lvcJjtX    0
```

This means the Orchestrator session matches the cleanup delete predicate even when it is still valid.

The timing also fits. Shortly after the successful Orchestrator dispatch, other sessions ran startup cleanup and removed orphan session rows:

- [.task_temp/_logs/2026-06-27/plugin-session-runtime.log:1573](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-session-runtime.log:1573)
  - `SESSION-MAP-ORPHAN-CLEANUP | 2 orphan session_map entries removed`
- [.task_temp/_logs/2026-06-27/plugin-session-runtime.log:1585](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-session-runtime.log:1585)
  - `SESSION-MAP-ORPHAN-CLEANUP | 2 orphan session_map entries removed`

I do **not** have sufficient evidence to prove which exact row was deleted in those cleanup batches, because the cleanup log does not list deleted `session_id`s. But the delete predicate and the `session_log` query above make this the strongest explanation.

### 4. The current DB state matches "row was missing, then later rewritten", not "row was permanently overwritten"

Current DB query result:

```json
{
  "session_id": "ses_0f85732e1ffevhohXKtRBBD1br",
  "agent": "Orchestrator",
  "dag_task_id": null,
  "domain_id": null
}
```

That current row is consistent with the later Orchestrator chat hook re-writing its own mapping:

- [.task_temp/_logs/2026-06-27/plugin-session-runtime.log:1593](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-session-runtime.log:1593)
  - `CHAT-HOOK | enter` for `ses_0f85732e1ffevhohXKtRBBD1br`
- [.task_temp/_logs/2026-06-27/plugin-session-runtime.log:1605](/home/zhaoge/workspace/opencode/work-one/.task_temp/_logs/2026-06-27/plugin-session-runtime.log:1605)
  - `CHAT-HOOK | exit (ok) map size=5`

### 5. The last 2 hours of snapshots do not show recent edits to the implicated code path

The last 2 hours of `.task_temp/.backups/` contained:

- DB bloat backup files:
  - `framework-state.db.bloat-backup-20260627`
  - `framework-state.db-wal.bloat-backup-20260627`
- later DB backup:
  - `framework-state.db.bloat-backup-2026-06-27T08-02-55`
- deliverable backups such as `HANDOVER.md` and `INVOCATION_SUMMARY.md`

I did **not** find 2-hour snapshot backups for:

- `.opencode/lib/agent-resolver.ts`
- `.opencode/plugins/session.ts`
- `.opencode/plugins/task-after.ts`
- `.opencode/plugins/dispatch-before.ts`

So this audit is grounded in live code plus logs, not in a fresh code change to these files within the last 2 hours.

## Audited Root Cause

The best-supported root cause is:

1. primary-session caller identity is not modeled as durable DB-canonical state with its own retention semantics,
2. startup cleanup in `session.ts` incorrectly treats any `session_map` row absent from `session_log` as orphan,
3. valid Orchestrator primary-session rows therefore become deletable,
4. when the exact row is missing, `resolveCallerIdentity()` falls back to `SELECT agent FROM session_map ORDER BY updated_at DESC LIMIT 1`,
5. the global fallback can legally return an unrelated child agent such as `Knowledge-Curator`,
6. `dispatch-before.ts` then enforces M14 against the wrong caller identity.

The claimed fix direction:

> "`session_map.agent` should only record the original dispatcher and must never be overwritten by child agent"

is too blunt and is not the right abstraction. The framework needs:

- exact-session caller identity,
- explicit primary/subagent session classification,
- safe cleanup rules,
- and no privileged enforcement based on global latest-dispatch fallback.

## Design Principles For The Fix

1. **DB-only and DB-canonical**: no JSON or singleton file becomes the authority for caller identity.
2. **Exact-session semantics first**: route enforcement must never infer a privileged caller from unrelated sessions.
3. **Concurrency-safe**: primary, child, same-agent, and different-agent sessions must coexist without shared mutable caller identity.
4. **Hardened enforcement**: unresolved caller identity must fail closed for privileged routes.
5. **OpenCode plugin/tool compliant**: enforcement remains in `tool.execute.before`, session registration in `chat.message`, and all state changes are transactional.

## Implementation Plan

### Phase 0 - Audit Instrumentation First

Files:

- `.opencode/lib/agent-resolver.ts`
- `.opencode/plugins/session.ts`
- `.opencode/plugins/dispatch-before.ts`

Changes:

1. Add structured resolver-source logging for every `resolveCallerIdentity()` outcome:
   - `source=context.agent`
   - `source=session_map_exact`
   - `source=gate_session_exact`
   - `source=latest_dispatch_fallback`
   - `source=framework_agent_fallback`
   - `source=unresolved`
2. Add deletion-audit logs in session cleanup with candidate counts and deleted `session_id`s written in bounded form.
3. Add a dedicated hard-warning event when privileged routing is attempted without an exact caller source.

Logging requirements:

- Use `writeLog()` only.
- Source names must follow the existing `plugin-*` / `lib-*` naming convention.
- No ad hoc console logging.

### Phase 1 - Introduce DB-Canonical Session Registry

Do **not** continue to overload `session_map` as both identity cache and lifecycle registry.

Add a new canonical table:

`session_registry`

Required columns:

- `session_id TEXT PRIMARY KEY`
- `agent TEXT NOT NULL`
- `session_kind TEXT NOT NULL` (`primary`, `subagent`, `diagnostic`, `unknown`)
- `parent_session_id TEXT NULL`
- `root_session_id TEXT NULL`
- `dag_task_id TEXT NULL`
- `domain_id TEXT NULL`
- `status TEXT NOT NULL`
- `created_at INTEGER NOT NULL`
- `last_seen_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

Rules:

1. `chat.message` writes/refreshes the current session row with `session_kind='primary'` for Orchestrator/Super-Admin main sessions.
2. `task-after.ts` appends/refreshes child session rows with:
   - `session_kind='subagent'`
   - `parent_session_id=input.sessionID`
   - `root_session_id` propagated from parent if available.
3. `session_map` becomes a compatibility projection or secondary lookup cache, not the lifecycle authority.

Why:

- This separates "who owns this session" from "what child sessions were dispatched".
- It satisfies DB-canonical state management and concurrency safety.

### Phase 2 - Replace Unsafe Caller Resolution

`resolveCallerIdentity()` must be changed for privileged enforcement call sites.

New resolution order for `dispatch-before.ts`:

1. `context.agent`
2. exact `session_registry.session_id = input.sessionID`
3. exact `gate_sessions.opencode_session_id = input.sessionID`
4. `FRAMEWORK_AGENT` only if it is bound to the current process/session context
5. otherwise return `CALLER-IDENTITY-UNRESOLVED`

For `dispatch-before.ts`, **remove** the current global fallback:

```sql
SELECT agent FROM session_map ORDER BY updated_at DESC LIMIT 1
```

This fallback may remain only for non-enforcement diagnostics, never for:

- M14
- privileged bypass
- route/permission enforcement
- gate bypass decisions

Enforcement behavior:

- If caller identity is unresolved and target is privileged or route-sensitive, fail closed with a dedicated error:
  - `[FW-ENFORCE][CALLER-IDENTITY-UNRESOLVED]`

This is required for the Hardened Enforcement Subsystem.

### Phase 3 - Redesign Session Cleanup

Current cleanup is not valid:

- [.opencode/plugins/session.ts:285](/home/zhaoge/workspace/opencode/work-one/.opencode/plugins/session.ts:285)

Replace it with registry-aware cleanup:

1. Never delete primary-session rows merely because they are absent from `session_log`.
2. Cleanup must be based on:
   - `session_kind`
   - `status`
   - `last_seen_at`
   - optional parent/child reachability
3. Primary sessions:
   - keep until TTL expiry and no recent activity
4. Subagent sessions:
   - eligible for cleanup when parent/root is stale and dispatch lifecycle is terminal
5. Cleanup must run in a transaction and log deleted `session_id`s.

Recommended policy:

- `primary` rows: TTL-based soft expiry only
- `subagent` rows: lifecycle-aware cleanup
- `diagnostic/explore` rows: short TTL cleanup

### Phase 4 - Make `dispatch-before` Use Exact Session Ownership

`dispatch-before.ts` should use a new resolver helper:

- `resolveCallerIdentityStrict(sessionID, contextAgent?)`

Return shape:

```ts
type CallerIdentityResult = {
  agent: string | null;
  source:
    | "context.agent"
    | "session_registry"
    | "gate_session"
    | "framework_agent"
    | "unresolved";
  exact: boolean;
};
```

M14 decision rule:

- `exact=true` required for privileged caller authorization.
- `exact=false` must never grant privileged identity.

This aligns the Permission Matrix Subsystem and Multi-Agent Subsystem with exact DB-canonical ownership.

### Phase 5 - Migration And Backfill

Migration steps:

1. Schema migration adds `session_registry`.
2. Backfill current live rows from:
   - `session_map`
   - `session_log`
   - current active `gate_sessions.opencode_session_id`
3. Mark uncertain historical rows as `session_kind='unknown'`.
4. Keep old readers working through compatibility helpers during rollout.

Backfill safety:

- idempotent migration
- all writes transactional
- migration logs via `lib-db-manager` and `lib-db-state-manager`

### Phase 6 - Tests And Harness

Required tests:

1. Same Orchestrator session dispatches SA, then child KC runs, then Orchestrator dispatches SA again:
   - expected: caller remains Orchestrator
2. Exact session row missing:
   - expected: privileged dispatch blocked as unresolved
3. Different-agent concurrent sessions:
   - expected: no cross-session caller pollution
4. Startup cleanup during child activity:
   - expected: current primary row preserved
5. Resume path with `task_id`:
   - expected: caller resolution remains exact

Harness requirements:

- tests must run against Bun + SQLite WAL
- no file-based side channel may be authoritative
- add an e2e case that asserts `dispatch-before` never uses latest-dispatch fallback for enforcement

## Subsystem Mapping

### Layout Architecture Subsystem

- Introduce `session_registry` as the canonical lifecycle layer.
- Keep `session_map` as compatibility cache only during migration.

### DB-only and DB-canonical based

- Move caller identity authority to DB tables only.
- Remove enforcement dependence on implicit global latest row selection.

### Permission Matrix Subsystem

- Privileged routing requires exact caller ownership, not heuristic fallback.

### Session/Same-Agent/Different-Agent/Task Concurrency Safe

- Explicit `session_kind`, `parent_session_id`, and `root_session_id`.
- No shared latest-session lookup for enforcement.

### Hardened Enforcement Subsystem

- unresolved caller => fail closed for privileged dispatches
- exact provenance required for M14 and route bypasses

### Framework Harness Subsystem

- add deterministic e2e harness coverage for caller-identity regression

### Central State Management Subsystem

- session lifecycle state centralized in `session_registry`

### Multi-Agent Subsystem

- distinguish primary orchestrator ownership from child execution identity

### Log Central Management Subsystem

- structured resolver-source logs
- structured cleanup deletion logs
- bounded deleted-session detail to avoid log blowup

### DB-canonical Management Subsystem

- schema migration, backfill, registry TTL policy, transactional cleanup

### Templatization And Parameterization Universality Subsystem

- no prompt parsing for caller identity
- caller identity comes from typed DB state and hook context only

### TypeScript + Bun Based Runtime Subsystem

- typed resolver result
- Bun SQLite migrations
- no non-TypeScript sidecar logic added

## Explicit Non-Goals

1. Do not "pin" every `session_map.agent` to the root dispatcher forever.
   - child sessions must still carry their own real agent identity.
2. Do not use `.pending.json`, `ctx/*.json`, or prompt text as caller-identity authority.
3. Do not keep the current latest-dispatch fallback in privileged enforcement paths.

## Acceptance Criteria

1. The scenario from this audit no longer reproduces.
2. `dispatch-before` never grants or denies privileged routing based on another session's latest agent.
3. Primary Orchestrator session rows survive cleanup until explicit TTL expiry.
4. Logs clearly show resolver source and cleanup decisions.
5. All new state is DB-canonical and transactionally updated.

## Final Audit Statement

The Orchestrator analysis correctly identified the visible failure:

- caller became `@Knowledge-Curator`
- M14 blocked `Super-Admin`

But its proposed root cause is not supported by the stronger evidence now available.

The more defensible conclusion is:

> The framework lost exact caller identity for the Orchestrator session, then used an unsafe global latest-dispatch fallback. The durable fix is exact-session DB-canonical identity plus registry-aware cleanup, not "never overwrite session_map.agent with child agent".
