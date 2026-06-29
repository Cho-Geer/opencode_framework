---
trigger: always_on
alwaysApply: true
---

# MCP调用合规自检指南

## MCP调用自检清单

- [ ] 已查阅`.opencode/rules/rule_detail/mcp-tool-inventory.md`中的工具清单（含MCP工具与OpenCode自定义工具）
- [ ] 已识别任务类型和关键词，匹配触发关键词
- [ ] 已创建"计划调用的MCP工具清单"并向用户展示确认
- [ ] 按优先级顺序调用工具（P0→P1→P2）
- [ ] 已调用 `compliance_gate_check(task_description)` 执行合规门禁检查（P0阻塞）
- [ ] 已向用户展示计划并获确认
- [ ] 已调用 `compliance_gate_confirm(plan_summary)` 武装合规门禁

## MCP调用运行时检查

- 开始任何任务：先规划并展示MCP工具调用计划
- 调用工具：验证符合`.opencode/rules/rule_detail/mcp-tool-inventory.md`中的流程要求

## MCP调用违规预防模式

1. 先规划后执行：任何任务开始前必须先展示MCP工具调用计划
2. 查阅`.opencode/rules/rule_detail/mcp-tool-inventory.md`优先：这是所有任务的第一步
3. 工具必须注册：所有MCP工具必须在`.opencode/rules/rule_detail/mcp-tool-inventory.md`中注册
4. 透明化监督：任务前展示计划，让用户监督工具调用过程
