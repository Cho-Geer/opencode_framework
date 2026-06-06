# OpenCode Permissions Documentation
Source: https://opencode.ai/docs/permissions/
Fetched: 2026-06-05
Tool: webfetch

## Overview
OpenCode uses the `permission` config to decide whether a given action should run automatically, prompt you, or be blocked.

As of v1.1.1, legacy `tools` boolean config is deprecated and merged into `permission`.

## Actions
Each permission rule resolves to one of:
- `"allow"` — run without approval
- `"ask"` — prompt for approval
- `"deny"` — block the action

## Configuration

### Global Config
```json
{
  "permission": {
    "*": "ask",
    "bash": "allow",
    "edit": "deny"
  }
}
```

Set all at once:
```json
{ "permission": "allow" }
```

### Granular Rules (Object Syntax)
Apply different actions based on the tool input:
```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "git *": "allow",
      "npm *": "allow",
      "rm *": "deny",
      "grep *": "allow"
    },
    "edit": {
      "*": "deny",
      "packages/web/src/content/docs/*.mdx": "allow"
    }
  }
}
```
Rules evaluated by pattern match, **last matching rule wins**. Common pattern: catch-all `"*"` first, specific rules after.

### Wildcards
- `*` matches zero or more of any character
- `?` matches exactly one character
- All other characters match literally

### Home Directory Expansion
- `~/projects/*` → `/Users/username/projects/*`
- `$HOME/projects/*` → `/Users/username/projects/*`

### External Directories
Use `external_directory` to allow tool calls that touch paths outside the working directory:
```json
{
  "permission": {
    "external_directory": {
      "~/projects/personal/**": "allow"
    }
  }
}
```
Any directory allowed here inherits same defaults as current workspace.

## Complete Permission Keys List

| Permission Key | Tools/Behavior It Gates | Granular (Object) Support |
|---|---|---|
| `read` | `read` | Yes (matches file path) |
| `edit` | `write`, `edit`, `apply_patch` | Yes (matches file path) |
| `glob` | `glob` | Yes (matches glob pattern) |
| `grep` | `grep` | Yes (matches regex pattern) |
| `list` | `list` | Yes |
| `bash` | `bash` | Yes (matches parsed commands like `git status --porcelain`) |
| `task` | `task` (launching subagents) | Yes (matches subagent type) |
| `external_directory` | Any tool touching paths outside project worktree | Yes |
| `todowrite` | `todowrite`, `todoread` | No (shorthand only) |
| `webfetch` | `webfetch` (matches URL) | No (shorthand only) |
| `websearch` | `websearch` (matches query) | No (shorthand only) |
| `lsp` | `lsp` | Currently non-granular |
| `skill` | `skill` (matches skill name) | No (shorthand only) |
| `question` | `question` | No (shorthand only) |
| `doom_loop` | Triggers when same tool call repeats 3x with identical input | No (shorthand only) |

**Total: 15 permission keys**

## Defaults
If nothing specified, permissive defaults:
- Most permissions default to `"allow"`
- `doom_loop` and `external_directory` default to `"ask"`
- `read` is `"allow"`, but .env files denied by default:
```json
{
  "permission": {
    "read": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    }
  }
}
```

## What "Ask" Does
When OpenCode prompts for approval, UI offers:
- `once` — approve just this request
- `always` — approve matching patterns (rest of session)
- `reject` — deny the request

## Per-Agent Permissions Override
Agent permissions merge with global config; agent rules take precedence:
```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "git *": "allow",
      "git commit *": "deny",
      "git push *": "deny",
      "grep *": "allow"
    }
  },
  "agent": {
    "build": {
      "permission": {
        "bash": {
          "*": "ask",
          "git *": "allow",
          "git commit *": "ask",
          "git push *": "deny",
          "grep *": "allow"
        }
      }
    }
  }
}
```

Agent permissions can also be configured in Markdown agent files:
```markdown
---
description: Code review without edits
mode: subagent
permission:
  edit: deny
  bash: ask
  webfetch: deny
---
```

### Important Notes
- Permission keys are matched as wildcard patterns against the underlying tool name
- Same syntax works for built-ins, custom tools, and MCP tools
- e.g., `"mymcp_*": "deny"` denies every tool from an MCP server
- e.g., `"mymcp_search": "ask"` targets a single tool
