# OpenCode 框架认知地图

> 生成日期: 2026-07-01 | 基于 work-one 项目当前代码状态（更新版）

---

## 第 1 层：系统全景

### 1.1 总体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Human / 用户                                 │
│                    (locked 模式下唯一入口)                            │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  元认知层 (Meta-Cognitive Layer)                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Orchestrator │  │ Meta-Planner │  │ Super-Admin  │              │
│  │  (默认Agent) │  │  (DAG规划)   │  │  (框架修复)  │              │
│  │  primary     │  │  subagent    │  │  all         │              │
│  └──────┬───────┘  └──────────────┘  └──────────────┘              │
│         │ dispatch_subagent                                         │
│         ▼                                                           │
│  编排执行层 (Execution Layer)                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  Architect   │  │  Coder-BE    │  │  Coder-FE    │              │
│  │  (架构设计)  │  │  (后端开发)  │  │  (前端开发)  │              │
│  │  subagent    │  │  subagent    │  │  subagent    │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│         │                                                           │
│         ▼                                                           │
│  验证运维层 (Verification & Ops Layer)                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  Guardian     │  │  Arbiter     │  │  CI-CD-Agent │              │
│  │  (质量门禁)  │  │  (冲突仲裁)  │  │  (部署运维)  │              │
│  │  subagent    │  │  subagent    │  │  subagent    │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                                                                     │
│  知识管理层                                                         │
│  ┌──────────────┐                                                   │
│  │ Knowledge-   │                                                   │
│  │ Curator      │  (UC7KS知识获取，唯一有web/Context7权限)          │
│  │ subagent     │                                                   │
│  └──────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ 29 Plugin│ │ 50+ Tool│ │ 50 Lib   │
        │ (钩子链) │ │ (安全包装)│ │ (核心逻辑)│
        └──────────┘ └──────────┘ └──────────┘
              │            │            │
              ▼            ▼            ▼
        ┌──────────────────────────────────────┐
        │     framework-state.db (SQLite WAL)  │
        │     单一数据源，11个schema版本        │
        │     + JSON 冻结快照                   │
        └──────────────────────────────────────┘
```

### 1.2 Plugin 全景（29个，按 Hook 分类）

| Plugin 文件 | before/after | 核心职责 |
|-------------|-------------|----------|
| `dispatch-before.ts` | before | PLAN-FIRST L1 路由验证 + M14 目标限制 + GATE-APPROVAL-LOCK |
| `dispatch-after.ts` | after | Task 完成后清理 `_dispatch_target.json`，排空过期条目 |
| `gate-before.ts` | before | 合规门禁 armed 检查 + DAG 任务审计 + 写入路由验证 |
| `gate-after.ts` | after | 合规门禁工具调用后，排空过期 gate session |
| `scope-before.ts` | before | 写入作用域强制（Agent→文件映射、UC7KS写入检查、配置读取认证） |
| `scope-after.ts` | after | 写入后更新 `eslint_state.dirty_modules` |
| `uc7ks-before.ts` | before | UC7KS 知识管线状态检查 |
| `codegraph-enforce.ts` | before+after | 修改代码前必须做过 CodeGraph impact 分析 |
| `tdd-before.ts` | before | TDD 强制：写实现前必须先写测试 |
| `tdd-after.ts` | after | 写后 diff 验证，检测浅测试绕过 |
| `audit-after.ts` | after | 写入审计追踪（滑动窗口 200 条） |
| `cache-after.ts` | after | 知识缓存同步（写入/读取 docs/official_docs/ 时更新状态） |
| `task-after.ts` | after | 任务结果记录 + gate 提醒 + 调度队列消费 |
| `json-validate.ts` | before | 关键 JSON 文件语法校验 + 执行模式下调保护 |
| `session.ts` | chat.message + session.* | 每轮启动清理（9步）+ 会话映射 + 配置重置 |

*注：上表列出 15 个核心 plugin 文件。其余 ~10 个文件为辅助/专项 plugin（如 format-after、tsc-diag-track 等写入时审计链），在 Guardian 的 Layer A 自动门禁中发挥作用。*

### 1.3 Tool 全景（50+ 个）

> **详细参考**: [opencode-tool-reference.md](./opencode-tool-reference.md) — 包含每个工具的参数、DB 访问、Hook 拦截、日志/备份集成、权限矩阵

**分类统计：**

| 类别 | 数量 | 来源 |
|------|------|------|
| OpenCode 内置工具 | 11 | 平台原生（read/edit/bash/glob/grep/task/question/todowrite/webfetch/websearch/skill） |
| 自定义工具 | 23 | `.opencode/tools/*.ts` |
| MCP 工具 | 25+ | 12 个 MCP Server（6 自定义 + 6 外部） |

**自定义工具（23 个）速览：**

| 子类 | 工具 | 核心机制 |
|------|------|----------|
| 安全包装 (8) | safe_edit/shell/delete/mkdir/restore/diff/hash/test | TOCTOU 保护 + 原子备份 + withInterruptGuard |
| 框架控制 (5) | dispatch_subagent, checklist_status, advance_checklist_phase, resolve_domain_id, config_read_attest | PLAN-FIRST 分发 + P0 清单 + 领域解析 + 配置认证 |
| UC7KS 知识 (5) | knowledge_cache_search/attest, knowledge_gap_report, module_scope_declare, janitor | 知识管线 + 缓存认证 + 维护清洁 |
| Read Attestation (3) | read_skill, skill_read_attest, rule_read_attest | Skill/Rule 读取认证 + 知识一致性验证 |
| 维护 (2) | nightly-compaction, tsc_gate_reset | 夜间压缩 + 紧急 TSC 锁重置 |

**MCP Server（11 个）速览：**

| Server | 工具数 | 权限归属 |
|--------|--------|---------|
| compliance-gate | 9 | 多 Agent（门禁状态机） |
| codegraph | 8 | 7 Agent（代码图谱） |
| docker | 11 | 仅 CI-CD-Agent |
| context7 | 2 | 仅 Knowledge-Curator |
| eslint-audit | 1 | Coder-BE/FE/Guardian |
| code-quality-check | 2 | Architect/Guardian/Super-Admin |
| playwright | ? | 仅 Coder-FE |
| github | ? | 保留（无 Agent 声明） |
| postgres | ? | 仅 Coder-BE |
| pandoc | ? | Architect/Coder-BE |
| excel | ? | 保留（无 Agent 声明） |

**修改工具集**（`isModifyTool()` 定义，所有写入 Hook 的拦截基础）：
`{ write, edit, safe_edit, safe_mkdir, safe_delete, safe_shell }`

### 1.4 Lib 模块依赖图（50个，核心路径）

```
                    ┌─────────────────┐
                    │  hook-lifecycle  │ ← 所有 plugin 的 HOF 包装器
                    │  (withPlugin-   │
                    │   Lifecycle)    │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌──────────────┐ ┌───────────┐ ┌──────────────┐
     │interrupt-    │ │log-       │ │state-utils   │
     │guard         │ │manager    │ │(原子写入等)  │
     │(withInterrupt│ │(日志中央) │ │              │
     │Guard)        │ │           │ │              │
     └──────┬───────┘ └─────┬─────┘ └──────┬───────┘
            │               │              │
            ▼               ▼              ▼
     ┌──────────────────────────────────────────────┐
     │              db-manager.ts                    │
     │  SQLite 单例，WAL 模式，11 版本 schema       │
     │  PRAGMA: synchronous=NORMAL, cache_size=4MB  │
     └──────────────────┬───────────────────────────┘
                        │
              ┌─────────┼─────────┐
              ▼         ▼         ▼
     ┌────────────┐ ┌────────┐ ┌────────────────┐
     │db-state-   │ │substate│ │substate-types  │
     │manager     │ │-manager│ │(15种状态类型)  │
     │(CRUD操作)  │ │(DB代理)│ │                │
     └─────┬──────┘ └────────┘ └────────────────┘
           │
     ┌─────┼─────────────────────┐
     ▼     ▼                     ▼
┌────────┐ ┌──────────┐  ┌──────────────┐
│gate-   │ │gate-     │  │gate-stale    │
│core    │ │checks    │  │(阈值配置)   │
│(状态机)│ │(检查函数)│  │              │
└────────┘ └──────────┘  └──────────────┘
     │
     ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│dag-policy    │  │route-        │  │tool-scope    │
│(PLAN-FIRST)  │  │validator     │  │(路径解析)    │
│              │  │(L0-L4路由)   │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
```

### 1.5 数据库表结构（framework-state.db）

| 表名 | 用途 | 关键列 |
|------|------|--------|
| `schema_version` | 迁移版本 | version |
| `substate_kv` | 15种子状态的通用 KV 存储 | key, json, updated_at |
| `machine_meta` | machine.json 元数据 KV | key, value |
| `machine_contracts` | 合约文件路径 | file_path |
| `gate_sessions` | 活跃门禁会话（29+列） | session_id, status, version, agent, task_id... |
| `gate_drained_sessions` | 已排空的归档会话 | 同 gate_sessions |
| `gate_session_index` | 轻量状态索引 | session_id, status |
| `gate_store_meta` | 全局元信息 | formatVersion, active_sessions |
| `gate_audit_history` | 门禁审计日志（历史膨胀源） | session_id, event, confirmed_at |
| `audit_log` | 通用审计日志 | session_id, agent, event_type |
| `audit_trail` | 会话级审计追踪 | session_id, data |
| `file_baseline_kv` | 跨进程 TOCTOU 检测 | path_hash, inode, size, mtime... |
| `session_log` | 任务分发完成记录 | session_id, agent, status |
| `dispatch_failed_log` | 失败分发死信归档 | session_id, agent, error |
| `session_map` | 会话→Agent/DAG/领域映射 | session_id, agent, dag_task_id, domain_id |
| `read_audit` | 读-审批认证记录 | sha256 去重键 + 4 索引 |
| `knowledge_*` (7表) | UC7KS 知识条目/文件/标签/访问/发现/认证/物化 | 规范化知识管理 |

---

## 第 2 层：Agent 职责边界

### 2.1 职责矩阵

| Agent | 能做什么 | 不能做什么 | 越界时路由到 |
|-------|---------|-----------|-------------|
| **Orchestrator** | 任务调度、状态控制、结果合并、全流程协调；分发所有其他 Agent | 写业务代码、分析需求、修改 Task.DAG.json、合并 TDD 步骤 | 需求分析→Meta-Planner；框架修复→Super-Admin |
| **Super-Admin** | 框架紧急修复、治理规则修改、状态机手术、Agent 生命周期管理、基础设施重配 | 修改业务代码（booking_system_refactor/src/）、绕过审计日志 | 人工介入（locked 模式） |
| **Meta-Planner** | 需求分解、DAG 规划、Project.graph 生成、技术债扫描 | 代码实现、代码审查、部署 | — |
| **Architect** | 技术选型、接口合约（contract.yaml）、目录结构、架构规范 | 生成业务逻辑代码、单方面修改 contract.yaml（需 Arbiter 批准） | 框架文件修改→Super-Admin |
| **Coder-BE** | 后端 API、业务逻辑、数据库迁移、Prisma seed | 修改 contract.yaml、前端代码、部署配置 | 框架问题→Super-Admin |
| **Coder-FE** | 前端页面、组件、交互、状态管理 | 修改 contract.yaml、后端代码、数据库 | 框架问题→Super-Admin |
| **Guardian** | 静态代码扫描、安全漏洞扫描、架构约束检查、测试证据验证 | 修改任何代码、做主观风格评论 | — |
| **Arbiter** | 代码审查冲突仲裁、技术债豁免审批（WAIVE.md）、强制发布（OVERRIDE.md） | 修改代码、参与开发/测试/部署 | — |
| **CI-CD-Agent** | CI 管线运维、自动部署、生产自愈、Git 版本管理 | 业务代码逻辑设计、产品决策 | — |
| **Knowledge-Curator** | 知识获取/缓存/组织（UC7KS 管线）、唯一有 Context7/web 权限 | 修改业务代码、框架文件、未经确认查询外部源 | — |

### 2.2 权限速查

所有 Agent 的共同约束：
- `edit: deny` + `bash: deny` — 禁止原生文件编辑和 Shell
- 必须通过 `safe_edit` / `safe_shell` 等安全包装工具
- 只有 Super-Admin 的 mode 是 `all`（可 primary 可 subagent）
- Orchestrator 是唯一 primary Agent（默认入口）

### 2.3 分发层级

```
Human
  │
  ▼
Orchestrator (默认)
  ├── Meta-Planner (需求分解 → DAG)
  ├── Architect (架构设计 → contract.yaml)
  ├── Coder-BE (后端实现)
  ├── Coder-FE (前端实现)
  ├── Guardian (质量审查)
  ├── Arbiter (冲突仲裁)
  ├── CI-CD-Agent (部署运维)
  ├── Super-Admin* (框架修复，需 repair-pattern 匹配)
  └── Knowledge-Curator (知识获取)

Super-Admin → Knowledge-Curator (仅限 UC7KS 知识模式)
```

### 2.4 DAG 豁免 Agent

以下 Agent 分发时不需要 DAG 条目：
`@Meta-Planner`、`@Orchestrator`、`@Super-Admin`、`@Knowledge-Curator`

其余 Agent（Architect、Coder-BE、Coder-FE、Guardian、Arbiter、CI-CD-Agent）必须先有 `Task.DAG.json` 条目。

---

## 第 3 层：关键执行流

### 3.1 一次 safe_edit 的完整调用链

```
Agent 调用 safe_edit(filePath, oldString, newString)
  │
  ├─[1] withInterruptGuard 包裹
  │     └─ 检测 SIGINT/AbortError → 返回结构化 JSON 而非抛异常
  │
  ├─[2] 读取文件内容
  │     └─ 验证 oldString 恰好出现一次（TOCTOU 保护）
  │
  ├─[3] 替换 → 生成 newContent
  │
  ├─[4] 调用 safeEdit(absPath, newContent)
  │     ├─ 写入原子备份到 .opencode_backups/
  │     └─ 写入文件（首次调用建立 baseline，后续调用验证）
  │
  ╠═══════════════════════════════════════════════════════
  ║  同时，Plugin Hook 链在 tool.execute.before/after 触发
  ╠═══════════════════════════════════════════════════════
  │
  ├─[BEFORE HOOKS] (tool.execute.before，按注册顺序)
  │   │
  │   ├─ session.ts (chat.message)
  │   │   └─ 9步启动清理：排空过期 gate/dispatch/ctx → 配置重置 → 会话映射
  │   │
  │   ├─ dispatch-before.ts ← 仅当 tool=dispatch_subagent 时触发
  │   │   └─ (safe_edit 不触发此 plugin)
  │   │
  │   ├─ gate-before.ts
  │   │   ├─ 检查是否有 armed 的 gate session（advisory 模式跳过）
  │   │   ├─ P2-1 DAG 任务审计：验证 taskId 在 Task.DAG.json 中存在
  │   │   └─ 写入路由验证
  │   │
  │   ├─ scope-before.ts ★ 核心写入检查
  │   │   ├─ P0-3 ROUTE-MISMATCH: Agent→文件作用域映射
  │   │   ├─ P1-2 UC7-008: Knowledge-Curator 隔离
  │   │   ├─ P0-5: isWriteAllowed() 检查 opencode.json 权限
  │   │   ├─ R4: 配置读取认证（strict/locked 模式）
  │   │   ├─ P1-1 UC7-001: 知识缓存搜索前置
  │   │   ├─ P1-4 UC7-005: 知识缓存文件大小上限 (500KB)
  │   │   └─ BACKUP-BYPASS: 阻止 safe_shell 修改文件
  │   │
  │   ├─ uc7ks-before.ts
  │   │   └─ checkUC7KS(): 知识管线状态门控
  │   │
  │   ├─ codegraph-enforce.ts
  │   │   ├─ 检查本 session 是否调用过 codegraph_impact
  │   │   ├─ 豁免: Super-Admin, .task_temp/, docs/, agents/*.md
  │   │   └─ 未做 impact 分析 → 抛异常，要求先运行 codegraph_search + codegraph_impact
  │   │
  │   ├─ tdd-before.ts
  │   │   ├─ 仅对 Coder-BE/Coder-FE 生效
  │   │   ├─ 检查 tdd_enforcement_state.test_written
  │   │   └─ 未写测试 → strict/locked 模式抛异常
  │   │
  │   └─ json-validate.ts
  │       └─ 仅当目标是关键 JSON 文件时触发
  │
  ├─[5] 文件写入成功
  │
  ├─[AFTER HOOKS] (tool.execute.after，按注册顺序)
  │   │
  │   ├─ dispatch-after.ts ← safe_edit 不触发
  │   │
  │   ├─ gate-after.ts ← 仅合规门禁工具触发
  │   │
  │   ├─ scope-after.ts
  │   │   └─ 更新 eslint_state.dirty_modules
  │   │
  │   ├─ audit-after.ts
  │   │   └─ 追加 write_audit_state（文件、工具、Agent、sessionID、时间戳）
  │   │
  │   ├─ tdd-after.ts
  │   │   ├─ 读取 .opencode_backups/ 最新备份
  │   │   ├─ 生成 diff（备份 vs 当前）
  │   │   ├─ 测试文件: 有实际变更 → test_written=true
  │   │   └─ 实现文件: 记录 diff 证据，检测浅测试绕过
  │   │
  │   ├─ cache-after.ts ← 仅当写入 docs/official_docs/ 时触发
  │   │
  │   ├─ codegraph-enforce.ts (after)
  │   │   └─ 追踪 codegraph_impact 调用，记录目标符号
  │   │
  │   └─ task-after.ts ← 仅 Task 工具触发
  │
  └─[6] 返回备份路径给 Agent
```

### 3.2 dispatch_subagent 的完整调用链

```
Orchestrator 调用 dispatch_subagent(agent_type, task_description, dag_task_id)
  │
  ├─[BEFORE: dispatch-before.ts] ★ PLAN-FIRST 三层路由
  │   │
  │   ├─ Guard: 仅当 tool=dispatch_subagent 时触发
  │   │
  │   ├─ M14 目标限制:
  │   │   └─ 非特权 Agent 只能分发到 @Knowledge-Curator
  │   │
  │   ├─ L0-L4 路由验证链:
  │   │   ├─ L0: 目的推断 (inferDispatchPurpose + l0_purposeFilter)
  │   │   ├─ L1: 动词匹配 (l1_verbCandidates)
  │   │   ├─ L2: 作用域过滤 (l2_scopeFilter，用 DAG target_files)
  │   │   ├─ L3: 权限否决 (l3_permissionFilter，用 pathMatchesGlob)
  │   │   └─ L4: 启发式选择 (l4_heuristicSelect，权重 scope 35% + perm 40% + domain 25%)
  │   │
  │   ├─ DAG-authoritative 覆盖: 如果 dag_task_id 存在且匹配 → 关键字路由变为建议
  │   │
  │   ├─ GATE-APPROVAL-LOCK-v2:
  │   │   └─ 查询 gate_sessions 表，阻止未审批的关联会话
  │   │
  │   └─ PLAN-FIRST DAG 验证:
  │       ├─ policy.require_dag_entry=true 时验证 dag_task_id 存在
  │       └─ 支持 auto_plan 自愈（自动分发 @Meta-Planner）
  │
  ├─[TOOL BODY: dispatch_subagent.ts]
  │   │
  │   ├─ UC7KS 分发绕过检查
  │   │
  │   ├─ PLAN-FIRST L2: DAG 存在性验证
  │   │   ├─ 非豁免目标必须在 Task.DAG.json 中有条目
  │   │   └─ auto_plan: 递归分发 @Meta-Planner (execFileSync)
  │   │
  │   ├─ 安全门控:
  │   │   ├─ 只有 Orchestrator 可分发通用 Agent
  │   │   ├─ Super-Admin 只能分发 Knowledge-Curator
  │   │   └─ locked 模式: Super-Admin 目标需人工调用
  │   │
  │   ├─ 执行分发脚本 (execFileSync bun dispatch-subagent.ts)
  │   │
  │   ├─ 写入 ctx/{dagTaskId}.json（pipeline_id, agentType, domainId...）
  │   │
  │   └─ 写入 session_map DB + 创建 dispatch:child:{dagTaskId} 槽位
  │
  ├─[AFTER: dispatch-after.ts]
  │   ├─ 删除 _dispatch_target.json
  │   ├─ 排空 >30min 的 .pending.json 条目
  │   └─ 检查 >2h 的 delivered 状态 gate session
  │
  └─ 返回包装后的 prompt 给 Agent
```

### 3.3 合规门禁状态机

```
         check()              confirm()            submit_deliverables()
  ┌──────────┐         ┌──────────┐         ┌──────────────┐
  │ (none)   │───────▶│  armed   │───────▶│  delivered   │
  └──────────┘         └──────────┘         └──────┬───────┘
       ▲                                           │
       │                                    approve_deliverables()
       │                                           │
       │                                           ▼
       │          complete()                 ┌──────────┐
       └────────────────────────────────────│ approved │
                                           └──────┬───┘
                                                  │
                                                  ▼
                                           ┌──────────┐
                                           │completed │
                                           └──────────┘

  任何阶段均可因超时/错误进入 → failed / drained
```

**三种执行模式：**
- `advisory`: 检查但仅记录警告，不阻断
- `strict`: 检查并阻断违规操作
- `locked`: 最严格，Super-Admin 也需人工调用

### 3.4 Pre-commit Hook 9 层验证链

```
git commit 触发
  │
  ├─ Layer 0:   合规门禁 armed 检查（DB 读取）
  ├─ Layer 1.5: 关键基础设施文件检测（locked 模式阻断）
  ├─ Layer 1.8: Gate 生命周期审计（>24h 过期会话）
  ├─ Layer 1.9: 状态格式验证（DB + 冻结快照一致性）
  ├─ Layer 1:   lint-staged 自动格式化
  ├─ Layer 2.5: TDD 顺序预检查（[Red]→[Green]→[Refactor]）
  ├─ Layer 2.6: UC7KS 文档一致性（index.json 清单）
  ├─ Layer 2:   JSON 语法验证（tolerantParse）
  └─ Layer 2:   Keystone 哈希验证（contract.yaml 完整性）
```

### 3.5 状态管理三层架构

```
热层 (Hot)                    温层 (Warm)                冷层 (Cold)
┌─────────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ framework-state.db  │     │ JSONL 事务日志    │     │ 归档 JSON        │
│ (SQLite WAL)        │     │ gate-state.      │     │ gate-state.      │
│                     │     │ history/          │     │ archive.json     │
│ substate_kv 表      │     │                  │     │                  │
│ (15种子状态)        │     │ session_log      │     │ Task.DAG.versions│
│                     │     │ dispatch_failed  │     │ /Task.DAG.v*.json│
│ gate_sessions 表    │     │                  │     │                  │
│ 29+ 列，乐观锁     │     │ audit_log        │     │ Task.DAG.        │
│                     │     │                  │     │ changelog.md     │
│ 单一数据源          │     │                  │     │                  │
└─────────────────────┘     └──────────────────┘     └──────────────────┘
        │
        ▼
  JSON 冻结快照（只读参考，非数据源）
  machine.json, gate-state.json, eslint-state.json...
```

---

## 第 4 层：排错手册

### 4.1 框架膨胀（framework-state.db > 1GB）

**症状：** DB 文件异常增大，磁盘 I/O 饱和

**根因：** `gate_audit_history` 表 O(n²) 回环 — `dbLoadGateStore()` 全表 SELECT → `dbSaveGateStore()` 无去重全量 INSERT

**定位：**
```bash
# 用 bun:sqlite 查询表大小（sqlite3 CLI 未安装）
wsl -d Ubuntu-24.04 bash -c 'cd /home/zhaoge/workspace/opencode/work-one && bun -e "
const db = new (require(\"bun:sqlite\"))(\".opencode/state/framework-state.db\");
console.log(db.query(\"SELECT name, page_count * page_size as size FROM pragma_page_count(), pragma_page_size()\").get());
"'
```

**修复：** 三处同时改 — 读端（禁止全表恢复）、写端（只追加增量）、清理端（激活 compactor + 修正列名 `confirmed_at` vs `timestamp`）

### 4.2 Plugin 变更不生效

**症状：** 修改了 plugin .ts 文件但行为没变

**根因：** Bun 缓存不可靠

**修复：**
```bash
# 100% 可靠方法
rm -rf ~/.cache/bun
# 或者重命名文件（触发 Bun 重新编译）
```

### 4.3 双 Hook 触发（重复执行）

**症状：** 某个 hook 逻辑被执行两次

**根因：** 两个 plugin 注册了相同 hook ID

**修复：** 合并为单一 plugin（P0 规则：一个 hook 只允许一个 plugin 入口）

### 4.4 Agent 分发被阻断

**症状：** dispatch_subagent 抛 ROUTE-MISMATCH 或 GATE-APPROVAL-LOCK

**排查步骤：**
1. 检查 `Task.DAG.json` 中是否有对应 `dag_task_id`
2. 检查 `gate_sessions` 表是否有未审批的关联会话
3. 检查 Agent 是否有目标文件的写入权限（`opencode.json` → `permission.safe_edit`）
4. 检查执行模式（`project.config.json` → `develop_enforcement_mode` / `runtime_enforcement_mode`）

### 4.5 TDD 阻断（"write a test first"）

**症状：** Coder-BE/FE 写实现代码时被阻断

**根因：** `tdd-before.ts` 检查 `tdd_enforcement_state.test_written` 为 false

**修复：** 先写 `.spec.ts` / `.test.ts` 文件，确保有实际变更（非空测试）

### 4.6 CodeGraph 阻断（"run impact analysis first"）

**症状：** safe_edit 被 codegraph-enforce.ts 阻断

**修复：** 先调用 `codegraph_search` + `codegraph_impact`，再执行 safe_edit

**豁免路径：** `.task_temp/`、`docs/`、`.opencode/agents/*.md`、Super-Admin Agent

### 4.7 写入作用域阻断（ROUTE-MISMATCH）

**症状：** Agent 尝试写入文件被 scope-before.ts 阻断

**排查：**
1. 检查 Agent 的 `allowed_file_scope`（agent .md 文件）
2. 检查 `opencode.json` 中 `permission.safe_edit` 的 glob 模式
3. 检查 `config_read_state` 认证是否过期（每轮重置）

### 4.8 Bun 缓存 / PATH 括号问题

**症状：** WSL 中 bun 命令执行失败

**根因：** PATH 中含括号导致 `bash -c` 转义失败

**修复：** 将脚本复制到 `/tmp` 再执行，或用 `cp` 脚本到 `/tmp` 规避

---

## 附录 A：关键文件位置速查

| 文件/目录 | 路径 | 用途 |
|-----------|------|------|
| 框架配置 | `.opencode/project.config.json` | 执行模式、分发策略、阈值配置 |
| OpenCode 配置 | `opencode.json` | Agent 注册、Plugin 注册、权限矩阵、MCP 服务器 |
| Agent 定义 | `.opencode/agents/*.md` | 10 个 Agent 的 prompt、权限、技能声明 |
| Plugin 源码 | `.opencode/plugins/*.ts` + `plugin-handlers/` | 29 个 plugin handler（before 15 + after 14） |
| Tool 源码 | `.opencode/tools/*.ts` | 23 个自定义工具（+ 12 MCP Server 提供 25+ MCP 工具） |
| Lib 模块 | `.opencode/lib/*.ts` | 50 个核心逻辑模块 |
| Hook 脚本 | `.opencode/hooks/lib/*.ts` | Pre-commit hook 的 9 层验证链 |
| 数据库 | `.opencode/state/framework-state.db` | SQLite 单一数据源 |
| DAG 文件 | `Task.DAG.json` | 任务依赖图 |
| 任务工作目录 | `.task_temp/{taskId}/` | HANDOVER.md、TASK_LOG.md 等 |
| 日志 | `.task_temp/_logs/` | 框架运行日志 |
| 备份 | `.opencode_backups/` | 文件编辑的原子备份 |
| 业务代码 | `booking_system_refactor/` | NestJS 后端 + Angular 前端 |

## 附录 B：执行模式对照表

| 检查项 | advisory | strict | locked |
|--------|----------|--------|--------|
| 路由不匹配 | 警告 | 阻断 | 阻断 |
| Gate 未 armed | 警告 | 阻断 | 阻断 |
| DAG 缺失 | 警告 | 阻断 | 阻断 |
| 配置未读取 | 警告 | 阻断 | 阻断 |
| TDD 未写测试 | 警告 | 阻断 | 阻断 |
| CodeGraph 未分析 | 警告 | 阻断 | 阻断 |
| Super-Admin 分发 | 允许 | repair-pattern 匹配 | 仅人工 |
| 模式下调 | — | 允许升级 | 不允许降级 |

---

## 附录 C：完整 Plugin 清单（29 文件）

| # | Plugin 文件 | Hook | 核心职责 |
|---|-------------|------|----------|
| 1 | `session.ts` | chat.message + session.* | 9步启动清理 + 会话映射 + 配置重置 |
| 2 | `dispatch-before.ts` | tool.execute.before | PLAN-FIRST L1 路由 + M14 限制 + GATE-APPROVAL-LOCK |
| 3 | `dispatch-after.ts` | tool.execute.after | Task 完成清理 + 过期排空 |
| 4 | `gate-before.ts` | tool.execute.before | 合规门禁 armed + DAG 审计 |
| 5 | `gate-after.ts` | tool.execute.after | Gate session 排空 |
| 6 | `scope-before.ts` | tool.execute.before | 写入作用域（路由/UC7KS/配置认证） |
| 7 | `scope-after.ts` | tool.execute.after | eslint_state.dirty_modules 更新 |
| 8 | `uc7ks-before.ts` | tool.execute.before | UC7KS 知识管线门控 |
| 9 | `codegraph-enforce.ts` | before + after | CodeGraph impact 分析强制 |
| 10 | `tdd-before.ts` | tool.execute.before | TDD 先写测试强制 |
| 11 | `tdd-after.ts` | tool.execute.after | Diff 验证 + 浅测试检测 |
| 12 | `audit-after.ts` | tool.execute.after | 写入审计追踪（200条滑动窗口） |
| 13 | `audit-before.ts` | tool.execute.before | 写入前审计 |
| 14 | `cache-after.ts` | tool.execute.after | 知识缓存同步 |
| 15 | `task-after.ts` | tool.execute.after + compaction | 任务结果 + gate 提醒 + 队列消费 |
| 16 | `json-validate.ts` | tool.execute.before | JSON 语法 + 模式下调保护 |
| 17 | `hook-config-guard.ts` | — | Hook 配置完整性守卫（**新增**） |
| 18-26 | 其他辅助 plugin | 各种 | format-after, tsc-diag-track 等写入审计链 |

## 附录 D：完整 Lib 模块清单（~60 文件）

**核心模块（50个，已在认知地图中描述）：**
hook-lifecycle, interrupt-guard, log-manager, log-rotator, db-manager, db-state-manager, db-maintenance, state-manager, state-utils, state-cache, state-compactor, substate-manager, substate-types, gate-core, gate-checks, gate-stale, dag-policy, dag-version-manager, deliverables-templates, agent-identity, agent-resolver, route-validator, tool-scope, permission-reader, permission-isolation-core, safe-edit-core, safe-bash-core, safe-test-core, uc7ks-utils, uc7ks-schema, uc7ks-pipeline-db, knowledge-audit, knowledge-store, audit-log, write-audit-lib, read-audit, backup-manager, critical-files, tolerant-json, dispatch-db, shared-infra, index.ts

**新增模块（~11个）：**
- `tsc-gate-db.ts` — TSC 诊断门禁 DB 操作
- `tsc-gate-config.ts` — TSC 门禁配置
- `baseline-diagnostic.ts` — 诊断基线管理
- `tsc-diagnostic.ts` — TSC 诊断追踪
- `approval-read-context.ts` — 审批读取上下文
- `__tests__/` — 14 个测试文件 + 3 个 fixture .d.ts

## 附录 E：Skill 清单（19 目录，Phase 0 基线修正）

**16 个活跃 Skill：**
execution-preflight-check, context7-first, codegraph-first, brainstorming, new-asset-integrator, customize-opencode, devops-ci-cd-guardrails, fullstack-ci-cd-guardrails, global-cicd-practices-enforcement, cross-directory-ci, spreadsheet-processor, cicd-database-seeding, 及其他

**5 个已废弃（仅 DEPRECATED.md）：**
（具体名称需查阅 .opencode/skills/ 目录）

## 附录 F：Rules 清单（20 文件）

**7 个顶层规则文件 + 13 个 rule_detail/ 子规则**

规则定义了 Agent 的行为约束、代码标准、架构规范等。

## 附录 G：当前运行状态快照（2026-06-28）

### 执行模式与策略
```json
{
  "enforcement_mode": "strict",
  "dispatch_policy": {
    "require_dag_entry": true,
    "auto_plan_enabled": true,
    "auto_plan_max_per_session": 5,
    "auto_plan_timeout_ms": 120000
  },
  "gate_stale_thresholds": {
    "armed_hours": 24,
    "checked_hours": 48,
    "delivered_hours": 4,
    "approved_hours": 4
  }
}
```

### Task.DAG.json 状态
```
总任务数: 77
├─ completed: 48
├─ pending:   25
└─ skipped:    4

最近新增任务组:
├─ E2E TSC 诊断门禁 (11 tasks)
├─ 路由/分发/Shell/清单 E2E (4 tasks)
├─ 报告工具 (1 task)
├─ 技术债 (2 tasks)
└─ Caller ID 阶段 (7 tasks, PHASE-0 ~ PHASE-6)
```

### 技术栈（booking_system_refactor/）
```
后端: NestJS 11 + Prisma 6.16 + PostgreSQL + Redis + BullMQ
前端: Angular 21.2 + NgRx Signals + PrimeNG + Tailwind CSS v4
E2E:  Playwright
```

### 设计文档（framework-refactor/）
100+ 设计文档，近期新增（2026-06-27）：
- diagnostic-state-sync-gap-analysis-and-fix.md
- orchestrator-caller-identity-fallback-audit-and-fix-plan.md
- orchestrator-dispatch-empty-result-enforcement-plan.md
- gate-approval-deadlock-and-lock-serialization-root-cause.md
- dispatch-shell-checklist-gaps-fix-plan.md
- lsp-diagnostic-gate-implementation-plan.md
- tsc-diagnostic-gate-v2-implementation-plan.md

### .task_temp/ 累积
1,033 个任务目录，大量历史任务残留。

### 根目录标记文件
7 个中文哨兵文件（分支、基础提交、工作区、队列残留等）+ 2 个空标记（AUTO-DISPATCH-AGENT-MISMATCH, DISPATCH_TASKID_TAMPER）。
