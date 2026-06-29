---
trigger: always_on
alwaysApply: true
---
# 通用项目执行核心规则（最高优先级，所有Agent强制遵守）

## 一、核心原则强制原则
- **Skill前置强制**：任务启动必先查阅 `.opencode/rules/rule_detail/skill-invocation-standard.md` 并按规范执行。
- **MCP前置强制**：必先查阅 `.opencode/rules/rule_detail/mcp-tool-inventory.md` ，信息未集严禁开工。
- **唯一主流程**：查阅 `.opencode/rules/rule_detail/skill-invocation-standard.md`和`.opencode/rules/rule_detail/mcp-tool-inventory.md` → 生成清单 → MCP调用（阻塞） → 技术分析 → 设计实现 → TDD验证 → 部署验证，严禁跳步。
- **确认**：项目类型、技术栈、对应MCP工具链。
- **硬性阻塞**：MCP未全员成功、测试覆盖率<85%、安全漏洞未修，严禁进入下一阶段；清单驱动；决策必录。
- **合规门禁强制**：所有任务必须依次调用 `compliance_gate_check(task_description)` → 展示计划待用户确认 → `compliance_gate_confirm(plan_summary)`，合规门未武装禁止进入设计/编码阶段。
- **失败处理**：重试3次→官方文档替代→MCP恢复后补全验证
  - 任一MCP调用失败后，必须立即暂停所有后续任务，只有当前失败的MCP项解决后才能继续。
- **状态门禁**：所有MCP调用项必须达到"成功"或"已通过替代方案解决"状态，才能进入分析阶段。
- **状态机强制同步**：所有任务状态变更必须符合 `.opencode/state/machine.json` 中定义的生命周期转换规则，且必须提供转换所需的全部证据文件。Git Pre-commit Hook 将强制执行此校验，违反规则的提交将被拒绝。

## 二、详细规则引用（与本文件同等强制力）
所有Agent必须严格遵循 `.opencode/rules/rule_detail/` 下的全套文档：
- mcp-tool-inventory.md
- skill-invocation-standard.md
- dag-generation-standard.md（DAG 制定标准，@Meta-Planner 强制遵循）
- state-machine-standard.md（状态机定义与转换规则）
所有Agent必须严格遵循 `.opencode/context/requirements/` 下的全部项目文档（README.md, SAD, API规范, 安全规范, 数据规范, 测试策略, 部署文档等）。各项目应根据自身技术栈和架构在 `context/requirements/` 中放置对应的需求文档。

## 三、优先级说明
本规则 > 详细规则 > Agent配置 > 默认指令，任何冲突以本规则为准
