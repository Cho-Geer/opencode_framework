# OpenCode Session 使用全量审计

**版本**: v2.0.0  
**日期**: 2026-06-23  
**作者**: @Super-Admin  
**状态**: 审计完成（OpenCode Session + Gate Session 双路径全量）  
**前提文档**: `parameter-name-confusion-audit.md`（Session 有 8 种写法，`session_id` 同名异义）

---

## 1. OpenCode Session 的来源

```
上游 OpenCode 框架注入
│
├─→ Plugin hooks:  input.sessionID    ← 当前 agent 的 OpenCode session ("ses_*")
├─→ Tool context:  context.sessionID  ← 同上
│
└─→ env var:       OPENCODE_SESSION_ID  ← dispatch 时显式传播给子进程
```

**特点**：

- 框架保证非空
- 每个 agent 实例有唯一 session
- 父 session ≠ 子 session（dispatch 创建新 session）

---

## 2. 使用点全量清单（按模块）

### 2.1 Plugin 层 —— `input.sessionID`（22 个 Plugin）

| Plugin                      | 用途                                                           | session 角色              |
| --------------------------- | -------------------------------------------------------------- | ------------------------- |
| `session.ts`                | `chatMessageHook`：写入 `session_map` DB（agent→session 映射） | ✅ 正确——OpenCode session |
| `checklist-before.ts`       | 解析 checklist run，P0 阻断                                    | ✅ 正确——OpenCode session |
| `scope-before.ts`           | 写范围阻断，UC7KS 写前检查，config_read 验证                   | ✅ 正确——OpenCode session |
| `scope-after.ts`            | 写后日志                                                       | ✅ 正确                   |
| `dispatch-before.ts`        | PLAN-FIRST 阻断                                                | ✅ 正确                   |
| `dispatch-after.ts`         | dispatch 后清理                                                | ✅ 正确                   |
| `dispatch-auto.ts`          | auto-plan 触发                                                 | ✅ 正确                   |
| `task-before.ts`            | Task() 工具校验，dispatch queue 匹配                           | ✅ 正确                   |
| `task-after.ts`             | Task() 后清理                                                  | ✅ 正确                   |
| `gate-before.ts`            | Gate 工具校验，**同时操作 gate session**                       | ⚠️ 部分混淆               |
| `gate-after.ts`             | Gate 后日志                                                    | ✅ 正确                   |
| `audit-before.ts`           | 审计前检查                                                     | ✅ 正确                   |
| `audit-after.ts`            | 审计后日志                                                     | ✅ 正确                   |
| `question-policy-before.ts` | 子 session 阻断 question                                       | ✅ 正确                   |
| `format-after.ts`           | 自动格式化                                                     | —                         |
| `read-track-after.ts`       | 读操作追踪                                                     | ✅ 正确                   |
| `cache-after.ts`            | 缓存管理                                                       | ✅ 正确                   |
| `json-validate.ts`          | JSON 校验                                                      | ✅ 正确                   |
| `hook-config-guard.ts`      | Hook 配置守护                                                  | ✅ 正确                   |
| `git-guard-before.ts`       | Git 操作守护                                                   | ✅ 正确                   |
| `tdd-before.ts`             | TDD 强制执行                                                   | ✅ 正确                   |
| `uc7ks-before.ts`           | UC7KS 前置检查                                                 | ✅ 正确                   |
| `uc7ks-after.ts`            | UC7KS 后日志                                                   | ✅ 正确                   |

### 2.2 Tool 层 —— `context.sessionID`（18 个 Tool）

| Tool                         | 用途                                                   | session 角色                  |
| ---------------------------- | ------------------------------------------------------ | ----------------------------- |
| `dispatch_subagent.ts`       | 生成 dispatch 包装 prompt，写入 session_map + ctx 文件 | ✅ 正确——这里是**父 session** |
| `checklist_status.ts`        | 查询 checklist 状态                                    | ✅ 正确                       |
| `advance_checklist_phase.ts` | 推进 checklist 阶段                                    | ✅ 正确                       |
| `config_read_attest.ts`      | Config 读取验证——用 session 做 key 索引验证状态        | ✅ 正确                       |
| `knowledge_cache_search.ts`  | 缓存搜索——用 session 写 `knowledge_session_access` DB  | ✅ 正确                       |
| `knowledge_cache_attest.ts`  | 读取证据验证——用 session 做日志和 DB 写入              | ✅ 正确                       |
| `knowledge_gap_report.ts`    | 缓存覆盖分析                                           | —                             |
| `module_scope_declare.ts`    | 模块作用域声明——用 session 写 `session_map` domain     | ✅ 正确                       |
| `resolve_domain_id.ts`       | 解析 domain_id——用 session 查 `session_map`            | ✅ 正确                       |
| `janitor.ts`                 | 缓存清理                                               | —                             |
| `nightly-compaction.ts`      | 夜间压缩                                               | —                             |
| `safe_edit.ts`               | 安全文件编辑                                           | ✅ 正确                       |
| `safe_shell.ts`              | 安全 shell 执行                                        | ✅ 正确                       |
| `safe_delete.ts`             | 安全文件删除                                           | ✅ 正确                       |
| `safe_mkdir.ts`              | 安全目录创建                                           | ✅ 正确                       |
| `safe_restore.ts`            | 安全文件恢复                                           | ✅ 正确                       |
| `safe_diff.ts`               | 安全 diff                                              | —                             |
| `safe_test.ts`               | 安全测试执行                                           | ✅ 正确                       |

### 2.3 MCP Tool 层 —— Gate Session 混淆区

| MCP Tool                | 用途            | session 角色                                                             |
| ----------------------- | --------------- | ------------------------------------------------------------------------ |
| `compliance-gate.ts`    | Gate MCP server | ⚠️ `session_id` 是 **Gate session**（`cg_ses_*`），不是 OpenCode session |
| `code-quality-check.ts` | 代码质量检查    | —                                                                        |
| `eslint-audit.ts`       | ESLint audit    | —                                                                        |
| `keystone-validate.ts`  | Keystone 验证   | —                                                                        |

### 2.4 Core Library 层

| Library                  | 用途                                                         | session 角色                        |
| ------------------------ | ------------------------------------------------------------ | ----------------------------------- |
| `agent-resolver.ts`      | `resolveAgent(sessionID)` → L1/L2/L3 回退                    | ✅ 正确——OpenCode session           |
| `agent-resolver.ts`      | `resolveTaskId(sessionID)` → 同上                            | ✅ 正确                             |
| `agent-resolver.ts`      | `resolveDomainId(sessionID)` → 同上                          | ✅ 正确                             |
| `agent-resolver.ts`      | `resolveAgentFromSessionMap(sessionID)` → `dbReadSessionMap` | ✅ 正确                             |
| `execution-checklist.ts` | `createChecklistRun({ opencode_session_id, ... })`           | ✅ 正确——OpenCode session           |
| `gate-core.ts`           | `armSession(session_id, ...)`                                | ⚠️ **Gate session**（`cg_ses_*`）   |
| `gate-core.ts`           | `completeSession(session_id, ...)`                           | ⚠️ **Gate session**                 |
| `gate-core.ts`           | `loadGateStore()` → DB `gate_sessions` 表                    | ⚠️ **Gate session**                 |
| `db-state-manager.ts`    | `dbReadSessionMap(sessionID)` → `session_map` 表             | ✅ 正确——OpenCode session           |
| `db-state-manager.ts`    | `dbWriteSessionMap(sessionID, agent, ...)`                   | ✅ 正确                             |
| `read-audit.ts`          | `verifyRead(sessionID, filePath)`                            | ✅ 正确                             |
| `read-audit.ts`          | `getReadEventsForSession(sessionID)`                         | ✅ 正确                             |
| `uc7ks-utils.ts`         | `checkUC7KSWrite(agent, mode, sessionId, ...)`               | ✅ 正确——OpenCode session（日志用） |
| `log-manager.ts`         | `writeLog(src, level, { sessionID, ... })`                   | ✅ 正确                             |

---

## 3. Gate Session 混淆点详析

### 3.1 `compliance-gate.ts` 内的 `session_id`

```typescript
// compliance-gate.ts —— 运行在 MCP server 进程中（独立进程）
// 所有 session_id 都是 Gate session（cg_ses_*）

function createSession(task_description, plan_summary, ...) {
    const session_id = `cg_ses_${Date.now()}`;  // ← Gate session
    // ...
}

function armSession(session_id, ...) {
    // session_id 是 Gate session
    // 写入 gate_sessions DB 表
}

function completeSession(session_id, ...) {
    // session_id 是 Gate session
    // checklistWirePassed 用 OpenCode session 解析 run ← F-I bug!
}
```

### 3.2 `checklistWirePassed` 的 session 不匹配（F-I 根因）

```typescript
// compliance-gate.ts（MCP server 进程）
function completeSession(gateSessionId, ...) {
    // gateSessionId = "cg_ses_1782187868025"
    checklistWirePassed(gateSessionId, ...);
    // ↑ 传入了 Gate session
}

// execution-checklist.ts
function checklistWirePassed(sessionId, ...) {
    // 用 sessionId 查找 checklist run
    // 但 sessionId 是 Gate session，不是 OpenCode session
    // → run 查找失败 → facts 写到错误的 run 或空 run
}
```

### 3.3 `gate-before.ts` 的 `armSession` 调用

```typescript
// gate-before.ts（Plugin 进程）
armSession(
  session.session_id, // ← Gate session（cg_ses_*）
  "Auto-armed by gate-before plugin on OpenCode startup",
  "framework",
);
```

这个位置的 `session.session_id` 来自 `loadGateStore()` 返回的 gate 数据结构——是 Gate session，正确。

---

## 4. 跨进程 Session 传播链路

```
┌──────────────────────────────────────────────────────────────────────┐
│ 父进程（Orchestrator session）                                        │
│   dispatch_subagent()                                                 │
│     context.sessionID = "ses_parent"  ← 父 OpenCode session          │
│     → 写入 session_map: ses_parent → { agent:"orchestrator", ... }   │
│     → 设置 env: OPENCODE_SESSION_ID=ses_parent                       │
│     → 执行 bun dispatch-subagent.ts                                  │
├──────────────────────────────────────────────────────────────────────┤
│ 子进程（Child agent session）                                         │
│   Task() 创建子 session                                                │
│     input.sessionID = "ses_child"  ← 子 OpenCode session             │
│                                                                       │
│   Plugin hooks 使用 input.sessionID = ses_child                       │
│   Tool context 使用 context.sessionID = ses_child                     │
│                                                                       │
│   session_map 查询: dbReadSessionMap("ses_child") → agent/task       │
│   checklist 查询: createChecklistRun({ opencode_session_id:"ses_child" }) │
├──────────────────────────────────────────────────────────────────────┤
│ MCP Server 进程（独立进程）                                           │
│   compliance-gate.ts                                                  │
│     args.session_id = "cg_ses_1782187868025"  ← Gate session         │
│     NOT OpenCode session — 无法通过 session_map 解析 agent           │
│     → 通过 _dispatch_target.json / resolveDispatchTargetAgent() 获取 │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 5. 问题汇总

| #       | 位置                                         | 问题                                                                                                        | 严重度 |
| ------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| **F-I** | `compliance-gate.ts` → `checklistWirePassed` | Gate session 传入，但 checklist 期望 OpenCode session → facts 写错 run                                      | 🔴     |
| **G1**  | `compliance-gate.ts`                         | MCP server 无法访问 `input.sessionID`（独立进程），只能通过文件/DB 解析 agent                               | 🟡     |
| **P1**  | `scope-before.ts:245`                        | `configReadState.sessions[input.sessionID]` 用 session 做 key——需确保 DB 写入也用了正确的 session           | 🟡     |
| **P2**  | `dispatch_subagent.ts:537`                   | `OPENCODE_SESSION_ID` env var 传播父 session 给子进程，但子进程用 `input.sessionID`（自己的 session）做查询 | 🟡     |
| **P3**  | `gate-before.ts`                             | 同一个 Plugin 既用 `input.sessionID`（OpenCode session）又用 `session.session_id`（Gate session）——容易混淆 | 🟡     |

---

## 6. 使用 OpenCode Session 作为 key 的存储点

### 6.1 以 session 为 key 的 DB 表

| 表                         | 列                    | 用途                                                                                        |
| -------------------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| `session_map`              | `session_id`          | agent↔session 映射；`dbReadSessionMap(sid)` / `dbWriteSessionMap(sid, agent, task, domain)` |
| `execution_checklist_runs` | `opencode_session_id` | checklist run 关联；`createChecklistRun({ opencode_session_id })`                           |
| `read_audit`               | `session_id`          | 读审计；`verifyRead(sessionID, filePath)` / `getReadEventsForSession(sessionID)`            |
| `knowledge_session_access` | `opencode_session_id` | UC7KS 知识访问记录                                                                          |
| `session_log`              | `session_id`          | 子 session 日志                                                                             |
| `dispatch_queue`           | `session_id`          | dispatch 队列                                                                               |

### 6.2 以 session 为 key 的 JSON 存储

| 存储                    | 路径                                    | 用途                                        |
| ----------------------- | --------------------------------------- | ------------------------------------------- |
| `config_read_state`     | `substate_kv` → `sessions[sessionID]`   | config 读取验证状态                         |
| `knowledge_cache_state` | `substate_kv` → `session_access[agent]` | UC7KS 管线状态（agent key，非 session key） |

---

## 7. 建议

1. **统一命名**：OpenCode session → `opencode_session_id`（DB）/ `sessionID`（代码）；Gate session → `gate_session_id`
2. **修复 F-I**：`compliance-gate.ts` 的 `checklistWirePassed` 应使用 OpenCode session，而非 Gate session。需在 MCP server 中通过 `session_map` DB 反向查找或接收额外参数
3. **消除 confusable 上下文**：`gate-before.ts` 同时操作两种 session——可考虑拆分函数

---

## 8. Gate Session 使用全量审计

### 8.1 Gate Session 的来源与生成

```
gate-core.ts → generateSessionId()
  → "cg_ses_" + Date.now()
  → 示例: "cg_ses_1782187868025"

创建入口（3 处）:
├─ gate-before.ts:29     →  OpenCode 启动时自动武装
├─ compliance-gate.ts    →  MCP check + confirm 流程
└─ gate-core.ts:772      →  底层 createSession() 函数
```

### 8.2 Gate Session 的使用点全量清单

#### 8.2.1 `compliance-gate.ts`（MCP Server —— 最核心）

| 函数                                   | 行号  | Gate Session 操作                                     | 正确性                                             |
| -------------------------------------- | ----- | ----------------------------------------------------- | -------------------------------------------------- |
| `compliance_gate_check`                | ~414  | `const id = "cg_ses_" + Date.now()` → `createSession` | ✅ 创建                                            |
| `compliance_gate_confirm`              | —     | `armSession(session_id, ...)`                         | ✅ 武装                                            |
| `compliance_gate_complete`             | —     | `completeSession(session_id, ...)`                    | ⚠️ 内部调 `checklistWirePassed(session_id)` —— F-I |
| `compliance_gate_submit_deliverables`  | ~2032 | 读取 gate session 状态 → 写 DB                        | ✅                                                 |
| `compliance_gate_approve_deliverables` | ~2925 | 读取 gate session → 审批                              | ⚠️ 审批时需读 HANDOVER——但 agent 身份通过文件解析  |
| `compliance_gate_purge`                | ~2963 | drain 过期 gate session                               | ✅                                                 |
| `compliance_gate_drain_stale`          | ~2972 | 同上                                                  | ✅                                                 |
| `compliance_gate_retry_confirm`        | ~2992 | re-arm gate session                                   | ✅                                                 |
| `checklistWirePassed`                  | ~2536 | **用 Gate session 做 checklist run 查找**             | 🔴 F-I：应传 OpenCode session                      |

#### 8.2.2 `gate-core.ts`（Core Library —— 底层操作）

| 函数                   | 行号    | Gate Session 操作                                     |
| ---------------------- | ------- | ----------------------------------------------------- |
| `generateSessionId()`  | ~780    | 生成 `"cg_ses_" + Date.now()`                         |
| `createSession()`      | 772-802 | 创建 `GateSession` 对象，写 `gate_sessions` DB + JSON |
| `armSession()`         | 808     | 武装 session，验证 DAG context                        |
| `completeSession()`    | 1026    | 完成 session，消费 armed 状态                         |
| `findArmedSession()`   | 698     | 查找当前 armed session                                |
| `loadGateStore()`      | ~620    | **DB 优先 + JSON 回退**加载 gate store                |
| `saveGateStore()`      | —       | 保存 gate store 到 DB                                 |
| `drainStaleSessions()` | —       | 清理过期 session                                      |

#### 8.2.3 `gate-before.ts`（Plugin —— 启动武装 + 运行时阻断）

| 位置                | 行号  | Gate Session 操作                                                    |
| ------------------- | ----- | -------------------------------------------------------------------- |
| module top-level    | 20-43 | 启动时 `createSession` + `armSession` —— 确保 pre-commit hook 不阻塞 |
| `toolExecuteBefore` | 49-50 | 检查 armed session 存在性                                            |

#### 8.2.4 `db-state-manager.ts`（DB 读写层）

| 函数                        | Gate Session 操作                           |
| --------------------------- | ------------------------------------------- |
| `dbLoadGateStore()`         | 从 `gate_sessions` 表读取全部 session       |
| `dbSaveGateStore()`         | 写入/更新 `gate_sessions` 表                |
| `dbArchiveDrainedSession()` | 将过期 session 迁到 `gate_drained_sessions` |
| `dbCountDrainedSessions()`  | 统计已清理 session 数                       |

#### 8.2.5 `approval-read-context.ts`（审批上下文桥接）

| 函数                     | 用途                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- |
| `writeApprovalContext()` | 将 `gate_session_id` → `opencode_session_id` 映射写入 `approval_read_context` 表 |
| `readApprovalContext()`  | 审批时通过 gate session 反查 OpenCode session                                    |

#### 8.2.6 `dispatch-before.ts`（Plugin —— 查询 armed session）

| 位置                | 行号    | Gate Session 操作                                                                  |
| ------------------- | ------- | ---------------------------------------------------------------------------------- |
| `toolExecuteBefore` | 230-240 | `SELECT session_id FROM gate_sessions WHERE status = ?` 检查是否存在 armed session |

#### 8.2.7 `pre-execution-gate.ts`（Pre-commit Hook）

| 函数                   | Gate Session 操作                             |
| ---------------------- | --------------------------------------------- |
| `checkGateLifecycle()` | 验证 DAG task 是否有匹配的 armed gate session |
| `loadGateStore()` 调用 | 从 DB 读取 gate sessions 用于校验             |

#### 8.2.8 `hook-layers.ts`（Git Hook）

| 位置    | Gate Session 操作                           |
| ------- | ------------------------------------------- |
| Layer 0 | 检查是否有 armed gate session——无则阻断提交 |

---

### 8.3 Gate Session 相关 DB 表

| 表                      | 主键                            | 用途                                 |
| ----------------------- | ------------------------------- | ------------------------------------ |
| `gate_sessions`         | `session_id`                    | Gate session 主存储（`cg_ses_*`）    |
| `gate_drained_sessions` | `session_id`                    | 已清理/过期的 gate session 归档      |
| `gate_session_index`    | —                               | Gate session 索引                    |
| `gate_store_meta`       | —                               | Gate store 元数据                    |
| `gate_audit_history`    | —                               | Gate 审计历史                        |
| `gate_compactor_index`  | —                               | Gate 压缩索引                        |
| `approval_read_context` | `gate_session_id` + `args_hash` | Gate session → OpenCode session 映射 |

---

### 8.4 Gate Session 与 OpenCode Session 的交叉点

#### 交叉点 1：F-I —— `checklistWirePassed`

```typescript
// compliance-gate.ts (MCP Server 进程)
// completeSession 内部调用
checklistWirePassed(gateSessionId, "compliance_gate_complete", { ... });
// gateSessionId = "cg_ses_1782187868025"

// execution-checklist.ts
// 用 gateSessionId 查 execution_checklist_runs
// WHERE opencode_session_id = "cg_ses_1782187868025"
// → 找不到任何 run（因为 run 用 OpenCode session "ses_*" 创建）
// → facts 写到 null run 或者错误的 run
```

#### 交叉点 2：`approval-read-context.ts` —— 有意设计的桥接

```typescript
// compliance-gate.ts approve_deliverables 中:
writeApprovalContext({
    gate_session_id: "cg_ses_xxx",      // Gate session
    opencode_session_id: "ses_yyy",     // OpenCode session（从 args 获取）
    ...
});

// 审批者 read_before_approve 验证时:
const ctx = readApprovalContext("cg_ses_xxx", argsHash);
// → 获取 opencode_session_id = "ses_yyy"
// → 用 OpenCode session 查询 read_audit 表
```

#### 交叉点 3：`gate-before.ts` —— 同一文件两种 session

```typescript
// 模块顶层（启动时）
createSession(...)           // → 生成 Gate session
armSession(session.session_id, ...)  // → 操作 Gate session

// toolExecuteBefore（运行时）
const agent = resolveAgent(input.sessionID);  // ← OpenCode session!
const taskId = resolveTaskId(input.sessionID); // ← OpenCode session!
```

---

### 8.5 Gate Session 的 JSON 存储（已废弃方向）

`gate-core.ts:620` 的 `loadGateStore()` 采用 **DB 优先 + JSON 回退**：

```typescript
function loadGateStore(root?: string): GateStore {
  // 1. 尝试从 DB gate_sessions 表加载
  const dbStore = dbLoadGateStore();
  if (dbStore) return dbStore;

  // 2. 回退到 gate-state.json 文件（冻结快照）
  return loadGateStoreFromFile(root);
}
```

`gate-state.json` 文件是 P2-A Step 8 迁移前的主存储，现已降级为只读回退。

---

### 8.6 问题汇总

| #       | 位置                                         | 问题                                                                                        | 严重度 | 修复方案                                                       |
| ------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| **F-I** | `compliance-gate.ts` → `checklistWirePassed` | Gate session 传入 OpenCode session 期望的函数                                               | 🔴     | 传 OpenCode session（通过 args 或 approval_read_context 解析） |
| **G2**  | `compliance-gate.ts`                         | MCP server 独立进程无 `input.sessionID`，只能通过文件/DB 间接获取 agent 和 OpenCode session | 🟡     | 在 gate 操作 args 中显式传递 `opencode_session_id`             |
| **G3**  | `gate-before.ts:20-50`                       | 模块顶层和 `toolExecuteBefore` 用不同 session 类型（Gate vs OpenCode）                      | 🟡     | 拆分文件或明确注释                                             |
| **G4**  | `approval-read-context.ts`                   | 需要额外 DB 表来桥接 Gate↔OpenCode session——增加了复杂度                                    | 🟢     | 当前 workaround 可用，但应成为 gate session 结构的一部分       |
| **G5**  | `gate-state.json`                            | JSON 文件仍作为 DB 回退——可能读到过期数据                                                   | 🟡     | 移除 JSON 回退路径（Phase 3）                                  |
