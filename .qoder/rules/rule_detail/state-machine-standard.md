---
type: model_decision
description: When working with state machine transitions
---

# 状态机标准 v1.0

**制定时间**: 2026-04-20  
**版本**: v1.0.0  
**适用范围**: 所有使用多智能体协作的项目

---

## 一、概述

状态机是多智能体系统中强制执行物理约束的核心机制。它确保：

1. **契约变更可追溯**：任何对接口契约、数据模型的修改都必须同步更新哈希指纹。
2. **任务状态转换合法**：任务生命周期的每个状态变更都必须遵循预定义的路径，并附带必需的证据文件。

## 二、核心原则

### 2.1 单一事实来源

`.qoder/state/machine.json` 是状态机的**唯一配置来源**。所有校验规则均在此文件中定义，Git Hook 直接读取该文件执行校验。

### 2.2 物理强制

状态机规则通过 **Git Pre-commit Hook** 强制执行。任何违反规则的提交都将被拒绝，Agent 无法通过"声明"或"自述"绕过。

### 2.3 证据驱动

任务状态的每次转换都必须附带**可验证的证据文件**（如测试报告、审查报告）。证据文件的内容需符合 `machine.json` 中定义的 Schema 或内容模式。

## 三、状态机文件位置

| 文件            | 路径                                          | 用途                                                                                                                                                                                                                                                                                                            |
| :-------------- | :-------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **项目配置**    | `{project_root}/.qoder/state/machine.json` | 定义契约哈希、任务生命周期转换规则、证据要求。`project_root` 由 `project.config.json` 定义（如 `booking_system_refactor`）；若未定义则回退至 `.qoder/state/machine.json`。                                                                                                                                   |
| **Schema 校验** | `.qoder/state/machine.schema.json`         | 校验 `machine.json` 格式正确性。该 Schema 在 code-quality-gate.js bootstrap 阶段加载验证，确保所有 9 个子状态段（meta, eslint_state, type_check_state, dependency_state, format_state, write_audit_state, compliance_records, tdd_enforcement_state, contracts, keystone_hashes）的字段类型和必需字段符合规范。 |
| **执行器**      | `.qoder/hooks/pre-commit`                  | Git Hook，读取 `machine.json` 并执行校验                                                                                                                                                                                                                                                                        |

### 3.1 Schema 验证机制

`machine.schema.json` 基于 JSON Schema Draft 2020-12，在以下时机执行验证：

1. **Bootstrap 阶段**：`code-quality-gate.js` 的 `getMachine()` 函数在读取 `machine.json` 时自动加载 schema 进行格式验证，验证失败时输出警告但不会阻止启动（向后兼容）。
2. **Write-Time Audit**：每次 `run_write_check` 执行后，`updateStates()` 写入的 `machine.json` 必须符合 schema 定义，否则后续 bootstrap 验证会报警。
3. **Pre-Commit Hook**：Git Hook 在校验 `machine.json` 哈希同步性之前，可选择性地执行 schema 验证以确保文件结构完整。

Schema 覆盖的 9 个子状态段必须全部存在且类型正确，任何缺失或类型错误意味着状态机配置损坏。

## 四、通用配置结构

`machine.json` 必须包含以下核心部分：

| 字段                        | 必需 | 描述                                                          |
| :-------------------------- | :--- | :------------------------------------------------------------ |
| `meta`                      | ✅   | 元数据（版本、项目名、最后更新时间）                          |
| `contracts`                 | ✅   | 契约文件及其 SHA-256 哈希值                                   |
| `taskLifecycle`             | ✅   | 任务生命周期定义，包含状态列表和转换规则                      |
| `taskLifecycle.transitions` | ✅   | 转换规则数组，每条规则定义 `from`、`to` 及 `requiredEvidence` |

具体字段含义和示例请参考项目中的 `.qoder/state/machine.json`。

## 五、与 Git Hook 的协作

Git Pre-commit Hook 执行以下校验逻辑：

1. **契约哈希校验**：当 `contracts` 中定义的文件被修改时，验证 `machine.json` 中的哈希值是否同步更新且与实际文件哈希一致。
2. **任务生命周期校验**：当任务状态文件（如 `Task.DAG.json`）被修改时，验证状态转换路径是否合法，以及所需证据文件是否存在且内容符合要求。

任何一项校验失败，提交将被拒绝。

## 六、扩展性

- **新增契约类型**：在 `contracts` 中添加新条目即可。
- **新增任务状态或转换规则**：在 `taskLifecycle.transitions` 中追加规则。
- **增强证据校验**：在 `requiredEvidence` 中添加 `schema`、`contentMustContain` 等字段。

所有扩展仅需修改 `machine.json`，无需修改 Hook 脚本（Hook 脚本为通用实现）。

## 七、相关文档

| 文档                           | 关系                   |
| :----------------------------- | :--------------------- |
| `common-project.md`            | 引用本规范作为核心原则 |
| `.qoder/state/machine.json` | 项目具体配置实例       |
| `.qoder/hooks/pre-commit`   | 物理执行器             |

---

_本文档将根据状态机演进持续更新。_
