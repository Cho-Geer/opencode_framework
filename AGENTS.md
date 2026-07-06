# 三层九角色多智能体体系 - 全局协作规范

### 🚨 P0 执行入口规则: 先走 `preflight-lite`，按风险升级

任何任务先执行 `preflight-lite` 的最小预检：

1. 复述目标
2. 判断风险级别
3. 选择匹配 skill
4. 决定是否需要 TodoWrite / Context7 / Scout / native Task 子任务

不是所有任务都必须先武装 compliance gate、生成 DAG 或进入多 Agent 编排。只有高风险、需要审批、涉及正式 deliverables、跨 Agent 协作或复杂调查时，才升级到 gate / deliverables / dispatch 流程。

### 🚨 P0 凭据要求：每个结论必须有凭有据，禁止胡编乱造

任何Agent在陈述结论时，必须：

1. 引用具体来源（文件路径+行号，或工具输出原文）
2. 直接引用原文内容作为证据
3. 若没有证据，必须声明"我目前没有足够证据下结论"

**禁止**：无凭据猜测、编造根因、以假设替代事实。

任何 Agent 在给出结论前，必须充分阅读代码、搜索日志、验证数据，搜集足够充分的依据。不可仅凭局部信息或单次观测就断言全局结论。

### 🚨 P0 子任务派遣规则: 优先使用原生 `Task`

当主 Agent 需要委托子 Agent 或研究型子任务时：

1. 优先直接使用原生 `Task`
2. 让子任务自行加载 `preflight-lite` 和匹配的执行 skill
3. 需要 Scout / research / evidence gathering 时，优先 native Task，而不是依赖旧 preamble 包装

`dispatch_subagent` 仅保留为 legacy 兼容工具，不再是默认派遣入口。

### 🚨 P0 Super-Admin 调度规则

@Super-Admin 可通过以下路径调用。framework-enforcer.ts 强制执行约束。

**Super-Admin 调用矩阵**:

| 场景 | 正确动作 | 违规动作 |
| --- | --- | --- |
| 框架文件损坏 | @Orchestrator 用原生 `Task` 派 `@Super-Admin` 修复 | ❌ @Orchestrator 自行修改 |
| 子状态文件不一致 | @Orchestrator 用原生 `Task` 派 `@Super-Admin` 修复状态 | ❌ @Orchestrator 自行修改 |
| 合规门/交付流异常 | @Orchestrator 用原生 `Task` 派专项修复 | ❌ 跳过审计直接收尾 |
| 插件完整性破坏 | @Orchestrator 用原生 `Task` 派 `@Super-Admin` 修复 | ❌ 业务 Agent 直接编辑框架 |
| UC7KS 知识获取 / 缓存扩充 | 根据任务需要用原生 `Task` 派 `@Knowledge-Curator` 或 Scout | ❌ 在无证据情况下直接外查 |

/\*\*

- FW-ROUTE-FIX-03: Updated Super-Admin routing matrix and Agent Scope Boundaries.
- Adds explicit .opencode/ framework routing entries and clarifies Architect's
- scope to exclude framework infrastructure. Enforced by framework-enforcer.ts.
  \*/

### 🚨 P0 Agent 职责边界与路由规则

以下规则明确各Agent的职责范围和越界时的路由目标：

**Agent Scope 边界矩阵**:

| Agent         | 正确职责范围                                                      | 越界行为                           | 路由目标                       |
| ------------- | ----------------------------------------------------------------- | ---------------------------------- | ------------------------------ |
| @Architect    | 业务代码架构设计、`contract.yaml`、需求设计文档、`docs/` 架构文档 | ❌ 修改 `.opencode/` 框架文件      | **自动转发 → @Super-Admin**    |
| @Coder-BE     | 后端业务代码 `booking-backend/src/`                               | ❌ 修改前端代码或 `.opencode/`     | **自动阻断，转 @Orchestrator** |
| @Coder-FE     | 前端业务代码 `booking-frontend/`                                  | ❌ 修改后端代码或 `.opencode/`     | **自动阻断，转 @Orchestrator** |
| @Orchestrator | DAG 调度、状态追踪、产物合并                                      | ❌ 修改 `.opencode/` 框架文件      | **自动转发 → @Super-Admin**    |
| @Super-Admin  | `.opencode/` 框架修复、治理修改                                   | ❌ 修改业务代码 (`booking-*/src/`) | **自动阻断（enforce.ts）**     |

**路由执行规则**:

- 上述路由由 `framework-enforcer.ts` 的 `ROUTE-MISMATCH` 检查在物理层强制执行
- safety-critical 越界写操作：直接阻断
- 质量类越界或流程类异常：记录审计 / QoderWork 可观察信号
- 路由触发时，Agent 应输出明确的拒绝信息并建议正确的路由目标

### 🚨 P0 全域入口规则: 仅复杂任务升级到 @Meta-Planner / DAG

只有非 trivial 的跨 Agent、多阶段、高风险工作项，才需要先经由 `@Meta-Planner` 生成或更新 `Task.DAG.json`。纯信息查询、局部小修、低风险单点修改不应被 DAG 前置卡住。

全域路由判定矩阵：

| 工作项类型 | 是否需要 @Meta-Planner | 操作 |
| --- | --- | --- |
| 全新功能/模块 | ✅ 通常需要 | 生成完整 Task.DAG.json |
| 复杂 Bug / 跨模块重构 | ✅ 需要 | 生成最小可执行 DAG |
| 样式/UI 小调整 | ⚠️ 视复杂度而定 | 简单直接执行；复杂再规划 |
| 纯信息查询/文档阅读 | ❌ 无需 | 直接回答 |
| 简单配置/环境变量修正 | ⚠️ 视风险而定 | 简单直接执行；复杂再规划 |

**原则**：不要把所有任务都强行送进 DAG。DAG 只服务于确实需要规划、分工、审计的任务。

### 🚨 P0 @Orchestrator 职责边界: 专职调度，禁止越权分析

@Orchestrator 的核心职责是**按图调度**，不是需求分析或任务拆解。具体边界：

| 场景 | 正确动作 | 违规动作 |
| --- | --- | --- |
| 收到复杂新工作项且无规划 | 用原生 `Task` 派 `@Meta-Planner` | ❌ 直接硬拆需求并分派 |
| DAG 已存在，任务状态 pending | 按 DAG 依赖顺序调度子任务 | ❌ 自行改写 DAG 定义 |
| DAG 状态与文件状态不同步 | 调 `@Meta-Planner` 或 `@Super-Admin` 修正 | ❌ 静默篡改 task.status |
| 执行中任务失败需重试 | 按熔断策略执行（降级/专家/人工） | ❌ 无审计重试 |

@Orchestrator 的专属输出产物仅限于：调度状态报告、任务进度追踪、最终产物合并。**禁止 @Orchestrator 产出任何分析性文档（Project.graph、根因分析等）**，这些是 @Meta-Planner 或 @Architect 的职责。

### 🚨 P0 PLAN-FIRST 调度约束 (FW-PLAN-FIRST, 2026-06-14)

@Orchestrator 在派遣任何 **非 DAG-exempt** 子 Agent 前，只有在任务已进入 DAG 治理路径时，才要求 `Task.DAG.json` 中存在对应 `dag_task_id` 条目。普通小任务不应被这一约束前置阻断。

| 层次    | 文件                          | 行为                                                                     |
| ------- | ----------------------------- | ------------------------------------------------------------------------ |
| Layer 1 | `plugins/before-dispatcher.ts` | 策略驱动；在 active before chain 中审计/阻断不合规派遣 |
| Layer 2 | 原生 `Task` / legacy `dispatch_subagent` compat | 建立子任务上下文 |
| Layer 3 | `plugins/before-dispatcher.ts` + gate services | 对需要治理的任务做纵深审计 |

**DAG-exempt agents**(无需 DAG 条目即可派遣):
@Meta-Planner、@Orchestrator、@Super-Admin、@Knowledge-Curator。
规范列表在 `.opencode/lib/dag-policy.ts`,其他文件不得重新定义。

**自愈机制** `auto_plan=true`:当 @Orchestrator 需要派遣非 exempt
子 Agent 但任务尚未规划时,设置 `auto_plan: true`,框架将自动派遣
@Meta-Planner 生成规划,轮询 `Task.DAG.json` 直到条目出现,然后
继续原派遣。受 `dispatch_policy` 约束:

- `auto_plan_enabled: true` 才允许(默认 rollout 阶段为 `false`)
- `auto_plan_max_per_session: 5`(每会话次数上限)
- `auto_plan_timeout_ms: 120000`(每次超时)
- 所有尝试记入 `transaction-state.json` 的 `auto_plan_history` 字段（P1-B split architecture）

**@Orchestrator 不能绕过**:

- 无法修改 `dispatch_subagent.ts` 或 `dispatch-before.ts`
  (其 `safe_edit` 权限禁止 `.opencode/**`)
- 无法修改 `project.config.json.dispatch_policy`(同上,加上
  `framework-enforcer.ts` 的 `DISPATCH-POLICY-TAMPER` 检查)
- 无法通过 @Super-Admin 绕过(@Super-Admin 派遣需匹配修复模式,
  编辑 `dispatch_policy` 不是修复模式)
- 无法在需要治理的 DAG 任务上静默跳过 `dag_task_id`

参考:`docs/review/cicd-dag-block/plan-first-redesign.md`。

## 一、体系总览

本项目采用**三层九角色**全生命周期自治多智能体架构，覆盖从需求规划、开发实现、质量验证到运维部署的完整链路，严格遵循项目规则。

### 可用子Agent清单（必须完整声明）

- @Meta-Planner
- @Orchestrator
- @Architect
- @Coder-FE
- @Coder-BE
- @Guardian
- @Arbiter
- @CI-CD-Agent
- @Super-Admin

## 二、全局强制规则（Always Apply，最高优先级）

所有智能体必须严格遵循以下项目规则文件（自动加载）：

1. 核心规则

- `.opencode/rules/common-project.md`：通用项目开发规范
- `.opencode/rules/mcp-compliance-guide.md`：MCP工具使用合规要求
- `.opencode/rules/skill-compliance-guide.md`：Skill调用权限与合规要求

2. 项目要件与设计文档（强制遵循）

- `.opencode/context/requirements/系统架构设计文档（SAD）.md`
- `.opencode/context/requirements/接口设计规范文档.md`
- `.opencode/context/requirements/数据架构设计文档.md`
- `.opencode/context/requirements/安全架构设计文档.md`
- `.opencode/context/requirements/测试策略与计划.md`
- `.opencode/context/requirements/运维与部署设计文档.md`
- `.opencode/context/code_standards/frontend-coding-standard.md`（前端开发强制遵循）
- `.opencode/context/code_standards/backend-coding-standard.md`（后端开发强制遵循）
- `.opencode/context/code_standards/testing-coding-standard.md`（测试编写与审查强制遵循）

### 🚨 合规门禁升级条件（按风险触发，不是全任务前置）

只有下列任务默认升级到 `compliance_gate_check / confirm / complete`：

1. 高风险修改
2. 需要审批或正式交付物
3. 跨 Agent 协作链路
4. 调查/审计类任务需要可追溯 deliverables

低风险、局部、可快速验证的小任务，不应被 gate 前置阻断。

### 🚨 任务完成要求：按任务类型收尾

- gate 治理路径中的任务：完成时调用 `compliance_gate_complete`
- 非 gate 路径的小任务：完成必要验证、记录 evidence / TodoWrite / handover 即可

不要把 `compliance_gate_complete` 误用成所有任务的统一强制收尾器。

### 🚨 TDD 强制铁律（所有Agent无条件遵守）

1. 测试绝对先行：**无测试用例，禁止编写任何业务代码**
2. RED阶段：测试用例必须先执行失败，方可进入开发
3. GREEN阶段：仅编写最简代码通过测试，禁止过度实现
4. REFACTOR阶段：重构必须在测试全量通过后进行
5. 门禁规则：测试未100%通过，禁止进入代码审查环节

## 三、角色清单与分工（9大专业智能体）

### 元认知层（Meta Layer）

| 角色名        | 核心定位                         | 调用方式        | 专属职责边界                                                                                                         |
| ------------- | -------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------- |
| @Meta-Planner | 项目CTO，顶层需求拆解与DAG规划   | `@Meta-Planner` | 需求分析/拆解、DAG生成/更新、技术债扫描、全局规划。必须遵循 `.opencode/rules/rule_detail/dag-generation-standard.md` |
| @Orchestrator | 项目经理，**专职调度与状态管控** | `@Orchestrator` | **仅负责**：按 DAG 调度子Agent、追踪任务状态、合并最终产物、协调重试。**禁止**：分析需求、拆解任务、修改 DAG 定义    |

### 编排与执行层（Orchestration & Execution Layer）

| 角色名     | 核心定位                                | 调用方式     |
| ---------- | --------------------------------------- | ------------ |
| @Architect | 系统架构师，接口契约与技术规范定义      | `@Architect` |
| @Coder-FE  | 前端开发工程师，页面/组件/交互实现      | `@Coder-FE`  |
| @Coder-BE  | 后端/服务端开发工程师，API/业务逻辑实现 | `@Coder-BE`  |

### 验证与运维层（Validation & Operation Layer）

| 角色名       | 核心定位                                                                           | 调用方式       |
| ------------ | ---------------------------------------------------------------------------------- | -------------- |
| @Guardian    | 质量门禁，代码规范/安全/架构约束审查 + 测试执行证据验证                            | `@Guardian`    |
| @Arbiter     | 技术委员会，冲突裁决与技术债豁免审批                                               | `@Arbiter`     |
| @CI-CD-Agent | DevOps/SRE，CI管道运维、自动部署、git版本管理（commit/push/tag/release）与生产自愈 | `@CI-CD-Agent` |

## 四、核心协作协议

0. **【P0】规划入口协议**：只有非 trivial 的跨 Agent、多阶段、高风险工作项才必须先经 @Meta-Planner 生成 Task.DAG.json。详见上方 P0 全域入口规则。
1. **权限隔离原则**：每个智能体仅拥有专属Skill权限，禁止越权操作，严格遵循`skill-compliance-guide.md`。**@Orchestrator 尤其不得越权分析需求或拆解任务**。
2. **DAG调度规则**：由@Orchestrator解析@Meta-Planner生成的`Task.DAG.json`，严格按依赖顺序调度子任务，无依赖任务并行执行。@Orchestrator **不得修改 DAG 中的任务定义**。
3. **契约驱动开发**：@Architect输出的`contract.yaml`为只读锁定状态，前后端开发、测试、审查均以此为唯一依据。
4. **质量门禁强制**：所有代码必须通过@Guardian审查（含测试执行证据验证），未通过禁止合并。
5. **闭环反馈机制**：@CI/CD-Agent将部署/运维结果回传给@Orchestrator，@Arbiter将裁决结果回传给@Meta-Planner，形成全链路闭环。
6. **上下文治理**：每个阶段完成后自动压缩上下文，仅传递必要结果，禁止冗余信息污染。
7. **死循环熔断**：连续3次未通过审查/测试，自动触发@Arbiter介入，终止当前任务流。
8. **工作记忆草稿纸**：@Coder-BE 和 @Coder-FE 在编写代码前，必须先更新任务专属 `TASK_LOG.md`，记录本次修改计划、新增方法、返回类型等关键信息，防止长串行输出中的上下文漂移。该文件不提交到 Git（已加入 `.gitignore`）。
9. **测试执行证据强制**：@Coder-BE/@Coder-FE 输出的 `test_report.json` 必须包含 `execution_evidence` 字段（测试命令输出的关键摘要或断言结果），@Guardian 审查时若发现缺失则直接返回 `FAIL`。
10. **技术债可视化追踪**：@Arbiter 批准 `WAIVE.md` 后，必须在项目根目录 `TECH_DEBT_REGISTRY.md` 中追加记录；@Meta-Planner 规划新版本时必须扫描该注册表，将临近偿还日的技术债转化为新任务。
11. **交接摘要机制**：每个执行类 Agent（@Coder-BE、@Coder-FE）在任务完成时，必须输出 `HANDOVER.md` 放在任务专属临时目录下，包含核心改动、关键假设、潜在坑点、测试提醒，降低串行环节信息损耗。
12. **自愈熔断重试策略**：任务被 @Arbiter 熔断后，@Orchestrator 按优先级执行降级重试（调用 @Meta-Planner 生成更细粒度任务）、专家切换（@Architect 重审契约）、或人工待命（附完整失败上下文）。

### 运行时产物路径规范

所有 Agent 运行时产物（TASK_LOG.md, HANDOVER.md, test_report.json, \*\_report.json）统一存放于 `.task_temp/{taskId}/` 目录下。全局交叉任务文件（WAIVE.md, incident_report.md, deployment_status.json）存放于 `.task_temp/_global/`。`Task.DAG.json` 存放于项目根目录且必须由 Git 跟踪（pre-commit hook 校验需要）。

## 五、Skill调用规范

所有智能体仅可调用自身配置中绑定的专属Skill，禁止越权调用未授权Skill，严格遵循项目Skill合规要求。

## 六、标准执行流程（复杂任务 / DAG 治理路径）

> ⚠️ **适用范围**：以下流程适用于跨 Agent、需交付、需审批、需持续审计的复杂任务。局部小任务应走 `preflight-lite + skill + active hook` 的轻路径，而不是机械套完整 DAG/gate 流程。

0. 【入口判定】**@Orchestrator 或主Agent先判断任务复杂度与风险**：
   - 若只是局部小任务 / 纯阅读 / 低风险修正 → 走 `preflight-lite + skill + active hook` 轻路径
   - 若是跨 Agent、多阶段、高风险、需交付或需审批任务 → 再进入步骤 1（@Meta-Planner / DAG 治理）
1. 需求输入 → @Meta-Planner 读取要件文档 + **扫描 TECH_DEBT_REGISTRY.md** → 生成 Project.graph + Task.DAG.json（或更新现有 DAG）
2. @Orchestrator 按 DAG 调度任务 → @Architect 输出 contract.yaml（含 `x-keystone-state-hash`，接口/数据契约，TDD唯一依据）
3. 【TDD-RED 阶段】@Coder-BE / @Coder-FE 基于契约+要件书 → 编写失败测试用例（Commit Message 标记 `[Red] {task_id}`）→ 执行测试（强制失败）
4. 【TDD-GREEN 阶段】@Coder-FE / @Coder-BE **更新 TASK_LOG.md 工作记忆** → 基于测试用例 → 编写最简业务代码 → 让测试全部通过（Commit Message 标记 `[Green] {task_id}`）
5. 【任务交接】执行 Agent 输出 **HANDOVER.md 交接摘要** + **test_report.json（含 execution_evidence + eslint_audit）**
6. 【TDD-REFACTOR 阶段】@Coder 重构代码 → 回归测试（保持全量通过）→ 更新 test_report.json
7. 【合规门关闭环】@Coder 调用 **compliance_gate_complete** → 内部执行 ESLint mock-audit 全量扫描（CAT1.1 检查 + CAT1.0 绕过检查）→ eslint-state.json 更新 → 违规 > 0 时返回 failed，@Coder 必须修复后重试
8. @Guardian 代码审查（规范/安全/架构 + **eslint-state.json 合规检查** + **测试执行证据验证（DoD 强制检查）**）→ 冲突由 @Arbiter 裁决
9. Git Hook 校验 keystone-hashes.json 契约哈希同步 → 代码合并
10. @CI-CD-Agent 部署/自愈 → 结果回传@Orchestrator → 全流程闭环
11. 【熔断重试】若连续3次未通过 → @Arbiter 介入 → @Orchestrator 执行降级重试/专家切换/人工待命

---

> **项目特定参考**: 技术栈、项目结构、常用命令、架构速查等具体信息请参见 [PROJECT_REFERENCE.md](./PROJECT_REFERENCE.md)。每个项目应自定义该文件中的 `{placeholder}` 占位符以匹配实际项目配置。
