# OpenCode Upstream Research — Dispatch-Time Findings

**Date**: 2026-06-03  
**Author**: @Super-Admin  
**Context**: Research conducted per `subagent-preamble-weight-analysis.md` integration task.  
**Purpose**: Document the relationship between this project's `.opencode/` multi-agent framework and upstream OpenCode/Crush.

---

## 1. Upstream Project Status

### 1.1 `opencode-ai/opencode` — ARCHIVED

| Field | Value |
|-------|-------|
| **URL** | https://github.com/opencode-ai/opencode |
| **Status** | **ARCHIVED** as of 2025-09-18 (read-only) |
| **Stars** | 12.8k |
| **Forks** | 1.4k |
| **Latest Release** | v0.0.55 (2025-06-27) |
| **Total Commits** | 185 |
| **Language** | Go 99.2% |
| **License** | MIT |

**Archiving Notice**: "This repository is no longer maintained and has been archived for provenance. The project has continued under the name Crush, developed by the original author and the Charm team."

### 1.2 `charmbracelet/crush` — ACTIVE (successor)

| Field | Value |
|-------|-------|
| **URL** | https://github.com/charmbracelet/crush |
| **Status** | **ACTIVE** |
| **Stars** | 24.9k |
| **Forks** | 1.8k |
| **Latest Release** | v0.75.0 (2025-06-02) |
| **Total Commits** | 3,483 |
| **Language** | Go 98.4% |
| **License** | FSL-1.1-MIT |

**Key improvements over OpenCode**:
- Agent Skills open standard support (`.agents/skills/`, `crush/skills/`, `.claude/skills/`)
- Hooks system (`docs/hooks/`)
- Extended MCP support (stdio, http, sse transports)
- Shell-style value expansion in config (`$VAR`, `${VAR:-default}`, `$(command)`)
- Session sharing across clients (workspace-based)
- Desktop notifications, provider auto-updates
- `reasoningEffort` per-agent model setting

---

## 2. Architecture Comparison

### 2.1 Upstream OpenCode Agent Model

The upstream `opencode-schema.json` defines **3 agent types**:

```json
{
  "agents": {
    "coder": { "model": "claude-3.7-sonnet", "maxTokens": 5000 },
    "task": { "model": "claude-3.7-sonnet", "maxTokens": 5000 },
    "title": { "model": "claude-3.7-sonnet", "maxTokens": 80 }
  }
}
```

- **coder**: Primary coding agent
- **task**: Sub-task agent (background tasks)
- **title**: Session title generator

### 2.2 Our Custom Multi-Agent System

Our `.opencode/` framework extends upstream with **9 specialized agents** across 3 layers:

| Layer | Agents |
|-------|--------|
| **Meta Layer** | @Meta-Planner, @Orchestrator |
| **Execution Layer** | @Architect, @Coder-BE, @Coder-FE |
| **Validation Layer** | @Guardian, @Arbiter, @CI-CD-Agent, @Super-Admin |

**Key custom extensions** (not in upstream):
- `dispatch-subagent.js` — agent dispatch wrapper with P0 protocol injection
- `subagent-preamble.md` — P0 behavioral contract for all sub-agents
- `framework-enforcer.ts` — plugin-level runtime enforcement (14 hooks)
- `machine.json` — central state machine (4,422 lines)
- `gate-state.json` — compliance gate session tracking
- `compliance-gate.js` — MCP tool for check/confirm/complete lifecycle
- `code-quality-gate.js` — write-time audit + full scan
- `eslint-audit` — mock-audit for TDD enforcement
- `keystone-validate.js` — contract hash validation
- `contract.yaml` — API contracts + data model contracts
- `Task.DAG.json` — directed acyclic graph task planning
- `project.config.json` — per-project configuration with template resolution

### 2.3 Crush's Agent Skills vs Our Skills

| Feature | Crush | Our Framework |
|---------|-------|---------------|
| Skills location | `.agents/skills/`, `.crush/skills/` | `.opencode/skills/` |
| Skill format | `SKILL.md` with YAML frontmatter | `SKILL.md` with YAML frontmatter |
| User-invocable | `user-invocable: true` in frontmatter | Via `skill` tool |
| Auto-invocation | Model auto-triggers | Agent pre-flight protocol |
| Disable per-skill | `disable-model-invocation: true` | Via `enforcement_modes` |

### 2.4 Crush's Hooks vs Our framework-enforcer.ts

| Feature | Crush | Our Framework |
|---------|-------|---------------|
| Hook system | `docs/hooks/` (preliminary) | `framework-enforcer.ts` (14 hooks, mature) |
| Pre-execution | Hook scripts | `tool.execute.before` |
| Post-execution | Hook scripts | `tool.execute.after` |
| Permission checks | `permissions.allowed_tools` | Multi-layer: agent config + opencode.json + write scopes |

---

## 3. Key Differences Relevant to Preamble Analysis

### 3.1 Upstream Has No `dispatch-subagent.js` Equivalent

Upstream OpenCode/Crush uses a simple `Task()` / `agent()` tool dispatch with no wrapper. Our `dispatch-subagent.js` is a custom addition that:
1. Reads agent config from `.opencode/agents/{agent_type}.md`
2. Injects skills, MCP tools, permissions, project context, and Context7 requirements
3. Wraps everything with `subagent-preamble.md` as the P0 protocol
4. Appends DISPATCH_TOKEN for integrity verification

This means our preamble duplication problem is **unique to our custom framework** — upstream has no equivalent issue.

### 3.2 Upstream Config Structure

Crush uses `crush.json` (project-local or global `~/.config/crush/`) while we use `opencode.json`. The schema is similar but Crush has richer permission controls:

```json
{
  "permissions": {
    "allowed_tools": ["view", "ls", "grep", "edit"]
  }
}
```

Our `opencode.json` also has per-agent permission blocks but adds `agent_write_scopes` from `project.config.json`.

### 3.3 Crush's AGENTS.md vs Our AGENTS.md

Crush natively supports an `AGENTS.md` file (or `CRUSH.md`, or `CLAUDE.md`) as a context file auto-generated during project initialization. Our `AGENTS.md` serves the same purpose but is manually maintained and defines the 9-agent collaboration protocol.

---

## 4. Conclusions

1. **Our `.opencode/` framework is a custom, independent extension** — not derived from upstream beyond the base OpenCode runtime. The 9-agent system, P0 protocol, compliance gates, state machine, and DAG planning are all custom additions.

2. **The preamble weight issue is ours alone** — upstream has no subagent preamble because it has no custom dispatch wrapper. Our analysis and proposed slimming are correct.

3. **Crush's Agent Skills standard** is emerging as an industry standard (`.agents/skills/SKILL.md`). Our `.opencode/skills/` structure is compatible in concept but uses a different directory path. Future migration to the standard could reduce maintenance burden.

4. **Crush's hooks system** (preliminary) is conceptually similar to our `framework-enforcer.ts` plugin hooks, but our implementation is far more mature (14 hooks vs preliminary support).

5. **The upstream archival and Crush transition** does not affect our framework — we built on the OpenCode runtime, not on its agent system. The runtime API remains compatible through OpenCode's stable tool interface.

---

## Appendix A: Crush Configuration Schema (Key Fields)

```json
{
  "$schema": "https://charm.land/crush.json",
  "data": { "directory": ".crush" },
  "providers": { /* OpenAI, Anthropic, etc. */ },
  "agents": { "coder": {}, "task": {}, "title": {} },
  "mcp": { /* stdio, http, sse transports */ },
  "lsp": { "go": {}, "typescript": {} },
  "permissions": { "allowed_tools": [] },
  "options": {
    "disabled_tools": [],
    "disabled_skills": [],
    "skills_paths": [],
    "debug": false,
    "disable_notifications": false,
    "initialize_as": "AGENTS.md",
    "disable_provider_auto_update": false,
    "disable_metrics": false,
    "attribution": { "trailer_style": "assisted-by", "generated_with": true }
  }
}
```

## Appendix B: Crush MCP Configuration (with shell expansion)

```json
{
  "mcp": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer $GH_PAT" }
    },
    "filesystem": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mcp-server.js"],
      "env": { "NODE_ENV": "production" }
    }
  }
}
```

---

*This document was produced during the 2026-06-03 Super-Admin emergency dispatch for preamble integration. No framework files were modified during research.*
