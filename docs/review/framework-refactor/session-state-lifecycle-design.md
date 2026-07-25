# 框架状态跨轮次设计张力分析

**版本**: 1.1.0
**日期**: 2026-06-26（v1.1.0 实测数据审核：修正孤儿计数、新增 approved+null consumed_at 盲区、补充 dispatch_queue/session_map 孤儿规模）
**作者**: @Super-Admin

---

## 一、两种模型

模型A: 隔离轮次 — 每轮干净开始，无历史状态
模型B: 跨轮次连续 — 状态累积，持续演进

框架选择了模型B。多Agent工作流天生跨轮次：R1规划→R2设计→R3实现→R4审查→R5部署

## 二、问题不在该不该，在于哪些该哪些不该

### 该跨轮的（任务进展状态）

| 状态 | 理由 |
|------|------|
| Task.DAG.json | 任务拆解是跨轮的骨架 |
| contract.yaml + keystone hash | 契约发布后是稳定引用 |
| gate_sessions(正常完成的) | 审计追踪需要完整链路 |
| knowledge_entries/files | 缓存本身应持久化 |
| TECH_DEBT_REGISTRY.md | 技术债跨版本追踪 |

### 不该跨轮的（会话临时状态）

| 状态 | 理由 | 当前问题（2026-06-26 实测） |
|------|------|---------|
| 未完成的gate session（armed+null armed_at） | 上轮放弃的残留armed session无意义 | **2个孤儿**（cg_ses_1782182430621/cg_ses_1782183204461）卡住active_sessions，drain规则漏判 |
| 未完成的gate session（approved+null consumed_at） | 批准后未消费，无对应任务 | **2个**（cg_ses_1782353506279/cg_ses_1782359332563）锁风险（当前 GATE-APPROVAL-LOCK 已 BYPASSED，见 framework-state-persistence.md v2.1.0） |
| auto-dispatch队列 | 上轮的派遣请求已作废 | dispatch_queue **325个stale条目**（Super-Admin 102/Coder-BE 39/CI-CD-Agent 36/Architect 16/KC 22/Meta-Planner 5/Guardian 2/Coder-FE 3） |
| P0 checklist运行态 | 每轮应重新检查 | execution_checklist_runs **3个未completed**（1 active+preflight, 1 active+read_attest, 1 interrupted+dispatch_payload） |
| session_map过期映射 | 未启动的子Agent无需保留 | session_map 784条中 **270条孤儿**（无对应session_log），DP-8 REUSE阻止重试 |
| dispatch_payload中间态 | 上轮中断无需保留 | 启动清理需workaround（markChecklistRunInterrupted 标记为interrupted） |

## 三、当前补救措施与盲区

| 机制 | 处理什么 | 过滤条件（SQL/JS） | 效果 |
|------|---------|-------------------|------|
| session.ts startup Step1 | markChecklistRunInterrupted | 无条件标记 interrupted | ✅ 清理卡住的 checklist（当前 1 个 interrupted） |
| session.ts startup Step2 | drain delivered gate >4h | `WHERE status='delivered'` | ⚠️ **漏判 approved**（status 已迁移为 'approved'，当前 2 个 approved+null consumed_at 未被 drain） |
| session.ts startup Step3 | drain armed gate >1h（startup_cleanup_armed_hours=1） | `WHERE status='armed' AND confirmed_at IS NOT NULL AND confirmed_at < ?` | **漏判 armed+null armed_at**（当前 2 个孤儿） |
| dispatch-auto.ts | 清除 .auto-dispatch marker >5min（MAX_AGE_MS=300000） | `now - entry.createdAt > MAX_AGE_MS` | ⚠️ **仅 tool.execute.after 触发**，启动时不运行；仅清理文件队列不清理 dispatch_queue 表（当前 325 stale） |
| gate-core.ts drainStaleSessions | armed >24h / checked >48h / delivered >4h（默认阈值） | `ses.confirmed_at` 非空要求（armed 类型） | **漏判 armed+null armed_at**；delivered 已迁移为 approved 可能漏判 |
| compliance-gate.ts purgeStaleSessions L682/L692 | 同 drainStaleSessions（不同入口） | 同上 | **漏判 armed+null armed_at** |
| gate-core.ts reconcileGateStore L593-604（loadStore 重整） | 过滤 stale armed from active_sessions | `ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at` | **漏判 armed+null armed_at** |

### 盲区根因

**SQL/JS 过滤条件共同缺陷**（5 个机制全部要求 confirmed_at IS NOT NULL）:

```
session.ts L209:    WHERE status = 'armed' AND confirmed_at IS NOT NULL AND confirmed_at < ?
gate-core.ts L596:  ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at
gate-core.ts L1354: ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at
compliance-gate.ts L682: ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at
```

**孤儿状态组合**: `status=armed + armed_at IS NULL + expires_at IS NULL` — 上述 4 个过滤条件全部漏判

**附加盲区**:

- `status='approved'` + `consumed_at IS NULL`：2 个，所有 delivered 类 drain 均查 `status='delivered'`（DB 已迁移为 'approved'）
- `dispatch_queue` 表 stale 条目：325 个，dispatch-auto.ts 仅清理文件队列不清理 DB 表
- `session_map` 孤儿：270 条无对应 session_log，无清理机制


## 四、状态分级生命周期设计


### 会话级状态 (Session-scoped)

本轮结束即清零, 中断=放弃:

· 未完成的gate session (status != completed/drained)

· auto-dispatch队列条目

· P0 checklist运行中态

· dispatch_payload/preflight中间态

· session_map无对应session_log的孤儿记录


### 任务级状态 (Task-scoped)

任务未完成前保留, 完成或放弃后归档:

· 已armed的合规门禁(等待执行)

· 已声明的deliverables

· TDD证据链

· 子Agent的HANDOVER.md


### 项目级状态 (Project-scoped)

永久保留 跨所有轮次:

· Task.DAG.json

· contract.yaml + keystone hash

· knowledge_entries(缓存)

· TECH_DEBT_REGISTRY.md

· 已完成的gate session审计记录

· machine.json + 子状态


## 五、修复方向


### P0: 修复 confirmed_at/approved 双盲区

所有清理机制应同时处理两类孤儿:

**armed 类（armed+null confirmed_at）**:

```sql
WHERE status = 'armed' AND (
  (confirmed_at IS NOT NULL AND confirmed_at < ?)  -- 正常超时
  OR (confirmed_at IS NULL AND created_at < ?)      -- 中断产生孤儿
  OR (confirmed_at IS NULL AND expires_at IS NULL)   -- 从未完成confirm
)
```

**approved 类（approved+null consumed_at）**:

```sql
WHERE status = 'approved' AND consumed_at IS NULL AND created_at < ?
```

涉及:
- compliance-gate.ts L682/L692（purgeStaleSessions: armed+checked 类型）
- session.ts L209（Step2: status='delivered' 改为 IN ('delivered','approved')）
- session.ts L210（Step3: 增加 confirmed_at IS NULL 分支）
- gate-core.ts L596/L1354（reconcileGateStore + drainStaleSessions）


### P1: 原子化 combined flow

confirmGateSession 多步内存修改（gate_status/confirmed_at/plan_summary/declared_deliverables）应在 SQLite 事务内完成，一次性写入完整状态。当前根因见 framework-state-persistence.md v2.1.0 模块2 时序图。


### P1: dispatch-auto 启动清理 + dispatch_queue 表清理

当前仅 `tool.execute.after` 运行，应在 session.ts startup cleanup 增加 Step4 触发，避免循环依赖。

新增 `dispatch_queue` DB 表清理（dispatch-auto.ts 只清 .auto-dispatch.json 文件队列，不清 DB 表，当前 325 stale 条目）:

```sql
UPDATE dispatch_queue SET status = 'expired', updated_at = ?
WHERE status = 'stale' AND created_at < ? -- 建议阈值 24h
```


### P1: session_map 绑定 session_log

无对应 session_log 的孤儿 session_map 应在启动清理中移除（当前 270 条孤儿，无清理机制）:

```sql
DELETE FROM session_map
WHERE session_id NOT IN (SELECT DISTINCT session_id FROM session_log WHERE session_id IS NOT NULL)
```


### P2: 状态迁移兼容性检查

DB schema 中 `status='delivered'` 已被重命名为 `'approved'`，但 4 个 drain 机制的 SQL 仍查 `'delivered'`。应在 migration 脚本或启动时检查：

```sql
SELECT COUNT(*) FROM gate_sessions WHERE status = 'delivered'  -- 应为 0
SELECT COUNT(*) FROM gate_sessions WHERE status = 'approved'   -- 当前 2
```

若发现残留 `status='delivered'`，应迁移为 `'approved'` 或统一 drain 逻辑。


## 六、结论

上一轮对话结果应不应该影响下一轮?

应该 — 当它是任务进展的一部分(DAG/契约/代码/审查)

不应该 — 当它是中断留下的半成品(未完成gate/残留队列/未启动子Agent)

**当前缺陷（2026-06-26 实测）**:

1. **没有在写入时区分状态归属级别**：confirmGateSession 多步内存修改（gate_status/confirmed_at/plan_summary）非原子，中断产生 armed+null armed_at 孤儿（当前 2 个）
2. **没有在轮次开始时主动清理会话级状态**：startup cleanup 的 SQL 过滤要求 `confirmed_at IS NOT NULL`，漏判 armed+null 孤儿
3. **状态迁移未同步到 drain 逻辑**：DB schema 将 `status='delivered'` 迁移为 `'approved'`，但 4 个 drain 机制仍查 `'delivered'`，导致 approved+null consumed_at 孤儿（当前 2 个）永久无法被清理
4. **清理范围不完整**：dispatch-auto.ts 仅清文件队列不清 dispatch_queue 表（325 stale），session_map 孤儿（270 条）无任何清理机制

量化影响（当前）:
- 4 个 gate session 孤儿（2 armed+null + 2 approved+null）
- 325 个 dispatch_queue stale 条目
- 270 个 session_map 孤儿
- 3 个 execution_checklist_runs 未完成（1 已标记 interrupted）

startup cleanup 是一次事后修补，漏判了最关键的 armed+null 和 approved+null 两类盲区。根本解决需要：写入时按状态归属分级持久化 + 启动时按分级主动清理会话级状态。