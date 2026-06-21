# UC7KS Knowledge Acquisition Pipeline Standard v1.0

**Version**: v1.0.0  
**Created**: 2026-06-06  
**Author**: @Super-Admin (GAP-M3 remediation)  
**Status**: active  
**Applies To**: All 10 agents (@Meta-Planner, @Orchestrator, @Architect, @Coder-BE, @Coder-FE, @Guardian, @Arbiter, @CI-CD-Agent, @Knowledge-Curator, @Super-Admin)  
**Enforcement**: Physically enforced by `uc7ks-enforcer.ts`, `framework-enforcer.ts`, `tool-execute.ts`, `pre-execution-hook.sh`, and `framework-self-test.ts` (Checks 17, 22, 28, 29, 30, 31, 32)

---

## §1 Overview

### §1.1 Purpose

The UC7KS (Unified Context7 Knowledge System) Pipeline is the **mandatory knowledge acquisition protocol** for the OpenCode multi-agent framework. It ensures that:

1. **All agents use local-first knowledge**: No external queries (webfetch, websearch, Context7) are made without first checking and exhausting the local knowledge cache (`docs/official_docs/`).
2. **Knowledge is curated and versioned**: All external documentation is fetched, cached, and indexed by a dedicated @Knowledge-Curator agent, not by individual agents directly.
3. **No agent bypasses the pipeline**: Including @Super-Admin, who is subject to the same UC7KS pipeline (with a health-state emergency bypass for deadlock prevention).

### §1.2 Design Principles

| Principle                | Description                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Local-First**          | Always check `docs/official_docs/index.json` before making any external query                                                   |
| **Curated Knowledge**    | @Knowledge-Curator is the sole agent authorized to fetch, cache, and index external documentation                               |
| **Physical Enforcement** | UC7KS rules are enforced at the plugin/TS level, not advisory — violations produce thrown errors in strict/locked mode          |
| **Audit Trail**          | All UC7KS violations and compliance events are logged to the audit system                                                       |
| **Emergency Safety**     | @Super-Admin has a conditional health-state bypass when the knowledge cache is corrupted/unavailable (prevents repair deadlock) |
| **Size Governance**      | Knowledge cache files are capped at 500KB each and 50MB total                                                                   |

### §1.3 UC7KS Rule Index

| Rule ID     | Name                               | Enforcement Layer                | Category            |
| ----------- | ---------------------------------- | -------------------------------- | ------------------- |
| **UC7-001** | Local-First Cache Search           | Write-time + Read-time           | Pipeline Entry      |
| **UC7-002** | Cache Insufficiency Declaration    | Pre-execution + User Interaction | Pipeline Flow       |
| **UC7-003** | Post-Write Save-or-Fail            | Write-after hook                 | Data Integrity      |
| **UC7-004** | Direct Context7 Block              | Tool intercept (pre-execute)     | Access Control      |
| **UC7-005** | Knowledge Cache Size Limits        | Write-time (pre-write)           | Resource Governance |
| **UC7-006** | _(Reserved)_                       | —                                | Future              |
| **UC7-007** | Atomic index.json Update           | Write-after hook                 | Data Integrity      |
| **UC7-008** | @Knowledge-Curator Scope Isolation | Write-time (pre-write)           | Access Control      |
| **UC7-009** | Super-Admin UC7KS Compliance       | Write-time + Pre-execution Gate  | Access Control      |

---

## §2 Pipeline Architecture

### §2.1 Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                     UC7KS KNOWLEDGE ACQUISITION PIPELINE              │
│                                                                       │
│  Agent needs external knowledge                                       │
│         │                                                             │
│         ▼                                                             │
│  ┌─────────────────┐                                                  │
│  │ UC7-001: LOCAL  │ ◄── Step 0b (subagent-preamble.md)              │
│  │ CACHE SEARCH    │     Read docs/official_docs/index.json            │
│  │ (MANDATORY)     │     tool-execute.ts enforces BEFORE writes       │
│  └───────┬─────────┘                                                  │
│          │                                                            │
│     ┌────┴────┐                                                       │
│     │ Cache   │                                                       │
│     │ Hit?    │                                                       │
│     └────┬────┘                                                       │
│      YES │ NO                                                        │
│          │                                                            │
│     ┌────▼────┐  ┌──────────────────┐                                │
│     │ Proceed │  │ UC7-002: DECLARE │ ◄── Step 0c (subagent-preamble)│
│     │ with    │  │ INSUFFICIENCY    │     Declare what is missing     │
│     │ task    │  └───────┬──────────┘     Request @Knowledge-Curator │
│     └─────────┘          │                                            │
│                          ▼                                            │
│               ┌──────────────────┐                                   │
│               │ @Orchestrator    │                                   │
│               │ dispatches       │                                   │
│               │ @Knowledge-Curator│                                  │
│               └───────┬──────────┘                                   │
│                       │                                               │
│                       ▼                                               │
│               ┌──────────────────┐                                   │
│               │ @Knowledge-Curator│  ┌──────────────────────────┐    │
│               │ fetches docs     │──┤ UC7-005: Size cap (500KB) │    │
│               │ (Context7/web)   │  │ UC7-003: Save files       │    │
│               └───────┬──────────┘  │ UC7-007: Atomic index     │    │
│                       │              │ UC7-008: Scope isolation  │    │
│                       ▼              └──────────────────────────┘    │
│               ┌──────────────────┐                                   │
│               │ Agent re-reads   │                                   │
│               │ updated cache    │                                   │
│               │ → Proceed        │                                   │
│               └──────────────────┘                                   │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ ENFORCEMENT LAYERS (physically enforced):                    │    │
│  │  • UC7-004: Block direct external queries (framework-enforcer)│    │
│  │    (Context7, webfetch, websearch, GitHub, Playwright)       │    │
│  │  • UC7-009: All agents incl. Super-Admin (enforce.ts)        │    │
│  │  • UC7-001: Write block without cache read (tool-execute.ts) │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

### §2.2 Enforcement Points

| Layer              | File                     | Hooks                                       | UC7 Rules Enforced                                                                                                        |
| ------------------ | ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Write-Time**     | `tool-execute.ts`        | `tool.execute.before`                       | UC7-001 (cache check), UC7-005 (size cap), UC7-008 (KC scope), UC7-009 (Super-Admin)                                      |
| **Plugin Hook**    | `uc7ks-enforcer.ts`      | `tool.execute.before`, `tool.execute.after` | UC7-001, UC7-002, UC7-003, UC7-004, UC7-009                                                                               |
| **Framework Core** | `framework-enforcer.ts`  | `processToolCall()`                         | UC7-001 (read tracking), UC7-004 (Context7 block), UC7-005 (size cap), UC7-008 (KC scope), UC7-009 (external query block) |
| **Pre-Execution**  | `pre-execution-hook.sh`  | Stage 4 (UC7KS Gate)                        | UC7-001 (cache exists), UC7-009 (Super-Admin conditional)                                                                 |
| **Pre-Commit**     | `pre-commit` hook        | Layer 2.6 (UC7KS Docs Consistency)          | UC7-003 (index.json validity), UC7-007 (orphan doc detection)                                                             |
| **Self-Test**      | `framework-self-test.ts` | Checks 22, 28, 29, 30, 31, 32               | UC7-002 (agent sections), UC7-004 (tool block verification), cache integrity                                              |

---

## §3 UC7 Rule Definitions

### §3.1 UC7-001: Local-First Cache Search

**Classification**: Pipeline Entry — P0 HARD CONSTRAINT  
**Applies To**: ALL agents (including @Super-Admin per UC7-009)

**Rule**: Before making any external documentation query (webfetch, websearch, context7\_\*), every agent MUST:

1. Search `docs/official_docs/index.json` for relevant cached documentation
2. If found, read cached docs via the `read` tool
3. **Only if** cache is insufficient → proceed to UC7-002

**Enforcement**:

- **Write-time** (`tool-execute.ts`): Proactively blocks `write`, `edit`, and `bash` operations if the agent has NOT read the knowledge cache (machine.json.knowledge_cache_state not updated). Error: `[FW-ENFORCE][UC7-001][PROACTIVE]`
- **Read-time** (`framework-enforcer.ts`): Auto-detects and records cache access when any agent reads `docs/official_docs/index.json` or files under `docs/official_docs/`
- **Pre-execution** (`pre-execution-hook.sh` Stage 4): Blocks task execution if knowledge cache is missing and the agent is not @Super-Admin in emergency mode

**Modes**:
| Mode | Behavior |
|------|----------|
| Advisory | Warning only — non-blocking |
| Strict | BLOCKED — knowledge cache search required |
| Locked | BLOCKED — same as strict |

**Source Files**:

- `subagent-preamble.md` Step 0b (L34–41)
- `tool-execute.ts` L177–261 (T-H05 migration)
- `framework-enforcer.ts` L1042–1088 (read detection)
- `Knowledge-Curator.md` Step 1 (L66–81)

---

### §3.2 UC7-002: Cache Insufficiency Declaration

**Classification**: Pipeline Flow — P0 HARD CONSTRAINT  
**Applies To**: ALL agents

**Rule**: When the local knowledge cache is insufficient for the task:

1. **Declare insufficiency**: Specifically state what is missing (e.g., "Missing: NestJS Guard implementation pattern v11")
2. **Route through @Knowledge-Curator**: Request @Orchestrator to dispatch @Knowledge-Curator for the missing documentation
3. **Wait for caching**: Do NOT proceed with the task using training data alone
4. **Re-read cache**: After @Knowledge-Curator completes, re-read the newly cached documents

**Enforcement**:

- **Pre-execution** (`uc7ks-enforcer.ts`): Intercepts external query tools (webfetch, websearch, context7\_\*) and verifies cache was checked first
- **Self-test** (`framework-self-test.ts` Check 31): Verifies all non-exempt agent configs contain the UC7KS Knowledge Acquisition section

**Modes**:
| Mode | Behavior |
|------|----------|
| Advisory | Warning only |
| Strict | BLOCKED — must declare insufficiency and route through @Knowledge-Curator |
| Locked | BLOCKED — same as strict |

**Source Files**:

- `subagent-preamble.md` Step 0c (L43–50)
- `uc7ks-enforcer.ts` L224–246 (before-hook enforcement)
- `Knowledge-Curator.md` Step 3 (L83)

---

### §3.3 UC7-003: Post-Write Save-or-Fail

**Classification**: Data Integrity — P1 CONSTRAINT  
**Applies To**: @Knowledge-Curator (primary)

**Rule**: After @Knowledge-Curator writes documentation files to `docs/official_docs/`:

1. **Verify the write**: Confirm the file was saved correctly and is readable
2. **Update index.json**: Register the file in `docs/official_docs/index.json` with metadata (sha256, size, source, TTL)
3. **On failure**: If the write or index update fails, report the error and do NOT mark the task as complete

**Enforcement**:

- **Write-after hook** (`uc7ks-enforcer.ts`): Monitors post-write state and verifies index consistency
- **Self-test** (`framework-self-test.ts` Check 22): Verifies index.json entries match actual files on disk (no orphan entries)

**Source Files**:

- `uc7ks-enforcer.ts` L8 (UC7-003 header)
- `Knowledge-Curator.md` Step 7 (L125–132)

---

### §3.4 UC7-004: Direct External Query Block (Context7, webfetch, websearch, GitHub, Playwright)

**Classification**: Access Control — P0 HARD CONSTRAINT  
**Applies To**: ALL agents **except** @Knowledge-Curator

**Rule**: Non-Knowledge-Curator agents MUST NOT call external query tools directly. This includes:

- `context7_resolve-library-id`
- `context7_query-docs`
- `context7` (generic)
- `webfetch`
- `websearch`
- `github_get_file_contents`
- `github_search_code`
- `github_search_repositories`
- `github_search_issues`
- `playwright_browser_navigate`

All external queries MUST route through `@Orchestrator → @Knowledge-Curator`.

**Enforcement**:

- **Tool intercept** (`framework-enforcer.ts` L999–1008): Physically blocks external query tool calls for non-@Knowledge-Curator agents via `checkUC7KS()`. Error: `[FW-ENFORCE][UC7-004]`
- **Plugin hook** (`enforce.ts` — merged from archived `uc7ks-enforcer.ts`): Part of the `tool.execute.before` interception in `framework-enforcer`
- **Self-test** (`framework-self-test.ts` Check 32): Verifies no agent config YAML frontmatter (except Knowledge-Curator) declares `context7_*`, `webfetch`, or `websearch` in the tool list (note: `mcp_tools` is the YAML frontmatter field name, but it may contain both MCP tools and OpenCode custom tools)
- **Hard constraint**: All non-KC agent YAML frontmatter have `webfetch`/`websearch`/`Github` removed from their tool declarations. opencode.json permissions deny these tools for non-KC agents. @Knowledge-Curator is the sole agent with external query capabilities.

**Modes**:
| Mode | Behavior |
|------|----------|
| Advisory | Warning only |
| Strict | BLOCKED |
| Locked | BLOCKED |

**Source Files**:

- All 10 agent configs (context7 excluded from tool declarations)
- `framework-enforcer.ts` L960–969
- `uc7ks-enforcer.ts` L8, L215

---

### §3.5 UC7-005: Knowledge Cache Size Limits

**Classification**: Resource Governance — P1 CONSTRAINT  
**Applies To**: @Knowledge-Curator (write enforcement), all agents (read guidance)

**Rule**: Knowledge cache files are subject to the following limits:

| Limit                | Value                    | Enforced At                                                                 |
| -------------------- | ------------------------ | --------------------------------------------------------------------------- |
| Max single file size | 500 KB (524,288 bytes)   | Write-time (`tool-execute.ts` L298–330, `framework-enforcer.ts` L1093–1106) |
| Max total cache size | 50 MB (52,428,800 bytes) | _Future: total-size scan_                                                   |

Files exceeding the size limit must be split into smaller chunks or compressed.

**Enforcement**:

- **Write-time** (`tool-execute.ts`): Pre-write check on `docs/official_docs/**` paths. Error: `[FW-ENFORCE][UC7-005]`
- **Framework core** (`framework-enforcer.ts`): Same pre-write check for all write operations to knowledge paths
- **Self-test** (`framework-self-test.ts` Check 22): Reports cache size statistics

**Modes**:
| Mode | Behavior |
|------|----------|
| Advisory | Warning only |
| Strict | BLOCKED |
| Locked | BLOCKED |

**Source Files**:

- `tool-execute.ts` L298–330
- `framework-enforcer.ts` L1093–1106
- `Knowledge-Curator.md` L132, L171–184

---

### §3.6 UC7-006: _(Reserved)_

**Status**: Reserved for future use. Not currently defined in any enforcement point.

---

### §3.7 UC7-007: Atomic index.json Update

**Classification**: Data Integrity — P1 CONSTRAINT  
**Applies To**: @Knowledge-Curator

**Rule**: Every modification to `docs/official_docs/index.json` MUST be atomic:

1. Write to a temporary file first (e.g., `index.json.tmp`)
2. Verify the temporary file is valid JSON
3. Atomically rename the temporary file to `index.json` (OS-level atomic operation)
4. On failure: rollback — delete the temporary file, keep the original index.json intact

This prevents corruption from concurrent writes or partial write failures.

**Enforcement**:

- **Write-after hook** (`uc7ks-enforcer.ts`): Verifies index.json consistency after every write to the knowledge cache directory

**Source Files**:

- `uc7ks-enforcer.ts` L8 (UC7-003 reference, UC7-007 in Knowledge-Curator.md)
- `Knowledge-Curator.md` Step 7 (L125–132)

---

### §3.8 UC7-008: @Knowledge-Curator Scope Isolation

**Classification**: Access Control — P0 HARD CONSTRAINT  
**Applies To**: @Knowledge-Curator

**Rule**: @Knowledge-Curator is restricted to writing only within its knowledge management domain:

| Allowed Write Paths     | Denied Write Paths                                                      |
| ----------------------- | ----------------------------------------------------------------------- |
| `docs/official_docs/**` | `.opencode/agents/**`                                                   |
| `.metadata/**`          | `.opencode/rules/**`                                                    |
|                         | `.opencode/state/**`                                                    |
|                         | `.opencode/scripts/**`                                                  |
|                         | `.opencode/skills/**`                                                   |
|                         | Any business code (`booking-backend/src/**`, `booking-frontend/src/**`) |

**Enforcement**:

- **Write-time** (`tool-execute.ts` L264–291): Blocks @Knowledge-Curator write attempts to non-docs paths. Error: `[FW-ENFORCE][UC7-008]`
- **Framework core** (`framework-enforcer.ts` L972–988): Same check in the core enforcement pipeline

**Modes**:
| Mode | Behavior |
|------|----------|
| Advisory | Warning only |
| Strict | BLOCKED |
| Locked | BLOCKED |

**Source Files**:

- `tool-execute.ts` L264–291 (FW-HARDEN-UC7KS-005)
- `framework-enforcer.ts` L972–988

---

### §3.9 UC7-009: Super-Admin UC7KS Compliance

**Classification**: Access Control — P0 HARD CONSTRAINT  
**Applies To**: @Super-Admin

**Rule**: @Super-Admin MUST follow the same UC7KS pipeline as all other agents:

1. Framework repairs and governance modifications must be based on the latest official documentation, not training data
2. @Super-Admin must check the local knowledge cache before making framework changes (UC7-001)
3. @Super-Admin is NOT exempt from the Context7 block (UC7-004) — must route through @Knowledge-Curator

**Emergency Exception (Health-State Gate)**: When the knowledge cache is **unhealthy** (missing, corrupt, or empty `docs/official_docs/index.json`), @Super-Admin is allowed to bypass UC7-001 with full audit logging. This prevents a circular deadlock:

```
Super-Admin dispatched to repair corrupted knowledge cache
  → UC7-001: cache unhealthy → block write
  → Super-Admin cannot write → cannot fix cache
  → Cache stays unhealthy → 🪦 Deadlock
```

The health-state gate (`isKnowledgeCacheHealthy()`) resolves this:

- **Cache HEALTHY** → Super-Admin undergoes normal UC7-001 enforcement
- **Cache UNHEALTHY** → Emergency bypass with `uc7ks_super_admin_emergency_bypass` audit event

**Enforcement**:

- **Write-time** (`tool-execute.ts` L140–165, L202–262): Conditional UC7-001 enforcement with health-state gate
- **Pre-execution Gate** (`pre-execution-hook.sh` L270–302): Conditional Stage 4 bypass
- **External Query** (`framework-enforcer.ts` L992–1037): Super-Admin external queries blocked in locked/strict mode when local cache is available
- **Plugin Hook** (`uc7ks-enforcer.ts`): @Super-Admin is NOT in `UC7KS_BYPASS_AGENTS` — only @Knowledge-Curator has that privilege

**History**: UC7-009 was added as part of GAP-C1 remediation (2026-06-06). Previously, @Super-Admin had unconditional bypasses that violated the "local-first" principle. The health-state gate was designed to preserve emergency repair capability while enforcing UC7KS compliance in normal operation.

**Source Files**:

- `tool-execute.ts` L51–81 (`isKnowledgeCacheHealthy()`), L140–165 (UC7-009 flag), L202–262 (conditional bypass)
- `pre-execution-hook.sh` L270–302 (Stage 4 conditional)
- `framework-enforcer.ts` L992–1037 (external query block for all agents)
- `Super-Admin.md` L50–59 (UC7-009 ENFORCED section)

---

## §4 Agent Compliance Matrix

| Agent              |   UC7-001   |   UC7-002   | UC7-003 |  UC7-004   | UC7-005 | UC7-007 |    UC7-008    |  UC7-009  |
| ------------------ | :---------: | :---------: | :-----: | :--------: | :-----: | :-----: | :-----------: | :-------: |
| @Meta-Planner      |   ✅ Must   |   ✅ Must   |   N/A   | ✅ Blocked |   N/A   |   N/A   |      N/A      |    N/A    |
| @Orchestrator      |   ✅ Must   |  ✅ Routes  |   N/A   | ✅ Blocked |   N/A   |   N/A   |      N/A      |    N/A    |
| @Architect         |   ✅ Must   |   ✅ Must   |   N/A   | ✅ Blocked |   N/A   |   N/A   |      N/A      |    N/A    |
| @Coder-BE          |   ✅ Must   |   ✅ Must   |   N/A   | ✅ Blocked |   N/A   |   N/A   |      N/A      |    N/A    |
| @Coder-FE          |   ✅ Must   |   ✅ Must   |   N/A   | ✅ Blocked |   N/A   |   N/A   |      N/A      |    N/A    |
| @Guardian          |   ✅ Must   |   ✅ Must   |   N/A   | ✅ Blocked |   N/A   |   N/A   |      N/A      |    N/A    |
| @Arbiter           |   ✅ Must   |   ✅ Must   |   N/A   | ✅ Blocked |   N/A   |   N/A   |      N/A      |    N/A    |
| @CI-CD-Agent       |   ✅ Must   |   ✅ Must   |   N/A   | ✅ Blocked |   N/A   |   N/A   |      N/A      |    N/A    |
| @Knowledge-Curator | ✅ Executor | ✅ Executor | ✅ Must | ✅ Exempt  | ✅ Must | ✅ Must | ✅ Restricted |    N/A    |
| @Super-Admin       |  ✅ Must\*  |   ✅ Must   |   N/A   | ✅ Blocked |   N/A   |   N/A   |      N/A      | ✅ Must\* |

**Legend**:

- ✅ Must: Rule applies and must be followed
- ✅ Blocked: Tool calls are physically blocked
- ✅ Exempt: Explicitly exempt from this rule
- ✅ Executor: This agent implements/enforces this rule
- ✅ Restricted: Scope-limited (UC7-008)
- N/A: Rule does not apply to this agent
- \* UC7-009 conditional: Emergency bypass when cache unhealthy

---

## §5 Integration with Enforcement Modes

The UC7KS pipeline's behavior is modulated by the framework's [enforcement mode](./enforcement-modes-standard.md):

| UC7 Rule                        | Advisory                     | Strict                       | Locked                            |
| ------------------------------- | ---------------------------- | ---------------------------- | --------------------------------- |
| UC7-001 (Cache search)          | ⚠️ Warning                   | ❌ Blocked                   | ❌ Blocked                        |
| UC7-002 (Declare insufficiency) | ⚠️ Warning                   | ❌ Blocked                   | ❌ Blocked                        |
| UC7-003 (Save-or-fail)          | ⚠️ Warning                   | ❌ Blocked                   | ❌ Blocked                        |
| UC7-004 (Context7 block)        | ⚠️ Warning                   | ❌ Blocked                   | ❌ Blocked                        |
| UC7-005 (Size cap)              | ⚠️ Warning                   | ❌ Blocked                   | ❌ Blocked                        |
| UC7-007 (Atomic index)          | ⚠️ Warning                   | ❌ Blocked                   | ❌ Blocked                        |
| UC7-008 (KC scope)              | ⚠️ Warning                   | ❌ Blocked                   | ❌ Blocked                        |
| UC7-009 (Super-Admin)           | ⚠️ Warning (cache available) | ❌ Blocked (cache available) | ❌ Blocked (ALL external queries) |

---

## §6 Self-Test Coverage

The following `framework-self-test.ts` checks validate UC7KS compliance:

| Check # | Name                            | UC7 Rules                 | Description                                                                           |
| ------- | ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| 17      | Placeholder Resolution          | —                         | No `UNRESOLVED{...}` strings (indirectly validates docs references)                   |
| 22      | UC7KS Docs Manifest Integrity   | UC7-003, UC7-005, UC7-007 | Verifies index.json entries match actual files; reports orphans, size stats           |
| 28      | UC7KS Schema Integrity          | UC7-001                   | Validates machine.json.knowledge_cache_state schema                                   |
| 29      | Custom Tool Registration        | —                         | Verifies UC7KS pipeline tools are registered (knowledge_cache_search, etc.)           |
| 30      | Knowledge Semantic Map Coverage | UC7-002                   | Validates knowledge_semantic_map covers all declared domains                          |
| 31      | Agent UC7KS Section Presence    | UC7-002                   | Verifies all 9 non-exempt agent configs contain "UC7KS Knowledge Acquisition" section |
| 32      | Context7 Tool Block             | UC7-004                   | Verifies no agent config (except Knowledge-Curator) has context7\_\* in mcp_tools     |

---

## §7 Related Documents

| Document                        | Relationship                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `enforcement-modes-standard.md` | Defines advisory/strict/locked behavior for UC7KS rules                        |
| `TEMPLATE_VARIABLE_STANDARD.md` | Template variable system for knowledge cache path references (`{knowledge.*}`) |
| `subagent-preamble.md`          | Steps 0a–0c define the UC7-001/002 pipeline entry protocol                     |
| `framework-self-test.ts`        | Checks 22, 28–32 validate UC7KS compliance                                     |
| `tool-execute.ts`               | Write-time enforcement of UC7-001, UC7-005, UC7-008, UC7-009                   |
| `uc7ks-enforcer.ts`             | Plugin-level enforcement of UC7-001, UC7-002, UC7-003, UC7-004, UC7-009        |
| `framework-enforcer.ts`         | Core enforcement of UC7-001, UC7-004, UC7-005, UC7-008, UC7-009                |
| `pre-execution-hook.sh`         | Stage 4 UC7KS Gate                                                             |
| `Knowledge-Curator.md`          | Agent config for the sole UC7KS pipeline executor                              |
| `Super-Admin.md`                | UC7-009 enforcement for emergency repair agent                                 |
| `common-project.md`             | Core rules referencing UC7KS compliance                                        |
| `docs/official_docs/index.json` | Knowledge cache manifest                                                       |

---

## §8 Version History

| Date       | Version | Changes                                                                                                                                      | Author       |
| ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 2026-06-06 | 1.0.0   | Initial creation. Extracted UC7-001 through UC7-009 from 7+ scattered source files into a standalone standard document (GAP-M3 remediation). | @Super-Admin |
