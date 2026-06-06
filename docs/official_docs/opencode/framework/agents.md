# OpenCode Agents Documentation
Source: https://opencode.ai/docs/agents/
Fetched: 2026-06-05
Tool: webfetch

## Overview
Agents are specialized AI assistants that can be configured for specific tasks and workflows. They allow creating focused tools with custom prompts, models, and tool access.

Use the plan agent to analyze code and review suggestions without making code changes. Switch between agents during a session or invoke them with `@` mention.

## Types

### Primary Agents
Main assistants you interact with directly. Cycle through using Tab key or configured `switch_agent` keybind. Handle main conversation. Tool access configured via permissions.

### Subagents
Specialized assistants that primary agents can invoke for specific tasks. Also manually invoked by `@mentioning`.
Built-in: General, Explore, Scout.

## Built-in Agents

| Agent | Mode | Description |
|-------|------|-------------|
| Build | Primary | Default primary agent with all tools enabled. Full dev work. |
| Plan | Primary | Restricted agent for planning/analysis. All writes/patches/edits and bash set to `ask`. |
| General | Subagent | General-purpose agent for researching complex questions and multi-step tasks. Full tool access (except todo). |
| Explore | Subagent | Fast, read-only agent for exploring codebases. Cannot modify files. |
| Scout | Subagent | Read-only agent for external docs and dependency research. Can clone repos into managed cache. |
| Compaction | Primary (hidden) | System agent that compacts long context into smaller summary. Runs automatically. |
| Title | Primary (hidden) | Generates short session titles. Runs automatically. |
| Summary | Primary (hidden) | Creates session summaries. Runs automatically. |

## Configure

### JSON Config
```json
{
  "agent": {
    "build": {
      "mode": "primary",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "{file:./prompts/build.txt}",
      "permission": { "edit": "allow", "bash": "allow" }
    },
    "code-reviewer": {
      "description": "Reviews code for best practices",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "You are a code reviewer...",
      "permission": { "edit": "deny" }
    }
  }
}
```

### Markdown Config
Place in `~/.config/opencode/agents/` (global) or `.opencode/agents/` (per-project):
```markdown
---
description: Reviews code for quality and best practices
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
permission:
  edit: deny
  bash: deny
---
You are in code review mode...
```

## Options Reference

| Option | Type | Description |
|--------|------|-------------|
| description | string | **Required** - Brief description of what the agent does |
| temperature | number | 0.0-1.0 (lower = more focused, higher = more creative) |
| steps | number | Max agentic iterations before forced text-only response |
| disable | boolean | Set to true to disable the agent |
| prompt | string | Custom system prompt file (`{file:./path}`) |
| model | string | Override model for this agent |
| permission | object | Permission overrides per agent |
| mode | string | `primary`, `subagent`, or `all` (default) |
| hidden | boolean | Hide subagent from `@` autocomplete (only for `mode: subagent`) |
| task.permission | object | Control which subagents an agent can invoke via Task tool |
| color | string | Hex color or theme color for UI |
| top_p | number | 0.0-1.0 alternative to temperature |

## Permissions (See Also permissions.md)
Each permission key: `ask`, `allow`, `deny`.
Keys: read, edit, glob, grep, bash, task, skill, lsp, question, webfetch, websearch, external_directory, doom_loop, todowrite

Agent permissions merge with global config; agent rules take precedence.

### Task Permissions
Control which subagents an agent can invoke:
```json
{
  "agent": {
    "orchestrator": {
      "permission": {
        "task": {
          "*": "deny",
          "orchestrator-*": "allow",
          "code-reviewer": "ask"
        }
      }
    }
  }
}
```
Rules evaluated in order, last matching wins. `deny` removes subagent from Task tool description entirely.

### Bash Command-Level Permissions
```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "git *": "allow",
      "git commit *": "deny"
    }
  }
}
```

## Create Agents
Command: `opencode agent create` — interactive, generates markdown file with agent configuration.
