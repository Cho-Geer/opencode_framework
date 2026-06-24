# Task ID Duality 全量审计

**版本**: v1.0.0  
**调查日期**: 2026-06-23  
**调查 Agent**: @Super-Admin  
**状态**: 调查完成  
**范围**: `.opencode/` 框架全部 TS 文件（~80 个模块）

---

## §1 两个 Task ID 概念

本框架中存在**两个截然不同的 task_id 概念**，同名异义且在高频交互中共享同一变量名 `taskId`/`task_id`/`dag_task_id`。

### 1.1 DAG Task ID（项目工作单元标识符）

**定义**: 在 `Task.DAG.json` 中定义的工作单元的唯一标识符。  
**来源**: @Meta-Planner 生成，写入 `Task.DAG.json` 的 `tasks[].id` 或 `execution_order` 组。  
**示例**: `PLUGIN-VFY-LOAD`, `GAP-FIX-ALL-001`, `T001`, `GH-WORKFLOW-01`  
**特点**:

- 全局唯一，不可重复使用
- 有 `status` 字段（`pending` / `in_progress` / `completed` / `skipped`）
- 有 `agent`、`dependencies`、`target_files` 等元数据
- 代表一个有明确范围和交付物的工作单元

### 1.2 OpenCode Upstream Task ID（会话标识符）

**定义**: OpenCode 上游运行时 `Task()` 工具创建的 sub-agent session 的标识符。  
**来源**: OpenCode 框架在 `Task(subagent_type, prompt, task_id)` 调用时自动分配或由调用者指定。  
**示例**: 由 OpenCode 框架内部管理（`ses_xxx` 格式的 session ID）  
**特点**:

- 每个 `Task()` 调用创建一个新 session
- session 有独立的上下文窗口
- session 之间通过 HANDOVER.md 传递上下文
- 同一个 DAG task 可能被多次 dispatch（产生多个 OpenCode session）

---

## §2 完整使用点清单

### 2.1 使用 `dag_task_id` 的文件（纯 DAG 语义）

| #   | 文件                                         | 关键行            | 语义             | 说明                                                          |
| --- | -------------------------------------------- | ----------------- | ---------------- | ------------------------------------------------------------- |
| 1   | `tools/dispatch_subagent.ts`                 | L215-223          | **双重语义**     | DAG audit + output 路径。`dag_task_id` 是 MCP 参数名          |
| 2   | `lib/dag-policy.ts`                          | L65-68            | DAG 豁免         | `isDagExempt()` 判断 agent 是否无需 DAG entry                 |
| 3   | `lib/dag-policy.ts`                          | L198              | auto_plan 记录   | `AutoPlanRecord.dag_task_id` 记录自愈调度                     |
| 4   | `lib/gate-checks.ts`                         | L93-148           | DAG 查找         | `findTaskInDag(taskId)` 在 `tasks[]`+`execution_order` 中搜索 |
| 5   | `plugins/dispatch-before.ts`                 | L50, L166-440     | DAG 校验         | Layer 1 PLAN-FIRST 拦截，检查 `dag_task_id` 是否在 DAG 中     |
| 6   | `plugins/gate-before.ts`                     | L149-204          | DAG 校验         | P2-1 Layer 3 写操作前 DAG task 存在性检查                     |
| 7   | `plugins/task-after.ts`                      | L182-300          | dispatch 完成    | 读取 ctx/ 文件获取 `dagTaskId`，写入 `session_log`            |
| 8   | `plugins/task-before.ts`                     | L344              | dispatch 队列    | `dagTaskId` 用于 lease 匹配                                   |
| 9   | `plugins/session.ts`                         | L80-122           | 会话映射         | 从 `session_map` 读取 `dag_task_id` 写入 session→agent 映射   |
| 10  | `plugins/checklist-before.ts`                | L182, L338-430    | checklist 桥接   | `dag_task_id` 用于父/子 session 继承                          |
| 11  | `scripts/command-tools/dispatch-subagent.ts` | L86-133, L684-753 | dispatch 生成    | `dag_task_id` 写入 `.dispatch_ctx` 和 `ctx/` 文件             |
| 12  | `scripts/pre-execution-gate.ts`              | L363-424          | DAG coverage     | `checkDagCoverage(taskId)` 检查 task 是否在 DAG 中            |
| 13  | `scripts/mcp-tools/compliance-gate.ts`       | L791-930          | task 完整性      | 从 `session_map` 读取 `dag_task_id` 验证 gate 会话            |
| 14  | `scripts/state-integrity-scan.ts`            | L291-317          | orphan 检测      | 比对 `auto_plan_history.dag_task_id` 与 DAG                   |
| 15  | `lib/db-manager.ts`                          | L583-602          | DB 迁移 v8       | `ALTER TABLE session_map ADD COLUMN dag_task_id`              |
| 16  | `lib/db-state-manager.ts`                    | L1353-1397        | session_log CRUD | `dbAppendSessionLog`/`dbQueryLatestSessionByDagTaskId`        |
| 17  | `lib/dispatch-db.ts`                         | L49               | dispatch 队列    | `DispatchQueueEntry.dag_task_id`                              |
| 18  | `lib/execution-checklist.ts`                 | L107, L372, L1014 | payload 完整性   | `DispatchPayloadIntegrityInput.dag_task_id`                   |
| 19  | `lib/agent-resolver.ts`                      | L329-400          | 解析优先级       | `resolveTaskIdWithSource()` 从多源解析 dag_task_id            |
| 20  | `lib/uc7ks-utils.ts`                         | L748-767          | 知识管道         | 从 `session_map.dag_task_id` 和 `gate_sessions.task_id` 解析  |
| 21  | `tools/resolve_domain_id.ts`                 | L36-52            | domain 解析      | 通过 `dag_task_id` 反向查找 `session_id`                      |
| 22  | `scripts/state-reconciliation.ts`            | L210-607          | 状态同步         | 比对 gate session 与 DAG task 状态                            |

### 2.2 使用 `task_id`（语义不确定的文件）

| #   | 文件                                   | 字段/变量名                        | 实际语义        | 说明                                      |
| --- | -------------------------------------- | ---------------------------------- | --------------- | ----------------------------------------- |
| 1   | `lib/gate-core.ts`                     | `GateSession.task_id`              | **DAG task_id** | Gate 会话可选的 task 关联                 |
| 2   | `gate-state.json`                      | `sessions[id].task_id`             | **DAG task_id** | 存储 gate session 关联的 DAG task         |
| 3   | `lib/db-manager.ts`                    | `execution_checklist_runs.task_id` | **DAG task_id** | checklist run 关联的 DAG task             |
| 4   | `tools/knowledge_cache_search.ts`      | `args.task_id`                     | **DAG task_id** | 描述为 "DAG task ID for session tracking" |
| 5   | `tools/knowledge_cache_attest.ts`      | `args.task_id`                     | **DAG task_id** | 无明确描述                                |
| 6   | `tools/checklist_status.ts`            | `args.task_id`                     | **DAG task_id** | 用于 checklist run 查询                   |
| 7   | `tools/advance_checklist_phase.ts`     | `args.task_id`                     | **DAG task_id** | 无明确描述                                |
| 8   | `tools/module_scope_declare.ts`        | `args.task_id`                     | **DAG task_id** | 描述为 "DAG task ID for session tracking" |
| 9   | `tools/config_read_attest.ts`          | `args.task_id`                     | **DAG task_id** | 无明确描述                                |
| 10  | `scripts/mcp-tools/compliance-gate.ts` | `args.task_id`                     | **DAG task_id** | gate check 的可选 task_id 参数            |
| 11  | `lib/execution-checklist.ts`           | `input.task_id`                    | **DAG task_id** | 从 args 或 dispatch_payload 继承          |
| 12  | `lib/db-state-manager.ts`              | `session_log.dag_task_id`          | **DAG task_id** | 列名正确使用 `dag_` 前缀                  |
| 13  | `lib/read-audit.ts`                    | `row.task_id`                      | **DAG task_id** | read_audit DB 中的 task 列                |
| 14  | `lib/state-compactor.ts`               | `session.task_id`                  | **DAG task_id** | gate session 序列化                       |

### 2.3 与 OpenCode Upstream Task 交互的文件

| #   | 文件                         | 关键行   | 语义              | 说明                                         |
| --- | ---------------------------- | -------- | ----------------- | -------------------------------------------- |
| 1   | `tools/dispatch_subagent.ts` | L242-248 | `Task() task_id`  | `resume_session_id` 回传给 OpenCode `Task()` |
| 2   | `plugins/task-before.ts`     | L35-42   | `Task()` 拦截     | 验证 `Task()` 调用带 DISPATCH_TOKEN          |
| 3   | `plugins/task-after.ts`      | L26-56   | `Task()` 完成     | `Task()` 完成后记录 dispatch 结果            |
| 4   | `plugins/dispatch-auto.ts`   | L4-140   | `Task()` 调用检测 | 检测 LLM 是否正确调用了 `Task()`             |
| 5   | `plugins/dispatch-after.ts`  | L17-56   | dispatch 完成     | 追踪 `Task()` 调用的完成                     |

### 2.4 同时出现两类 task_id 的文件（混淆热点）

| #   | 文件                                         | 混淆说明                                                                                                                                  |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `tools/dispatch_subagent.ts`                 | `dag_task_id`（MCP 参数，DAG 语义）→ 传给 `Task()` 的 `task_id` 参数（OpenCode 语义）时语义转换                                           |
| 2   | `plugins/session.ts`                         | 从 `session_map.dag_task_id` 读取（DAG 语义），写入 `execution_checklist_runs.task_id`（也是 DAG 语义），但 `session_id` 是 OpenCode 概念 |
| 3   | `lib/execution-checklist.ts`                 | `inheritDispatchPayloadItems()` 用 `taskId` 同时指代 DAG task_id 和 checklist task_id                                                     |
| 4   | `scripts/command-tools/dispatch-subagent.ts` | `taskId` 变量在不同上下文中有不同含义：CLI arg 是 DAG task_id，但传给 `Task()` 时是 OpenCode task_id                                      |
| 5   | `scripts/mcp-tools/compliance-gate.ts`       | `session.task_id` 是 DAG task_id，但 `args.task_id` 参数同时用于 gate check 和 checklist                                                  |

---

## §3 存储层全景

### 3.1 DB 表

| 表名                         | 列名                  | 语义                          |
| ---------------------------- | --------------------- | ----------------------------- |
| `session_map`                | `dag_task_id`         | ✅ 明确 DAG 语义              |
| `session_map`                | `session_id`          | OpenCode session ID           |
| `session_log`                | `dag_task_id`         | ✅ 明确 DAG 语义              |
| `session_log`                | `session_id`          | OpenCode session ID           |
| `dispatch_queue`             | `dag_task_id`         | ✅ 明确 DAG 语义              |
| `dispatch_payload_integrity` | `dag_task_id`         | ✅ 明确 DAG 语义              |
| `execution_checklist_runs`   | `task_id`             | ⚠️ 无前缀，实际存 DAG task_id |
| `execution_checklist_runs`   | `opencode_session_id` | OpenCode session              |
| `dispatch_prompt_refs`       | `dag_task_id`         | ✅ 明确 DAG 语义              |
| `read_audit_log`             | `task_id`             | ⚠️ 无前缀，实际存 DAG task_id |

### 3.2 JSON 文件

| 文件                   | 路径                        | 语义                                       |
| ---------------------- | --------------------------- | ------------------------------------------ |
| `Task.DAG.json`        | 项目根                      | `tasks[].id` 是 DAG task_id（权威来源）    |
| `gate-state.json`      | `.opencode/state/`          | `sessions[id].task_id` 是 DAG task_id      |
| `machine.json`         | `.opencode/state/`          | `auto_plan_history[].dag_task_id` 明确 DAG |
| `.dispatch_ctx`        | `.task_temp/_dispatch/`     | `dagTaskId` 字段是 DAG task_id             |
| `ctx/{dagTaskId}.json` | `.task_temp/_dispatch/ctx/` | 文件名即 DAG task_id                       |

---

## §4 解析路径

### 4.1 主子 task_id 解析优先级（`agent-resolver.ts`）

```
Priority 1:  session_map.dag_task_id   (per-session exact match, immune to race)
Priority 1.5: dispatch:child:{dagTaskId} synthetic slot (child session pre-write)
Priority 2:  ctx/{dagTaskId}.json files (per-dispatch, race-free)
Priority 3:  .dispatch_ctx legacy file  (shared singleton, TOCTOU-prone)
```

### 4.2 Gate task_id 完整性检查（`gate-core.ts`）

```
Phase check:  session_map DB → anyRegistered
Phase arm:    session_map DB → dispatchAssignedTaskIds → validate
              如果 taskId 不在 dispatchAssignedTaskIds 中 → 拒绝 arming
```

### 4.3 DAG 查找（`gate-checks.ts` `findTaskInDag()`）

```
1) dag.tasks[] scan → 返回真实 status
2) dag.execution_order scan → status="pending" (推断)
3) 两者都无 → not found
```

---

## §5 Gate 校验矩阵

| Layer    | 文件                         | 检查内容                                | task_id 来源               | 阻断条件                                      |
| -------- | ---------------------------- | --------------------------------------- | -------------------------- | --------------------------------------------- |
| L1       | `dispatch-before.ts`         | PLAN-FIRST：`dag_task_id` 必须在 DAG 中 | `args.dag_task_id`         | `require_dag_entry=true`                      |
| L2       | `tools/dispatch_subagent.ts` | PLAN-FIRST：dispatch 前 DAG 存在性      | `args.dag_task_id`         | `require_dag_entry=true`（含 auto_plan 自愈） |
| L3       | `plugins/gate-before.ts`     | P2-1：写操作前 DAG task 存在性          | `resolveTaskId(sessionID)` | `require_dag_entry=true`                      |
| Pre-exec | `pre-execution-gate.ts`      | DAG Coverage：task 在 DAG 中且 pending  | CLI `--task-id`            | strict/locked 模式                            |
| Arm      | `gate-core.ts`               | dispatch context 完整性                 | `session_map.dag_task_id`  | strict/locked 模式                            |

---

## §6 混淆点与风险

### 6.1 关键混淆：`dispatch_subagent` 的双重语义

`dispatch_subagent` 工具的 `dag_task_id` 参数具有**正式定义的双重语义**：

```
(a) Output/audit: .task_temp/{dag_task_id}/ 路径命名空间
(b) DAG audit: gate-before P2-1 将其视为 DAG task ID 并在 Task.DAG.json 中校验
```

**风险**: 如果 Orchestrator 传入一个纯 dispatch session ID（不是 DAG task），gate-before L3 可能在 strict/locked 模式下错误阻断。

### 6.2 `args.task_id` 的无前缀命名

6 个自定义工具使用 `args.task_id`（无 `dag_` 前缀），但在语义上全部指代 DAG task_id：

- `module_scope_declare` — 明确写 "DAG task ID for session tracking"
- `knowledge_cache_search` — 明确写 "DAG task ID for session tracking"
- `knowledge_cache_attest`, `checklist_status`, `advance_checklist_phase`, `config_read_attest` — 无明确描述

**风险**: Agent 可能传 OpenCode session ID 而非 DAG task_id，导致 pipeline 链断裂。

### 6.3 DB 列的命名不一致

| 表                         | 列名      | 应命名为      |
| -------------------------- | --------- | ------------- |
| `execution_checklist_runs` | `task_id` | `dag_task_id` |
| `read_audit_log`           | `task_id` | `dag_task_id` |

### 6.4 `gate_sessions.task_id` 语义模糊

`gate-state.json` 中 `sessions[id].task_id` 字段没有 `dag_` 前缀，但实际存储的是 DAG task_id。该字段在 gate-core.ts 中被多处读写，但与 `session_map.dag_task_id` 没有直接同步机制。

### 6.5 `checklist_before` 的 dagTaskId 解析多路径

`plugins/checklist-before.ts` 使用 4 个不同路径解析 `dagTaskId`：

1. `input.args?.task_id || input.args?.dag_task_id`（显式传入）
2. `session_map.dag_task_id`（DB 查询）
3. `ctx/*.json` 文件扫描
4. `dispatch:child:{dagTaskId}` session_map 反向查找

任一失败可能导致子 session 的 dispatch_payload 阶段死锁。

### 6.6 FRAMEWORK_TASK_ID 的残余

虽然 S25-FIX-V4 已从父进程移除 `FRAMEWORK_TASK_ID` 写入（`tools/dispatch_subagent.ts` L324, L367），但仍有引用存在（`lib/agent-resolver.ts` L99）。`dispatch-subagent.ts` 命令行脚本仍读取该环境变量（L86-87）。

---

## §7 流量图

```
dispatch_subagent(dag_task_id="GAP-FIX-001", agent_type="Coder-BE")
│
├─ L2: 检查 dag_task_id 是否在 Task.DAG.json 中
│       └─ auto_plan=true → dispatch @Meta-Planner（如缺失）
│
├─ 写入 ctx/{dagTaskId}.json + .dispatch_ctx
│        └─ dagTaskId="GAP-FIX-001"
│
├─ 写入 session_map: "dispatch:child:GAP-FIX-001"
│        └─ dag_task_id="GAP-FIX-001"
│
├─ 生成 Task() prompt（含 task_id="GAP-FIX-001"）
│        ↓ OpenCode 解释此 task_id 为 upstream task_id
│
├─ task-before: 拦截 Task() 调用，验证 DISPATCH_TOKEN
│
├─ session.ts (chat.message hook):
│    ├─ resolveTaskIdWithSource(sid) → 多路径解析 dagTaskId
│    └─ dbWriteSessionMap(sid, agent, dagTaskId, domainId)
│
├─ task-after.ts:
│    ├─ 读取 .dispatch_ctx → dagTaskId
│    ├─ dbAppendSessionLog(subSessionId, dagTaskId, agentType)
│    └─ 写入到 .task_temp/{dagTaskId}/
│
└─ 子 agent 运行时:
     ├─ module_scope_declare(task_id="GAP-FIX-001") ← DAG task_id
     ├─ knowledge_cache_search(task_id="GAP-FIX-001") ← DAG task_id
     ├─ config_read_attest(task_id="GAP-FIX-001") ← DAG task_id
     └─ gate-before L3: findTaskInDag(taskId) ← 通过 resolveTaskId(sessionID)
            └─ 从 session_map 解析出 "GAP-FIX-001"，在 DAG 中查找
```

---

## §8 发现的问题清单

| #   | 严重性  | 问题                                                                            | 影响                                                    |
| --- | ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| I1  | 🔴 HIGH | `execution_checklist_runs.task_id` 和 `read_audit_log.task_id` 缺少 `dag_` 前缀 | 与其他 `task_id` 概念混淆                               |
| I2  | 🟡 MED  | 6 个自定义工具的 `args.task_id` 无 `dag_` 前缀                                  | Agent 可能误传 OpenCode session ID                      |
| I3  | 🟡 MED  | `gate_sessions.task_id` 与 `session_map.dag_task_id` 无同步机制                 | 两处可能不一致                                          |
| I4  | 🔴 HIGH | `dispatch_subagent` 的 `dag_task_id` 双重语义官方文档化但危险                   | 同一值既用于输出路径又用于 DAG 校验，传错值导致双重错误 |
| I5  | 🟡 MED  | `FRAMEWORK_TASK_ID` env var 仍有 1 处残留读取                                   | 环境变量泄漏可能导致 gate-before 错误的 DAG task 检查   |
| I6  | 🟡 MED  | `checklist-before.ts` 4 路径 dagTaskId 解析无 fallback 优先级定义               | 不同路径可能返回不同的 dagTaskId                        |
| I7  | 🟢 LOW  | `lib/state-compactor.ts` 和 `lib/read-audit.ts` 用 `task_id` 而非 `dag_task_id` | 与其他代码库不一致                                      |

---

## §9 建议

### 9.1 短期（命名统一）

1. **DB 列重命名**（通过 migration v-next）：
   - `execution_checklist_runs.task_id` → `dag_task_id`
   - `read_audit_log.task_id` → `dag_task_id`

2. **自定义工具 schema 更新**：所有 `args.task_id` 参数描述明确声明 "DAG task ID (must exist in Task.DAG.json for non-exempt agents)"

3. **`gate-state.json` 字段注释**：添加明确注释说明 `task_id` 是 DAG task_id

### 9.2 中期（流量分离）

4. **`dispatch_subagent` 拆分**：将双重语义拆为两个独立参数：
   - `dag_task_id`（DAG 校验用，必须存在于 `Task.DAG.json`）
   - `session_namespace`（输出路径用，`.task_temp/{namespace}/`）

5. **`FRAMEWORK_TASK_ID` 彻底移除**：消除最后 1 处 `agent-resolver.ts` 中的残留引用

### 9.3 长期（架构清晰化）

6. **建立 TaskID 类型系统**：在 TypeScript 中定义 branded types：

   ```typescript
   type DagTaskId = string & { readonly __brand: "DagTaskId" };
   type OpenCodeSessionId = string & { readonly __brand: "OpenCodeSessionId" };
   ```

7. **`task_id` → `dag_task_id` 全量重命名**（非 DB 列）：所有 TypeScript 变量、函数参数、JSON 字段统一使用 `dag_task_id` / `dagTaskId`

---

## §10 相关文档

| 文档                                | 关系                                           |
| ----------------------------------- | ---------------------------------------------- |
| `framework-task-id-inventory.md`    | FRAMEWORK_TASK_ID 残留清单（env var 清理专项） |
| `parameter-name-confusion-audit.md` | 参数名混淆全量（含 `task_id`/`dag_task_id`）   |
| `session-usage-audit.md`            | Session 双路径审计                             |
| `e2e-acceptance-final-findings.md`  | F-M 发现：`task_id` fallback 不一致            |
| `gate-session-rename-plan.md`       | Gate session 重命名执行记录                    |

---

## §11 实施记录

### 11.1 `dispatch_subagent` 工具 (`tools/dispatch_subagent.ts`)

| 变更                                                        | 说明                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| ✅ 新增 `session_namespace` 参数                            | OpenCode upstream task_id，用于输出路径。默认 fallback 到 `dag_task_id` |
| ✅ `dag_task_id` 描述更新                                   | 移除双重语义，明确为纯 DAG 审计用途                                     |
| ✅ `dagTaskId`（DAG 校验）与 `sessionNamespace`（路径）分离 | 内部变量语义隔离                                                        |
| ✅ 子进程 env 分离                                          | `DISPATCH_NAMESPACE` + `DISPATCH_DAG_TASK_ID`                           |
| ✅ auto-dispatch queue                                      | 队列条目 `taskId` → `sessionNamespace`                                  |

### 11.2 `dispatch-subagent.ts` 子脚本

| 变更                                             | 说明                      |
| ------------------------------------------------ | ------------------------- |
| ✅ 新增 `sessionNamespace`/`dagTaskId` 变量      | 从 env 解析               |
| ✅ 文件头注释 + CLI 解析                         | 区分两类概念              |
| ✅ pre-execution gate → `sessionNamespace`       | `--dispatch-session` 路径 |
| ✅ preamble/DB/ctx/child-slot/队列 → `dagTaskId` | DAG 语义路径              |
| ⚠️ `taskId` 保留为后向兼容 fallback              | 诊断日志和 legacy 消费者  |

### 11.3 影响

- DAG 校验（LAYER 1/2/3）：不受影响，仍用 `dagTaskId`
- 输出路径：用 `sessionNamespace`（默认 = `dagTaskId`）
- 后向兼容：所有现有调用无需改动

---

_审计 v1.1.0 — 实施 session_namespace/dag_task_id 语义分离。_
