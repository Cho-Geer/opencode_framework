# 框架硬约束状态持久化分析

**版本**: 2.1.0
**最后更新**: 2026-06-26（中断影响专项审核：修正原子性机制描述、补全 combined flow 时序、更新当前孤儿 session 实测数据、发现 GATE-APPROVAL-LOCK BYPASSED 问题）
**定义**: 追踪44项硬约束中哪些会落盘到 framework-state.db 或 JSON 文件，并影响后续会话。

---

## 影响维度

| 维度 | 含义 |
|------|------|
| **落盘** | 写入 framework-state.db 或 machine.json（substate_kv） |
| **跨会话** | 下一轮 Agent 启动时会读取该状态并影响行为 |
| **仅 runtime** | 仅当前进程内存中校验，不持久化 |

---

## 模块1：Write Scope（15项）

**核心文件**: plugins/scope-before.ts, plugins/audit-after.ts, plugins/tdd-after.ts, plugins/scope-after.ts

| ID | 约束 | 持久化位置 | 跨会话? |
|----|------|-----------|:------:|
| WS-8 | Config Read Attestation | substate_kv.config_read_state | YES |
| WS-9 | UC7-001 写前缓存检查 | substate_kv.knowledge_cache_state | YES |
| WS-11 | write-audit 越权 | substate_kv.write_audit_state | YES |
| WS-12 | TDD 违规 | substate_kv.tdd_enforcement_state | YES |
| WS-1~7 | 工具授权/路径权限/ROUTE-MISMATCH | 无（仅运行时校验） | NO |
| WS-10 | 知识缓存>512KiB | 无（仅运行时校验） | NO |
| WS-13 | JSON格式错误 | 无（仅运行时校验） | NO |
| WS-14 | enforcement_mode降级 | 仅校验JSON文件 | NO |
| WS-15 | safe_shell白名单 | 仅校验opencode.json | NO |

**写入路径**:
- audit-after.ts L33: atomicWriteSubState(write_audit_state, ...)
- tdd-after.ts L66: atomicWriteSubState(tdd_enforcement_state, ...)
- uc7ks-after.ts L82: atomicWriteSubState(knowledge_cache_state, ...)
- scope-before.ts 读取校验 substate_kv

---

## 模块2：合规门禁（8项）

**核心文件**: lib/gate-core.ts, scripts/mcp-tools/compliance-gate.ts, plugins/gate-before.ts

| ID | 约束 | 持久化位置 | 跨会话? |
|----|------|-----------|:------:|
| CG-1 | 无armed gate session | gate_sessions 表（主路径 DB-only）/ + gate-state.json（降级路径 writeJson） | YES |
| CG-2 | Task不在DAG | 仅运行时（读取Task.DAG.json） | NO |
| CG-3 | Task状态非pending | 仅运行时 | NO |
| CG-4 | ROUTE-MISMATCH | 仅运行时 | NO |
| CG-5 | READ-BEFORE-APPROVE | read_audit 表（5分钟窗口） | YES |
| CG-6 | 缺declared_deliverables | gate_sessions.declared_deliverables列 | YES |
| CG-7 | GATE-APPROVAL-LOCK | gate_sessions.status=delivered | YES |
| CG-8 | plan_summary<10字符 | 仅运行时 | NO |

**写入路径**:
- gate-core.ts L745-754: saveGateStore() → dbSaveGateStore(gate_sessions表)（DB-only）
- compliance-gate.ts saveStore():
  - 主路径（gate-core可用）: 委托 saveGateStore() → DB-only
  - 降级路径（gate-core不可用）: writeJson() → dbSaveGateStore() + writeFileSync(gate-state.json)
- 每次confirm/submit: checklistWirePassed() → execution_checklist_* 表

---

## 模块3：分发管道（11项）

**核心文件**: plugins/dispatch-before.ts, tools/dispatch_subagent.ts, plugins/task-before.ts, plugins/session.ts

| ID | 约束 | 持久化位置 | 跨会话? |
|----|------|-----------|:------:|
| DP-1~5 | PLAN-FIRST L1+L2 | execution_checklist_runs/items表 | YES |
| DP-6~7 | DISPATCH-INTEGRITY TOKEN | 无（仅哈希校验） | NO |
| DP-8 | DAG_TASK_ID REUSE | dispatch_failed_log表 + .pending.json | YES |
| DP-9 | AUTO-DISPATCH队列 | .task_temp/_dispatch/.pending.json | YES |
| DP-10 | SA仅可dispatch KC | 无（仅运行时校验） | NO |
| DP-11 | 子Agent仅可dispatch KC | 无（仅运行时校验） | NO |

**写入路径**:
- dispatch_subagent.ts L781-801: dbWriteSessionMap(session_map表)
- dispatch_subagent.ts L807-819: dbWriteSessionMap(dispatch:child:{dagTaskId})
- dispatch_subagent.ts L725-763: per-dispatch ctx/{dagTaskId}.json文件
- dispatch-before.ts 读取 session_map 表校验
- session.ts L363: chatMessageHook → dbWriteSessionMap()
- task-before.ts L226: atomicWriteJson(.pending.json 或 .auto-dispatch)
- dispatch-subagent.ts(CLI) L1000-1251: dispatch prompt 文件写入 + .pending.json 读取/写入；session_log 仅查询（L1199 read）

---

## 模块4：UC7KS知识管道（4项）

**核心文件**: lib/uc7ks-utils.ts, plugins/uc7ks-before.ts, plugins/uc7ks-after.ts, plugins/cache-after.ts

| ID | 约束 | 持久化位置 | 跨会话? |
|----|------|-----------|:------:|
| UC-1 | 缓存查询+attest | substate_kv.knowledge_cache_state | YES |
| UC-2 | 外部查询阻断 | 无（仅运行时工具拦截） | NO |
| UC-3 | KC写隔离 | 无（仅运行时路径校验） | NO |
| UC-4 | SA紧急绕行 | 无（仅Gate阶段检查） | NO |

**额外持久化**:
- knowledge_entries / knowledge_files 表（缓存文档索引）| YES |
- uc7ks_pipeline_state 表（管道状态）| YES |
- knowledge_session_access_archive 表（访问归档）| YES |

**写入路径**:
- uc7ks-after.ts L82: atomicWriteSubState(knowledge_cache_state)
- cache-after.ts L72: atomicWriteSubState(knowledge_cache_state)
- knowledge_cache_search/attest 工具: dbWriteSubState() + knowledge_entries表

---

## 模块5：Pre-Commit Hook（6项）

| ID | 约束 | 持久化位置 | 跨会话? |
|----|------|-----------|:------:|
| PC-1~6 | 全部 | 仅读取校验，不写入 | NO |

Hook 是只读校验层，但检查的目标文件由其他模块写入。

---

## 模块6：Pre-Execution Gate（5项）

| ID | 约束 | 持久化位置 | 跨会话? |
|----|------|-----------|:------:|
| PG-1~5 | 全部 | 仅读取校验，不写入 | NO |

---

## 模块7：Question/Sub-Agent交互（3项）

| ID | 约束 | 持久化位置 | 跨会话? |
|----|------|-----------|:------:|
| QA-1~3 | 全部 | 无持久化 | NO |

---

## 模块8：Framework Self-Test（7项）

| ID | 约束 | 持久化位置 | 跨会话? |
|----|------|-----------|:------:|
| ST-1~7 | 全部 | 只读校验，不写入 | NO |

---

## 汇总：跨会话持久化状态全景

```
framework-state.db (SQLite, 36 表)
├── gate_sessions               ← 门禁会话（armed/completed/approval-lock）
├── gate_session_index          ← 门禁会话索引
├── gate_drained_sessions       ← 已排空会话
├── gate_audit_history          ← 门禁审计历史
├── gate_store_meta             ← 门禁存储元数据
├── gate_compactor_index        ← 门禁压缩器索引
├── session_map                 ← 会话-Agent-Task 映射
├── session_log                 ← 会话日志（含 dag_task_id 索引）
├── dispatch_failed_log         ← 分发失败记录（DAG_TASK_ID REUSE 校验）
├── dispatch_attempts           ← 分发尝试记录
├── dispatch_queue              ← 分发队列
├── dispatch_payload_integrity  ← 分发载荷完整性
├── dispatch_prompt_refs        ← 分发 Prompt 引用
├── read_audit                  ← 文件读取审计（READ-BEFORE-APPROVE 校验）
├── approval_read_context       ← 审批读取上下文
├── substate_kv                 ← 子状态JSON blob（13 个键）
│   ├── config_read_state       ← config_read_attest 状态
│   ├── knowledge_cache_state   ← UC7KS 缓存充分性
│   ├── knowledge_state         ← 知识状态
│   ├── knowledge_audit_state   ← 知识审计状态
│   ├── write_audit_state       ← 写审计记录
│   ├── tdd_enforcement_state   ← TDD 证据链
│   ├── eslint_state            ← ESLint 违规
│   ├── compliance_records      ← 合规记录
│   ├── dependency_state        ← 依赖状态
│   ├── format_state            ← 格式化状态
│   ├── keystone_hashes         ← Keystone 合约哈希
│   ├── transaction_state       ← 事务状态
│   └── type_check_state        ← 类型检查状态
├── execution_checklist_runs     ← P0 检查清单运行记录
├── execution_checklist_items    ← 检查清单项
├── execution_checklist_events   ← 检查清单事件
├── knowledge_entries            ← 知识缓存条目索引
├── knowledge_files              ← 知识缓存文件清单
├── knowledge_entry_tags         ← 知识条目标签
├── knowledge_materialization_jobs ← 知识实体化作业
├── uc7ks_pipeline_state         ← UC7KS 管道状态
├── knowledge_session_access_archive ← 知识会话访问归档
├── agent_registry_snapshot      ← Agent 注册表快照
├── permission_snapshot          ← 权限快照
├── machine_meta                 ← 机器元数据
├── machine_contracts            ← 机器合约
├── template_resolution_snapshot ← 模板解析快照
├── file_baseline_kv             ← 文件基线
├── audit_log                    ← 审计日志
├── audit_trail                  ← 审计追踪
├── backup_log                   ← 备份日志
└── schema_version               ← 数据库 Schema 版本

JSON Files
├── .opencode/state/gate-state.json         ← 门禁快照（降级路径 writeJson 写入，非事务性 writeFileSync）
├── .opencode/state/machine.json            ← 状态机（含全部子状态）
├── .opencode/state/rule_registry.json      ← 规则注册表
├── .task_temp/_dispatch/.auto-dispatch.json ← 主分发队列（v2 queue-based, atomicWriteJson 原子写）
└── .task_temp/_dispatch/.pending.json       ← 回退队列（task-before.ts L362，DB 为空时使用）
```

---

## 直接影响下一轮会话的 Top 8 约束

| 优先级 | 状态 | 影响面 |
|:------:|------|-------|
| P0 | gate_sessions.status=delivered | 阻止新派遣（GATE-APPROVAL-LOCK）⚠️ **当前已 BYPASSED**：dispatch-before.ts L240 查询 status='delivered'，但 DB schema 迁移后状态值为 'approved'（当前 2 个 approved session 未触发锁） |
| P0 | substate_kv.knowledge_cache_state.attested=false | 阻止写操作（UC7-001）|
| P0 | read_audit 5分钟内无读取记录 | 阻止提交物批准（READ-BEFORE-APPROVE）|
| P0 | gate_sessions.status!=armed | 阻止工具调用（GATE gate-before）|
| P1 | dispatch_failed_log 有同一dag_task_id记录 | 阻止同ID派遣（FATAL EXIT）|
| P1 | substate_kv.config_read_state 未attest | 阻止写操作（CONFIG-READ-ATTEST）|
| P1 | execution_checklist_* 项未通过 | 阻塞工具调用（P0-CHECKLIST）|
| P1 | substate_kv.tdd_enforcement_state 不合规 | 阻止写业务代码（TDD）|

---

## 按持久化方式统计

| 持久化方式 | 项数 |
|-----------|:---:|
| SQLite DB + JSON 双写（降级路径） | 8 |
| SQLite DB only | 2 |
| substate_kv 子状态 | 6 |
| 队列/字典 JSON文件 | 2 |
| 仅运行时校验（无持久化）| 26 |
| **合计** | **44** |


---

## 附录：中断对持久化状态的影响

### 核心问题：原子性缺口

| 写入方式 | 原子性 | 中断后果 |
|---------|:------:|---------|
| atomicWriteJson | temp+rename | 全有全无 安全 |
| atomicWriteSubState | SQLite 事务（db.transaction 包裹 SELECT + INSERT OR REPLACE） | 全有全无 安全 |
| saveGateStore | SQLite 事务（主路径 DB-only，P2-A Step 8 移除 JSON 双写） | 全有全无 安全 |
| writeJson（compliance-gate.ts 降级路径） | **非原子**（直接 writeFileSync，无 temp+rename） | 可能截断或部分写入 |
| 内存多步属性赋值 + saveGateStore | 事务原子，但**内存中间态被全量持久化** | 孤儿 session（status=armed + armed_at=null，当前 2 例） |

### 中断三态模型

| 中断点 | 持久化状态 |
|--------|----------|
| Session写入后 | 正常 下一轮可继续 |
| atomicWriteJson 中途 | 原子（temp 文件残留，rename 未发生） 安全 |
| atomicWriteSubState 事务中途 | SQLite 回滚 安全 |
| saveGateStore 事务中途 | SQLite 回滚 安全 |
| writeJson 非原子写中途 | JSON 文件部分写入 **需手动修复** |
| 内存赋值完成后 save 前 | DB 保留旧状态 安全（但内存中间态下次 save 会被持久化） |

### 模块1: Write Scope 安全

| 状态 | 写入方式 | 中断风险 |
|------|:------:|---------|
| config_read_state | atomicWriteSubState → SQLite 事务 | 安全（事务回滚） |
| knowledge_cache_state | atomicWriteSubState → SQLite 事务 | 安全（事务回滚） |
| write_audit_state | atomicWriteSubState → SQLite 事务 | 安全（事务回滚） |
| tdd_enforcement_state | atomicWriteSubState → SQLite 事务 | 安全（事务回滚） |

### 模块2: 合规门禁 最脆弱(当前仍存在 4 个孤儿)

**combined flow 执行顺序（createGateSession → confirmGateSession）**:

```
1. createGateSession()
   ├─ 内存: store.sessions[id] = { gate_status: "checked", confirmed_at: null, ... }
   ├─ saveGateStore(store) → dbSaveGateStore(store)
   │     └─ SQLite 事务: DELETE FROM gate_sessions; INSERT ALL sessions
   │        (ses.gate_status="checked", confirmed_at=null → DB armed_at=null)
   └─ DB 已持久化 status=checked, armed_at=null ✅

2. confirmGateSession()
   ├─ 内存多步属性赋值 (非原子):
   │     ses.gate_status = "armed"          ← 赋值 #1
   │     ses.confirmed_at = ISO timestamp   ← 赋值 #2
   │     ses.plan_summary = ...
   │     ses.declared_deliverables = ...
   ├─ saveGateStore(store) → dbSaveGateStore(store)
   │     └─ SQLite 事务: DELETE FROM gate_sessions; INSERT ALL sessions
   │        (gate_status="armed", confirmed_at → DB armed_at)
   └─ DB 已持久化 status=armed, armed_at=<timestamp> ✅
```

**中断三态**:

| 中断点 | DB 状态 | 恢复后内存 | 后果 |
|--------|---------|-----------|------|
| 赋值 #1 后 / 赋值 #2 前 | status=checked (旧) | 丢失 | 安全（DB 回滚到 checked） |
| 所有赋值完成后 / saveGateStore 前 | status=checked (旧) | 丢失 | 安全（DB 回滚到 checked） |
| saveGateStore 事务执行中 | SQLite 回滚 | 丢失 | 安全（全有全无） |
| **非原子多步：内存已改 status=armed，但 confirmed_at 未赋值时 save** | **status=armed, armed_at=null** | — | **⚠️ 孤儿（当前 2 个）** |

**当前实际孤儿 session（2026-06-26 查询确认）**:

| session_id | status | armed_at | 根因 |
|------------|--------|----------|------|
| cg_ses_1782182430621 | armed | **NULL** | confirmGateSession 多步赋值中 confirmed_at 未设置时 save |
| cg_ses_1782183204461 | armed | **NULL** | 同上 |
| cg_ses_1782320245822 | checked | NULL（正常） | 用户未确认（48h 内可被 drain） |
| cg_ses_1782346814813 | checked | NULL（正常） | 用户未确认（48h 内可被 drain） |

**drain 规则漏洞**（gate-core.ts L1354-1370 已验证）:

```
armed 类型: ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at
           ↑ 要求 confirmed_at 非 null
           → armed + null confirmed_at 的孤儿 **永久无法被自动 drain**

checked 类型: ses.gate_status === "checked" && !ses.confirmed_at (age > 48h)
              → 2 个 checked session 在 48h 内，尚可自动 drain

delivered 类型: ses.gate_status === "delivered" && submitted_deliverables (age > 4h)
               → 当前 0 个 delivered session（状态值已重命名为 approved）
```

**approved + null consumed_at 锁风险（当前 2 个）**:

| session_id | status | consumed_at | 风险 |
|------------|--------|-------------|------|
| cg_ses_1782353506279 | approved | NULL | deliverables 已批准但未消费 |
| cg_ses_1782359332563 | approved | NULL | 同上 |

**GATE-APPROVAL-LOCK 机制**: dispatch-before.ts L247 检查 `status=approved && consumed_at=null` 会阻止新派遣，与文档 CG-7 描述一致。

### 模块3: 分发管道(已发生)

**队列架构（v2 queue-based, 已验证）**:

```
主队列: .task_temp/_dispatch/.auto-dispatch.json  ← dispatch_subagent.ts L622 append / task-before.ts L86 consume
DB 持久化: dispatch_queue 表（5 个 stale 条目已验证）+ session_map 表（784 行）
回退路径: .task_temp/_dispatch/.pending.json（task-before.ts L362，当 DB 为空时使用）
```

**dispatch_subagent 写队列时序**（dispatch_subagent.ts L605-627 已验证）:

```
1. 内存构造 queue entry: { dispatchId, promptHash, filePath, createdAt, agentType, taskId, sessionId }
2. 读取现有 .auto-dispatch.json (若存在)
3. 内存 append 新 entry
4. atomicWriteJson(.auto-dispatch.json, newQueue)  ← temp+rename 原子
5. 写入 session_map 表 (dbWriteSessionMap)
6. 返回包装 prompt 给 LLM → LLM 调用 Task()
7. task-before.ts 读取 .auto-dispatch.json → 消费 → atomicWriteJson 写回剩余 queue
```

**中断后果（已验证 2026-06-26）**:

| 中断点 | 残留状态 | 恢复行为 | 是否阻塞 |
|--------|---------|---------|:-------:|
| step 4 前（queue 未写） | 无残留 | 子 Agent 未启动，dispatch 失败 | NO |
| step 4 后 / step 7 前 | .auto-dispatch.json 有 entry | task-before.ts 下次 Task() 消费（agent_type 不匹配则 BLOCK） | ⚠️ 条件阻塞 |
| step 5 后 / step 7 前 | session_map 已写 + queue 已写 | session_map 孤儿（无实际 Task 运行）| NO（DP-8 仅校验同一 dag_task_id 重用） |
| step 7 消费写回前 | queue 残留完整 entry | 下次同 agent_type 的 Task() 自动消费 | NO（自愈） |

**当前实际残留（2026-06-26 查询）**:

- `.auto-dispatch.json`: **不存在**（已清空）
- `.pending.json`: **存在（1472 bytes）**，包含 2026-06-25T11:44 的 Knowledge-Curator entry 残留（agent_type=Knowledge-Curator, taskId=E2E-FINAL-V2-001）
- `dispatch_queue` 表: **5 个 stale 条目**（Super-Admin/Architect/CI-CD-Agent/Coder-BE 各 1，均 status=stale, session_id=null）
- `dispatch_failed_log` 表: 多条 `reason=stale-timeout` 记录（2026-06-16 的 KC/Architect dispatch 失败）

**DP-8 DAG_TASK_ID REUSE 校验**（dispatch-subagent.ts L1158）:
同一 `dag_task_id` 在 `dispatch_failed_log` 中已有记录时，新派遣会 FATAL EXIT。当前 `dag_task_id="KC-OPENDOC-SESSION"` 等 5 个 ID 已被标记为 failed，重试这些 ID 会被阻断。

**恢复方式**:

- `.pending.json` 残留: 手动删除文件，或派遣对应 agent_type 的 Task() 让其自动消费
- `dispatch_queue` stale 条目: 通过 state-compactor 清理，或手动 DELETE FROM dispatch_queue WHERE status='stale'
- `dispatch_failed_log` 阻塞: 手动 DELETE FROM dispatch_failed_log WHERE dag_task_id='?' 解除特定 ID 的封锁

### 模块4-8: 仅校验或原子写入 安全

- **UC7KS（模块4）**: atomicWriteSubState 内部使用 SQLite 事务（dbAtomicWriteSubState 包裹 SELECT+INSERT OR REPLACE 在 db.transaction 中），全有全无
- **Pre-Commit Hook（模块5）/ Pre-Execution Gate（模块6）/ Question（模块7）/ Self-Test（模块8）**: 只读校验层，不写状态

### 当前已观察症状（2026-06-26 实测）

| # | 症状 | 中断点 | 当前数量 | 恢复 |
|---|------|--------|:-------:|------|
| 1 | 孤儿 gate session（armed+null armed_at） | confirmGateSession 多步赋值中 confirmed_at 未设置时 save | **2** | 手动 UPDATE gate_sessions SET status='drained' WHERE session_id='?' 或 DELETE |
| 2 | .pending.json 残留 | dispatch_subagent 写 .pending.json 后 Task() 消费前中断 | **1**（KC, E2E-FINAL-V2-001） | 手动 rm .pending.json 或 dispatch 对应 agent_type 让其消费 |
| 3 | dispatch_queue stale 条目 | dispatch 入队后 session 未启动 | **5**（均 status=stale） | DELETE FROM dispatch_queue WHERE status='stale' |
| 4 | approved+null consumed_at | compliance_gate_approve_deliverables 批准后 complete 前中断 | **2** | 手动 UPDATE gate_sessions SET consumed_at=unixepoch('now')*1000 WHERE session_id='?' |
| 5 | dispatch_failed_log 累积 | dispatch 失败后记录未清理 | 多条（KC/Architect, 2026-06-16） | DELETE FROM dispatch_failed_log WHERE dag_task_id='?' 解除 DP-8 阻塞 |

### 最危险三个中断点

P0-1: **confirmGateSession 多步赋值中 confirmed_at 未设置时 saveGateStore** → 孤儿 session 无法被 drain 规则清理（drain 要求 confirmed_at 非 null）
P0-2: **writeJson 非原子写 gate-state.json（降级路径）** → JSON 文件可能截断，与 DB 不一致（P2-A Step 8 已移除主路径的 JSON 双写，但 writeJson 仍存在）
P1-3: **compliance_gate_approve_deliverables 批准后 complete 前中断** → approved+null consumed_at 锁风险（但当前 GATE-APPROVAL-LOCK 已 BYPASSED，见 Top 8 约束）

共同特征: 内存中间态被全量持久化 + 无对应 drain/清理规则覆盖
