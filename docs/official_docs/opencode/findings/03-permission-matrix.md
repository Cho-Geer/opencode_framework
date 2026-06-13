# OpenCode Permission Matrix — Full Schema & Agent-Override Mechanism

**Date**: 2026-06-11
**Source**: Official OpenCode docs (opencode.ai) — permissions.md, agents.md, config.md
**Cache sources**: permissions.md, config.md, agents.md, tools.md

---

## 1. Permission Model Overview

OpenCode uses a **three-tier permission model** to control all tool operations:

### Three Actions

| Action | Meaning |
|--------|---------|
| `"allow"` | Run without approval |
| `"ask"` | Prompt for approval before running |
| `"deny"` | Block the action entirely |

### Two Syntaxes

```json
// Shorthand — applies to ALL inputs
{ "permission": { "edit": "deny" } }

// Granular (Object) — different rules per input pattern
{ "permission": { "bash": { "*": "ask", "git *": "allow" } } }
```

---

## 2. Complete Permission Keys (15 Total)

| Key | Gates | Granular? | Shorthand? |
|-----|-------|-----------|------------|
| `read` | `read` tool (file paths) | ✅ Yes (path patterns) | ✅ |
| `edit` | `write`, `edit`, `apply_patch` | ✅ Yes (file paths) | ✅ |
| `glob` | `glob` tool (glob patterns) | ✅ Yes (glob pattern) | ✅ |
| `grep` | `grep` tool (regex patterns) | ✅ Yes (regex pattern) | ✅ |
| `list` | `list` tool | ✅ Yes | ✅ |
| `bash` | `bash` tool (parsed commands) | ✅ Yes (command patterns) | ✅ |
| `task` | `task` tool (subagent type) | ✅ Yes (agent name glob) | ✅ |
| `external_directory` | Any tool touching paths outside worktree | ✅ Yes (path glob) | ✅ |
| `todowrite` | `todowrite`, `todoread` | ❌ No | ✅ |
| `webfetch` | `webfetch` (URL patterns) | ❌ No | ✅ |
| `websearch` | `websearch` (query patterns) | ❌ No | ✅ |
| `lsp` | `lsp` tool | Currently non-granular | ✅ |
| `skill` | `skill` tool (skill name) | ❌ No | ✅ |
| `question` | `question` tool | ❌ No | ✅ |
| `doom_loop` | Same tool call repeated 3x | ❌ No (shorthand only) | ✅ |

### Granular vs Shorthand Decision

| Permission Key | Can Use Object Syntax? |
|---------------|----------------------|
| `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `lsp`, `skill` | ✅ Yes |
| `todowrite`, `webfetch`, `websearch`, `question`, `doom_loop` | ❌ No (shorthand only) |

---

## 3. Granular Rule Evaluation

### Pattern Matching Rules

- `*` matches zero or more of any character
- `?` matches exactly one character
- Other characters match literally
- **Last matching rule wins** (NOT first-match)

### Bash Command Granular Example

```json
{
  "permission": {
    "bash": {
      "*": "ask",          // catch-all: ask for any command
      "git *": "allow",    // git commands: auto-approve
      "rm *": "deny",      // rm commands: block
      "grep *": "allow"    // grep commands: auto-approve
    }
  }
}
```

Last matching rule wins: `rm -rf` matches `"*": "ask"` first, then `"rm *": "deny"` → **deny** wins.

### File Path Granular Example

```json
{
  "permission": {
    "edit": {
      "*": "deny",
      "packages/web/src/content/docs/*.mdx": "allow"
    }
  }
}
```

### MCP Tool Patterns

```json
{
  "permission": {
    "mymcp_*": "deny",         // Deny ALL tools from mymcp server
    "mymcp_search": "ask"      // Except this specific tool (last match wins)
  }
}
```

Permission keys are matched as **wildcard patterns against the underlying tool name**. Same syntax works for built-ins, custom tools, and MCP tools.

---

## 4. Default Permissions

If nothing is specified, OpenCode starts from permissive defaults:

| Permission | Default |
|------------|---------|
| Most permissions | `"allow"` |
| `doom_loop` | `"ask"` |
| `external_directory` | `"ask"` |
| `read` | `"allow"` (except `.env` files denied by default) |

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

---

## 5. Per-Agent Permission Override (Agent-Override Mechanism)

### JSON Config Override

Agent permissions **merge with global config**; agent rules **take precedence**:

```json
{
  "permission": {
    "bash": { "*": "ask", "git *": "allow" },
    "edit": "deny"
  },
  "agent": {
    "build": {
      "permission": {
        "bash": { "*": "ask", "git *": "allow", "git commit *": "ask" },
        "edit": "allow"
      }
    },
    "review": {
      "permission": {
        "bash": { "*": "ask", "grep *": "allow" },
        "edit": "deny"
      }
    }
  }
}
```

### Markdown Agent Permissions

```markdown
---
description: Code review without edits
mode: subagent
permission:
  edit: deny
  bash:
    "*": ask
    "git diff": allow
    "grep *": allow
  webfetch: deny
---
Only analyze code and suggest changes.
```

### Task Permissions (Subagent Invocation Control)

Control which subagents an agent can invoke via the `Task()` tool:

```json
{
  "agent": {
    "orchestrator": {
      "permission": {
        "task": {
          "*": "deny",                  // Deny all by default
          "orchestrator-*": "allow",    // Allow orchestrator-* agents
          "code-reviewer": "ask"        // Ask for code-reviewer
        }
      }
    }
  }
}
```

Rules evaluated in order, **last matching wins**. `"deny"` removes the subagent from the `Task()` tool description entirely.

### Agent-Level Tool Override

```json
{
  "tools": { "my-mcp*": false },
  "agent": {
    "my-agent": { "tools": { "my-mcp*": true } }
  }
}
```

---

## 6. External Directory Permission

Allows tool calls touching paths **outside the working directory**:

```json
{
  "permission": {
    "external_directory": {
      "~/projects/personal/**": "allow"
    }
  }
}
```

Any directory allowed here inherits same defaults as the current workspace. Home expansion (`~` / `$HOME`) is supported.

---

## 7. Permission Evaluation Flow

```
1. Start with global permission defaults
2. Merge global explicit permission rules
3. Merge agent-specific permission overrides (agent rules win)
4. Evaluate granular patterns: last matching rule wins
```

---

## 8. What "Ask" Does in the UI

When the tool requires approval:

| Option | Effect |
|--------|--------|
| `once` | Approve just this one request |
| `always` | Approve matching patterns for rest of session |
| `reject` | Deny the request |

---

## 9. Key Takeaways

1. **15 permission keys** total (read, edit, glob, grep, list, bash, task, external_directory, todowrite, webfetch, websearch, lsp, skill, question, doom_loop)
2. **9 keys support granular object syntax** with glob pattern matching
3. **Last matching rule wins** — put catch-all `"*"` first, specifics after
4. **Agent permissions override global** — merge, not replace
5. **`deny` on task removes** subagent from Task tool description entirely
6. **Wildcards work for MCP tools** — `"mymcp_*": "deny"` blocks entire server
7. **`.env` files** are denied by default for `read`
8. **`external_directory`** defaults to `"ask"` — must explicitly allow external paths
