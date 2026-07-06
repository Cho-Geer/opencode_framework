# OpenCode 框架 Session 概念完整体系

**版本**: v1.1.0  
**创建日期**: 2026-06-28  
**更新日期**: 2026-07-01  
**状态**: 完整调查报告 
**数据库**: `.opencode/state/framework-state.db`（Bun SQLite，WAL 模式）  
**参考**: [session-task-dag-agent-tracking.md](./session-task-dag-agent-tracking.md)（更详细的追踪架构）

---

## §1 概念辨析 — 五种不同的 ID

框架同时管理五种语义不同的 ID。混淆它们是大量 P0 级 Bug 的根本原因。

| # | 概念 | ID 格式 | 生成者 | 规范持久化位置 |
|---|------|---------|--------|---------------|
| 1 | **OpenCode Session ID** | `ses_*`（不透明字符串） | OpenCode 上游框架 | `session_map` DB 表 |
| 2 | **合规门 Session ID** | `cg_ses_{timestamp}` | `store.ts:generateGateSessionId()` | `gate_sessions` DB 表 |
| 3 | **DAG Task ID** | 字符串（如 `T-099`） | `Task.DAG.json`（@Meta-Planner 分配） | `Task.DAG.json` + `session_map.dag_task_id` |
| 4 | **Agent 身份** | `@AgentName` | `session_map` DB 或 `FRAMEWORK_AGENT` 环境变量 | `session_map.agent` |
| 5 | **Session Namespace** | 字符串，通常等于 dag_task_id | `dispatch_subagent` 参数 | `.task_temp/{namespace}/` 目录 |

---

## §2 OpenCode Session（上游框架会话）

### 2.1 基本概念

| 维度 | 详情 |
|------|------|
| **ID 格式** | `ses_*`（不透明字符串，如 `ses_1781234567890`） |
| **生成者** | **OpenCode 上游框架自身**，非本框架代码生成 |
| **用途** | 一次 AI 对话的完整生命周期 |
| **获取方式** | `context.sessionID`（工具执行函数中）/ `input.sessionID`（插件钩子中） |

### 2.2 唯一性：一个对话只有一个 OpenCode Session

**结论：每个对话（Conversation）只有一个唯一的 `ses_*` ID。该对话内的所有轮次（rounds）共享此 ID。**

**证据 1 — OpenCode Session 数据结构**（源码 `internal/session/session.go`）：
```go
type Session struct {
    ID               string       // 唯一标识，格式 ses_*
    ParentSessionID  string       // 父会话ID（子Agent场景下非空）
    Title            string
    MessageCount     int64        // 该会话内的消息计数
    ...
}
```
- `ID` 是一个 session 的唯一标识
- `MessageCount` 字段记录该 session 内**所有轮次的消息总数**，证明多轮对话都累积在同一个 session 中

**证据 2 — OpenCode 官方文档表述**：
> "我们每次跟 AI 开启的一个新的对话，就是一个全新的 session"

用户用 `/new` 命令才会创建新 session，否则所有对话轮次都在同一个 session 中进行。

**证据 3 — CLI 行为**：`opencode session list` 列出的每个 session 都有唯一 `ses_*` ID。`opencode --continue` 或 `opencode -s ses_xxx` 恢复的是同一个 session 的后续轮次。

### 2.3 子 Agent 派发：每层都产生新的 OpenCode Session

**结论：每一层子 Agent 派发都会创建一个全新的 OpenCode Session（新的 `ses_*` ID）。父 Session ID 通过 `ParentSessionID` 字段关联。**

**证据 1 — OpenCode serve 模式实际运行日志**（来源：[GitHub Issue #6573](https://github.com/anomalyco/opencode/issues/6573)）：
```
INFO service=session.prompt step=0 sessionID=ses_parent123 loop
INFO service=session.prompt step=0 sessionID=ses_subagent456 loop     ← 子Agent 获得新的 ses_* ID
INFO service=llm sessionID=ses_subagent456 agent=explore stream
```
父 session 是 `ses_parent123`，子 Agent 获得的是**全新的** `ses_subagent456`。

**证据 2 — `ParentSessionID` 字段的存在**：
> "OpenCode 采用父子会话结构，通过 `ParentSessionID` 实现会话间的关联与隔离"

每个子 session 有独立的 `ID`，同时通过 `ParentSessionID` 关联父 session。

**证据 3 — 中文技术社区分析**：
> "子智能体（Sub-Agent），可以将其理解为在主 Agent 任务下，**临时创建的新 Agent 会话**"

**证据 4 — 本框架内部文档印证**（[session-task-dag-agent-tracking.md](./session-task-dag-agent-tracking.md) §2.1）：
> "每次 `dispatch_subagent` → `Task()` 调用都会创建**新**的 OpenCode 会话。会话默认不重用。"

### 2.4 会话层级示例

```
用户开启对话
  └─ OpenCode Session: ses_A        ← 第1个独立的 OpenCode session
       ├─ 第1轮对话                  ← 都在 ses_A 中
       ├─ 第2轮对话                  ← 都在 ses_A 中
       │
       ├─ 主Agent 派发子Agent
       │    └─ OpenCode Session: ses_B   ← 第2个独立的 OpenCode session（新 ses_* ID）
       │         ├─ 子Agent 执行任务
       │         │
       │         └─ 子Agent 派发子子Agent
       │              └─ OpenCode Session: ses_C  ← 第3个独立的 OpenCode session（新 ses_* ID）
       │
       └─ 第3轮对话（回到主Agent）    ← 仍在 ses_A 中
```

### 2.5 存储

存储于 **`session_map` DB 表**（`framework-state.db`）：
```sql
CREATE TABLE session_map (
    session_id   TEXT PRIMARY KEY,     -- OpenCode ses_* ID
    agent        TEXT NOT NULL,        -- "@AgentName" 或 "pending"
    dag_task_id  TEXT DEFAULT NULL,    -- DAG task ID
    domain_id    TEXT DEFAULT NULL,    -- 知识领域 ID
    model_id     TEXT DEFAULT NULL,    -- LLM 模型 ID
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
```

**写入者**：
| 写入者 | 写入内容 | 位置 |
|--------|---------|------|
| `session.ts` `chatMessageHook` | `agent` | 每次对话轮次触发 |
| `dispatch_subagent.ts` 工具 | `dag_task_id`、`domain_id` | 派发子Agent时 |
| `dispatch_subagent.ts` 工具（子槽位） | `dispatch:child:{dagTaskId}` 合成行 | 派发子Agent时 |
| `module_scope_declare.ts` | 更新 `domain_id` | 模块范围声明时 |

### 2.6 传递方式

| 机制 | 格式 | 写入者 | 读取者 |
|------|------|--------|--------|
| `session_map` DB | `(session_id, agent, dag_task_id, domain_id)` | `dispatch_subagent.ts` + `session.ts` | `agent-resolver.ts`、所有插件 |
| 子槽位 | `dispatch:child:{dagTaskId}` | `dispatch_subagent.ts` | `agent-resolver.ts` 优先级 1.5 |
| `ctx/{dagTaskId}.json` | 每次派发的上下文文件 | `dispatch_subagent.ts` | `agent-resolver.ts` 优先级 2 |
| `session_log` DB | `(sub_session_id, dag_task_id, agent_type)` | `task-after.ts` | 通过 `resume_session_id` 恢复 |
| `FRAMEWORK_AGENT` 环境变量 | 子进程环境变量 | `dispatch-subagent.ts` CLI | 子 Agent 进程（回退方案） |

---

## §3 合规门 Session（Gate Session）

### 3.1 基本概念

| 维度 | 详情 |
|------|------|
| **ID 格式** | `cg_ses_{timestamp}`（如 `cg_ses_1782182430621`） |
| **生成者** | `store.ts:generateGateSessionId()` — `"cg_ses_" + Date.now()` |
| **用途** | 合规门禁（compliance gate）的完整生命周期管理 |
| **获取方式** | 调用 `compliance_gate_check(task_description)` MCP 工具 |

### 3.2 生命周期状态

```
compliance_gate_check()          →  checked
compliance_gate_confirm()        →  armed
compliance_gate_submit_deliverables() → delivered
Orchestrator approval            →  approved
compliance_gate_complete()       →  completed
```

**异常终态**：`failed` / `drained`

### 3.3 过期排空

- `armed` 状态 > 24h → `drained`
- `checked` 状态（未确认）> 48h → `drained`
- `delivered`/`approved` 状态超时 → `drained`

由 `session.ts` 的 `sessionIdleHook` 自动执行清理。

### 3.4 类型定义

```typescript
// service/gate/store.ts
interface GateSession {
  session_id: string;
  created_at: string;
  task_description?: string;
  enforcement_mode?: string;
  gate_status: "checked" | "armed" | "delivered" | "approved" | "completed" | "failed" | "recoverable" | "drained";
  last_check_passed?: boolean;
  last_check_failed_items?: GateCheckItem[];
  plan_summary?: string | null;
  confirmed_at?: string | null;
  consumed_at?: string | null;
  expires_at?: string | null;
  task_id?: string | null;       // 关联 DAG Task
  agent?: string;
  declared_deliverables?: DeliverableEntry[];
  submitted_deliverables?: DeliverableEvidence[];
  approval_required?: boolean;
  // ... 更多字段
}
```

### 3.5 存储

**DB-only**（自 2026-06-26 起 JSON 双写已移除），存储于 **`gate_sessions` DB 表**：

```sql
CREATE TABLE gate_sessions (
    session_id        TEXT PRIMARY KEY,    -- "cg_ses_{timestamp}"
    task_desc         TEXT NOT NULL,
    status            TEXT NOT NULL,       -- checked/armed/delivered/approved/completed/failed/drained
    version           INTEGER NOT NULL DEFAULT 1,  -- F2 迁移: 乐观锁版本号
    agent             TEXT,
    task_id           TEXT,                -- DAG task ID
    plan_summary      TEXT,
    execution_summary TEXT,
    mode              TEXT,
    checked_at        INTEGER,
    armed_at          INTEGER,
    completed_at      INTEGER,
    drained_at        INTEGER,
    created_at        INTEGER NOT NULL,
    consumed_at       INTEGER,
    expires_at        INTEGER,
    enforcement_mode  TEXT,
    last_check_passed INTEGER,
    failed_items      TEXT,               -- JSON 字符串数组
    missing_artifacts TEXT,
    fail_reason       TEXT,
    worktree          TEXT,
    audit             TEXT,
    updated_at        INTEGER NOT NULL,
    -- v5: 交付物硬约束
    declared_deliverables     TEXT,
    submitted_deliverables    TEXT,
    deliverables_approved_by  TEXT,
    deliverables_approved_at  INTEGER,
    deliverables_approval_note TEXT,
    approval_required         INTEGER,
    -- v21: 会话关联
    opencode_session_id       TEXT
);
```

### 3.6 与 DAG Task 的关联

```
gate_sessions.task_id ↔ session_map.dag_task_id ↔ Task.DAG.json.tasks[].id
```

---

## §4 Dispatch Session（派发会话 — 双表追踪）

### 4.1 `dispatch_queue` — 派发队列

| 维度 | 详情 |
|------|------|
| **DB 表** | `dispatch_queue` (v15) |
| **用途** | FIFO 派发入口队列，管理每次子 Agent 派发的生命周期 |
| **状态流转** | `pending` → `running` → `consumed`（或 `failed` / `stale` / `expired`） |
| **租约机制** | 60s TTL（`lease_owner` = 持有者 Session ID，`lease_expiry` = Unix 时间戳） |
| **入队** | `dispatch_subagent.ts` 工具 |
| **出队 + 租用** | `task-before.ts` 的 `task.execute.before` 钩子 |

表结构：
```sql
CREATE TABLE dispatch_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    status          TEXT NOT NULL DEFAULT 'pending',
    agent_type      TEXT NOT NULL,
    dag_task_id     TEXT NOT NULL,
    session_id      TEXT,
    prompt_ref_id   INTEGER REFERENCES dispatch_prompt_refs(id),
    lease_owner     TEXT,
    lease_expiry    INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
```

### 4.2 `session_log` — 派发会话日志

| 维度 | 详情 |
|------|------|
| **DB 表** | `session_log` (v6) |
| **用途** | 记录每次成功派发的子 Agent 会话信息，支持通过 `resume_session_id` 恢复 |
| **写入者** | `task-after.ts` 的 `task.execute.after` 钩子 |
| **查询接口** | `dbQuerySessionByDagTaskId(dagTaskId)` / `dbQuerySessionByDomain(domainId)` |

表结构：
```sql
CREATE TABLE session_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL,        -- 子 Agent 的 OpenCode session ID
    dag_task_id  TEXT NOT NULL,        -- DAG task ID
    agent_type   TEXT NOT NULL,        -- 子 Agent 类型
    run_id       TEXT,
    created_at   INTEGER NOT NULL
);
```

---

## §5 Session Namespace（会话命名空间）

| 维度 | 详情 |
|------|------|
| **格式** | 字符串，通常等于 `dag_task_id` |
| **用途** | 用于 `.task_temp/{namespace}/` 目录命名，存放 HANDOVER.md、test_report.json 等产物 |
| **生成者** | `dispatch_subagent` 工具参数 |
| **与 dag_task_id 的区别** | 语义不同：`dag_task_id` 是 DAG 任务标识，`namespace` 是文件系统路径标识。多个派发指向同一 DAG 任务时应使用**不同的 namespace** |

---

## §6 核心文件索引

| 文件 | 角色 |
|------|------|
| `.opencode/lib/db-manager.ts` | SQLite 连接单例；完整 schema 初始化（26 次迁移） |
| `.opencode/lib/db-state-manager.ts` | CRUD API：session_map、session_log、gate_store、dispatch_queue 等 |
| `.opencode/lib/agent-resolver.ts` | 多优先级 agent/dag_task/domain 解析 |
| `.opencode/lib/gate-core.ts` | **桥接文件**（1.9KB）— re-export 自 `service/gate/`；实际逻辑在 store.ts + session-crud.ts |
| `.opencode/service/gate/store.ts` | GateSession 类型定义、GateStore I/O、ID 生成 |
| `.opencode/service/gate/session-crud.ts` | 门会话 CRUD：create、arm、complete、deliverables |
| `.opencode/plugins/session.ts` | 会话生命周期钩子；启动清理；轮次汇总生成 |
| `.opencode/plugin-handlers/before/gate.ts` | 启动时自动武装门；修改类工具的门武装检查 |
| `.opencode/plugin-handlers/before/dispatch.ts` | DISPATCH-INTEGRITY 哈希校验；dispatch_queue 租用 |
| `.opencode/plugin-handlers/after/dispatch.ts` | session_log 持久化；dispatch_queue 消费 |
| `.opencode/tools/dispatch_subagent.ts` | 主导派发工具；PLAN-FIRST 第 2 层；子槽位 + ctx 写入 |
| `.opencode/scripts/command-tools/dispatch-subagent.ts` | CLI 脚本：Agent 配置读取、提示词生成、DISPATCH_TOKEN 嵌入 |
| `.opencode/state/framework-state.db` | Bun SQLite 数据库（WAL 模式）— 所有 Session 数据的唯一规范来源 |

---

## §7 快速对照总表

| # | 概念 | ID 格式 | 生成位置 | 存储位置 | 用途 |
|---|------|---------|----------|----------|------|
| 1 | **OpenCode Session** | `ses_*` | OpenCode 上游 | `session_map` DB | 会话级 Agent 身份绑定 + 对话历史 |
| 2 | **Gate Session** | `cg_ses_{ts}` | `store.ts:519` | `gate_sessions` DB | 合规门生命周期管控 |
| 3a | **Dispatch Queue** | 自增整数 | `dispatch_subagent.ts` | `dispatch_queue` DB | 派发 FIFO 队列 + 租约管理 |
| 3b | **Session Log** | 子 Agent 的 `ses_*` | `plugin-handlers/after/dispatch.ts` | `session_log` DB | 子 Agent 会话恢复 + 追踪 |
| 4 | **Session Namespace** | 字符串 | `dispatch_subagent` 参数 | `.task_temp/{ns}/` | 任务产物目录隔离 |
| 5 | **Session Map** | `ses_*` 为 PK | `session.ts` + 工具 | `session_map` DB | Agent/DAG/Domain 关联枢纽 |

---

## §8 OpenCode 官方行为总结

基于对 OpenCode 官方 GitHub 仓库（`anomalyco/opencode`）源码及运行日志的调查：

1. **一个对话只有一个 `ses_*` ID**：用户开启对话即创建，同一对话内所有轮次共享此 ID。用 `/new` 命令才会创建新 session。

2. **每层子 Agent 派发都产生新的 `ses_*` ID**：
   - 父 Agent 派发子 Agent → 子 Agent 获得全新的 OpenCode session
   - 子 Agent 再派发子子 Agent → 子子 Agent 也获得全新的 OpenCode session
   - OpenCode Session 结构体通过 `ParentSessionID` 字段维护父子层级关系

3. **会话默认不重用**：每次 `dispatch_subagent` → `Task()` 调用都创建新会话。如需恢复之前的子 Agent 会话，需显式使用 `resume_session_id` 参数。

4. **所有 Session 数据的唯一规范来源是 SQLite DB**（`framework-state.db`，Bun SQLite，WAL 模式）。

---

_本文档综合了 OpenCode 官方 GitHub 仓库（`anomalyco/opencode`）源码、运行日志，以及 `.opencode/` 框架内 18+ 个源文件的分析结果。_
