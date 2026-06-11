# UC7KS Hard Constraint + Framework Optimization — Analysis Report

**Created**: 2026-06-06  
**Author**: @Super-Admin  
**Scope**: Framework-layer investigation only — no business code modified  
**Status**: Analysis Complete — Awaiting @Architect / @Arbiter Review  

---

## Executive Summary

This report documents a comprehensive investigation into three optimization areas for the OpenCode multi-agent framework:

1. **UC7KS Knowledge Pipeline Hardening** — Formalizing the knowledge acquisition pipeline as a physically-enforced hard constraint with module-scope declaration
2. **policies.md / custom-tools.md / cli.md Integration** — Activating three underutilized OpenCode framework capabilities
3. **Seven-Dimension Architecture Alignment** — Ensuring all optimizations align with Design Architecture, Hardened Enforcement, Harness System, Permission Matrix, Multi-Agent System, Central State Management, and Templatization/Parameterization

---

## 1. UC7KS Knowledge Pipeline — Current Architecture Assessment

### 1.1 Four-Layer Defense System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    UC7KS Multi-Layer Defense (Current State)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Layer 0 — Instruction Layer                                                 │
│    subagent-preamble.md Step 0: "MUST search local cache first"              │
│    ❌ Text instruction only — no physical enforcement                        │
│                                                                              │
│  Layer 1 — Plugin Interception (uc7ks-enforcer.ts)                           │
│    tool.execute.before: intercepts webfetch/websearch/context7_*             │
│    ✅ Physical throw Error blocking (strict/locked mode)                     │
│    ⚠️ Relies on machine.json.knowledge_cache_state.uc7_001_compliant         │
│                                                                              │
│  Layer 2 — Framework Enforcer (framework-enforcer.ts)                        │
│    UC7-004: Blocks direct Context7 calls from non-@KC agents                 │
│    UC7-009: ALL agents must follow UC7KS pipeline                            │
│    UC7-001: Auto-detects docs/official_docs/ reads, records compliance       │
│    ✅ Double defense, <20ms response time                                     │
│                                                                              │
│  Layer 3 — Configuration Layer (project.config.json)                        │
│    agent_tool_scopes: per-agent doc_tools permissions (allow/via_curator/deny)│
│    knowledge_semantic_map: 11 domains × keyword mappings                     │
│    ✅ Centralized permission matrix + semantic routing table                  │
│                                                                              │
│  Layer 4 — Pre-Commit (pre-commit hook)                                      │
│    Layer 1.5: Rule Registry digest verification                             │
│    ⚠️ Does not directly involve UC7KS pipeline                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Identified Gaps

| Gap ID | Location | Impact | Severity |
|--------|----------|--------|----------|
| **G1** — No "Module Scope Declaration" step | Task startup phase | Agent may not know which knowledge domain to query | HIGH |
| **G2** — UC7-001 compliance detection is **reactive** not **proactive** | framework-enforcer.ts | Can only detect after agent reads cache, not enforce before task begins | HIGH |
| **G3** — knowledge_semantic_map only used by @KC matching | project.config.json | Execution agents get no automated "you should check these domains" prompts | MEDIUM |
| **G4** — No automated "cache sufficiency check" | Entire pipeline | "Is cache sufficient" relies on agent subjective judgment | MEDIUM |
| **G5** — advisory mode degrades all UC7KS to log-only | uc7ks-enforcer.ts | No physical constraints in dev mode, UC7KS relies entirely on agent discipline | LOW |

### 1.3 Hardening Plan: UC7KS Five-Step Protocol

Proposed addition to `subagent-preamble.md` Step 0, physically enforced by `framework-enforcer.ts`:

```
Step 0a — ModuleScopeDeclare (Hard Constraint · Physical Enforcement)
    Before first write/edit/bash:
    1. Agent invokes "module_scope_declare" tool to declare target module
    2. framework-enforcer verifies declared module maps to knowledge_semantic_map domain
    3. framework-enforcer auto-injects domain cache path hints

Step 0b — CacheSearch (Hard Constraint · Physical Enforcement)
    framework-enforcer in strict/locked mode:
    1. Checks machine.json.knowledge_cache_state.{agent}.uc7_001_compliant
    2. Not completed → blocks ALL write/edit/bash/webfetch operations
    3. Completed → allows execution

Step 0c — CacheSufficiency (Hard Constraint · Physical Enforcement)
    uc7ks-enforcer before external queries:
    1. Checks if agent declared specific "cache insufficient" reason
    2. Not declared → blocks external query, requires agent to read cache first
    3. Declared → allows @Knowledge-Curator dispatch
```

---

## 2. policies.md — From "Unused" to "Hardened Constraint Pillar"

### 2.1 Current State

`project.config.json` **completely unused** OpenCode's `experimental.policies` feature. Currently only uses legacy `disabled_providers`/`enabled_providers` (marked for deprecation in OpenCode v1.16).

### 2.2 Integration Plan

```jsonc
// opencode.json supplement
{
  "experimental": {
    "policies": [
      // Policy 1: locked mode restricts providers
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "anthropic" },
      { "effect": "allow", "action": "provider.use", "resource": "deepseek" }
    ]
  }
}
```

### 2.3 Architecture Alignment

| Dimension | Integration |
|-----------|-------------|
| Hardened enforcement | locked mode → physically blocks unauthorized providers |
| Permission Matrix | policies complement tool-level permissions with upstream control |
| Central State | enforcement_transitions records policy changes on mode switch |
| Templatization | `{auth.mechanism}` template variables determine available providers |

---

## 3. custom-tools.md — Extended Tool Matrix

### 3.1 Current State

6 custom tools exist, all in the safe_* family:

| Tool | Responsibility | Aligned Dimension |
|------|---------------|-------------------|
| `dispatch_subagent` | Agent dispatch | Harness System |
| `safe_edit` | Safe editing | Hardened enforcement |
| `safe_delete` | Safe deletion | Hardened enforcement |
| `safe_diff` | Safe comparison | Hardened enforcement |
| `safe_mkdir` | Safe directory creation | Hardened enforcement |
| `safe_shell` | Safe shell execution | Hardened enforcement |

### 3.2 Proposed New Custom Tools

| New Tool | Responsibility | Aligned Dimension |
|----------|---------------|-------------------|
| `module_scope_declare` | Declare task target module → auto-map knowledge_semantic_map | Design Architecture + UC7KS |
| `knowledge_cache_search` | Automated local cache search → return hit/miss status | Central State + UC7KS |
| `knowledge_gap_report` | Compare semantic_map vs index.json → output missing domains | Templatization + UC7KS |
| `enforcement_mode_query` | Runtime query of current enforcement mode | Hardened enforcement |

**Key Tool Design — `module_scope_declare`:**

```typescript
// .opencode/tools/module_scope_declare.ts
import { tool } from "@opencode-ai/plugin";

export default tool({
  description: "Declare the target module scope for the current task",
  args: {
    module: tool.schema.enum([
      "backend_api", "persistence", "frontend_ui", "caching",
      "queue", "testing", "auth_security", "framework_tools",
      "devops_ci", "opencode_framework", "infrastructure"
    ]).describe("Target knowledge domain from knowledge_semantic_map"),
    task_id: tool.schema.string().describe("DAG task ID"),
  },
  async execute(args, context) {
    // 1. Read project.config.json → knowledge_semantic_map
    // 2. Match declared module to domain
    // 3. Return: cache paths, fallback URLs, context7 libraries
    // 4. Write to machine.json.knowledge_cache_state.session_access[agent].declared_scope
    const projectConfig = JSON.parse(
      await Bun.file(".opencode/project.config.json").text()
    );
    const domain = projectConfig.knowledge_semantic_map.domains.find(
      (d: any) => d.domain_id === args.module
    );
    return {
      domain: domain?.domain_id,
      cache_paths: [`docs/official_docs/${domain?.save_path || ""}`],
      context7_libraries: domain?.context7_libraries || [],
      fallback_pattern: domain?.fallback_pattern,
      recommendation: `Read docs/official_docs/index.json → search for "${domain?.domain_id}" entries`
    };
  },
});
```

---

## 4. cli.md — Framework-Level CLI Integration

### 4.1 Current State

OpenCode CLI commands **completely unintegrated** into any agent workflow. Currently only used indirectly via npm scripts (e.g., `npm run keystone:validate`).

### 4.2 Integration Matrix

| CLI Command | Integration Scenario | Invoking Agent | Aligned Dimension |
|-------------|---------------------|----------------|-------------------|
| `opencode agent create` | @Meta-Planner dynamically creates new agents (e.g., temporary specialists) | @Meta-Planner | Multi-Agent System |
| `opencode mcp auth <server>` | @CI-CD-Agent manages MCP service authentication | @CI-CD-Agent | Hardened enforcement |
| `opencode mcp list` | @Guardian audits MCP service availability | @Guardian | Central State |
| `opencode mcp debug <server>` | @Super-Admin troubleshoots MCP connections | @Super-Admin | Hardened enforcement |
| `opencode run --replay <session>` | @Guardian replays audit sessions | @Guardian | Multi-Agent System |
| `opencode debug config` | @Super-Admin verifies config merge results | @Super-Admin | Central State |

### 4.3 safe_shell Allowlist Extension

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
      ]
    }
  }
}
```

---

## 5. Seven-Dimension Architecture Alignment Summary

```
┌──────────────────────────────────────────────────────────────────────────────┐
│              Optimization Proposal × Seven Architecture Dimensions            │
├────────────────────────────┬─────────────────────────────────────────────────┤
│ 1. Design Architecture     │ module_scope_declare as pipeline first step      │
│                            │ knowledge_semantic_map 12 domains → auto-router  │
│                            │ policies complement config→permissions→tools link │
├────────────────────────────┼─────────────────────────────────────────────────┤
│ 2. Hardened enforcement    │ UC7-001 from reactive detection → proactive block │
│                            │ framework-enforcer: undeclared scope → block write│
│                            │ uc7ks-enforcer: undeclared gap → block external   │
│                            │ policies: locked mode → block unauthorized providers│
├────────────────────────────┼─────────────────────────────────────────────────┤
│ 3. Harness System          │ subagent-preamble.md Step 0a/0b/0c formalized     │
│                            │ dispatch-subagent.js injects scope declaration    │
│                            │ knowledge_cache_search replaces manual cache read │
├────────────────────────────┼─────────────────────────────────────────────────┤
│ 4. Permission Matrix       │ agent_tool_scopes adds module_scope dimension     │
│                            │ policies completes provider.use layer             │
│                            │ safe_shell allowlist extends opencode CLI commands│
├────────────────────────────┼─────────────────────────────────────────────────┤
│ 5. Multi-Agent System      │ opencode agent create → dynamic agent creation    │
│                            │ opencode run --replay → Guardian audit replay     │
│                            │ 8 agents unified UC7KS + @KC as sole external gateway│
├────────────────────────────┼─────────────────────────────────────────────────┤
│ 6. Central State Management│ machine.json.knowledge_cache_state extended:       │
│                            │   + declared_scope (agent's declared module domain)│
│                            │   + cache_sufficiency (agent's cache sufficiency)  │
│                            │ rule_registry.json digest via pre-commit          │
├────────────────────────────┼─────────────────────────────────────────────────┤
│ 7. Templatization &        │ knowledge_semantic_map 12 domains 100% parametrized│
│    Parameterization        │ fallback_pattern supports {topic} placeholder      │
│                            │ context7_libraries reference {template} variables  │
│                            │ COMPATIBILITY_PROFILE supports non-Native stacks   │
└────────────────────────────┴─────────────────────────────────────────────────┘
```

---

## 6. Priority Matrix

| Priority | Optimization Item | Impact Scope | Difficulty | Dependencies |
|----------|-------------------|-------------|------------|--------------|
| **P0** | UC7-001 reactive→proactive blocking (framework-enforcer physical enforcement) | All agents | Medium | None |
| **P0** | subagent-preamble.md Step 0 formalization (module scope declaration) | All sub-agents | Low | None |
| **P1** | knowledge_cache_search custom tool | @KC + all agents | Medium | P0 items |
| **P1** | policies provider.use completion (locked mode) | opencode.json | Low | None |
| **P2** | module_scope_declare custom tool | All agents | Medium | P0 items |
| **P2** | opencode CLI integration into safe_shell allowlist | @CI-CD-Agent, @Super-Admin | Low | None |
| **P2** | knowledge_gap_report custom tool | @KC, @Meta-Planner | Medium | P1 items |
| **P2** | enforcement_mode_query custom tool | All agents | Low | None |

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Pre-existing tasks break due to new UC7KS blocking | Medium | High | advisory mode remains non-blocking; strict/locked gated behind @Arbiter approval |
| knowledge_cache_state write conflicts in machine.json | Low | Medium | Use atomic write (tmp → rename) pattern already in framework-enforcer.ts |
| Custom tool naming collisions with built-in tools | Low | Low | Use `module_scope_declare` / `knowledge_cache_search` — no collisions with 12 built-in names |
| opencode CLI version incompatibility | Low | Medium | `opencode --version` check before CLI integration |

---

> ⚠️ **NOTE**: This is an investigation-only analysis report. No code has been modified.  
> All optimization proposals require @Architect (design review) and @Arbiter (architectural change approval) before implementation.  
> See `IMPLEMENTATION_PLAN.md` for detailed step-by-step execution plan.

---

*Document version: v1.0.0 — 2026-06-06*
