# UC7KS Hard Constraint + Framework Optimization — Implementation Plan

**Created**: 2026-06-06  
**Author**: @Super-Admin  
**Based on**: `ANALYSIS_REPORT.md` (same directory)  
**Status**: Draft — Pending @Architect Review + @Arbiter Approval  
**Conventions**: OpenCode multi-agent framework, DAG-driven, TDD enforced, compliance-gate lifecycle  
**References**:
- `AGENTS.md` — multi-agent collaboration spec
- `.opencode/rules/rule_detail/TEMPLATE_VARIABLE_STANDARD.md` — placeholder standards
- `.opencode/rules/rule_detail/enforcement-modes-standard.md` — advisory/strict/locked modes
- `.opencode/rules/rule_detail/dag-generation-standard.md` — DAG planning rules
- `.opencode/rules/rule_detail/state-machine-standard.md` — state machine transition rules

---

## 1. Overview

### 1.1 Scope

This plan covers the formalization and physical enforcement of the UC7KS (Universal Context7-First Knowledge System) pipeline as a **hard constraint** across all agents, plus activation of three underutilized OpenCode framework capabilities:

| # | Optimization Area | Current State | Target State |
|---|-------------------|--------------|--------------|
| 1 | UC7KS Hard Constraint | Instruction-level only (preamble text) | Physically enforced via plugin hooks |
| 2 | policies.md (provider control) | Completely unused | Integrated into locked mode enforcement |
| 3 | custom-tools.md (knowledge tools) | Only safe_* tools exist | Add 4 knowledge-pipeline tools |
| 4 | cli.md (CLI integration) | No agent uses CLI | Integrate into @Super-Admin, @CI-CD-Agent |

### 1.2 Architecture Dimensions Covered

All tasks align with the seven architecture dimensions:
- **DA** — Design Architecture
- **HE** — Hardened Enforcement Constraint  
- **HS** — Harness System
- **PM** — Permission Matrix
- **MAS** — Multi-Agent System
- **CSM** — Central State Management
- **TP** — Templatization & Parameterization

### 1.3 Enforcement Mode Considerations

| Mode | Behavior |
|------|----------|
| `advisory` | All changes log-only — no physical blocking. Safe for development. |
| `strict` | UC7-001 enforced before code writes. External queries blocked if cache not searched. |
| `locked` | Full enforcement + policies provider restriction. No waivers accepted. |

---

## 2. Phase Breakdown

```
Phase 0 — Pre-Flight (P0)      4 tasks   Foundation: state schema, preamble, semantic map
Phase 1 — Core Hardening (P0)   3 tasks   UC7-001 proactive blocking, module scope protocol
Phase 2 — Tooling (P1)          3 tasks   Custom tools + knowledge search automation
Phase 3 — Policies + CLI (P2)   2 tasks   Provider policies + CLI allowlist
Phase 4 — Validation (P2)       2 tasks   Self-test updates, integration testing
                                 ─────
                            Total: 14 tasks
```

---

## 3. Detailed Task Definitions

---

### Phase 0 — Pre-Flight (P0 Foundation)

---

#### T-H01: machine.json Schema Extension — knowledge_cache_state

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P0 |
| **Architecture Dimensions** | CSM, HE |
| **Dependencies** | None |

**What**: Extend `.opencode/state/machine.schema.json` to add formal schema for the `knowledge_cache_state` subtree that framework-enforcer.ts already writes to.

**Target Files**:
- `.opencode/state/machine.schema.json` — add `knowledge_cache_state` schema
- `.opencode/state/machine.json` — add `knowledge_cache_state` section with defaults

**New Schema Fields**:
```jsonc
{
  "knowledge_cache_state": {
    "type": "object",
    "properties": {
      "session_access": {
        "type": "object",
        "additionalProperties": {
          "type": "object",
          "properties": {
            "last_read_at": { "type": ["string", "null"] },
            "last_file_read": { "type": ["string", "null"] },
            "uc7_001_compliant": { "type": "boolean" },
            "total_cache_reads": { "type": "integer" },
            "declared_scope": { "type": ["string", "null"] },
            "cache_sufficiency": {
              "type": "object",
              "properties": {
                "status": { "enum": ["sufficient", "insufficient", "undeclared"] },
                "missing_topics": { "type": "array", "items": { "type": "string" } },
                "declared_at": { "type": ["string", "null"] }
              }
            }
          }
        }
      },
      "compliance": {
        "type": "object",
        "properties": {
          "cache_hits": { "type": "integer" },
          "cache_misses": { "type": "integer" },
          "external_fetches": { "type": "integer" },
          "uc7ks_violations": { "type": "integer" }
        }
      }
    }
  }
}
```

**Definition of Done**:
- [ ] `machine.schema.json` updated with `knowledge_cache_state` schema
- [ ] `machine.json` bootstrapped with default `knowledge_cache_state` values
- [ ] `framework-self-test.js` passes (no schema validation errors)
- [ ] Pre-commit hook passes

---

#### T-H02: subagent-preamble.md — Formalize Step 0a/0b/0c

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P0 |
| **Architecture Dimensions** | HS, HE |
| **Dependencies** | T-H01 |

**What**: Replace the current 5-line Step 0 instruction with a formal three-stage protocol (Step 0a → 0b → 0c) that defines the precise sequence of module-scope-declaration → cache-search → cache-sufficiency-check.

**Target File**:
- `.opencode/subagent-preamble.md` — replace Step 0 lines 10-23

**Current Step 0 (10 lines)**:
```markdown
### Step 0: UC7KS Knowledge Cache Check (P0 HARD CONSTRAINT — BEFORE COMPLIANCE GATE)
...
```

**New Step 0 (3 stages)**:
```markdown
### Step 0a: Module Scope Declaration (P0 HARD CONSTRAINT — BEFORE COMPLIANCE GATE)

Before ANY analysis, design, coding, or external query:

1. **Identify the module**: Determine which knowledge domain your task targets
   from the 11 domains in `.opencode/project.config.json` → `knowledge_semantic_map`:
   - `backend_api` (NestJS controllers, endpoints, DTOs)
   - `persistence` (Prisma, migrations, schema)
   - `frontend_ui` (Angular components, signals, stores)
   - `caching` (Redis, ioredis, cache patterns)
   - `queue` (BullMQ, jobs, workers)
   - `testing` (Jest, Playwright, Supertest)
   - `auth_security` (JWT, Passport, guards, rate-limit)
   - `framework_tools` (ESLint, Prettier, TypeScript, hooks)
   - `devops_ci` (Docker, GitHub Actions, pipelines)
   - `opencode_framework` (agent configs, rules, skills, plugins)
   - `infrastructure` (git, JSON Schema, Node.js, shell)

2. **Report the scope** in your plan presentation (Step 3).

**VIOLATION**: In strict/locked mode, writing code without a declared scope is
blocked by framework-enforcer.ts. See CAT-SCOPE-01.

### Step 0b: Local Cache Search (P0 HARD CONSTRAINT — BEFORE COMPLIANCE GATE)

1. **Search local cache**: Read `docs/official_docs/index.json` and search entries
   for topic/technology matches relevant to your declared module scope.
2. **Read cached docs**: If matches found, read the cached files via the `read` tool.
3. **Cache sufficient?** → Proceed to Step 1 (compliance gate).
   **Do NOT query external sources.**
4. **Cache insufficient?** → Proceed to Step 0c.

**VIOLATION**: Proceeding to compliance_gate_check without completing this cache
search is a CAT-KNOW-01 violation. In strict/locked mode, physically blocked by
pre-execution-gate.js AND tool.execute.before in framework-enforcer.ts.

### Step 0c: Cache Sufficiency Declaration (P0 HARD CONSTRAINT)

1. **Declare insufficiency**: If local cache is insufficient, declare specifically
   what is missing (e.g., "Missing: NestJS Guard implementation pattern v11").
2. **Request @Orchestrator**: Report the specific missing topics and request
   @Knowledge-Curator dispatch.
3. **Wait for caching**: Do NOT proceed with the task using training data alone.
4. **Re-read cache**: After @Knowledge-Curator completes, re-read the newly
   cached documents from `docs/official_docs/`.

**VIOLATION**: Making external queries without declaring cache insufficiency
is blocked by uc7ks-enforcer.ts in strict/locked mode (UC7-002 violation).
```

**Definition of Done**:
- [ ] Step 0 split into Step 0a/0b/0c with formal protocol
- [ ] All 11 domains listed for agent reference
- [ ] Violation codes (CAT-SCOPE-01, CAT-KNOW-01, UC7-002) documented
- [ ] Pre-existing compliance gate flow preserved (Steps 1-7 unchanged)
- [ ] `framework-self-test.js` Check 17 passes (no UNRESOLVED placeholders)

---

#### T-H03: knowledge_semantic_map — Add 12th Domain + Enrich Keywords

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P0 |
| **Architecture Dimensions** | TP, DA |
| **Dependencies** | None |

**What**: Review and enrich the 11 existing domains in `knowledge_semantic_map` and add a 12th domain for "state_management" covering machine.json / gate-state.json operations.

**Target File**:
- `.opencode/project.config.json` → `knowledge_semantic_map.domains[]`

**Changes**:
- Add 12th domain: `state_management` — keywords: `machine.json`, `gate-state.json`, `state`, `keystone`, `hash`, `transition`, `lifecycle`, `enforcement`
- Enrich existing domains with additional keywords based on framework analysis
- Ensure all 11 domain save_paths exist under `docs/official_docs/`

**Definition of Done**:
- [ ] 12th domain `state_management` added with keywords, context7 libraries, fallback pattern, save_path
- [ ] All existing 11 domains verified for keyword coverage
- [ ] All save_path directories exist (or created)
- [ ] `framework-self-test.js` passes

---

#### T-H04: project.config.json — Enrich template_resolution

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P0 |
| **Architecture Dimensions** | TP |
| **Dependencies** | T-H03 |

**What**: Add `knowledge_domain_fallback` URLs for the 12th domain (state_management), and add OpenCode-specific template resolution entries for CLI integration.

**Target File**:
- `.opencode/project.config.json` → `template_resolution`

**Changes**:
```jsonc
{
  "template_resolution": {
    // ...existing entries...
    "knowledge.fallback_url_state": "https://opencode.ai/docs/{topic}",
    "knowledge.fallback_url_machine": ".opencode/rules/rule_detail/state-machine-standard.md"
  }
}
```

**Definition of Done**:
- [ ] New fallback URLs added for state management domain
- [ ] All new keys referenced in knowledge_semantic_map domains
- [ ] TEMPLATE_VARIABLE_STANDARD.md updated with new knowledge.* placeholders

---

### Phase 1 — Core Hardening (P0 Enforcement)

---

#### T-H05: framework-enforcer.ts — Proactive UC7-001 Blocking

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P0 |
| **Architecture Dimensions** | HE, CSM |
| **Dependencies** | T-H01, T-H02 |

**What**: Extend the existing UC7-001 tracking in `framework-enforcer.ts` (which currently only records cache reads reactively) to proactively **block** write/edit/bash operations when `uc7_001_compliant` is `false` and the agent has not declared a scope.

**Current Code Location** (framework-enforcer.ts lines 1040-1091):
```typescript
// === UC7KS: UC7-001 — Auto-Track Knowledge Cache Access (read detection) ===
if (tool === "read") { /* tracks compliance */ }
```

**New Code** — Add BEFORE the existing read tracking:
```typescript
// === UC7KS: UC7-001 — Proactive Block (FW-HARDEN-UC7KS-002) ===
// In strict/locked mode, block write/edit/bash/webfetch for agents
// that have NOT completed UC7-001 compliance AND have NOT declared scope.
// This is the PROACTIVE enforcement layer — it prevents unqualified agents
// from modifying code or querying external sources.
const EXECUTION_TOOLS_UC7KS = new Set(["write", "edit", "safe_edit", "bash", "safe_bash", "webfetch", "websearch"]);
if (EXECUTION_TOOLS_UC7KS.has(tool) && mode !== "advisory") {
  const agentKey = agent.replace(/^@/, "");
  try {
    const machine = readJsonFile<any>(STATE_PATHS.machine());
    const kcs = machine?.knowledge_cache_state;
    const agentState = kcs?.session_access?.[agent] || kcs?.session_access?.[agentKey];
    const isCompliant = agentState?.uc7_001_compliant === true;
    const hasScope = !!agentState?.declared_scope;

    if (!hasScope && !isCompliant) {
      const msg = `[FW-ENFORCE][UC7-001][PROACTIVE] Agent "${agent}" blocked: no module scope declared AND no cache read completed. Required: declare scope (Step 0a) then read docs/official_docs/index.json (Step 0b).`;
      console.error(msg);
      violations.push("UC7-001: Proactive block — scope not declared, cache not read");
    }
  } catch (_) { /* non-fatal */ }
}
```

**Definition of Done**:
- [ ] Proactive UC7-001 blocking added before `tool.execute.before` write checks
- [ ] Works for `write`, `edit`, `safe_edit`, `bash`, `safe_bash`, `webfetch`, `websearch`
- [ ] Advisory mode: logged only (no blocking)
- [ ] Strict/locked mode: physically blocked via `violations.push()`
- [ ] @Knowledge-Curator agent exempted
- [ ] Existing reactive UC7-001 detection (tool === "read") preserved

---

#### T-H06: uc7ks-enforcer.ts — Hardened Cache Sufficiency Check

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P0 |
| **Architecture Dimensions** | HE, CSM |
| **Dependencies** | T-H01, T-H05 |

**What**: Extend `uc7ks-enforcer.ts` tool.execute.before to check the new `cache_sufficiency` field before allowing external queries, replacing the current binary "cache available / not available" logic.

**Current Code Location** (uc7ks-enforcer.ts lines 248-374): `toolExecuteBefore()` has separate branches for advisory / strict / locked based on `isLocalCacheAvailable()`.

**New Code** — Add after the existing UC7-001 hard-block:
```typescript
// ── UC7-001b: Cache Sufficiency Verification (FW-HARDEN-UC7KS-003) ──
// After UC7-001 (cache read) is verified, check that the agent has
// declared cache INSUFFICIENCY before allowing external queries.
// This prevents agents from skipping cache reads by claiming "cache checked,
// nothing found" without specifying WHAT was missing.
if (agentHasReadCache && cacheAvailable) {
  const kcs = machine?.knowledge_cache_state;
  const agentState = kcs?.session_access?.[agent];
  const sufficiencyStatus = agentState?.cache_sufficiency?.status;

  if (sufficiencyStatus !== "insufficient") {
    const errorMsg = buildUC7KSError(
      agent, tool, mode, true,
      "UC7-001b VIOLATION: Cache read completed but cache sufficiency not declared as 'insufficient'. Agent must declare specific missing topics before external queries.",
    );
    throw new Error(errorMsg);
  }
}
```

**Definition of Done**:
- [ ] Cache sufficiency check added after UC7-001 check in strict/locked mode
- [ ] Requires `cache_sufficiency.status === "insufficient"` with `missing_topics` populated
- [ ] Advisory mode: logged only
- [ ] @Knowledge-Curator agent exempted

---

#### T-H07: pre-execution-hook.sh — UC7KS Gate

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P0 |
| **Architecture Dimensions** | HE, HS |
| **Dependencies** | T-H05 |

**What**: Add a UC7KS Stage to `pre-execution-hook.sh` that validates `machine.json.knowledge_cache_state` before allowing task execution, providing an additional OS-level enforcement layer.

**Target File**:
- `.opencode/scripts/pre-execution-hook.sh` — add Stage 2.5 (UC7KS Gate)

**New Stage**:
```bash
# ══════════════════════════════════════════════════════════════════════
# Stage 2.5: UC7KS Knowledge Cache Gate (FW-HARDEN-UC7KS-004)
# ══════════════════════════════════════════════════════════════════════
echo ""
echo "── Stage 2.5: UC7KS Knowledge Cache Gate ──────────────────────────"

if [ -f "${PROJECT_ROOT}/.opencode/state/machine.json" ]; then
  UC7KS_COMPLIANT=$(/home/zhaoge/.bun/bin/bun -e "
    const m = require('${PROJECT_ROOT}/.opencode/state/machine.json');
    const agent = (process.env.FRAMEWORK_AGENT || '').replace(/^@/, '');
    const kcs = m?.knowledge_cache_state;
    const agentState = kcs?.session_access?.[agent];
    const isCompliant = agentState?.uc7_001_compliant === true;
    console.log(isCompliant ? 'yes' : 'no');
  " 2>/dev/null || echo "unknown")

  if [ "$UC7KS_COMPLIANT" = "no" ]; then
    enf_exit "UC7KS Gate: Agent has not completed knowledge cache search (Step 0b)"
  else
    echo "  ✅ UC7KS Gate passed — cache search completed"
  fi
else
  echo "  ⚠️  machine.json not found — UC7KS Gate skipped"
fi
```

**Definition of Done**:
- [ ] Stage 2.5 added between existing Stage 2 and Stage 3
- [ ] Works in all enforcement modes
- [ ] @Super-Admin bypass preserved
- [ ] Non-blocking in advisory mode (enf_exit returns 0)

---

### Phase 2 — Tooling (P1 Custom Tools)

---

#### T-H08: Custom Tool — module_scope_declare

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P1 |
| **Architecture Dimensions** | DA, CSM, TP |
| **Dependencies** | T-H01, T-H03 |

**What**: Create `.opencode/tools/module_scope_declare.ts` — a custom tool that reads `knowledge_semantic_map` from `project.config.json` and returns the domain mapping, cache paths, and context7 libraries for a declared module.

**Target File**:
- `.opencode/tools/module_scope_declare.ts` (new file)

**Tool Signature**:
```typescript
import { tool } from "@opencode-ai/plugin";

export default tool({
  description: "Declare the target module scope for the current task. Maps module to knowledge domain, cache paths, and Context7 libraries.",
  args: {
    module: tool.schema.enum([
      "backend_api", "persistence", "frontend_ui", "caching",
      "queue", "testing", "auth_security", "framework_tools",
      "devops_ci", "opencode_framework", "infrastructure", "state_management"
    ]).describe("Target knowledge domain from knowledge_semantic_map"),
    task_id: tool.schema.string().describe("DAG task ID"),
  },
  async execute(args, context) {
    const { directory } = context;
    const configPath = `${directory}/.opencode/project.config.json`;
    const machinePath = `${directory}/.opencode/state/machine.json`;
    const agent = process.env.FRAMEWORK_AGENT || "unknown";

    // 1. Load semantic map
    const config = JSON.parse(await Bun.file(configPath).text());
    const domain = config.knowledge_semantic_map.domains.find(
      (d: any) => d.domain_id === args.module
    );

    if (!domain) {
      return { error: `Unknown domain: ${args.module}`, available: config.knowledge_semantic_map.domains.map((d: any) => d.domain_id) };
    }

    // 2. Write declared_scope to machine.json
    const machine = JSON.parse(await Bun.file(machinePath).text());
    machine.knowledge_cache_state = machine.knowledge_cache_state || { session_access: {}, compliance: {} };
    const sa = machine.knowledge_cache_state.session_access;
    const agentKey = agent.replace(/^@/, "");
    sa[agent] = sa[agent] || sa[agentKey] || {};
    sa[agent].declared_scope = args.module;
    sa[agent].declared_at = new Date().toISOString();
    await Bun.write(machinePath, JSON.stringify(machine, null, 2));

    // 3. Return routing info
    return {
      domain: domain.domain_id,
      cache_path: `docs/official_docs/${domain.save_path}`,
      context7_libraries: domain.context7_libraries,
      fallback_url: domain.fallback_pattern,
      next_step: `Read docs/official_docs/index.json → search tags: [${domain.keywords.slice(0, 5).join(", ")}...]`
    };
  },
});
```

**Definition of Done**:
- [ ] `module_scope_declare.ts` created and registered
- [ ] Writes `declared_scope` to `machine.json.knowledge_cache_state`
- [ ] Returns domain routing info to agent
- [ ] All 12 domains supported
- [ ] No business code access

---

#### T-H09: Custom Tool — knowledge_cache_search

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P1 |
| **Architecture Dimensions** | CSM, DA |
| **Dependencies** | T-H08 |

**What**: Create `.opencode/tools/knowledge_cache_search.ts` — automates the cache search process by reading `index.json`, matching against a domain, and returning hit/miss status.

**Target File**:
- `.opencode/tools/knowledge_cache_search.ts` (new file)

**Definition of Done**:
- [ ] `knowledge_cache_search.ts` created and registered
- [ ] Reads `docs/official_docs/index.json`
- [ ] Matches entries by domain and tags
- [ ] Returns structured hit/miss report
- [ ] Writes `uc7_001_compliant: true` to machine.json when cache is read

---

#### T-H10: Custom Tool — knowledge_gap_report

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P1 |
| **Architecture Dimensions** | TP, CSM |
| **Dependencies** | T-H09 |

**What**: Create `.opencode/tools/knowledge_gap_report.ts` — compares `knowledge_semantic_map` domains against `index.json` entries to identify which domains have insufficient cache coverage.

**Target File**:
- `.opencode/tools/knowledge_gap_report.ts` (new file)

**Definition of Done**:
- [ ] `knowledge_gap_report.ts` created and registered
- [ ] Compares all 12 semantic domains against index.json entries
- [ ] Returns per-domain: cached_count, missing_topics, last_updated
- [ ] Useful for @Meta-Planner to decide if cache needs refresh before DAG generation

---

### Phase 3 — Policies + CLI (P2 Integration)

---

#### T-H11: opencode.json — Policies Integration

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P2 |
| **Architecture Dimensions** | HE, PM |
| **Dependencies** | None |

**What**: Add `experimental.policies` to `opencode.json` for provider control in locked mode.

**Target File**:
- `opencode.json` — add `experimental.policies` section

**Changes**:
```jsonc
{
  // ...existing...
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "openai" },
      { "effect": "allow", "action": "provider.use", "resource": "anthropic" },
      { "effect": "allow", "action": "provider.use", "resource": "deepseek" }
    ]
  }
}
```

**Definition of Done**:
- [ ] `experimental.policies` added to `opencode.json`
- [ ] `disabled_providers` deprecated (migrated to policies)
- [ ] `enabled_providers` deprecated (migrated to policies)
- [ ] Policy effect documented: global > project precedence

---

#### T-H12: safe_shell Allowlist — opencode CLI Commands

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P2 |
| **Architecture Dimensions** | PM, MAS |
| **Dependencies** | None |

**What**: Extend `project.config.json` → `safe_shell.agent_allowlists` to include OpenCode CLI commands for authorized agents.

**Target File**:
- `.opencode/project.config.json` → `safe_shell.agent_allowlists`

**Changes**:
```jsonc
{
  "safe_shell": {
    "agent_allowlists": {
      "@CI-CD-Agent": [
        // ...existing...
        "opencode mcp auth *",
        "opencode mcp list"
      ],
      "@Super-Admin": [
        // ...existing...
        "opencode debug config",
        "opencode mcp debug *"
      ],
      "@Guardian": [
        // ...existing...
        "opencode mcp list"
      ]
    }
  }
}
```

**Definition of Done**:
- [ ] `opencode mcp auth`, `opencode mcp list` added to @CI-CD-Agent allowlist
- [ ] `opencode debug config`, `opencode mcp debug` added to @Super-Admin allowlist
- [ ] `opencode mcp list` added to @Guardian allowlist
- [ ] Dangerous patterns list updated to exclude these commands

---

### Phase 4 — Validation (P2 Testing)

---

#### T-H13: framework-self-test.js — UC7KS Checks

| Field | Value |
|-------|-------|
| **Agent** | @Super-Admin |
| **Priority** | P2 |
| **Architecture Dimensions** | CSM, HE |
| **Dependencies** | T-H01 through T-H12 |

**What**: Add new self-test checks for the UC7KS pipeline and new custom tools.

**Target File**:
- `.opencode/scripts/framework-self-test.js` — add Check 21, 22, 23

**New Checks**:
| Check | Name | Description |
|-------|------|-------------|
| 21 | UC7KS Schema Integrity | Validates `machine.json.knowledge_cache_state` structure |
| 22 | Custom Tool Registration | Verifies all 4 new tools are registered in `.opencode/tools/` |
| 23 | knowledge_semantic_map Coverage | Validates all 12 domains have keywords, save_path, fallback_pattern |

**Definition of Done**:
- [ ] Check 21: validates knowledge_cache_state schema conformance
- [ ] Check 22: validates 4 new custom tools exist
- [ ] Check 23: validates 12-domain semantic map completeness

---

#### T-H14: Integration Smoke Test

| Field | Value |
|-------|-------|
| **Agent** | @Guardian |
| **Priority** | P2 |
| **Architecture Dimensions** | ALL |
| **Dependencies** | T-H01 through T-H13 |

**What**: Execute a full integration smoke test covering the UC7KS pipeline across all enforcement modes.

**Test Scenarios**:
1. **Advisory mode**: Verify all changes log-only, no blocking
2. **Strict mode**: Verify UC7-001 proactive block on write without cache read
3. **Locked mode**: Verify full pipeline enforcement + policies provider restriction
4. **KC bypass**: Verify @Knowledge-Curator can always fetch external docs
5. **Module scope**: Verify `module_scope_declare` tool returns correct domain routing

**Definition of Done**:
- [ ] All 5 test scenarios pass
- [ ] `test_report.json` generated with `execution_evidence`
- [ ] `HANDOVER.md` written to `.task_temp/_global/`
- [ ] Compliance gate lifecycle completed

---

## 4. Dependency Graph

```
Phase 0 (Foundation)
T-H01 ──┬── T-H02
        ├── T-H05 ── T-H06 ── T-H07
        └── T-H08 ── T-H09 ── T-H10
T-H03 ── T-H04

Phase 1 (Core Hardening)
T-H05 (depends on T-H01, T-H02)
T-H06 (depends on T-H01, T-H05)
T-H07 (depends on T-H05)

Phase 2 (Tooling)
T-H08 (depends on T-H01, T-H03)
T-H09 (depends on T-H08)
T-H10 (depends on T-H09)

Phase 3 (Policies + CLI)
T-H11 (independent)
T-H12 (independent)

Phase 4 (Validation)
T-H13 (depends on ALL above)
T-H14 (depends on T-H13)

Parallel execution:
  Phase 0: T-H01 || T-H03
  Phase 3: T-H11 || T-H12
  After Phase 0+1+2: T-H13 → T-H14
```

---

## 5. Risk & Rollback

### 5.1 Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Existing agents blocked by proactive UC7-001 check | Medium | High | All checks mode-gated; advisory mode = no blocking |
| machine.json schema migration breaks existing state | Low | High | Atomic write (tmp→rename); backup before migration |
| Custom tool naming collisions | Low | Low | Names `module_scope_declare`, `knowledge_cache_search`, `knowledge_gap_report` — no conflicts |
| opencode CLI not available in CI | Low | Medium | CLI commands are agent-only, not CI pipeline |

### 5.2 Rollback Plan

For each phase, a `git checkout` rollback is available:

```bash
# Phase 0 rollback
git checkout -- .opencode/state/machine.schema.json
git checkout -- .opencode/state/machine.json
git checkout -- .opencode/subagent-preamble.md
git checkout -- .opencode/project.config.json

# Phase 1 rollback
git checkout -- .opencode/plugins/framework-enforcer/framework-enforcer.ts
git checkout -- .opencode/plugins/uc7ks-enforcer/uc7ks-enforcer.ts
git checkout -- .opencode/scripts/pre-execution-hook.sh

# Phase 2 rollback
rm .opencode/tools/module_scope_declare.ts
rm .opencode/tools/knowledge_cache_search.ts
rm .opencode/tools/knowledge_gap_report.ts

# Phase 3 rollback
git checkout -- opencode.json
git checkout -- .opencode/project.config.json
```

---

## 6. Compliance Gate Requirements

All 14 tasks must follow the P0 protocol:

```
compliance_gate_check → present plan → user confirm → compliance_gate_confirm → execute → compliance_gate_complete
```

**Gate session linkage**: Each task uses its DAG task ID (T-H01 through T-H14) for session tracking.

---

## 7. State Machine Impact

### 7.1 machine.json Changes

New fields under `knowledge_cache_state.session_access.{agent}`:
- `declared_scope` (string | null) — agent's declared module domain
- `cache_sufficiency` (object) — sufficiency declaration

### 7.2 gate-state.json

No changes — gate sessions remain unchanged.

### 7.3 rule_registry.json

New entries for:
- `tools/module_scope_declare.ts`
- `tools/knowledge_cache_search.ts`
- `tools/knowledge_gap_report.ts`

---

## 8. Review Gates

| Gate | Reviewer | Scope | Dependencies |
|------|----------|-------|-------------|
| **Design Review** | @Architect | Architecture alignment; 7-dimension compliance; semantic map structure | Before any implementation |
| **Security Review** | @Guardian | Write scope isolation; safe_shell allowlist security; plugin integrity | After implementation |
| **Architecture Change Approval** | @Arbiter | Enforcement mode changes; locking implications; waiver policy | Before locked-mode changes |

---

## 9. Estimated Effort

| Phase | Tasks | Estimated Effort | Critical Path |
|-------|-------|-----------------|---------------|
| Phase 0 | 4 tasks | 2-3 hours | T-H01 → T-H02 |
| Phase 1 | 3 tasks | 3-4 hours | T-H05 → T-H06 → T-H07 |
| Phase 2 | 3 tasks | 2-3 hours | T-H08 → T-H09 → T-H10 |
| Phase 3 | 2 tasks | 1 hour | Parallel (T-H11 ‖ T-H12) |
| Phase 4 | 2 tasks | 1-2 hours | T-H13 → T-H14 |
| **Total** | **14 tasks** | **9-13 hours** | |

---

> ⚠️ **IMPLEMENTATION NOTE**: This plan is a draft. All tasks require explicit human invocation of @Super-Admin per the P0 Super-Admin Human Trigger Rule.  
> **Next Step**: Present to @Architect for design review, then to @Arbiter for architectural approval.

---

*Document version: v1.0.0 — 2026-06-06*
