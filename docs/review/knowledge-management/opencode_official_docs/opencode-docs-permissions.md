# OpenCode Official Docs: Permissions
Source: https://opencode.ai/docs/permissions/
Fetched: 2026-06-05

## Key Points for UC7KS Cross-Reference

1. Permission actions: allow, ask, deny
2. Granular object syntax with wildcards/glob patterns
3. Last matching rule wins (order matters)
4. Defaults: most permissions default to allow; doom_loop and external_directory default to ask
5. Read defaults: allow for most files, but .env files are denied by default
6. Agent permissions override global and merge (agent takes precedence)

### Available Permission Keys:
read, edit, glob, grep, bash, task, skill, lsp, question, webfetch, websearch, external_directory, doom_loop

### "task" permission:
Controls which subagents an agent can invoke via the Task tool. Glob patterns supported.

### "external_directory" permission:
Controls access to paths outside the working directory.
