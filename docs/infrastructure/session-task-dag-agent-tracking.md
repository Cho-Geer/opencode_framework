# Session / Task / DAG Task / Agent / DAG Session — 追踪架构

**版本**: v1.0.0  
**创建日期**: 2026-06-26  
**作者**: @Super-Admin  
**状态**: 完整分析  
**数据库**: `.opencode/state/framework-state.db`（Bun SQLite，WAL 模式，v25 schema）

---

## §1 概念辨析 — 五种不同的 ID

框架同时管理五种语义不同的 ID。混淆它们是大量 P0 级 Bug 的根本原因。

| #   | 概念                                      | ID 格式                                             | 生成者                                                | 规范持久化位置                              |
| --- | ----------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| 1   | **OpenCode Session ID**                   | `ses_*`（不透明字符串，如 `ses_1781234567890`）     | OpenCode 上游框架                                     | `session_map` DB 表                         |
| 2   | **合规门 Session ID**                     | `cg_ses_{timestamp}`（如 `cg_ses_1782182430621`）   | `gate-core.ts:generateGateSessionId()`                | `gate_sessions` DB 表                       |
| 3   | **DAG Task ID**                           | 字符串（如 `T-099`、`E2E-ACCEPTANCE-FINDINGS-DOC`） | `Task.DAG.json` `tasks[].id`（由 @Meta-Planner 分配） | `Task.DAG.json` + `session_map.dag_task_id` |
| 4   | **Agent 身份**                            | `@AgentName`（如 `@Coder-BE`、`@Super-Admin`）      | `session_map` DB 或 `FRAMEWORK_AGENT` 环境变量        | `session_map.agent`                         |
| 5   | **Session Namespace**（task_id/输出路径） | 字符串，通常等于 dag_task_id                        | `dispatch_subagent` 参数                              | `.task_temp/{namespace}/` 目录              |

**关键语义区分**：在 `dispatch_subagent.ts` 中，传给 `dispatch-subagent.ts` 的第二个位置参数是 `session_namespace`（用于 `.task_temp/` 输出路径命名），而 `dag_task_id` 通过 `DISPATCH_DAG_TASK_ID` 环境变量传递，并会与 `Task.DAG.json` 进行校验。即使两者共享相同的字符串值（常见情况），它们在语义上仍然是不同的标识符。

---

## §2 各 ID 格式详解

### 2.1 OpenCode Session ID（`ses_*`）

由 **OpenCode 上游框架自身**生成（非我们的代码）。在工具执行函数中表现为 `context.sessionID`，在插件钩子中表现为 `input.sessionID`。这些是不透明字符串——我们既不生成也不校验它们，只进行消费。

**生命周期**：

1. 用户开启对话时，OpenCode 创建新会话
2. `chat.message` 钩子触发 → `session.ts` 写入 `session_map` DB
3. 当 `dispatch_subagent` 派生子 Agent 时，OpenCode 为该子 Agent 创建**全新**会话
4. 父会话 ID 通过 `OPENCODE_SESSION_ID` 环境变量传递给 `dispatch-subagent.ts`

**关键事实**：每次 `dispatch_subagent` → `Task()` 调用都会创建**新**的 OpenCode 会话。会话默认不重用。会话恢复需显式通过 `resume_session_id` 参数选择加入。

### 2.2 合规门 Session ID（`cg_ses_{timestamp}`）

由 `gate-core.ts`（第 770 行）生成：

```typescript
export function generateGateSessionId(): string {
  return "cg_ses_" + Date.now();
}
```

**生命周期状态**：`checked` → `armed` → `delivered` → `approved` → `completed`（或 `failed` / `drained`）

存储在 `gate_sessions` SQLite 表中。自 P2-A 步骤 8（FW-DB-CANONICAL-01, 2026-06-26）起，DB 是唯一规范来源，gate-state.json 的 JSON 双写已移除。

### 2.3 DAG Task ID

由 @Meta-Planner 在 `Task.DAG.json` 中分配的项目工作单元标识符。对于非 DAG 豁免 Agent，必须存在于 `tasks[]` 或 `execution_order` 数组中，且状态为 `pending` 或 `in_progress`。

**缺失时**：`dispatch_subagent.ts` 自动生成追踪 UUID（第 300-308 行）：

```typescript
if (!effectiveDagTaskId) {
  const trackingUuid = require("node:crypto").randomUUID();
  effectiveDagTaskId = trackingUuid;
}
```

### 2.4 Agent 身份

通过多优先级链解析（见 §4）。始终规范化为 `@AgentName` 格式。各来源按优先级排列：

| 优先级 | 来源                                             | 文件位置                     |
| ------ | ------------------------------------------------ | ---------------------------- |
| 1      | `session_map` DB — `dbReadSessionMap(sid).agent` | `agent-resolver.ts` L99-124  |
| 2      | `FRAMEWORK_AGENT` 环境变量                       | `agent-resolver.ts` L137-147 |
| 3      | 空字符串（记录 ERROR 日志）                      | `agent-resolver.ts` L149-155 |

### 2.5 Session Namespace

用于 `.task_temp/{namespace}/` 目录命名和会话追踪。未提供时默认为 `dag_task_id`。当多个派发指向同一 DAG 任务时，应使用不同的 namespace。

---

## §3 中央数据库 — `framework-state.db`

**文件**: `.opencode/state/framework-state.db`  
**引擎**: Bun SQLite（WAL 模式，NORMAL 同步，5000ms busy_timeout）  
**管理器**: `.opencode/lib/db-manager.ts`（连接单例）  
**CRUD API**: `.opencode/lib/db-state-manager.ts`

### 3.1 核心追踪表

#### `session_map` — 中心枢纽（v6 基础，演进至 v25）

```sql
CREATE TABLE session_map (
    session_id   TEXT PRIMARY KEY,     -- OpenCode ses_* ID
    agent        TEXT NOT NULL,        -- "@AgentName" 或 "pending"
    dag_task_id  TEXT DEFAULT NULL,    -- DAG task ID（v8 新增）
    domain_id    TEXT DEFAULT NULL,    -- 知识领域 ID（v9 新增）
    model_id     TEXT DEFAULT NULL,    -- LLM 模型 ID（v24 新增）
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
```

**这是 Agent 身份、dag_task_id 和 domain_id 的主要解析来源**。所有插件钩子均通过 `dbReadSessionMap(sessionID)` 来确定当前 Agent 上下文。

**写入者**：
| 写入者 | 写入内容 | 位置 |
|--------|---------|------|
| `session.ts` `chatMessageHook` | `agent`，可选 `dag_task_id`、`domain_id`（仅当 resolved_from=session_map 时） | L516-561 |
| `dispatch_subagent.ts` 工具 | `dag_task_id`、`domain_id`、`agent`（已有或用 "pending"） | L766-801 |
| `dispatch_subagent.ts` 工具（子槽位） | `dispatch:child:{dagTaskId}` 合成行，含 agent + domain | L807-819 |
| `module_scope_declare.ts` | 当 domain 与派发时不同时更新 `domain_id` | L151 |

#### `session_log` — 已派发会话追踪（v6）

```sql
CREATE TABLE session_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL,        -- 子 Agent 的 OpenCode session ID
    dag_task_id  TEXT NOT NULL,        -- DAG task ID
    agent_type   TEXT NOT NULL,        -- 子 Agent 类型
    run_id       TEXT,                 -- OPENCODE_RUN_ID
    created_at   INTEGER NOT NULL
);
```

**写入者**：`task-after.ts` 插件（第 215 行），在 `Task()` 派发成功后写入。

**用途**：通过 `resume_session_id` 参数恢复之前的子 Agent 会话。`dbQueryLatestSessionByDagTaskId(dagTaskId)` 可查找某个 DAG 任务的最新会话。

#### `gate_sessions` — 合规门状态（v0）

```sql
CREATE TABLE gate_sessions (
    session_id        TEXT PRIMARY KEY,    -- "cg_ses_{timestamp}"
    task_desc         TEXT NOT NULL,
    status            TEXT NOT NULL,       -- checked/armed/delivered/approved/completed/failed/drained
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

**DB-only**：自 P2-A 步骤 8（FW-DB-CANONICAL-01, 2026-06-26）起，gate-state.json 的 JSON 双写已完全移除。DB 是唯一规范来源，无 JSON 回退。

#### `dispatch_queue` — FIFO 派发入口队列（v15）

```sql
CREATE TABLE dispatch_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending/running/consumed/failed/stale/expired
    agent_type      TEXT NOT NULL,
    dag_task_id     TEXT,
    session_id      TEXT,
    prompt_ref_id   INTEGER REFERENCES dispatch_prompt_refs(id),  -- FK to prompt metadata
    lease_owner     TEXT,               -- 持有租约的 Session ID
    lease_expiry    INTEGER,            -- Unix 时间戳（60s TTL）
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
```

**注意**：`prompt_sha256` 和 `file_path` 不在此表中，而是存储在 `dispatch_prompt_refs` 表中，通过 `prompt_ref_id` 外键引用。

### 3.2 其他辅助表

| 表名                         | 版本 | 用途                          |
| ---------------------------- | ---- | ----------------------------- |
| `dispatch_failed_log`        | v6   | 失败派发的死信归档            |
| `dispatch_prompt_refs`       | v15  | 生成的提示词文件元数据（file_path, sha256, size_bytes） |
| `dispatch_attempts`          | v15  | 每次派发的尝试记录            |
| `dispatch_payload_integrity` | v18  | 载荷哈希完整性校验            |
| `execution_checklist_runs`   | v18  | P0 检查清单运行追踪           |
| `execution_checklist_items`  | v18  | P0 检查清单条目状态           |
| `execution_checklist_events` | v18  | P0 检查清单事件日志           |
| `substate_kv`                | v2   | 全部 12 个子状态的键值存储    |
| `machine_meta`               | v1   | Machine.json 元数据（键值对） |
| `machine_contracts`          | v1   | 契约文件路径                  |
| `read_audit`                 | v10  | UC7-001 合规的读取追踪        |
| `audit_log` / `audit_trail`  | v1   | 审计事件                      |
| `schema_version`             | v1   | Schema 迁移追踪               |

---

## §4 Agent 身份解析

**文件**: `.opencode/lib/agent-resolver.ts`（L99-156）

### 4.1 解析链（`resolveAgent(sessionID)`）

```
┌─────────────────────────────────────────────────────────┐
│ 1. session_map DB                                       │
│    dbReadSessionMap(sid).agent                          │
│    └─ 命中 → 返回 "@AgentName"                          │
│                                                          │
│ 2. FRAMEWORK_AGENT 环境变量（回退）                      │
│    process.env.FRAMEWORK_AGENT                          │
│    └─ 命中 → 返回 "@AgentName"                          │
│                                                          │
│ 3. ERROR — 返回 ""（所有来源均已穷尽）                   │
└─────────────────────────────────────────────────────────┘
```

**关键设计决策**（2026-06-12，@Super-Admin）：`session_map` 被提升至**优先级 1**（此前 `_dispatch_target.json` 处于优先级 1）。共享的 `_dispatch_target.json` 文件在并发派发时会导致跨派发覆盖竞态。Session map 是会话级别的，对此类竞态免疫。

**OPT-07（2026-06-23）**：遗留的 `_dispatch_target.json` 回退路径已完全移除。

### 4.2 `FRAMEWORK_AGENT` 环境变量

由 `dispatch-subagent.ts`（CLI 脚本）在构造子 Agent 前言时设置。子 Agent 进程继承此环境变量。但这只是**回退方案**——主路径是 `session_map` DB。

### 4.3 Agent 身份如何传播到子 Agent

1. 父 Agent 调用 `dispatch_subagent(agent_type="Coder-BE", ...)`
2. `dispatch_subagent.ts` 工具写入子槽位：`session_map["dispatch:child:{dagTaskId}"].agent = "Coder-BE"`
3. `dispatch-subagent.ts` CLI 脚本生成含有 Agent 类型的包装提示词
4. 子 Agent 进程启动，环境中 `FRAMEWORK_AGENT=Coder-BE`
5. 子 Agent 的 `chatMessageHook` 触发 → `session.ts` 写入 `session_map[sid].agent = "Coder-BE"`
6. 后续调用 `resolveAgent(sid)` → 命中 `session_map` → 返回 `"@Coder-BE"` ✅

---

## §5 DAG Task ID 解析

**文件**: `.opencode/lib/agent-resolver.ts`（L282-394）

### 5.1 解析链（`resolveTaskIdWithSource(sessionID)`）

```
┌───────────────────────────────────────────────────────────────────┐
│ 优先级 1: session_map DB                                          │
│   dbReadSessionMap(sid).dag_task_id                               │
│   └─ 命中 → { value, resolved_from: "session_map" }              │
│                                                                    │
│ 优先级 1.5: 子派发槽位（FW-FIX-CHILD-SESSION-MAP）               │
│   _findChildDagTaskId() → "dispatch:child:{dagTaskId}"            │
│   dbReadSessionMap("dispatch:child:{dagTaskId}").dag_task_id      │
│   └─ 命中 → { value, resolved_from: "child_slot" }               │
│                                                                    │
│ 优先级 2: 每次派发的 ctx/{dagTaskId}.json 文件                    │
│   单个文件 → { value, resolved_from: "ctx_single" }               │
│   多个文件 → { value, resolved_from: "ctx_newest" }               │
│   多个 + dagTaskId 精确匹配 → "ctx_exact_match"                   │
│   无匹配 → { value: "", resolved_from: "none" }                   │
└───────────────────────────────────────────────────────────────────┘
```

### 5.2 写入侧约束（FW-SESSION-HOOK-WRITE-CONSTRAINT）

`session.ts` 的 `chatMessageHook` **禁止**在 `resolved_from` 为 `"session_map"` 以外的任何来源时将 `dag_task_id` 写入 `session_map`（第 531-538 行）：

```typescript
const dagTaskId =
  taskIdResult.resolved_from === "session_map"
    ? taskIdResult.value || undefined
    : undefined;
```

这可以防止用来自不明确来源（`ctx_newest`、`dispatch_ctx`）的数据污染按会话映射，因为这些数据可能属于并发派发。

### 5.3 写入侧：`dispatch_subagent.ts` 工具

该工具（而非 `session.ts`）是 `dag_task_id` 写入 `session_map` 的**规范写入者**：

1. **调用者会话**: `dbWriteSessionMap(callerSessionId, agentForWrite, dagTaskId, domainId)`（L781-800）
2. **子槽位**: `dbWriteSessionMap("dispatch:child:" + dagTaskId, agentType, dagTaskId, domainId)`（L807-819）
3. **每次派发的 ctx 文件**: `ctx/{dagTaskId}.json` 包含 `dagTaskId`、`agentType`、`domainId`、`parentSessionId`、`createdAt`（L726-763）

### 5.4 V1.2 修复 — 始终写入（2026-06-23）

**此前 Bug**：`dispatch_subagent.ts` 用 `existing?.agent` 作为守卫条件来调用 `dbWriteSessionMap`。当 `chatMessageHook` 尚未触发时，`existing?.agent` 为 `null`，导致 `dagTaskId` 永远不会被写入——破坏了子 Agent 的检查清单解析。

**修复**：始终写入 `dagTaskId` + `domainId`。如果有已有 agent 则使用，否则使用 `"pending"` 占位符。`chatMessageHook` 触发时会用实际 agent 覆盖（INSERT OR REPLACE 处理此逻辑）。

---

## §6 Dispatch 创建嵌套会话 — 完整流程

```
┌─────────────────────────────────────────────────────────────────────┐
│ @Orchestrator（OpenCode 会话 ses_A）                                 │
│                                                                      │
│   dispatch_subagent(agent_type="Coder-BE",                           │
│                     dag_task_id="T-099",                             │
│                     task_description="实现 X 功能")                   │
│     │                                                                │
│     ├── 写入: session_map[ses_A].dag_task_id = "T-099"              │
│     ├── 写入: session_map["dispatch:child:T-099"] =                 │
│     │         { agent: "Coder-BE", dag_task_id: "T-099",            │
│     │           domain_id: "backend_api" }                           │
│     ├── 写入: ctx/T-099.json = { dagTaskId, agentType,              │
│     │                              domainId, parentSessionId, ... }  │
│     ├── 启动: bun dispatch-subagent.ts Coder-BE "T-099" "..."       │
│     │   └── 生成包含 DISPATCH_TOKEN 的包装提示词                     │
│     │   └── 写入提示词到 .task_temp/_dispatch/dispatch-{ts}.md      │
│     │   └── 入队 .auto-dispatch.json 条目                            │
│     │   └── 将包装提示词返回给 LLM                                   │
│     │                                                                │
│     └── LLM 调用 Task({ subagent_type: "Coder-BE",                  │
│                          prompt: <wrapped_prompt> })                 │
│           │                                                          │
│           ├── task-before.ts: 验证 DISPATCH_TOKEN 哈希              │
│           ├── task-before.ts: 从队列取出 auto-dispatch 标记          │
│           ├── task-before.ts: 租用 dispatch_queue 条目               │
│           │                                                          │
│           └── OpenCode 为子 Agent 创建新会话 ses_B                   │
│                                                                      │
│ @Coder-BE（OpenCode 会话 ses_B）                                     │
│     │                                                                │
│     ├── chatMessageHook 触发 →                                       │
│     │   session_map[ses_B].agent = "Coder-BE"                        │
│     │                                                                │
│     ├── resolveTaskIdWithSource(ses_B):                              │
│     │   ├── session_map[ses_B] → 尚无 dag_task_id ✗                │
│     │   ├── 子槽位: "dispatch:child:T-099" → "T-099" ✓             │
│     │   └── 从 child_slot 返回 "T-099"                              │
│     │                                                                │
│     ├── 子 Agent 执行任务，写入 HANDOVER.md                          │
│     │                                                                │
│     └── task-after.ts（在 ses_A 上下文中）:                          │
│         dbAppendSessionLog(ses_B, "T-099", "Coder-BE")              │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.1 会话间上下文传递

会话间状态通过以下机制传递：

| 机制                            | 格式                                          | 写入者                                          | 读取者                                    |
| ------------------------------- | --------------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| `session_map` DB                | `(session_id, agent, dag_task_id, domain_id)` | `dispatch_subagent.ts` 工具 + `session.ts` 钩子 | `agent-resolver.ts`、所有插件             |
| 子槽位（`dispatch:child:{id}`） | `session_map` 合成行                          | `dispatch_subagent.ts` L807-819                 | `agent-resolver.ts` 优先级 1.5            |
| `ctx/{dagTaskId}.json`          | 每次派发的上下文文件                          | `dispatch_subagent.ts` L726-763                 | `agent-resolver.ts` 优先级 2              |
| `session_log` DB                | `(sub_session_id, dag_task_id, agent_type)`   | `task-after.ts` L215                            | 通过 `resume_session_id` 恢复             |
| `HANDOVER.md`                   | `.task_temp/{taskId}/` 下的 Markdown          | 子 Agent                                        | `session.ts` `sessionIdleHook` → 轮次汇总 |
| `dispatch_payload_integrity`    | 载荷哈希记录                                  | `dispatch-subagent.ts` CLI                      | `task-before.ts` 校验                     |
| `.auto-dispatch.json`           | FIFO 队列                                     | `dispatch_subagent.ts` L616-709                 | `task-before.ts` 出队                     |

---

## §7 合规门 Session 生命周期

**文件**: `.opencode/lib/gate-core.ts`  
**状态转换**:

```
                    compliance_gate_check()
                    ┌──────────────────────┐
                    │  status: "checked"    │
                    └──────────┬───────────┘
                               │ compliance_gate_confirm()
                               ▼
                    ┌──────────────────────┐
                    │  status: "armed"      │
                    └──────────┬───────────┘
                               │ Agent 执行工作
                               │ compliance_gate_submit_deliverables()
                               ▼
                    ┌──────────────────────┐
                    │  status: "delivered"  │
                    └──────────┬───────────┘
                               │ Orchestrator 批准
                               │ compliance_gate_approve_deliverables()
                               ▼
                    ┌──────────────────────┐
                    │  status: "approved"   │ ← （若提供摘要则可直接→completed）
                    └──────────┬───────────┘
                               │ compliance_gate_complete()
                               ▼
                    ┌──────────────────────┐
                    │  status: "completed"  │
                    └──────────────────────┘
```

**过期排空（Stale Draining）**：

- `armed` 状态且距 `confirmed_at`（或 `created_at` 回退，FW-DB-CANONICAL-04/05/06）> 24h → `drained`
- `checked` 状态（未确认）且距 `created_at` > 48h → `drained`
- `delivered`/`approved` 状态且超过配置的 `delivered_hours`/`approved_hours` → `drained`（由 `session.ts` 启动清理自动执行）

> **注**：`confirmed_at` 回退至 `created_at` 修复了中断孤儿会话（armed + null confirmed_at）无法被排空的盲区。该盲区此前存在于 4 处清理逻辑中，已全部修复。

**启动时自动武装**：`gate-before.ts`（L26-44）在插件导入时，若无已武装的会话，则自动创建并武装一个门会话。

### 7.1 Gate 到 DAG Task 的关联

`gate_sessions.task_id` 字段存储 DAG task ID。关联链为：

```
gate_sessions.task_id ↔ session_map.dag_task_id ↔ Task.DAG.json.tasks[].id
```

对于非豁免 Agent，`compliance_gate_confirm` 需要 `declared_deliverables`。对于豁免 Agent（@Orchestrator、@Super-Admin），此参数为可选。

---

## §8 HANDOVER.md 状态传递

### 8.1 格式

HANDOVER.md 文件位于 `.task_temp/{taskId}/HANDOVER.md`，是结构化的 Markdown，包含：

| 章节                                         | 内容                                   |
| -------------------------------------------- | -------------------------------------- |
| `## Files Modified`                          | 文件:变更:理由 表格                    |
| `## State Changes`                           | machine.json、gate-state.json 状态转换 |
| `## Commands Executed`                       | Shell 命令及输出                       |
| `## Bypasses Invoked`                        | 框架豁免及理由                         |
| `## Findings`                                | 严重性/描述 表格                       |
| `## Key Assumptions`                         | 假设列表                               |
| `## Logs Checked`                            | ≥2 个日志来源（调查任务强制要求）      |
| `## Questions for User`                      | 非阻塞性问题                           |
| `## Blocked Actions Requiring User Approval` | 需要人工批准的破坏性操作               |

### 8.2 轮次汇总聚合

`session.ts` 的 `sessionIdleHook`（L700-727）调用 `generateRoundSummary()`，其功能为：

1. 扫描 `.task_temp/*/HANDOVER.md`，筛选出自上次空闲后被修改的文件
2. 提取 `**Agent**`、`**Core Changes**`、`## Findings`、`## Key Assumptions`
3. 将汇总写入 `.task_temp/_global/round-summary-{timestamp}.md`

### 8.3 审批用的 `handover_sha256`

当子 Agent 提交交付物时，Orchestrator 审批需要 `handover_sha256`。此哈希将交付物与其特定的 HANDOVER.md 内容绑定，用于完整性校验。

---

## §9 Auto-Dispatch 机制（LLM-Free Bridge）

`dispatch_subagent` 工具使用基于队列的"LLM-Free Bridge"将包装提示词传递给 `Task()` 工具，而无需 LLM 看到完整的提示词：

1. **工具写入**：
   - 完整包装提示词 → `.task_temp/_dispatch/dispatch-{timestamp}.md`
   - 队列条目 → `.task_temp/_dispatch/.auto-dispatch.json`（FIFO 数组，最多 50 条）
   - 返回简短确认信息给 LLM

2. **LLM 调用** `Task({ subagent_type, prompt: <wrapped_prompt> })`

3. **task-before.ts 拦截**：
   - 计算提示词中 DISPATCH_TOKEN 的哈希
   - 从 `.auto-dispatch.json` 取出匹配条目
   - 从文件加载完整提示词
   - 用完整提示词替换哈希
   - 租用 `dispatch_queue` 条目（60s TTL）

4. **task-after.ts 清理**：
   - 追加到 `session_log` DB
   - 消费 `dispatch_queue` 条目
   - 写入门提醒文件

---

## §10 插件入口点 — 完整映射

| 插件文件              | 钩子事件              | 功能描述                                                                                                                                |
| --------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `session.ts`          | `chat.message`        | 将会话→Agent 映射写入 `session_map` DB；启动清理（排空过期门、回收孤立的 ctx 文件、清除中断哨兵）；为 DAG 豁免 Agent 自动标记 preflight |
| `session.ts`          | `session.error`       | 检测协同中断；写入中断哨兵                                                                                                              |
| `session.ts`          | `session.compacted`   | 重置内存中的 session map                                                                                                                |
| `session.ts`          | `session.idle`        | 清除中断哨兵；从 HANDOVER.md 生成轮次汇总                                                                                               |
| `dispatch-before.ts`  | `task.execute.before` | PLAN-FIRST 第 1 层：校验 dag_task_id 是否在 DAG 中；路由校验（L1-L4）；M14 子 Agent 目标限制                                            |
| `dispatch-after.ts`   | `task.execute.after`  | Task() 派发后清理；排空过期的 pending 条目                                                                                              |
| `task-before.ts`      | `task.execute.before` | DISPATCH-INTEGRITY：哈希验证 DISPATCH_TOKEN；出队 auto-dispatch 标记；租用 dispatch_queue 条目                                          |
| `task-after.ts`       | `task.execute.after`  | 将子 Agent 会话持久化到 `session_log` DB；消费 dispatch_queue                                                                           |
| `gate-before.ts`      | 导入时                | 启动时自动武装门；对修改类工具强制执行门武装检查                                                                                        |
| `gate-after.ts`       | `gate.execute.after`  | 定期排空过期会话                                                                                                                        |
| `checklist-before.ts` | `tool.execute.before` | P0 检查清单执行：若当前阶段有未解决的阻断项则阻止                                                                                       |
| `scope-before.ts`     | `tool.execute.before` | 写入范围执行；ROUTE-MISMATCH 检测                                                                                                       |
| `uc7ks-before.ts`     | `tool.execute.before` | UC7KS 知识管道执行；外部查询拦截                                                                                                        |

---

## §11 工具入口点

| 工具文件                  | 用途                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dispatch_subagent.ts`    | 生成包含 DISPATCH_TOKEN 的包装提示词；PLAN-FIRST 第 2 层执行；写入 session_map + 子槽位 + ctx 文件；auto_plan 自愈；通过 `.auto-dispatch.json` 队列实现 LLM-Free Bridge |
| `module_scope_declare.ts` | 声明知识领域范围；更新 session_map domainId；接入 UC7KS 管道                                                                                                            |
| `resolve_domain_id.ts`    | 从 session_map DB（高置信度）或 ctx 文件（中置信度）解析派发指定的 domain_id                                                                                            |

---

## §12 关键源文件 — 完整索引

| 文件                                                   | 行数 | 角色                                                                                                   |
| ------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------ |
| `.opencode/lib/db-manager.ts`                          | 2426 | SQLite 连接单例；完整 schema 初始化（25 次迁移）                                                       |
| `.opencode/lib/db-state-manager.ts`                    | 1775 | CRUD API：session_map、session_log、gate_store、dispatch_failed_log 等                                 |
| `.opencode/lib/agent-resolver.ts`                      | 627  | 多优先级 agent/dag_task/domain 解析；每次派发的 ctx 文件管理                                           |
| `.opencode/lib/gate-core.ts`                           | 2161 | 门会话生命周期：创建、武装、排空；执行模式解析                                                         |
| `.opencode/lib/execution-checklist.ts`                 | ~1227 | P0 检查清单状态机：dispatch_payload → preflight → read_attest → gate_armed → execute → deliver → close |
| `.opencode/lib/dag-policy.ts`                          | 378  | 从 project.config.json 读取 dispatch_policy；DAG 豁免 Agent 列表                                       |
| `.opencode/lib/gate-checks.ts`                         | ~250 | 在 Task.DAG.json 中查找任务；过期会话排空                                                              |
| `.opencode/plugins/session.ts`                         | 909  | 会话生命周期钩子；启动清理；轮次汇总生成                                                               |
| `.opencode/plugins/dispatch-before.ts`                 | ~450 | PLAN-FIRST 第 1 层；路由校验                                                                           |
| `.opencode/plugins/task-before.ts`                     | ~430 | DISPATCH-INTEGRITY 哈希校验；dispatch_queue 租用                                                       |
| `.opencode/plugins/task-after.ts`                      | ~300 | session_log 持久化；dispatch_queue 消费                                                                |
| `.opencode/tools/dispatch_subagent.ts`                 | 865  | 主导派发工具；PLAN-FIRST 第 2 层；子槽位 + ctx 文件写入                                                |
| `.opencode/scripts/command-tools/dispatch-subagent.ts` | 1302 | CLI 脚本：Agent 配置读取、模板变量解析、提示词生成、DISPATCH_TOKEN 嵌入                                |
| `.opencode/subagent-preamble.md`                       | 52   | 注入每个子 Agent 提示词的 P0 协议模板                                                                  |
| `.opencode/state/framework-state.db`                   | —    | Bun SQLite 数据库（WAL 模式）                                                                          |
| `.opencode/state/gate-state.json`                      | —    | DB-only：无 JSON 回退（FW-DB-CANONICAL-01 起 JSON 双写已移除）                                        |
| `.opencode/state/machine.json`                         | 13   | Machine 元数据 + 契约列表                                                                              |
| `Task.DAG.json`                                        | —    | 项目任务 DAG：tasks[]、execution_order、dependencies、status                                           |

---

## §13 配置点

### 13.1 `project.config.json` 关键配置段

| 配置段                | 关键字段                                                                                      | 用途                                                               |
| --------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `template_resolution` | `develop_enforcement_mode`、`runtime_enforcement_mode`                                        | 执行模式（advisory/strict/locked）                                 |
| `template_resolution` | `gate_stale_thresholds`                                                                       | 过期会话排空时间（armed_hours、checked_hours、delivered_hours 等） |
| `template_resolution` | `dispatch_integrity_bypass_agents`、`checklist_task_bypass_agents`、`checklist_agent_bypass`  | 豁免各种检查的 Agent                                               |
| `template_resolution` | `super_admin_uc7ks_dispatch_patterns`、`super_admin_repair_patterns`                          | SA 派发校验的模式匹配                                              |
| `template_resolution` | `checklist_passthrough_tools`                                                                 | P0 检查清单阻断期间仍可使用的工具                                  |
| `agent_domain_map`    | 每个 Agent 的领域映射                                                                         | 供 `dispatch_subagent.ts` 推断 `domain_id`                         |
| `dispatch_policy`     | `require_dag_entry`、`auto_plan_enabled`、`auto_plan_max_per_session`、`auto_plan_timeout_ms` | PLAN-FIRST 约束配置                                                |
| `p0_checklist_policy` | `monitored_write_targets`、`excluded_write_targets`                                           | 需要知识认证的写入目标                                             |

### 13.2 `opencode.json` 关键配置段

| 配置段                    | 用途                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.{name}.mode`       | `primary` / `subagent` / `all`                                                                                                        |
| `agent.{name}.permission` | 细粒度工具权限（read、edit、safe_edit、safe_shell 等）                                                                                |
| `plugin[]`                | 插件注册列表（23 个插件）                                                                                                             |
| `mcp`                     | MCP 服务器配置（compliance-gate、eslint-audit、code-quality-check、context7、playwright、github、postgre_sql、docker、pandoc、excel） |

---

## §14 常见陷阱与竞态条件

### 14.1 `_dispatch_target.json` 竞态条件（已修复）

**Bug**：`_dispatch_target.json` 是单一共享文件。并发派发会覆盖该文件，导致 Agent 身份解析错误。当 `@Super-Admin` 与 `@Coder-BE` 并行派发时，`_dispatch_target.json` 最终被写入 `"@Coder-BE"`（最后写入胜出），导致 `scope-before.ts` 跳过了对 SA 的 ROUTE-MISMATCH 检查。

**修复**：替换为 `session_map` DB（按会话隔离，无共享状态竞态）+ `ctx/{dagTaskId}.json`（按派发隔离，以 dagTaskId 为键）。

### 14.2 `.dispatch_ctx` 单例竞态（已修复）

**Bug**：与上述相同的共享文件问题。并发派发覆盖了该单例文件。

**修复**：替换为每次派发独立的 `ctx/{dagTaskId}.json` 文件。每次派发写入自己的文件——无覆盖。

### 14.3 子会话缺少 `dag_task_id`（已修复）

**Bug**：子 Agent 无法解析 `dag_task_id`，因为其自身的 `session_map` 行尚未写入（仅 `chatMessageHook` 会写入）。

**修复**：`dispatch_subagent.ts` 现在在 `session_id="dispatch:child:{dagTaskId}"` 写入一个"子派发槽位"，包含 agent 类型和 domain_id。`agent-resolver.ts` 优先级 1.5 读取此合成槽位。

### 14.4 并发派发 ctx/ 歧义（已修复）

**Bug**：当存在多个 ctx/ 文件时，`resolveDomainId` 使用"按 createdAt 取最新"启发式方法——在并发派发时可能返回错误的 domain。

**修复**：现在先尝试从 `session_map` DB 精确匹配 `dagTaskId`。若无匹配，则返回 `null` 而非猜测（P2 修复，2026-06-21）。

### 14.5 写入侧污染（已修复）

**Bug**：`session.ts` 的 `chatMessageHook` 从模糊来源（`ctx_newest`、`dispatch_ctx`）将 `dag_task_id` 写入 `session_map`，用并发派发的数据污染了按会话的映射。

**修复**：FW-SESSION-HOOK-WRITE-CONSTRAINT — 仅当 `resolved_from === "session_map"` 时才写入。

---

## §15 版本历史

| 日期       | 版本  | 变更                                                                                       |
| ---------- | ----- | ------------------------------------------------------------------------------------------ |
| 2026-06-26 | 1.0.0 | 初始完整文档，涵盖全部 5 种 ID 概念、DB schema、解析链、派发流程、门生命周期及竞态条件修复 |
| 2026-06-26 | 1.0.1 | 审计校正：schema 版本 v24→v25；dispatch_queue 表结构修正（prompt_ref_id FK 替代 prompt_sha256/file_path）；gate-state.json 标记为 DB-only（JSON 双写已移除）；stale draining 补充 confirmed_at \|\| created_at 回退说明；辅助表版本号与命名校正；关键源文件行数校正 |

---

_本文档综合了 `.opencode/lib/`、`.opencode/plugins/`、`.opencode/tools/`、`.opencode/scripts/`、`.opencode/state/` 及 `opencode.json` 中 18+ 个源文件的分析结果。_
