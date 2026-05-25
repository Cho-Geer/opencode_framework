# MEMORY.md — Long-Term Memory

## User Preferences

- 简洁直接的指令式沟通，期望 AI 能从对话历史中推断上下文
- 执行前习惯先确认状态并获取摘要
- 偏好双语输出（英文技术细节、中文结构化总结）及表格化呈现
- 在 AI 响应停滞时会直接下达强制指令（Repair/Execute）推进流程

## Project Conventions

- **Git branch**: `workbuddy_framework` — the framework development branch
- **Commit pattern**: Frequent small commits with `feat:` / `docs:` / `fix:` prefixes
- **Push after every commit**: Always push to `origin/workbuddy_framework`
- **Working memory**: Daily log files in `.workbuddy/memory/YYYY-MM-DD.md`

## Technical Notes (2026-05-25)

- **CJK detection**: Initial Unicode range scans (U+4E00-U+9FFF) are unreliable — box-drawing chars (─, ═), arrows, and emoji produce massive false positives. Use word-level detection with common Chinese characters (的, 是, 在) instead.
- **MCP SDK**: `@modelcontextprotocol/sdk` must use sub-path imports (`/server/index.js`, etc.) — root require fails. Known issue WV-2026-006.
- **PowerShell heredoc**: Multi-line `@"..."@` commit messages break on special chars — use simple single-line messages.
- **Background agents**: Not reliable for large file translations — prefer direct Read+Translate+Write.
