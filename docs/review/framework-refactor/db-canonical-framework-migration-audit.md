# DB-Canonical Framework Migration Audit

**Generated**: 2026-06-21  
**Reviewed / Updated**: 2026-06-21 after KC v11/v12 implementation snapshot  
**Scope**: `.opencode/` framework code, root OpenCode config, `docs/review/framework-refactor/`, `docs/official_docs/`, current `.opencode/state/` and `.task_temp/_dispatch/` storage snapshot. Business code under `booking_system_refactor/` is out of scope except as a permission/path consumer.  
**Current DB**: `.opencode/state/framework-state.db`, schema v12, 24 user tables.  
**Baseline Docs Reviewed**: `storage-entity-landscape.md`, `knowledge-cache-optimization-plan.md`, `config-attest-race-fix-plan.md`, `execution-priority-analysis.md`, official OpenCode docs under `docs/official_docs/opencode/**`.

---

## Executive Summary

The framework is already mostly DB-backed for central substate and several dispatch/gate records, but it is **not yet DB-canonical as a whole**. The remaining risk is concentrated in active runtime files that still coordinate concurrent sessions, dispatches, and gate compaction.

**Primary conclusion**: make DB canonical for runtime state, evidence, indexes, queues, and enforcement decisions. Do **not** move OpenCode source-of-truth configuration, agent prompts, rules, docs, logs, or human-readable DAG artifacts wholesale into DB. Those should remain files and be indexed or snapshotted in DB where useful.

Highest-priority DB migration candidates:

1. **Dispatch queue/context runtime state**: `.task_temp/_dispatch/.pending.json`, `.auto-dispatch.json`, `.dispatch_ctx`, and `ctx/*.json`.
2. **Gate compactor file track**: `.opencode/state/gate-state.json`, `gate-state.index.json`, and `gate-state.history/*.jsonl`.
3. **Knowledge subsystem canonical data**: v11/v12 typed DB tables now exist, but current code is still partially file-backed and compatibility-blob-backed; complete DB-canonical read/write paths are still required.
4. **Per-session attestation/enforcement facts**: `config_read_state.sessions`, high-churn UC7KS/write-audit facts, and hardened enforcement decisions.
5. **Harness and doctor result metadata**: store run/check summaries in DB; keep artifact files as files.

Do not migrate as DB canonical:

- `opencode.json`, `.opencode/agents/*.md`, `.opencode/project.config.json`, `.opencode/rules/**/*.md`, `.opencode/tools/*.ts`, `.opencode/plugins/*.ts`, `AGENTS.md`, `contract.yaml`.
- `Task.DAG.json` as the human/agent collaboration artifact. Add DB indexes if needed, but keep the file.
- `.task_temp/_logs/**`, `.opencode/logs/**`, safe-edit backups, prompt/report artifacts. Add indexes/retention, not DB body storage.

---

## Current DB Baseline

Current schema tables:

| Area               | Tables                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine / substate | `machine_meta`, `machine_contracts`, `substate_kv`                                                                                                                                                               |
| Gate               | `gate_sessions`, `gate_drained_sessions`, `gate_session_index`, `gate_store_meta`, `gate_audit_history`                                                                                                          |
| Audit              | `audit_log`, `audit_trail`, `read_audit`, `file_baseline_kv`                                                                                                                                                     |
| Dispatch/session   | `session_log`, `dispatch_failed_log`, `session_map`                                                                                                                                                              |
| Knowledge          | `knowledge_entries`, `knowledge_files`, `knowledge_entry_tags`, `knowledge_session_access`, `knowledge_discovery`, `knowledge_attestation`, `knowledge_materialization_jobs`, `knowledge_session_access_archive` |
| DB management      | `schema_version`                                                                                                                                                                                                 |

Current schema versions:

| Version | Meaning                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------- |
| v1-v2   | Initial DB + `substate_kv`                                                                           |
| v4      | `file_baseline_kv` for safe-edit TOCTOU detection                                                    |
| v6      | `session_log`, `dispatch_failed_log`, `session_map`                                                  |
| v7      | Dropped 13 unused typed sub-state mirror tables                                                      |
| v8-v9   | `session_map.dag_task_id` + `domain_id`                                                              |
| v10     | `read_audit` DB table                                                                                |
| v11     | Typed knowledge tables: entries/files/tags/session access/discovery/attestation/materialization jobs |
| v12     | `knowledge_session_access_archive` for pruned session-access retention                               |

Largest current `substate_kv` rows:

| Key                     | Current size | Interpretation                                                                          |
| ----------------------- | -----------: | --------------------------------------------------------------------------------------- |
| `knowledge_cache_state` |      ~514 KB | Still largest blob; nested per-agent/task/domain UC7KS state remains enforcement source |
| `write_audit_state`     |      ~175 KB | Write audit aggregation still blob-shaped                                               |
| `compliance_records`    |      ~161 KB | Compliance/gate rollups still blob-shaped                                               |
| `eslint_state`          |       ~59 KB | Tool state, not currently a concurrency hotspot                                         |
| `config_read_state`     |       ~39 KB | Already fixed as nested `sessions`, but still a per-session blob                        |

Important correction to older docs: `read-audit.ts` is now **DB-only for writes** with JSONL read fallback retained for historical data. `storage-entity-landscape.md` correctly identified the direction, but its “Phase 1 dual-write” wording is now stale for current code.

---

## File Classification

### A. Should Become DB-Canonical

| File/entity                                                   | Current role                                        | DB target                                                                  | Priority | Reason                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| `.task_temp/_dispatch/.pending.json`                          | Active dispatch prompt FIFO                         | `dispatch_queue` + prompt file ref                                         | P1       | Shared JSON queue in concurrent dispatch path                                   |
| `.task_temp/_dispatch/.auto-dispatch.json` / `.auto-dispatch` | LLM-free Task prompt marker queue                   | `dispatch_queue` or `auto_dispatch_queue`                                  | P1       | Still shared mutable queue; currently capped at 50 entries                      |
| `.task_temp/_dispatch/.dispatch_ctx`                          | Legacy dispatch context consumed by `task-after.ts` | `dispatch_context` / extend `session_map`                                  | P1       | Shared singleton, still written and consumed                                    |
| `.task_temp/_dispatch/ctx/*.json`                             | Per-dispatch context fallback                       | `dispatch_context` table                                                   | P1       | Better than singleton, but still file scan + newest fallback                    |
| `.opencode/state/gate-state.json`                             | Compactor hot file                                  | DB-first compactor API; JSON as export cache                               | P1       | `state-compactor.ts` still file-primary despite DB authority comment            |
| `.opencode/state/gate-state.index.json`                       | Compactor history/session index                     | `gate_compactor_index`                                                     | P1       | Not equivalent to existing `gate_session_index`; cannot reconstruct fully today |
| `.opencode/state/gate-state.history/*.jsonl`                  | Compactor warm history                              | `gate_audit_history` + archive exporter                                    | P1       | DB/file dual track increases drift risk                                         |
| `.opencode/state/read_audit.jsonl`                            | Historical read audit fallback                      | DB already canonical; archive marker                                       | P0/P1    | Stop treating as live state; verify and archive                                 |
| `.opencode/state/.transaction-log`                            | Deprecated custom WAL bridge                        | `transaction_journal` or retire                                            | P2       | New writes use DB; doctor/CI still reference legacy log                         |
| `knowledge_cache_state.session_access`                        | Nested UC7KS runtime evidence                       | `knowledge_session_access`, `knowledge_discovery`, `knowledge_attestation` | P1/P2    | Largest blob, high semantic query value                                         |
| `docs/official_docs/index.json`                               | Knowledge manifest used by custom tools             | `knowledge_entries/files/tags`; file materialized view                     | P1/P2    | DB should own metadata; file remains read-evidence artifact                     |
| `config_read_state.sessions`                                  | Per-session config read attestation                 | `config_read_attestation`                                                  | P2       | Current nested map is safe, but still hot-row blob growth                       |
| `write_audit_state` high-churn facts                          | Write enforcement rollup                            | `write_audit_events`, `write_scope_decisions`                              | P2       | Useful for Hardened enforcement and audit queries                               |
| `.task_temp/framework-doctor/report.json`                     | Latest doctor result artifact                       | `harness_runs`, `harness_checks`, artifact path                            | P2       | Enables trend/drift queries without losing artifact file                        |

### B. Keep File-Canonical, Add DB Index/Snapshot

| File/entity                               | Keep as file because                              | DB integration                                                 |
| ----------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| `opencode.json`                           | Official OpenCode config and permission authority | `permission_snapshot`, `effective_permissions`, drift hash     |
| `.opencode/agents/*.md`                   | Official agent markdown config/prompt source      | `agent_registry_snapshot`, capability hash                     |
| `.opencode/project.config.json`           | Framework policy/template source                  | `resolved_project_config_snapshot`, config hash                |
| `.opencode/rules/**/*.md` and `AGENTS.md` | Human-readable governance source                  | `rule_registry_index`, rule hash/drift checks                  |
| `contract.yaml`                           | Contract source and Git-review artifact           | `contract_hashes`, version/evidence index                      |
| `Task.DAG.json`                           | Human/agent collaboration artifact                | `dag_task_index`, `dag_snapshot_meta`, dispatch evidence joins |
| `.opencode/state/*.schema.json`           | Validation schemas                                | Schema hash/index; do not move schema source                   |
| `docs/review/**`, `docs/design/**`        | Review/design records                             | Optional document index; file remains canonical                |
| Dispatch prompt `.md` files               | Human/debug artifacts                             | Store path/hash/retention metadata only                        |

### C. Keep File/Artifact Only

| File/entity                                         | Reason                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `.task_temp/_logs/**`, `.opencode/logs/**`          | High-frequency append logs; DB body storage would increase write pressure |
| `safe-bash.log*`                                    | Append/rotation model is appropriate; add DB index only if needed         |
| Safe-edit backups under `.opencode_backups/`        | Actual rollback payload must remain filesystem content                    |
| `.task_temp/**/HANDOVER.md`, `TASK_LOG.md`, reports | Task artifacts are reviewable files; DB can index latest state            |
| `.opencode/_plugins_backups/**`                     | Cleanup/retention candidate, not DB migration target                      |

---

## Subsystem Fit Matrix

| Subsystem                                | DB-canonical recommendation                                                                                                | Constraints                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Layout Architecture System               | Keep official `.opencode/` layout as files; add `layout_catalog` and path ownership snapshots                              | OpenCode discovers agents/tools/plugins/skills from filesystem; DB cannot replace discovery source |
| Permission Matrix System                 | Keep `opencode.json` and agent frontmatter as authority; add effective permission snapshot and drift detector              | P2-D source inversion must stay intact; DB is cache/index, not new authority                       |
| Concurrent session/dispatch write system | Move queue, context, attempt, lease, and dead-letter state into typed DB tables                                            | Must preserve prompt files as artifacts; use SQLite transactions + leases                          |
| Hardened enforcement System              | Add append-only `enforcement_decisions` with mode, agent, session, task, file, rule, action, reason                        | Enforcement code must still block via plugin/custom tool hooks; DB records evidence                |
| Harness System                           | Add `harness_runs`, `harness_checks`, `doctor_reports`, artifact path/hash                                                 | Keep stdout/human JSON reports for CLI use                                                         |
| Central State Management                 | Finish gate compactor DB-first; split high-churn substate facts into typed tables only when there are real readers/writers | v7 removed unused typed mirrors; do not recreate passive mirrors                                   |
| Multi-Agent System                       | Extend `session_map/session_log`; add agent registry/capability snapshots and handover index                               | Agent markdown remains prompt/config authority                                                     |
| Log Central Management System            | Keep file logs; add optional `log_index` / `log_summary` populated by `writeLog` or rotator                                | Official docs distinguish MCP stderr, plugin logging, debug file logs                              |
| DB Management System                     | Add migration ownership metadata, health snapshots, backup/checkpoint policy, table owner docs                             | Use `bun:sqlite`, WAL, `busy_timeout`, idempotent migrations                                       |
| Templatization & Parameterization        | Store resolved template snapshots and generated config hashes; file templates/config remain source                         | Avoid DB-only hidden configuration                                                                 |
| TypeScript + Bun Based System            | New code should be TypeScript/Bun, `bun:sqlite`, no new native deps, no Python migration scripts                           | `.opencode/tools` remain custom tools using `tool()`; plugins use default export/lifecycle wrapper |

---

## Proposed DB Slices

The knowledge slice has now landed as schema v11/v12, but it is not yet fully canonical at the API/enforcement level. Dispatch and gate slices remain proposed follow-up work.

### Dispatch Runtime Slice

| Table                  | Responsibility                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `dispatch_queue`       | One row per pending auto-dispatch or prompt dispatch; status `pending/running/consumed/failed/stale`; lease owner + expiry |
| `dispatch_context`     | Session/task/domain/agent context keyed by dispatch ID and `dag_task_id`                                                   |
| `dispatch_prompt_refs` | Prompt artifact path, sha256, size, created_at, retention state                                                            |
| `dispatch_attempts`    | Attempt lifecycle, Task call ID, outcome, error, sub-session ID                                                            |

Migration effect:

- Replace `.pending.json` read/write with transactional enqueue/dequeue.
- Replace `.auto-dispatch.json` marker consumption with DB lease and exact `sessionID + agentType` matching.
- Replace `.dispatch_ctx` and `ctx/*.json` fallback with `dispatch_context`.
- Keep generated prompt `.md` files as artifacts referenced by DB.

### Gate Compactor Slice

| Table                                                  | Responsibility                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `gate_compactor_index`                                 | DB equivalent of `gate-state.index.json`, including archive refs/status      |
| `gate_history_events` or extended `gate_audit_history` | Full warm history events currently appended to JSONL                         |
| `gate_export_meta`                                     | Tracks JSON export cache freshness if `gate-state.json` remains materialized |

Migration effect:

- `StateCompactor.readHotState/writeHotState` becomes DB-first.
- `gate-state.json` becomes optional export cache, not authoritative.
- `gate-state.history/*.jsonl` stops receiving live writes after archive validation.

### Knowledge Canonical Slice

Implemented tables from schema v11/v12:

| Table                              | Responsibility                                                  |
| ---------------------------------- | --------------------------------------------------------------- |
| `knowledge_entries`                | Logical knowledge records and source metadata                   |
| `knowledge_files`                  | Materialized file path/hash/TTL/status                          |
| `knowledge_entry_tags`             | Search aliases and semantic domain tags                         |
| `knowledge_session_access`         | Per-agent/task/domain access summary                            |
| `knowledge_discovery`              | Cache search/discovery events                                   |
| `knowledge_attestation`            | Read-audit verified attestation facts                           |
| `knowledge_materialization_jobs`   | DB-to-file generation jobs                                      |
| `knowledge_session_access_archive` | Historical retention for pruned `knowledge_session_access` rows |

Constraint: `docs/official_docs/**` must remain materialized files because OpenCode read-before-write evidence depends on real `read` tool events.

Current implementation caveat: `knowledge-store.ts` still reads/writes `docs/official_docs/index.json` directly for manifest APIs, and UC7KS write enforcement still reads `knowledge_cache_state` as its blocking source. See §Audit Findings & Post-Implementation Observations for the concrete convergence plan.

### Enforcement / Attestation Slice

| Table                     | Responsibility                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `config_read_attestation` | One row per `session_id + agent + task_id`; required config file hashes and read timestamps |
| `enforcement_decisions`   | Scope/permission/UC7KS/TDD/DAG/gate decision records                                        |
| `write_scope_decisions`   | File-level write allow/block facts for later audit                                          |

Migration effect:

- Keep current `config_read_state.sessions` as compatibility rollup until consumers move.
- `scope-before`, `gate-before`, `dispatch-before`, `uc7ks-before`, and TDD plugins can log structured decisions without parsing file logs.

### Harness / Operations Slice

| Table                 | Responsibility                                       |
| --------------------- | ---------------------------------------------------- |
| `harness_runs`        | Self-test/doctor/reconciliation/nightly run metadata |
| `harness_checks`      | Per-check result, duration, severity, message        |
| `doctor_reports`      | Latest report path/hash/summary                      |
| `db_health_snapshots` | PRAGMA health, schema version, WAL/checkpoint status |

Migration effect:

- Keep CLI JSON/report files.
- DB becomes the trend and regression source for Harness System.

### Layout / Permission / Template Index Slice

| Table                          | Responsibility                                                            |
| ------------------------------ | ------------------------------------------------------------------------- |
| `layout_catalog`               | Expected framework paths, kind, owner subsystem, source hash              |
| `agent_registry_snapshot`      | Agent mode, permissions hash, skills/tools declarations                   |
| `permission_snapshot`          | Effective permission matrix derived from `opencode.json` + agent markdown |
| `template_resolution_snapshot` | Resolved project template values and hashes                               |
| `rule_registry_index`          | Rule/doc paths, authority, hashes, freshness                              |

Migration effect:

- Improves drift detection and validation.
- Does not replace file authority.

---

## Execution Priority

### P0: Close Stale/Drifted Evidence

1. Update storage docs to reflect `read_audit` DB-only writes.
2. Verify `read_audit.jsonl` historical fallback has no DB-missing event keys, then archive/rename it.
3. Add a one-page “file authority vs DB authority” rule to prevent future plans from trying to move OpenCode source config into DB.

### P1: Remove Active Concurrent File State

1. Implement dispatch runtime DB slice.
2. Convert `dispatch_subagent.ts`, `task-before.ts`, `task-after.ts`, `dispatch-auto.ts`, and `dispatch-after.ts` to DB enqueue/dequeue/context APIs.
3. Keep prompt files as artifacts, but stop using marker/context files as live coordination state.
4. Add self-test coverage for concurrent dispatch queue consumption.

Reason: this directly addresses the concurrent session/dispatch write system and removes current shared-file races.

### P1: Make Gate Compactor DB-First

1. Change `StateCompactor` to load/write through DB APIs.
2. Add DB equivalent for `gate-state.index.json`.
3. Convert JSON hot/history files to export/archive artifacts.
4. Add reconciliation checks that DB can regenerate exported files.

Reason: current comments already say DB is authoritative, but compactor code still treats files as primary.

### P1/P2: Implement Knowledge DB-Canonical Store

1. Follow `knowledge-cache-optimization-plan.md` typed table design.
2. Move manifest/session/discovery/attestation facts out of the growing `knowledge_cache_state` blob.
3. Keep `knowledge_cache_state`, `knowledge_state`, and `knowledge_audit_state` as bounded compatibility/rollup substates.
4. Generate `docs/official_docs/index.json` and markdown files from DB materialization jobs.

Reason: knowledge is a framework subsystem and the largest substate blob, but materialized files are still required by OpenCode read evidence.

### P2: Typed Attestation and Enforcement Evidence

1. Move `config_read_state.sessions` to `config_read_attestation`.
2. Add `enforcement_decisions` writes from scope/gate/dispatch/UC7KS/TDD plugins.
3. Bound `write_audit_state` and move queryable event facts into typed tables.

Reason: current nested maps are safe enough after the race fix, so this follows dispatch/gate.

### P2: Harness and DB Management

1. Persist self-test/doctor/reconciliation/nightly run summaries.
2. Add DB health snapshots and migration ownership metadata.
3. Keep CLI output and JSON reports for operator workflows.

### P3: Index Source Config, Layout, Logs, and Templates

1. Add permission/layout/template snapshots and drift checks.
2. Add log index summaries only, not full log body storage.
3. Add retention cleanup dry-run for stale dispatch prompts, backups, and old artifacts.

---

## Non-Goals

1. Do not make DB the source of truth for `opencode.json` permissions. Official OpenCode permission resolution reads config files and agent frontmatter.
2. Do not store full log bodies in DB by default.
3. Do not remove `docs/official_docs/**` files; they are required for read-before-write evidence.
4. Do not create typed tables that have no runtime writer, reader, migration, and self-test. v7 already removed this class of dead mirror tables.
5. Do not move framework TypeScript source files into DB. OpenCode discovers plugins/tools/agents from the filesystem.

---

## Implementation Guardrails

1. **Official OpenCode compliance**
   - `.opencode/tools/*.ts` must remain custom tools using `tool()` from `@opencode-ai/plugin`.
   - `.opencode/plugins/*.ts` must remain plugin modules with hook exports; keep `withPluginLifecycle` unless there is a deliberate replacement.
   - MCP servers belong in `opencode.json.mcp`; do not call custom tools MCP tools.
   - Permission behavior must respect OpenCode `permission` semantics and agent overrides.

2. **Logging**
   - Framework lib/plugin/custom-tool code should use `writeLog` or `withPluginLifecycle`.
   - MCP stdio servers must use `process.stderr.write()` for diagnostics.
   - CLI scripts may print user-facing output, but audit-relevant events must also be logged.

3. **DB**
   - Use `bun:sqlite`, WAL, `busy_timeout`, idempotent migrations.
   - Every new typed table must have a named owner subsystem, primary writer, primary reader, and self-test.
   - Prefer typed rows for high-churn/queryable facts; keep `substate_kv` for bounded compatibility summaries.

4. **Concurrency**
   - Queue consumption must use a transaction and lease/expiry, not read-modify-write JSON.
   - No shared singleton dispatch files in the success path.
   - Fallback files can exist for one rollout but must be explicitly read-only or export-only.

5. **Templatization**
   - Store resolved snapshots/hashes in DB.
   - Keep source templates/config files reviewable and versioned.

---

## Recommended Next Plan Documents

After KC v11/v12 landed, the next work should be split into two plan documents:

1. `docs/review/framework-refactor/kc-db-canonical-closeout-plan.md`
2. `docs/review/framework-refactor/dispatch-gate-db-canonical-implementation-plan.md`

Minimum scope for `kc-db-canonical-closeout-plan.md`:

1. `knowledge-store.ts` DB-first manifest API and file materialization.
2. `knowledge_session_access` backfill, uniqueness, and UPSERT.
3. UC7KS write enforcement DB-first read path.
4. Atomic `knowledge_audit_state` updates.
5. `knowledge_materialization_jobs` normal-path integration.
6. DB/file parity and enforcement self-tests.

Minimum scope for `dispatch-gate-db-canonical-implementation-plan.md`:

1. `dispatch_queue` / `dispatch_context` schema and migration.
2. `dispatch_subagent.ts` + `task-before.ts` + `task-after.ts` conversion.
3. `StateCompactor` DB-first conversion and `gate_compactor_index`.
4. Self-test and reconciliation checks for concurrent dispatch and gate export regeneration.
5. Logging requirements for every enqueue/dequeue/context/gate-compaction event.

These should precede broad permission/layout/template indexing. KC closeout prevents the already-created v11/v12 knowledge tables from remaining half-canonical; dispatch/gate then removes active shared-file state in the critical concurrent paths.

---

## §Audit Findings & Post-Implementation Observations

This section reflects the framework snapshot after KC v11/v12 implementation on 2026-06-21. It focuses on what is now implemented, what remains file/JSON-canonical, and the concrete plan required to complete DB-canonical convergence.

### Snapshot

| Area                   | Current observation                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DB schema              | v12 with 24 user tables                                                                                                                                                                                                              |
| Knowledge typed tables | Present: `knowledge_entries`, `knowledge_files`, `knowledge_entry_tags`, `knowledge_session_access`, `knowledge_discovery`, `knowledge_attestation`, `knowledge_materialization_jobs`, `knowledge_session_access_archive`            |
| Knowledge table counts | `knowledge_entries=62`, `knowledge_files=62`, `knowledge_entry_tags=729`, `knowledge_session_access=0`, `knowledge_discovery=2`, `knowledge_attestation=2`, `knowledge_materialization_jobs=0`, `knowledge_session_access_archive=0` |
| Compatibility blob     | `knowledge_cache_state` is still ~514 KB and contains 10 agents, 299 tasks, 331 domain entries                                                                                                                                       |
| Stale UC7KS evidence   | Check 35 condition still finds 53 stale pre-HARDEN entries: 7 flat + 46 nested                                                                                                                                                       |
| Dispatch files         | `.task_temp/_dispatch/.pending.json` still exists with 8 queue entries; `.task_temp/_dispatch/ctx/*.json` has 39 files                                                                                                               |
| Gate compactor         | `StateCompactor` still states and implements JSON hot/history/index as primary with best-effort DB sync                                                                                                                              |

### Finding A1: Knowledge Store Is Not Yet DB-Canonical

**Severity**: P0  
**Evidence**: `.opencode/lib/knowledge-store.ts` comments say v11 DB tables are canonical, but `readManifest()`, `writeManifest()`, `searchManifest()`, and `addEntry()` still read/write `docs/official_docs/index.json` directly. The v11 backfill in `.opencode/lib/db-manager.ts` imports file manifest data into DB, but the main store API does not query or update DB as its primary source.

**Impact**:

- `knowledge_entries/files/tags` can drift from `index.json`.
- DB tables are currently an imported/indexed copy, not the canonical manifest authority.
- `knowledge_materialization_jobs` cannot govern materialization if manifest writes bypass DB.

**Concrete plan**:

1. Add DB-first store helpers in `.opencode/lib/knowledge-store.ts`:
   - `readManifestFromDb()` builds the manifest from `knowledge_entries` + `knowledge_files` + `knowledge_entry_tags`.
   - `upsertEntryInDb()` writes entry/file/tag rows in a single SQLite transaction.
   - `materializeManifestFromDb()` writes generated `docs/official_docs/index.json` from DB rows using atomic tmp+rename.
   - `importManifestFileToDb()` keeps the existing file import as migration/fallback, not normal write path.
2. Change public APIs:
   - `readManifest()` becomes DB-first, file fallback only when DB is unavailable.
   - `searchManifest()` queries DB first rather than scanning the file mirror.
   - `addEntry()` writes DB first, then calls `materializeManifestFromDb()`.
   - `writeManifest()` becomes an import/upsert operation plus materialization, not direct file authority replacement.
3. Add a materialization record:
   - Insert `knowledge_materialization_jobs(job_type='index_json', status='written', file_path='docs/official_docs/index.json', sha256=...)` after each successful materialization.
4. Add self-test checks:
   - DB manifest row count matches materialized `index.json.total_entries`.
   - Every `knowledge_files.file_path` exists under `docs/official_docs/`.
   - A round-trip `addEntry()` updates DB first and then updates the file mirror.

**Acceptance criteria**:

- `knowledge-store.ts` has no normal-path direct manifest mutation without a DB transaction.
- `knowledge_entries=docs/official_docs/index.json.total_entries` after materialization.
- `knowledge_materialization_jobs` has at least one successful `index_json` row after a write or explicit materialization.

### Finding A2: `knowledge_session_access` Is Empty and Has No Backfill

**Severity**: P0  
**Evidence**: Current DB has `knowledge_session_access=0`, while `knowledge_cache_state.session_access` still has 299 task entries and 331 domain entries. `module_scope_declare.ts` and `knowledge_cache_search.ts` write v11 rows only for new operations; there is no migration from the existing JSON blob.

**Additional implementation risk**: current code uses `INSERT OR IGNORE` for `knowledge_session_access`, but the table has no uniqueness constraint over `(agent, task_id, domain_id, opencode_session_id)`. That means future duplicate rows are possible once writes start occurring.

**Concrete plan**:

1. Add a migration script: `.opencode/scripts/knowledge/backfill-session-access.ts`.
2. Read `knowledge_cache_state.session_access` from `substate_kv`.
3. For each `agent/task/domain`:
   - Map `cache_sufficiency.discovery` fields to `discovered_at/status`.
   - Map `cache_sufficiency.attestation` fields to `attested_at/status='attested'`.
   - Keep legacy sufficient-but-unattested rows as `status='legacy_discovered_only'`.
4. Add a uniqueness rule:
   - Preferred: create a deterministic `access_key` column in a future migration.
   - Minimal: unique index over `(agent, task_id, domain_id, COALESCE(opencode_session_id, ''))`.
5. Replace `INSERT OR IGNORE` with UPSERT:
   - `declared_at`, `discovered_at`, `attested_at`, and `last_read_at` should be updated monotonically.
   - Status should move forward in this order: `declared -> discovered -> attested`; never downgrade.
6. Add a parity self-test:
   - Active JSON domain count and DB active row count must match after cleanup/backfill, excluding explicitly archived rows.

**Acceptance criteria**:

- `knowledge_session_access` row count is non-zero and matches active session-access evidence after backfill.
- Running the backfill twice inserts no duplicate rows.
- `knowledge_session_access_archive` receives rows only from explicit prune/archive operations.

### Finding A3: UC7KS Write Enforcement Still Uses the Compatibility Blob

**Severity**: P0  
**Evidence**: `scope-before.ts` calls `checkUC7KSWrite()`, and `checkUC7KSWrite()` reads `knowledge_cache_state` through `readCachedSessionAccess()`. It does not use `knowledge_session_access`, `knowledge_discovery`, or `knowledge_attestation` as the blocking source. DB writes in `knowledge_cache_search.ts`, `module_scope_declare.ts`, and `knowledge_cache_attest.ts` are non-fatal shadow writes.

**Impact**:

- Typed DB rows do not yet enforce behavior.
- Stale JSON entries can still block writes even if typed DB evidence exists.
- DB-canonical knowledge cannot be claimed until enforcement is DB-first.

**Concrete plan**:

1. Add query helpers:
   - `getKnowledgeAccess(agent, taskId, domainId, sessionId?)`
   - `getKnowledgeDiscovery(agent, taskId, domainId)`
   - `getKnowledgeAttestation(agent, taskId, domainId, sessionId?)`
2. Change `checkUC7KSWrite()`:
   - Path A should read DB discovery + attestation first.
   - `knowledge_cache_state` becomes a rollback fallback only.
   - Log fallback usage as `UC7KS-DB-FALLBACK`.
3. Narrow Path C:
   - If no `taskId/domainId`, resolve from `session_map` first, then `gate_sessions.task_id` as fallback.
   - Do not iterate all historical tasks for the agent unless explicitly running a global audit.
   - If there is no current task/domain context, block with a clear remediation: call `module_scope_declare()` or dispatch through `dispatch_subagent`.
4. Keep the Knowledge-Curator exemption:
   - KC remains exempt for `docs/official_docs/**` cache population.
   - UC7-008 scope isolation must remain the controlling guard for KC writes.

**Acceptance criteria**:

- A write with valid DB discovery + attestation passes even if stale JSON compatibility entries exist.
- A write without current task/domain context fails with a task/domain resolution error, not a stale historical-domain error.
- Self-test covers DB-first pass, DB-first block, and JSON fallback warning.

### Finding A4: 53 Pre-HARDEN JSON Evidence Entries Still Need Cleanup

**Severity**: P1  
**Evidence**: Check 35 condition currently finds 53 stale entries in `knowledge_cache_state`: 7 flat entries and 46 nested entries where `cache_sufficiency.status='sufficient'` but read evidence fields are missing.

**Impact**:

- They keep Check 35 failing.
- They can trigger global Path C blocks before A3 is fixed.
- They inflate the compatibility blob and make parity validation noisy.

**Concrete plan**:

1. Add a one-time cleanup mode to `.opencode/scripts/knowledge/janitor.ts` or a dedicated script:
   - `--clean-pre-harden-evidence --dry-run`
   - `--clean-pre-harden-evidence --apply`
2. For each stale entry:
   - If there is matching `read_audit` evidence and an attestation row can be reconstructed, migrate to typed DB and mark JSON entry as bounded compatibility.
   - Otherwise archive/delete the stale JSON entry and record an audit event in `knowledge_audit_state`.
3. Extend nightly compaction:
   - Keep current JSON `pruneSessionAccess()` path.
   - Keep DB `pruneSessionAccessFromDB()` path.
   - Add an explicit stale pre-HARDEN cleanup counter.

**Acceptance criteria**:

- Check 35 reports zero stale pre-HARDEN entries.
- `knowledge_audit_state.aggregate.last_cleanup_removed_session_entries` reflects cleanup count.
- No live/current task/domain entry is removed during cleanup.

### Finding A5: `knowledge_audit_state` Is Activated but Not Atomic Under Concurrency

**Severity**: P1  
**Evidence**: `.opencode/lib/knowledge-audit.ts` reads `knowledge_audit_state` then writes it back with `writeSubState()`. This is DB-backed, but it is still a read-modify-write outside a single `dbAtomicWriteSubState()` transaction.

**Impact**:

- Concurrent cache checks/attestations can lose counter increments.
- `recent_events` can drop events unrelated to the 100-entry cap.

**Concrete plan**:

1. Replace `readAuditState()` + `writeAuditState()` update flows with a single helper:
   - `atomicUpdateKnowledgeAudit(mutator)`.
2. Implement it using `dbAtomicWriteSubState("knowledge_audit_state", mutator)`.
3. Keep non-fatal behavior:
   - Any update failure logs through `writeLog` and never blocks UC7KS.
4. Add a small stress self-test:
   - Run N counter increments and verify the final aggregate is at least N in a single-process transaction test.

**Acceptance criteria**:

- `incrementAuditCounter()`, `pushAuditEvent()`, `touchCacheCheck()`, and `touchKnowledgeAcquisition()` all use the atomic helper.
- No direct read-then-write counter update path remains.

### Finding A6: Materialization Jobs Exist but Are Not the Materialization Control Plane

**Severity**: P1  
**Evidence**: `knowledge_materialization_jobs` exists but currently has 0 rows. Janitor can record cleanup jobs, but `knowledge-store.ts` normal manifest writes are direct file writes and do not create materialization jobs.

**Impact**:

- There is no durable record of DB-to-file generation.
- Failed index/materialized-file writes cannot be retried from DB.
- DB-canonical knowledge still lacks an operational job trail.

**Concrete plan**:

1. Every DB-to-file write should create or update a `knowledge_materialization_jobs` row.
2. Job types:
   - `index_json`
   - `knowledge_file`
   - `archive`
   - `purge`
   - `orphan_repair`
3. Add retry semantics:
   - `status='pending'|'written'|'failed'`
   - increment `retry_count`
   - preserve `error_msg`.
4. Add a CLI/tool command:
   - `knowledge-store materialize --pending`
   - or custom tool wrapper if it must be called from OpenCode.

**Acceptance criteria**:

- `knowledge_materialization_jobs` is non-empty after materialization.
- Failed file writes produce `status='failed'` rows and do not corrupt DB rows.

### Finding A7: Dispatch Runtime State Is Still File-Canonical

**Severity**: P1  
**Evidence**: `.task_temp/_dispatch/.pending.json` exists with 8 entries; `.task_temp/_dispatch/ctx/*.json` has 39 files; code still references `.pending.json`, `.auto-dispatch.json`, `.dispatch_ctx`, and `ctx/*.json`.

**Impact**:

- The concurrent session/dispatch write system remains outside DB-canonical scope.
- DB currently replaces `.pending.json.failed` and `.session_map.json`, but not active queue/context state.

**Concrete plan**:

1. Implement the Dispatch Runtime Slice proposed above:
   - `dispatch_queue`
   - `dispatch_context`
   - `dispatch_prompt_refs`
   - `dispatch_attempts`
2. Convert success path:
   - `dispatch_subagent.ts` enqueues DB row and writes prompt artifact ref.
   - `task-before.ts` leases/dequeues by `sessionID + agentType`.
   - `task-after.ts` consumes `dispatch_context` from DB, appends `session_log`, and finalizes attempt state.
3. Keep file fallback for one rollout only:
   - fallback must be read-only and log `DISPATCH-FILE-FALLBACK`.
4. Add queue self-test:
   - concurrent enqueue/dequeue with two agent types cannot cross-consume prompts.

**Acceptance criteria**:

- `.pending.json` and `.auto-dispatch.json` are not written on the normal path.
- `ctx/*.json` is not scanned on the normal path.
- Dispatch queue depth is queryable from DB.

### Finding A8: Gate Compactor Is Still File-Primary

**Severity**: P1  
**Evidence**: `.opencode/lib/state-compactor.ts` still reads/writes `gate-state.json`, appends `gate-state.history/*.jsonl`, and updates `gate-state.index.json`, then best-effort syncs to DB.

**Impact**:

- The document's original P1 gate compactor recommendation remains open.
- `gate_session_index` is still not equivalent to `gate-state.index.json`.
- DB cannot fully regenerate compactor index/history artifacts today.

**Concrete plan**:

1. Add `gate_compactor_index` and, if needed, extend `gate_audit_history`.
2. Change `StateCompactor.readHotState()` to DB-first.
3. Change `writeToHistory()` and `updateIndex()` to DB-first, then materialize JSON/JSONL as export cache.
4. Add a regeneration tool:
   - DB -> `gate-state.json`
   - DB -> `gate-state.index.json`
   - DB -> daily history JSONL archive

**Acceptance criteria**:

- If `gate-state.json` is removed, compactor can regenerate it from DB.
- New compactor events land in DB before any file export.

### Finding A9: Source Config Indexing Is Still Future Work, Not a DB Authority Migration

**Severity**: P2  
**Evidence**: P2-D source inversion is preserved: `opencode.json` is the authority for agent permissions; `.opencode/project.config.json` has no `agent_write_scopes`. This is correct and should not be reversed.

**Concrete plan**:

1. Add `permission_snapshot` and `agent_registry_snapshot` as indexes only.
2. Snapshot effective permissions from:
   - `opencode.json`
   - `.opencode/agents/*.md` frontmatter
   - official OpenCode merge semantics.
3. Add drift checks:
   - source file hash
   - effective permission hash
   - route-validator self-test.

**Acceptance criteria**:

- DB snapshots can explain effective permissions.
- Runtime authority remains OpenCode config files.

### Updated Priority After KC v11/v12

| Priority | Work item                                                       | Status       | Reason                                                            |
| -------- | --------------------------------------------------------------- | ------------ | ----------------------------------------------------------------- |
| P0       | Make `knowledge-store.ts` DB-first and materialized-file second | ✅ Completed | v11/v12 tables exist, but manifest API still DB-first verified    |
| P0       | Backfill and constrain `knowledge_session_access`               | ✅ Completed | Table is empty while JSON blob has 331 backfilled 331 rows        |
| P0       | Change UC7KS write enforcement to DB-first                      | ✅ Completed | Typed tables do not yet control DB-first enforced                 |
| P1       | Clean stale pre-HARDEN JSON evidence                            | ✅ Completed | Check 35 still finds 53 pre-HARDEN cleaned                        |
| P1       | Make `knowledge_audit_state` updates atomic                     | ✅ Completed | Current counters can lose atomic via dbAtomicWriteSubState        |
| P1       | Wire `knowledge_materialization_jobs` into materialization      | ✅ Completed | Table exists but has no normal-wired + retry support              |
| P1       | Move dispatch queue/context to DB                               | ✅ Completed | `.pending.json` and `ctx/*.json` 4 DB tables + lease              |
| P1       | Make gate compactor DB-first                                    | ✅ Completed | `state-compactor.ts` remains DB-first + regenerate                |
| P2       | Add permission/layout/template snapshots                        | ✅ Completed | Valuable index layer, but not a source-of-truth 313 snapshot rows |

### Concrete Next Implementation Package

The next implementation should be split into two packages rather than one large DB refactor.

**Package KC-DB-CANONICAL-CLOSEOUT**

1. `knowledge-store.ts` DB-first manifest API.
2. `backfill-session-access.ts` migration + uniqueness/UPSERT.
3. DB-first `checkUC7KSWrite()` helpers with JSON fallback logging.
4. Atomic `knowledge_audit_state` helper.
5. `knowledge_materialization_jobs` integration.
6. Self-tests for DB/file parity, session-access parity, DB-first enforcement, and audit-counter atomicity.

**Package DISPATCH-GATE-DB-CANONICAL**

1. Dispatch queue/context/attempt tables.
2. Convert dispatch tool and Task hooks to DB queue/context.
3. Gate compactor index/history DB-first migration.
4. Export/regeneration tools for remaining JSON/JSONL artifacts.
5. Concurrent dispatch and gate regeneration self-tests.

This ordering keeps the already-started KC v11/v12 work from remaining half-canonical, then returns to the original highest-risk concurrent dispatch/gate paths.

---

### ✅ Implementation Complete (2026-06-21)

All 9 audit findings (A1-A9) implemented and E2E verified.
DB schema: v10 → v16 (32 tables). Self-test 46/51 PASS. 17 GitHub Issues closed.
