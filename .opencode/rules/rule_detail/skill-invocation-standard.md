
# Skill调用标准化规范

## 概述

本文档定义了在Trae IDE中执行任务时的Skill调用标准流程，确保每次任务都能正确、完整地调用相关Skill，提高任务执行质量和一致性。

**制定时间**: 2026-04-09  
**最后更新**: 2026-04-13  
**适用范围**: 所有在Trae IDE中执行的任务  
**版本**: v2.1.3（添加技能执行完整性规范）

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
| **P0 - 基础检查类** | 所有任务的前置检查，必须调用 | P0 | execution-preflight-check |
| **P1 - 领域专业类** | 特定技术领域的专业指导 | P1 | devops-ci-cd-guardrails, cross-directory-ci, context7-first |
| **P1 - 分析设计类** | 需求分析、方案设计、根因分析 | P1 | brainstorming |
| **P2 - 技术栈类** | 特定技术栈的专项支持 | P2 | salesforce-dx-expert, playwright-mcp-expert, devops-architect |
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
always_first: false  # 是否总是第一个调用（仅execution-preflight-check为true）
status: active/deprecated  # Skill状态
added_date: YYYY-MM-DD  # 添加日期
added_by: 添加者  # 添加者标识
```

---

## 三、已注册Skill清单

### 3.1 Skill注册表格

| 显示名称 | Skill ID | 类别 | 触发关键词 | 优先级 | 状态 | 添加日期 |
|---------|----------|------|-----------|--------|------|---------|
| 执行前置检查 | execution-preflight-check | P0-基础检查类 | 所有任务, 前置检查, 规则合规 | P0 | ✅ 活跃 | 2026-04-09 |
| DevOps CI/CD保护 | devops-ci-cd-guardrails | P1-领域专业类 | CI, CD, workflow, GitHub Actions, Docker, compose, deploy, E2E, 镜像, 部署 | P1 | ✅ 活跃 | 2026-04-09 |
| 跨目录CI指导 | cross-directory-ci | P1-领域专业类 | working-directory, path, CWD, subdirectory, monorepo, checkout多个仓库, 路径解析 | P1 | ✅ 活跃 | 2026-04-09 |
| 全局CI/CD实践强制执行 | global-cicd-practices-enforcement | P1-领域专业类 | CI/CD, pipeline, best practices, enforcement, DORA, quality gate, secret management | P1 | ✅ 活跃 | 2026-04-09 |
| Prisma Seed CI/CD执行 | prisma-seed-cicd | P1-领域专业类 | Prisma, seed, ts-node, Cannot find module, database seeding, CI/CD | P1 | ✅ 活跃 | 2026-04-09 |
| Next.js路由守卫 | nextjs-router-guardrails | P1-领域专业类 | Next.js, router, middleware, authentication, guard, withAuth, withAdmin, routing | P1 | ✅ 活跃 | 2026-04-09 |
| 全栈CI/CD规范 | fullstack-ci-cd-guardrails | P1-领域专业类 | Docker, GitHub Actions, 镜像构建, 部署验证, 全栈项目 | P1 | ✅ 活跃 | 2026-04-10 |
| 电子表格处理器 | spreadsheet-processor | P1-领域专业类 | wps, 表格, excel, wps表格, 电子表格, spreadsheet | P1 | ✅ 活跃 | 2026-04-10 |
| 新资产集成器 | new-asset-integrator | P1-领域专业类 | 新的MCP工具, 新的skill追加, 新MCP工具, 新skill追加 | P1 | ✅ 活跃 | 2026-04-10 |
| 头脑风暴分析 | brainstorming | P1-分析设计类 | 分析, 调查, 为什么, 如何, 方案, 设计, 根因, 模糊需求 | P1 | ✅ 活跃 | 2026-04-09 |
| 多智能体编排 | multi-agent-orchestration | P1-分析设计类 | 多智能体模式, multi-agent, 全生命周期开发 | P1 | ✅ 活跃 | 2026-04-15 |
| Context7优先 | context7-first | P1-领域专业类 | 开发, 代码, 实现, 技术栈, library, framework, 调试 | P1 | ✅ 活跃 | 2026-04-09 |
| DevOps架构师 | devops-architect | P2-技术栈类 | pipeline, GitOps, Kubernetes, cloud, architecture, 容器化, 云基础设施 | P2 | ✅ 活跃 | 2026-04-09 |
| Salesforce DX专家 | salesforce-dx-expert | P2-技术栈类 | Salesforce, Apex, LWC, Flow, SOQL | P2 | ✅ 活跃 | 2026-04-09 |
| Playwright MCP专家 | playwright-mcp-expert | P2-技术栈类 | Playwright, browser, automation, UI test | P2 | ✅ 活跃 | 2026-04-09 |
| Skill创建器 | skill-creator | P2-工具创建类 | 创建skill, 新skill | P2 | ✅ 活跃 | 2026-04-09 |
| 学习模式执行器 | learning-mode-executor | P2-技术栈类 | /learn, 学习模式 | P2 | ✅ 活跃 | 2026-04-23 |
| 自动提交助手 | auto-commit | P1-领域专业类 | Write, Edit, 文件修改，提交，commit, git commit, TDD提交，状态转换 | P1 | ✅ 活跃 | 2026-04-21 |

---

## 四、各Skill详细元数据

### 4.1 execution-preflight-check

```yaml
skill_name: execution-preflight-check
display_name: 执行前置检查
category: P0-基础检查类
description: 所有任务的强制性前置检查，验证规则合规、MCP准备状态和Skill调用要求
trigger_keywords:
  - 所有任务
  - 前置检查
  - 规则合规
  - MCP准备
use_cases:
  - 任何任务开始前的前置检查
  - 规则合规验证
  - MCP调用计划制定
priority: P0
core_features:
  - 规则合规性验证
  - MCP调用策略规划
  - 相关Skill识别
  - TodoWrite跟踪初始化
always_first: true
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.2 devops-ci-cd-guardrails

```yaml
skill_name: devops-ci-cd-guardrails
display_name: DevOps CI/CD保护
category: P1-领域专业类
description: DevOps/CI/CD任务的专用Guardrails，确保部署可靠性、可追溯性与合同一致性
trigger_keywords:
  - CI
  - CD
  - workflow
  - GitHub Actions
  - Docker
  - compose
  - deploy
  - E2E
  - 镜像
  - 部署
  - 迁移
  - 回滚
  - 发布
use_cases:
  - CI/CD流水线配置和优化
  - 容器镜像构建和管理
  - 部署流程设计和执行
  - 跨仓库依赖管理
  - 环境变量管理和安全
priority: P1
core_features:
  - 验证部署契约
  - 确保migration使用正确的镜像
  - 检查跨仓库E2E的版本感知
  - 审查deploy作为生产代码
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.3 cross-directory-ci

```yaml
skill_name: cross-directory-ci
display_name: 跨目录CI指导
category: P1-领域专业类
description: 跨目录CI脚本执行指导，避免和调试由错误CWD引起的CI/CD失败
trigger_keywords:
  - working-directory
  - path
  - CWD
  - subdirectory
  - monorepo
  - checkout多个仓库
  - 路径解析
  - Cannot find module
  - No such file or directory
use_cases:
  - 多仓库CI/CD配置
  - Monorepo项目CI
  - 路径相关错误调试
  - CI步骤CWD配置
priority: P1
core_features:
  - 显式工作目录检查
  - Shell上下文隔离
  - 工具自身工作目录逻辑
  - 环境文件加载
  - 二进制/可执行文件解析
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.4 global-cicd-practices-enforcement

```yaml
skill_name: global-cicd-practices-enforcement
display_name: 全局CI/CD实践强制执行
category: P1-领域专业类
description: 强制执行CI/CD流水线设计中的全局性最佳实践，定义严格的、不可协商的规则

trigger_keywords:
  - CI/CD
  - pipeline
  - best practices
  - enforcement
  - DORA
  - quality gate
  - secret management
  - pipeline bloat
  - environment drift
  - toolchain consolidation

use_cases:
  - CI/CD流水线设计和审核
  - CI/CD配置生成和验证
  - 流水线质量评估和优化
  - 安全合规检查

priority: P1

core_features:
  - 明确CI/CD边界定义
  - 强制预合并质量门
  - 工具链整合要求
  - 环境漂移预防
  - 密钥管理零容忍
  - 可观测性指标导出
  - 流水线膨胀预防

always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.5 prisma-seed-cicd

```yaml
skill_name: prisma-seed-cicd
display_name: Prisma Seed CI/CD执行
category: P1-领域专业类
description: 在CI/CD环境中正确执行Prisma种子脚本，防止'Cannot find module'错误

trigger_keywords:
  - Prisma
  - seed
  - ts-node
  - Cannot find module
  - database seeding
  - CI/CD
  - db seed
  - prisma:seed

use_cases:
  - CI/CD管道中的数据库初始化
  - 前后端分离项目的种子脚本执行
  - TypeScript种子文件的执行
  - 解决ts-node路径解析问题

priority: P1

core_features:
  - 使用Prisma内置seed命令
  - 显式指定tsconfig.json路径
  - 避免错误的工作目录配置
  - 调试检查清单
  - 最佳实践执行

always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.6 nextjs-router-guardrails

```yaml
skill_name: nextjs-router-guardrails
display_name: Next.js路由守卫
category: P1-领域专业类
description: 强制执行Next.js路由守卫和身份验证最佳实践，确保安全的路由保护
trigger_keywords:
  - Next.js
  - nextjs
  - next.js
  - Nextjs
  - router
  - middleware
  - authentication
  - guard
  - withAuth
  - withAdmin
  - routing
  - 评估
  - 分析
  - 调查
  - 设计
  - 疏通
  - 问题调查
use_cases:
  - Next.js路由保护实现
  - 身份验证守卫配置
  - 中间件安全头部设置
  - 路由权限管理
  - Next.js代码评估
  - Next.js项目分析
  - Next.js路由问题调查
  - Next.js路由设计
  - Next.js路由疏通
priority: P1
core_features:
  - 三层防护策略（边缘层、页面层、API层）
  - Middleware实施标准
  - 高阶组件（HOC）标准
  - 安全头部配置
  - 特殊场景处理（CSRF、角色变更、账户禁用）
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.7 fullstack-ci-cd-guardrails

```yaml
skill_name: fullstack-ci-cd-guardrails
display_name: 全栈CI/CD规范
category: P1-领域专业类
description: 强制执行全栈项目CI/CD规范与问题防御指南，针对Docker和GitHub Actions工作流
trigger_keywords:
  - Docker
  - docker
  - GitHub Actions
  - github actions
  - workflow
  - workflows
  - 镜像构建
  - image build
  - 部署验证
  - deployment verify
  - 全栈项目
  - fullstack
  - 全栈
  - next.js
  - Next.js
  - nestjs
  - NestJS
  - prisma
  - Prisma
use_cases:
  - 全栈项目CI/CD流水线设计
  - Docker镜像构建和推送
  - GitHub Actions工作流配置
  - 部署验证工作流实现
  - Next.js + NestJS + Docker项目
priority: P1
core_features:
  - 变量统一管理规范
  - 标签不可变优先策略
  - 环境隔离最佳实践
  - 测试真实性要求
  - 工作流健壮性保障
  - 镜像构建工作流规范
  - 部署验证工作流规范
  - 前端特定规范（Next.js）
  - 后端特定规范（NestJS + Prisma）
always_first: false
status: active
added_date: 2026-04-10
added_by: system
```

---

### 4.8 spreadsheet-processor

```yaml
skill_name: spreadsheet-processor
display_name: 电子表格处理器
category: P1-领域专业类
description: 解析和处理各种电子表格文件格式，包括Excel、WPS、CSV、OpenDocument等
trigger_keywords:
  - wps
  - 表格
  - excel
  - wps表格
  - 电子表格
  - spreadsheet
  - xls
  - xlsx
  - xlsm
  - xlsb
  - csv
  - ods
  - et
  - dbf
  - accdb
  - mdb
  - prn
  - tsv
  - numbers
use_cases:
  - 电子表格文件读取和解析
  - Excel/WPS文件处理
  - CSV数据导入导出
  - 表格数据转换
  - 电子表格格式转换
priority: P1
core_features:
  - 文件格式识别
  - 数据读取与解析
  - 数据操作（筛选、排序、转换、聚合）
  - 文件写入与导出
  - Excel MCP工具集成
always_first: false
status: active
added_date: 2026-04-10
added_by: system
```

---

### 4.9 new-asset-integrator

```yaml
skill_name: new-asset-integrator
display_name: 新资产集成器
category: P1-领域专业类
description: 标准化地处理新MCP工具和新Skill的追加流程，确保所有操作符合项目规范和技术标准
trigger_keywords:
  - 新的MCP工具
  - 新的skill追加
  - 新MCP工具
  - 新skill追加
  - 添加MCP工具
  - 添加新skill
  - new MCP tool
  - new skill
use_cases:
  - 新MCP工具集成
  - 新Skill追加
  - 资产集成流程管理
  - 文档更新管理
priority: P1
core_features:
  - 功能分析阶段管理
  - MCP工具更新流程
  - Skill更新流程
  - 验证要求管理
  - 文档完整性检查
always_first: false
status: active
added_date: 2026-04-10
added_by: system
```

---

### 4.10 brainstorming

```yaml
skill_name: brainstorming
display_name: 头脑风暴分析
category: P1-分析设计类
description: 将模糊想法转化为清晰的、可实施的设计
trigger_keywords:
  - 分析
  - 调查
  - 为什么
  - 如何
  - 方案
  - 设计
  - 根因
  - 模糊需求
  - 架构讨论
use_cases:
  - 需求分析和澄清
  - 方案设计和评估
  - 问题根因分析
  - 架构讨论和决策
priority: P1
core_features:
  - 理解输入模式
  - 收集上下文
  - 提出澄清问题
  - 提议方法
  - 推荐方法
  - 创建设计文档
  - 提问内容要点理解与归纳
  - 归纳要点结构化输出
  - 确认反馈处理机制
  - 任务流转控制
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.10b multi-agent-orchestration

```yaml
skill_name: multi-agent-orchestration
display_name: 多智能体编排
category: P1-分析设计类
description: 触发并编排三层九角色多智能体系统，用于复杂全生命周期开发任务。自动验证AGENTS.md对齐、检查9个Agent配置、启动标准多智能体工作流。
trigger_keywords:
  - 多智能体模式
  - multi-agent
  - 全生命周期开发
  - 多角色协作
  - TDD流程
  - 契约驱动开发
use_cases:
  - 用户触发"多智能体模式"
  - 复杂全生命周期开发任务
  - 需要多角色协作的大型功能
  - 遵循TDD+契约驱动的标准开发流程
priority: P1
core_features:
  - AGENTS.md存在性与内容验证
  - 9个Agent配置文件完整性检查
  - AGENTS.md与实际Agent文件对齐验证
  - 标准多智能体工作流启动
  - TDD强制纪律执行
  - 质量门禁与闭环反馈
always_first: false
status: active
added_date: 2026-04-15
added_by: system
```

---

### 4.11 context7-first

```yaml
skill_name: context7-first
display_name: Context7优先
category: P1-领域专业类
description: 在任何调查、设计、编码、调试或架构任务之前，先调用Context7 MCP工具获取最新技术栈文档和上下文
trigger_keywords:
  - 开发
  - 代码
  - 实现
  - 技术栈
  - library
  - framework
  - 调试
  - 依赖管理
use_cases:
  - 代码开发任务
  - 技术栈使用咨询
  - 调试问题分析
  - 依赖管理
priority: P1
core_features:
  - 获取最新技术栈文档
  - 提供代码库上下文
  - 分析技术栈使用情况
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.11 devops-architect

```yaml
skill_name: devops-architect
display_name: DevOps架构师
category: P2-技术栈类
description: CI/CD管道设计、GitOps工作流、容器化应用、云原生基础设施架构设计
trigger_keywords:
  - pipeline
  - GitOps
  - Kubernetes
  - cloud
  - architecture
  - 容器化
  - 云基础设施
use_cases:
  - CI/CD管道设计
  - GitOps工作流实现
  - Kubernetes部署架构
  - 云原生基础设施设计
priority: P2
core_features:
  - CI/CD管道架构设计
  - GitOps工作流配置
  - 容器化最佳实践
  - 云基础设施架构
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.12 salesforce-dx-expert

```yaml
skill_name: salesforce-dx-expert
display_name: Salesforce DX专家
category: P2-技术栈类
description: Salesforce DX项目的架构设计、Apex/LWC开发、CI/CD管道设置、部署故障排除
trigger_keywords:
  - Salesforce
  - Apex
  - LWC
  - Flow
  - SOQL
use_cases:
  - Salesforce项目开发
  - Apex/LWC组件开发
  - Salesforce部署
  - Salesforce CI/CD配置
priority: P2
core_features:
  - Salesforce DX项目指导
  - Apex/LWC开发最佳实践
  - 部署故障排除
  - CI/CD管道设置
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.13 playwright-mcp-expert

```yaml
skill_name: playwright-mcp-expert
display_name: Playwright MCP专家
category: P2-技术栈类
description: Playwright MCP Server配置、LLM浏览器自动化、连接问题排除、元素定位策略优化
trigger_keywords:
  - Playwright
  - browser
  - automation
  - UI test
use_cases:
  - Playwright浏览器自动化
  - UI测试配置
  - 浏览器自动化调试
priority: P2
core_features:
  - Playwright MCP Server配置
  - LLM浏览器自动化指导
  - 连接问题排除
  - 元素定位策略优化
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.14 skill-creator

```yaml
skill_name: skill-creator
display_name: Skill创建器
category: P2-工具创建类
description: 创建新Skill的强制性工具，用于添加新的Skill到系统
trigger_keywords:
  - 创建skill
  - 新skill
  - 添加skill
use_cases:
  - 创建新的Skill
  - 扩展Skill库
priority: P2
core_features:
  - Skill创建指导
  - Skill模板生成
  - Skill文档标准化
always_first: false
status: active
added_date: 2026-04-09
added_by: system
```

---

### 4.15b learning-mode-executor

```yaml
skill_name: learning-mode-executor
display_name: 学习模式执行器
category: P2-技术栈类
description: Transforms single Q&A into structured learning cases with planning, logging, and knowledge base integration. Invoke when user enters /learn command.
trigger_keywords:
  - /learn
  - 学习模式
use_cases:
  - 将单次问答转变为结构化学习案例
  - 系统性研究Agent Harness Engineering
priority: P2
core_features:
  - 规划与物化
  - 执行与日志注入
  - 归纳与闭环
always_first: false
status: active
added_date: 2026-04-23
added_by: system
```

---
### 4.15 auto-commit

```yaml
skill_name: auto-commit
display_name: 自动提交助手
category: P1-领域专业类
description: 在每次 Write/Edit 操作后，主动询问用户是否需要立即提交，并根据 machine.json 状态和 pre-commit hook 约束自动生成符合 TDD 规范的 commit message
trigger_keywords:
  - Write
  - Edit
  - 文件修改
  - 提交
  - commit
  - git commit
  - TDD提交
  - 状态转换
use_cases:
  - 文件修改后交互式提交
  - TDD 状态感知的 commit message 生成
  - 证据链前置校验（模拟 pre-commit hook）
  - 非法提交拦截（Red 阶段非测试文件、证据文件缺失等）
priority: P1
core_features:
  - 文件修改检测与提示
  - TDD 状态感知的 commit message 生成
  - 证据链前置校验（machine.json + pre-commit hook 规则）
  - 交互式提交确认
  - 负向测试拦截（非法状态转换、证据文件缺失等）
always_first: false
status: active
added_date: 2026-04-21
added_by: system
```

---

## 五、标准化执行流程

### 5.1 任务前规划阶段（必须执行）

```
步骤1：理解用户请求
   ↓
步骤2：查阅本文档的"已注册Skill清单"
   ↓
步骤3：识别任务类型和关键词，匹配触发关键词
   ↓
步骤4：创建"计划调用的Skill清单"（使用5.2模板）
   ↓
步骤5：向用户展示清单并获得确认
   ↓
步骤6：按优先级顺序调用Skill（P0 → P1 → P2）
```

### 5.2 计划调用的Skill清单模板

当用户提出任务后，先输出以下内容：

```markdown
## 📋 计划调用的Skill清单

根据任务分析和Skill注册清单，我计划调用以下Skill：

| 序号 | Skill名称 | Skill ID | 调用目的 |
|------|----------|----------|---------|
| 1 | Skill1 | skill-id-1 | 调用目的1 |
| 2 | Skill2 | skill-id-2 | 调用目的2 |

**确认后开始执行。**
```

### 5.3 快速检查清单

在规划Skill时，快速对照以下检查项：

```
📋 任务前快速检查：
[ ] 已查阅"已注册Skill清单"吗？
[ ] 这是DevOps/CI/CD任务吗？ → devops-ci-cd-guardrails
[ ] 涉及多目录/多仓库吗？ → cross-directory-ci
[ ] 需要分析根因吗？ → brainstorming
[ ] 需要写代码吗？ → context7-first
[ ] 是Salesforce项目吗？ → salesforce-dx-expert
[ ] 涉及Playwright吗？ → playwright-mcp-expert
[ ] 还有其他匹配的Skill吗？（查阅3.1表格）
```

---

## 六、常见任务的Skill组合推荐

### 6.1 CI/CD问题分析

```
1. 查阅 .opencode/rules/rule_detail/skill-invocation-standard.md（必选）
2. fullstack-ci-cd-guardrails (P1) - 强制执行全栈CI/CD规范
3. global-cicd-practices-enforcement (P1) - 强制执行全局最佳实践
4. devops-ci-cd-guardrails (P1)
5. cross-directory-ci (P1) - 如果涉及多目录/多仓库
6. brainstorming (P1)
```

### 6.2 代码开发任务

```
1. 查阅 .opencode/rules/rule_detail/skill-invocation-standard.md（必选）
2. context7-first (P1)
3. brainstorming (P1) - 如果需要设计
```

### 6.5 代码评估任务

```
1. 查阅 .opencode/rules/rule_detail/skill-invocation-standard.md（必选）
2. context7-first (P1)
3. brainstorming (P1) - 分析代码结构和问题
4. nextjs-router-guardrails (P1) - 如果是Next.js项目，分析路由和认证实现
```

### 6.3 需求分析与方案设计

```
1. 查阅 .opencode/rules/rule_detail/skill-invocation-standard.md（必选）
2. brainstorming (P1)
3. 其他相关Skill（根据具体领域查阅3.1表格）
```

### 6.4 跨仓库E2E问题

```
1. 查阅 .opencode/rules/rule_detail/skill-invocation-standard.md（必选）
2. devops-ci-cd-guardrails (P1)
3. cross-directory-ci (P1)
4. brainstorming (P1)
```

### 6.6 文件修改后提交

```
1. 查阅 .opencode/rules/rule_detail/skill-invocation-standard.md（必选）
2. auto-commit (P1) - 交互式提交与证据链校验
3. execution-preflight-check (P0) - 前置规则检查（如适用）
```

---

## 七、技能执行完整性规范

### 7.1 核心原则
- **完整性原则**：调用任何Skill后，必须完整执行其文档定义的核心工作流
- **用户交互尊重**：对于包含用户确认、反馈循环的Skill，必须等待用户响应后再继续
- **核心功能检查**：必须验证Skill的核心功能是否被执行

### 7.2 技能执行检查清单
在每个Skill调用后，必须验证以下内容：

| 检查项 | 描述 | 示例 |
|--------|------|------|
| [ ] 核心工作流执行 | 是否执行了Skill文档中定义的核心工作流步骤 | brainstorming的"提问内容分析→结构化输出→等待确认" |
| [ ] 用户交互完成 | 是否需要用户确认/反馈，是否已获取 | brainstorming的要点确认 |
| [ ] 核心功能验证 | Skill的主要目的是否达到 | brainstorming的"模糊需求澄清" |
| [ ] 输出质量检查 | Skill输出是否符合预期格式和质量 | brainstorming的结构化摘要 |

### 7.3 TodoWrite跟踪要求
在TodoWrite中必须为每个Skill调用创建专门的任务项，包含：
- 技能执行状态跟踪（开始→核心步骤→用户交互→完成）
- 核心工作流步骤检查清单
- 用户确认等待状态（如适用）

### 7.4 违规处理
- **部分执行**：视为违规，必须回滚到Skill调用前的状态重新执行
- **跳过用户交互**：强制暂停，补全用户确认流程后再继续
- **核心功能缺失**：标记任务为"技能执行不完整"，重新规划执行

### 7.5 更新执行流程（修改现有5.1节）
```
步骤6：按优先级顺序调用Skill（P0 → P1 → P2）
   ↓
步骤7：执行Skill核心工作流，等待必要用户交互
   ↓
步骤8：验证Skill执行完整性（使用7.2检查清单）
   ↓
步骤9：标记Skill执行状态为"完整"或"不完整"
   ↓
步骤10：只有所有Skill标记为"完整"才能继续后续任务
```

### 7.6 适用所有Skill的通用要求
此规范适用于所有已注册的Skill，特别是：
- **brainstorming**：必须执行要点归纳→结构化输出→等待确认
- **context7-first**：必须完成Context7查询并应用结果
- **devops-ci-cd-guardrails**：必须执行完整的CI/CD规则检查
- **其他所有Skill**：必须执行其文档定义的核心功能

### 7.7 实施建议
1. 立即将此规范添加到 `skill-invocation-standard.md`
2. 更新 `execution-preflight-check/SKILL.md` 中的任务分类表格
3. 在下次任务前展示更新的Skill调用计划，明确包含"执行完整性检查"

---

## 八、添加新Skill指南

### 8.1 前置要求

添加新Skill前，必须满足：

- [ ] 新Skill已在 `.opencode/skills/` 目录下创建
- [ ] Skill文件命名规范：`{skill-id}.md` 或 `{skill-id}/SKILL.md`
- [ ] Skill有清晰的描述和触发条件
- [ ] Skill已测试可用

### 8.2 添加步骤

#### 步骤1：准备Skill元数据

使用以下模板准备新Skill的元数据：

```yaml
skill_name: your-new-skill-id
display_name: 新Skill显示名称
category: 选择类别  # P0-基础检查类 / P1-领域专业类 / P1-分析设计类 / P2-技术栈类 / P2-工具创建类
description: 简短描述，1-2句话
trigger_keywords:
  - 关键词1
  - 关键词2
  - 关键词3
use_cases:
  - 适用场景1
  - 适用场景2
priority: P0/P1/P2
core_features:
  - 核心功能1
  - 核心功能2
always_first: false  # 只有execution-preflight-check为true
status: active
added_date: YYYY-MM-DD
added_by: 添加者标识
```

#### 步骤2：更新相关文档

按以下顺序更新文档：

1. **在3.1节"Skill注册表格"中添加一行**
2. **在第四节"各Skill详细元数据"中添加完整的元数据YAML块**
3. **更新 execution-preflight-check/SKILL.md 中的任务分类表格**
4. **更新 execution-preflight-check/SKILL.md 中的添加新技能步骤**
5. **在第六节"常见任务的Skill组合推荐"中酌情添加相关组合（如适用）**
6. **在第九节"实际案例分析"中酌情添加案例（如适用）**

#### 步骤3：验证更新

- [ ] 元数据格式正确
- [ ] 分类选择合理
- [ ] 触发关键词清晰
- [ ] 显示名称友好
- [ ] 日期格式正确（YYYY-MM-DD）

### 8.3 Skill弃用指南

如需弃用某个Skill：

1. 将3.1节表格中的"状态"改为 `❌ 已弃用`
2. 在第四节元数据中设置 `status: deprecated`
3. 添加 `deprecated_date: YYYY-MM-DD` 和 `deprecated_reason: 弃用原因`
4. 在元数据中添加替代Skill建议（如有）
5. **不要删除**Skill的元数据记录，保留历史记录

---

## 九、实际案例分析

### 案例：前端CI Prisma seed失败分析

**用户请求**：
&gt; 分析booking-frontend在Github Action CI执行时报的错...调查原因，不动代码。

**正确的Skill调用顺序**：

1. 查阅 skill-invocation-standard.md（必选）
2. devops-ci-cd-guardrails (P1)
3. cross-directory-ci (P1)
4. brainstorming (P1)

| 序号 | Skill名称 | Skill ID | 调用理由 |
|------|----------|----------|---------|
| 1 | DevOps CI/CD保护 | devops-ci-cd-guardrails | 涉及GitHub Actions、CI/CD、跨仓库E2E |
| 2 | 跨目录CI指导 | cross-directory-ci | 涉及checkout多个仓库、路径解析 |
| 3 | 头脑风暴分析 | brainstorming | 需要分析问题根因 |

**遗漏分析**：
- 实际遗漏了 `cross-directory-ci`
- 虽然最终分析了分支合并问题，但cross-directory-ci可以提供更系统的诊断流程

---

## 十、质量保障与持续改进

### 10.1 执行后回顾

每次任务完成后，进行以下回顾：

```
📋 执行后回顾：
[ ] 是否调用了所有应该调用的Skill？
[ ] Skill调用顺序是否合理（按P0→P1→P2）？
[ ] 本文档是否需要更新（新Skill、新触发关键词等）？
[ ] 是否可以改进下次的Skill规划？
[ ] 记录经验教训到本文档
```

### 10.2 文档更新触发点

在以下情况下必须更新相关文档：

- [ ] 添加新Skill时（必须使用skill-creator Skill）
  - 必须更新 `skill-invocation-standard.md`（注册表格、元数据）
  - 必须更新 `execution-preflight-check/SKILL.md`（任务分类表格、添加新技能步骤）
- [ ] Skill触发关键词需要更新时
  - 必须更新 `skill-invocation-standard.md`
  - 必须更新 `execution-preflight-check/SKILL.md` 中的任务分类表格
- [ ] 发现新的Skill组合模式时
- [ ] Skill状态变更时（活跃→弃用）
- [ ] 实际案例分析需要补充时

### 10.3 文档版本管理

- 本文档使用语义化版本号（vMAJOR.MINOR.PATCH）
- MAJOR：框架重大变更
- MINOR：新增Skill类别、重大流程变更
- PATCH：添加新Skill、更新元数据、小修复
- 每次更新在"概述"部分记录版本号和更新日期

---

## 十一、总结

本文档的核心目标是：

1. **标准化**：建立统一的Skill调用流程
2. **透明化**：任务前展示计划，让用户监督
3. **质量化**：确保所有相关Skill都被调用
4. **高扩展性**：通过分类体系和注册机制，轻松添加新Skill
5. **高通用性**：不依赖特定Skill，适用于未来新增的所有Skill
6. **高约束性**：强制要求注册、元数据完整、流程规范

**记住**：
- 先查阅 `.opencode/rules/rule_detail/skill-invocation-standard.md`，这是所有任务的第一步
- 先规划，后执行
- 有疑问时，多调用Skill而非少调用
- 添加新Skill时，必须使用skill-creator Skill并更新本文档
- 所有Skill必须在本文档注册

### Skill调用违规预防模式
1. **先规划后执行**：任何任务开始前必须先展示Skill调用计划
2. **查阅 .opencode/rules/rule_detail/skill-invocation-standard.md 优先**：这是所有任务的第一步，没有例外
3. **Skill必须注册**：所有Skill必须在`.opencode/rules/rule_detail/skill-invocation-standard.md`中注册
4. **透明化监督**：任务前展示计划，让用户监督

---

## 附录A：Skill文件位置

所有Skill文件位于：
- `.opencode/skills/{skill-id}.md` - 单文件Skill
- `.opencode/skills/{skill-id}/SKILL.md` - 目录型Skill

---

*本文档将根据实际使用经验持续更新和完善。*

