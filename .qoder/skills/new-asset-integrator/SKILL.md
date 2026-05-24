---
name: "new-asset-integrator"
description: "Handles new MCP tool and skill integration workflows. Invoke when user mentions '新的MCP工具' or '新的skill追加'."
---

# 新资产集成器 (New Asset Integrator)

## 概述

本技能用于标准化地处理新MCP工具和新Skill的追加流程，确保所有操作符合项目规范和技术标准。当用户明确提及"新的MCP工具"或"新的skill追加"相关内容时，自动触发本技能的执行流程。

---

## 触发条件

### 关键词触发

当用户会话中包含以下关键词时自动触发：
- `新的MCP工具`
- `新的skill追加`
- `新MCP工具`
- `新skill追加`
- `添加MCP工具`
- `添加新skill`
- `new MCP tool`
- `new skill`

---

## 功能分析阶段

### 1. 全面收集并分析

在开始任何更新操作前，必须完成以下收集和分析：

#### 官方文档收集
- [ ] 收集新MCP工具的官方文档
- [ ] 收集新Skill的技术规格说明
- [ ] 收集使用案例和示例代码
- [ ] 收集版本信息和变更日志

#### 技术规格分析
- [ ] 明确新工具/skill的核心功能
- [ ] 明确适用场景
- [ ] 明确输入输出参数
- [ ] 明确调用方式
- [ ] 明确依赖关系

#### 兼容性评估
- [ ] 评估与现有系统的兼容性
- [ ] 评估潜在影响范围
- [ ] 评估安全影响
- [ ] 评估性能影响

---

## MCP工具更新流程

### 2. 更新 mcp-tool-inventory.md

当确认需要添加新的MCP工具时，按照以下步骤执行：

#### 步骤1：准备MCP工具元数据

使用以下模板准备新MCP工具的元数据：

```yaml
工具名称: mcp_tool_name
功能描述: 简短描述工具功能
适用场景: 列出适用的场景
版本信息: v1.0.0
调用示例: |
  示例代码或命令
合规要求: 列出合规要求
```

#### 步骤2：更新 mcp-tool-inventory.md

1. 在"一、当前项目可用MCP工具清单"中添加对应表格
2. 更新"二、MCP工具调用策略"中的映射关系
3. 添加调用示例和最佳实践
4. Reference `MCP_SETUP.md` at project root for MCP server configuration details

#### 步骤3：验证MCP工具更新

- [ ] 元数据格式正确
- [ ] 与现有条目保持一致
- [ ] 工具名称、功能描述、版本信息完整
- [ ] 调用示例清晰
- [ ] 合规要求明确

#### 步骤4：Update keystone hash (if file is keystone-protected)

If the new MCP tool's configuration file is listed in `machine.json` keystone hashes, update the hash:

```
run_in_terminal("node .qoder/scripts/mcp-tools/keystone-validate.js --hash <file>")
```

This ensures the keystone integrity check passes on the next compliance gate.

---

## Skill更新流程

### 3. 更新 skill-invocation-standard.md

当确认需要添加新的Skill时，按照以下步骤执行：

#### 步骤1：准备Skill元数据

使用以下模板准备新Skill的元数据：

```yaml
skill_name: skill-id
display_name: 显示名称
category: 类别  # P0-基础检查类 / P1-领域专业类 / P1-分析设计类 / P2-技术栈类 / P2-工具创建类
description: 简短描述，1-2句话
trigger_keywords:
  - 关键词1
  - 关键词2
use_cases:
  - 适用场暯1
  - 适用场暯2
priority: P0/P1/P2
core_features:
  - 核心功能1
  - 核心功能2
always_first: false
status: active
added_date: YYYY-MM-DD
added_by: 添加者标识
```

#### 步骤2：创建Skill文件并注册

1. Create the Skill file at `.qoder/skills/{skill-id}/SKILL.md` using `create_file`
2. Verify the skill is discoverable by invoking `Skill("{skill-id}")` via Qoder's Skill tool
3. 在"三、已注册Skill清单"的"3.1 Skill注册表格"中添加一行
4. 在"四、各Skill详细元数据"中添加完整的元数据YAML块
5. 更新 execution-preflight-check/SKILL.md 中的任务分类表格
6. 更新 execution-preflight-check/SKILL.md 中的添加新技能步骤
7. 在"六、常见任务的Skill组合推荐"中酌情添加相关组合（如适用）
8. 在"八、实际案例分析"中酌情添加案例（如适用）

#### 步骤3：验证Skill更新

- [ ] 元数据格式正确
- [ ] 与现有条目保持一致
- [ ] 分类选择合理
- [ ] 触发关键词清晰
- [ ] 显示名称友好
- [ ] 日期格式正确（YYYY-MM-DD）
- [ ] skill-invocation-standard.md 版本号已更新

---

## 验证要求

### 4. 功能验证测试

完成更新后，必须进行功能验证测试：

#### 验证清单

- [ ] 新添加的内容能够被系统正确识别
- [ ] 新添加的内容能够被正确调用
- [ ] 关键词触发正常工作
- [ ] 元数据解析正确

### 5. 文档完整性和一致性检查

#### mcp-tool-inventory.md 检查

- [ ] 格式与现有条目保持一致
- [ ] 工具名称、功能描述完整
- [ ] 版本信息、调用示例、合规要求完整
- [ ] 内容一致性验证通过

#### skill-invocation-standard.md 检查

- [ ] 格式与现有条目保持一致
- [ ] 工具名称、功能描述、版本信息完整
- [ ] 调用示例、合规要求完整
- [ ] 内容一致性验证通过

#### execution-preflight-check/SKILL.md 检查

- [ ] 任务分类表格已更新
- [ ] 添加新技能步骤已更新
- [ ] 与 skill-invocation-standard.md 内容一致

### 6. 安全标准和合规要求确认

- [ ] 所有更新符合项目安全标准
- [ ] 所有更新符合项目合规要求
- [ ] 无安全漏洞引入
- [ ] 无合规问题引入

---

## 标准操作流程总结

### 完整流程

```
用户提及"新的MCP工具"或"新的skill追加"
    ↓
触发 new-asset-integrator Skill (via Qoder `Skill` tool)
    ↓
功能分析阶段
    ↓
判断是MCP工具还是Skill
    ↓
    ├─ MCP工具 → 更新 mcp-tool-inventory.md + MCP_SETUP.md
    │                ↓
    │     Update keystone hash: run_in_terminal("node .qoder/scripts/mcp-tools/keystone-validate.js --hash <file>")
    │
    └─ Skill → Create `.qoder/skills/{skill-id}/SKILL.md` via `create_file`
              ↓
              Verify via Qoder `Skill("{skill-id}")` tool
              ↓
              更新 skill-invocation-standard.md
              ↓
              更新 execution-preflight-check/SKILL.md
    ↓
验证要求
    ↓
完成
```

---

## 相关资源

- [mcp-tool-inventory.md](.qoder/rules/rule_detail/mcp-tool-inventory.md) - MCP工具清单
- [skill-invocation-standard.md](.qoder/rules/rule_detail/skill-invocation-standard.md) - Skill调用标准化规范
- [execution-preflight-check/SKILL.md](.qoder/skills/execution-preflight-check/SKILL.md) - 执行前置检查Skill
- [MCP_SETUP.md](MCP_SETUP.md) - MCP server configuration and setup guide

---

**最后更新**: 2026-04-10
**维护者**: DevOps Team
**版本**: v1.0.0
