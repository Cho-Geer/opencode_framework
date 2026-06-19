# OpenCode Permissions — Official Documentation

**Source**: https://opencode.ai/docs/permissions/
**Fetched**: 2026-06-19
**Tool**: webfetch

## Overview
OpenCode uses the `permission` config to decide whether a given action should run automatically, prompt you, or be blocked.

## Actions
Each permission rule resolves to one of:
- `"allow"` — run without approval
- `"ask"` — prompt for approval
- `"deny"` — block the action

## Configuration
```json
{
  "permission": {
    "*": "ask",
    "bash": "allow",
    "edit": "deny"
  }
}
```

## Granular Rules (Object Syntax)
```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "git *": "allow",
      "npm *": "allow",
      "rm *": "deny"
    }
  }
}
```

Rules are evaluated by pattern match, with the **last matching rule winning**.

## Available Permissions
- `read` — reading a file (matches the file path)
- `edit` — all file modifications (covers `edit`, `write`, `patch`)
- `glob` — file globbing (matches the glob pattern)
- `grep` — content search (matches the regex pattern)
- `bash` — running shell commands (matches parsed commands)
- `task` — launching subagents (matches the subagent type)
- `skill` — loading a skill (matches the skill name)
- `webfetch` — fetching a URL
- `websearch` — web search
- `external_directory` — triggered when tool touches paths outside project
- `doom_loop` — triggered when same tool call repeats 3x with identical input

## Agents
Agent permissions are merged with the global config, and agent rules take precedence.
```json
{
  "agent": {
    "build": {
      "permission": {
        "bash": {
          "git commit *": "deny",
          "git push *": "deny"
        }
      }
    }
  }
}
```

Agent permissions can also be configured in Markdown frontmatter:
```markdown
---
permission:
  edit: deny
  bash: ask
---
```
