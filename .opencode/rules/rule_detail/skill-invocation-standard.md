
# Skill调用标准化规范

## 概述

本文档定义了在Trae IDE中执行任务时的Skill调用标准流程，确保每次任务都能正确、完整地调用相关Skill，提高任务执行质量和一致性。

**制定时间**: 2026-04-09  
**最后更新**: 2026-05-21  
**适用范围**: 所有在Trae IDE中执行的任务  
**版本**: v2.1.5（废弃nextjs-router-guardrails → fullstack-ci-cd-guardrails；prisma-seed-cicd重命名为cicd-database-seeding；注册新Skill cicd-database-seeding）

---

## 一、Skill调用的核心原则

### 1.1 强制性原则（不可违反）
- **Skill前置优先**：任何任务开始前必须先规划和调用相关Skill
- **不跳过、不遗漏**：确保所有适用的Skill都被调用
- **先规划、后执行**：先列出计划调用的Skill清单，获得确认后再执行
- **注册新Skill**：添加新Skill时必须更新本文档

### 1.2 质量保障原则
- **按优先级顺序调用**：先调用基础Skill，再调用专业Skill
- **每个Skill都有明确目的**：调用Skill时清楚知道它能提供什么帮助
- **有疑问时多调用**：不确定是否需要某个Skill时，优先调用而非跳过

### 1.3 扩展性原则
- **分类注册**：所有Skill必须按类别注册到本文档
- **元数据完整**：每个Skill必须提供完整的元数据（见下文）
- **向后兼容**：添加新Skill时不影响现有Skill的使用
- **易于扩展**：提供清晰的添加指南和模板

---

## 二、Skill分类体系

### 2.1 Skill分类定义

Skill按功能分为以下类别，添加新Skill时必须归类：

| 类别 | 类别描述 | 优先级范围 | 示例Skill |
|------|---------|-----------|----------|
| **P0 - 基础检查类** | 所有任务的前置检查，必须调用 | P0 | preflight-lite |
| **P1 - 领域专业类** | 特定技术领域的专业指导 | P1 | devops-ci-cd-guardrails, cross-directory-ci, context7-first |
| **P1 - 分析设计类** | 需求分析、方案设计、根因分析 | P1 | brainstorming |
| **P2 - 技术栈类** | 特定技术栈的专项支持 | P2 | ~~salesforce-dx-expert（❌废弃）~~, ~~playwright-mcp-expert（❌废弃）~~, ~~devops-architect（❌废弃）~~, learning-mode-executor |
| **P2 - 工具创建类** | 创建新工具、新Skill的支持 | P2 | skill-creator |

### 2.2 Skill元数据规范

每个Skill必须提供以下元数据，注册到本文档：

```yaml
skill_name: skill-id  # Skill的唯一标识符，对应文件名为 {skill-id}.md 或 {skill-id}/SKILL.md
display_name: 显示名称  # 用户友好的显示名称
category: 类别  # 从2.1中选择：P0-基础检查类 / P1-领域专业类 / P1-分析设计类 / P2-技术栈类 / P2-工具创建类
description: 简短描述  # 1-2句话描述Skill的用途
trigger_keywords:  # 触发关键词列表
  - 关键词1
  - 关键词2
use_cases:  # 适用场景列表
  - 场景1
  - 场景2
priority: P0/P1/P2  # 调用优先级
core_features:  # 核心功能列表
  - 功能1
  - 功能2
always_first: false  # 是否总是第一个调用（仅preflight-lite为true）
status: active/deprecated  # Skill状态
added_date: YYYY-MM-DD  # 添加日期
added_by: 添加者  # 添加者标识
```

---

## 三、已注册Skill清单

### 3.1 Skill注册表格

| 显示名称 | Skill ID | 类别 | 触发关键词 | 优先级 | 状态 | 添加日期 |
|---------|----------|------|-----------|--------|------|---------|
| 执行前置检查 | preflight-lite | P0-基础检查类 | 所有任务, 前置检查, 规则合规 | P0 | ✅ 活跃 | 2026-04-09 |
| DevOps CI/CD保护 | devops-ci-cd-guardrails | P1-领域专业类 | CI, CD, workflow, GitHub Actions, Docker, compose, deploy, E2E, 镜像, 部署 | P1 | ✅ 活跃 | 2026-04-09 |
| 跨目录CI指导 | cross-directory-ci | P1-领域专业类 | working-directory, path, CWD, subdirectory, monorepo, checkout多个仓库, 路径解析 | P1 | ✅ 活跃 | 2026-04-09 |
| 全局CI/CD实践强制执行 | global-cicd-practices-enforcement | P1-领域专业类 | CI/CD, pipeline, best practices, enforcement, DORA, quality gate, secret management | P1 | ✅ 活跃 | 2026-04-09 |
| Prisma Seed CI/CD执行 | prisma-seed-cicd | P1-领域专业类 | Prisma, seed, ts-node, Cannot find module, database seeding, CI/CD | P1 | ❌ 废弃 | 2026-04-09 |
| CI/CD数据库播种 | cicd-database-seeding | P1-领域专业类 | database, seeding, Prisma, SQL, seed, CI/CD, db seed, 数据库播种 | P1 | ✅ 活跃 | 2026-05-21 |
| Next.js路由守卫 | nextjs-router-guardrails | P1-领域专业类 | ~~Next.js, router, middleware, authentication, guard, withAuth, withAdmin, routing~~ | P1 | ❌ 废弃 | 2026-04-09 |
| 全栈CI/CD规范 | fullstack-ci-cd-guardrails | P1-领域专业类 | Docker, GitHub Actions, 镜像构建, 部署验证, 全栈项目 | P1 | ✅ 活跃 | 2026-04-10 |
| 电子表格处理器 | spreadsheet-processor | P1-领域专业类 | wps, 表格, excel, wps表格, 电子表格, spreadsheet | P1 | ✅ 活跃 | 2026-04-10 |
| 新资产集成器 | new-asset-integrator | P1-领域专业类 | 新的MCP工具, 新的skill追加, 新MCP工具, 新skill追加 | P1 | ✅ 活跃 | 2026-04-10 |
| 头脑风暴分析 | brainstorming | P1-分析设计类 | 分析, 调查, 为什么, 如何, 方案, 设计, 根因, 模糊需求 | P1 | ✅ 活跃 | 2026-04-09 |
| 多智能体编排 | multi-agent-orchestration | P1-分析设计类 | 多智能体模式, multi-agent, 全生命周期开发 | P1 | ✅ 活跃 | 2026-04-15 |
| Context7优先 | context7-first | P1-领域专业类 | 开发, 代码, 实现, 技术栈, library, framework, 调试 | P1 | ✅ 活跃 | 2026-04-09 |
| CodeGraph优先 | codegraph-first | P0-基础检查类 | 代码修改, 影响分析, edit, refactor, safe_edit, safe_delete | P0 | ✅ 活跃 | 2026-04-15 |
| DevOps架构师 | devops-architect | P2-技术栈类 | pipeline, GitOps, Kubernetes, cloud, architecture, 容器化, 云基础设施 | P2 | ❌ 废弃 | 2026-04-09 |
| Salesforce DX专家 | salesforce-dx-expert | P2-技术栈类 | Salesforce, Apex, LWC, Flow, SOQL | P2 | ❌ 废弃 | 2026-04-09 |
| Playwright MCP专家 | playwright-mcp-expert | P2-技术栈类 | Playwright, browser, automation, UI test | P2 | ❌ 废弃 | 2026-04-09 |
| Skill创建器 | skill-creator | P2-工具创建类 | 创建skill, 新skill | P2 | ✅ 活跃 | 2026-04-09 |
| 学习模式执行器 | learning-mode-executor | P2-技术栈类 | /learn, 学习模式 | P2 | ✅ 活跃 | 2026-04-23 |
| 自动提交助手 | auto-commit | P1-领域专业类 | Write, Edit, 文件修改，提交，commit, git commit, TDD提交，状态转换 | P1 | ✅ 活跃 | 2026-04-21 |
| OpenCode MCP集成 | opencode-mcp-integration | P1-领域专业类 | 集成MCP工具, 注册MCP Server, MCP权限矩阵, 注册Skill, 硬约束Plugin | P1 | ✅ 活跃 | 2026-04-10 |
| OpenCode框架定制 | customize-opencode | P1-领域专业类 | 修改Agent配置, 调整权限矩阵, 添加Agent, 修改rules, opencode.json编辑 | P1 | ✅ 活跃 | 2026-06-29 |
| SQLite膨胀调查 | sqlite-bloat-investigation | P1-领域专业类 | SQLite, DB膨胀, 数据库体积, table大小, 空间占用, O(n²) | P1 | ✅ 活跃 | 2026-06-29 |

---
