# 三层八角色多智能体体系 - 全局协作规范

### 🚨 P0 强制规则: 所有任务必须从 `/compliance-gate` 开始
任何开发、分析、设计、审查或部署任务必须以 `/compliance-gate "<task_description>"` 命令启动。合规门未武装（gate not armed），严禁进入分析、设计、编码或审查阶段。此规则优先级高于本文件所有其他规则。

### 🚨 P0 子Agent派遣规则: 必须使用 `/dispatch` 命令
当主Agent需要委托子Agent（subagent）执行任务时，必须通过以下流程：
1. 运行 `node .opencode/scripts/command-tools/dispatch-subagent.js <agent_type> "<task>"` 生成包装后的Prompt
2. 将生成的包装Prompt原样传递给 `Task()` 工具的 `prompt` 参数
3. 禁止手动编写子Agent Prompt绕过执行前检查

包装后的Prompt自动包含：
- `.opencode/agents/<agent_type>.md` 中声明的全部 `skills` 和 `mcp_tools` 调用指令
- 基于任务描述自动判断的 context7 技术栈查询指令
- 完整的 compliance_gate_check → confirm → complete 流程
- 子Agent配置文件中定义的执行协议

此规则确保子Agent始终执行完整的 P0 协议，无论接收何种类型的任务。

### 🚨 P0 全域入口规则: 所有新工作项必须先经 @Meta-Planner
任何新工作项——包括但不限于功能开发、Bug修复、样式调整、性能优化、配置变更——在进入分析、设计或编码阶段前，**必须先经由 @Meta-Planner** 生成或更新 `Task.DAG.json`。禁止任何Agent在 @Meta-Planner 未参与的情况下自行分析或拆解需求。

全域路由判定矩阵：

| 工作项类型 | 是否需要 @Meta-Planner | 操作 |
|-----------|----------------------|------|
| 全新功能/模块 | ✅ 强制 | 调用 @Meta-Planner 生成完整 Task.DAG.json |
| Bug修复 | ✅ 强制 | 调用 @Meta-Planner 生成最小 DAG（分析→RED→GREEN→审查） |
| 样式/UI调整 | ✅ 强制 | 调用 @Meta-Planner 生成最小 DAG |
| 报错排查（涉及代码变更） | ✅ 强制 | 调用 @Meta-Planner 做根因假设分析并生成 DAG |
| 纯信息查询/文档阅读 | ⚠️ 无需 | 直接回答，无需 DAG |
| 配置/环境变量简单变更 | ⚠️ @Orchestrator 自行判断 | 简单→直接执行；复杂→调 @Meta-Planner |

**违规后果**：跳过 @Meta-Planner 直接执行的任务视为无效，@Guardian 审查时自动拒绝。@Orchestrator 不得调度未经 @Meta-Planner 规划的任务。

### 🚨 P0 @Orchestrator 职责边界: 专职调度，禁止越权分析
@Orchestrator 的核心职责是**按图调度**，不是需求分析或任务拆解。具体边界：

| 场景 | 正确动作 | 违规动作 |
|------|---------|---------|
| 收到新工作项，无对应 DAG | 调 `dispatch-subagent.js` 派遣 @Meta-Planner | ❌ 自行分析需求 |
| DAG 已存在，任务状态 pending | 按 DAG 依赖顺序调度子Agent | ❌ 自行修改 DAG 任务定义 |
| DAG 状态与文件状态不同步 | 调 @Meta-Planner 更新 DAG 状态 | ❌ 自行修改 task.status |
| DAG 覆盖率不足（<100%） | 暂停执行，通知 @Meta-Planner 补充 | ❌ 跳过未覆盖任务继续执行 |
| 执行中任务失败需重试 | 按熔断策略执行（降级/专家/人工） | ❌ 自行修改任务范围 |

@Orchestrator 的专属输出产物仅限于：调度状态报告、任务进度追踪、最终产物合并。**禁止 @Orchestrator 产出任何分析性文档（Project.graph、根因分析等）**，这些是 @Meta-Planner 或 @Architect 的职责。

## 一、体系总览

本项目采用**三层八角色**全生命周期自治多智能体架构，覆盖从需求规划、开发实现、质量验证到运维部署的完整链路，严格遵循项目规则。

### 可用子Agent清单（必须完整声明）
- @Meta-Planner
- @Orchestrator
- @Architect
- @Coder-FE
- @Coder-BE
- @Guardian
- @Arbiter
- @CI-CD-Agent

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

### 🚨 合规门禁强制（所有Agent无条件遵守，最高优先级）
所有任务开始前必须依序执行以下三步（均不可跳过）：
1. 调用 `compliance_gate_check(task_description)` — 执行合规门禁检查
2. 向用户展示完整任务计划并等待确认
3. 调用 `compliance_gate_confirm(plan_summary)` — 武装合规门禁

合规门未武装，任何Agent不得进入分析、设计或编码阶段。此门禁优先级高于所有其他规则。

### 🚨 任务完成强制：compliance_gate_complete（所有Agent无条件遵守）
所有任务结束时必须调用 `compliance_gate_complete(session_id, execution_summary)` — 标记任务完成并消费武装状态。

**未调用 compliance_gate_complete 的任务视为未完成。** @Orchestrator 拒绝调度未完成任务的下一个任务。compliance_gate_complete 内部执行 ESLint mock-audit 全量扫描，违规 > 0 时 complete 返回 failed。

### 🚨 TDD 强制铁律（所有Agent无条件遵守）
1. 测试绝对先行：**无测试用例，禁止编写任何业务代码**
2. RED阶段：测试用例必须先执行失败，方可进入开发
3. GREEN阶段：仅编写最简代码通过测试，禁止过度实现
4. REFACTOR阶段：重构必须在测试全量通过后进行
5. 门禁规则：测试未100%通过，禁止进入代码审查环节

## 三、角色清单与分工（8大专业智能体）

### 元认知层（Meta Layer）

| 角色名 | 核心定位 | 调用方式 | 专属职责边界 |
|-------|---------|---------|-------------|
| @Meta-Planner | 项目CTO，顶层需求拆解与DAG规划 | `@Meta-Planner` | 需求分析/拆解、DAG生成/更新、技术债扫描、全局规划。必须遵循 `.opencode/rules/rule_detail/dag-generation-standard.md` |
| @Orchestrator | 项目经理，**专职调度与状态管控** | `@Orchestrator` | **仅负责**：按 DAG 调度子Agent、追踪任务状态、合并最终产物、协调重试。**禁止**：分析需求、拆解任务、修改 DAG 定义 |

### 编排与执行层（Orchestration & Execution Layer）

| 角色名 | 核心定位 | 调用方式 |
|-------|---------|---------|
| @Architect | 系统架构师，接口契约与技术规范定义 | `@Architect` |
| @Coder-FE | 前端开发工程师，页面/组件/交互实现 | `@Coder-FE` |
| @Coder-BE | 后端/服务端开发工程师，API/业务逻辑实现 | `@Coder-BE` |

### 验证与运维层（Validation & Operation Layer）

| 角色名 | 核心定位 | 调用方式 |
|-------|---------|---------|
| @Guardian | 质量门禁，代码规范/安全/架构约束审查 + 测试执行证据验证 | `@Guardian` |
| @Arbiter | 技术委员会，冲突裁决与技术债豁免审批 | `@Arbiter` |
| @CI-CD-Agent | DevOps/SRE，CI管道运维、自动部署与生产自愈 | `@CI-CD-Agent` |

## 四、核心协作协议

0. **【P0】全域 @Meta-Planner 入口协议**：所有新工作项必须先经 @Meta-Planner 生成 Task.DAG.json，再交由 @Orchestrator 调度。详见上方 P0 全域入口规则。
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

所有 Agent 运行时产物（TASK_LOG.md, HANDOVER.md, test_report.json, *_report.json）统一存放于 `.task_temp/{taskId}/` 目录下。全局交叉任务文件（WAIVE.md, incident_report.md, deployment_status.json）存放于 `.task_temp/_global/`。`Task.DAG.json` 存放于项目根目录且必须由 Git 跟踪（pre-commit hook 校验需要）。

## 五、Skill调用规范

所有智能体仅可调用自身配置中绑定的专属Skill，禁止越权调用未授权Skill，严格遵循项目Skill合规要求。

## 六、标准执行流程（全域入口 + RED/GREEN TDD 强制 + 工程化可靠性）

> ⚠️ **适用范围**：以下流程适用于**所有类型**的工作项——功能开发、Bug修复、样式调整、性能优化等。不限于"大型功能"。

0. 【入口判定】**@Orchestrator 或主Agent收到新工作项 → 立即检查 Task.DAG.json**：
   - 若无 DAG 或无当前任务条目 → 先执行步骤 1（@Meta-Planner 规划）
   - 若 DAG 已包含当前任务且状态为 pending → 跳至步骤 2
1. 需求输入 → @Meta-Planner 读取要件文档 + **扫描 TECH_DEBT_REGISTRY.md** → 生成 Project.graph + Task.DAG.json（或更新现有 DAG）
2. @Orchestrator 按 DAG 调度任务 → @Architect 输出 contract.yaml（含 `x-keystone-state-hash`，接口/数据契约，TDD唯一依据）
3. 【TDD-RED 阶段】@Coder-BE / @Coder-FE 基于契约+要件书 → 编写失败测试用例（Commit Message 标记 `[Red] {task_id}`）→ 执行测试（强制失败）
4. 【TDD-GREEN 阶段】@Coder-FE / @Coder-BE **更新 TASK_LOG.md 工作记忆** → 基于测试用例 → 编写最简业务代码 → 让测试全部通过（Commit Message 标记 `[Green] {task_id}`）
5. 【任务交接】执行 Agent 输出 **HANDOVER.md 交接摘要** + **test_report.json（含 execution_evidence + eslint_audit）**
6. 【TDD-REFACTOR 阶段】@Coder 重构代码 → 回归测试（保持全量通过）→ 更新 test_report.json
7. 【合规门关闭环】@Coder 调用 **compliance_gate_complete** → 内部执行 ESLint mock-audit 全量扫描（CAT1.1 检查 + CAT1.0 绕过检查）→ machine.json.eslint_state 更新 → 违规 > 0 时返回 failed，@Coder 必须修复后重试
8. @Guardian 代码审查（规范/安全/架构 + **machine.json.eslint_state 合规检查** + **测试执行证据验证（DoD 强制检查）**）→ 冲突由 @Arbiter 裁决
8. Git Hook 校验 machine.json 契约哈希同步 → 代码合并
9. @CI-CD-Agent 部署/自愈 → 结果回传@Orchestrator → 全流程闭环
10. 【熔断重试】若连续3次未通过 → @Arbiter 介入 → @Orchestrator 执行降级重试/专家切换/人工待命

---

> **项目特定参考**: 技术栈、项目结构、常用命令、架构速查等具体信息请参见 [PROJECT_REFERENCE.md](./PROJECT_REFERENCE.md)。每个项目应自定义该文件中的 `{placeholder}` 占位符以匹配实际项目配置。
