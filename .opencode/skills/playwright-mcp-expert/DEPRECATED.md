# DEPRECATED: playwright-mcp-expert

> **此 Skill 已被废弃。**

- **废弃日期**: 2026-05-18
- **废弃原因**: 该 Skill 为 `draft` 占位桩（19 行样板代码），从未实际开发。系统已内置原生 Playwright MCP 工具（`playwright_browser_*` 系列），此 Skill 完全冗余。
- **废弃决定**: @Arbiter 于 2026-05-18 UNIV-013 审计中批准废弃（TD-2026-006-DEPR）。
- **替代方案**: 直接使用系统内置的原生 Playwright MCP 工具（无需额外 Skill）：
  - `playwright_browser_navigate` — 页面导航
  - `playwright_browser_click` — 元素点击
  - `playwright_browser_type` — 文本输入
  - `playwright_browser_snapshot` — 页面快照
  - `playwright_browser_take_screenshot` — 截图
  - 以及其他 `playwright_browser_*` 工具
- **关联文档**:
  - `TECH_DEBT_REGISTRY.md` § TD-2026-006-DEPR
  - `.opencode/rules/rule_detail/skill-invocation-standard.md` §3.1
