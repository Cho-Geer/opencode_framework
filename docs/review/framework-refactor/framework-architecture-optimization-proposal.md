# OpenCode 框架架构优化提案

**文档**: `docs/review/framework-refactor/framework-architecture-optimization-proposal.md`
**作者**: @Architect（初版） / 审核意见整合 @QoderCN
**日期**: 2026-06-16（初版） / **2026-06-17（gate-stuck-fix addendum + 审核整合）**
**状态**: Proposal (awaiting review)
**上游来源**: framework-evaluation-report.md §8-9
**外部参考**: Anthropic "Building Effective Agents", AutoGen, CrewAI, LangGraph, OpenAI Swarm, Google A2A

> **整合说明**：本文档合并了原 `multi-agent-optimization-proposal.md`（10→5 角色）和 `dag-utility-analysis.md`（DAG→flat task list）两份独立提案，新增"执法机器瘦身"第三维度，并嵌入 @QoderCN 审核意见。三条优化主线（Agent / DAG / Enforcement）**可独立实施、互不阻塞**。
>
> **2026-06-17 gate-stuck-fix addendum**：Phase 1-5 落地后，以下假设需重新评估：
> 1. **合规门协议**：原 3 步（check→confirm→complete）已演进为 **5 步**（check→confirm→execute→submit_deliverables→Orchestrator approve+complete），新增 `delivered`/`approved` 状态与 2 个 MCP 工具。
> 2. **@Knowledge-Curator 方向冲突**：gate-stuck-fix 已将 KC 强化为非豁免 agent（`deliverables-templates.ts` 配置必需成果物）。本提案 §3.A 将 KC 改为"保留角色 + 简化 UC7KS 实现"而非原提案的"降级为 prompt instruction"。
> 3. **Dispatch 开销**：非豁免 sub-agent 每次派遣由 2 MCP 调用增至 5 次，§5 token 成本分析已更新。
> 4. **@Orchestrator 角色不可替代性上升**：gate-stuck-fix 要求每个非豁免 sub-agent 完成后 Orchestrator 必须调用 `approve_deliverables`（需 LLM 审查证据），§3.A 将 Orchestrator 拆为 dispatch/approve 两个独立职责而非整体硬编码。

---

## 执行摘要

OpenCode 框架当前架构（10 角色 + DAG 图结构 + 三层执法 + 5 步合规门 + UC7KS 8 步管道）体现了正确的设计原则（角色分离、权限隔离、注意力聚焦），但维护成本与收益不成比例。

本提案建议在**三个独立维度**并行优化：

1. **Agent 简化主线（P1）**：10 角色 → 5 角色（2 硬编码模块 + 4 LLM agent），通过硬编码确定性调度、合并重叠职责、消除自愈角色实现。
2. **DAG 简化主线（P2）**：去除 `execution_order` 分组 + 去除版本管理子系统，保留 flat task list + priority + depends_on。DAG 的图结构能力保留但存储简化。
3. **执法机器瘦身主线（P1）**：精简 16 个插件钩子中的冗余、UC7KS 语义域 12→5-6、合规门流程优化。

**审核观点（@QoderCN）**：Agent 数量只是维护成本的表层，真正的成本驱动是执法机器本身的层层叠加。三条主线必须并行推进——只砍 agent 数量不砍执法机器，整体复杂度降幅有限。

目标架构映射到 Anthropic 的 "Orchestrator-Workers + Evaluator-Optimizer" 复合模式——行业全生命周期软件开发 + 质量门禁的金标准。

---

## 目录

1. [问题分析](#1-问题分析)
2. [外部证据](#2-外部证据)
3. [目标架构](#3-目标架构)
4. [迁移路径](#4-迁移路径)
5. [Tradeoff 分析](#5-tradeoff-analysis)
6. [决策框架](#6-决策框架)
7. [保留核心原则](#7-保留核心原则)
8. [架构决策记录 (ADR)](#8-架构决策记录-adr)
9. [引用](#9-引用)

---

## 1. 问题分析

### 1.1 当前架构全景（10 角色 + DAG + 三层执法）

#### Agent 维度

| 层 | Agent | 模式 | 负载 | 问题映射 |
|---|---|---|:---:|---|
| 元认知 | @Meta-Planner | subagent | Low | P2 (低频) |
| 元认知 | @Orchestrator | primary | High | P2 (调度不需 LLM，但 approve_deliverables 需 LLM) |
| 执行 | @Architect | subagent | Low | P2 (低频) |
| 执行 | @Coder-BE | subagent | **High** | — |
| 执行 | @Coder-FE | subagent | **High** | — |
| 验证 | @Guardian | subagent | **High** | — |
| 验证 | @Arbiter | subagent | Low | P3 (解决框架自身引起的冲突) |
| 运维 | @CI-CD-Agent | subagent | Medium | — |
| 治理 | @Super-Admin | all | Medium | P4 (解决框架自身 bug) |
| 治理 | @Knowledge-Curator | subagent | Medium | P5 (行为强制，非技术冗余) |

#### DAG 维度

| 指标 | 数值 |
|---|---|
| DAG 专属 TypeScript LOC | ~1,650 |
| DAG 专属文档/规则/配置 LOC | ~500 |
| DAG 相关文件数 | 30+ |
| 执法层数 | 3 (dispatch-before + dispatch_subagent + gate-before) |
| 豁免 agent 数 | 4 |
| 非豁免被阻断 agent 数 | 6 |
| 实际拦截事件 | **0**（`require_dag_entry=false`，执法实质上关闭） |

#### 执法机器维度

| 组件 | 数量/规模 |
|---|---|
| before/after 插件钩子 | 16 |
| 合规门状态机步数 | 5 (armed→executing→delivered→approved→drained) |
| UC7KS 管道步数 | 8 |
| UC7KS 语义域 | 12 |
| UC7KS 知识脚本 | 7 |
| 状态管理架构 | SQLite DB + JSON 子状态 (P1-B split) |

### 1.2 五大问题（来自评估报告 §8，审核修正）

#### 问题 1：注意力聚焦的边际收益递减

> *"10 个角色中，实际高频核心角色是 Coder-BE/FE、Guardian、CI-CD-Agent。其余 7 个角色使用频率较低"*

**验证**：确认。评估报告识别了 Coder-BE、Coder-FE、Guardian、CI-CD-Agent 为高负载 agent。其余 6 个每个都需要完整配置（agent 文件 50-150 行 + 权限矩阵 50-80 行 + MCP 工具配置 + dispatch hooks + 合规门开销）。

**外部证据**：Anthropic 研究确认：*"For many applications, optimizing single LLM calls with retrieval and in-context examples is usually enough."* 第 6、7、8 个专门化 agent 的边际收益快速递减。CrewAI 分层模型同样显示 3-5 专门化 agent + 1 manager 提供最优成本/质量比。

#### 问题 2：Orchestrator 调度是确定性的，但审批不是

> *"@Orchestrator 的调度功能可硬编码：其核心工作是读取 DAG JSON 然后 dispatch——这个逻辑不需要 LLM agent"*

**验证**：**部分修正**。调度部分（读 DAG → 找 ready task → dispatch）是确定性状态机，不需 LLM。但 gate-stuck-fix 后新增的 `approve_deliverables` 需要 LLM 审查 HANDOVER.md + test_report.json 的 evidence，与 declared_deliverables 做语义比对——这是判断性动作。

**外部证据**：OpenAI Swarm 证明多 agent 编排可在 ~100 行代码内实现，无 LLM 路由参与。LangGraph 路由也是程序化的（基于状态的 conditional edges，非 LLM calls）。行业共识：**编排逻辑属于代码，不属于 LLM agent**——但**交付审批属于 LLM，不属于代码**。

**审核修正**：原提案假设 Orchestrator 可整体硬编码化，忽略 approve_deliverables 的 LLM 需求。本提案将 Orchestrator 拆为两个独立职责（§3.A）。

#### 问题 3：Arbiter 裁决的是框架自身引起的冲突

> *"@Arbiter 裁决的多是框架自身引起的冲突（scope mismatch、digest drift）。如果简化框架，Arbiter 的需求自然减少"*

**验证**：部分支持。Arbiter 的领域包括 scope mismatch（框架执法 bug）、digest drift（状态管理问题——P2-A DB 迁移部分解决）、技术债豁免审批（TECH_DEBT_REGISTRY.md）。框架简化后，框架引起的冲突减少，但技术债豁免仍是合法治理功能。

**外部证据**：6 个研究框架中无一个有专门 "Arbiter" 角色。技术债决策在所有生产系统中是人工驱动的。Anthropic 的 evaluator-optimizer 模式在审查循环内处理质量决策，而非独立仲裁层。A2A 协议显式区分 agent tasks（LLM 驱动）和 human decisions（治理）。

**审核观点**：Arbiter → human 转嫁治理成本对单人开发者是 context switch，成本可能更高。建议仅在"项目持续单人"前提下才 demote，否则让 Guardian 兼任 lightweight 技术债裁决。

#### 问题 4：Super-Admin 修的是框架 bug

> *"@Super-Admin 的主要工作量是修复框架自身的 bug。这是框架复杂度的症状"*

**验证**：强支持。评估报告记录了大量 Super-Admin 活动围绕框架修复（G1-G13、P2-A 迁移、插件系统修复、hook 修复）。框架趋于稳定后，Super-Admin 工作量自然下降。

**外部证据**：所有研究框架中无一个有专门 "Super-Admin" agent。框架维护是人工活动。Anthropic 明确警告不要构建 *"abstraction layers that obscure prompts/responses → harder to debug."* 专门的框架修复 agent 本身就是一层抽象。

#### 问题 5：Knowledge-Curator 解决的是行为缺口，不是技术能力缺口

> *"@Knowledge-Curator exists because agents repeatedly skip reading official documentation before coding — they plan based on outdated training data, producing incorrect implementations that require rework. This is a behavioral enforcement problem, not a technical 'can LLMs read files' problem."*

**验证**：确认。UC7KS 管道是**行为强制机制**，与 Permission Matrix 同构：
- Permission Matrix：约束 agent **往哪里写**（write-domain hard constraint）
- UC7KS 管道：约束 agent **什么时候写**相对于文档消费（knowledge-domain hard constraint）

两者都解决同一类问题：**LLM 不自律，光靠 prompt instruction 不够**。

**外部证据**：6 个研究框架都未解决此行为问题。每个都假设 agent 会自愿遵循指令查阅文档——这正是 OpenCode 创建 KC 的原因。UC7KS 管道的 local-first + dedicated curator 设计在所有研究系统中**架构上独一无二**。

**审核观点（@QoderCN）**：原提案论证 KC 是"与 Permission Matrix 同构的硬约束"，然后结论却是删除 KC——逻辑上等价于"证明写权限矩阵和知识权限矩阵同构，然后只保留前者删除后者"。**UC7KS 是 OpenCode 相对行业的差异化价值**，不是该砍的冗余。本提案改为"保留角色 + 简化实现"（§3.A）。

#### 问题 6（新增）：DAG 是对低价值目标的纵深防御

> *"DAG 是 defense-in-depth applied to a low-value target"*

**验证**：确认。
- `require_dag_entry=false` ——执法主开关关闭
- 261 个 task 的依赖在实践中基本线性
- 版本管理子系统（hot/warm/cold 快照 + changelog + 索引）对单人开发者过度工程化
- **0 次实际拦截**——日志中无 FW-ENFORCE.*DAG|PLAN.FIRST.*block 匹配
- @Meta-Planner 每次生成消耗 ~50K tokens，对单人项目新增单一 task 是不成比例的

**但需注意**：L3（gate-before P2-1）在非豁免 agent + strict/locked 模式下始终活跃，DAG 执法并非完全关闭。依赖线性是幸存者偏差——未来可能出现分支/并行依赖。版本管理是审计/回滚机制，删除不可逆。

#### 问题 7（新增）：执法机器层层叠加才是根因

> *"Agent 数量只是维护成本的表层，真正的成本驱动是执法机器本身的层层叠加"*

**验证**：框架代码拓扑确认：
- 16 个 before/after 插件钩子
- 5 步合规门状态机（armed→executing→delivered→approved→drained）
- UC7KS 8 步管道 + 12 语义域 + 7 知识脚本
- SQLite DB + JSON 子状态 split architecture
- PLAN-FIRST 3 层执法（dispatch-before + dispatch_subagent + gate-before）

**即使把 10 agent 砍到 5 个，16 个钩子、5 步状态机、8 步 UC7KS、split state 一个都没少。** Agent 数量优化和执法机器瘦身必须并行推进。

---

## 2. 外部证据

### 2.1 Anthropic："从简开始，按测量添加"

最权威的多 agent 设计来源：

> *"Consistently, the most successful implementations weren't using complex frameworks or specialized libraries. Instead, they were building with simple, composable patterns."*

**对 OpenCode 的启示**：当前架构用 10 个专门化 agent，Anthropic 研究建议 5-6 是大多数系统的实用上限。6 种规范模式（Augmented LLM → Prompt Chaining → Routing → Parallelization → Orchestrator-Workers → Evaluator-Optimizer）清晰映射到 4-5 角色架构。

**三核心原则**：
1. **简洁**：每个 agent 应有一个明确目的。当前有些 agent 职责重叠（Meta-Planner vs Orchestrator，Architect vs Planner）。
2. **透明**：规划步骤应显式可见，而非隐藏在 agent 边界后。
3. **ACI (Agent-Computer Interface)**：工具文档质量比 agent 数量更重要。

### 2.2 框架架构对比

| 框架 | Agent 数 | 编排方式 | 模式 |
|---|:---:|---|---|
| Anthropic (推荐) | 3-5 | 代码或 LLM | Orchestrator-Workers |
| CrewAI (分层) | 3-4 + manager | Manager agent | 分层委派 |
| AutoGen (GroupChat) | 3-5 | LLM 选择发言者 | 对话路由 |
| LangGraph (图) | N (任意) | 图拓扑 | 状态机 |
| Swarm (极简) | 2-3 | 函数返回 | Handoff 链 |
| **OpenCode (当前)** | **10** | **DAG + Orchestrator** | **分层 + 门禁** |
| **OpenCode (提案)** | **5** | **硬编码 dispatch + LLM approve** | **Orchestrator-Workers + Evaluator** |

**关键洞察**：OpenCode 是唯一有 10 agent 的系统。所有其他用 3-5 + optional manager。这是 OpenCode agent 数量是异常值的强实证。

### 2.3 OpenCode 与行业共识的差异化选择

> **审核观点（@QoderCN）**：6 个外部框架的共识不能直接套用 OpenCode。OpenCode 走的是"重角色人格化 + 重执法"的差异化路径，两个关键差异：
>
> 1. **FRAMEWORK_AGENT identity**（`docs/official_docs/opencode/findings/06-multi-agent-system.md`）：OpenCode 把每个 agent 的"身份"视为框架认同的一部分，不是可随意合并的 slot。这与 Anthropic 的"agent 是关注点容器"不同。
> 2. **状态管理驱动差异化**（`docs/official_docs/multi-agent-patterns/cross-framework-synthesis.md`）：跨框架综合分析明确指出"**状态管理，而非 agent 数量，是框架差异化的关键**"——这恰恰支持了"执法机器瘦身才是正解"的判断。
>
> 本提案承认这些差异化选择，在 §3 各维度中显式标注哪些差异化值得保留、哪些应回归行业共识。

### 2.4 多 agent 添加价值 vs overhead 的信号

| 信号 | 单 Agent | 多 Agent |
|---|:---:|:---:|
| 任务可分解为固定步骤？ | ✅ | — |
| 子任务需要不同专业知识？ | — | ✅ |
| 步数可预测？ | ✅ | — |
| 开放式、不可预测步骤？ | — | ✅ |
| 延迟敏感？ | ✅ | — |
| 质量 > 速度/成本？ | — | ✅ |

**映射到 OpenCode**：软件开发符合多 agent 列（需要不同专业知识、开放式、质量优先）。但问题不是"是否用多 agent"而是"用多少"。

### 2.5 状态管理是关键差异化因素

跨框架综合分析的核心结论：

> *"State management, not agent count, is the key architectural differentiator across frameworks"*

LangGraph 用图拓扑管理状态；Swarm 用函数返回传递状态；A2A 用标准化协议。OpenCode 用 SQLite + JSON + 合规门状态机 + DAG 版本管理 + UC7KS 管道——**5 层状态管理机制叠加在同一个单人项目上**。这是需要瘦身的核心区域。

---

## 3. 目标架构

### 3.A Agent 简化：10 → 5 角色（2 硬编码模块 + 4 LLM Agent）

```
┌─────────────────────────────────────────────────────────────────┐
│                  OPENCODE 优化架构                                │
│                                                                   │
│  ┌──────────────┐    ┌──────────────────────────────────────┐   │
│  │   HUMAN      │    │       HARDCODED DISPATCH MODULE       │   │
│  │  (Primary)   │───▶│  orchestrate-dispatch.ts              │   │
│  │              │    │  • Read task list / resolve deps      │   │
│  │  • Trigger   │    │  • Dispatch workers                  │   │
│  │  • Approve   │    │  • Collect results                   │   │
│  │  • Govern    │    │  • Update status                      │   │
│  │  • Repair    │    └──────────────────────────────────────┘   │
│  └──────┬───────┘                                              │
│         │         ┌──────────────────────────────────────┐      │
│         │         │       LLM APPROVE MODULE               │      │
│         │         │  orchestrate-approve.ts                │      │
│         │         │  • approve_deliverables (LLM)          │      │
│         │         │  • Evidence vs declared_deliverables   │      │
│         │         │  • complete gate (drain)               │      │
│         │         └──────────────────────────────────────┘      │
│         │                       │                                 │
│         │         ┌─────────────┼─────────────┐                  │
│         │         ▼             ▼             ▼                  │
│         │  ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│         │  │ PLANNER-  │ │  CODER    │ │ GUARDIAN  │           │
│         │  │ ARCHITECT │ │ (BE | FE) │ │           │           │
│         │  │           │ │           │ │           │           │
│         │  │ subagent  │ │ subagent  │ │ subagent  │           │
│         │  │           │ │           │ │           │           │
│         │  │ • DAG gen │ │ • Impl    │ │ • Review  │           │
│         │  │ • contract │ │ • Test    │ │ • Lint    │           │
│         │  │ • design   │ │ • Refactor│ │ • Audit   │           │
│         │  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘           │
│         │        │             │             │                   │
│         │        └─────────────┼─────────────┘                   │
│         │                      │                                  │
│         │                      ▼                                  │
│         │               ┌───────────┐                            │
│         │               │ CI-CD     │                            │
│         │               │ AGENT     │                            │
│         │               │           │                            │
│         │               │ subagent  │                            │
│         │               │           │                            │
│         │               │ • Deploy  │                            │
│         │               │ • Git ops │                            │
│         │               │ • Docker  │                            │
│         │               └───────────┘                            │
│         │                                                        │
│  ┌──────┴──────────────────────────────────────────────────┐    │
│  │              QUALITY GATE INFRASTRUCTURE                  │    │
│  │  • compliance_gate 5-step protocol with deliverables:    │    │
│  │      check→confirm→execute→submit_deliverables→          │    │
│  │      LLM approve+complete (non-exempt agents)            │    │
│  │  • Permission Matrix (per-agent write scopes)            │    │
│  │  • Safe Tools (TOCTOU, backup, CAS)                      │    │
│  │  • Keystone hash validation                              │    │
│  │  • TDD enforcement                                       │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

#### 角色 0a：Dispatch Coordinator（硬编码模块，非 LLM）

**类型**: TypeScript 脚本 (`orchestrate-dispatch.ts`)
**模式**: 非 OpenCode agent——由人工或 CI 触发
**职责**: 确定性任务调度

1. 读取 `tasks.json`（flat task list）
2. 识别 `status: "pending"` 且依赖已满足的任务
3. 为每个 ready task 调用 `dispatch_subagent(agent_type, task_description, task_id)`
4. 监控 subagent 完成状态
5. 更新 task status
6. 重试逻辑：3x 失败 → Guardian 升级

**配置节省**: 消除 Orchestrator agent 配置 (~80 行) + 权限矩阵 (~60 行) + MCP 工具配置

**依据**: Anthropic 区分 "workflows"（预定义代码路径）和 "agents"（动态 LLM 方向）。调度是 workflow，不是 agent task。

#### 角色 0b：Deliverables Approver（LLM 模块，从 Orchestrator 分离）

**类型**: LLM 调用模块 (`orchestrate-approve.ts`)
**模式**: 非 OpenCode agent——由 dispatch coordinator 触发
**职责**: 判断性交付审批

1. 接收 subagent 的 HANDOVER.md + test_report.json
2. 与 declared_deliverables 语义比对
3. 调用 `compliance_gate_approve_deliverables` 或拒绝（附原因）
4. 调用 `compliance_gate_complete` drain gate

**审核依据（@QoderCN）**：gate-stuck-fix 后 Orchestrator 必须对每个非豁免 agent 执行 approve_deliverables。这是需要 LLM 审查证据的判断性动作——**无法硬编码**。原提案将 Orchestrator 整体硬编码化与此需求矛盾。拆分后 dispatch 可硬编码、approve 保留 LLM，两者独立演进。

#### 角色 1：Planner-Architect（LLM Agent — `mode: subagent`）

**合并**: @Meta-Planner + @Architect
**依据**: 两者都处理"做什么"（规划）和"怎么组合"（架构）。分离造成了不必要的交接开销——planner 生成 DAG 然后 hand off 给 architect 生成 contract，但这些是深度耦合的活动。

**职责**:
1. 分析需求（对照 `context/requirements/*.md`）
2. 生成/更新 `tasks.json`（flat task list + priority + depends_on）
3. 生成/更新 `contract.yaml`（API 契约、数据模型）
4. 维护 TECH_DEBT_REGISTRY.md 扫描
5. 产出架构设计文档 `docs/`

**Agent 配置** (`agents/planner-architect.md`):
```markdown
---
description: Requirements analysis, task planning, and architecture design
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
permission:
  safe_edit: { "contract.yaml": "allow", "docs/**": "allow", ".opencode/context/**": "allow" }
  safe_shell: { "bun .opencode/scripts/mcp-tools/keystone-validate.ts --hash contract.yaml": "allow" }
  skill: allow
---
```

**注意力聚焦**: 此 agent 专注于"做什么"——永不写实现代码、永不审查代码、永不部署。

#### 角色 2：Coder（LLM Agent — `mode: subagent`）

**合并**: @Coder-BE + @Coder-FE 为一个参数化 agent 类型
**依据**: BE 和 FE 共享相同基础工作流（RED→GREEN→REFACTOR）。专门化来自**task 上下文和工具**，而非单独的 agent 配置。

**审核观点（@QoderCN）**：合并有风险——BE/FE 生态差异不止路径：测试框架（Jest vs Playwright）、部署目标（Docker vs CDN）、数据模型（Prisma vs TS interface）。合并后 Coder 的 system prompt 同时容纳两套知识，可能**削弱注意力聚焦**——而注意力聚焦正是本提案声称的首要价值。建议在推进前做 3+3 A/B 实测（3 BE + 3 FE 任务，合并版 vs 分离版，对比 rework rate）。

**如何专门化**:
1. Dispatch coordinator 在 task description 中注入上下文："实现 `/api/appointments` POST 端点"(BE) 或 "构建预约表单组件"(FE)
2. Agent 配置用 `{backend.src}` 和 `{frontend.src}` 模板变量，dispatch 时解析
3. 权限矩阵按 task 类型授予不同写范围
4. Context7 映射按 task 关键词提供框架专属文档

**Agent 配置** (`agents/coder.md`):
```markdown
---
description: Full-stack implementation with TDD (RED→GREEN→REFACTOR)
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.0
permission:
  safe_edit: { "{backend.src}**": "allow", "{frontend.src}**": "allow" }
  safe_shell: { "npx jest *": "allow", "npx ng test *": "allow", "npx prisma *": "allow" }
  safe_test: "allow"
  skill: allow
---
```

#### 角色 3：Guardian（LLM Agent — `mode: subagent`）

**保持不变**（高度有效）
**依据**: Guardian 的 evaluator-optimizer 角色是框架中最有价值的 LLM 质量机制。直接映射到 Anthropic "Evaluator-Optimizer" 模式。

**职责**（不变 + 新增）:
1. 代码审查（对照编码规范）
2. ESLint 审计验证
3. 测试执行证据验证
4. 架构约束验证
5. TDD 合规检查
6. DAG 覆盖率验证
7. **新增**: 标记框架冲突和技术债决策供人工审查（吸收 Arbiter 的治理功能）

#### 角色 4：CI-CD-Agent（LLM Agent — `mode: subagent`）

**保持不变**
**依据**: 部署、Docker 操作、Git 管理构成独立专业领域。

#### 消除角色处置表

| 消除角色 | 处置 | 依据 | 审核修正 |
|---|---|---|---|
| @Orchestrator | → 拆为 dispatch (硬编码) + approve (LLM) | 调度是 workflow，审批是 judgment | 原提案整体硬编码化，忽略 approve_deliverables 的 LLM 需求 |
| @Meta-Planner | → 合并入 Planner-Architect | 规划 + 架构深度耦合 | 无修正 |
| @Architect | → 合并入 Planner-Architect | 同上 | 无修正 |
| @Arbiter | → Guardian 升级 + 人工治理 | 技术债是 human governance | 仅在"项目持续单人"前提下才 demote |
| @Super-Admin | → 人工角色 | 框架修复是 human activity | 无修正 |
| @Knowledge-Curator | → **保留角色 + 简化 UC7KS 实现** | UC7KS 是行为强制，与 Permission Matrix 同构 | 原提案删除 KC 与自身论证矛盾 |
| @Coder-BE | → 参数化 Coder agent | 相同工作流，不同上下文 | 建议先 A/B 实测 |
| @Coder-FE | → 参数化 Coder agent | 同上 | 同上 |

**净缩减**: 10 角色 → 5 角色（2 硬编码模块 + 4 LLM agent）。净减 5 LLM agent（50%↓）。

### 3.B DAG 简化：去除 execution_order 分组 + 去除版本管理子系统

> **审核观点（@QoderCN）**：原提案命名为 "DAG→flat task list"，但实际上 flat list + depends_on 数组本质上仍是一个用邻接表编码的 DAG。真正的简化不是"图→列表"，而是：
> 1. 去除 `execution_order` 分组嵌套（两阶段查找→单数组查找）
> 2. 去除 `dag_version_manager` 子系统（439 LOC hot/warm/cold 快照）
> 3. 拆开 `dag_task_id` 双语义（路径命名空间 + DAG 审计）
>
> 本提案重命名为 **"DAG 存储简化"**，而非 "DAG→flat list"。

#### 保留什么

| 保留 | 原因 |
|---|---|
| ✅ PLAN-FIRST 约束（先规划再执行） | 核心治理价值 |
| ✅ Task status tracking (pending→in_progress→completed) | 防重复工作、调度依据 |
| ✅ Coverage verification (requirement_source 字段) | 确保所有需求被映射 |
| ✅ 3 层 dispatch 执法 | 防止未规划执行 |
| ✅ Agent 豁免列表 (dag-policy.ts) | exempt agent 无需 DAG 条目 |
| ✅ auto_plan 自愈（启用时） | 降低人工规划负担 |
| ✅ depends_on 数组 | 表达非线性依赖（虽目前大部分线性） |

#### 去除什么

| 去除 | LOC 节省 | 原因 |
|---|:---:|---|
| ❌ `execution_order` 分组嵌套 | ~120 | 两阶段 tasks[]+execution_order 扫描→单数组 `.find()` |
| ❌ `dag-version-manager.ts` 简化为 weekly snapshot | ~350 | hot/warm/cold 三层快照过度工程化 |
| ❌ `archive-dag-tasks.ts` | 91 | 夜间归档对单人项目无实际价值 |
| ❌ `migrate-dag-v2.ts` | 283 | 一次性迁移脚本，已完成 |
| ❌ `dag_task_id` 双语义拆开 | ~30 | 消除路径命名空间+审计双重含义的混淆 |

#### 简化后的 task 结构

```json
{
  "version": 3,
  "tasks": [
    {
      "task_id": "T-001",
      "title": "实现预约 API POST 端点",
      "status": "pending",
      "priority": 1,
      "depends_on": [],
      "requirement_source": ["SAD§3.2", "接口规范§4.1"],
      "assigned_agent": "Coder",
      "context": "backend"
    }
  ],
  "changelog": [
    { "date": "2026-06-18", "action": "created", "task_ids": ["T-001"] }
  ]
}
```

#### 量化对比

| 指标 | 当前 DAG | 简化后 | Delta |
|---|---|---|:---:|
| 框架代码 (LOC) | ~2,220 | ~1,400 | **-820** |
| DAG 相关文件 | 30+ | ~18 | **-12** |
| Per-dispatch check | 两阶段扫描 | 单数组 `.find()` | **-50% 复杂度** |
| @Meta-Planner token 成本 | ~50K | ~20K | **-60%** |
| 版本管理 | hot/warm/cold 三层 | 单 weekly snapshot | **-350 LOC** |

### 3.C 执法机器瘦身：3 个精简目标

> **审核观点（@QoderCN）**：这是原两份提案都未覆盖的维度。Agent 数量和 DAG 形态是表层，执法机器的层层叠加才是根因。不瘦身执法机器，只砍 agent 数量，整体复杂度降幅有限。

#### 目标 C1：插件钩子冗余评估

当前 16 个 before/after 插件钩子。需逐一评估 dead code：
- framework-doctor 和 framework-self-test 应能识别从未触发的钩子
- 多个钩子可能做重复检查（如 dispatch-before 和 gate-before 都检查 DAG 条目）
- **建议**：产出 16 钩子 × 触发频率 × 拦截事件数 的矩阵，零拦截的钩子考虑合并或删除

#### 目标 C2：UC7KS 语义域精简

当前 12 语义域 + 7 知识脚本。实践中有多少域被活跃使用？
- **建议**：合并 `module_scope_declare` 和 `knowledge_cache_search` 为单个 pre-dispatch hook
- 精简语义域 12 → 5-6（保留活跃使用的）
- 合并 7 知识脚本 → 2-3 统一脚本
- 保留 `docs/official_docs/` + `index.json` 知识组织约定
- **绝不移除 "read before write" 硬约束**——这是与 Permission Matrix 同构的行为强制价值

#### 目标 C3：P1-B split architecture 合并评估

当前 SQLite DB + JSON 子状态 split architecture（gate-state.json + gate-state.drained_sessions.json + gate-state.index.json 等）。
- 合规门核心状态已在 SQLite 中，JSON 子状态是否可以完全合并回 DB？
- **建议**：评估 JSON 子状态的读/写频率，低频的合并回 SQLite，只保留高频的作为 cache

---

## 4. 迁移路径

> **关键原则**：三条主线**完全独立、互不阻塞**。每条可单独推进、单独 rollback、单独验证。

### 4.0 Phase 0：基线测量（所有主线前置，1-2 周）

> **审核观点（@QoderCN）**：两份原提案都未做迁移前的基线测量。没有基线，"44% token 节省"只是模型推算，不是实测。Phase 0 是所有后续 Phase 的前置条件。

**目标**: 采集 per-task 端到端指标基线

**步骤**:
1. 在当前 10-agent + DAG + 完整执法架构下运行 5-10 个完整 task 流程
2. 采集指标：端到端时间、总 token 消耗、rework rate、合规门 MCP 调用次数
3. 建立 `baseline-metrics.json`
4. 每个后续 Phase 完成后用同指标对比，验证优化有效性

**验证**: baseline-metrics.json 写入 `.opencode/state/` 并被 git 跟踪

### 4.A Agent 主线迁移（P1，5 phases）

#### Phase A1：Orchestrator 拆分（Week 1，~6h）

> **审核修正**：原提案 Phase 1 将 Orchestrator 整体硬编码化。本提案改为拆分。

**目标**: 将 Orchestrator 拆为 dispatch (硬编码) + approve (LLM) 两个独立模块

**步骤**:
1. 从 Orchestrator agent 配置和 dispatch 模式提取调度逻辑 → `scripts/orchestrate-dispatch.ts`
2. 提取 approve_deliverables 逻辑 → `scripts/orchestrate-approve.ts`（保留 LLM 调用）
3. 实现：dispatch: 读 task list → 找 ready → dispatch → 收结果 → 更新状态
4. 实现：approve: 读 evidence → 与 declared_deliverables 比对 → approve/reject → drain gate
5. 重试逻辑：3x 失败 → Guardian 升级
6. 保留 Orchestrator agent 配置作为 fallback（deprecated，不删除）一周
7. **验证**: 运行现有测试 → 验证调度行为一致 + approve 行为等同
8. **Rollback**: 恢复 Orchestrator agent 配置

**风险**: 中。approve 模块的 LLM 调用需要 prompt 工程。Mitigation：保留原 Orchestrator agent 作为 fallback。

#### Phase A2：合并 Meta-Planner + Architect（Week 1-2，~8h）

**目标**: 创建统一 Planner-Architect agent

**步骤**:
1. 创建 `agents/planner-architect.md` 合并两者 prompts
2. 映射两者 skill set
3. 合并工具权限
4. 测试新 feature request：Planner-Architect 应在一个 session 中同时生成 task list + contract.yaml
5. Deprecated（不删除） `agents/meta-planner.md` 和 `agents/architect.md`
6. **验证**: 3 个测试规划周期 → 输出质量 ≥ 分离 agent
7. **Rollback**: 恢复单独 agent 配置

**风险**: 中。合并 agent 可能因 context window 过载产出低质量。Mitigation：大型项目可多次调用 Planner-Architect，每次处理子系统。

#### Phase A3：合并 Coder-BE + Coder-FE（Week 2-3，~6h）

> **审核修正**：建议先 A/B 实测再决定是否推进。

**目标**: 替换两个 agent 配置为一个参数化 Coder agent

**前置条件**: 完成 3 BE + 3 FE 任务 A/B 实测（合并版 vs 分离版），rework rate 无显著退化

**步骤**:
1. 创建 `agents/coder.md` 含 BE/FE 专门化模板变量
2. 更新 `project.config.json` template_resolution
3. 测试 BE task → 验证工具和权限解析为 backend path
4. 测试 FE task → 验证工具和权限解析为 frontend path
5. Deprecated `agents/coder-be.md` 和 `agents/coder-fe.md`
6. **验证**: 3 BE + 3 FE 任务 → 行为等同
7. **Rollback**: 恢复单独 agent 配置

**风险**: 中-高。BE/FE 生态差异可能超出模板变量能覆盖的范围。Mitigation：如质量退化，保持分离但共享公共配置（inheritance，未来 feature）。

#### Phase A4：Demote Arbiter + Super-Admin + 简化 KC（Week 3-4，~4h）

**目标**: 移除三个低使用率 agent（KC 改为简化而非删除）

**步骤**:
1. **Arbiter**: Guardian prompt 增加升级逻辑（"标记冲突供人工审查。建议: ..."）。删除 `agents/arbiter.md`。TECH_DEBT_REGISTRY.md 改为人工维护。**条件**：仅当项目预期持续单人开发时才执行。
2. **Super-Admin**: 删除 `agents/super-admin.md`。文档化框架修复流程为人工执行。`mode: "all"` 意味着它本来就是 human-accessible。
3. **Knowledge-Curator**: **保留角色，仅简化实现**：
   - 合并 `module_scope_declare` + `knowledge_cache_search` → 单个 pre-dispatch hook
   - 精简语义域 12 → 5-6
   - 合并 7 知识脚本 → 2-3 统一脚本
   - 保留 `agents/knowledge-curator.md`（角色定义不变）
   - 保留 UC7KS "read before write" 硬约束（与 Permission Matrix 同构的行为强制）
4. **验证**: 运行 self-test → 框架配置中无被移除 agent 的引用。运行一个完整 task 流程 → 所有功能覆盖
5. **Rollback**: 恢复 agent 配置

**风险**: 中（Arbiter 治理缺口）、低（Super-Admin 本来就是 human）、低（KC 仅简化实现不删除角色）

#### Phase A5：清理 & 文档（Week 4，~2h）

**步骤**:
1. 更新 AGENTS.md — agent 列表 10→5
2. 更新 opencode.json — 移除 5 个消除 agent 权限矩阵条目
3. 更新 project.config.json
4. 更新 docs/official_docs/index.json
5. 运行 framework-self-test.ts
6. Commit `[INFRA]` marker

**风险**: 低。纯清理，无功能变更。

### 4.B DAG 主线迁移（P2，4 phases）

#### Phase B1：去除 execution_order 分组 + 简化 findTaskInDag（~2h）

**目标**: 两阶段 tasks[]+execution_order 扫描 → 单数组 `.find()`

**步骤**:
1. 重写 `findTaskInDag` → `findTaskInList`（单数组查找）
2. 更新 dispatch-before.ts、dispatch_subagent.ts、gate-before.ts、pre-execution-gate.ts
3. 添加数据迁移脚本：现有 Task.DAG.json → 新格式 tasks.json
4. **验证**: framework-self-test Check 37 适配
5. **Rollback**: 恢复原 findTaskInDag + execution_order 格式

#### Phase B2：拆开 dag_task_id 双语义（~1h）

**目标**: `dag_task_id` 参数拆为 `task_id`（纯审计）+ 路径命名空间由 dispatch 自动生成

**步骤**:
1. 更新 dispatch_subagent.ts 工具参数
2. 更新 pre-execution-hook.sh
3. **验证**: dispatch 流程无回归
4. **Rollback**: 恢复 dag_task_id

#### Phase B3：简化版本管理子系统（~2h）

**目标**: dag-version-manager.ts (439 LOC) → 单 weekly snapshot + changelog（保留审计能力）

> **审核观点（@QoderCN）**：原提案建议彻底删除版本管理。但 hot/warm/cold 快照 + changelog 是审计/回滚机制，删除不可逆。建议改为简化而非删除。

**步骤**:
1. 将 hot/warm/cold 三层 → 单 weekly snapshot（保留 changelog）
2. 删除 archive-dag-tasks.ts（91 LOC）
3. 删除 migrate-dag-v2.ts（283 LOC，已完成的一次性迁移）
4. 简化 dag-version-manager.ts → `task-changelog.ts`（~100 LOC）
5. **验证**: changelog 可追溯，weekly snapshot 可回滚
6. **Rollback**: 恢复完整版本管理子系统

#### Phase B4：更新规则/文档 + framework-doctor/self-test（~3h）

**步骤**:
1. 更新 dag-generation-standard.md → task-list-generation-standard.md
2. 更新 AGENTS.md、TEMPLATE_VARIABLE_STANDARD.md
3. 更新 framework-doctor Check 12、framework-self-test Check 37
4. **验证**: 全部检查通过
5. **Rollback**: 恢复原文档

**总估算**: ~8h（原提案 3-6h 偏乐观，审核修正为 8-12h，含回归测试）

> **P2 分类不变**：DAG 正常工作不阻断任何当前任务。简化降低维护负担和 token 成本但不紧急。建议在"下一个 DAG 相关痛点出现时"才推进，而非主动迁移。

### 4.C 执法机器瘦身主线（P1，3 phases）

#### Phase C1：插件钩子冗余矩阵产出（~4h）

**目标**: 16 钩子 × 触发频率 × 拦截事件数矩阵

**步骤**:
1. 对每个钩子运行 grep 统计日志中触发次数
2. 标记零拦截的钩子
3. 标记做重复检查的钩子对（如 dispatch-before 和 gate-before 都检查 DAG 条目）
4. 产出 `enforcement-hook-matrix.md`
5. **决策**: 合并/删除/保留的处置方案

**风险**: 低。纯分析，无代码变更。

#### Phase C2：UC7KS 精简实施（~6h）

**目标**: 语义域 12→5-6，脚本 7→2-3

**步骤**:
1. 分析 12 语义域的使用频率（grep docs/official_docs/index.json 中各域引用次数）
2. 合并低频域
3. 合并 module_scope_declare + knowledge_cache_search → 单个 pre-dispatch hook
4. 合并 7 脚本 → 2-3 统一脚本
5. 更新 agent 配置引用
6. **验证**: UC7KS "read before write" 约束仍生效（knowledge_cache_search 仍强制）
7. **Rollback**: 恢复原脚本

**风险**: 中。UC7KS 是行为强制核心——精简必须保留"read before write"硬约束。

#### Phase C3：P1-B split architecture 合并评估（~4h）

**目标**: 评估 JSON 子状态是否可合并回 SQLite

**步骤**:
1. 测量各 JSON 子状态文件的读/写频率
2. 低频子状态（如 drained_sessions.json）合并回 SQLite 表
3. 高频子状态（如 gate-state.index.json）保留为 cache（但源数据在 DB）
4. **验证**: 合规门状态机行为无回归
5. **Rollback**: 恢复 split architecture

**风险**: 低-中。DB 合规门核心状态已在 SQLite，JSON 子状态是附属。

### 4.D 统一迁移时间线

```
Week 0:  Phase 0 (基线测量)
         ├── Day 1-5: 采集 5-10 个完整 task 流程指标

Week 1:  Phase A1 (Orchestrator 拆分) + Phase C1 (钩子矩阵)
         ├── Day 1-3: Phase A1 implementation + validation
         └── Day 3-5: Phase C1 analysis output

Week 2:  Phase A2 (Planner-Architect 合并) + Phase B1/B2 (DAG 存储)
         ├── Day 1-4: Phase A2 implementation + validation
         └── Day 4-5: Phase B1 + B2 (可与 A2 并行)

Week 3:  Phase A3 (Coder A/B 实测 + 合并)
         ├── Day 1-2: A/B 实测
         └── Day 3-5: 合并实施（如 A/B 结果支持）

Week 4:  Phase A4 (Arbiter/Super-Admin/KC 简化) + Phase C2 (UC7KS 精简)
         ├── Day 1-3: Phase A4
         └── Day 3-5: Phase C2

Week 5:  Phase B3/B4 (DAG 版本管理 + 文档) + Phase C3 (split state 合并)
         ├── Day 1-3: Phase B3 + B4
         └── Day 3-5: Phase C3

Week 6:  Phase A5 (清理) + stabilization + rollback drills
```

**总估算**: ~36h over 6 周（含基线测量 + 回归测试）

---

## 5. Tradeoff 分析

### 5.1 三维统一量化表

| 维度 | 当前 | 提案 | Delta | 主线 |
|---|:---:|:---:|:---:|---|
| LLM agent 数 | 10 | 4 | -60% | A |
| Agent 配置行 | ~1000 | ~600 | -40% | A |
| 权限矩阵行 | ~600 | ~240 | -60% | A |
| HANDOVER 链长 | 5-7 | 3-4 | -40% | A |
| DAG 相关 LOC | ~2220 | ~1400 | **-820** | B |
| DAG 相关文件 | 30+ | ~18 | -12 | B |
| Per-dispatch 查找 | 两阶段 | 单 `.find()` | -50% 复杂度 | B |
| @Meta-Planner token | ~50K | ~20K | -60% | B |
| UC7KS 语义域 | 12 | 5-6 | -50% | C |
| UC7KS 脚本 | 7 | 2-3 | -60% | C |
| 插件钩子 | 16 | ~10 (估) | -38% (估) | C |
| 合规门 MCP 调用/次 | 5 (non-exempt) | 5 (不变) | 0 | — |
| Per-dispatch token overhead | ~2K-5K | ~1K-3K (估) | -40% (估) | A+B |
| 注意力质量 | 高 | 高 | 不变 | A |
| 并行能力 | BE+FE 可并行 | BE+FE 可并行 | 不变 | A |

### 5.2 Agent 主线定性 Tradeoff

#### Tradeoff A1：Planner-Architect 合并 — Context Window vs Coherence

**增益**: 规划和架构深度耦合。合并消除交接（Architect 收到 DAG 后必须从 JSON 推断 Planner 意图）。Planner-Architect 在单一 context window 中维持"做什么"和"怎么组合"的连贯性。

**风险**: 单一 context window 可能不足以同时容纳完整 DAG 生成 + 详细 contract.yaml 设计。

**缓解**: 大型项目（50+ tasks）可多次调用 Planner-Architect，每次处理子系统。flat task list 支持增量规划，不需 context overflow。

**审核观点**: Anthropic 的指导 *"Maintain simplicity in agent design"* 支持合并。但需设置 context window 阈值——如单次调用需 >50K tokens 输入，则拆回两次调用。

#### Tradeoff A2：Coder 参数化 — Flexibility vs Specialization

**增益**: 一个 agent 配置维护而非两个。模板变量确保 BE/FE 上下文区分。

**风险**: 单配置可能无法捕捉 BE/FE 专属约束（不同 lint 规则、不同测试框架、不同编码模式）。

**缓解**: 权限矩阵和 Context7 映射提供 per-task 专门化。如质量退化可拆回——但尝试合并的成本低。

**审核观点**: 建议先 A/B 实测再决定。3 BE + 3 FE 任务对比 rework rate，数据说话。

#### Tradeoff A3：Guardian 吸收 Arbiter — Review Scope vs Objectivity

**增益**: 消除主要解决框架自身冲突的专门 agent。框架稳定后冲突自然减少。

**风险**: Guardian 标记冲突时无独立 Arbiter 裁决。Human 必须做治理决策。

**缓解**: 技术债和架构冲突本就应是 human 决策。Anthropic evaluator-optimizer 模式把 evaluator 放在优化循环内，不是独立仲裁层。A2A 的 `input-required` state 支持此模式。

**审核观点**: 对单人开发者，"转 human"是 context switch 成本转移而非消除。建议 Guardian prompt 增加结构化冲突报告模板，降低 human 决策的认知负担。

#### Tradeoff A4：Orchestrator 拆分 — Determinism vs Judgment

**增益**: dispatch 确定性、可测试、零 LLM token。approve 保留 LLM 审查能力。

**风险**: 拆分后两个模块需协调（dispatch 发出后等待 approve 结果才能更新状态）。

**缓解**: dispatch 调用 approve 为同步步骤，approve 失败则 dispatch 将 task 标为 blocked 并升级。逻辑清晰、可测试。

#### Tradeoff A5：KC 简化而非删除 — 保留差异化 vs 降低维护

**增益**: 保留 UC7KS "read before write" 硬约束——OpenCode 相对行业的差异化价值。降低实现复杂度（12→5-6 域、7→2-3 脚本）。

**风险**: 简化可能遗漏边缘语义域。

**缓解**: 按 docs/official_docs/index.json 引用频率决定保留哪些域，数据驱动而非直觉。

### 5.3 DAG 主线定性 Tradeoff

#### Tradeoff B1：Flat list vs Graph 结构

**增益**: 单数组查找、更少 token、更简单 @Meta-Planner 生成。

**风险**: 丢失显式依赖图（虽 depends_on 数组仍保留隐式图）。

**缓解**: depends_on 数组保留了非线性依赖的表达能力——flat list + depends_on 等价于邻接表编码的 DAG。真正的简化是去除 execution_order 分组嵌套，而非去除依赖关系本身。

**审核观点**: 原提案命名为 "DAG→flat list" 是误导性的。应重命名为 "DAG 存储简化"。

#### Tradeoff B2：版本管理简化 vs 审计完整性

**增益**: ~350 LOC 简化、去除 hot/warm/cold 三层快照的维护负担。

**风险**: 丢失细粒度审计快照（daily → weekly 粒度降低）。

**缓解**: 保留 changelog + weekly snapshot，审计能力不丢失只是粒度降低。对 261 个 task 的活文档，weekly 粒度足够。

#### Tradeoff B3："依赖是线性的" 幸存者偏差

**风险**: 261 个现有 task 依赖线性，但未来可能出现分支/并行依赖。用历史数据论证"未来也不需要图结构"是归纳问题。

**缓解**: depends_on 数组保留分支/并行表达能力。如未来出现复杂依赖，flat list 可通过 depends_on 自然表达——不需要回退到 execution_order 分组。

### 5.4 执法机器 Tradeoff

#### Tradeoff C1：钩子精简 vs 执法纵深

**增益**: 减少冗余检查、降低 per-tool-call 开销。

**风险**: 合并钩子可能丢失纵深防御（一个检查点遗漏则无第二层兜底）。

**缓解**: 只合并**做完全相同检查**的钩子对，不合并做不同检查的钩子。矩阵产出后精确判断。

#### Tradeoff C2：UC7KS 精简 vs 行为强制可靠性

**增益**: 更少脚本、更少语义域、更简单维护。

**风险**: 简化可能破坏 "read before write" 约束的完整性。

**缓解**: 保留核心 enforcement hook（knowledge_cache_search → pre-dispatch hook），仅精简外围脚本和域分类。"read before write" 约束本身不可移除——这是与 Permission Matrix 同构的行为强制价值。

---

## 6. 决策框架

### 6.1 何时新增角色

```
新功能是否需要不同的专业知识域？
  → 否：加入现有 agent 作为新职责或模式
  → 是：调用频率是否 ≥20%？
    → 否：设为 human 触发功能，不做专门 agent
    → 是：是否需要独立权限范围？
      → 否：加入最近现有 agent
      → 是：创建新专门 agent
```

**示例**:

| 场景 | 决策 | 依据 |
|---|---|---|
| "需要数据库迁移专家" | ❌ 加入 Coder | 同专业知识域（实现），同权限范围（backend write） |
| "需要安全审计员" | ✅ 新 agent（如高频） | 不同专业知识（安全 vs 一般审查），不同权限范围 |
| "需要性能优化器" | ❌ 加入 Guardian | Guardian 已评估代码质量——加性能为审查维度 |
| "需要文档撰写员" | ❌ 加入 Planner-Architect | 文档是规划/设计产物 |
| "需要移动端开发者" | ✅ 新 agent（独立技术栈） | 不同专业知识（React Native vs Angular），不同工具 |

### 6.2 何时合并角色

**合并触发条件**:
1. **职责重叠**: 两个 agent 处理同一关注点的不同角度（Meta-Planner + Architect → 都处理"做什么"）
2. **低调用频率**: Agent 在 <10% task 中使用（Arbiter, Super-Admin）
3. **无独立权限范围**: Agent 权限是另一 agent 权限子集
4. **确定性逻辑**: Agent 功能可表达为代码不需 LLM 推理（Orchestrator dispatch）
5. **相同工作流不同上下文**: 两个 agent 遵循相同流程（RED→GREEN→REFACTOR）但不同技术栈（Coder-BE + Coder-FE）

### 6.3 复杂度阈值

| 项目复杂度 | 推荐 Agent 数 | 架构模式 |
|---|:---:|---|
| 单服务 <10 端点 | 1-2 | Augmented single agent 或 prompt chaining |
| Monorepo 10-50 端点 | 3-4 | Orchestrator-Workers (flat) |
| 微服务 50-200 端点 | 4-5 | Orchestrator-Workers + Evaluator |
| 多团队 200+ 端点 | 5-7 | Hierarchical (nested orchestrators) |
| 跨组织 | Protocol (A2A) | Agent-to-agent 标准化协议 |

**OpenCode 定位**: booking-system 是 monorepo 中等复杂度 (~30-50 端点)。5 角色架构 (2 硬编码 + Planner-Architect + Coder + Guardian + CI-CD) 映射到 "Monorepo 10-50 端点" 档，推荐 3-4 agent + 硬编码 orchestrator。验证了提案方向。

### 6.4 执法机器简化决策

```
钩子/管道步骤是否做与其他步骤完全相同的检查？
  → 是：合并为一个步骤
  → 否：调用频率是否 <5%？
    → 是：考虑删除（用 human fallback）
    → 否：是否可通过简化数据结构降低复杂度？
      → 是：简化（如 execution_order→flat array）
      → 否：保留
```

---

## 7. 保留核心原则

以下原则从当前架构显式保留：

### 7.1 角色分离（实现 vs 审查）

> *"实现与审查分离（Coder vs Guardian）"*

**保留**: Coder (实现) 和 Guardian (审查) 保持分离。这是架构中最有价值的分离——防止实现者自我审查，Anthropic evaluator-optimizer 模式显式要求。

### 7.2 权限隔离

> *"角色权限隔离（Permission Matrix）"*

**保留**: 每个剩余 agent 类型有独立权限范围：
- Planner-Architect: contract.yaml, docs/, .opencode/context/（仅设计产物）
- Coder: backend src/ 或 frontend src/（仅实现，永不同时）
- Guardian: read-only + safe_shell（审查工具，永不修改源码）
- CI-CD-Agent: .github/, Dockerfile, git operations（仅部署）

**增强**: 更少 agent 类型 → 权限矩阵更简单、更易审计。Coder 参数化消除权限重复。

### 7.3 注意力聚焦

> *"注意力聚焦（每个 agent 只关注自身职责域）"*

**保留**: 每个剩余 agent 处理单一独立关注点：
- Planner-Architect: "做什么"（规划 + 设计）
- Coder: "怎么建"（实现 + 测试）
- Guardian: "是否正确"（审查 + 质量）
- CI-CD-Agent: "是否上线"（部署 + 运维）

**增强**: Planner-Architect 合并通过消除规划→架构交接 gap **改善**注意力聚焦。Coder 参数化通过确保每次调用只处理 BE 或 FE **保留**聚焦。

### 7.4 合规门禁（认知锚定）

**保留并演进** (2026-06-17 gate-stuck-fix Phase 1-5): 合规门协议从 3 步扩展为 5 步：
- **非豁免 agent (8/10)**: `check` → `confirm`(含 declared_deliverables) → `execute` → `submit_deliverables` → LLM approve+complete (合并)。新状态 delivered/approved；新 MCP 工具。
- **豁免 agent (@Orchestrator→dispatch module, @Super-Admin→human)**: `check` → `confirm` → `complete`（短路径）。

**影响**: 5 步协议增加 per-dispatch MCP 开销（2→5 calls for non-exempt）。§5 token 成本已更新。

**增强**: 更少 agent 类型 → 合规门配置更简单、更不易 drift。

### 7.5 TDD 强制

> *"TDD 铁律：RED → GREEN → REFACTOR"*

**保留**: Coder agent 遵循相同 TDD 工作流。Guardian 验证 TDD 合规（RED 阶段证据、测试执行证据）。

### 7.6 契约驱动开发

> *"contract.yaml 作为唯一开发依据"*

**保留**: Planner-Architect 产出 contract.yaml。Coder 实现对照它。Guardian 验证合规。Keystone hash 验证确保契约完整性。

### 7.7 Keystone Hash 契约绑定

> **审核新增**：原提案遗漏此原则。OpenCode 的 keystone hash 机制确保 contract.yaml 在开发过程中不被篡改——这是另一个差异化硬约束，应显式保留。

**保留**: keystone-hashes.json 由 pre-commit hook 验证。contract.yaml 变更触发 hash 重算 + Guardian 审查。

### 7.8 文件化上下文持久化

> *"HANDOVER.md / TASK_LOG.md"*

**保留**: 跨 agent 边界的上下文传递机制不变。更少交接 → 上下文质量实际改善（更少累积信息损耗）。

### 7.9 UC7KS "Read Before Write" 硬约束

> **审核新增**：原提案遗漏此原则。UC7KS 管道是 knowledge-domain 的行为强制——与 Permission Matrix (write-domain) 同构。

**保留**: 简化实现（域 12→5-6、脚本 7→2-3）但保留 enforcement hook（knowledge_cache_search → pre-dispatch hook）。绝不移除 "read before write" 约束本身。

---

## 8. 架构决策记录 (ADR)

> **审核新增**：三份文档（原 multi-agent proposal、原 DAG analysis、gate-stuck-fix）之间存在方向冲突但无显式消解。ADR 记录架构决策状态，避免后续实施在文档间反复横跳。

### ADR-001：Orchestrator 形态

| 选项 | 描述 | 当前状态 |
|---|---|---|
| A. 整体硬编码 | Orchestrator 全部逻辑转为 TypeScript 脩本 | ❌ 已否决（approve_deliverables 需要 LLM） |
| B. 拆分 dispatch/approve | dispatch 硬编码 + approve 保留 LLM | ✅ **已决定**（本提案 §3.A） |
| C. 保持 LLM Orchestrator | 不做变更 | — 备选（rollback 方案） |

### ADR-002：Knowledge-Curator 存废

| 选项 | 描述 | 当前状态 |
|---|---|---|
| A. 降级为 prompt instruction | 删除 KC agent + UC7KS 管道 | ❌ 已否决（与自身"行为强制"论证矛盾） |
| B. 保留角色 + 简化实现 | 保留 KC，域 12→5-6、脚本 7→2-3 | ✅ **已决定**（本提案 §3.A） |
| C. 保持不变 | 不做变更 | — 备选（rollback 方案） |

### ADR-003：DAG 形态

| 选项 | 描述 | 当前状态 |
|---|---|---|
| A. 完全 flat list（无 depends_on） | 去除所有图结构能力 | ❌ 已否决（依赖表达能力不可丢失） |
| B. Flat list + depends_on（存储简化） | 去除 execution_order 分组 + 版本管理子系统 | ✅ **已决定**（本提案 §3.B） |
| C. 保持完整 DAG | 不做变更 | — 备选（P2，下一个痛点出现时再推进） |

---

## 9. 引用

### 9.1 内部文档

| 文档 | 路径 | 相关性 |
|---|---|---|
| 框架评估报告 §8 | `docs/review/framework-refactor/framework-evaluation-report.md` §8 | 10 角色架构的 5 个问题 |
| 框架评估报告 §9 | 同文件 §9 | PLAN-FIRST 约束分析；DAG 简化推荐 |
| 优化优先级表 | 同文件 lines 650-678 | P2-B: "精简 Multi-Agent 从 10 到 3 角色" |
| OpenCode 多智能体系统 | `docs/official_docs/opencode/findings/06-multi-agent-system.md` | FRAMEWORK_AGENT identity 概念 |
| OpenCode Agent 配置 | `docs/official_docs/opencode/framework/agents.md` | Agent 配置格式 |
| DAG 策略 SSOT | `.opencode/lib/dag-policy.ts` | Canonical exempt list, dispatch_policy |
| DAG 版本管理器 | `.opencode/lib/dag-version-manager.ts` | 版本快照、changelog |
| Gate-core 状态机 | `.opencode/lib/gate-core.ts` | 合规门 5 步状态转换 |
| 合规门检查 | `.opencode/lib/gate-checks.ts` | findTaskInDag 两阶段查找 |
| 跨框架综合 | `docs/official_docs/multi-agent-patterns/cross-framework-synthesis.md` | "状态管理是关键差异化因素" |

### 9.2 外部研究

| 来源 | 文档 | 核心洞察 |
|---|---|---|
| Anthropic | `docs/official_docs/multi-agent-patterns/anthropic-building-effective-agents.md` | "从简开始，按测量添加"；5 workflow 模式；3 核心原则 |
| 跨框架 | `docs/official_docs/multi-agent-patterns/cross-framework-synthesis.md` | 架构复杂度决策树；注意力 vs dispatch cost tradeoffs |
| AutoGen/CrewAI/LangGraph/Swarm | `docs/official_docs/multi-agent-patterns/framework-architectures.md` | 4 框架对比；全部用 3-5 agent + optional manager |
| Google A2A | `docs/official_docs/multi-agent-patterns/google-a2a-protocol.md` | 协议层互操作；opacity as feature；Agent Cards 发现 |

### 9.3 行业共识总结

6 个研究源收敛于：

1. **3-5 专门化 agent + 1 orchestrator/manager 是大多数生产系统的最优范围**
2. **从简开始** —— 仅在测量改善验证后才添加复杂度
3. **注意力聚焦是多 agent 的首要价值**，不是并行化本身
4. **编排在生产系统中趋向硬编码**（LangGraph 图拓扑、Swarm 函数返回）
5. **Human-in-the-loop** 用于治理决策（A2A `input-required` state、Anthropic evaluator-optimizer）
6. **状态管理，而非 agent 数量，是跨框架关键差异化因素**
7. **角色专门化应映射到独立专业知识域**，而非线性工作流的阶段

---

## 附录 A：Agent 配置迁移地图

| 当前 Agent | 配置文件 | 动作 | 新配置文件 |
|---|---|---|---|
| @Orchestrator | `agents/orchestrator.md` | **拆分**（→ dispatch 硬编码 + approve LLM） | `scripts/orchestrate-dispatch.ts` + `scripts/orchestrate-approve.ts` |
| @Meta-Planner | `agents/meta-planner.md` | **合并**（→ Planner-Architect） | `agents/planner-architect.md` |
| @Architect | `agents/architect.md` | **合并**（→ Planner-Architect） | `agents/planner-architect.md` |
| @Coder-BE | `agents/coder-be.md` | **合并**（→ 参数化 Coder） | `agents/coder.md` |
| @Coder-FE | `agents/coder-fe.md` | **合并**（→ 参数化 Coder） | `agents/coder.md` |
| @Guardian | `agents/guardian.md` | **保留**（增强：Arbiter 升级） | `agents/guardian.md` (updated) |
| @Arbiter | `agents/arbiter.md` | **删除**（→ Guardian + human governance） | N/A |
| @CI-CD-Agent | `agents/ci-cd-agent.md` | **保留** | `agents/ci-cd-agent.md` |
| @Super-Admin | `agents/super-admin.md` | **删除**（→ human role） | N/A |
| @Knowledge-Curator | `agents/knowledge-curator.md` | **保留 + 简化** | `agents/knowledge-curator.md` (updated) |

## 附录 B：DAG 文件迁移地图

| 当前文件 | LOC | 动作 | 新文件 |
|---|:---:|---|---|
| `lib/dag-policy.ts` | 399 | 简化（保留 exempt list + dispatch_policy） | `lib/task-policy.ts` |
| `lib/dag-version-manager.ts` | 439 | **简化** → weekly snapshot + changelog | `lib/task-changelog.ts` (~100 LOC) |
| `plugins/dispatch-before.ts` | 193 | 更新（findTaskInList） | `plugins/dispatch-before.ts` (updated) |
| `plugins/gate-before.ts` | 153 | 更新（findTaskInList） | `plugins/gate-before.ts` (updated) |
| `tools/dispatch_subagent.ts` | 571 | 更新（task_id 替代 dag_task_id 双语义） | `tools/dispatch_subagent.ts` (updated) |
| `lib/gate-checks.ts` | 272 | 重写（findTaskInList 替代 findTaskInDag） | `lib/gate-checks.ts` (rewritten) |
| `scripts/archive-dag-tasks.ts` | 91 | **删除** | N/A |
| `scripts/migrate-dag-v2.ts` | 283 | **删除**（已完成的一次性迁移） | N/A |
| `scripts/pre-execution-gate.ts` | 967 | 更新 Check 2/6 | 同文件 (updated) |
| `scripts/pre-execution-hook.sh` | 598 | 更新 DAG gate | 同文件 (updated) |

## 附录 C：执法钩子清理候选（待 Phase C1 矩阵产出后确认）

> 占位符。Phase C1 产出 `enforcement-hook-matrix.md` 后，此处填入 16 钩子的逐一处置方案。

## 附录 D：配置节省汇总

| 产物 | 当前 (10 角色) | 提案 (5 角色) | 节省 |
|---|:---:|:---:|:---:|
| Agent 配置文件 | 10 × ~100 行 = ~1000 | 4 × ~150 行 = ~600 | 40% ↓ |
| 权限矩阵 (opencode.json) | 10 × ~60 行 = ~600 | 4 × ~60 行 = ~240 | 60% ↓ |
| MCP 工具配置 | 10 条目 | 4 条目 | 60% ↓ |
| DAG 相关 LOC | ~2220 | ~1400 | 37% ↓ |
| DAG 相关文件 | 30+ | ~18 | 40% ↓ |
| UC7KS 脚本 | 7 | 2-3 | 60% ↓ |
| UC7KS 语义域 | 12 | 5-6 | 50% ↓ |
| HANDOVER 链长 | 5-7 | 3-4 | 40% ↓ |
| **总维护面** | ~3200 行 (估) | ~1600 行 (估) | **~50% ↓** |
