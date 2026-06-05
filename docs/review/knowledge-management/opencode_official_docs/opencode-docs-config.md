# OpenCode Official Docs: Config
Source: https://opencode.ai/docs/config/
Fetched: 2026-06-05

## Key Points for UC7KS Cross-Reference

1. Config file: opencode.json (or opencode.jsonc)
2. Precedence: Remote (.well-known) → Global (~/.config/opencode/) → Custom (OPENCODE_CONFIG) → Project (opencode.json) → .opencode/ → Inline
3. instructions field: array of paths/glob patterns to instruction files
4. plugin field: npm packages to load as plugins
5. mcp field: MCP server configuration
6. agent field: agent configuration
7. Variables: {env:VAR_NAME}, {file:path/to/file}
8. Various config sections: server, shell, models, policies, themes, commands, keybinds, formatters, lsp, permissions, compaction, watcher
