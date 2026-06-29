---
name: customize-opencode
display_name: OpenCode 框架定制
category: P1-领域专业类
description: OpenCode 框架配置定制——编辑 opencode.json、agent .md 配置、rules 目录结构、plugin 注册。当用户提到"修改 Agent 配置"、"调整权限矩阵"、"添加 Agent"、"修改 rules"、"调整框架配置"时触发。
trigger_keywords:
  - 修改 Agent 配置
  - 调整权限矩阵
  - 添加 Agent
  - 修改 rules
  - 调整框架配置
  - opencode.json 编辑
  - customize opencode
priority: P1
core_features:
  - opencode.json 全局配置编辑（instructions, compaction, default_agent）
  - Agent 生命周期管理（新增/退役 agent, 修改 mode/model/permission）
  - 权限矩阵维护（tool allow/deny, skill allow/deny, task dispatch 策略）
  - Rules 目录结构管理（common/coding/rule_detail 分层）
  - Plugin 注册与排序（plugin 数组增删, 执行顺序调整）
  - project.config.json 维护（tech_stack, context7_task_mapping, template 变量）
always_first: false
status: active
added_date: 2026-06-29
added_by: system
---

# OpenCode 框架定制 Skill

本 Skill 覆盖 OpenCode 框架配置层面的定制操作。仅 @Super-Admin 有权执行这些操作。

## 核心配置文件

### opencode.json（项目根目录）
- `instructions`: 全局 system prompt 加载的文件 glob（当前: AGENTS.md + rules/common/ + rules/rule_detail/）
- `agent.{name}`: 每个 Agent 的 mode/model/permission 配置
- `plugin`: 插件加载数组（顺序决定执行优先级）
- `mcpServers`: MCP Server 注册（endpoint, env, tools）
- `compaction`: 上下文压缩策略

### Agent .md（.opencode/agents/{Name}.md）
- frontmatter 字段: name, description, mode, model, skills, mcp_tools, permission
- 两层配置独立: opencode.json 控制访问权限, agent .md 控制能力声明
- 修改后必须两层同步

### project.config.json（.opencode/project.config.json）
- tech_stack: 项目技术栈定义
- context7_task_mapping: Context7 查询映射
- template 变量: 供 rules/agents 中 {{variable}} 引用

## 操作规范

1. **修改前**: 读取当前配置，确认变更范围
2. **变更中**: 保持 JSON 格式合法（trailing comma 容忍但避免）
3. **变更后**: 运行 `bun .opencode/scripts/framework-self-test.ts` 验证完整性
4. **Agent 新增**: 需同步更新 opencode.json permission + agent .md + rules（如需要）
5. **Agent 退役**: 需同步清理 opencode.json + agent .md + plugin 引用 + dispatch 路由

## 约束

- 修改 opencode.json 后必须验证 JSON 合法性
- 修改 plugin 数组后必须 `rm -rf ~/.cache/bun` 再验证所有 plugin 加载
- 修改 agent .md frontmatter 后必须确认 skills/mcp_tools 列表与实际目录一致
- 禁止在未经 @Arbiter 批准的情况下修改 enforcement_mode
