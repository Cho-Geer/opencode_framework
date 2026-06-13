# OpenCode Layout Architecture — Directory Structure & Config Loading

**Date**: 2026-06-11
**Source**: Official OpenCode docs (opencode.ai) — config.md, agents.md, cli.md
**Cache sources**: config.md, agents.md, cli.md, tools.md, custom-tools.md

---

## 1. `.opencode/` Standard Directory Layout

The `.opencode/` directory (in project root) follows a **standardized structure**. All subdirectories use **plural names**:

```
.opencode/
├── agents/          ← Agent markdown configs (*.md)
├── commands/        ← Custom command definitions (*.md)
├── modes/           ← Agent mode definitions
├── plugins/         ← Plugin files (*.ts, *.js) — auto-discovered
├── skills/          ← Skill definition files (SKILL.md)
├── tools/           ← Custom tool definitions (*.ts)
└── themes/          ← UI theme files
```

**Note**: Singular names (e.g., `agent/`, `plugin/`) are also supported for backwards compatibility. Both `.opencode/` (project-level) and `~/.config/opencode/` (global-level) follow the same structure.

### Global Config Directory (`~/.config/opencode/`)

```
~/.config/opencode/
├── opencode.json          ← Global config file
├── tui.json               ← TUI-specific config
├── agents/                ← Global agent markdown files
├── commands/              ← Global command definitions
├── modes/                 ← Global mode definitions
├── plugins/               ← Global plugins
├── skills/                ← Global skill definitions
├── tools/                 ← Global custom tools
└── themes/                ← Global themes
```

---

## 2. Config File Locations & Precedence

### Precedence Order (later sources override earlier)

| # | Source | Location | Description |
|---|--------|----------|-------------|
| 1 | **Remote** | `.well-known/opencode` | Organizational defaults |
| 2 | **Global** | `~/.config/opencode/opencode.json` | User preferences |
| 3 | **Custom** | `OPENCODE_CONFIG` env var | Custom overrides |
| 4 | **Project** | `opencode.json` in project root | Project-specific settings |
| 5 | **.opencode dirs** | `.opencode/` | Agents, commands, plugins |
| 6 | **Inline** | `OPENCODE_CONFIG_CONTENT` env var | Runtime overrides |
| 7 | **Managed files** | `/Library/Application Support/opencode/` (macOS) | Admin-controlled |
| 8 | **macOS MDM** | `.mobileconfig` via MDM | Highest priority |

### Config Merging Behavior

Configuration files are **merged together**, not replaced. Settings from later configs override earlier ones **only for conflicting keys**. Non-conflicting settings from all configs are preserved.

### Discovery

OpenCode starts by looking for a config file in the **current directory**, then traverses **up to the nearest Git directory**.

---

## 3. Agent Config Loading

### Two Configuration Formats

#### JSON Config (in `opencode.json`)

```json
{
  "agent": {
    "build": {
      "mode": "primary",
      "model": "anthropic/claude-sonnet-4-20250514",
      "permission": { "edit": "allow", "bash": "allow" }
    },
    "code-reviewer": {
      "description": "Reviews code for best practices",
      "mode": "subagent",
      "permission": { "edit": "deny" }
    }
  }
}
```

#### Markdown Config (in `.opencode/agents/`)

```markdown
---
description: Reviews code for quality and best practices
mode: subagent
model: anthropic/claude-sonnet-4-20250514
permission:
  edit: deny
  bash: deny
---
You are in code review mode. Focus on...
```

**File name = agent name** (e.g., `review.md` creates `review` agent).

### Agent Load Order

1. Built-in agents (Build, Plan, General, Explore, Scout)
2. Global config agents (`~/.config/opencode/opencode.json` → agent key)
3. Global markdown agents (`~/.config/opencode/agents/*.md`)
4. Project config agents (`opencode.json` → agent key)
5. Project markdown agents (`.opencode/agents/*.md`)

Later configs override earlier ones for conflicting keys.

---

## 4. Custom Tool Loading

### Location

- **Project**: `.opencode/tools/`
- **Global**: `~/.config/opencode/tools/`

### Structure

```typescript
// .opencode/tools/my-tool.ts — filename = tool name
import { tool } from "@opencode-ai/plugin"
export default tool({
  description: "Does something useful",
  args: { input: tool.schema.string().describe("Input") },
  async execute(args) { return `Result: ${args.input}` },
})
```

### Multiple Tools Per File

Each named export becomes a separate tool: `<filename>_<exportname>`

### Name Collisions

Custom tools are keyed by name. If same name as built-in, **custom tool takes precedence**.

---

## 5. Plugin Loading

### Location

- **Project**: `.opencode/plugins/`
- **Global**: `~/.config/opencode/plugins/`

### Discovery

- **Auto**: Files in these directories are automatically loaded at startup
- **Explicit**: Via `opencode.json` → `"plugin": [...]` (supports npm packages, local paths)

### Load Order

1. Global config plugins
2. Project config plugins
3. Global plugin directory
4. Project plugin directory

---

## 6. Skill Loading

### Location

- **Project**: `.opencode/skills/`
- **Global**: `~/.config/opencode/skills/`

### Structure

Each skill is a directory with a `SKILL.md` file. Skills are loaded via the `skill` tool by name.

---

## 7. Command Loading

### Location

- **Project**: `.opencode/commands/`
- **Global**: `~/.config/opencode/commands/`
- **Inline**: `opencode.json` → `"command"` key

---

## 8. Configuration Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENCODE_CONFIG` | Path to custom config file |
| `OPENCODE_CONFIG_DIR` | Path to custom config directory |
| `OPENCODE_CONFIG_CONTENT` | Inline JSON config content |
| `OPENCODE_TUI_CONFIG` | Path to TUI config file |
| `OPENCODE_PERMISSION` | Inlined JSON permissions config |
| `OPENCODE_DISABLE_DEFAULT_PLUGINS` | Disable default plugins |

---

## 9. Dispatch System Architecture

### How Agents Are Dispatched

1. **Primary agents**: Main conversation agents, cycled via Tab
2. **Subagents**: Invoked via `@mention` or `Task()` tool
3. **Dispatch flow**: Primary agent → `Task()` tool → dispatch-subagent.js → wrapped prompt → subagent process

### Runtime Environment Variables

| Env Var | Value | Meaning |
|---------|-------|---------|
| `AGENT` | `1` | Boolean: process is running as an agent |
| `OPENCODE` | `1` | Boolean: OpenCode environment |
| `FRAMEWORK_AGENT` | `@AgentType` | **Project-specific**: current agent type (set by dispatch-subagent.js) |

---

## 10. Key Takeaways

1. **`.opencode/` uses plural subdirectory names** (agents, plugins, tools, etc.)
2. **Config files are merged**, not replaced — later override earlier for conflicting keys
3. **8-layer config precedence** from remote organizational defaults to managed MDM settings
4. **Agents can be JSON or Markdown** — Markdown files use YAML frontmatter
5. **File name = agent/tool/command name** in directory-based configs
6. **Custom tools override built-ins** when same name
7. **Global + project directories coexist** — global loaded first, project overrides
8. **Discovery traverses up** from current directory to nearest Git root
