# Universal Context7-First Knowledge System (UC7KS) — Design Analysis v1.6

**Date**: 2026-06-05  
**Author**: Super-Admin Agent  
**Status**: Design Document — Cross-Reference Remediated (v1.6.0)  
**Compliance Gate**: Analysis-only; no gate required for design documents  
**Version**: 1.6.0 (Cross-reference findings F1-F22 resolved — see changelog)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Design](#2-architecture-design)
3. [Hardened Enforcement Constraints](#3-hardened-enforcement-constraints)
4. [Harness System Integration](#4-harness-system-integration)
5. [Permission Matrix](#5-permission-matrix)
6. [Multi-Agent System Design](#6-multi-agent-system-design)
7. [Super-Admin Knowledge Support Integration](#7-super-admin-knowledge-support-integration)
8. [OpenCode Official Knowledge Integration](#8-opencode-official-knowledge-integration)
9. [Central State Management](#9-central-state-management)
10. [Templatization & Parameterization](#10-templatization--parameterization)
11. [Knowledge Management Subsystem](#11-knowledge-management-subsystem)  
    - [11.6 Source Analysis Layer — Scout Integration (Layer 3)](#116-source-analysis-layer--scout-integration-layer-3)
12. [Workflow Diagrams](#12-workflow-diagrams)
13. [Implementation Roadmap](#13-implementation-roadmap)

---

## 1. Executive Summary

**Problem**: The current `context7-first` skill is passive, stack-dependent, and requires manual library identification. It has no fallback mechanism, no local caching, and no knowledge lifecycle management. Additionally, `@Super-Admin` executes critical framework repairs and governance modifications without dedicated knowledge support, leading to potential errors, outdated assumptions, and costly rework.

**Solution**: Design a **Universal Context7-First Knowledge System (UC7KS)** that:
- Autonomously identifies search targets from task descriptions
- Requires user confirmation before external queries
- Falls back to `webfetch`/`websearch` when Context7 has no coverage
- Saves all findings locally to `docs/official_docs/`
- Provides a dedicated `@Knowledge-Curator` subagent
- Enforces "local-first" search for **all agents, including `@Super-Admin`**
- Implements intelligent knowledge management with size control
- **Empowers `@Super-Admin` with the same knowledge acquisition pipeline as all other agents, ensuring its critical framework decisions are informed by the latest documentation**

---

## 2. Architecture Design

### 2.1 High-Level Component Diagram

```
+-----------------------------------------------------------------------------+
|                            UNIVERSAL CONTEXT7 SYSTEM                         |
|                    (All Agents Share the Same Pipeline)                      |
+-----------------------------------------------------------------------------+
|                                                                             |
|  +-----------------+    +------------------+    +---------------------+     |
|  |  ANY AGENT      |--->| @Orchestrator    |--->|   docs/official_docs/|    |
|  |  (including     |    | (Dispatch Router)|    |   (Local Knowledge   |    |
|  |   @Super-Admin) |    |                  |    |        Cache)        |    |
|  +-----------------+    +------------------+    +---------------------+     |
|           |                      |                         ^                |
|           |                      |                         |                |
|           v                      v                         |                |
|  +---------------------------------------------------------+             |
|  |          TARGET IDENTIFICATION PIPELINE                   |             |
|  |  +-------------+  +--------------+  +--------+          |             |
|  |  |   NLP Task  |->| Semantic     |->| Stack  |          |             |
|  |  |  Extractor  |  |  Classifier  |  | Oracle |          |             |
|  |  +-------------+  +--------------+  +--------+          |             |
|  +---------------------------------------------------------+             |
|                      |                                                      |
|                      v                                                      |
|  +-------------------+-------------------+-------------------+             |
|  |              KNOWLEDGE CURATOR LAYER                        |             |
|  |  +----------------+ +----------------+ +--------------------+ |            |
|  |  |  Local Cache   | |  Context7 MCP  | |  Web Fallback     | |            |
|  |  |  (docs/        | |  (mcp_context7_*)| | (webfetch/        | |            |
|  |  |   official_)   | |                | |   websearch)      | |            |
|  |  +----------------+ +----------------+ +--------------------+ |            |
|  +--------------------------------------------------------------+             |
|                                                                             |
|  +--------------------------------------------------------------+             |
|  |              KNOWLEDGE MANAGEMENT SUBSYSTEM                    |             |
|  |  +-------------+ +--------------+ +-------------+ +----------+|             |
|  |  |  Indexer    | |  Deduplicator| |  Compressor | |  Janitor ||             |
|  |  |  (.json)    | |  (SHA-based) | | (.html->.md)| |  (TTL)   ||             |
|  |  +-------------+ +--------------+ +-------------+ +----------+|             |
|  +--------------------------------------------------------------+             |
|                                                                             |
+-----------------------------------------------------------------------------+
```

### 2.2 New Directory Structure

```
docs/
+-- review/
|   +-- knowledge-management/
|       +-- uc7ks-design-analysis-v1.2.md   (this document)
|
+-- official_docs/
    +-- index.json                 # Central manifest: lib_id -> file_path -> SHA -> timestamp
    +-- .metadata/                 # Internal tracking
    |   +-- query_log.json         # All queries for audit
    |   +-- last_janitor_run       # Timestamp
    |   +-- size_report.json       # Per-directory size tracking
    +-- backend/                   # Organized by domain
    |   +-- nestjs/
    |   |   +-- v11.x-guards.html
    |   |   +-- v11.x-transactions.html
    |   |   +-- source-analysis/   # Scout source-code findings (Layer 3)
    |   +-- prisma/
    |   |   +-- v7.x-relations.html
    |   |   +-- source-analysis/
    |   +-- express/               # Available for future stacks
    +-- frontend/
    |   +-- angular/
    |   |   +-- source-analysis/
    |   +-- react/                 # Available for future stacks
    +-- database/
    |   +-- postgresql/
    |   +-- redis/
    +-- devops/
    |   +-- docker/
    |   +-- github-actions/
    +-- opencode/                   # OpenCode official knowledge (https://opencode.ai/)
    |   +-- agents/                 # Agent configuration docs
    |   +-- skills/                 # Skill development docs
    |   +-- framework/              # Framework architecture & internals
    |   |   +-- source-analysis/   # OpenCode source-code analysis (Scout)
    |   +-- mcp/                    # MCP tool integration docs
    |   +-- deployment/             # Deployment and ops docs
    +-- framework/                 # Non-OpenCode framework tools (for Super-Admin)
    |   +-- eslint/
    |   |   +-- source-analysis/   # ESLint source-code analysis (Scout)
    |   +-- typescript/
    |   +-- git/
    |   +-- json-schema/
    |   +-- nodejs/
    |   +-- github-actions/        # CI/CD framework docs
    +-- fallback/                  # webfetch/websearch results
    |   +-- web-[SHA].html
    +-- scout-extracts/            # Extracted Scout findings (pre-save staging)
        +-- [domain]-[library]-[topic].md
```

---

## 3. Hardened Enforcement Constraints

### 3.1 P0 Enforcement Rules

| Rule ID | Constraint | Enforcement Mechanism | Violation Action |
|---------|-----------|----------------------|------------------|
| **UC7-001** | **Local-First Search Mandatory**: All agents (including `@Super-Admin`) MUST query `docs/official_docs/` before calling Context7 MCP | `framework-enforcer.ts` + pre-execution hook | Block execution if local cache not checked |
| **UC7-002** | **User Confirmation Required**: Identified Context7 libraries MUST be presented for user confirmation before external query | `question` tool integration | Abort query if not confirmed |
| **UC7-003** | **Save-or-Fail**: All Context7 and webfetch results MUST be saved to `docs/official_docs/` before task proceeds | `tool.execute.after` plugin hook + pre-commit hook validates staged docs are present | Block task progression if docs missing from staged changes |
| **UC7-004** | **No Direct Context7**: Agents MUST route through `@Knowledge-Curator`; direct Context7 MCP calls are prohibited | `agent_tools_blacklist` update (custom project field; maps to OpenCode's native `permission.deny` on the `task` key for Context7 tools) | Log and block |
| **UC7-005** | **Size Cap**: Individual `.html` files MUST NOT exceed 500KB; total `docs/official_docs/` MUST NOT exceed 50MB | `code-quality-gate` write-check | Reject writes exceeding limits |
| **UC7-006** | **TTL Enforcement**: Cached docs older than 30 days MUST be refreshed or archived | `machine.json` state tracking + `@CI-CD-Agent` cron | Flag stale docs in audit |
| **UC7-007** | **Index Sync**: `index.json` manifest MUST be atomically updated with every save | File-lock pattern in `@Knowledge-Curator` | Reject inconsistent state |
| **UC7-008** | **Scope Isolation**: `@Knowledge-Curator` MUST NOT write business code or modify agent configs | `agent_write_scopes` enforcement | Escalate to `@Guardian` |
| **UC7-009** | **Super-Admin Knowledge Equality**: `@Super-Admin` MUST follow the same UC7KS workflow as all other agents when executing tasks; it MUST NOT bypass `@Knowledge-Curator` or local cache checks | `framework-enforcer.ts` + pre-execution hook | Block execution; log violation |

### 3.2 Anti-Goals (What the System Must NOT Do)

- **Must NOT** automatically query Context7 without user confirmation (UC7-002)
- **Must NOT** allow agents to bypass local cache (UC7-001)
- **Must NOT** store raw business data or credentials in `docs/official_docs/`
- **Must NOT** modify `project.config.json` tech_stack without `@Architect` + `@Arbiter`
- **Must NOT** use Context7 for non-technical queries (e.g., "what is the project deadline?")
- **Must NOT** allow `@Knowledge-Curator` to be dispatched by anyone except `@Orchestrator`
- **Must NOT** allow `@Super-Admin` to bypass UC7KS for its own tasks (UC7-009)

---

## 4. Harness System Integration

> **Note**: The `framework-enforcer.ts` referenced throughout this section is a **project-specific OpenCode plugin** (`.opencode/plugins/framework-enforcer/`), not a built-in OpenCode component. It leverages OpenCode's plugin hook system (`tool.execute.before`, `tool.execute.after`, etc.) for enforcement. OpenCode's native plugin hooks could also be used directly for some UC7KS enforcement without the full framework-enforcer layer.

### 4.1 Integration with Existing Framework

| Harness Component | UC7KS Integration Point | Specification |
|-------------------|------------------------|---------------|
| **compliance_gate_check** | Add "Local Cache Check" validation | Verify `docs/official_docs/index.json` exists and is parseable |
| **compliance_gate_complete** | Add "Docs Saved" validation | Verify task artifacts include docs save evidence in `test_report.json` |
| **framework-enforcer.ts** | Add UC7-001 to UC7-009 rules | Runtime enforcement of local-first search for ALL agents |
| **pre-commit hook** | Layer 2.6: Docs Consistency Check | Validate `index.json` integrity and size limits |
| **pre-execution-hook.sh** | Add "Knowledge Gate" | Verify `@Knowledge-Curator` dispatch token for Context7 queries |
| **code-quality-gate** | Add write-check for `docs/official_docs/` | Size validation, path validation, index sync check |
| **framework-self-test.js** | Check 19: Docs Manifest Integrity | Verify `index.json` schema and orphan file detection |
| **state-reconciliation.js** | Reconcile `docs/official_docs/.metadata/` with `machine.json` | Ensure query logs and state are synchronized |

### 4.2 Dispatch Token System

> **Note**: `dispatch_subagent` (`.opencode/scripts/command-tools/dispatch-subagent.js`) is a **project-specific custom tool** that wraps OpenCode's native `task` tool for subagent dispatch. It adds template variable resolution, preamble injection, and compliance gate integration on top of OpenCode's native dispatch mechanism. OpenCode's built-in `task` tool could also be used directly for simpler dispatch scenarios (e.g., via the `subtask: true` command config or agent `permission.task` patterns).

`@Orchestrator` must generate a **DISPATCH_TOKEN** for every `@Knowledge-Curator` invocation, regardless of which agent requested it (including `@Super-Admin`):

```json
{
  "token_id": "uc7_T-014_20260605_001",
  "task_id": "T-014",
  "requested_by": "@Super-Admin",
  "target_identified": ["/eslint/eslint", "/opencode/opencode"],
  "user_confirmed": true,
  "fallback_authorized": true,
  "timestamp": "2026-06-05T12:00:00Z",
  "ttl_seconds": 3600
}
```

The token is validated by `@Knowledge-Curator` before executing any external query. Expired or invalid tokens are rejected.

### 4.3 OpenCode Native Plugin Hook Integration

> **Design Note (UC7-F11)**: Beyond the custom `framework-enforcer.ts` plugin, OpenCode's native plugin hook system provides **complementary** enforcement capabilities that could be leveraged for UC7KS:

| OpenCode Hook | UC7KS Application | Benefit |
|---------------|-------------------|---------|
| `tool.execute.before` | Intercept `context7_query-docs`, `webfetch`, `websearch` calls **before** execution; verify UC7-001 (local cache checked) and UC7-002 (user confirmed) | Real-time interception — blocks external queries at the source |
| `tool.execute.after` | Verify docs saved to `docs/official_docs/` after write operations; enforce UC7-003 (save-or-fail) | Immediate post-write validation, not just at commit time |
| `session.compacted` | Inject relevant cached knowledge context during context compaction | Prevents knowledge loss across long-running sessions |
| `permission.asked` | Add custom permission dialogs for external queries; present identified libraries for user confirmation | Alternative to `question` tool for UC7-002 enforcement |

**Relationship to Custom Framework**: The custom `framework-enforcer.ts` provides **policy-level enforcement** (rule evaluation, state tracking, audit logging), while OpenCode's native plugin hooks provide **mechanism-level interception** (tool call blocking, post-write hooks). The two layers are complementary:
- **Native hooks**: Best for real-time interception and immediate reaction
- **Custom enforcer**: Best for complex policy evaluation, cross-rule validation, and state-machine integration

**Implementation Priority**: The custom `framework-enforcer.ts` (UC7-P3-T01) is the primary enforcement mechanism. Native plugin hooks (UC7-P3-T09) can be added as an additional layer for defense-in-depth, particularly for `tool.execute.before` interception of Context7/webfetch/websearch calls.

---

## 5. Permission Matrix

### 5.1 Agent Permissions for Knowledge Operations

| Agent | Read `docs/official_docs/` | Write `docs/official_docs/` | Dispatch `@Knowledge-Curator` (via `@Orchestrator`) | Direct Context7 | Webfetch Fallback | Dispatch Scout (via @Knowledge-Curator) |
|-------|---------------------------|----------------------------|-----------------------------------------------------|-----------------|-------------------|---------------------------------------|
| **@Meta-Planner** | Yes | No | Yes | No | No | No (indirect via @Knowledge-Curator) |
| **@Orchestrator** | Yes | No | Yes (router) | No | No | No (indirect via @Knowledge-Curator) |
| **@Architect** | Yes | No | Yes | No | No | No (indirect via @Knowledge-Curator) |
| **@Coder-BE** | Yes | No | Yes | No | No | No (indirect via @Knowledge-Curator) |
| **@Coder-FE** | Yes | No | Yes | No | No | No (indirect via @Knowledge-Curator) |
| **@Guardian** | Yes | No | Yes | No | No | No (indirect via @Knowledge-Curator) |
| **@Arbiter** | Yes | No | Yes | No | No | No (indirect via @Knowledge-Curator) |
| **@CI-CD-Agent** | Yes | No | Yes | No | No | No (indirect via @Knowledge-Curator) |
| **@Knowledge-Curator** | Yes | Yes (dedicated) | No (cannot self-dispatch) | Yes | Yes | **Yes (Scout-only via `permission.task`) — Layer 3** |
| **@Super-Admin** | Yes | Yes (emergency) | **Yes (same workflow as all agents)** | Yes | Yes | No (indirect via @Knowledge-Curator) |

### 5.2 File-Level Permission Resolution

```yaml
# Conceptual addition to agent_write_scopes
@Knowledge-Curator:
  allowed:
    - "docs/official_docs/**"
    - "docs/official_docs/.metadata/**"
  denied:
    - "booking_system_refactor/**"
    - ".opencode/agents/**"
    - ".opencode/rules/**"
    - "contract.yaml"

@Super-Admin:
  allowed:
    - "docs/official_docs/**"
    - "docs/official_docs/.metadata/**"
    - ".opencode/**"
    - "opencode.json"
    - "AGENTS.md"
    - "PROJECT_REFERENCE.md"
    - "contract.yaml"
    - "Task.DAG.json"
    - "TECH_DEBT_REGISTRY.md"
    - "WAIVE.md"
    - ".task_temp/**"
  denied:
    - "booking_system_refactor/booking-backend/src/**"
    - "booking_system_refactor/booking-frontend/src/**"
    - "booking_system_refactor/booking-backend/prisma/schema.prisma"
```

> **⚠️ OpenCode `external_directory` Permission (UC7-F19)**: OpenCode has a native `external_directory` permission controlling access to paths outside the working directory. The custom `agent_write_scopes` in this section serves a similar purpose at the project level. When `@Knowledge-Curator` writes to `docs/official_docs/` (which may be outside some agent scopes), the `external_directory` permission on the `edit` key should be set to `allow` for `docs/official_docs/**` in the agent's native permission config. The two systems (`agent_write_scopes` custom + `external_directory` native) should be kept synchronized.

---

## 6. Multi-Agent System Design

### 6.1 New Agent: @Knowledge-Curator

**Role**: Verification & Operations Layer -- Knowledge Management Specialist

**Mode**: Subagent (hidden, `@Orchestrator`-dispatched only)

**Model**: `DeepSeek/deepseek-v4-flash` (fast, low temperature for deterministic organization)

**Temperature**: 0.1

**Color**: `#06B6D4` (cyan)

**Skills**:
- `execution-preflight-check`
- `context7-first` (enhanced)
- `spreadsheet-processor` (for tabular docs)

**MCP Tools**:
- `context7_resolve-library-id`, `context7_query-docs` (Context7 MCP server tools; naming follows `<mcp-server-name>_<tool-name>` convention per `opencode.json` MCP configuration)
- `webfetch`
- `websearch` (requires OpenCode provider OR `OPENCODE_ENABLE_EXA=1`; falls back to webfetch-only if unavailable)
- `task` — **Scout dispatch only**: `permission.task: { "*": "deny", "scout": "allow" }` (Scout is OpenCode's built-in read-only subagent for external docs and source-code dependency research; @Knowledge-Curator invokes it as a subordinate worker when documentation-tier knowledge from Context7/webfetch/websearch is insufficient to answer implementation-level questions)
- `safe_edit` (project-specific custom tool)
- `safe_shell` (project-specific custom tool)
- `safe_mkdir` (project-specific custom tool)
- `safe_delete` (project-specific custom tool)
- `safe_diff` (project-specific custom tool)
- `skill` (OpenCode built-in)
- `question` (for user confirmation)
- `todowrite` (for progress tracking; OpenCode built-in; disabled for subagents by default — must explicitly `permission.todowrite: allow`)

**Permissions**:
```yaml
permission:
  edit: deny        # Must use safe_edit
  bash: deny
  task:
    "*": deny       # Cannot dispatch arbitrary subagents
    "scout": allow  # CAN dispatch Scout for source-code analysis (Layer 3)
  safe_test: deny
  safe_edit: allow  # For docs/official_docs/ only
```

> **⚠️ OpenCode Permission System Note (UC7-F17)**: OpenCode **deprecated** the `tools` boolean config in v1.1.1 in favor of the `permission` system. The `permission` block above uses the current native syntax. The custom `agent_tools_blacklist`/`agent_tools_whitelist` fields referenced elsewhere in this document (e.g., §3.1 UC7-004, §6.2) are project-specific abstractions that map to OpenCode's `permission.deny`/`permission.allow` on relevant keys. When implementing, prefer `permission` syntax for all new agent configs.

> **🔬 Experimental LSP Tool (UC7-F21)**: OpenCode has an experimental `lsp` tool requiring `OPENCODE_EXPERIMENTAL_LSP_TOOL=true`. If @Knowledge-Curator needed language-server-level code analysis (e.g., type resolution for source inspections), this would need to be enabled. Not required for the current design but noted for future extensibility.

**Core Responsibilities**:
1. Receive `DISPATCH_TOKEN` from `@Orchestrator`
2. Parse task description for technology mentions (NLP extraction)
3. Identify candidate Context7 libraries
4. **Present findings to user for confirmation** (`question` tool)
5. Query Context7 or fallback to webfetch/websearch
6. **If documentation-tier sources are insufficient** (implementation-level questions: "how does X work internally?", "why does X behave differently than documented?", "what edge cases does X not handle?"), escalate to **Layer 3 — Scout source analysis**: dispatch OpenCode's built-in `scout` subagent to clone the dependency repository and inspect source code
7. **Extract Scout findings**: Receive Scout's source analysis output and convert it to a structured `.md` file saved under `docs/official_docs/{domain}/{library}/source-analysis/` with `source: "scout"` metadata in `index.json`
8. Organize and save all findings to `docs/official_docs/`
9. Update `index.json` manifest
10. Return artifact paths to requesting agent

**Anti-Goals**:
- Must NOT modify business code
- Must NOT modify framework files
- Must NOT query without user confirmation
- Must NOT bypass local cache check

**Note on OpenCode Built-in Scout Subagent**: OpenCode includes a built-in `scout` subagent for "external docs and dependency research." @Knowledge-Curator extends this concept with structured knowledge management (local caching, SHA-based deduplication, TTL-based freshness, index.json manifest) and a mandatory user-confirmation workflow. Unlike `scout` (which is read-only and transient), @Knowledge-Curator produces persistent, searchable, versioned documentation artifacts in `docs/official_docs/`.

### 6.2 Modified Agent: @Orchestrator

**New Responsibility**: UC7KS Dispatch Router for ALL Agents

**Workflow Addition**:
```yaml
when: "Any agent (including @Super-Admin) requests external knowledge"
then:
  1. "Check if docs/official_docs/ has relevant cached content"
  2. "If cache hit -> return cache paths to requesting agent"
  3. "If cache miss -> generate DISPATCH_TOKEN"
  4. "Dispatch @Knowledge-Curator with token"
  5. "Wait for artifact paths"
  6. "Forward artifacts to requesting agent"
```

**New `agent_tools_whitelist` Entry** (custom project field; maps to OpenCode's native `permission.allow` on the `task` key — note: OpenCode deprecated the `tools` boolean config in v1.1.1 in favor of `permission`):
- `dispatch_subagent` -> now includes `@Knowledge-Curator` as valid target

> **💡 Alternative Dispatch Pattern (UC7-F20)**: OpenCode's command system supports a `subtask: true` flag for commands, providing an alternative mechanism for @Knowledge-Curator invocation:
> ```json
> { "command": { "knowledge": { "template": "Fetch technical documentation about $ARGUMENTS", "agent": "knowledge-curator", "subtask": true } } }
> ```
> This allows agents to invoke `/knowledge <query>` as a command shorthand instead of routing through @Orchestrator. Consider this as a complementary UX pattern for the Phase 4 agent updates.

### 6.3 Modified Agent: All Agents (Including @Super-Admin)

**New Pre-Task Checklist Addition** (applies to ALL agents):
```markdown
## Before Any Investigation/Coding/Review/Framework Repair:
1. [ ] Search `docs/official_docs/index.json` for relevant cached docs
2. [ ] If found, read cached docs via `read` tool
3. [ ] If insufficient or missing, request `@Orchestrator` to dispatch `@Knowledge-Curator`
4. [ ] NEVER call Context7 MCP tools directly
```

> **💡 Alternative Distribution Mechanism (UC7-F13)**: Instead of updating every agent config individually, OpenCode's `instructions` field in `opencode.json` can auto-inject the UC7KS checklist into all agents via glob patterns:
> ```json
> { "instructions": ["docs/official_docs/index.json"] }
> ```
> This provides a single-point-of-update for the local-first-search mandate without modifying 8+ agent config files. Recommended as a complementary distribution mechanism alongside explicit per-agent checklist inclusion.

---

## 7. Super-Admin Knowledge Support Integration

### 7.1 Design Philosophy

The `@Super-Admin` agent executes the most critical and high-risk operations in the framework:
- Repairing broken enforcement mechanisms
- Modifying governance rules (`framework-enforcer.ts`, `agent_write_scopes`)
- Reprovisioning infrastructure (plugins, hooks)
- Modifying `machine.json` and `gate-state.json`
- Creating/modifying agent configurations

**Problem**: When `@Super-Admin` executes these tasks, it currently relies on its training data or manual web searches. This leads to:
- Outdated framework version assumptions
- Incorrect enforcement rule syntax
- Missed best practices from official documentation
- Rework after discovering errors post-implementation

**Solution**: `@Super-Admin` MUST use the same UC7KS pipeline as all other agents. When it needs to:
- Fix a broken ESLint plugin -> query latest ESLint docs
- Update a pre-commit hook -> query latest Git hook patterns
- Modify `framework-enforcer.ts` -> query latest OpenCode framework specs
- Create a new agent config -> query best practices from official sources

### 7.2 Super-Admin UC7KS Workflow

```
+-----------------------------------------------------------------------------+
|                    @SUPER-ADMIN TASK EXECUTION FLOW                          |
|              (Uses the SAME UC7KS Pipeline as All Other Agents)              |
+-----------------------------------------------------------------------------+

     +------------------+
     | Task Received    |
     | "Fix broken      |
     |  framework-enfo  |
     |  rcer.ts"        |
     +--------+---------+
              |
              v
     +------------------+
     | Step 1: Search   |<--------------- UC7-001: Local-First Mandatory
     | docs/official_   |                (Even for Super-Admin)
     | docs/index.json  |
     +--------+---------+
              |
     +--------+---------+
     | Cache Hit?       |
     +--------+---------+
              |
     +--------+---------+
     | YES              |         NO
     |                  |
     v                  v
+---------+      +------------------+
| Read    |      | Request          |
| cached  |      | @Orchestrator    |
| docs    |      | to dispatch      |
| (e.g.,  |      | @Knowledge-      |
| eslint  |      | Curator          |
| docs)   |      |                  |
+----+----+      +--------+---------+
     |                    |
     |             +------+------+
     |             | Sufficient? |
     |             +------+------+
     |                    |
     |             +------+------+
     |             | YES         | NO
     |             |             |
     |             v             v
     |     +----------+  +------------------+
     |     | Use docs |  | Wait for         |
     |     | to guide |  | @Knowledge-      |
     |     | repair   |  | Curator to       |
     |     |          |  | fetch latest     |
     |     +----------+  | framework docs   |
     |                   +--------+---------+
     |                            |
     |                   +--------+---------+
     |                   | UC7-002: User    |
     |                   | Confirmation     |
     |                   | (if new libs)    |
     |                   +--------+---------+
     |                            |
     |                   +--------+---------+
     |                   | Docs fetched     |
     |                   | and saved to     |
     |                   | docs/official_   |
     |                   | docs/framework/  |
     |                   +--------+---------+
     |                            |
     +----------------------------+
                                  |
                                  v
                         +------------------+
                         | Super-Admin      |
                         | uses accurate    |
                         | latest docs to   |
                         | execute repair   |
                         | with confidence  |
                         +------------------+
                                  |
                                  v
                         +------------------+
                         | Higher accuracy  |
                         | Fewer errors     |
                         | Less rework      |
                         +------------------+
```

### 7.3 Super-Admin Specific Knowledge Domains

`@Super-Admin` tasks typically require knowledge from these domains:

| Task Type | Example | Relevant Context7 Libraries | Saved To | Scout Source Analysis (Layer 3) |
|-----------|---------|----------------------------|----------|-------------------------------|
| **Framework repair** | Fix broken `framework-enforcer.ts` | `/eslint/eslint`, `/typescript/typescript` | `docs/official_docs/framework/eslint/` | Clone ESLint repo → inspect plugin API internals; if OpenCode internals needed, clone `anomalyco/opencode` |
| **Hook repair** | Fix pre-commit hook | `/git/git` | `docs/official_docs/framework/git/` | Clone Git repo → inspect hook execution model source |
| **Agent config** | Create new agent config | OpenCode framework docs (web fallback) | `docs/official_docs/opencode/agents/` | Clone `anomalyco/opencode` → inspect agent dispatch source for undocumented options |
| **State surgery** | Repair `machine.json` | JSON Schema docs | `docs/official_docs/framework/json-schema/` | Clone relevant validation library → inspect schema validation internals |
| **Plugin fix** | Rebuild plugin installation | Node.js plugin docs | `docs/official_docs/framework/nodejs/` | Clone plugin dependency repos → inspect plugin loading mechanisms |
| **Rule update** | Update governance rules | Markdown linting, YAML specs | `docs/official_docs/framework/markdown/` | N/A (documentation-tier sufficient for text formats) |
| **CI/CD repair** | Fix GitHub Actions workflow | `/github/github`, `/docker/docker` | `docs/official_docs/devops/` | Clone relevant GitHub Actions runner repos → inspect runner behavior |

### 7.4 Benefits for Super-Admin

| Before UC7KS | After UC7KS |
|-------------|-------------|
| Relies on training data (potentially outdated) | Uses latest official docs from Context7 or web |
| Manual web searches (time-consuming, inconsistent) | Automated knowledge acquisition via `@Knowledge-Curator` |
| No local cache (re-fetches same docs repeatedly) | Reuses cached docs from `docs/official_docs/` |
| Risk of incorrect syntax in framework files | Accurate, version-matched documentation |
| Errors discovered late (during testing) | Better upfront decisions, fewer regressions |
| No audit trail of information sources | Full traceability in `index.json` and `query_log.json` |

### 7.5 Super-Admin Dispatch Examples

**Example 1: Fixing a Broken ESLint Plugin**

```
@Super-Admin receives task: "Fix eslint-audit plugin failing in CI"
  |
  v
Searches docs/official_docs/framework/eslint/ for cached ESLint plugin docs
  |
  v
Cache miss (no recent ESLint plugin docs)
  |
  v
Requests @Orchestrator to dispatch @Knowledge-Curator
  |
  v
@Knowledge-Curator identifies: ["/eslint/eslint"]
  |
  v
Queries Context7 for latest ESLint plugin API
  |
  v
Saves to: docs/official_docs/framework/eslint/v9.x-plugin-api.html
  |
  v
@Super-Admin reads the docs
  |
  v
@Super-Admin fixes plugin using accurate, latest API references
```

**Example 2: Designing a New Agent Config**

```
@Super-Admin receives task: "Create @Knowledge-Curator agent config"
  |
  v
Searches docs/official_docs/framework/opencode/ for agent config patterns
  |
  v
Cache insufficient (no docs on agent config design)
  |
  v
Requests @Orchestrator to dispatch @Knowledge-Curator
  |
  v
@Knowledge-Curator identifies: ["opencode framework", "agent config best practices"]
  |
  v
Context7 has no coverage for OpenCode internal framework -> webfetch fallback
  |
  v
Fetches from: https://docs.opencode.ai/agent-config-guide
  |
  v
Saves to: docs/official_docs/framework/opencode/agent-config-guide.html
  |
  v
@Super-Admin reads the guide
  |
  v
@Super-Admin designs @Knowledge-Curator config following best practices
```

---

## 8. OpenCode Official Knowledge Integration

### 8.1 Overview

**OpenCode** (https://opencode.ai/) is the foundational framework upon which this entire multi-agent system is built. As the framework evolves, its official documentation, best practices, and architectural guidelines are continuously updated. All agents — especially `@Super-Admin`, `@Architect`, and `@Orchestrator` — MUST have access to the latest OpenCode official knowledge to ensure framework modifications remain compatible and follow current standards.

### 8.2 Dedicated OpenCode Knowledge Domain

A dedicated top-level domain `opencode/` is established within `docs/official_docs/` to house all OpenCode-related documentation:

```
docs/official_docs/
+-- opencode/                   # OpenCode official knowledge (https://opencode.ai/)
|   +-- agents/                 # Agent configuration and lifecycle docs
|   |   +-- agent-config-guide.html
|   |   +-- dispatch-protocol.html
|   |   +-- permission-matrix.html
|   +-- skills/                 # Skill development and registration docs
|   |   +-- skill-development-guide.html
|   |   +-- skill-invocation-standard.html
|   +-- framework/              # Framework architecture and internals
|   |   +-- framework-enforcer.html
|   |   +-- state-machine.html
|   |   +-- compliance-gate.html
|   +-- mcp/                    # MCP tool integration docs
|   |   +-- mcp-tool-inventory.html
|   |   +-- context7-integration.html
|   +-- deployment/             # Deployment and operations docs
|       +-- ci-cd-pipeline.html
|       +-- docker-deployment.html
```

### 8.3 OpenCode Knowledge Sources

| Source | URL | Content Type | Update Frequency | Fallback Priority |
|--------|-----|--------------|------------------|-------------------|
| **OpenCode Official Docs** | https://opencode.ai/docs | Framework specs, API docs | Continuous | Primary |
| **OpenCode Blog** | https://opencode.ai/blog | Product announcements, tutorials (⚠️ **unverified for technical content** — may contain primarily product announcements rather than technical reference material; treat as secondary/inspirational source only) | Weekly | Secondary (low confidence) |
| **OpenCode GitHub** | https://github.com/anomalyco/opencode | Source code, examples (160K+ stars) | Real-time | Tertiary |

### 8.4 Semantic Map Entry for OpenCode

```json
{
  "domain_id": "opencode_framework",
  "keywords": [
    "opencode",
    "agent",
    "skill",
    "mcp",
    "framework",
    "compliance",
    "gate",
    "orchestrator",
    "dispatch",
    "subagent"
  ],
  "context7_libraries": [],
  "fallback_pattern": "https://opencode.ai/docs/{topic}",
  "primary_source": "webfetch",
  "ttl_days": 7,
  "description": "OpenCode framework official documentation"
}
```

**Note**: OpenCode is a proprietary framework and may not be indexed by Context7. Therefore, it uses **webfetch** as its primary source with a shorter TTL (7 days) to ensure freshness.

### 8.5 Agents That Require OpenCode Knowledge

| Agent | Use Case | Typical Queries |
|-------|----------|----------------|
| **@Super-Admin** | Framework repairs, rule updates | "framework enforcer syntax", "agent config schema", "compliance gate API" |
| **@Architect** | System design, contract definition | "agent communication protocol", "state machine transitions", "DAG structure" |
| **@Orchestrator** | Dispatch routing, workflow management | "dispatch token format", "subagent lifecycle", "task scheduling" |
| **@Guardian** | Code review, compliance checking | "framework-specific quality rules", "agent config compliance patterns", "permission system enforcement" (Note: @Guardian's primary coding standards come from `.opencode/context/code_standards/`; OpenCode knowledge is for framework-specific review rules, not general coding standards) |
| **@Meta-Planner** | DAG generation, task decomposition | "task dependency model", "agent capability matrix", "project graph schema" |

### 8.6 OpenCode Knowledge Workflow Example

```
@Super-Admin receives task: "Update agent config to add new MCP tool"
  |
  v
Searches docs/official_docs/opencode/agents/ for agent config docs
  |
  v
Cache miss (no recent OpenCode agent config docs)
  |
  v
Requests @Orchestrator to dispatch @Knowledge-Curator
  |
  v
@Knowledge-Curator identifies: ["opencode agent config", "mcp tool registration"]
  |
  v
Context7 has no coverage for OpenCode -> webfetch fallback
  |
  v
Fetches from: https://opencode.ai/docs/agent-config-guide
  |
  v
Saves to: docs/official_docs/opencode/agents/agent-config-guide.html
  |
  v
@Super-Admin reads the guide
  |
  v
@Super-Admin updates agent config following official OpenCode standards
```

### 8.7 OpenCode Knowledge Refresh Policy

Given the rapid evolution of the OpenCode framework:

- **TTL**: 7 days (shorter than standard 30 days)
- **Auto-refresh**: `@CI-CD-Agent` Janitor flags OpenCode docs for refresh weekly
- **Manual refresh**: `@Super-Admin` can request immediate refresh after framework updates
- **Version tracking**: `index.json` tracks OpenCode doc versions to detect changes

---

## 9. Central State Management

### 9.1 machine.json Extensions

Add a new top-level section: `knowledge_state`

```json
{
  "knowledge_state": {
    "version": "1.2.0",
    "index_manifest_sha256": "abc123...",
    "total_docs_count": 47,
    "total_size_bytes": 23456789,
    "last_janitor_run": "2026-06-05T00:00:00Z",
    "active_queries": [
      {
        "token_id": "uc7_T-014_20260605_001",
        "status": "in_progress",
        "agent": "@Super-Admin",
        "libraries": ["/eslint/eslint"],
        "timestamp": "2026-06-05T12:00:00Z"
      }
    ],
    "query_stats": {
      "total_queries": 156,
      "context7_hits": 134,
      "web_fallbacks": 22,
      "cache_hits": 289
    },
    "ttl_violations": [
      {
        "path": "docs/official_docs/framework/eslint/v8.x-obsolete.html",
        "age_days": 45,
        "action": "flagged_for_refresh"
      }
    ]
  }
}
```

### 9.2 gate-state.json Extensions

Track `@Knowledge-Curator` sessions as specialized compliance gate sessions:

```json
{
  "knowledge_sessions": [
    {
      "session_id": "uc7_ses_1777110280157",
      "token_id": "uc7_T-014_20260605_001",
      "status": "confirmed",
      "libraries_identified": ["/eslint/eslint"],
      "user_confirmed": true,
      "created_at": "2026-06-05T12:00:00Z",
      "confirmed_at": "2026-06-05T12:01:30Z",
      "completed_at": null
    }
  ]
}
```

### 9.3 index.json Schema (docs/official_docs/)

```json
{
  "manifest_version": "1.2.0",
  "last_updated": "2026-06-05T12:00:00Z",
  "entries": [
    {
      "library_id": "/nestjs/nest",
      "query_topic": "guards",
      "files": [
        {
          "path": "backend/nestjs/v11.x-guards.html",
          "source": "context7",
          "sha256": "sha256:abc123...",
          "size_bytes": 45231,
          "created_at": "2026-06-01T10:00:00Z",
          "ttl_days": 30,
          "access_count": 12,
          "last_accessed": "2026-06-05T11:00:00Z"
        }
      ]
    },
    {
      "library_id": "web-fallback",
      "query_topic": "opencode agent config best practices",
      "files": [
        {
          "path": "fallback/web-sha256-def456.html",
          "source": "webfetch",
          "original_url": "https://docs.opencode.ai/agent-config-guide",
          "sha256": "sha256:def456...",
          "size_bytes": 89123,
          "created_at": "2026-06-03T14:00:00Z",
          "ttl_days": 14,
          "access_count": 3,
          "last_accessed": "2026-06-04T09:00:00Z"
        }
      ]
    }
  ]
}
```

---

## 10. Templatization & Parameterization

### 10.1 New Template Variables

Extend `TEMPLATE_VARIABLE_STANDARD.md` with new placeholders:

| Placeholder | Resolves To | Source Field | Example |
|-------------|-------------|--------------|---------|
| `{knowledge.docs_root}` | Official docs directory | `paths.knowledge_docs` | `docs/official_docs/` |
| `{knowledge.index_manifest}` | Index file path | `paths.knowledge_index` | `docs/official_docs/index.json` |
| `{knowledge.max_file_size}` | Max single file size | `template_resolution.knowledge.max_file_size` | `524288` (512KB) |
| `{knowledge.max_total_size}` | Max total docs size | `template_resolution.knowledge.max_total_size` | `52428800` (50MB) |
| `{knowledge.default_ttl}` | Default doc TTL in days | `template_resolution.knowledge.default_ttl` | `30` |
| `{knowledge.fallback_ttl}` | Web fallback TTL in days | `template_resolution.knowledge.fallback_ttl` | `14` |

### 10.2 project.config.json Extensions

```json
{
  "paths": {
    "knowledge_docs": "docs/official_docs/",
    "knowledge_index": "docs/official_docs/index.json"
  },
  "template_resolution": {
    "knowledge.max_file_size": 524288,
    "knowledge.max_total_size": 52428800,
    "knowledge.default_ttl": 30,
    "knowledge.fallback_ttl": 14,
    "knowledge.janitor_interval_hours": 24,
    "knowledge.compression_threshold_kb": 200
  }
}
```

### 10.3 Stack-Agnostic Semantic Map

Replace static `context7_task_mapping` with a **parameterized semantic map**:

```json
{
  "knowledge_semantic_map": {
    "domains": [
      {
        "domain_id": "backend_api",
        "keywords": ["controller", "endpoint", "guard", "middleware", "swagger", "dto", "api"],
        "context7_libraries": ["{backend.framework}"],
        "fallback_pattern": "https://{backend.framework}.dev/docs/{topic}"
      },
      {
        "domain_id": "persistence",
        "keywords": ["database", "prisma", "schema", "migration", "transaction", "sql", "orm"],
        "context7_libraries": ["{db.orm}"],
        "fallback_pattern": "https://{db.orm}.io/docs/{topic}"
      },
      {
        "domain_id": "frontend_ui",
        "keywords": ["component", "template", "signal", "store", "style", "css", "tailwind"],
        "context7_libraries": ["{frontend.framework}", "{frontend.ui_library}"],
        "fallback_pattern": "https://{frontend.framework}.io/docs/{topic}"
      },
      {
        "domain_id": "caching",
        "keywords": ["cache", "redis", "ioredis", "ttl", "cache-aside"],
        "context7_libraries": ["{cache.engine}"],
        "fallback_pattern": "https://redis.io/docs/{topic}"
      },
      {
        "domain_id": "queue",
        "keywords": ["queue", "bullmq", "job", "worker", "scheduler"],
        "context7_libraries": ["{queue.engine}"],
        "fallback_pattern": "https://docs.bullmq.io/{topic}"
      },
      {
        "domain_id": "testing",
        "keywords": ["test", "jest", "spec", "coverage", "e2e", "playwright"],
        "context7_libraries": ["{testing.unit}", "{testing.e2e}"],
        "fallback_pattern": "https://jestjs.io/docs/{topic}"
      },
      {
        "domain_id": "framework_tools",
        "keywords": ["eslint", "prettier", "typescript", "hook", "plugin", "config"],
        "context7_libraries": ["/eslint/eslint", "/typescript/typescript"],
        "fallback_pattern": "https://{tool}.docs.domain/{topic}"
      }
    ]
  }
}
```

**Benefit**: When switching from NestJS to Express, the `{backend.framework}` placeholder automatically resolves to `/expressjs/express` without modifying the semantic map.

---

## 11. Knowledge Management Subsystem

### 11.1 Local Cache (docs/official_docs/)

**Structure**: Domain-based hierarchy (see Section 2.2)

**File Format**: `.html` (preserves formatting, searchable, renderable)

**Naming Convention**:
```
{domain}/{library}/{version}-{topic}.html
fallback/web-{sha256}.html
```

### 11.2 Indexer

**Function**: Maintains `index.json` as a searchable manifest

**Indexing Strategy**:
- SHA-256 deduplication: Before saving, check if content hash already exists
- Topic tagging: Each entry tagged with extracted keywords for fast lookup
- Cross-reference tracking: Links related docs (e.g., NestJS guards <-> Passport JWT)

**Search API** (conceptual, for agents):
```json
POST /internal/knowledge/search
{
  "query": "nestjs guard jwt authentication",
  "agent": "@Coder-BE",
  "max_results": 5
}
```

**Response**:
```json
{
  "cache_hits": [...],
  "suggested_context7_queries": ["/nestjs/nest"],
  "suggested_web_queries": ["nestjs passport jwt guard example"]
}
```

> **⚠️ websearch Availability Constraint (UC7-F3)**: The `websearch` fallback tool is **not universally available**. It requires either (1) the OpenCode provider (Zen), or (2) `OPENCODE_ENABLE_EXA=1` environment variable. If neither condition is met, the fallback chain **degrades to `webfetch`-only**: Context7 → webfetch → (halt). This constraint applies to the `suggested_web_queries` path above. See §6.1 for tool availability details.

### 11.3 Deduplicator

**Rule**: If a new query returns content with SHA-256 matching an existing file:
- Do NOT create a new file
- Update `index.json` to add the new query topic as an alias
- Increment access count
- Update `last_accessed` timestamp

### 11.4 Compressor

**Trigger**: When `size_bytes > compression_threshold_kb` (default 200KB)

**Strategy**: Convert `.html` to `.md` using `pandoc_convert-contents` with:
- Images stripped (replace with `[image: description]`)
- CSS inline styles removed
- Only semantic HTML preserved (headings, paragraphs, code blocks, tables)

**Reversible**: Keep original `.html` in `.metadata/archives/` for 7 days before permanent deletion.

### 11.5 Janitor (TTL Enforcement)

**Schedule**: Run by `@CI-CD-Agent` every `janitor_interval_hours` (default 24h)

**Actions**:
1. Scan `index.json` for entries where `now - created_at > ttl_days`
2. For expired entries:
   - Move to `.archive/[YYYY-MM-DD]/`
   - Update `index.json` to mark as `archived`
3. For entries where `now - last_accessed > ttl_days * 2` (double TTL):
   - Permanent deletion
   - Update `index.json` to remove entry
4. Generate `size_report.json`
5. If total size > `max_total_size`:
   - Delete least-recently-accessed entries first (LRU eviction)
   - Log evictions to `machine.json.knowledge_state`

### 11.6 Source Analysis Layer — Scout Integration (Layer 3)

**Design Principle**: Documentation (Context7/webfetch/websearch — Layers 1-2) answers _what_ and _how to use_. Source code (Scout — Layer 3) answers _how it works internally_ and _why it behaves as it does_. Scout is never invoked speculatively — only when documentation-tier sources are insufficient for the current task.

**Relationship to @Knowledge-Curator**: Scout is a **subordinate worker**, not a peer. @Knowledge-Curator remains the single gateway for all knowledge acquisition. It decides _when_ to escalate to Scout, dispatches it, extracts findings, and persists them. No other agent invokes Scout directly.

```
Layer 1: Local Cache (docs/official_docs/) — UC7-001 enforced, fastest
   ↓ MISS
Layer 2: Documentation Sources — Context7 MCP → webfetch → websearch
   ↓ INSUFFICIENT (implementation detail needed)
Layer 3: Source Code Analysis — Scout subagent clones repo, inspects source,
         extracts findings → saved to source-analysis/ as .md
```

**Scout Trigger Conditions** (decided by @Knowledge-Curator):

| Trigger Pattern | Example Query | Why Docs Are Insufficient |
|-----------------|---------------|--------------------------|
| "internally", "under the hood" | "How does NestJS guard execution order work internally?" | Docs describe API, not execution pipeline |
| "why does X behave", "unexpected" | "Why does express-rate-limit behave differently in v7?" | Docs may not reflect implementation bugs |
| "edge case", "undocumented" | "What edge cases does Prisma transaction not handle?" | Undocumented behavior not in docs |
| "source code", "implementation" | "Is this ESLint rule checking what the docs claim?" | Docs describe intent; source reveals logic |
| "type narrowing", "generic" | "How does TypeScript narrow this generic internally?" | Type system internals are implementation-defined |

**Scout Invocation Protocol**:
1. @Knowledge-Curator determines docs are insufficient
2. User confirmation (UC7-002): "Dispatch Scout to inspect {repo} source?"
3. If confirmed, dispatch via `task({ subagent_type: "scout", ... })`
4. Scout returns source analysis
5. Convert to `.md`, save to `source-analysis/` with `source: "scout"` in index.json
6. Size control: only extracted `.md` persisted, not the full cloned repo

**Responsibility Boundary**:

| Responsibility | @Knowledge-Curator | Scout |
|----------------|-------------------|-------|
| User confirmation | Yes | No |
| Save to docs/ | Yes | No |
| Update index.json | Yes | No |
| Context7/webfetch/websearch | Yes | No |
| Clone repos, read source | No | Yes |
| Dispatch decisions | Yes (when to escalate) | No (never invoked directly) |

**TTL for Scout Findings**: 14 days (shorter than standard 30 days). Source code changes with each release, so Scout findings have a shorter relevance window. Re-clone and re-analyze on TTL expiry.

**Super-Admin Primary Beneficiary**: Framework repairs often need implementation-level understanding. OpenCode internals are sparsely documented — source inspection via Scout is often the only authoritative reference for plugin/hook behavior that diverges from docs between versions.

---

## 12. Workflow Diagrams

### 12.1 Full UC7KS Workflow (Agent Perspective)

```
+-----------------------------------------------------------------------------+
|                        AGENT TASK EXECUTION FLOW                             |
|                    (Applies to ALL Agents, Including @Super-Admin)           |
+-----------------------------------------------------------------------------+

     +------------------+
     | Task Received    |
     | "Implement auth  |
     |  guard for        |
     |  appointments"   |
     +--------+---------+
              |
              v
     +------------------+
     | Step 1: Search   |<--------------- UC7-001: Local-First Mandatory
     | docs/official_   |                (Applies to ALL agents)
     | docs/index.json  |
     +--------+---------+
              |
     +--------+---------+
     | Cache Hit?       |
     +--------+---------+
              |
     +--------+---------+
     | YES              |         NO
     |                  |
     v                  v
+---------+      +------------------+
| Read    |      | Request          |
| cached  |      | @Orchestrator    |
| docs    |      | for knowledge    |
|         |      | dispatch         |
+----+----+      +--------+---------+
     |                    |
     |             +------+------+
     |             | Sufficient? |
     |             +------+------+
     |                    |
     |             +------+------+
     |             | YES         | NO
     |             |             |
     |             v             v
     |     +----------+  +------------------+
     |     | Proceed  |  | @Orchestrator    |
     |     | with     |  | dispatches       |
     |     | task     |  | @Knowledge-      |
     |     |          |  | Curator          |
     |     +----------+  +--------+---------+
     |                          |
     |                 +--------+---------+
     |                 | UC7-002: User    |
     |                 | Confirmation     |
     |                 | Required         |
     |                 +--------+---------+
     |                          |
     |                 +--------+---------+
     |                 | User Confirmed?  |
     |                 +--------+---------+
     |                          |
     |                 +--------+---------+
     |                 | YES              | NO
     |                 |                  |
     |                 v                  v
     |          +--------------+     +--------------+
     |          | @Knowledge-  |     | Abort query; |
     |          | Curator      |     | agent uses   |
     |          | executes     |     | best effort  |
     |          | search       |     | or escalates |
     |          +------+-------+     +--------------+
     |                 |
     |     +-----------+-----------+
     |     |           |           |
     |     v           v           v
     | +--------+ +----------+ +----------+
     | |Context7| | Webfetch | | Websearch|
     | | Hit?   | | Fallback | | Fallback |
     | +---+----+ +-----+----+ +-----+----+
     |     |           |            |
     |     |    +------+-----+      |
     |     |    | Save to   |      |
     |     |    | docs/     |      |
     |     |    | official_ |      |
     |     |    | docs/     |      |
     |     |    | (UC7-003) |      |
     |     |    +-----+-----+      |
     |     |          |            |
     |     |    +-----+-----+      |
     |     |    | Update    |      |
     |     |    | index.json|      |
     |     |    | (UC7-007) |      |
     |     |    +-----+-----+      |
     |     |          |            |
     |     +----------+------------+
     |                |
     |                v
     |     +------------------+
     |     | Return artifact  |
     |     | paths to agent   |
     |     +--------+---------+
     |                |
     +----------------+
                      v
             +------------------+
             | Agent reads      |
             | docs and         |
             | proceeds with    |
             | task             |
             +------------------+
```

> **Layer 3 Scout Branch**: When documentation-tier sources return insufficient results for implementation-level questions, the @Knowledge-Curator path branches into Scout source-code analysis (clone repo, inspect source, extract findings → save to `source-analysis/`). See §11.6 for full Scout integration design.

### 12.2 @Knowledge-Curator Internal Workflow

```
+-----------------------------------------------------------------------------+
|                     @KNOWLEDGE-CURATOR INTERNAL FLOW                         |
+-----------------------------------------------------------------------------+

     +------------------+
     | Receive dispatch |
     | with DISPATCH_   |
     | TOKEN            |
     +--------+---------+
              |
              v
     +------------------+
     | Validate token   |
     | (signature, TTL) |
     +--------+---------+
              |
     +--------+---------+
     | Valid?           |
     +--------+---------+
              |
     +--------+---------+
     | NO               | YES
     |                  |
     v                  v
+----------+      +------------------+
| Return   |      | Parse task desc  |
| error    |      | for tech mentions|
+----------+      | (NLP extraction) |
                  +--------+---------+
                           |
                  +--------+---------+
                  | Match against    |
                  | knowledge_       |
                  | semantic_map     |
                  +--------+---------+
                           |
                  +--------+---------+
                  | Identify         |
                  | candidate        |
                  | libraries:       |
                  | [lib1, lib2]     |
                  +--------+---------+
                           |
                  +--------+---------+
                  | UC7-002: Present |
                  | to user via      |
                  | question tool    |
                  +--------+---------+
                           |
                  +--------+---------+
                  | User confirmed?  |
                  +--------+---------+
                           |
                  +--------+---------+
                  | NO               | YES
                  |                  |
                  v                  v
           +----------+     +------------------+
           | Return   |     | Try Context7     |
           | abort    |     | query for lib1   |
           +----------+     +--------+---------+
                                     |
                            +--------+---------+
                            | Context7 has     |
                            | coverage?        |
                            +--------+---------+
                                     |
                            +--------+---------+
                            | YES              | NO
                            |                  |
                            v                  v
                      +----------+      +------------------+
                      | Fetch    |      | Try webfetch     |
                      | docs     |      | with fallback_   |
                      |          |      | pattern          |
                      +----+-----+      +--------+---------+
                           |                     |
                           |            +--------+---------+
                           |            | Webfetch OK?     |
                           |            +--------+---------+
                           |                     |
                           |            +--------+---------+
                           |            | YES              | NO
                           |            |                  |
                           |            v                  v
                           |    +----------+      +------------------+
                           |    | Save web |      | Try websearch    |
                           |    | result   |      | (broader query)  |
                           |    +----+-----+      +--------+---------+
                           |         |                     |
                           |         |            +--------+---------+
                           |         |            | Results found?   |
                           |         |            +--------+---------+
                           |         |                     |
                           |         |            +--------+---------+
                           |         |            | YES              | NO
                           |         |            |                  |
                           |         |            v                  v
                           |         |   +----------+      +------------+
                           |         |   | Save web |      | Log failure|
                           |         |   | results  |      | to machine.|
                           |         |   |          |      | json;      |
                           |         |   +----+-----+      | return     |
                           |         |        |            | empty list |
                           |         |        |            +------------+
                           |         |        |
                           +---------+--------+
                                      |
                                      v
                           +------------------+
                           | UC7-003: Save    |
                           | to docs/         |
                           | official_docs/   |
                           | as .html         |
                           +--------+---------+
                                    |
                           +--------+---------+
                           | UC7-007: Update  |
                           | index.json       |
                           | atomically       |
                           +--------+---------+
                                    |
                           +--------+---------+
                           | Enforce size     |
                           | limits (UC7-005) |
                           +--------+---------+
                                    |
                                    v
                           +------------------+
                           | Return artifact  |
                           | paths + metadata |
                           | to @Orchestrator |
                           +------------------+
```

> **Layer 3 — Scout Escalation**: When documentation-tier sources (Context7/webfetch/websearch) return only surface-level API docs, @Knowledge-Curator assesses whether the task requires deeper implementation knowledge. If trigger keywords ("internally", "how does X work", "edge case", "source code", "why does X behave") are present, @Knowledge-Curator offers Scout escalation to the user. If confirmed, Scout (OpenCode's built-in read-only source-analysis subagent) clones the target repository, inspects relevant source files, returns findings that @Knowledge-Curator extracts to `.md` and saves under `docs/official_docs/{domain}/{library}/source-analysis/`.

### 12.3 Super-Admin Knowledge Support Workflow

```
+-----------------------------------------------------------------------------+
|               @SUPER-ADMIN KNOWLEDGE SUPPORT WORKFLOW                        |
+-----------------------------------------------------------------------------+

     +------------------+
     | Super-Admin      |
     | receives task    |
     | "Fix broken      |
     |  eslint plugin"  |
     +--------+---------+
              |
              v
     +------------------+
     | Step 1: Search   |<--------------- UC7-001: Local-First
     | docs/official_   |                (Same as all agents)
     | docs/index.json  |
     +--------+---------+
              |
     +--------+---------+
     | Found cached     |
     | ESLint docs?     |
     +--------+---------+
              |
     +--------+---------+
     | YES              |         NO
     |                  |
     v                  v
+---------+      +------------------+
| Read    |      | Request          |
| cached  |      | @Orchestrator    |
| docs    |      | to dispatch      |
|         |      | @Knowledge-      |
|         |      | Curator          |
+----+----+      +--------+---------+
     |                    |
     |             +------+------+
     |             | Sufficient? |
     |             +------+------+
     |                    |
     |             +------+------+
     |             | YES         | NO
     |             |             |
     |             v             v
     |     +----------+  +------------------+
     |     | Use docs |  | Wait for         |
     |     | to guide |  | @Knowledge-      |
     |     | repair   |  | Curator to       |
     |     |          |  | fetch latest     |
     |     +----------+  | ESLint docs      |
     |                   +--------+---------+
     |                            |
     |                   +--------+---------+
     |                   | Docs fetched     |
     |                   | and saved to     |
     |                   | docs/official_   |
     |                   | docs/framework/  |
     |                   | eslint/          |
     |                   +--------+---------+
     |                            |
     +----------------------------+
                                  |
                                  v
                         +------------------+
                         | Super-Admin      |
                         | uses accurate    |
                         | latest ESLint    |
                         | docs to fix      |
                         | the plugin       |
                         +------------------+
                                  |
                                  v
                         +------------------+
                         | Fix is based on  |
                         | official docs    |
                         | not outdated     |
                         | training data    |
                         +------------------+
                                  |
                                  v
                         +------------------+
                         | Higher accuracy  |
                         | Fewer errors     |
                         | Less rework      |
                         +------------------+
```

> **Super-Admin + Scout Synergy**: When @Super-Admin's task involves framework internals (repairing `framework-enforcer.ts`, fixing plugins, understanding OpenCode's agent dispatch model), documentation-tier sources are often insufficient. Scout escalates to clone `anomalyco/opencode` (or the relevant dependency) and inspect source code directly. @Super-Admin remains the **primary beneficiary** of Layer 3 Scout integration — source inspection is often the only authoritative reference for framework internals.

---

## 13. Implementation Roadmap

### Phase 1: Foundation (No file modifications needed for analysis)
- [ ] Design `@Knowledge-Curator` agent config (`.opencode/agents/Knowledge-Curator.md`)
- [ ] Design enhanced `context7-first` skill (`SKILL.md` + query templates)
- [ ] Design `docs/official_docs/` directory schema (including `framework/` subdomain for Super-Admin)
- [ ] Design `index.json` manifest schema
- [ ] Design `machine.json.knowledge_state` extensions

> **💡 CLI Shortcut (UC7-F15)**: OpenCode's built-in `opencode agent create` CLI command provides an interactive wizard for agent creation (select location → write description → generate prompt → select permissions → create markdown file). This can accelerate the initial scaffolding of the `@Knowledge-Curator` agent config before manual refinement.

### Phase 2: Core Infrastructure (Requires compliance gate)
- [ ] Create `docs/official_docs/` directory structure
- [ ] Implement `index.json` with atomic update logic
- [ ] Create `@Knowledge-Curator` agent config
- [ ] Update `context7-first` skill with autonomous extraction prompts
- [ ] Update `project.config.json` with `knowledge_semantic_map`

### Phase 3: Harness Integration (Requires compliance gate)
- [ ] Update `framework-enforcer.ts` with UC7-001 to UC7-009 rules
- [ ] Update pre-commit hook with Layer 2.6 (Docs Consistency Check)
- [ ] Update pre-execution-hook.sh with Knowledge Gate
- [ ] Update `code-quality-gate` with docs size validation
- [ ] Update `framework-self-test.js` with Check 19

### Phase 4: Agent Updates (Requires compliance gate)
- [ ] Update `@Orchestrator` with dispatch logic and `agent_tools_whitelist`
- [ ] Update all coding agents with local-first search checklist
- [ ] Update `@Super-Admin` agent config to include UC7KS workflow in its pre-task checklist
- [ ] Update `agent_write_scopes` with `@Knowledge-Curator` entry

### Phase 5: Knowledge Management (Requires compliance gate)
- [ ] Implement Janitor logic in `@CI-CD-Agent` workflows
- [ ] Implement Compressor (`.html` -> `.md` on threshold)
- [ ] Implement Deduplicator (SHA-based)
- [ ] Implement LRU eviction for size cap enforcement

### Phase 5b: Scout Integration — Source Analysis Layer (Requires compliance gate)
- [ ] Configure `@Knowledge-Curator` `permission.task: { "*": "deny", "scout": "allow" }` for Scout dispatch
- [ ] Implement Scout trigger-condition logic in @Knowledge-Curator (keyword detection: "internally", "how does X work", "edge case", "source code", "why does X behave")
- [ ] Implement Scout findings extraction pipeline: Scout output → `.md` → `docs/official_docs/{domain}/{library}/source-analysis/`
- [ ] Add `source: "scout"` metadata field to `index.json` schema
- [ ] Create `source-analysis/` subdirectories in domain hierarchy
- [ ] Implement Scout-specific 14-day TTL (shorter than standard 30-day for documentation)
- [ ] Add Scout findings to Janitor eviction logic

### Phase 6: Super-Admin Integration Testing (Requires compliance gate)
- [ ] Test `@Super-Admin` dispatching `@Knowledge-Curator` for framework docs
- [ ] Test `@Super-Admin` using cached docs from `docs/official_docs/framework/`
- [ ] Verify UC7-009 enforcement (Super-Admin cannot bypass local cache)
- [ ] End-to-end test: Super-Admin fixes broken ESLint plugin using UC7KS-acquired docs

---

## Compliance Gate Note

Since this design involves framework file modifications (new agent config, skill updates, `project.config.json` extensions, harness integration), any implementation **must** follow the mandatory compliance gate sequence:

```
compliance_gate_check("Implement Universal Context7-First Knowledge System")
  -> User confirmation
  -> compliance_gate_confirm()
  -> Implementation
  -> compliance_gate_complete()
```

The design itself is analysis-only and requires no gate, but all Phase 2–6 implementation tasks are gated.

---

## Appendix: Requirements Traceability Matrix

| User Requirement | Design Solution | Section |
|-----------------|-----------------|---------|
| **1. Output identified libraries for confirmation** | `@Knowledge-Curator` presents candidates via `question` tool before querying | Section 6.1, Section 11.2 |
| **2. Fallback to webfetch/websearch** | Three-tier fallback: Context7 -> Webfetch -> Websearch | Section 11.2 |
| **3. Save findings to docs/official_docs/ as .html** | Dedicated domain-based directory with `.html` preservation | Section 2.2, Section 10.1 |
| **4. Dedicated subagent (@Knowledge-Curator)** | New hidden subagent with restricted scope and dispatch token validation | Section 6.1 |
| **5. Agents search local docs first** | UC7-001 enforcement: mandatory local cache check before external queries | Section 3.1, Section 11.1 |
| **6. Knowledge management for quick search & size control** | Indexer + Deduplicator + Compressor + Janitor with TTL and LRU eviction | Section 10 |
| **7. Super-Admin uses UC7KS for its own tasks** | `@Super-Admin` follows same UC7KS workflow as all agents; dispatches `@Knowledge-Curator` for framework docs | Section 7 |
| **8. Super-Admin has dedicated framework docs domain** | `docs/official_docs/framework/` subdomain for framework-specific documentation | Section 2.2 |
| **9. OpenCode official knowledge integration** | Dedicated `opencode/` domain with webfetch fallback, 7-day TTL, weekly auto-refresh | Section 8 |
| **10. All agents access OpenCode docs** | `@Super-Admin`, `@Architect`, `@Orchestrator`, `@Guardian`, `@Meta-Planner` can query OpenCode official docs via UC7KS | Section 8.5 |
| **11. Scout source-code analysis (Layer 3)** | @Knowledge-Curator dispatches OpenCode built-in Scout subagent for implementation-level questions; findings extracted to `source-analysis/` with 14-day TTL; @Super-Admin is primary beneficiary | Section 11.6 |

---

## Appendix B: Super-Admin Knowledge Support Quick Reference

```
+------------------------------------------------------------------+
|           SUPER-ADMIN UC7KS QUICK REFERENCE                       |
+------------------------------------------------------------------+
|                                                                   |
|  WHEN Super-Admin needs to:                                       |
|    -> Fix broken framework files                                  |
|    -> Update governance rules                                     |
|    -> Create/modify agent configs                                 |
|    -> Repair plugins/hooks                                        |
|    -> Modify machine.json/gate-state.json                         |
|                                                                   |
|  THEN Super-Admin MUST:                                           |
|    1. Search docs/official_docs/ for relevant cached docs         |
|    2. If insufficient -> request @Orchestrator dispatch           |
|       @Knowledge-Curator                                          |
|    3. Use acquired docs to guide execution                        |
|    4. Never rely solely on training data                          |
|                                                                   |
|  DEDICATED DOMAINS FOR SUPER-ADMIN:                               |
|    docs/official_docs/framework/     # Non-OpenCode framework tools |
|      +-- eslint/                                                  |
|      +-- typescript/                                              |
|      +-- git/                                                     |
|      +-- json-schema/                                             |
|      +-- nodejs/                                                  |
|    docs/official_docs/opencode/      # OpenCode official docs     |
|      +-- agents/         # Agent config guides                    |
|      +-- skills/         # Skill development                      |
|      +-- framework/      # Framework internals                    |
|      |   +-- source-analysis/  # Scout source-code findings       |
|      +-- mcp/            # MCP integration                        |
|      +-- deployment/     # Deployment guides                      |
|                                                                   |
|  LAYER 3 — SCOUT ESCALATION (via @Knowledge-Curator):             |
|    Trigger keywords: internally, how does X work, edge case,      |
|    source code, why does X behave, type narrowing, undocumented   |
|    Scout clones repos (e.g., anomalyco/opencode) and inspects     |
|    source → findings extracted to source-analysis/ as .md         |
|    TTL: 14 days (shorter than standard 30-day)                    |
|                                                                   |
|  BENEFITS:                                                        |
|    -> Accurate, version-matched documentation                     |
|    -> Fewer framework repair errors                               |
|    -> Reduced rework cycles                                       |
|    -> Full audit trail of information sources                     |
|                                                                   |
+------------------------------------------------------------------+
```

---

*Document Version: 1.6.0*  
*Saved to: docs/review/knowledge-management/uc7ks-design-analysis-v1.0.md*  

**Changes from v1.5.0 (Cross-Reference Remediation — 2026-06-05)**:
Resolved all 22 findings from `uc7ks-cross-reference-findings-v1.0.md`:

**HIGH fixes (3)**:
- F1: ✅ Already fixed in v1.4.0 — GitHub URL corrected to `https://github.com/anomalyco/opencode`
- F2: ✅ Already fixed in v1.4.0 — Subsection numbering corrected across §9-§12
- F3: Added websearch availability constraint note to §11.2 (already in §6.1); documented degradation to webfetch-only when `OPENCODE_ENABLE_EXA` not set

**MEDIUM fixes (8)**:
- F4: ✅ Already resolved — `opencode/` (official docs) and `framework/` (non-OpenCode tools) are separate concepts
- F5: ✅ Already fixed — Scout comparison note exists in §6.1 line 332
- F6: Clarified `agent_tools_blacklist` → OpenCode `permission.deny` mapping in UC7-004
- F7: Clarified `agent_tools_whitelist` → OpenCode `permission.allow` mapping + deprecation note in §6.2
- F8: ✅ Already fixed — `safe_*` tools marked as "(project-specific custom tool)" in §6.1
- F9: ✅ Already fixed — `dispatch_subagent` clarifying note in §4.2
- F10: ✅ Already fixed — UC7-003 uses `tool.execute.after` plugin hook (not unstaged-check)
- F11: **Added §4.3** "OpenCode Native Plugin Hook Integration" with 4-hook mapping table and complementary-relationship analysis

**LOW fixes (11)**:
- F12: `todowrite` permission note added to §6.1
- F13: `instructions` field alternative distribution mechanism added to §6.3
- F14: MCP tool naming convention clarified in §6.1
- F15: `opencode agent create` CLI reference added to §13 Phase 1
- F16: @Guardian role queries refined in §8.5
- F17: `tools` config deprecation (v1.1.1) noted in §6.1
- F18: ✅ Already fixed — `framework-enforcer.ts` clarifying note in §4.1
- F19: `external_directory` permission mapping added to §5.2
- F20: `subtask` command config alternative added to §6.2
- F21: Experimental LSP tool note added to §6.1
- F22: Blog source marked as ⚠️ unverified in §8.3

*Changes from v1.4.0: Integrated OpenCode built-in Scout subagent as Layer 3 source-analysis tier. Added §11.6 (Source Analysis Layer — Scout Integration) with knowledge acquisition funnel, trigger conditions, invocation protocol, and responsibility boundary. Updated: §2.2 directory structure (source-analysis/ subdirectories), §5.1 permission matrix (Scout dispatch column), §6.1 @Knowledge-Curator config (task tool + Scout permissions + core responsibilities), §7.3 Super-Admin knowledge domains (Scout column), §12 workflow diagrams (Scout escalation notes), §13 roadmap (Phase 5b: Scout Integration), Appendix traceability matrix (requirement #11), Appendix B quick reference (Layer 3 Scout).*