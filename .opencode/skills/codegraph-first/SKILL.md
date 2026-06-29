---
name: "codegraph-first"
description: "在修改代码前强制使用 CodeGraph 进行影响分析。适用于所有涉及代码修改的任务——编码、调试、重构、架构变更、删除文件、恢复备份、shell 命令修改。触发关键词：修改、编辑、重构、修复、实现、添加函数、删除、恢复、safe_edit、safe_delete、safe_restore、safe_shell。当 Agent 调用任何代码修改工具时自动触发此 Skill。"
version: 1.1.0
---

# codegraph-first — 修改前影响分析

## 触发条件

任何涉及代码文件修改的任务。当 Agent 准备调用以下工具时，必须先完成本 Skill 的影响分析流程：

- **safe_edit** — 编辑或覆写代码文件
- **safe_delete** — 删除代码文件
- **safe_restore** — 从备份恢复（覆写）代码文件
- **safe_shell** — 通过 shell 命令修改文件（cp、mv、sed、node 脚本等）

## 执行流程

### Step 1: 修改前影响分析（必须）

在调用任何代码修改工具之前，必须完成以下步骤：

1. 使用 codegraph_search 定位目标符号（函数名、类名、变量名）
2. 使用 codegraph_impact 评估修改影响范围
3. 阅读影响范围内的关键关联文件
4. 如果影响范围超过 3 个文件，在修改前向用户确认

### Step 2: 修改中上下文获取（按需）

需要理解调用关系时：

1. 使用 codegraph_callers 查看谁调用了目标函数
2. 使用 codegraph_callees 查看目标函数调用了什么
3. 使用 codegraph_node 获取相关符号的源码

### Step 3: 修改后验证（推荐）

修改完成后：

1. 再次使用 codegraph_impact 确认影响范围未超出预期
2. 检查是否有遗漏的关联更新

## 与 UC7KS 的关系

- 需要外部库文档 → 走 UC7KS 流程（context7 / webfetch / websearch）
- 需要理解代码结构 → 用 CodeGraph
- 两者互补，不冲突

## 豁免条件

以下情况可以跳过 CodeGraph 影响分析：

- 修改 .task_temp/ 下的临时文件
- 修改 docs/ 下的文档文件
- 修改 .opencode/agents/*.md 的 prompt 文本（非结构性变更）
- 纯注释修改或格式调整（不涉及逻辑变更）
- @Super-Admin 执行框架紧急修复

## 硬约束机制

codegraph-enforce.ts 插件会在 tool.execute.before 阶段拦截上述 4 个工具。
如果当前 session 中未调用过 codegraph_impact，工具调用将被阻断并抛出错误。
状态记录在 .task_temp/.codegraph-impact-sessions.json 中。

## 注意

CodeGraph 查询的是本地代码结构知识（Tree-sitter 索引），与 UC7KS 的外部文档知识互补。
如果 CodeGraph 索引过期（codegraph_status 显示 Pending Changes），建议先运行 codegraph sync 更新索引。
CodeGraph 的 file watcher 会在代码文件变更后自动重索引，无需手动同步。
