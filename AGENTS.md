# work-one 运行态全局协作规范（OpenCode 多 Agent 框架）

> 本规范是 work-one 框架的**实际运行态**文档，供 OpenCode Agent 会话启动时自动加载。
> 所有描述以当前 `opencode.json` / `project.config.json` 实测为准。

> ⚠️ **设计蓝图 vs 运行态（必读）**：原「三层九角色」10-agent 架构
> （Meta-Planner / Architect / Coder-BE / Coder-FE / Guardian / Arbiter / CI-CD-Agent / Super-Admin / Knowledge-Curator + Orchestrator）、
> `Task.DAG.json` / `@Meta-Planner` 规划、`contract.yaml` keystone-hash、`booking-backend`/`booking-frontend` demo 项目等，
> 均为**设计蓝图 / 历史架构**，**当前运行态并未注册这些 agent，也未启用该治理链**。
> 它们保留在 `blueprints/` 目录供参考，不在本规范约束范围内。下文一律以运行态为准。

---

## 一、体系总览（实际运行态，opencode.json 实测）

| 维度 | 运行态数量 / 位置 |
| --- | --- |
| Agent | **5**：Orchestrator（自定义）+ 4 native（build / general / plan / explore） |
| Plugin 入口 | 5（`.opencode/plugins/*.ts`） |
| Plugin Handler 源文件 | 43（`.opencode/plugin-handlers/**/*.ts`，排除 `__tests__`） |
| active handler 链 | before 11 / after 7 / system 2 = 20（见第四节） |
| 自定义 Tool | 37（`.opencode/tools/*.ts`） |
| MCP Server | 12（`opencode.json` 的 `mcp` 对象） |
| Skill | 18（`.opencode/skills/{name}/SKILL.md` 自动发现） |
| 代码基线 | CodeGraph 421 files（实测）；active `.opencode` TS 369 files / 75,218 lines（`rg`，遵 gitignore） |
| 数据库 | SQLite 单一数据源 `framework-state.db`（schema v37，49 business / 50 total），权威路径 `.opencode/state/framework-state.db` |

**权威配置源**：
- `opencode.json`：Agent / Plugin / MCP 注册、Agent 权限（`permission`）、工具能力声明。
- `project.config.json`：`plugin_execution_order`、`dispatch_policy`、`enforcement_exemptions` 等运行时治理配置。

---

## 二、全局强制规则（Always Apply，最高优先级）

所有 Agent 必须严格遵循，结论必须有凭有据（禁止无凭据猜测、编造根因）。

### 🚨 P0 执行入口规则：先 `preflight-lite`，按风险升级
任何任务先执行 `preflight-lite` 最小预检（复述目标 → 判断风险 → 选择匹配 skill → 决定是否需要 TodoWrite / Context7 / explore / native Task）。
只有高风险、需要审批、涉及正式 deliverables、跨 Agent 协作或复杂调查时，才升级到 gate / deliverables / dispatch 流程。

### 🚨 P0 凭据要求：每个结论必须有凭有据
陈述结论时必须引用具体来源（文件路径+行号，或工具输出原文），直接引用原文作为证据；无证据须声明「我目前没有足够证据下结论」。

### 🚨 P0 子任务派遣规则：优先原生 `Task`
主 Agent 需要委托子 Agent / 研究型子任务时：
1. 优先直接使用原生 `Task`；
2. 让子任务自行加载 `preflight-lite` 与匹配的执行 skill；
3. 需要 explore / research / evidence gathering 时，优先 native Task，而非依赖旧 preamble 包装。
`dispatch_subagent` 仅保留为 legacy 兼容入口，不再是默认派遣方式。

### 🚨 合规门禁升级条件（按风险触发，非全任务前置）
仅下列任务默认升级到 `compliance_gate_check / confirm / complete`：
1. 高风险修改；2. 需要审批或正式交付物；3. 跨 Agent 协作链路；4. 调查/审计类需可追溯 deliverables。
低风险、局部、可快速验证的小任务，不应被 gate 前置阻断。

### 🚨 TDD 强制铁律（工程通用原则）
1. 测试先行：无测试用例，禁止编写业务代码；2. RED：测试先失败；3. GREEN：最简代码通过测试；4. REFACTOR：测试全量通过后再重构；5. 门禁：测试未 100% 通过，不进入审查。

### Skill 调用合规
每个 Agent 仅可调用自身配置中绑定的专属 Skill，禁止越权调用未授权 Skill。新 Skill 必须在 agent `.md` 的 `skills:` 字段显式列出才对该 agent 可用。

---

## 三、Agent 清单与职责（实际 5）

| Agent | 类型 | 模型 | 职责 |
| --- | --- | --- | --- |
| **Orchestrator** | 自定义（`mode: primary`，`prompt: .opencode/agents/Orchestrator.md`） | `deepseek/deepseek-v4-flash` | 专职调度、状态追踪、产物合并；持有 broad 权限集（含 `dispatch_subagent` / `compliance_gate_*` / 框架维护写入口） |
| **build** | native（平台内置，无 .md） | `deepseek/deepseek-v4-flash` | 构建 / 实现类任务 |
| **general** | native | `deepseek/deepseek-v4-flash` | 通用任务 |
| **plan** | native | `deepseek/deepseek-v4-flash` | 规划类任务 |
| **explore** | native | `deepseek/deepseek-v4-flash` | 调研 / 探索类任务 |

`default_agent` = `Orchestrator`。4 个 native agent 为平台内置，无独立 `.md` prompt。

---

## 四、插件执行链（active `plugin_execution_order`，project.config.json）

> ⚠️ 历史上的 `framework-enforcer.ts`（曾负责 Super-Admin 路由 / `ROUTE-MISMATCH` / `DISPATCH-POLICY-TAMPER`）**当前不存在**（全 `.opencode/*.ts` 无此文件，仅遗留描述字符串引用）。
> 当前约束由下列 **active handler** 在物理层强制执行；`before-dispatcher.ts` 即当前 active 的 `tool.execute.before` 调度器，其 `HANDLER_MAP` 与下方 `plugin_execution_order` 完全一致。

**before（串行，首个 throw 阻断后续；共 11）**：
`gate-call-context` → `guidance-bridge` → `task` → `permission-safety` → `behavioral-path-guard` → `scope` → `path-validate` → `codegraph` → `skill-policy` → `dispatch-signal` → `tool-governance`

**after（串行，错误捕获，fire-and-forget）**：
`gate-call-context` → `unified-audit` → `skill-audit` → `quality-contract` → `dispatch-trace` → `db-health` → `guidance-recovery`

**system（串行，directive 注入顺序）**：
`anti-bypass` → `skill-summary`

**约束职责映射**：
- 权限隔离 / 越权写阻断：`permission-safety` + `behavioral-path-guard` + `scope`
- 文件修改影响分析（CodeGraph 硬约束）：`codegraph`
- 规则处置（阻断 / 放行 / 硬阻断）：`rule-disposition.ts` 的 `getRuleDisposition` / `shouldBlock`
- 统一工具治理（Tool Governance MVC）：`tool-governance` handler → `service/tool-governance/**`（27/27 组件测试 PASS）。⚠️ **收缩未闭合**：`codegraph.ts` 仍先于治理域执行 repo-op / GitHub write 阻断；allow 日志与 live E2E 待补。
- 绕过防护：`anti-bypass`
- Skill 推荐注入：`skill-summary`（见第五节）

---

## 五、Skill 体系（实际 18 个）

- **自动发现**：`.opencode/skills/{name}/SKILL.md`，活跃列表由 `Orchestrator.md` 的 `skills:` 字段与 `rule_registry.json` 决定。
- **当前 18 个 skill**：
  `preflight-lite` · `context7-first` · `codegraph-first` · `opencode-mcp-integration` · `multi-agent-orchestration` · `dispatch-protocol` · `deliverable-contract` · `review-arbitration` · `brainstorming` · `investigation-evidence` · `ci-cd-guardrails` · `cross-directory-ci` · `cicd-database-seeding` · `sqlite-bloat-investigation` · `spreadsheet-processor` · `learning-mode-executor` · `customize-opencode` · `auto-commit`
- **skill-summary 注入逻辑**（`system/skill-summary.ts`）：每次 LLM 调用前，基于 `resolveAgent()` 的 agent 身份 + 最近用户消息关键词，注入 ≤8 个推荐 skill 到 system prompt。当前 `AGENT_SKILLS` 仅映射 `Orchestrator`（8 个已注册 skill）；其余 agent 走 `COMMON_SKILLS` + 关键词匹配（`KEYWORD_TRIGGERS`）。被清理的 9 个 blueprint agent 条目（Super-Admin / Coder-BE / Coder-FE / Guardian / Architect / Meta-Planner / Arbiter / CI-CD-Agent / Knowledge-Curator）已从该映射移除——这些 agent 未被注册，`resolveAgent()` 永不返回其名，原条目为不可达死配置。

---

## 六、Dispatch 与权限治理（实际）

### 子任务派遣
- 优先原生 `Task`；`dispatch_subagent` 仅 legacy 兼容。
- 派遣会话通过 `dispatch_privilege_grants` 绑定 grant（含 `allowed_tools` / `allowed_paths` / 写预算 / TTL）。

### 框架维护写操作（编辑 `.opencode/**` 框架文件）
受 `framework-maintenance` 流程治理，由 `safe_framework_edit` 工具在**内 agent runtime** 路径强制：
1. Orchestrator 以 `dispatch_privilege=framework_maintenance` 派发子会话 → 生成 grant（`dispatch_privilege_grants`）；
2. 子会话先跑 CodeGraph 影响分析；
3. 调 `framework_maintenance_plan` 声明计划路径（`framework_maintenance_plans` 的 `planned_paths` / `codegraph_targets`）；
4. 用 `safe_framework_edit` 在计划内编辑；
5. `framework_maintenance_complete` 关闭计划。

> 注意：该 grant/plan 控制**仅当 agent 在 serve 内调用 `safe_framework_edit` 时触发**。WorkBuddy 侧直接编辑 `.opencode` 文件不遍历该 runtime 路径，故不触发此钩子；此类直接编辑仍须以 CodeGraph impact + `bun build` 完成等价验证。

---

## 七、DB 与状态（实际）

- **单一数据源**：`framework-state.db`（v37），路径 `.opencode/state/framework-state.db`。禁止直连其他副本。
- **关键活跃表**：`dispatch_privilege_grants`（grant 生命周期）、`framework_maintenance_plans`（维护计划）、`session_registry` / `session_map` / `session_events`（会话 lineage）、`dispatch_queue` / `dispatch_attempts`（派遣）。
- **已废弃表（停止写入）**：`knowledge_*`、`audit_trail`、`session_log`、`permission_snapshot`、`tsc_gate_*`、`tool_guidance_state`、`agent_registry_snapshot`、`machine_*`、`template_resolution_snapshot`。

---

## 八、Serve API 交互（实际）

> 详细端点见 `serve-api` skill。

启动：`setsid bun run start-serve.ts` + `setsid bun run sse-daemon.ts`
会话：`POST /session`（agent 必填）→ `POST /session/{SID}/message`
- ⚠️ **`POST /session/{SID}/message` 必须带 `-H 'Content-Type: application/json'`**，否则返回 `Unsupported content-type: application/x-www-form-urlencoded` 且 body 不解析（sync，阻塞至 agent 完成）。
观察：`tail /tmp/sse-events.jsonl`
中断：`POST /session/{SID}/abort`

---

## 九、标准执行流程（轻路径优先）

> 适用范围：跨 Agent、需交付、需审批、需持续审计的复杂任务走治理路径；局部小任务走轻路径，不机械套完整流程。

0. **入口判定**：@Orchestrator 或主 Agent 先判断复杂度与风险。
   - 局部小任务 / 纯阅读 / 低风险修正 → 走 **轻路径**：`preflight-lite` + 匹配 skill + active hook。
   - 跨 Agent、多阶段、高风险、需交付或审批 → 升级 **治理路径**：`compliance_gate_check/confirm/complete` +（框架文件改动时）`framework-maintenance` 流程。
1. 轻路径：选 skill → 执行 → 必要验证 → 记录 evidence / TodoWrite / handover。
2. 治理路径：风险升级 → gate 闭环 →（如需框架写）grant→plan→`safe_framework_edit`→complete。
3. 熔断：连续 3 次未通过 → 终止当前任务流，降级重试 / 专家切换 / 人工待命（附完整失败上下文）。

---

## 十、已知设计蓝图（非运行态，仅供参考，保留于 `blueprints/`）

以下为历史架构设计，当前运行态**未实现**，仅作设计意图存档：
- 「三层九角色」10-agent 架构（Meta-Planner / Architect / Coder-BE / Coder-FE / Guardian / Arbiter / CI-CD-Agent / Super-Admin / Knowledge-Curator + Orchestrator）；
- `@Meta-Planner` 生成 `Task.DAG.json` 的全 DAG 治理链、`auto_plan` 自愈；
- `contract.yaml` keystone-hash 契约驱动开发、`TECH_DEBT_REGISTRY.md` 技术债追踪；
- `booking-backend` / `booking-frontend` demo 项目与 `HANDOVER.md` / `TASK_LOG.md` 工作记忆草稿纸约定；
- `framework-enforcer.ts` 物理层路由强制（文件已不存在）。

---

> **项目特定参考**：技术栈、项目结构、常用命令、架构速查等具体信息请参见 [PROJECT_REFERENCE.md](./PROJECT_REFERENCE.md)。
