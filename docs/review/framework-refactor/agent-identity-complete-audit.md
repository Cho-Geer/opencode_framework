# Agent Identity 全量审计

**版本**: v1.0.0  
**调查日期**: 2026-06-23  
**调查 Agent**: @Super-Admin  
**状态**: 调查完成  
**范围**: `.opencode/` 框架全部 TS 文件（~80 个模块）  
**来源**: `parameter-name-confusion-audit.md` §3 — 7 种 agent 写法

---

## §1 Agent 标识的 7+ 种写法（扩展版）

审计发现 **11 种**不同写法，远多于原先估计的 7 种：

### 1.1 主要变量名/键名

| #   | 写法                            | 出现位置                                  | 语义                | 示例                                                    |
| --- | ------------------------------- | ----------------------------------------- | ------------------- | ------------------------------------------------------- |
| 1   | `agent`                         | Plugin hook input, DB 列, 函数参数        | 通用 agent 身份     | `input.agent`, `session_map.agent`, `resolveAgent(sid)` |
| 2   | `agentType`                     | Plugin 内部变量, 日志 key, dispatch 队列  | `agent` 的别名      | `const agentType = agent \|\| "unknown"`                |
| 3   | `agent_type`                    | dispatch args, DB 列, 队列列              | snake_case 版 agent | `args.agent_type`, `dispatch_queue.agent_type`          |
| 4   | `agentRef`                      | UC7KS 工具（normalizeAgentKey 后）        | 规范化后引用        | `var agentRef = normalizeAgentKey(agent)`               |
| 5   | `agentKey`                      | UC7KS schema 函数参数                     | schema 内部 key     | `normalizeAgentKey(agent)`                              |
| 6   | `agentName`                     | framework-doctor, 循环变量                | agent 注册名        | `agent_registry_snapshot.agent_name`                    |
| 7   | `rawAgent`                      | UC7KS plugin 临时变量                     | 未规范化的原始值    | `const rawAgent = resolveAgent(sid)`                    |
| 8   | `normAgent` / `normalizedAgent` | normalizeAgent 结果                       | @去前缀+小写        | `normalizeAgent(agent)`                                 |
| 9   | `agentNorm`                     | scope-before, uc7ks-utils, exec-checklist | 同 normalizedAgent  | `(agent \|\| "").toLowerCase().replace(/^@/, "")`       |
| 10  | `resolvedAgent`                 | compliance-gate MCP server                | 解析后的 agent      | `const resolvedAgent = resolveAgent(sid)`               |
| 11  | `FRAMEWORK_AGENT`               | env var（v4.0.0 deprecated）              | 环境变量传播        | `process.env.FRAMEWORK_AGENT`                           |

### 1.2 出现频次统计

| 写法                      | 文件数 | 典型模块                                              |
| ------------------------- | ------ | ----------------------------------------------------- |
| `agent`                   | 30+    | 所有 plugins, tools, lib                              |
| `agentType`               | 15+    | dispatch, checklist, task-before/after                |
| `agent_type`              | 8      | DB tables, dispatch_subagent args                     |
| `agentRef` / `agentKey`   | 4      | UC7KS tools, schema                                   |
| `agentNorm` / `normAgent` | 6      | scope, read-audit, dag-policy, uc7ks                  |
| `resolvedAgent`           | 1      | compliance-gate.ts                                    |
| `FRAMEWORK_AGENT`         | 3      | question-policy-before, log-manager, code-quality-lib |

---

## §2 Agent 解析路径

### 2.1 核心函数：`resolveAgent(sessionID)`

**文件**: `lib/agent-resolver.ts` L102

```
Priority 1: session_map DB → resolveAgentFromSessionMap(sessionID)
            └─ dbReadSessionMap(sessionID).agent
            └─ 添加 "@" 前缀（如缺失）

Priority 2: _dispatch_target.json → 共享文件，TOCTOU 风险
            └─ run_id 比对 + 30min 超时保护

Priority 3: "" (空字符串 — agent 未识别)
```

**调用者**: 16 个 plugins + 1 个 MCP server（compliance-gate.ts）

### 2.2 DB 直接查询：`resolveAgentFromSessionMap(sessionID)`

**文件**: `lib/agent-resolver.ts` L86  
**DB**: `SELECT agent FROM session_map WHERE session_id = ?`

### 2.3 DNS 反向查：`resolveLatestDispatchAgent(taskId)`

**文件**: `lib/agent-resolver.ts` L678  
**用途**: compliance-gate 无需 session 即可从 `dag_task_id` 反向查 agent 身份

### 2.4 dispatch_subagent 内联解析

在 `tools/dispatch_subagent.ts` 中：

```typescript
const callerAgent = context.agent || ""; // 来自 OpenCode Tool.Context
const caller = context.agent || ""; // 同一值的不同变量名
```

---

## §3 Agent 存储

### 3.1 DB 表

| 表名                         | 列名         | 类型             | 说明                     |
| ---------------------------- | ------------ | ---------------- | ------------------------ |
| `session_map`                | `agent`      | TEXT NOT NULL    | 每 session 的 agent 身份 |
| `dispatch_queue`             | `agent_type` | TEXT NOT NULL    | 队列条目的 agent         |
| `dispatch_context`           | `agent`      | TEXT NOT NULL    | dispatch 上下文          |
| `dispatch_payload_integrity` | `agent_type` | TEXT NOT NULL    | 完整性记录               |
| `dispatch_prompt_refs`       | `agent_type` | TEXT NOT NULL    | prompt 引用              |
| `dispatch_failed_log`        | `agent_type` | TEXT NOT NULL    | 失败记录                 |
| `execution_checklist_runs`   | `agent`      | TEXT NOT NULL    | checklist run            |
| `session_log`                | `agent_type` | TEXT NOT NULL    | session 完成记录         |
| `agent_registry_snapshot`    | `agent_name` | TEXT PRIMARY KEY | agent 注册快照           |

**问题**: 5 张表用 `agent_type`，3 张表用 `agent`，1 张表用 `agent_name`，无一致性。

### 3.2 JSON 文件

| 文件                    | 路径                    | 字段                                       |
| ----------------------- | ----------------------- | ------------------------------------------ |
| `gate-state.json`       | `.opencode/state/`      | `sessions[id].agent`                       |
| `machine.json`          | `.opencode/state/`      | `auto_plan_history[].caller_agent`         |
| `knowledge_cache_state` | 子状态                  | `session_access[agentKey].pipeline_status` |
| `_dispatch_target.json` | `.task_temp/`           | `{ agent, run_id }`                        |
| `.dispatch_ctx`         | `.task_temp/_dispatch/` | `{ dagTaskId, agentType }`                 |

---

## §4 Agent 规范化（7 种不同的 `@` 处理方式）

### 4.1 去 `@` + 小写（最常用）

| 文件                                | 函数/写法                                               | 结果         |
| ----------------------------------- | ------------------------------------------------------- | ------------ |
| `lib/dag-policy.ts` L67             | `String(agent).toLowerCase().replace(/^@/, "")`         | `"coder-be"` |
| `plugins/scope-before.ts` L81       | `(agent \|\| "").toLowerCase().replace(/^@/, "")`       | `"coder-be"` |
| `lib/execution-checklist.ts` L365   | `agent.toLowerCase().replace(/^@/, "")`                 | `"coder-be"` |
| `lib/read-audit.ts` L136            | `(agent \|\| "").replace(/^@/, "").toLowerCase()`       | `"coder-be"` |
| `lib/uc7ks-utils.ts` L434           | `(agent \|\| "").toLowerCase().replace(/^@/, "")`       | `"coder-be"` |
| `plugins/git-guard-before.ts` L89   | `(agent \|\| "").toLowerCase().replace(/^@/, "")`       | `"coder-be"` |
| `scripts/pre-execution-gate.ts` L41 | `String(agent \|\| "").toLowerCase().replace(/^@/, "")` | `"coder-be"` |

总共 **7 个不同文件和位置**实现了完全相同的逻辑。

### 4.2 添加 `@` 前缀

| 文件                         | 函数/写法                                       | 结果          |
| ---------------------------- | ----------------------------------------------- | ------------- |
| `lib/agent-resolver.ts` L125 | `agent.startsWith("@") ? agent : \`@${agent}\`` | `"@Coder-BE"` |
| `lib/tool-scope.ts` L389     | `agent.startsWith("@") ? agent : "@" + agent`   | `"@Coder-BE"` |
| `lib/safe-bash-core.ts` L133 | `agent.startsWith("@") ? agent : "@" + agent`   | `"@Coder-BE"` |

### 4.3 PascalCase 规范化（带映射表）

**`lib/uc7ks-schema.ts` L372 `normalizeAgentKey()`**:

```typescript
// "@coder-be" / "coder-be" / "Coder-BE" → "Coder-BE"
// "plan" → "Meta-Planner" (legacy misnomer)
return map[stripped.toLowerCase()] || stripped;
```

这是**唯一**使用硬编码 10-agent 映射表的函数。

### 4.4 DB SQL 层规范化

**`execution-checklist.ts` L372**:

```sql
WHERE dag_task_id = ? AND lower(replace(agent_type, '@', '')) = ?
```

直接在 SQL 中用 `lower(replace(...))` 做规范化——这是唯一的 SQL 层 agent 规范化。

---

## §5 Agent 在权限/范围系统

### 5.1 写范围（Write Scope）

**文件**: `plugins/scope-before.ts`

- `ROUTE-MISMATCH`: agent 写禁止路径 → 自动路由到正确 agent
- `WRITE-SCOPE`: agent 写范围外文件 → 阻断
- `UC7-001-WRITE`: agent 未完成知识缓存 → 阻断

### 5.2 工具权限

**文件**: `lib/permission-reader.ts`

- 通过 `opencode.json` 中的 `agent_overrides` 查询 per-agent 工具权限
- agent 名需要匹配 `opencode.json` 中的 key

### 5.3 MCP 工具权限

**文件**: `lib/tool-scope.ts`

- `safe_shell` 白名单命令按 agent 区分

### 5.4 路由规则

**文件**: `lib/route-validator.ts`

- `agent_domain_map`: agent → domain 映射
- `route_rules`: agent → scope → expected agent 路由矩阵

---

## §6 Agent 在 Gate Session 中

### 6.1 Gate session 的 agent 字段

**文件**: `lib/gate-core.ts`  
**字段**: `GateSession.agent` — 在 `armGateSession()` 时设置  
**来源**: `args.agent`（MCP 工具参数，由子 agent 传入）

### 6.2 Compliance Gate agent 验证

**文件**: `scripts/mcp-tools/compliance-gate.ts`

- `ALLOWED_APPROVE_AGENTS`: `["@Orchestrator", "@Super-Admin"]` — 只有这两个 agent 可审批
- `ALLOWED_RETRY_AGENTS`: 同上
- `resolveStandaloneAgent(taskId)`: 独立 agent 解析（不依赖 session）

### 6.3 Agent 豁免

**文件**: `lib/dag-policy.ts`  
**列表**: `DAG_EXEMPT_AGENTS = ["meta-planner", "orchestrator", "super-admin", "knowledge-curator"]`  
**注意**: 使用小写无 `@` 前缀格式

---

## §7 Agent 在 Dispatch 中

### 7.1 dispatch_subagent 工具参数

**文件**: `tools/dispatch_subagent.ts`

- `args.agent_type`: 用户传入的目标 agent（如 `"Coder-BE"` 或 `"@Coder-BE"`）
- `context.agent`: OpenCode Tool.Context 的调用者 agent

### 7.2 dispatch queue

**文件**: `lib/dispatch-db.ts`

- `DispatchQueueEntry.agent_type`: 队列中的 agent 类型
- dedup key: `agentType + dagTaskId`

### 7.3 Task() 调用

**文件**: `plugins/task-before.ts`

- `subagent_type`: `Task()` 工具的目标 agent 类型
- 与 dispatch queue 中的 `agentType` 交叉验证

---

## §8 Agent 在 Logging 中

### 8.1 writeLog 的 agent 字段

30+ 个模块在 `writeLog` 中传递 agent 字段，形式包括：

- `{ agent: resolvedAgent }` — 最常见
- `{ agentType: agent }` — 冗余（值与 agent 相同但 key 不同）
- `{ agent, agentType: agent }` — **双重写入**（同一值写两个 key）

### 8.2 log-manager 的 agent fallback

**文件**: `lib/log-manager.ts` L360:

```typescript
fields.agent || process.env.FRAMEWORK_AGENT || "—";
```

---

## §9 FRAMEWORK_AGENT 废弃状态

### 9.1 声明已废弃（v4.0.0）

| 文件                                   | 状态                |
| -------------------------------------- | ------------------- |
| `tools/dispatch_subagent.ts`           | 注释声明 deprecated |
| `tools/safe_shell.ts`                  | 注释声明 deprecated |
| `lib/safe-bash-core.ts`                | 注释声明 deprecated |
| `lib/code-quality-lib.ts`              | 注释声明 deprecated |
| `scripts/mcp-tools/compliance-gate.ts` | 注释声明 deprecated |

### 9.2 但仍在读取

| 文件                                    | 使用                                                                |
| --------------------------------------- | ------------------------------------------------------------------- |
| `plugins/question-policy-before.ts` L92 | `resolveAgent(sid) \|\| process.env.FRAMEWORK_AGENT \|\| "unknown"` |
| `lib/log-manager.ts` L360               | `fields.agent \|\| process.env.FRAMEWORK_AGENT \|\| "—"`            |
| `scripts/pre-execution-gate.ts` L367    | `readDispatchTargetAgent() \|\| process.env.AGENT \|\| ""`          |

`question-policy-before.ts` 的 fallback 尤其关键——它是 non-dispatched primary session（Orchestrator/Super-Admin）agent 解析的唯一路径。

---

## §10 混淆点与问题

### I1: `agent` vs `agentType` 双重写入（HIGH）

**30+ 个模块**在同一个 `writeLog` 调用中同时写 `agent` 和 `agentType`，且值完全相同：

```typescript
writeLog("mod", "INFO", {
  agent: resolvedAgent,      // "@Coder-BE"
  agentType: resolvedAgent,  // "@Coder-BE" — 冗余
  ...
});
```

两者用途相同，纯冗余。应统一为 `agent`。

### I2: 7 个地方实现了相同的 `@` 去除+小写逻辑（HIGH）

```typescript
// 7 个文件各自实现，无共享函数：
(agent || "").toLowerCase().replace(/^@/, "");
```

应通过 `lib/read-audit.ts` 的 `normalizeAgent()` 统一导出。

### I3: `normalizeAgent` vs `normalizeAgentKey` 行为不同（MED）

| 函数                | 文件              | 输入 `@Coder-BE` | 输入 `coder-be` |
| ------------------- | ----------------- | ---------------- | --------------- |
| `normalizeAgent`    | `read-audit.ts`   | `"coder-be"`     | `"coder-be"`    |
| `normalizeAgentKey` | `uc7ks-schema.ts` | `"Coder-BE"`     | `"Coder-BE"`    |

一个返回小写，一个返回 PascalCase。同名不同义。

### I4: Agent 不在 session_map 时的空 fallback（MED）

`resolveAgent(sid)` 当 session 未映射时返回 `""`（空字符串）。但多个调用者做了不同的 fallback：

- `scope-before.ts`: `(agent || "").toLowerCase().replace(...)` → `""`（跳过检查）
- `question-policy-before.ts`: `resolveAgent(sid) || process.env.FRAMEWORK_AGENT || "unknown"`
- `task-before.ts`: `resolveAgent(sid) || "unknown"`

空 agent 的行为不一致：有的跳过检查，有的用 env 回退，有的用 `"unknown"`。

### I5: DB 列命名不一致（LOW）

| 表                         | 列           |
| -------------------------- | ------------ |
| `session_map`              | `agent`      |
| `dispatch_queue`           | `agent_type` |
| `execution_checklist_runs` | `agent`      |
| `agent_registry_snapshot`  | `agent_name` |

同一概念三种列名。应统一为 `agent`。

### I6: `FRAMEWORK_AGENT` 声称废弃但 3 个文件仍在使用（LOW）

实际废弃不完整——`question-policy-before.ts` 和 `log-manager.ts` 仍依赖它作为 primary session agent 解析的后备路径。

### I7: `resolveAgent` 对 DB agent 值加 `@`，但 session_map 已存储 `@` 前缀（LOW）

`agent-resolver.ts` L125: `return agent.startsWith("@") ? agent : \`@${agent}\``但`session.ts`plugin 写入的是`input.agent`（来自 OpenCode hook，已带 `@`），所以 `@`前缀检查通常跳过。这是防御性代码，但可能掩盖写入路径中`@` 前缀缺失的 bug。

---

## §11 建议

### 短期

1. **统一 `normalizeAgent` 导出**：所有 7 个位置的 `@` 去除+小写替换为共享 `normalizeAgent(agent)` 调用
2. **消除 `agent`/`agentType` 双重写入**：日志中统一使用 `agent`

### 中期

3. **DB 列统一**：`agent_type` → `agent`（通过 migration）
4. **`FRAMEWORK_AGENT` 彻底移除**：`question-policy-before.ts` 改为 session_map 或其他解析路径

### 长期

5. **Agent 类型系统**：定义 branded type `AgentId`，编译时区分 `@` 前缀版本和无前缀版本
6. **Agent 规范化单例**：合并 `normalizeAgent` 和 `normalizeAgentKey` 为统一 API

---

## §12 相关文档

| 文档                                | 关系                                         |
| ----------------------------------- | -------------------------------------------- |
| `parameter-name-confusion-audit.md` | 参数名混淆全量（§3 为本文来源）              |
| `session-usage-audit.md`            | Session 双路径审计（agent 解析依赖 session） |
| `task-id-duality-complete-audit.md` | Task ID 双重语义审计                         |
| `gate-session-rename-plan.md`       | Gate session 重命名                          |
| `.opencode/lib/agent-resolver.ts`   | Agent 解析核心实现                           |

---

## §13 实施记录

### 13.1 `agent`/`agentType` 双重写入消除

| 操作                                    | 文件数 | 变更数 |
| --------------------------------------- | ------ | ------ |
| `agent, agentType: agent,` → `agent,`   | 7      | 27     |
| `agentType: agent,` → `agent,` (sed)    | 15+    | 67     |
| `agentType: caller,` → `agent: caller,` | 1      | 19     |
| 重复 `resolveAgent` 调用消除            | 1      | 1      |
| 函数参数 `agentType` → `agent`          | 1      | 2      |

### 13.2 保留的 `agentType`

DB 列映射的 TypeScript 类型/参数保持 `agentType`（→ `agent_type`）。

### 13.3 效果

- **116 处冗余 log key 消除**
- 语境用 `agent`，DB 用 `agent_type`

---

_审计 v1.1.0_
