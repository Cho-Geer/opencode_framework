# OpenCode Official Docs: Tools
Source: https://opencode.ai/docs/tools/
Fetched: 2026-06-05

## Key Points for UC7KS Cross-Reference

### Built-in Tools:
- bash, edit, write, read, grep, glob, lsp (experimental), apply_patch, skill, todowrite, webfetch, websearch, question

### websearch IMPORTANT NOTE:
"This tool is only available when using the OpenCode provider or when the OPENCODE_ENABLE_EXA environment variable is set to any truthy value."

### webfetch:
Allows LLM to fetch and read web pages.

### question:
Allows LLM to ask user questions during execution.

### todowrite:
"Disabled for subagents by default, but you can enable it manually."

### Permissions:
- Uses permission field with allow/ask/deny
- Glob patterns supported
- Legacy tools boolean deprecated
