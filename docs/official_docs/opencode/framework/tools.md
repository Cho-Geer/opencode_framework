# OpenCode Tools Documentation
Source: https://opencode.ai/docs/tools/
Fetched: 2026-06-05
Tool: webfetch

## Overview
Tools allow the LLM to perform actions in your codebase. OpenCode comes with a set of built-in tools, but you can extend it with custom tools or MCP servers.

By default, all tools are **enabled** and don't need permission to run. You control tool behavior through permissions.

## Configure
Use the `permission` field to control tool behavior (allow, deny, require approval):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "edit": "deny",
    "bash": "ask",
    "webfetch": "allow"
  }
}
```

Use wildcards to control multiple tools at once:
```json
{
  "permission": {
    "mymcp_*": "ask"
  }
}
```

## Built-in Tools (Complete List)

### bash
Execute shell commands in your project environment.
Permission key: `"bash"`

### edit
Modify existing files using exact string replacements.
Permission key: `"edit"`

### write
Create new files or overwrite existing ones. (Controlled by the `edit` permission — `edit`, `write`, `apply_patch` are all covered together.)

### read
Read file contents from your codebase. Supports reading specific line ranges.
Permission key: `"read"`

### grep
Search file contents using regular expressions. Fast content search across your codebase.
Permission key: `"grep"`

### glob
Find files by pattern matching (e.g., `**/*.js`).
Permission key: `"glob"`

### lsp (experimental)
Interact with configured LSP servers for code intelligence (definitions, references, hover, etc.)
Only available when `OPENCODE_EXPERIMENTAL_LSP_TOOL=true` (or `OPENCODE_EXPERIMENTAL=true`).
Permission key: `"lsp"`

### apply_patch
Apply patches to files. Controlled by the `edit` permission.
When handling `tool.execute.before`/`after`, check `input.tool === "apply_patch"`.
Uses `output.args.patchText` instead of `output.args.filePath`.

### skill
Load a skill (SKILL.md file) and return its content.
Permission key: `"skill"`

### todowrite
Manage todo lists during coding sessions.
Disabled for subagents by default, but can be enabled manually.
Permission key: `"todowrite"`

### webfetch
Fetch web content. For looking up documentation or researching online resources.
Permission key: `"webfetch"`

### websearch
Search the web for information. Only available when using the OpenCode provider or when `OPENCODE_ENABLE_EXA=1`.
Permission key: `"websearch"`

### question
Ask the user questions during execution.
Permission key: `"question"`

## Custom Tools
Custom tools let you define your own functions that the LLM can call. Defined in your config file.

## MCP Servers
MCP (Model Context Protocol) servers allow external tools and services.

## Internals
- `grep` and `glob` use ripgrep under the hood
- ripgrep respects `.gitignore` patterns by default
- Use `.ignore` file in project root to include normally-ignored files
