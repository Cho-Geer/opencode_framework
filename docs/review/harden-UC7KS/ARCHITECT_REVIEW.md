# UC7KS Hardening Implementation Plan — Architecture Design Review

**Reviewer**: @Architect  
**Plan Reviewed**: `IMPLEMENTATION_PLAN.md` v1.0.0  
**Analysis Reviewed**: `ANALYSIS_REPORT.md` v1.0.0  
**Review Date**: 2026-06-06  
**Review Type**: Design Review Gate — 7-Dimension Architecture Compliance  
**Status**: ⚠️ CONDITIONAL APPROVAL — 4 critical items must be resolved before any implementation begins

---

## Executive Summary

The implementation plan is **well-structured and architecturally sound in its core direction**, but contains **4 critical issues** that must be addressed before any code changes, plus **7 moderate concerns** and **4 cosmetic recommendations**. The plan correctly identifies the gaps in the UC7KS pipeline and proposes appropriate hardening measures. However, several proposed implementations contain concrete bugs, violate the project's own Templatization standards, and lack TDD coverage requirements required by the DAG generation standard.

---

## 1. Dimension-by-Dimension Review

### 1.1 Design Architecture (DA) — ⚠️ CONDITIONAL

| Task | Verdict | Details |
|------|---------|---------|
| T-H03 | ✅ PASS | Adding `state_management` as a 12th domain is the correct abstraction. The existing 11 domains legitimately miss machine.json/gate-state.json operations. The domain_id choice `state_management` aligns with existing naming conventions. |
| T-H08 | ⚠️ CONDITIONAL | `module_scope_declare` custom tool design is correct in concept. It creates a new step in the agent pipeline that maps to knowledge domains. However, see Issue CRIT-4 regarding `context.directory` path resolution. |
| T-H09 | ✅ PASS | `knowledge_cache_search` as an automated cache search tool is a correct architectural abstraction — it replaces manual `read` tool calls with a structured query interface against the index manifest. |
| T-H10 | ✅ PASS | `knowledge_gap_report` compares semantic_map domains against index.json entries. This is a necessary operational tool for @Meta-Planner and @Knowledge-Curator to determine cache refresh needs. |

**Architecture Verdict**: The proposed tool layer correctly follows the custom-tools.md convention (single file per tool with `tool()` helper, Zod schema for args, context object for session info). The tool naming follows the `domain_action` convention consistent with existing `safe_*` tools.

---

### 1.2 Hardened Enforcement (HE) — ⚠️ CONDITIONAL

| Task | Verdict | Details |
|------|---------|---------|
| T-H01 | ⚠️ CONDITIONAL | Schema extension is needed, but the plan's new schema definition **duplicates the existing `session_access` schema** already present in `machine.schema.json` (lines 697–723). The existing schema already defines `last_read_at`, `last_file_read`, `uc7_001_compliant`, and `total_cache_reads`. The plan must **extend** this existing schema with `declared_scope` and `cache_sufficiency`, not replace it. See Issue CRIT-1. |
| T-H05 | ⚠️ CONDITIONAL | The proactive UC7-001 blocking logic is architecturally correct: intercept write/edit/bash/webfetch BEFORE execution when scope is undeclared. However, the plan proposes adding this code to `framework-enforcer.ts` (the monolithic file), while the existing enforcement architecture has been partially modularized into `hooks/tool-execute.ts`. The plan should specify WHICH file receives the new code, and whether the modularized `toolExecuteBefore()` in `hooks/tool-execute.ts` should also carry this logic. See Issue MOD-1. |
| T-H06 | ⚠️ CONDITIONAL | The cache sufficiency check (UC7-001b) fills a genuine gap: an agent could currently read the cache index, get `uc7_001_compliant: true`, and still make external queries without declaring WHY the cache was insufficient. The plan's approach is correct. However, the proposed implementation has a **logical race condition**: both `uc7ks-enforcer.ts` and `framework-enforcer.ts` independently read `machine.json`, and T-H05 adds _another_ independent reader. See Issue MOD-2. |
| T-H07 | 🔴 FAIL | The pre-execution hook UC7KS gate contains an **absolute path leak** violation: `/home/zhaoge/.bun/bin/bun`. This violates `project.config.json` → `path_lint.leak_patterns` (Linux home pattern). Additionally, the code uses `require()` to load JSON which requires Node.js `--experimental-json-modules` or special handling. Using `require()` for JSON is deprecated. See Issue CRIT-2. |
| T-H11 | ✅ PASS | Policies integration is a pure configuration change with no code dependencies. The migration from `disabled_providers`/`enabled_providers` to `experimental.policies` is forward-looking and aligns with OpenCode v1.16 direction. |

**Enforcement Verdict**: The 4-layer defense architecture (preamble → uc7ks-enforcer.ts → framework-enforcer.ts → pre-execution hook) is correctly maintained. The proposed hardening adds proactive blocking at layers 2 and 3 without removing existing reactive detection. However, the concrete implementation in T-H07 is broken as written, and the state-reading race condition across multiple enforcers needs resolution.

---

### 1.3 Harness System (HS) — ✅ PASS

| Task | Verdict | Details |
|------|---------|---------|
| T-H02 | ✅ PASS | The preamble Step 0 expansion from a 5-line instruction to a formal 3-stage protocol (0a→0b→0c) correctly formalizes the module-scope-declaration→cache-search→cache-sufficiency-check sequence. The violation codes (CAT-SCOPE-01, CAT-KNOW-01, UC7-002) provide traceable references for enforcement hooks. The existing Steps 1-7 are preserved. |
| T-H07 | ⚠️ CONDITIONAL | Stage 2.5 additions to `pre-execution-hook.sh` are architecturally correct as an OS-level enforcement layer, but contain implementation bugs (see CRIT-2). |

**Harness Verdict**: The protocol formalization is correct. The harness system correctly layers enforcement from instruction (preamble) → plugin (runtime) → shell script (OS-level). 

However, one significant concern: the expanded preamble in T-H02 **hardcodes Native stack technology names** (e.g., "NestJS controllers, endpoints, DTOs" for `backend_api`, "Angular components, signals, stores" for `frontend_ui`). This **violates the Templatization dimension** — the preamble should be stack-agnostic to support the COMPATIBILITY_PROFILE's `compatible`/`partial`/`minimal` conformance levels. See Issue MOD-3.

---

### 1.4 Permission Matrix (PM) — ✅ PASS

| Task | Verdict | Details |
|------|---------|---------|
| T-H11 | ✅ PASS | `experimental.policies` adds a provider.use permission layer above existing tool-level permissions. This correctly implements the principle of layered access control: provider policy (upstream) → tool scopes (midstream) → write scopes (downstream). |
| T-H12 | ✅ PASS | The `safe_shell.agent_allowlists` extension for `opencode` CLI commands follows the existing pattern. The agent-to-command mapping is correctly scoped: @CI-CD-Agent gets MCP auth commands, @Super-Admin gets debug commands, @Guardian gets read-only list. |

**Permission Verdict**: No issues. The permissions remain properly layered and the allowlist extensions are appropriately scoped per agent role.

---

### 1.5 Multi-Agent System (MAS) — ⚠️ CONDITIONAL

| Task | Verdict | Details |
|------|---------|---------|
| T-H05 | ✅ PASS | The @Knowledge-Curator exemption is correctly preserved. Blocking @KC's external queries would create a deadlock — the plan correctly exempts it. |
| T-H14 | ⚠️ CONDITIONAL | The integration smoke test is assigned to @Guardian, but @Guardian's `agent_write_scopes` (project.config.json line 553-568) **denies** write access to `.opencode/**`. The test scenarios (verify UC7-001 blocking in strict/locked mode) require modifying enforcement mode in `project.config.json` which @Guardian cannot write to. See Issue MOD-4. |

**Multi-Agent Verdict**: Agent role boundaries are correctly respected in the plan's dependencies. The T-H14 agent assignment needs adjustment.

---

### 1.6 Central State Management (CSM) — ⚠️ CONDITIONAL

| Task | Verdict | Details |
|------|---------|---------|
| T-H01 | ⚠️ CONDITIONAL | The new `declared_scope` and `cache_sufficiency` fields are correctly placed under `knowledge_cache_state.session_access.{agent}`. However, the plan's schema definition duplicates existing fields. The `machine.json` bootstrapping must preserve existing state — the plan correctly mentions atomic write (tmp→rename) but doesn't specify a migration strategy for existing `session_access` data. See CRIT-1. |
| T-H05/T-H06 | ⚠️ CONDITIONAL | Multiple enforcers independently reading and writing `machine.json.knowledge_cache_state` creates a potential race condition. The `framework-enforcer.ts` uses atomic write (tmp→rename), but `uc7ks-enforcer.ts` reads the file separately. If T-H05 writes `declared_scope` and T-H06 reads it immediately after, the read may see stale data. See MOD-2. |

**State Management Verdict**: The state schema extension is needed, but the existing schema must be extended, not replaced. The multi-writer race condition is a moderate concern under concurrent agent operations.

---

### 1.7 Templatization & Parameterization (TP) — 🔴 FAIL

| Task | Verdict | Details |
|------|---------|---------|
| T-H02 | 🔴 FAIL | The expanded preamble Step 0a lists all 11 domains with **Native stack technology names** hardcoded: "NestJS controllers, endpoints, DTOs", "Angular components, signals, stores", "Prisma, migrations, schema", "Redis, ioredis", "BullMQ, jobs, workers". This violates the Templatization principle — the preamble must remain stack-agnostic as defined by `COMPATIBILITY_PROFILE.md` conformance levels. A `compatible` stack (React+Express) or `partial` stack (Vue+Django) would find these descriptions misleading or incorrect. See Issue CRIT-3. |
| T-H04 | ✅ PASS | Adding `knowledge.fallback_url_state` and `knowledge.fallback_url_machine` to `template_resolution` follows the existing pattern. However, the naming convention `knowledge.fallback_url_{tech}` is used by existing entries (e.g., `knowledge.fallback_url_nestjs`, `knowledge.fallback_url_prisma`). The plan's proposed names use `_state` and `_machine` which are domain identifiers, not tech names. This is acceptable but inconsistent. |

**Templatization Verdict**: The hardcoded tech stack descriptions in the proposed preamble (T-H02) are a **blocking issue**. The preamble is the single most widely-injected document in the framework — it must remain portable across all conformance levels.

---

## 2. Critical Issues (Must Fix Before Implementation)

### 🔴 CRIT-1: T-H01 Schema Duplication with Existing `session_access`

**Location**: T-H01 proposed schema vs. `machine.schema.json` lines 697–723

**Problem**: The plan's T-H01 proposes adding a new `knowledge_cache_state` schema that duplicates the already-existing `session_access` sub-schema (with fields `last_read_at`, `last_file_read`, `uc7_001_compliant`, `total_cache_reads`). The existing schema at line 697 already defines `session_access` as an `additionalProperties` object with `required: ["last_read_at", "uc7_001_compliant"]`.

**What Must Change**:
1. The plan must acknowledge that `knowledge_cache_state` and `session_access` already exist in the schema
2. T-H01 must be reframed as an **extension** task, not a creation task
3. Only two new fields need to be added to the existing `session_access` schema:
   - `declared_scope` (string, nullable) — the agent's declared module domain ID
   - `cache_sufficiency` (object with `status`, `missing_topics`, `declared_at`) — the agent's cache sufficiency declaration

**Recommended**: Update T-H01's DoD to:
- [ ] Verify existing `knowledge_cache_state.session_access` schema structure
- [ ] Add `declared_scope` field to `session_access.additionalProperties.properties`
- [ ] Add `cache_sufficiency` field to `session_access.additionalProperties.properties`
- [ ] Add `external_fetches` and `uc7ks_violations` counters to `knowledge_cache_state.compliance`
- [ ] Do NOT redefine `last_read_at`, `last_file_read`, `uc7_001_compliant`, `total_cache_reads`

---

### 🔴 CRIT-2: T-H07 Absolute Path Leak + `require()` Anti-Pattern

**Location**: T-H07 proposed shell code, lines identifying `/home/zhaoge/.bun/bin/bun`

**Problem 1 — Path Leak**: The proposed implementation uses:
```bash
UC7KS_COMPLIANT=$(/home/zhaoge/.bun/bin/bun -e "...")
```
This is an absolute path leak that violates `project.config.json` → `path_lint.leak_patterns` ("Linux home" pattern: `/home/`). The `framework-self-test.js` Check 19 would flag this.

**Problem 2 — JSON `require()`**: The inline Bun script uses `require()` to load JSON:
```javascript
const m = require('${PROJECT_ROOT}/.opencode/state/machine.json');
```
While Bun supports `require()` for JSON, this pattern is fragile (path resolution, special characters in PROJECT_ROOT). The standard approach used throughout the codebase is `JSON.parse(fs.readFileSync(...))`.

**Problem 3 — Enforcement Mode Resolution**: The hook already has an enforcement mode resolution block (lines 36-50) that reads `template_resolution.enforcement_mode`. But since FW-HARNESS-P6, the config uses `develop_enforcement_mode` + `runtime_enforcement_mode` (dual-key design), not a single `enforcement_mode` key. The existing code on line 43 reads `template_resolution?.enforcement_mode` which may be undefined, causing fallback to `advisory`.

**What Must Change**:
1. Replace `/home/zhaoge/.bun/bin/bun` with `bun` or `which bun` (the PATH-resolved binary)
2. Replace `require()` with `JSON.parse(await Bun.file(path).text())` or `JSON.parse(fs.readFileSync(path, 'utf8'))`
3. Fix the enforcement mode resolution to use dual-key design: `develop_enforcement_mode || runtime_enforcement_mode`

---

### 🔴 CRIT-3: T-H02 Preamble Hardcodes Native Stack Technology Names

**Location**: T-H02 proposed Step 0a, domain descriptions

**Problem**: The proposed preamble's Step 0a lists 11 domains with Native stack-specific descriptions:
```
- backend_api (NestJS controllers, endpoints, DTOs)
- persistence (Prisma, migrations, schema)
- frontend_ui (Angular components, signals, stores)
- caching (Redis, ioredis, cache patterns)
- queue (BullMQ, jobs, workers)
```

The preamble is injected into **every sub-agent prompt** and must remain portable across all `COMPATIBILITY_PROFILE` conformance levels (`compatible`, `partial`, `minimal`). A project using React + Express + SQLAlchemy would receive misleading domain descriptions.

**Impact**: Violates §5 (Templatization & Parameterization) of the 7-dimension architecture. The preamble is the most widely distributed document — all 8 agents receive it.

**What Must Change**: Use **stack-agnostic domain descriptions** based on the `domain_id` and `keywords` from `knowledge_semantic_map`, not the specific technologies:
```markdown
1. Identify the module from the 11 (→12 after T-H03) knowledge domains
   defined in .opencode/project.config.json → knowledge_semantic_map:
   - backend_api (API controllers, endpoints, DTOs, middleware)
   - persistence (database ORM, schema, migrations, models)
   - frontend_ui (components, state management, styling, routing)
   - caching (cache engine, cache patterns, TTL management)
   - queue (job queues, workers, message scheduling)
   ...
```

The detailed technology mapping already exists in `knowledge_semantic_map.domains[].keywords` — the preamble should reference this, not duplicate it.

---

### 🔴 CRIT-4: T-H08 `module_scope_declare` — `context.directory` Path Resolution

**Location**: T-H08 proposed implementation, `args.context.directory`

**Problem**: The proposed tool implementation uses `context.directory` to locate `project.config.json`:
```typescript
const configPath = `${directory}/.opencode/project.config.json`;
```

Per the official custom-tools.md documentation (§Context), the `context` object provides `directory` and `worktree`. However:
1. The relationship between `context.directory` and `OPENCODE_ROOT` is not documented
2. If `context.directory` is the agent's `cwd` and the agent is operating in a subdirectory, the path concatenation would fail
3. The existing plugins use `process.env.OPENCODE_ROOT || process.cwd()` for project root resolution

**What Must Change**: Use the same project root resolution pattern as `uc7ks-enforcer.ts`:
```typescript
const projectRoot = process.env.OPENCODE_ROOT || context.directory;
const configPath = path.resolve(projectRoot, ".opencode/project.config.json");
```

Alternatively, use `context.worktree` which per the docs is the "git worktree path" — typically the project root.

---

## 3. Moderate Concerns (Should Fix Before or During Phase 0)

### 🟡 MOD-1: T-H05 File Location Ambiguity

The plan adds proactive UC7-001 blocking to "framework-enforcer.ts" but the enforcement codebase has been partially modularized into `hooks/tool-execute.ts` (which already handles write-tool enforcement). 

**Recommendation**: Specify the target insertion point precisely. If adding to `framework-enforcer.ts`, specify the line range relative to the existing `tool.execute.before` hook section. If adding to `hooks/tool-execute.ts`, reference the `toolExecuteBefore()` function signature and indicate placement before the Super-Admin bypass check.

---

### 🟡 MOD-2: Multi-Enforcer Race Condition on `machine.json`

Both `uc7ks-enforcer.ts` and `framework-enforcer.ts` independently read and write `machine.json.knowledge_cache_state`. With T-H05 adding proactive write blocking that also reads this state, three separate code paths parse the same JSON file on every tool invocation.

**Impact**: In concurrent sub-agent scenarios, writes from one enforcer could be overwritten by a stale read from another.

**Recommendation**: 
1. Short-term: Add a note in T-H05/T-H06 that both enforcers use the atomic write pattern (tmp→rename) already present in `framework-enforcer.ts` line 1082-1084
2. Long-term: Consider extracting `knowledge_cache_state` read/write into a shared utility, following the pattern of `gate-core.ts` for enforcement mode access. This is out of scope for this plan but should be logged as technical debt.

---

### 🟡 MOD-3: T-H04 `template_resolution` Key Naming Inconsistency

The plan proposes `knowledge.fallback_url_state` and `knowledge.fallback_url_machine`. Existing keys follow the pattern `knowledge.fallback_url_{tech_name}` (e.g., `nestjs`, `prisma`, `angular`, `redis`). The new keys use domain identifiers (`state`, `machine`) rather than technology names.

**Recommendation**: Use `knowledge.fallback_url_opencode_state` for OpenCode state management docs and `knowledge.fallback_url_json_schema` for JSON Schema docs (which the `state_management` domain would primarily reference). Or, rename to `knowledge.fallback_url_state_management` if a single catch-all URL is preferred.

---

### 🟡 MOD-4: T-H14 @Guardian Cannot Modify Enforcement Mode

The integration smoke test requires testing across advisory/strict/locked modes, which requires modifying `project.config.json` → `template_resolution.develop_enforcement_mode`. @Guardian's `agent_write_scopes` **denies** access to `.opencode/**` (line 563-564 of `project.config.json`).

**Recommendations** (pick one):
1. **Preferred**: Split T-H14 into two tasks: T-H14a (@Super-Admin: configure enforcement modes) and T-H14b (@Guardian: execute test scenarios and report)
2. **Alternative**: Add a temporary allowlist entry for T-H14 testing, removed after completion
3. **Alternative**: Use `ENFORCEMENT_MODE` environment variable override for test execution, which does not require file writes

---

### 🟡 MOD-5: Missing State Transition Records

The plan adds new fields to `machine.json.knowledge_cache_state` but does not specify how these state changes should be tracked in `machine.json.compliance_records`. The existing `enforcement_transitions` pattern should be extended to include `knowledge_cache` transitions (scope declarations, cache sufficiency declarations).

**Recommendation**: Add to T-H01 DoD: ensure `compliance_records` includes a `knowledge_cache` section structured similarly to `enforcement_transitions` for audit trail.

---

### 🟡 MOD-6: T-H08 `module_scope_declare` Key Mismatch in `machine.json`

The tool writes to `sa[agent] = sa[agent] || sa[agentKey] || {}` and then sets `sa[agent].declared_scope`. However, the write uses `sa[agent]` (the `agent` variable from `process.env.FRAMEWORK_AGENT`), while the read in T-H05 uses `kcs?.session_access?.[agent] || kcs?.session_access?.[agentKey]`. If `FRAMEWORK_AGENT` is `@Architect` (with `@` prefix) and the read strips the `@`, the key lookup would fail.

**Recommendation**: Standardize the agent key format. Either always use the `@`-prefixed form or always strip it. The existing code in `framework-enforcer.ts` uses the raw `agent` variable (which comes from `FRAMEWORK_AGENT` env var), while `uc7ks-enforcer.ts` also uses it raw. **Add a note to T-H08**: normalize the agent key to match the format used by `framework-enforcer.ts` and `uc7ks-enforcer.ts`.

---

### 🟡 MOD-7: T-H06 UC7-001b — Fallback When `cache_sufficiency` is Absent

The proposed T-H06 code checks:
```typescript
if (sufficiencyStatus !== "insufficient") {
  throw new Error(...);
}
```

This would **block agents that have read the cache and found it sufficient** (i.e., `sufficiencyStatus === "sufficient"`). The intent is to block external queries when the agent HASN'T declared insufficiency, but the logic also blocks agents that have correctly declared the cache as sufficient.

**Recommendation**: The check should be:
```typescript
// Block only if cache was NOT sufficient AND agent hasn't declared what's missing
if (sufficiencyStatus !== "sufficient" && sufficiencyStatus !== "insufficient") {
  // Block: agent neither found cache sufficient nor declared what's missing
}
```

OR, add a third state `"undeclared"` as the default, and only block on `"undeclared"`.

---

## 4. Cosmetic Issues (Nice-to-Fix)

### 🟢 COS-1: T-H13 Check Numbering

The plan proposes Check 21, 22, 23. Verify the current `framework-self-test.js` last check number to avoid collisions. As of this review, the existing checks go up to at least Check 19 (path_lint) and Check 20 (knowledge_cache_state). The plan should confirm the next available number.

### 🟢 COS-2: T-H09/T-H10 Implementation Detail

Both tasks are light on implementation detail compared to T-H08. T-H09's DoD says "Returns structured hit/miss report" but doesn't define the structure. T-H10 says "Returns per-domain: cached_count, missing_topics, last_updated" which is clearer. Add similar specificity to T-H09.

### 🟢 COS-3: T-H05 Violation Message

The proposed proactive block message reads:
```
"Agent \"${agent}\" blocked: no module scope declared AND no cache read completed."
```

This could be more actionable. The preamble's Step 0b provides better guidance. Recommend:
```
"Agent \"${agent}\" blocked: must declare module scope (Step 0a) then read docs/official_docs/index.json (Step 0b) before code modifications."
```

### 🟢 COS-4: Phase 2 Tool Count

The plan's overview (§1.1) says "Add 4 knowledge-pipeline tools" but Phase 2 defines only 3 (T-H08, T-H09, T-H10). The ANALYSIS_REPORT.md §3.2 lists a 4th tool `enforcement_mode_query` that is not included in the implementation plan. Either add it as a task or update the overview count.

---

## 5. Sequencing & Dependency Analysis

### 5.1 Phase Order: ✅ CORRECT

The four-phase structure (Foundation → Core Hardening → Tooling → Validation) follows the correct dependency order:
- Phase 0 establishes the schema and preamble that all other phases depend on
- Phase 1 hardens enforcement using the state fields defined in Phase 0
- Phase 2 builds automation tools on top of the hardened enforcement
- Phase 4 validates the complete pipeline

### 5.2 Dependency Graph: ✅ LARGELY CORRECT

The plan's §4 dependency graph correctly identifies:
- T-H01 as the foundation for T-H02, T-H05, and T-H08
- T-H05 → T-H06 → T-H07 sequential dependency
- T-H08 → T-H09 → T-H10 sequential dependency
- T-H03/T-H04 and T-H11/T-H12 as parallel execution paths

### 5.3 Missing Dependencies

| Missing Dependency | From | To | Reason |
|-------------------|------|-----|--------|
| T-H02 → T-H06 | preamble Step 0c | uc7ks-enforcer sufficiency check | T-H06 checks `cache_sufficiency.status` which is populated by agents following Step 0c of the preamble. The preamble must define the protocol before the enforcer can enforce it. |
| T-H03 → T-H02 | semantic_map domain IDs | preamble domain list | T-H02 lists domain IDs. If T-H03 adds a 12th domain, T-H02 should list all 12, not 11. Current dependency graph shows T-H02 depends on T-H01, but the domain list should come from T-H03. See Issue SEQ-1 below. |

### 🔴 SEQ-1: T-H02 Preamble Domain Count Dependency

**Problem**: T-H02 depends on T-H01 (schema) but also implicitly depends on T-H03 (semantic map domain count). The preamble's Step 0a lists "11 domains" but after T-H03 there will be 12. If T-H02 is executed before T-H03, the preamble will have an incorrect count.

**Recommendation**: Either:
1. Make T-H02 depend on BOTH T-H01 and T-H03 (serialize them)
2. Or make T-H02 use a generic reference ("the knowledge domains defined in .opencode/project.config.json → knowledge_semantic_map") instead of a hardcoded count. This is the preferred approach.

---

## 6. Risk Assessment

### 6.1 Risks Correctly Identified in Plan

The plan's §5.1 risk matrix correctly identifies:
- Proactive blocking impact (mitigated by mode-gating)
- Schema migration risk (mitigated by atomic write)
- Naming collisions (correctly assessed as low)

### 6.2 Unlisted Risks

| Risk | Likelihood | Impact | Description |
|------|-----------|--------|-------------|
| **R1: Stale `uc7_001_compliant`** | Medium | Medium | Once an agent reads the cache once, `uc7_001_compliant` is permanently `true`. If the cache is later updated with new docs, the agent has no signal to re-read. The `cache_sufficiency` mechanism partially addresses this but only for the "insufficient" path. Agents that found the cache sufficient may miss subsequent cache updates. |
| **R2: T-H05 + T-H06 Double Blocking** | Low | Medium | T-H05 blocks writes when scope is undeclared. T-H06 blocks external queries when `cache_sufficiency` is undeclared. If both trigger simultaneously, the agent receives TWO blocking errors, which may be confusing. The error messages should be distinct and guide the agent through the correct sequence. |
| **R3: Custom Tool Registration Failure** | Low | High | The 4 new custom tools (3 in plan, 1 in analysis) must be registered in the framework. If `.opencode/tools/` directory conventions change or the `tool()` API changes across OpenCode versions, all tools silently fail. The plan should add a dependency on verifying the OpenCode version compatibility. |
| **R4: `opencode.json` Policies + Existing Provider Config Conflict** | Medium | Medium | T-H11 deprecates `disabled_providers`/`enabled_providers` in favor of `experimental.policies`. If the current `opencode.json` has active provider restrictions, the migration must preserve them or risk breaking provider access. |

### 6.3 Risk Mitigation Recommendations

- **R1**: Add a `last_index_updated` timestamp comparison. If the index.json `last_updated` is newer than the agent's `last_read_at`, set `uc7_001_compliant: false` to force re-read.
- **R2**: Ensure T-H05's error message says "Go to Step 0a" and T-H06's says "Go to Step 0c" with distinct violation codes.
- **R3**: Add to Phase 4 (T-H13 or new task): verify all custom tools load correctly by checking they appear in the tool registry.
- **R4**: Add to T-H11 DoD: audit current `opencode.json` for existing provider configuration before migration.

---

## 7. TDD Compliance Gap

### 🔴 Issue: No RED-Phase Tasks

The plan defines 14 tasks, all of which are implementation (GREEN) or validation (post-GREEN). Per the DAG generation standard (§G3: "测试独立 — 每个业务模块必须有独立的测试任务"), and the TDD iron law (RED → GREEN → REFACTOR), **each implementation task requires a corresponding RED-phase test task**.

**Missing Test Tasks**:

| Implementation Task | Required RED Task | What to Test |
|---------------------|-------------------|-------------|
| T-H01 | T-H01-TEST | Schema validation: new fields accept correct types, reject incorrect types |
| T-H02 | T-H02-TEST | Preamble Step 0a/0b/0c parsing: verify protocol stages are parseable by dispatch-subagent.js |
| T-H05 | T-H05-TEST | Proactive blocking: verify write is blocked when scope undeclared, allowed when declared |
| T-H06 | T-H06-TEST | Cache sufficiency: verify external query blocked when sufficiency undeclared |
| T-H08 | T-H08-TEST | module_scope_declare: verify returns correct domain routing, writes to machine.json |

**Recommendation**: Add RED-phase test tasks before each implementation task, OR explicitly document why certain tasks are exempt from TDD (e.g., pure configuration changes T-H03, T-H04, T-H11, T-H12 may qualify for exemption since they don't contain executable logic).

At minimum, T-H05, T-H06, T-H08, T-H09 need corresponding test tasks as they contain executable logic.

---

## 8. Implementation Prerequisites

Before any task begins, the following must be in place:

1. [ ] **OpenCode version check**: Verify the running OpenCode version supports `experimental.policies` (v1.16+). The `custom-tools.md` was fetched on 2026-06-05 but the `tool()` API may have version-specific behavior.
2. [ ] **Backup current state**: `cp .opencode/state/machine.json .opencode/state/machine.json.pre-uc7ks-harden`
3. [ ] **Backup preamble**: `cp .opencode/subagent-preamble.md .opencode/subagent-preamble.md.pre-harden`
4. [ ] **Verify @Arbiter approval**: Locked mode and enforcement mode changes require @Arbiter sign-off per enforcement-modes-standard.md §5.2
5. [ ] **Drain stale gate sessions**: Run `compliance_gate_drain_stale` before beginning to ensure clean state
6. [ ] **Verify framework-self-test.js passes**: All existing checks must pass before modifications begin

---

## 9. Summary Verdict

| Dimension | Verdict | Critical Issues |
|-----------|---------|-----------------|
| Design Architecture | ⚠️ CONDITIONAL | T-H04 naming inconsistency |
| Hardened Enforcement | ⚠️ CONDITIONAL | CRIT-1 (schema duplication), CRIT-2 (path leak), MOD-1 (code location), MOD-2 (race condition) |
| Harness System | ⚠️ CONDITIONAL | CRIT-2 (path leak), MOD-3 (tech stack hardcoding) |
| Permission Matrix | ✅ PASS | — |
| Multi-Agent System | ⚠️ CONDITIONAL | MOD-4 (T-H14 agent assignment) |
| Central State Management | ⚠️ CONDITIONAL | CRIT-1 (schema), MOD-2 (race condition), MOD-5 (missing audit trail) |
| Templatization | 🔴 FAIL | CRIT-3 (T-H02 hardcoded tech stack in preamble) |

**Overall Verdict**: ⚠️ **CONDITIONAL APPROVAL** — The plan's architectural direction is correct and all 7 dimensions are addressed. However, **4 critical issues must be resolved** before any implementation begins. Once CRIT-1 through CRIT-4 are addressed, the plan can proceed to implementation with attention to the 7 moderate concerns.

**Next Step**: Return to @Super-Admin for plan revision addressing CRIT-1 through CRIT-4, then re-submit for @Arbiter approval.

---

## 10. Required Plan Changes (Action Items for @Super-Admin)

1. **[CRIT-1]** T-H01: Reframe as schema extension (not creation). Reference existing `session_access` schema at `machine.schema.json:697-723`. Only add `declared_scope` and `cache_sufficiency` fields.
2. **[CRIT-2]** T-H07: Replace `/home/zhaoge/.bun/bin/bun` with `bun` (PATH-resolved). Replace `require()` with `JSON.parse(fs.readFileSync(..., 'utf8'))`. Fix enforcement mode to use dual-key design.
3. **[CRIT-3]** T-H02: Replace hardcoded Native stack technology descriptions with stack-agnostic domain descriptions using generic terminology.
4. **[CRIT-4]** T-H08: Use `process.env.OPENCODE_ROOT || context.worktree` for project root resolution instead of bare `context.directory`.
5. **[SEQ-1]** T-H02: Add dependency on T-H03 or use generic domain count reference.
6. **[MOD-7]** T-H06: Fix the cache sufficiency check logic to handle the `"sufficient"` case correctly.
7. **[TDD]** Add RED-phase test tasks for T-H05, T-H06, T-H08, T-H09 (implementation tasks with executable logic).

---

*Architect Review: v1.0.0 — 2026-06-06*  
*Review follows UC7KS pipeline: local cache searched → preamble Step 0b → compliance gate → analysis*
