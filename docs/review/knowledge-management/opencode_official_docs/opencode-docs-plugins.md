# OpenCode Official Docs: Plugins
Source: https://opencode.ai/docs/plugins/
Fetched: 2026-06-05

## Key Points for UC7KS Cross-Reference

1. Local plugins: .opencode/plugins/ or ~/.config/opencode/plugins/
2. NPM plugins: specified in plugin array in opencode.json
3. Plugin functions receive context: project, client, $, directory, worktree
4. Event hooks: tool.execute.before, tool.execute.after, session.*, permission.*, etc.
5. Custom tools can be created via plugins
6. Compaction hooks available (experimental.session.compacting)
7. Plugins could be used to implement UC7KS enforcement (intercepting tool calls)
