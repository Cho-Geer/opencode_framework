---
type: model_decision
description: When writing or reviewing tests
---

# 测试代码规范引用

本文档引用 `.qoder/context/code_standards/testing-coding-standard.md` 中的全部规范。

## 适用范围

所有涉及前后端项目的测试编写、测试审查、测试策略制定任务必须遵循该规范。各项目应根据自身技术栈替换 `context/code_standards/testing-coding-standard.md` 中的内容。

## 强制触发 Agent

| Agent          | 触发场景                                       |
| -------------- | ---------------------------------------------- |
| **@Coder-BE**  | 后端单元/集成测试编写、覆盖率验证              |
| **@Coder-FE**  | 前端单元/集成测试编写、覆盖率验证              |
| **@Guardian**  | 测试代码审查（假性检测、覆盖率合规、测试质量） |
| **@Architect** | 测试架构设计、E2E 关键用例审查                 |

## 核心规范速查

1. **测试唯一价值**：测试的唯一价值在于发现 Bug，严禁编写假性测试
2. **TDD 铁律**：RED → GREEN → REFACTOR，无测试不开发
3. **测试奖杯模型**：40% 单元 + 40% 集成 + 20% E2E
4. **覆盖率要求**：整体 ≥70%，核心模块 ≥90%
5. **变异测试**：杀除率 ≥80%（核心模块），每日定时执行
6. **假性测试禁令**：空断言、仅测 Getter/Setter、过度 Mock、Mock 不验证、耦合实现细节
7. **数据隔离**：每个测试使用独立数据，Testcontainers 优先
8. **关键 E2E**：并发预约抢占测试为系统最关键 E2E 用例，修改需架构师审查
9. **缺陷不复发**：每个缺陷修复必须附带至少 1 个新测试用例
10. **CI 门禁**：单元/集成测试 100% 通过，覆盖率达标，变异测试不阻塞常规 PR

## 完整文档

完整规范请参阅：[测试代码规范文档](.qoder/context/code_standards/testing-coding-standard.md)
