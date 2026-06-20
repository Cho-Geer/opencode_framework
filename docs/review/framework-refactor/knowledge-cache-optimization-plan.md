# Knowledge Cache Optimization Plan

**Generated**: 2026-06-20  
**Reviewed / Updated**: 2026-06-20  
**Author**: @Super-Admin  
**Task ID**: PLAN-KC-CACHE-OPTIMIZATION  
**GitHub Epic**: [#28](https://github.com/Cho-Geer/opencode_framework/issues/28) — [Epic] Knowledge Cache DB-Canonical Optimization  
**GitHub Project**: [Opencode_framework #2](https://github.com/users/Cho-Geer/projects/2)  
**Based on**: current framework code, `.task_temp/REVIEW-DB-CANONICAL-PROPOSAL/review-report.md`, `storage-entity-landscape.md` (2026-06-19 snapshot), `framework-evaluation-report.md`, `p1b-execution-summary.md`, `database-migration-plan.md`, `machine-split-implementation-plan.md`, local OpenCode official docs under `docs/official_docs/`  
**Current DB**: `framework-state.db` v10, `substate_kv` 13 keys, `knowledge_cache_state` 907,067 bytes, `knowledge_audit_state` 552 bytes, `config_read_state` 24,280 bytes

---

## Executive Summary

The original plan correctly identified that `knowledge_cache_state` is the dominant state blob, but several conclusions were stale after the latest framework updates.

1. **Keep and use `knowledge_audit_state`; do not delete it as P0.**  
   It currently has zero active writers, but the framework is DB-only for substates and `knowledge_audit_state` is already registered in `SUBSTATE_FILES`, `SubStateMap`, schema files, and `substate_kv`. Deleting it saves only 552 bytes and removes the correct DB-managed place for aggregate knowledge-pipeline audit rollups. It is better to activate it as a small rollup/summary state while keeping enforcement evidence in `knowledge_cache_state`.

2. **`knowledge_cache_state` bloat is real, but current cleanup is not "absent".**  
   Current DB evidence shows 10 agents, 445 task entries, and 494 domain entries under `session_access`. Existing code has agent-level caps (`evictOldAgents`) and nightly stale-agent cleanup, but it does not prune nested `tasks[task_id].domains[domain_id]` records. The priority is nested task/domain TTL + LRU, not a generic first pruning mechanism.

3. **Reverse orphan detection already exists in `framework-self-test.ts` Check 22c.**  
   The next step is to extract/reuse that logic in `indexer.ts` or a new `integrity-check.ts`, then invoke it from `janitor.ts`. Do not add a duplicate Check 22b with overlapping behavior.

4. **OpenCode terminology must be corrected.**  
   Files under `.opencode/tools/` are OpenCode custom tools, not MCP tools. Real MCP servers are configured under `opencode.json.mcp`. This distinction matters for official OpenCode tool, MCP, and permission semantics.

5. **Logging integration must be explicit.**  
   Plugins and custom tools should use the framework log system (`writeLog`, `withPluginLifecycle`) and avoid raw console output. CLI scripts may keep user-facing `console.log`/`console.error`, but every audit-relevant event must also go through `writeLog`.

6. **DB-canonical knowledge store should proceed, but not as another large `substate_kv` blob.**  
   The framework is DB-only for sub-states, but `substate_kv` is the contract for the 13 flexible sub-state keys, not a ban on typed domain tables. The right next architecture is typed knowledge-domain tables plus a generated file materialized view, while `knowledge_cache_state`, `knowledge_state`, and `knowledge_audit_state` remain bounded compatibility/rollup substates.

7. **The file view remains mandatory for OpenCode read evidence.**  
   `docs/official_docs/index.json` and markdown files should become generated compatibility artifacts, not disappear. `knowledge_cache_attest.ts` and `read-track-after.ts` prove actual reading through OpenCode `read` events, so DB-only content without materialized files would break the read-before-write evidence chain.

---

## Audit Findings

### A1. Official OpenCode Compliance

The relevant local official docs establish these constraints:

| Area         | Official / local rule                                                                                                                     | Current framework fit                                                                                                                                         | Required doc correction                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Custom tools | Project tools live in `.opencode/tools/`; single-file default export uses `tool()` from `@opencode-ai/plugin`; filename becomes tool name | `knowledge_cache_search.ts`, `knowledge_cache_attest.ts`, `module_scope_declare.ts`, `knowledge_gap_report.ts`, and `config_read_attest.ts` follow this shape | Call them **custom tools**, not MCP tools                                                                    |
| MCP servers  | MCP servers are declared under `opencode.json.mcp`; tool names follow `<server-name>_<tool-name>`                                         | `compliance-gate`, `eslint-audit`, `code-quality-check`, `context7`, etc. are MCP servers                                                                     | Do not propose a new MCP server for KC optimization unless cross-process external tooling is actually needed |
| Plugins      | `.opencode/plugins/*.ts` are local plugins; `tool.execute.before` can block by throwing; `tool.execute.after` observes results            | `scope-before`, `uc7ks-before`, `uc7ks-after`, `cache-after`, `read-track-after`, `dispatch-before` use the expected hook model                               | Plan must include all KC-relevant plugins, not only two after-hooks                                          |
| Permissions  | `permission` gates built-in, custom, and MCP tools; agent permissions merge with global config                                            | `opencode.json` and `.opencode/agents/*.md` both declare runtime/tool intent                                                                                  | Do not infer runtime tool availability from agent frontmatter alone                                          |
| Logging      | Official plugin docs allow `client.app.log`; this project standardizes on `log-manager.ts`                                                | Framework code uses `writeLog` and `withPluginLifecycle` as the central logging path                                                                          | New code should use `writeLog`; plugin lifecycle should use `withPluginLifecycle`                            |

Minor code-convention cleanup noted during audit:

- `knowledge_cache_search.ts` still uses `require("../lib/substate-manager")` while the rest of the custom tool is ESM-style. Prefer `import { readSubState } from "../lib/substate-manager"`.
- `config_read_attest.ts` imports `writeSubState` but writes through `dbAtomicWriteSubState`; remove the unused import when touching the file.
- `janitor.ts` is a CommonJS-style CLI script and can keep console output, but new audit events must be paired with `srcLog()` / `writeLog()`.

### A2. Current DB / State Facts

| Entity                                | Current fact  |
| ------------------------------------- | ------------- |
| DB schema                             | v10           |
| `substate_kv` keys                    | 13            |
| `knowledge_cache_state`               | 907,067 bytes |
| `knowledge_audit_state`               | 552 bytes     |
| `knowledge_state`                     | 538 bytes     |
| `config_read_state`                   | 24,280 bytes  |
| `knowledge_cache_state.total_entries` | 62            |
| `session_access` agents               | 10            |
| `session_access` tasks                | 445           |
| `session_access` domains              | 494           |
| attested domain entries               | 28            |

### A3. Subsystem Coverage

The optimization must preserve these subsystems:

| Subsystem                       | Current role                                                                | Optimization requirement                                            |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `read-track-after.ts`           | Records every `read` into `read_audit` DB                                   | Must remain the raw read source for attestation                     |
| `read-audit.ts`                 | DB-only read writes; JSONL read fallback for historical data                | No new JSONL writes                                                 |
| `module_scope_declare.ts`       | Starts per-task/per-domain UC7KS chain                                      | Add audit rollup writes only as non-fatal side effects              |
| `knowledge_cache_search.ts`     | Writes discovery and rollups to `knowledge_cache_state` / `knowledge_state` | Add nested pruning and audit rollup updates                         |
| `knowledge_cache_attest.ts`     | Cross-verifies reads against `read_audit` and writes attestation            | Keep attestation as write-block authority; add audit rollup updates |
| `uc7ks-after.ts`                | Records cache read metadata after `read`                                    | Do not mark sufficiency; only metadata + audit rollup               |
| `uc7ks-before.ts`               | Blocks direct external tools when cache protocol not met                    | Must not depend on `knowledge_audit_state` for blocking             |
| `scope-before.ts`               | Blocks writes without config read + UC7KS evidence                          | Must continue reading `knowledge_cache_state`, not audit rollups    |
| `cache-after.ts`                | Syncs index read/cache status                                               | Add audit rollup update for cache checks                            |
| `dispatch-before.ts`            | Controls KC self-healing dispatch path                                      | Record KC dispatch count in audit rollup                            |
| `framework-self-test.ts`        | Checks manifest, schema, tool registration, UC7KS evidence                  | Update checks instead of duplicating reverse orphan logic           |
| `nightly-compaction.ts`         | Runs state compaction, DB maintenance, stale session cleanup                | Move nested task/domain cleanup here or call shared helper          |
| `.opencode/scripts/knowledge/*` | KC maintenance scripts                                                      | Use `writeLog` for audit-relevant events                            |

---

## 1. `knowledge_audit_state` Decision

### 1.1 Current State

`knowledge_audit_state` is currently dormant, not invalid:

| Artifact               | Location                                                    | Current status                                                              |
| ---------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Schema                 | `.opencode/state/schemas/knowledge-audit-state.schema.json` | Exists; describes cache checks, misses, curator dispatches, aggregate stats |
| Type interface         | `.opencode/lib/substate-types.ts`                           | Exists, but too narrow and currently does not match the schema              |
| Registration           | `.opencode/lib/substate-manager.ts`                         | Registered in DB-only substate manager                                      |
| Legacy full schema     | `.opencode/state/machine.schema.full.json`                  | Still references the state                                                  |
| DB row                 | `substate_kv.key='knowledge_audit_state'`                   | Present, 552 bytes                                                          |
| Active readers/writers | framework code                                              | No active runtime writer today                                              |

### 1.2 Decision: Retain and Activate

**Decision**: Retain `knowledge_audit_state` and repurpose it as a DB-managed audit rollup state.

Rationale:

1. The framework has already standardized substate storage on SQLite `substate_kv`. DB management is more reliable and maintainable than resurrecting file state or spreading counters across logs.
2. Deleting the row saves only 552 bytes and does not materially reduce complexity.
3. `knowledge_cache_state` is already too large because it mixes enforcement evidence, discovery/attestation facts, compatibility fields, and rollups. Putting aggregate audit counters in `knowledge_audit_state` reduces future pressure on `knowledge_cache_state`.
4. Raw event history already lives elsewhere: `read_audit`, `audit_log`, gate history, and runtime logs. `knowledge_audit_state` should store bounded rollups, not full event history.
5. Enforcement should remain based on `knowledge_cache_state` + `read_audit`; audit rollups must not become a new blocking dependency.

### 1.3 Correct Responsibility Split

| State / table              | Responsibility                                                                                                    | Blocking path?                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `knowledge_cache_state`    | Per-agent/per-task/per-domain UC7KS enforcement state: declaration, discovery, attestation, compatibility rollups | Yes                                                          |
| `read_audit`               | Raw read events, DB-first verification source                                                                     | Yes, through `knowledge_cache_attest` and config/read checks |
| `knowledge_audit_state`    | Bounded aggregate audit rollups: cache checks, hits/misses, KC dispatches, integrity results, cleanup metrics     | No                                                           |
| `knowledge_state`          | Cache inventory metadata and janitor metadata                                                                     | No                                                           |
| `audit_log` / runtime logs | Append-only operational/audit event stream                                                                        | Diagnostic/backstop                                          |

### 1.4 P0 Action Items

| Step | Action                                                                                                           | File(s)                                                                                                                                       | Priority |
| ---- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1    | Keep schema file and update it to match actual planned rollup shape                                              | `.opencode/state/schemas/knowledge-audit-state.schema.json`                                                                                   | P0       |
| 2    | Expand `KnowledgeAuditState` type to match schema; remove type/schema drift                                      | `.opencode/lib/substate-types.ts`                                                                                                             | P0       |
| 3    | Add a small helper for non-fatal audit rollup updates                                                            | New `.opencode/lib/knowledge-audit.ts` or existing shared lib                                                                                 | P0       |
| 4    | Write aggregate rollups from KC custom tools and KC plugins                                                      | `knowledge_cache_search.ts`, `knowledge_cache_attest.ts`, `module_scope_declare.ts`, `cache-after.ts`, `uc7ks-after.ts`, `dispatch-before.ts` | P0       |
| 5    | Add self-test coverage that `knowledge_audit_state` is registered, schema/type aligned, and writer helper exists | `.opencode/scripts/framework-self-test.ts`                                                                                                    | P1       |
| 6    | Do **not** put write-block decisions on `knowledge_audit_state`                                                  | `scope-before.ts`, `uc7ks-utils.ts`                                                                                                           | P0       |

Suggested bounded shape:

```json
{
  "enabled": true,
  "last_cache_check": "2026-06-20T00:00:00.000Z",
  "last_knowledge_acquisition": "2026-06-20T00:00:00.000Z",
  "aggregate": {
    "total_cache_checks": 0,
    "total_cache_hits": 0,
    "total_cache_misses": 0,
    "total_attestations": 0,
    "total_attestation_failures": 0,
    "total_curator_dispatches": 0,
    "total_external_fetches": 0,
    "reverse_orphan_count": 0,
    "last_cleanup_removed_session_entries": 0
  },
  "recent_events": []
}
```

`recent_events` must be capped (for example, last 100 entries). Full history belongs in logs/DB tables, not in this substate.

---

## 2. Knowledge Cache Update Chain

### 2.1 Custom Tools, Not MCP Tools

These are OpenCode custom tools under `.opencode/tools/`:

| Tool                     | Function                                                           | Writes to                                  |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------ |
| `module_scope_declare`   | Declares task/domain scope and starts nested UC7KS chain           | `knowledge_cache_state`, `session_map`     |
| `knowledge_cache_search` | Searches `docs/official_docs/index.json`; writes machine discovery | `knowledge_cache_state`, `knowledge_state` |
| `knowledge_cache_attest` | Verifies actual reads against `read_audit`; writes attestation     | `knowledge_cache_state`                    |
| `knowledge_gap_report`   | Reports coverage across semantic domains                           | Read-only                                  |
| `config_read_attest`     | Verifies mandatory config reads before writes                      | `config_read_state`                        |
| `resolve_domain_id`      | Resolves dispatch-assigned domain                                  | Read-only / session map dependent          |

No new MCP server is required for the current optimization. If future external KC functionality is needed, it must be added under `opencode.json.mcp` using the official local/remote MCP server format.

### 2.2 KC-Relevant Plugins

| Plugin                      | Hook                        | Current role                                         | Optimization impact                                              |
| --------------------------- | --------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| `read-track-after.ts`       | `tool.execute.after`        | Records read events to `read_audit`                  | Keep as source of truth for actual reads                         |
| `cache-after.ts`            | `tool.execute.after`        | Syncs cache status after index reads                 | Add `knowledge_audit_state.aggregate.total_cache_checks`         |
| `uc7ks-after.ts`            | `tool.execute.after`        | Records read metadata; does not mark sufficiency     | Add audit rollup only; do not create write-block evidence        |
| `uc7ks-before.ts`           | `tool.execute.before`       | Blocks external docs tools when protocol is violated | No audit-state dependency                                        |
| `scope-before.ts`           | `tool.execute.before`       | Blocks writes without config read + UC7KS evidence   | No audit-state dependency                                        |
| `dispatch-before.ts`        | `tool.execute.before`       | Controls KC dispatch/self-healing                    | Count KC dispatches in audit rollup                              |
| `gate-before.ts` / gate MCP | `tool.execute.before` + MCP | Compliance gate and DAG backstop                     | No direct KC state changes unless future gate metrics are needed |

### 2.3 Knowledge Scripts

| Script               | Purpose                                   | Logging requirement                                    |
| -------------------- | ----------------------------------------- | ------------------------------------------------------ |
| `archiver.ts`        | Archive/prune old docs archives           | Keep `writeLog` events                                 |
| `compressor.ts`      | Compress large cache files                | Keep `writeLog` events                                 |
| `deduplicator.ts`    | Hash duplicate detection helper           | Add logging only if it becomes a command entry point   |
| `indexer.ts`         | Manifest read/write/search/stats          | Add reusable integrity/reverse-orphan function         |
| `janitor.ts`         | TTL, archive, size cap, size report       | Pair all audit-relevant console output with `writeLog` |
| `scout-extractor.ts` | Convert scout output to docs              | Add `writeLog` if used in automated KC flow            |
| `scout-trigger.ts`   | Decide whether scout escalation is needed | Add `writeLog` if used in automated KC flow            |
| `size-reporter.ts`   | Cache size report                         | Keep `writeLog` events                                 |

---

## 3. DB-Canonical Knowledge Store Implementation Plan

### 3.1 Architecture Decision

**Decision**: Implement a DB-canonical knowledge subsystem with typed knowledge-domain tables and a generated file materialized view.

This does **not** replace the P1-B `substate_kv` contract. The split is:

| Layer                       | Canonical owner                       | Purpose                                                                                                            |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Typed knowledge tables      | SQLite v11+ schema                    | Manifest, files/content metadata, search/index state, session access, discovery, attestation, materialization jobs |
| `substate_kv`               | Existing DB-only sub-state API        | Bounded compatibility summaries and rollups: `knowledge_cache_state`, `knowledge_state`, `knowledge_audit_state`   |
| File materialized view      | Generated from typed DB tables        | `docs/official_docs/index.json` and markdown files for OpenCode `read` evidence, Git review, human inspection      |
| Runtime logs / audit tables | `writeLog`, `read_audit`, `audit_log` | Append-only operational and read-evidence history                                                                  |

Rationale:

1. `db-state-manager.ts` explicitly allows typed tables as a structured-query optimization layer, while `substate_kv` remains the full JSON source for sub-state compatibility.
2. `knowledge_cache_state` is already the largest `substate_kv` blob and is growing through nested task/domain evidence. Putting the full knowledge manifest or content into another `substate_kv` JSON blob would repeat the hot-row/full-replacement problem.
3. OpenCode read-before-write evidence depends on real files opened by the `read` tool. Therefore DB canonical storage must still materialize files under `docs/official_docs/**`.
4. v7 removed typed sub-state tables because they were never populated and had zero SQL readers. New typed knowledge tables are acceptable only when they have concrete runtime writers/readers, backfill, and self-test coverage.

### 3.2 Proposed v11 Typed Tables

Add these tables in `.opencode/lib/db-manager.ts` under schema v11. Names should be treated as final only after implementation review, but the responsibilities are stable.

| Table                            | Responsibility                                                                                                          | Primary readers                                                                                        | Primary writers                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `knowledge_entries`              | One logical knowledge record: `library_id`, `query_topic`, `domain`, source metadata, status, timestamps                | `knowledge-store.ts`, `knowledge_cache_search.ts`, `knowledge_gap_report.ts`, `framework-self-test.ts` | `indexer.ts`, curator/scout ingestion, migration backfill                                             |
| `knowledge_files`                | One materialized file/content record: relative path, sha256, size, ttl, source, status, materialization hash/timestamps | `knowledge-store.ts`, `knowledge_cache_attest.ts`, janitor, self-test                                  | `knowledge-store.ts`, indexer, janitor, materializer                                                  |
| `knowledge_entry_tags`           | Many-to-one tags/aliases for search and semantic-map validation                                                         | search/gap report/self-test                                                                            | indexer/backfill                                                                                      |
| `knowledge_session_access`       | Normalized per-agent/per-task/per-domain runtime access/discovery/attestation summary                                   | `uc7ks-utils.ts`, `scope-before.ts`, nightly compaction                                                | `module_scope_declare.ts`, `knowledge_cache_search.ts`, `knowledge_cache_attest.ts`, `uc7ks-after.ts` |
| `knowledge_discovery`            | Machine-generated discovery events from cache search                                                                    | `knowledge_cache_attest.ts`, reports                                                                   | `knowledge_cache_search.ts`                                                                           |
| `knowledge_attestation`          | Agent-submitted read attestation verified against `read_audit`                                                          | `scope-before.ts`, reports, self-test                                                                  | `knowledge_cache_attest.ts`                                                                           |
| `knowledge_materialization_jobs` | Pending/written/failed DB-to-file materialization status                                                                | janitor, self-test, operator tooling                                                                   | `knowledge-store.ts`, indexer, janitor                                                                |

Guardrails:

1. Do not recreate dead v7 typed sub-state tables as passive mirrors.
2. Do not remove `knowledge_cache_state` during the migration; keep it as a bounded compatibility summary until all consumers use `knowledge-store.ts`.
3. Use explicit indexes for lookup paths: `(domain, status)`, `(library_id, query_topic)`, `(entry_id)`, `(agent, task_id, domain_id)`, `(opencode_session_id, agent)` where applicable.
4. Add self-test checks that every v11 table has at least one runtime reader/writer reference or is explicitly marked transitional.
5. Rollback must leave current v10 behavior intact by reading generated `index.json` and `substate_kv` summaries.

### 3.3 `knowledge-store.ts` API

Add `.opencode/lib/knowledge-store.ts` as the only library API for DB canonical knowledge operations. Consumers should not query knowledge tables directly except inside this library and self-tests.

Required functions:

| Function                                   | Purpose                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `readManifest()`                           | Build manifest shape from typed DB tables; fallback to file manifest only during Phase 0 |
| `writeManifest(manifest, options)`         | Backfill/upsert manifest into DB and materialize `index.json`                            |
| `searchEntries({ domain, tags, keyword })` | DB-backed query used by `knowledge_cache_search.ts`                                      |
| `addEntry(entry)` / `upsertFile(file)`     | Curator/indexer ingestion path                                                           |
| `recordDiscovery(...)`                     | Normalize discovery into typed table and update `knowledge_cache_state` summary          |
| `recordAttestation(...)`                   | Normalize attestation into typed table and update `knowledge_cache_state` summary        |
| `materializeView(options)`                 | Atomically write `index.json` and content files from DB                                  |
| `checkMaterializedView()`                  | Compare DB hashes/counts to files for self-test and janitor                              |
| `getKnowledgeStats()`                      | Replace current file-only `getStats()`                                                   |

Implementation constraints:

1. Library code logs failures and material operational milestones with `writeLog("lib-knowledge-store", "INFO"|"WARN"|"ERROR", ...)`.
2. Library functions should return typed result objects instead of throwing for expected drift states; unexpected DB failures may throw only when the caller can fail safely.
3. `writeManifest()` and `materializeView()` must use atomic temp-file + rename for `index.json`.
4. A materialization failure must leave DB canonical rows intact and create/retain a `knowledge_materialization_jobs.status="failed"` record for repair.
5. `knowledge-store.ts` must not call OpenCode external tools; it is a framework library, not an MCP/custom tool.

### 3.4 File Materialized View Policy

`docs/official_docs/index.json` and markdown files remain required, but their authority changes:

| File artifact                    | New role                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `docs/official_docs/index.json`  | Generated compatibility manifest for OpenCode agents, Git diff, and fallback          |
| `docs/official_docs/**/*.md`     | Generated or retained materialized content for `read` evidence                        |
| `docs/official_docs/.metadata/*` | Generated reports/archives; should be tracked by DB maintenance metadata where useful |

Policy:

1. DB rows are canonical; file-newer drift is not normal success. Treat file-newer as a reconciliation event.
2. Every DB write that affects agent-visible knowledge must either materialize the file view synchronously or record a pending materialization job.
3. Self-test must fail in strict/CI mode when DB and materialized files disagree beyond documented transitional fallback.
4. `read-track-after.ts` continues recording actual `read` calls to `read_audit`; `knowledge_cache_attest.ts` continues verifying against `read_audit`.
5. Do not use "whichever is newer" as the read rule; that creates two canonical sources.

### 3.5 Phased Rollout

| Phase | Scope                                                                 | Required outcome                                                                                                                                                   |
| ----- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0-A  | Repair current knowledge scripts                                      | `indexer.ts` has required imports/CLI path; `janitor.ts` imports `readManifest` / `writeManifest` correctly; both pair audit events with `writeLog`                |
| P0-B  | Introduce `knowledge-store.ts` over current file manifest             | No schema change yet; custom tools/scripts can call stable API; existing behavior preserved                                                                        |
| P1-A  | Add v11 typed tables and backfill from `index.json` + existing files  | DB has canonical entries/files/tags; generated `index.json` is byte-stable or semantically equivalent                                                              |
| P1-B  | Move search/discovery/attestation writes through `knowledge-store.ts` | `knowledge_cache_search.ts` reads DB; `knowledge_cache_attest.ts` writes typed attestation and compatibility summary                                               |
| P1-C  | Normalize session access out of the large blob                        | `knowledge_session_access`, `knowledge_discovery`, and `knowledge_attestation` become canonical; `knowledge_cache_state` stores bounded latest/rollup summary only |
| P2-A  | Move janitor/indexer/size reporter to DB canonical operations         | TTL/archive/LRU decisions use DB metadata; file changes are materialization side effects                                                                           |
| P2-B  | Add consistency and drift self-tests                                  | DB table checks, materialized view checks, reverse orphan checks, table reader/writer checks                                                                       |
| P3    | Remove transitional fallbacks only after clean rollout                | File manifest read remains as emergency fallback but no normal write path treats it as canonical                                                                   |

### 3.6 Subsystem Integration Requirements

| Subsystem                               | Required integration                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `knowledge_cache_search.ts`             | Use `searchEntries()`; keep custom tool shape with `tool()`; log `KC-SEARCH-DB-HIT` / `KC-SEARCH-DB-MISS`; write discovery through `recordDiscovery()` |
| `knowledge_cache_attest.ts`             | Keep `read_audit` cross-check; write typed attestation through `recordAttestation()`; keep `knowledge_cache_state` compatibility summary               |
| `module_scope_declare.ts`               | Keep declaring task/domain; optionally create a typed `knowledge_session_access` row in non-fatal mode                                                 |
| `uc7ks-utils.ts`                        | Read blocking evidence through `knowledge-store.ts` when typed DB is enabled; fallback to `knowledge_cache_state` during transition                    |
| `scope-before.ts`                       | No direct table SQL; depend on `uc7ks-utils.ts`; do not use `knowledge_audit_state` for blocking                                                       |
| `uc7ks-after.ts`                        | Continue recording metadata only; do not mark sufficiency; route future typed metadata through `knowledge-store.ts`                                    |
| `cache-after.ts`                        | Keep index read/cache status as compatibility only; DB materialization checks move to `knowledge-store.ts` / self-test                                 |
| `dispatch-before.ts`                    | Count Knowledge-Curator dispatches in `knowledge_audit_state`; do not infer task planning state from knowledge tables                                  |
| `read-track-after.ts` / `read-audit.ts` | Remain source of truth for actual read evidence; no new JSONL writes                                                                                   |
| `framework-self-test.ts`                | Add v11 table existence/index checks, DB↔file materialized consistency, reader/writer ownership checks, and use shared orphan helper                   |
| `nightly-compaction.ts`                 | Use shared nested pruning and DB maintenance helpers; log cleanup metrics                                                                              |
| `.opencode/scripts/knowledge/*`         | Move manifest/stats/janitor operations through `knowledge-store.ts`; CLI output allowed, audit events must use `writeLog`                              |
| `knowledge_gap_report.ts`               | Use DB-backed manifest/tags and compare against `knowledge_semantic_map`                                                                               |

### 3.7 Official OpenCode Compliance

Implementation must stay within official OpenCode conventions:

1. `.opencode/tools/*.ts` remain custom tools and must export `tool()` from `@opencode-ai/plugin`.
2. No new MCP server should be added for local knowledge-store behavior. MCP is only for external protocol/server integration under `opencode.json.mcp`, and MCP tool names follow `<server-name>_<tool-name>`.
3. Plugins remain `.opencode/plugins/*.ts` with `tool.execute.before` / `tool.execute.after` hooks. Blocking logic may throw only from before-hooks.
4. Project permissions must be updated only if new custom tool names are introduced. Prefer updating existing custom tools over adding new tool surface.
5. Do not infer subagent runtime availability from agent frontmatter alone; document observed registration/permission and verify with self-test where possible.

### 3.8 Logging Requirements for DB-Canonical Work

Required log sources and events:

| Source                       | Events                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib-knowledge-store`        | `KC-DB-BACKFILL-START`, `KC-DB-BACKFILL-COMPLETE`, `KC-DB-UPSERT-FAILED`, `KC-MATERIALIZE-START`, `KC-MATERIALIZE-COMPLETE`, `KC-MATERIALIZE-FAILED`, `KC-DRIFT-DETECTED` |
| `knowledge_cache_search`     | `KC-SEARCH-DB-HIT`, `KC-SEARCH-DB-MISS`, `KC-DISCOVERY-RECORDED`                                                                                                          |
| `knowledge-cache-attest`     | `UC7KS-ATTEST-PASS`, `UC7KS-ATTEST-INSUFFICIENT`, `UC7KS-ATTEST-FAIL-*`, `KC-ATTESTATION-RECORDED`                                                                        |
| `script-knowledge-indexer`   | `KC-INDEXER-READ`, `KC-INDEXER-WRITE`, `KC-INDEXER-BACKFILL`, `KC-INDEXER-FAILED`                                                                                         |
| `script-knowledge-janitor`   | `KC-JANITOR-START`, `KC-JANITOR-ARCHIVE`, `KC-JANITOR-PURGE`, `KC-JANITOR-MATERIALIZE`, `KC-JANITOR-COMPLETE`                                                             |
| `script-framework-self-test` | `KC-DB-CONSISTENCY-CHECK`, `KC-MATERIALIZED-VIEW-CHECK`, `KC-READER-WRITER-CHECK`                                                                                         |

Fields should include `event`, `detail`, `agent` or `agentType` when available, `sessionID`, `callID`, `taskId`, `domainId`, `entryId`, `filePath`, `dbVersion`, and `materializationStatus` when applicable.

---

## 4. `knowledge_cache_state` Size Optimization

### 4.1 Current Size Analysis

`knowledge_cache_state` is the largest blob in `substate_kv`:

| Metric                | Current value |
| --------------------- | ------------- |
| Blob size             | 907,067 bytes |
| Agents                | 10            |
| Nested task entries   | 445           |
| Nested domain entries | 494           |
| Attested domains      | 28            |

Primary growth driver: `session_access[agent].tasks[task_id].domains[domain_id]`.

Existing cleanup:

| Mechanism                                               | Current limitation                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `evictOldAgents()`                                      | Caps only number of agent keys, not tasks/domains                                                     |
| `nightly-compaction.ts cleanupStaleSessionAccessStep()` | Removes whole stale/invalid agent entries only                                                        |
| `knowledge_cache_search.ts` inline LRU block            | Attempts property-level pruning inside an agent entry; does not correctly target nested tasks/domains |

### 4.2 Recommended Design

Add a shared nested pruning helper, then call it from write paths and nightly maintenance.

Suggested helper:

```typescript
pruneSessionAccess(state.session_access, {
  ttlDays: config["knowledge.session_access_ttl_days"] ?? 30,
  maxTasksPerAgent:
    config["knowledge.session_access_max_tasks_per_agent"] ?? 50,
  maxDomainsPerTask:
    config["knowledge.session_access_max_domains_per_task"] ?? 8,
  preserveAttestedDays:
    config["knowledge.session_access_preserve_attested_days"] ?? 90,
});
```

Rules:

1. Prefer `attested_at`, `discovered_at`, `declared_at`, then agent `last_read_at` as the timestamp source.
2. Preserve recently `attested` entries longer than discovery-only entries.
3. Remove discovery-only stale entries first.
4. Never remove the domain entry currently being written in the same transaction.
5. Write summary metrics to `knowledge_audit_state.aggregate.last_cleanup_removed_session_entries`.
6. Log cleanup result through `writeLog("knowledge-cache-prune", "INFO", ...)`.

### 4.3 Action Items

| Step | Action                                                                 | File(s)                                                 | Priority |
| ---- | ---------------------------------------------------------------------- | ------------------------------------------------------- | -------- |
| 1    | Add config keys for nested session pruning                             | `.opencode/project.config.json`, schema/docs if present | P0       |
| 2    | Add `pruneSessionAccess()` helper                                      | `.opencode/lib/uc7ks-schema.ts`                         | P0       |
| 3    | Replace the current inline per-agent LRU block with the helper         | `.opencode/tools/knowledge_cache_search.ts`             | P0       |
| 4    | Call helper after successful attestation writes                        | `.opencode/tools/knowledge_cache_attest.ts`             | P1       |
| 5    | Use helper from nightly compaction instead of whole-agent-only cleanup | `.opencode/scripts/nightly-compaction.ts`               | P1       |
| 6    | Record cleanup metrics in `knowledge_audit_state`                      | `.opencode/lib/knowledge-audit.ts`, callers             | P1       |
| 7    | Add self-test for max task/domain bounds and preserved current entry   | `.opencode/scripts/framework-self-test.ts` or unit test | P1       |

---

## 5. Reverse Orphan Detection

### 5.1 Current State

The earlier plan said reverse orphan detection did not exist. That is no longer correct.

`framework-self-test.ts` Check 22c already walks `docs/official_docs/` and fails if files are not represented in `index.json`, excluding known metadata paths and non-doc files.

### 5.2 Updated Plan

Do not add a duplicate Check 22b. Instead:

| Step | Action                                                              | File(s)                                                                                      | Priority |
| ---- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| 1    | Extract Check 22c logic into a reusable helper                      | `.opencode/scripts/knowledge/integrity-check.ts` or `.opencode/scripts/knowledge/indexer.ts` | P1       |
| 2    | Make `framework-self-test.ts` call the shared helper                | `.opencode/scripts/framework-self-test.ts`                                                   | P1       |
| 3    | Make `janitor.ts` call the shared helper in advisory/report mode    | `.opencode/scripts/knowledge/janitor.ts`                                                     | P2       |
| 4    | Log orphan count and sample paths through `writeLog`                | helper + callers                                                                             | P1       |
| 5    | Optional auto-index orphaned files only with explicit operator flag | `indexer.ts` / `janitor.ts`                                                                  | P3       |

Enforcement policy:

| Mode     | Behavior                                               |
| -------- | ------------------------------------------------------ |
| Advisory | Log warning; no deletion                               |
| Strict   | Fail self-test / CI check; no auto-delete              |
| Locked   | Block writes to `docs/official_docs/**` until resolved |

---

## 6. `knowledge_semantic_map` Maintenance

### 6.1 Current State

`knowledge_semantic_map` in `.opencode/project.config.json` remains the authoritative domain map. It currently defines 12 domains and is used by custom tools, dispatch/domain resolution, and self-test Check 30.

This map should not be fully replaced by `index.json`, because `project.config.json` also carries fallback URLs, Context7 library hints, and dispatch-domain semantics that are not derivable from a cache manifest.

### 6.2 Updated Recommendation

Use `index.json` as a validation signal, not as the authority.

| Step | Action                                                                                  | File(s)                                       | Priority |
| ---- | --------------------------------------------------------------------------------------- | --------------------------------------------- | -------- |
| 1    | Add validation that every indexed domain/tag maps to a configured domain or known alias | `framework-self-test.ts` Check 30 enhancement | P2       |
| 2    | Add a report listing manifest tags/domains not covered by `knowledge_semantic_map`      | `knowledge_gap_report.ts`                     | P2       |
| 3    | Suggest config patches, but do not auto-edit `project.config.json`                      | `knowledge_gap_report.ts` / docs              | P3       |

---

## 7. Logging Integration Requirements

All implementation steps must follow the framework logging system:

| Code type    | Required logging pattern                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| Plugins      | `export default withPluginLifecycle(name, hooks)` and `writeLog(name, "runtime", fields)`         |
| Custom tools | `writeLog("tool-or-domain-name", "INFO"                                                           | "WARN" | "ERROR", fields)`                                         |
| CLI scripts  | User-facing `console.log` is acceptable, but every audit-relevant event must also call `writeLog` |
| Libraries    | `writeLog("lib-name", "INFO"                                                                      | "WARN" | "ERROR", fields)` for failures and operational milestones |

Required fields where available:

| Field                  | Use                                                       |
| ---------------------- | --------------------------------------------------------- |
| `event`                | Stable machine-readable event name                        |
| `detail`               | Human-readable summary                                    |
| `sessionID` / `callID` | Tool/plugin correlation                                   |
| `agent` / `agentType`  | Actor identity                                            |
| `taskId` / `domainId`  | UC7KS correlation                                         |
| `level`                | Use when category is `"runtime"` and severity is not INFO |

Specific events to add or keep:

| Event                                             | Source                                     |
| ------------------------------------------------- | ------------------------------------------ |
| `KC-AUDIT-ROLLUP-WRITTEN`                         | `knowledge-audit` helper                   |
| `KC-SESSION-ACCESS-PRUNED`                        | nested pruning helper / nightly compaction |
| `KC-REVERSE-ORPHAN-CHECK`                         | integrity helper                           |
| `UC7KS-ATTEST-PASS` / `UC7KS-ATTEST-INSUFFICIENT` | `knowledge_cache_attest.ts`                |
| `READ_TRACKED`                                    | `read-track-after.ts`                      |

---

## 8. Implementation Priority Summary

| Priority | ID    | GitHub Issue                                                    | Description                                                                                                                            | Effort | Risk        |
| -------- | ----- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------- |
| P0       | KC-00 | [#29](https://github.com/Cho-Geer/opencode_framework/issues/29) | Repair executable defects in `indexer.ts` and `janitor.ts`; keep file-manifest behavior stable                                         | S/M    | Medium      |
| P0       | KC-01 | [#30](https://github.com/Cho-Geer/opencode_framework/issues/30) | Add `knowledge-store.ts` API as a file-backed compatibility layer first                                                                | M      | Medium      |
| P0       | KC-02 | [#31](https://github.com/Cho-Geer/opencode_framework/issues/31) | Retain and activate `knowledge_audit_state` as DB-managed audit rollup                                                                 | M      | Low         |
| P0       | KC-03 | [#32](https://github.com/Cho-Geer/opencode_framework/issues/32) | Add nested task/domain pruning helper and fix current inline LRU target                                                                | M      | Medium      |
| P0       | KC-04 | [#33](https://github.com/Cho-Geer/opencode_framework/issues/33) | Correct OpenCode terminology: custom tools vs MCP tools; do not add MCP unless needed                                                  | S      | Low         |
| P1       | KC-05 | [#34](https://github.com/Cho-Geer/opencode_framework/issues/34) | Add v11 typed knowledge tables + indexes + backfill from `index.json` and existing files                                               | L      | Medium/High |
| P1       | KC-06 | [#35](https://github.com/Cho-Geer/opencode_framework/issues/35) | Move `knowledge_cache_search.ts` to `knowledge-store.searchEntries()` with file fallback                                               | M      | Medium      |
| P1       | KC-07 | [#36](https://github.com/Cho-Geer/opencode_framework/issues/36) | Move `knowledge_cache_attest.ts` to typed attestation writes while preserving `read_audit` verification                                | M      | Medium      |
| P1       | KC-08 | [#37](https://github.com/Cho-Geer/opencode_framework/issues/37) | Wire audit rollup updates from custom tools/plugins with non-fatal error handling                                                      | M      | Low         |
| P1       | KC-09 | [#38](https://github.com/Cho-Geer/opencode_framework/issues/38) | Extract reverse orphan detection helper and add DB↔file materialized consistency checks                                                | M      | Medium      |
| P1       | KC-10 | [#39](https://github.com/Cho-Geer/opencode_framework/issues/39) | Add nested pruning and DB-canonical self-test / unit coverage                                                                          | M      | Medium      |
| P2       | KC-11 | [#40](https://github.com/Cho-Geer/opencode_framework/issues/40) | Move janitor/indexer/size-reporter to DB canonical maintenance through `knowledge-store.ts`                                            | L      | Medium      |
| P2       | KC-12 | [#41](https://github.com/Cho-Geer/opencode_framework/issues/41) | Normalize `knowledge_session_access`, `knowledge_discovery`, and `knowledge_attestation`; keep bounded `knowledge_cache_state` summary | L      | Medium/High |
| P2       | KC-13 | [#42](https://github.com/Cho-Geer/opencode_framework/issues/42) | Enhance `knowledge_semantic_map` coverage validation from DB-backed manifest/tags                                                      | S/M    | Low         |
| P3       | KC-14 | [#43](https://github.com/Cho-Geer/opencode_framework/issues/43) | Optional archive/retention tables for old `session_access` entries if compliance requires retention                                    | M/L    | Medium      |
| P3       | KC-15 | [#44](https://github.com/Cho-Geer/opencode_framework/issues/44) | Optional operator-assisted auto-index orphaned docs behind explicit flag                                                               | M      | Medium      |

Recommended rollout:

1. **P0 pass**: repair broken knowledge scripts, introduce `knowledge-store.ts` over the current file manifest, keep `knowledge_audit_state`, add nested pruning, and lock in logging/OpenCode terminology.
2. **P1 pass**: add v11 typed tables, backfill, materialize generated files, move search/attestation through `knowledge-store.ts`, and add DB↔file self-tests.
3. **P2 pass**: move maintenance scripts and normalized session/discovery/attestation state to DB canonical operations while keeping bounded `substate_kv` summaries.
4. **P3 pass**: retention/archive tables and operator-assisted auto-indexing only if needed.

---

## 9. Verification Checklist

After implementation:

- [ ] `framework-self-test.ts` passes with the current check count.
- [ ] `indexer.ts` and `janitor.ts` run in dry-run/stats mode without `ReferenceError`.
- [ ] `knowledge-store.ts` is the only normal knowledge manifest/search/materialization API used by KC tools/scripts.
- [ ] v11 knowledge tables and indexes exist when DB-canonical mode is enabled.
- [ ] Backfill from `docs/official_docs/index.json` is idempotent and preserves manifest semantics.
- [ ] `docs/official_docs/index.json` is generated from DB and matches DB counts/hashes.
- [ ] `docs/official_docs/**/*.md` files needed by indexed active entries exist as materialized files.
- [ ] `knowledge_audit_state` remains present in `substate_kv`.
- [ ] `KnowledgeAuditState` type and `knowledge-audit-state.schema.json` agree.
- [ ] `knowledge_cache_state` size decreases or stops unbounded nested task/domain growth.
- [ ] `knowledge_cache_attest` still verifies against `read_audit` DB/API.
- [ ] `scope-before.ts` and `uc7ks-utils.ts` still use `knowledge_cache_state` + `read_audit` for blocking decisions.
- [ ] Typed `knowledge_attestation` and compatibility `knowledge_cache_state` summaries agree during migration.
- [ ] Reverse orphan detection still reports zero or documented orphans.
- [ ] New plugins/tools/scripts write audit-relevant events through `writeLog`.
- [ ] No new raw JSONL state file is introduced.
- [ ] No new MCP server is introduced for functionality that belongs in `.opencode/tools/`.
- [ ] `.opencode/tools/*.ts` custom tools still use `tool()` from `@opencode-ai/plugin`.
- [ ] Plugins modified for KC still export through `withPluginLifecycle()`.

---

## Appendix A: Planned Files Modified

| File                                                        | Change                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `.opencode/lib/db-manager.ts`                               | Add v11 typed knowledge tables, indexes, and idempotent migration/backfill hooks                                                    |
| `.opencode/lib/knowledge-store.ts`                          | New DB-canonical knowledge API for manifest/search/upsert/discovery/attestation/materialization/stats                               |
| `.opencode/state/schemas/knowledge-audit-state.schema.json` | Keep; update schema to bounded aggregate rollup shape                                                                               |
| `.opencode/lib/substate-types.ts`                           | Keep `KnowledgeAuditState`; align type with schema                                                                                  |
| `.opencode/lib/knowledge-audit.ts`                          | Add helper for non-fatal DB audit rollup writes                                                                                     |
| `.opencode/lib/uc7ks-schema.ts`                             | Add nested `pruneSessionAccess()` helper                                                                                            |
| `.opencode/lib/uc7ks-utils.ts`                              | Read DB-canonical evidence through `knowledge-store.ts` when enabled; keep transitional `knowledge_cache_state` fallback            |
| `.opencode/tools/knowledge_cache_search.ts`                 | Use `knowledge-store.searchEntries()`; replace inline LRU with shared nested helper; use ESM import for `readSubState`              |
| `.opencode/tools/knowledge_cache_attest.ts`                 | Preserve `read_audit` verification; write typed attestation plus compatibility summary; add audit rollup and optional pruning       |
| `.opencode/tools/module_scope_declare.ts`                   | Add audit rollup for declarations and optional typed session-access row                                                             |
| `.opencode/tools/knowledge_gap_report.ts`                   | Use DB-backed manifest/tags for semantic-map coverage reports                                                                       |
| `.opencode/tools/config_read_attest.ts`                     | Remove unused `writeSubState` import when touched                                                                                   |
| `.opencode/plugins/cache-after.ts`                          | Add cache-check rollup                                                                                                              |
| `.opencode/plugins/uc7ks-after.ts`                          | Add read-metadata rollup only                                                                                                       |
| `.opencode/plugins/dispatch-before.ts`                      | Add KC dispatch rollup                                                                                                              |
| `.opencode/scripts/knowledge/indexer.ts`                    | Fix executable imports; route read/write/search/stats/backfill through `knowledge-store.ts`                                         |
| `.opencode/scripts/knowledge/integrity-check.ts`            | Reusable reverse orphan and DB↔file materialized consistency checks                                                                 |
| `.opencode/scripts/knowledge/janitor.ts`                    | Fix `readManifest`/`writeManifest` imports; use DB canonical metadata; pair audit events with `writeLog`                            |
| `.opencode/scripts/knowledge/size-reporter.ts`              | Read stats through `knowledge-store.ts`                                                                                             |
| `.opencode/scripts/knowledge/archiver.ts` / `compressor.ts` | Treat file operations as materialization/maintenance side effects and log DB status                                                 |
| `.opencode/scripts/nightly-compaction.ts`                   | Use nested pruning helper                                                                                                           |
| `.opencode/project.config.json`                             | Add `knowledge.session_access_*` pruning keys                                                                                       |
| `.opencode/scripts/framework-self-test.ts`                  | Add/update checks for audit rollup, nested pruning, v11 tables, table reader/writer ownership, and DB↔file materialized consistency |
| `docs/official_docs/index.json`                             | Becomes generated compatibility manifest after DB-canonical rollout                                                                 |

---

## Appendix B: References

- `docs/official_docs/opencode/framework/custom-tools.md`
- `docs/official_docs/opencode/framework/tools.md`
- `docs/official_docs/opencode/framework/plugins.md`
- `docs/official_docs/opencode/framework/mcp-servers.md`
- `docs/official_docs/opencode/framework/permissions.md`
- `docs/official_docs/opencode/plugins/plugin-hook-reference.md`
- `.task_temp/REVIEW-DB-CANONICAL-PROPOSAL/review-report.md`
- `.opencode/lib/substate-manager.ts`
- `.opencode/lib/db-state-manager.ts`
- `.opencode/lib/db-manager.ts`
- `.opencode/lib/log-manager.ts`
- `.opencode/lib/hook-lifecycle.ts`
- `.opencode/lib/read-audit.ts`
- `.opencode/lib/uc7ks-schema.ts`
- `.opencode/lib/uc7ks-utils.ts`
- `.opencode/scripts/framework-self-test.ts`
- `.opencode/scripts/nightly-compaction.ts`
