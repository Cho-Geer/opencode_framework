# Orchestrator Dispatch Empty Result / Enforcement Bypass Review and Fix Plan

**Date**: 2026-06-27
**Scope**: today's Orchestrator -> Super-Admin dispatch failures, `.task_temp/_logs/2026-06-27/`, dispatch queue DB/file split, `safe_shell` write bypass, backup enforcement.
**Mode**: evidence-backed code/log review plus implementation plan. No framework code was changed by this review.

---

## 0. Review Boundary

The requested path `.task_temp/._logs/` is not the active log root in this checkout. The active log root is `.task_temp/_logs/`.

Evidence:

- `.opencode/lib/log-manager.ts:139` defines `LOG_ROOT_DEFAULT = ".task_temp/_logs"`.
- `docs/official_docs/opencode/findings/01-log-central-management.md:132-134` says the standard debug log directory is `.task_temp/_logs/`.
- Today's logs are present under `.task_temp/_logs/2026-06-27/`.

This document separates confirmed facts from inference. Where evidence is insufficient, it says so explicitly.

---

## 1. Executive Verdict

### 1.1 Confirmed Root Cause

The immediate dispatch failure is not just "Task prompt token mismatch". The strongest current evidence shows a three-part failure:

1. `.opencode/tools/dispatch_subagent.ts` invokes `.opencode/scripts/command-tools/dispatch-subagent.ts` twice in one tool execution.
2. The first invocation's prompt is consumed by `task-before.ts`, while the second invocation leaves a duplicate queue artifact behind.
3. `task-before.ts` leases the DB queue by `agent_type` only, not by the exact `dag_task_id` / prompt hash / dispatch id that was just consumed, so the DB queue can lease an unrelated or older Super-Admin entry while the current dispatch rows remain pending.

Evidence:

- First CLI invocation: `.opencode/tools/dispatch_subagent.ts:573-608` calls `execFileSync("bun", ["--no-cache", scriptPath, ...scriptArgs])`, stores `outputFilePath`, then reads `wrappedPrompt`.
- Second CLI invocation: `.opencode/tools/dispatch_subagent.ts:837-852` calls the same dispatch CLI again and returns that output.
- The CLI writes the dispatch prompt file and `.pending.json`: `.opencode/scripts/command-tools/dispatch-subagent.ts:1053`, `.opencode/scripts/command-tools/dispatch-subagent.ts:1148-1172`, `.opencode/scripts/command-tools/dispatch-subagent.ts:1224`.
- The same CLI also enqueues DB state: `.opencode/scripts/command-tools/dispatch-subagent.ts:1227-1244`.
- `task-before.ts` states DB is the single canonical source and file fallback is removed: `.opencode/plugins/task-before.ts:358-417`.
- The DB dequeue selects by only `agent_type`: `.opencode/lib/dispatch-db.ts:186-195`.

Today's runtime logs match this code path:

- `.task_temp/_logs/2026-06-27/plugin-dispatch-subagent-runtime.log:690-722` shows two `SA-WEEK3-F4F7-v2` dispatch outputs at `05-34-47-647Z` and `05-34-47-793Z`.
- `.task_temp/_logs/2026-06-27/plugin-dispatch-subagent-runtime.log:723-755` shows the same duplicate pattern for `SA-WEEK3-F4F7-v3`.
- `.task_temp/_logs/2026-06-27/plugin-dispatch-subagent-runtime.log:756-788` shows the same duplicate pattern for `SA-WEEK3-F4F7-v4`.
- `.task_temp/_logs/2026-06-27/plugin-dispatch-subagent-runtime.log:789-821` shows the same duplicate pattern for `F7-HANDLER-ONLY`.
- `.task_temp/_logs/2026-06-27/plugin-lib-dispatch-db-runtime.log:47-60` shows each of those four task ids enqueued twice.
- `.task_temp/_dispatch/.pending.json:3-32` shows one legacy `.pending.json` entry remains for each of those four task ids.

Command evidence:

```text
DB dispatch_queue rows for the four task ids:
SA-WEEK3-F4F7-v2 -> ids 573, 574, both pending
SA-WEEK3-F4F7-v3 -> ids 575, 576, both pending
SA-WEEK3-F4F7-v4 -> ids 577, 578, both pending
F7-HANDLER-ONLY  -> ids 579, 580, both pending
```

```text
sha256sum confirms each duplicate prompt pair is byte-identical:
05-34-47-647Z == 05-34-47-793Z
05-38-12-619Z == 05-38-12-764Z
05-45-49-231Z == 05-45-49-332Z
05-49-18-877Z == 05-49-18-981Z
```

### 1.2 What Is Confirmed About DISPATCH_TOKEN

`DISPATCH_TOKEN` enforcement is real and did block some Task calls.

Evidence:

- `task-before.ts` requires `//DISPATCH_TOKEN:<sha256>`: `.opencode/plugins/task-before.ts:251-270`.
- Hash mismatch blocks in strict/locked mode: `.opencode/plugins/task-before.ts:306-326`.
- Today's logs contain missing-token blocks: `.task_temp/_logs/2026-06-27/plugin-task-before-runtime.log:13-14`, `.task_temp/_logs/2026-06-27/plugin-task-before-runtime.log:23-25`, `.task_temp/_logs/2026-06-27/plugin-task-before-runtime.log:33`, `.task_temp/_logs/2026-06-27/plugin-task-before-runtime.log:43`.

But for the relevant Super-Admin sequence, logs also show successful token verification and prompt consumption:

- `.task_temp/_logs/2026-06-27/plugin-task-before-runtime.log:40-42` consumed prompt `05-34-47-647Z`, verified the hash, then leased DB queue id `542` for a different dag task (`FIX-G8-COMMENT-v1`).
- `.task_temp/_logs/2026-06-27/plugin-task-before-runtime.log:46-48` consumed prompt `05-45-49-231Z`, verified the hash, then leased DB queue id `544` for `CLEANUP-STALE-SESSIONS-v1`.
- `.task_temp/_logs/2026-06-27/plugin-task-before-runtime.log:49-51` consumed prompt `05-49-18-877Z`, verified the hash, then leased DB queue id `545` for `CLEANUP-TS-BASELINE-v1`.

Conclusion: missing/tampered token is a valid blocker, but the four pending entries are better explained by duplicate dispatch generation plus imprecise DB lease matching.

### 1.3 What Is Not Proven

I do not have enough evidence to conclude that every child Agent "never started" or that every empty result came from a blank OpenCode session. The logs prove some Task calls consumed full prompts and passed `DISPATCH-INTEGRITY`. The logs also prove the DB queue did not bind those consumed prompts to the exact dispatch rows.

The defensible statement is:

> The dispatch identity was not consumed canonically for those four target task ids; duplicate DB/file queue artifacts remained pending, and Task's DB lease could attach to unrelated Super-Admin queue rows.

---

## 2. Permission and Backup Findings

### 2.1 Current Safeguards Exist

The framework already tries to prevent shell writes from bypassing `safe_edit`.

Evidence:

- `scope-before.ts` blocks unparseable modify shell commands in strict/locked mode: `.opencode/plugins/scope-before.ts:102-160`.
- `scope-before.ts` explicitly blocks `safe_shell` / `bash` file modification because those tools have no backup mechanism: `.opencode/plugins/scope-before.ts:164-197`.
- `tool-scope.ts` classifies shell writes and unparseable script execution: `.opencode/lib/tool-scope.ts:84-97`, `.opencode/lib/tool-scope.ts:463-495`.
- `safe-bash-core.ts` scans JavaScript script files for write APIs: `.opencode/lib/safe-bash-core.ts:456-504`, `.opencode/lib/safe-bash-core.ts:673-709`.
- `safe-bash-core.ts` scans inline `node -e` / `bun -e` / `tsx -e` evals for write/delete APIs: `.opencode/lib/safe-bash-core.ts:730-815`.

Today's logs show many blocks:

- `.task_temp/_logs/2026-06-27/plugin-scope-before-runtime.log:2246-2249` blocked Orchestrator backup bypass writes.
- `.task_temp/_logs/2026-06-27/plugin-scope-before-runtime.log:4481-4493` blocked later Orchestrator unparseable modify shell attempts.
- `.task_temp/_logs/2026-06-27/plugin-scope-before-runtime.log:4694-4706` blocked backup bypass and unparseable modify shell attempts in a later session.

### 2.2 Current Safeguards Are Incomplete

The current protection still has a gap around "write a script/payload to `/tmp`, then execute or attempt to execute it". The first step can be allowed even when the payload contains framework-file write operations.

Evidence:

- `.task_temp/_logs/2026-06-27/plugin-scope-before-runtime.log:4214-4215` shows Orchestrator `safe_shell` allowed `cat > /tmp/impl-f4-f7.ts << 'SCRIPT_END'`, and the payload imported `writeFileSync`.
- `.task_temp/_logs/2026-06-27/plugin-scope-before-runtime.log:4315`, `4377`, `4456` show that same captured payload included `writeFileSync(path, content, "utf8")`.
- The subsequent script execution was blocked: `.task_temp/_logs/2026-06-27/plugin-scope-before-runtime.log:4481-4493`.

Conclusion: the final execution path is now often blocked, but the payload creation path is not treated as a first-class write attempt. That is still a backup-bypass staging gap.

### 2.3 Backup Behavior

`safe_edit` creates backup-aware writes; shell writes do not.

Evidence:

- `safe_edit.ts` delegates overwrite mode to `writeSafeFull(...)` and patch mode to `safeEdit(...)`: `.opencode/tools/safe_edit.ts:52-63`, `.opencode/tools/safe_edit.ts:99-109`.
- `backup-manager.ts` says all backup operations go through this module and stores backups under `.task_temp/.backups/` with DB metadata: `.opencode/lib/backup-manager.ts:1-9`.
- `backup-manager.ts` creates a git-backed backup and writes `backup_log`: `.opencode/lib/backup-manager.ts:97-154`.
- `safe-edit-core.ts` uses TOCTOU checking and atomic temp-to-rename writes: `.opencode/lib/safe-edit-core.ts:694-768`, `.opencode/lib/safe-edit-core.ts:942-980`.

Conclusion: edits done through indirect `safe_shell` script paths do not have the same backup guarantee unless the shell path is rewritten to call the backup manager or is blocked entirely.

---

## 3. Architecture Requirements From Official OpenCode Docs

The fix must follow these OpenCode constraints:

- Layout: project plugins live in `.opencode/plugins/`, custom tools in `.opencode/tools/`, and agent configs in `.opencode/agents/`: `docs/official_docs/opencode/findings/04-layout-architecture.md:9-21`, `docs/official_docs/opencode/findings/04-layout-architecture.md:119-158`.
- Plugins: `tool.execute.before` can block by throwing; `tool.execute.before` / `tool.execute.after` are official hook events: `docs/official_docs/opencode/plugins/official-plugins-docs.md:75-95`.
- Plugin hook signatures: before-hook args are in `output.args`, after-hook args are in `input.args`: `docs/official_docs/opencode/findings/02-harness-system.md:138-180`.
- Custom tools: OpenCode custom tools use `@opencode-ai/plugin` and `tool({ args, execute })`: `docs/official_docs/opencode/findings/04-layout-architecture.md:119-136`, `docs/official_docs/opencode/plugins/official-plugins-docs.md:114-129`.
- MCP tools: local MCP servers expose tools through `ListToolsRequestSchema` and handle calls through `CallToolRequestSchema`: `docs/official_docs/opencode/mcp-typescript-bun/findings-summary.md:43-115`.
- MCP logging: stdout is reserved for JSON-RPC; diagnostics must use stderr or framework logging: `docs/official_docs/opencode/findings/01-log-central-management.md:15-28`, `docs/official_docs/opencode/mcp-typescript-bun/findings-summary.md:379-393`.
- Permissions: OpenCode permission actions are `allow`, `ask`, `deny`, with per-agent overrides and wildcard matching: `docs/official_docs/opencode/findings/03-permission-matrix.md:9-29`, `docs/official_docs/opencode/findings/03-permission-matrix.md:62-113`, `docs/official_docs/opencode/findings/03-permission-matrix.md:142-160`.
- Multi-agent dispatch: only `mode !== "primary"` agents are invocable via Task; task permission can hide/allow subagents: `docs/official_docs/opencode/findings/06-multi-agent-system.md:9-29`, `docs/official_docs/opencode/findings/06-multi-agent-system.md:63-103`.

---

## 4. Target Design

### 4.1 Canonical Invariant

Every dispatch must have exactly one canonical DB record and one immutable prompt reference:

```text
dispatch_subagent tool call
  -> creates dispatch_prompt_refs row
  -> creates dispatch_queue row
  -> creates dispatch_context row
  -> returns the exact prompt from that prompt_ref
  -> Task(prompt) must match the same queue row by dispatch_id + dag_task_id + sha256
  -> task-after marks the same queue row consumed/failed
```

No runtime logic may depend on `.pending.json`, `.auto-dispatch.json`, `ctx/*.json`, or `.dispatch_ctx`. Those files may exist only as migration/diagnostic exports during rollout.

### 4.2 Required Identity Tuple

Every dispatch lifecycle event must carry this tuple:

```text
dispatch_id
queue_id
prompt_ref_id
prompt_sha256
agent_type
parent_session_id
child_session_id or lease_owner
call_id
dag_task_id
domain_id
created_at
status
```

`agent_type` alone is never a sufficient dequeue key.

---

## 5. Subsystem Implementation Plan

### 5.1 Layout Architecture Subsystem

Implement within existing OpenCode layout:

- Keep custom tool entrypoints in `.opencode/tools/`.
- Keep lifecycle enforcement in `.opencode/plugins/`.
- Keep MCP servers in `.opencode/scripts/mcp-tools/`.
- Put shared dispatch and shell classification logic under `.opencode/lib/`.
- Put tests under `.opencode/lib/__tests__/` and `.opencode/scripts/e2e/`.

Concrete file changes:

- `.opencode/tools/dispatch_subagent.ts`: remove second CLI invocation and return the first generated prompt.
- `.opencode/scripts/command-tools/dispatch-subagent.ts`: stop writing runtime queue files; call one DB-canonical creation API.
- `.opencode/lib/dispatch-db.ts`: add exact-match enqueue/dequeue/consume APIs.
- `.opencode/plugins/task-before.ts`: replace agent-only lease with exact dispatch lease.
- `.opencode/plugins/task-after.ts`: mark the exact dispatch row consumed/failed.
- `.opencode/plugins/dispatch-auto.ts` and `.opencode/plugins/dispatch-after.ts`: remove file queue cleanup as runtime behavior; keep only migration/doctor logic if needed.
- `.opencode/lib/tool-scope.ts`, `.opencode/lib/safe-bash-core.ts`, `.opencode/plugins/scope-before.ts`: unify shell write classification and block staged script payloads.

### 5.2 DB-only and DB-canonical Based Subsystem

Add a migration after the current dispatch queue schema:

```sql
ALTER TABLE dispatch_queue ADD COLUMN dispatch_key TEXT;
ALTER TABLE dispatch_queue ADD COLUMN parent_session_id TEXT;
ALTER TABLE dispatch_queue ADD COLUMN call_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_queue_key
  ON dispatch_queue(dispatch_key);
CREATE INDEX IF NOT EXISTS idx_dispatch_queue_exact_pending
  ON dispatch_queue(status, agent_type, dag_task_id, prompt_ref_id);
```

`dispatch_key` must be deterministic:

```text
sha256(agent_type + "\0" + dag_task_id + "\0" + prompt_sha256 + "\0" + parent_session_id)
```

Replace the current two-step enqueue/dequeue with:

- `dbCreateDispatchAtomic(input)`: inserts prompt ref, queue row, context row, first attempt row in one transaction.
- `dbLeaseDispatchExact(input)`: requires `agent_type`, `dag_task_id`, `prompt_sha256`, and `parent_session_id` or `dispatch_key`.
- `dbConsumeDispatchExact(queue_id, lease_owner, outcome)`: requires the currently leased row.
- `dbFailDispatchExact(queue_id, reason, error)`: records failure with exact id.
- `dbReconcileLegacyDispatchFiles()`: one-time migration/doctor only; never used by `Task()`.

Hard requirement: DB failure is fatal in strict/locked mode. Current `dispatch-db.ts:20-23` says operations are non-fatal and callers should fallback to file ops; that must be changed for dispatch identity paths.

### 5.3 Permission Matrix Subsystem

Use OpenCode's native permission model as the outer layer and framework scope checks as the inner layer.

Concrete rules:

- Orchestrator may call `dispatch_subagent`, read logs/state, and write only orchestration artifacts under `.task_temp/**` and review docs under `docs/review/**`.
- Orchestrator may not modify `.opencode/**`, even through `safe_shell`, temp scripts, heredocs, evals, or generated scripts.
- Super-Admin may modify `.opencode/**` only through `safe_edit`, `safe_delete`, or approved repair MCP/CLI tools that call `backup-manager`.
- `safe_shell` is never a write tool. It can run read-only commands, tests, and approved framework scripts, but cannot create or edit project files.
- MCP tool permission names must remain stable and match OpenCode's wildcard permission semantics.

Acceptance:

- `opencode.json` and agent markdown tool lists agree.
- A deny rule for shell write patterns cannot be weakened by an agent-specific allowlist.
- `ask` in non-interactive plugin context degrades to deny, matching current `safe-bash-core.ts:609-634`.

### 5.4 Session / Same-Agent / Different-Agent / Task Concurrency Safe Subsystem

Required behavior:

- Same session + same agent + same dag task + same prompt hash: idempotent; return existing prompt ref or replace stale failed row explicitly.
- Same session + same agent + same dag task + different prompt hash: reject as `DAG_TASK_ID_REUSE`.
- Same session + same agent + different dag task: allowed; independent queue rows.
- Same session + different agent + same dag task: reject unless route policy explicitly permits a handoff.
- Different sessions + same dag task: reject unless it is an approved resume/retry and the previous lease is stale/failed.
- Parallel dispatches must not overwrite child context. Key context by `queue_id` or `dispatch_key`, not only `dag_task_id`.

Implementation:

- Use SQLite transaction boundaries for all queue state changes.
- Lease with `WHERE id = ? AND status = 'pending'` and check affected row count.
- Store `lease_owner = sessionID + ":" + callID` rather than only session id.
- Add a monotonic `attempt_number` in `dispatch_attempts`.
- Add `dispatch_context.parent_queue_id` or use `dispatch_id` FK.

### 5.5 Hardened Enforcement Subsystem

Dispatch enforcement:

- `task-before.ts` must reject Task calls whose prompt token is valid but has no exact pending dispatch row.
- `task-before.ts` must not lease by `agent_type` alone.
- `task-before.ts` must log `DISPATCH-QUEUE-EXACT-MISS` with the identity tuple when exact matching fails.
- `dispatch_subagent.ts` must return an error if DB enqueue fails in strict/locked mode.

Shell enforcement:

- Treat heredoc payload creation as a write, even when target is `/tmp`.
- If `cat > /tmp/script.ts` content contains writes to workspace paths, block at payload creation time.
- If payload content cannot be inspected, block in strict/locked mode.
- Extend script scanning from `node *.ts/*.js` to `bun`, `python3`, `bash`, `sh`, `tsx`, and `/tmp/*`.
- Remove broad "trusted script path" bypasses unless the script is signed by config and declared in a DB-backed allowlist.
- Do not allow `// safe_bash: allow-write` to bypass backups. Convert it into "must use backup-aware repair wrapper".

Backup enforcement:

- Before any framework file write, verify a `backup_log` row exists or create one atomically.
- For approved repair scripts, expose a backup-aware wrapper API instead of raw `fs.writeFileSync`.
- Record `backup_uuid` on write audit events.

### 5.6 Framework Harness Subsystem

Add tests that fail on today's bug:

1. `dispatch_subagent` single-call harness: one tool call creates one DB queue row and one prompt ref.
2. Duplicate guard: same task/hash is idempotent, different hash is rejected.
3. Exact lease harness: returned prompt leases the row whose `dag_task_id` and hash match the token.
4. Agent-only lease regression: preload an older Super-Admin pending row; new Super-Admin Task must not lease the older row.
5. DB/file split regression: `rg ".pending.json|.auto-dispatch.json|ctx/" .opencode/plugins .opencode/tools .opencode/scripts/command-tools` must find no runtime writer except migration/doctor code.
6. DISPATCH_TOKEN tests: missing token blocks, tampered prompt blocks, exact prompt passes.
7. Temp-script bypass tests: `cat > /tmp/x.ts` with workspace writes blocks; `bun /tmp/x.ts` blocks; `python3 <<EOF open(...).write()` blocks.
8. Backup tests: `safe_edit` creates backup row; any shell write path has no write effect and logs a block.
9. Concurrency tests: parallel same/different agent dispatches use DB locks and do not overwrite context.

Commands:

```bash
bun --check .opencode/tools/dispatch_subagent.ts
bun --check .opencode/scripts/command-tools/dispatch-subagent.ts
bun --check .opencode/plugins/task-before.ts
bun test .opencode/lib/__tests__/dispatch-db.test.ts
bun test .opencode/lib/__tests__/safe-bash-core.test.ts
bun .opencode/scripts/framework-self-test.ts
```

Root `tsc` is currently noisy in this checkout; do not use it as the sole acceptance gate until the TypeScript baseline work is complete.

### 5.7 Central State Management Subsystem

The central state manager must treat DB as canonical and JSON as export/compat only.

Concrete changes:

- Dispatch lifecycle lives in `dispatch_queue`, `dispatch_prompt_refs`, `dispatch_context`, and `dispatch_attempts`.
- Session identity lives in `session_map` and `session_log`.
- Gate lifecycle lives in `gate_sessions`.
- Checklist lifecycle lives in checklist DB tables.
- JSON files under `.task_temp/_dispatch` are removed from runtime reads.
- If human-readable diagnostics are needed, generate them from DB snapshots.

### 5.8 Multi-Agent Subsystem

Dispatch identity must be explicit across parent and child:

- Parent dispatch writes a `dispatch_context` row with parent session, target agent, dag task, domain, and prompt ref.
- Child startup resolves its identity from exact `dispatch_id` / `dispatch_key`, not a shared singleton file.
- `Task()` prompt must include `dispatch_id` and `dispatch_key` alongside `DISPATCH_TOKEN`.
- The child must attest config/read prerequisites against its resolved task id.
- `task-after.ts` records the actual child session id/run id back to `dispatch_attempts`.

This prevents the "blank child session" class of failure because a child cannot pass startup without a matching DB dispatch context.

### 5.9 Log Central Management Subsystem

Use `.opencode/lib/log-manager.ts` as the single local log writer for plugins, tools, libs, and scripts.

Current evidence:

- `log-manager.ts` supports source/category log files and source index tracking: `.opencode/lib/log-manager.ts:1-18`, `.opencode/lib/log-manager.ts:65-92`.
- It defaults to `.task_temp/_logs`: `.opencode/lib/log-manager.ts:139`.
- It tracks source log files in the index: `.opencode/lib/log-manager.ts:520-555`.

Required event names and fields:

| Event | Producer | Required fields |
| --- | --- | --- |
| `DISPATCH-CREATE-REQUEST` | `dispatch_subagent.ts` | `sessionID`, `callID`, `agent`, `target_agent`, `dag_task_id`, `description_sha256` |
| `DISPATCH-DB-CREATED` | `dispatch-db.ts` | `queue_id`, `dispatch_key`, `prompt_ref_id`, `prompt_sha256` |
| `DISPATCH-PROMPT-RETURNED` | `dispatch_subagent.ts` | `queue_id`, `dispatch_key`, `file_path`, `size_bytes` |
| `DISPATCH-INTEGRITY-PASS` | `task-before.ts` | `dispatch_key`, `prompt_sha256`, `agent_type`, `dag_task_id` |
| `DISPATCH-QUEUE-EXACT-LEASE` | `task-before.ts` | `queue_id`, `lease_owner`, `lease_expiry` |
| `DISPATCH-QUEUE-EXACT-MISS` | `task-before.ts` | attempted tuple and pending counts |
| `DISPATCH-TASK-SUCCESS` / `DISPATCH-TASK-FAILED` | `task-after.ts` | `queue_id`, `dispatch_key`, `child_session_id`, `raw_error` |
| `SHELL-WRITE-BLOCKED` | `scope-before.ts` / `safe-bash-core.ts` | `agent`, `command_kind`, `targets`, `reason` |
| `BACKUP-CREATED` | `backup-manager.ts` | `backup_uuid`, `file`, `agent`, `sessionID`, `dag_task_id` |

MCP servers must not use `console.log()` for diagnostics because stdout is JSON-RPC protocol space.

### 5.10 DB-canonical Management Subsystem

Add a dispatch reconciler:

```text
bun .opencode/scripts/framework-doctor.ts --dispatch-reconcile
```

Behavior:

- Read duplicate pending rows grouped by `(agent_type, dag_task_id, prompt_sha256)`.
- If rows are identical and older than an active Task call, mark all but the newest `failed` with reason `duplicate-double-cli`.
- If `.pending.json` contains entries that exist in DB, archive them into `dispatch_failed_log` with reason `legacy-file-queue`.
- If `.pending.json` contains entries not in DB, import as `failed` diagnostic records, not runnable queue records.
- Never clear `.pending.json` by raw shell write.

For the current incident, the safe recovery path is:

1. Snapshot `.task_temp/_dispatch/.pending.json` through a backup-aware doctor command.
2. Mark DB rows `573-580` as failed/stale with explicit reason if no active child sessions reference them.
3. Archive the four file entries to `dispatch_failed_log`.
4. Re-dispatch only after the exact-match queue fix is installed.

### 5.11 Templatization and Parameterization Universality Subsystem

No new hardcoded policy values should be embedded in hooks.

Add configuration keys under `.opencode/project.config.json`:

```jsonc
{
  "dispatch_policy": {
    "canonical_source": "db",
    "legacy_file_queue": "disabled",
    "lease_ttl_ms": 60000,
    "exact_match_required": true,
    "duplicate_policy": "same_hash_idempotent_different_hash_block"
  },
  "safe_shell": {
    "write_policy": "deny",
    "scan_temp_scripts": true,
    "temp_script_max_bytes": 262144,
    "backup_required_for_writes": true
  },
  "log_management": {
    "dispatch_event_schema_version": 2
  }
}
```

All tests must run with temporary roots and `FRAMEWORK_DB_PATH` overrides.

### 5.12 TypeScript + Bun Based Runtime Subsystem

Rules:

- Custom tools remain TypeScript files using `import { tool } from "@opencode-ai/plugin"` and `export default tool(...)`, matching current `safe_shell.ts:1-4` and `dispatch_subagent.ts:1-2`.
- MCP servers remain Bun-executed TypeScript with CommonJS `require()` for MCP SDK imports, matching `compliance-gate.ts:1-34`.
- Do not introduce a build step for MCP servers.
- Use `bun:sqlite` for DB access, matching `db-manager.ts:24`.
- Do not use shell string concatenation for script execution when `execFileSync` can pass argument arrays.
- Do not write via ad hoc scripts in implementation; use `safe_edit` or this environment's patching tool during review.

---

## 6. Patch Sequence

### Phase A — Stop Double Dispatch

Files:

- `.opencode/tools/dispatch_subagent.ts`
- `.opencode/scripts/command-tools/dispatch-subagent.ts`

Changes:

1. Remove the second CLI call at `.opencode/tools/dispatch_subagent.ts:837-852`.
2. Return `wrappedPrompt` read from the first `outputFilePath`.
3. Ensure the first call receives all identity env vars: `OPENCODE_SESSION_ID`, `DISPATCH_DAG_TASK_ID`, parent `callID` if available, and route/domain values.
4. Add `DISPATCH-PROMPT-RETURNED` log with prompt hash and file path.
5. Make DB enqueue failure fatal in strict/locked mode.

Acceptance:

- One `dispatch_subagent` call produces one `DB-ENQUEUE-ATOMIC` line and one `Output:` line.
- No paired prompt files with identical hash for a single call.

### Phase B — Exact DB Lease

Files:

- `.opencode/lib/dispatch-db.ts`
- `.opencode/plugins/task-before.ts`
- `.opencode/plugins/task-after.ts`

Changes:

1. Add exact dispatch key creation and exact lease API.
2. Parse `dispatch_id` / `dispatch_key` from prompt wrapper.
3. Verify token hash, then call exact lease.
4. On exact miss, block in strict/locked mode; log diagnostic in advisory mode.
5. `task-after.ts` updates the exact queue row, not a best-effort inferred row.

Acceptance:

- Preloaded old `Super-Admin` rows cannot be leased by a new Super-Admin Task.
- The leased `dag_task_id` always equals the prompt's `dag_task_id`.

### Phase C — Remove Runtime File Queues

Files:

- `.opencode/scripts/command-tools/dispatch-subagent.ts`
- `.opencode/plugins/task-before.ts`
- `.opencode/plugins/dispatch-auto.ts`
- `.opencode/plugins/dispatch-after.ts`
- `.opencode/plugins/session.ts`

Changes:

1. Delete `.pending.json` and `.auto-dispatch.json` writes from runtime dispatch path.
2. Remove file queue reads from Task path.
3. Move file cleanup/import logic to `framework-doctor --dispatch-reconcile`.
4. Update comments that currently conflict (`task-before.ts` says file fallback removed while CLI still writes it).

Acceptance:

```bash
rg -n "writeFileSync\\(PENDING_FILE|\\.auto-dispatch|ctx/\\{dagTaskId\\}|\\.dispatch_ctx" .opencode/plugins .opencode/tools .opencode/scripts/command-tools
```

must find no runtime writer except explicitly named migration/doctor code.

### Phase D — Harden Shell and Backup Enforcement

Files:

- `.opencode/lib/tool-scope.ts`
- `.opencode/lib/safe-bash-core.ts`
- `.opencode/plugins/scope-before.ts`
- `.opencode/lib/backup-manager.ts`
- `.opencode/lib/__tests__/safe-bash-core.test.ts`

Changes:

1. Add a shared parser that returns `read_only`, `known_write`, `opaque_write`, or `script_payload_write`.
2. For heredoc/stdin redirection, capture or inspect payload before allowing.
3. For `/tmp/*.ts`, `/tmp/*.js`, `/tmp/*.py`, `/tmp/*.sh`, scan content and target writes before execution.
4. Block payload creation if it stages writes to workspace files.
5. Remove path-aware eval allowance for framework writes; only `.task_temp/_logs` diagnostics can be written by shell.
6. Add `backup_uuid` requirement for any sanctioned write wrapper.

Acceptance:

- `cat > /tmp/impl.ts <<EOF` with `writeFileSync(".opencode/...")` is blocked at creation.
- `bun /tmp/impl.ts` is blocked even if creation happened before the fix.
- `python3 <<EOF open(".opencode/...","w")` is blocked.
- `safe_edit` still succeeds and creates a `backup_log` row.

### Phase E — Harness and Log Schema

Files:

- `.opencode/scripts/framework-self-test.ts`
- `.opencode/lib/__tests__/dispatch-db.test.ts`
- `.opencode/scripts/e2e/dispatch-exact-lease.e2e-test.ts`
- `.opencode/scripts/e2e/shell-backup-bypass.e2e-test.ts`

Changes:

1. Add e2e tests from Section 5.6.
2. Fail framework self-test if duplicate dispatch rows exist for same active tuple.
3. Fail framework self-test if runtime writers still touch `.pending.json`.
4. Fail framework self-test if a log event misses the required identity tuple.

Acceptance:

- The harness reproduces today's double-dispatch bug before the fix.
- The harness passes after Phases A-D.

---

## 7. Rollout Plan

1. Advisory phase: implement logs and exact-match APIs, keep legacy files as exports only.
2. Strict canary: enable `dispatch_policy.exact_match_required=true` for Super-Admin dispatch first.
3. Full strict: enable exact matching for all agents.
4. Legacy cleanup: run `framework-doctor --dispatch-reconcile`, archive `.pending.json`, and stop runtime file writes.
5. Locked mode: make DB enqueue/dequeue failures fatal and disallow all shell writes.

Rollback:

- Re-enable legacy read fallback only through a feature flag for one release window.
- Do not restore agent-only DB lease; if rollback is needed, fall back to exact file path/hash matching.

---

## 8. Current Incident Recovery Checklist

Do not manually clear `.pending.json` with `safe_shell`.

Required safe recovery:

1. Query active Task sessions for the four task ids.
2. If no active child owns rows `573-580`, mark them `failed` with reason `duplicate-double-cli`.
3. Archive `.task_temp/_dispatch/.pending.json:3-32` entries to `dispatch_failed_log`.
4. Snapshot prompt files before deletion.
5. Re-dispatch after Phase A and Phase B are in place.

---

## 9. Acceptance Matrix

| Requirement | Acceptance |
| --- | --- |
| Layout Architecture | No new nonstandard OpenCode directories; tools/plugins/MCP servers remain in official locations. |
| DB-only / DB-canonical | Dispatch runtime reads only DB; file queues are migration artifacts only. |
| Permission Matrix | OpenCode permission rules and framework scope rules agree; shell writes denied. |
| Concurrency Safe | Exact lease uses queue id/key, not agent type only; duplicate policies are deterministic. |
| Hardened Enforcement | Missing token, hash mismatch, exact queue miss, and shell write staging all block in strict/locked. |
| Framework Harness | E2E tests catch double dispatch, wrong queue lease, and temp script bypass. |
| Central State | Dispatch/session/gate/checklist states are DB-canonical; JSON is export only. |
| Multi-Agent | Parent/child dispatch identity is explicit and recoverable by DB. |
| Log Central Management | Every dispatch/write event includes the required identity tuple and writes through `writeLog` or MCP stderr. |
| DB-canonical Management | Reconciler handles legacy file state without making it runnable. |
| Templatization | Thresholds and mode flags live in config, not hardcoded hooks. |
| TypeScript + Bun | Tools use `@opencode-ai/plugin`; MCP servers use Bun + TypeScript + MCP SDK stdio conventions. |

---

## 10. Final Conclusion

The effective prevention strategy is to remove ambiguity, not add more file cleanup:

- one dispatch tool call creates one DB dispatch row;
- one Task prompt can lease only that exact row;
- shell cannot stage or execute write payloads outside backup-aware tools;
- every state transition is logged with the same dispatch identity tuple.

With those invariants enforced, the four observed failure modes cannot silently degrade into "completed with empty result"; they either execute under the correct dispatch identity or block with a precise, queryable error.
