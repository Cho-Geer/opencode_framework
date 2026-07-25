# 三锁连环死锁根因诊断与修复方案

> **日期**: 2026-06-26  
> **状态**: 根因已确认，修复方案待审批  
> **严重级别**: P0 — 框架完全阻塞  
> **触发场景**: E2E-FULL-PARAM-TEST，stale gate session `cg_ses_1782458969478`（status=recoverable）

---

## §1 问题陈述

卡在 stale gate session `cg_ses_1782458969478`（E2E-FULL-PARAM-TEST，status=recoverable）。三把锁连环卡死：

1. **Lock 1**: `compliance_gate_check` 被 stale `recoverable` session 拦截
2. **Lock 2**: `compliance_gate_retry_confirm` 被 P0 checklist 拦截
3. **Lock 3**: P0 checklist preflight 因 `resolve_domain_id()` 返回 null 无法推进

每把锁各自阻塞下一把锁的解锁路径，形成不可自破的死循环。

---

## §2 根因分析

### 2.1 Lock 1 — `recoverable` 状态无 drain 路径

**文件**: `.opencode/scripts/mcp-tools/compliance-gate.ts` L990–1015

`compliance_gate_check` 的 GATE-RECOVERY 逻辑显式将 `recoverable` 与 `armed` 并列为阻塞状态：

```js
// L996–1002
const conflictSid = Object.keys(store.sessions || {}).find((sid) => {
  const s = store.sessions[sid];
  return (
    s.task_id === taskId &&
    (s.gate_status === "armed" || s.gate_status === "recoverable") &&
    !s.consumed_at
  );
});
```

匹配时返回 `passed: false, session_id: null`，agent 无法获得新 session。

**关键：四个清理机制都不 drain `recoverable`：**

| 清理机制 | 文件:行号 | 目标状态 | 包含 `recoverable`? |
| --- | --- | --- | --- |
| `purgeStaleSessions()` | compliance-gate.ts:682–723 | `armed`(>24h), `checked`(>48h) | ❌ |
| `drainStaleSessions()` | gate-core.ts:1330–1407 | `armed`(>24h), `checked`(>48h), `delivered`/`approved`(>4h) | ❌ |
| `session.ts` Step 2 | session.ts:163–196 | `delivered`, `approved` | ❌ |
| `session.ts` Step 3 | session.ts:198–241 | `armed` | ❌ |

`recoverable` 状态在 `gate-core.ts:89–97` 中是合法的 `gate_status` 值，在以下三处被设置：

| 设置位置 | 文件:行号 | 触发条件 |
| --- | --- | --- |
| `submitDeliverables()` | gate-core.ts:1228 | `HANDOVER.md`/`TASK_LOG.md` 缺失 |
| `runGateComplete()` | compliance-gate.ts:1865 | artifacts 缺失且重试未耗尽 |
| `runGateSubmitDeliverables()` | compliance-gate.ts:2128 | deliverable artifacts 缺失 |

设置时代码**有意**保持 `consumed_at = null` 并保留在 `active_sessions` 中（L1875–1876 注释："Do NOT remove from active_sessions — keeps mutual exclusion lock"）。

**根因**: `recoverable` 被设计为"活锁"状态（保持互斥），但**没有任何自动 drain 路径**。唯一的出路是 `compliance_gate_retry_confirm`（L3145–3168 将 `recoverable → armed`），但如果 agent 在调用前被中断/崩溃，该 session 永久阻塞同 `task_id` 的所有新 `compliance_gate_check` 调用。

### 2.2 Lock 2 — `retry_confirm` 被 P0 checklist 阻塞

**文件**: `.opencode/plugins/checklist-before.ts` L52–63 + `.opencode/scripts/mcp-tools/compliance-gate.ts` L1865/L2128

#### 2.2a `retry_confirm` 不在 passthrough 列表中

```ts
// checklist-before.ts:52–63
const CORE_PASSTHROUGH_TOOLS = new Set([
  "checklist_status",
  "advance_checklist_phase",
  "resolve_domain_id",
  "knowledge_cache_search",
  "config_read_attest",
  "module_scope_declare",
  "todowrite",
  "question",
  "skill",
  "dispatch_subagent",
]);
// ← compliance_gate_retry_confirm 不在此列表中
```

因此 `checklist-before.ts` 的 `tool.execute.before` 钩子（L375–418）在 strict/locked 模式下会对 `retry_confirm` 执行 phase-blocking 检查。

#### 2.2b gate 进入 `recoverable` 时跳过 checklist wiring

当 gate 进入 `recoverable` 时，代码在 wiring 之前 return，导致 checklist 卡在当前 phase：

| 入口 | recoverable 设置行 | 跳过的 wiring | checklist 卡在的 phase |
| --- | --- | --- | --- |
| `runGateComplete` | L1865 → return L1881 | `checklistWirePassed("gate_closed")` @ L1920 | `close` |
| `runGateSubmitDeliverables` | L2128 → return L2136 | `checklistWirePassed("deliverables_submitted")` @ L2152 | `deliver` |

checklist run 停在 `deliver` 或 `close` phase，有未通过的 blocking item。

#### 2.2c `runGateRetryConfirm` 本身不 wire checklist

`runGateRetryConfirm()`（L3105–3168）成功将 `recoverable → armed` 后，**零次** 调用 `checklistWirePassed`。对比：其他所有 gate 转换共有 10 处 `checklistWirePassed` 调用（L1607, L1615, L1630, L1920, L2152, L2701, L2709, L2716, L2723, L2736）。

**根因**: 三重缺陷叠加 — (a) `retry_confirm` 不是 passthrough tool；(b) 进入 `recoverable` 时跳过 checklist wiring，留下未通过的 blocking item；(c) `retry_confirm` 本身不重置 checklist。结果是 checklist 在 strict/locked 模式下阻塞 `retry_confirm` 调用本身。

### 2.3 Lock 3 — `resolve_domain_id()` 返回 null

**文件**: `.opencode/tools/resolve_domain_id.ts` L100–121 + `.opencode/plugins/session.ts` L287–359

#### 2.3a dispatch context 被 session.ts 启动清理删除

`resolve_domain_id()` 按优先级查询三个来源，全部可能被清理掉：

| 优先级 | 来源 | 清理机制 | 清理条件 |
| --- | --- | --- | --- |
| 1 | `session_map` DB 行的 `domain_id` | session.ts Step 5 (L287–316) | `session_id NOT IN (SELECT session_id FROM session_log)` |
| 1.5 | `dispatch:child:{dagTaskId}` 合成槽位 | session.ts Step 5 (同上) | 合成 session_id 永不在 `session_log` 中 → **必然被删** |
| 2 | `ctx/{dagTaskId}.json` 文件 | session.ts Step 6 (L318–359) + task-after.ts:194 | `dag_task_id NOT IN session_map`（Step 5 已删除行） |

**关键链式效应**: Step 5 删除 session_map 行（包括 child 槽位）→ Step 6 发现 `dag_task_id` 不在 session_map 中 → 删除 ctx 文件。两个步骤在同一 `chatMessageHook` 调用中顺序执行。

#### 2.3b `domain_id` 在幸存行中被 NULL 化

`session.ts:528–561` 的 `FW-SESSION-HOOK-WRITE-CONSTRAINT`：仅当 `resolveDomainIdWithSource(sid).resolved_from === "session_map"` 时才写 `domainId`。如果上游清理已经删除了 dispatch context，`resolved_from` 返回 `"none"`，`domainId` 为 `undefined`，`dbWriteSessionMap` 将 `domain_id` 写为 `COALESCE(existing, NULL)` → NULL。

#### 2.3c null 返回导致 checklist 永久 pending

```ts
// resolve_domain_id.ts:110–121
if (domainId) {  // ← null 时不进入
  try {
    checklistWirePassed(sessionId, agent, dagTaskId, "domain_resolved", ...);
  } catch {}
}
```

`domain_resolved` checklist item（execution-checklist.ts:170–175, `blocking=1`）保持 `pending` 状态，`preflight` phase 永远无法通过，`checklist-before.ts` 在 strict/locked 模式下阻塞所有非 passthrough 工具。

**根因**: `gate_sessions` 生命周期与 dispatch context（session_map/ctx 文件）生命周期**完全独立**。`recoverable` gate session 持久存在（无 drain），但其关联的 dispatch context 被 session.ts 启动清理删除。两个清理路径不协调 — session.ts 不检查 gate_sessions 状态就删除 dispatch context。

### 2.4 死锁全链路

```
1. Agent 调用 compliance_gate_complete/submit_deliverables，artifacts 缺失
2. Gate session: armed → recoverable (consumed_at=null, 保留在 active_sessions)
3. Agent 对话被中断/崩溃，未调用 retry_confirm
4. 下一轮 session.ts chatMessageHook 启动:
   ├─ Steps 2/3: drain delivered/approved/armed — NOT recoverable → gate session 存活
   ├─ Step 5: 删除 orphan session_map 行 (child 槽位永不在 session_log) → dispatch context 丢失
   └─ Step 6: 删除 ctx 文件 (dagTaskId 不在 session_map) → ctx context 丢失
5. Agent 调用 compliance_gate_check(task_id)
   └─ Lock 1: 被 recoverable session 阻塞 → passed:false, session_id:null
6. Agent 尝试 compliance_gate_retry_confirm(session_id)
   └─ Lock 2: 被 P0 checklist 阻塞 (deliver/close phase 有未通过 item)
7. Agent 尝试 resolve_domain_id() 清除 preflight
   └─ Lock 3: 返回 null (dispatch context 已被清理) → domain_resolved 保持 pending
8. ═══ 死锁：无工具可破环 ═══
```

---

## §3 修复方案

### Fix 1 — `recoverable` 状态自动 drain（P0，Lock 1）

**目标**: 为 `recoverable` 状态添加基于时间的自动 drain 路径，与其他 live status 一致。

#### Fix 1a: `drainStaleSessions()` 添加 recoverable 条件

**文件**: `.opencode/lib/gate-core.ts` L1393–1407 之后

```ts
// Recoverable state: drain after 4 hours without retry
// (same threshold as delivered/approved — recoverable is a transient
// failure state, not a long-lived execution state)
if (ses.gate_status === "recoverable" && !ses.consumed_at) {
  const failHistory = ses.fail_history || [];
  const lastFail = failHistory[failHistory.length - 1];
  const refTime = (lastFail?.failed_at) || ses.created_at;
  const age = nowTs - new Date(refTime).getTime();
  if (age > 4 * 3600000) {
    shouldDrain = true;
    drainType = "STALE_RECOVERABLE";
    reason = `recoverable for ${Math.floor(age / 3600000)}h without retry (threshold: 4h)`;
  }
}
```

同时在 return 对象中添加 `drained_recoverable: number` 字段。

#### Fix 1b: `purgeStaleSessions()` 添加 recoverable 条件

**文件**: `.opencode/scripts/mcp-tools/compliance-gate.ts` L723 之后

```js
// Recoverable but never retried > 4h
if (ses.gate_status === "recoverable" && !ses.consumed_at) {
  const failHistory = ses.fail_history || [];
  const lastFail = failHistory[failHistory.length - 1];
  const refTime = (lastFail?.failed_at) || ses.created_at;
  const age = nowTs - new Date(refTime).getTime();
  if (age > 4 * 3600000) {  // RECOVERABLE_STALE_MS
    shouldDrain = true;
    drainType = "STALE_RECOVERABLE";
    reason = `recoverable for ${Math.floor(age / 3600000)}h without retry`;
  }
}
```

#### Fix 1c: `session.ts` Step 3 SQL 添加 recoverable

**文件**: `.opencode/plugins/session.ts` L215–219

```sql
-- 修改前:
WHERE status = 'armed' AND consumed_at IS NULL AND (...)

-- 修改后:
WHERE status IN ('armed', 'recoverable') AND consumed_at IS NULL AND (
  (confirmed_at IS NOT NULL AND confirmed_at < ?)
  OR (confirmed_at IS NULL AND created_at < ?)
)
```

注意：`recoverable` session 的 `confirmed_at` 在 `runGateRetryConfirm` 中被设置（L3156），首次进入 `recoverable` 时 `confirmed_at` 可能已有值（从 armed 状态继承）。使用 `confirmed_at || created_at` 作为回退（与 FW-DB-CANONICAL-04 一致）。

#### Fix 1d: drain 时同步清理 checklist run

**文件**: `.opencode/lib/gate-core.ts` drain 操作中（L1435 附近）

drain `recoverable` session 时，同时调用 `markChecklistRunInterrupted` 清除可能卡住的 checklist run：

```ts
// 在 drain DB 操作后添加:
try {
  const { markChecklistRunInterrupted } = require("./execution-checklist");
  markChecklistRunInterrupted("deliver", "active");
  markChecklistRunInterrupted("close", "active");
} catch { /* checklist cleanup must not block drain */ }
```

**注意**: `markChecklistRunInterrupted` 当前按 phase 批量标记，不区分 session。这是已有行为（session.ts 中断恢复已使用此模式），扩展到 `deliver`/`close` phase 是一致的。

---

### Fix 2 — `retry_confirm` 加入 passthrough + 重置 checklist（P0，Lock 2）

**目标**: 允许 agent 在 checklist 卡住时调用 `retry_confirm`，并在成功 re-arm 后重置 checklist。

#### Fix 2a: 添加到 CORE_PASSTHROUGH_TOOLS

**文件**: `.opencode/plugins/checklist-before.ts` L52–63

```ts
const CORE_PASSTHROUGH_TOOLS = new Set([
  "checklist_status",
  "advance_checklist_phase",
  "resolve_domain_id",
  "knowledge_cache_search",
  "config_read_attest",
  "module_scope_declare",
  "todowrite",
  "question",
  "skill",
  "dispatch_subagent",
  "compliance_gate_retry_confirm",  // ← 新增：允许 recoverable 恢复
]);
```

**理由**: `retry_confirm` 是恢复操作，不是执行操作。与 `resolve_domain_id`、`advance_checklist_phase` 等恢复/诊断工具并列。passthrough 允许 agent 在 checklist 卡住时调用它。

#### Fix 2b: `runGateRetryConfirm` 成功后重置 checklist

**文件**: `.opencode/scripts/mcp-tools/compliance-gate.ts` L3163（`saveStore(store)` 之后，return 之前）

```js
// P0-CHECKLIST: reset checklist on successful re-arm
// The recoverable transition skipped checklist wiring, leaving
// the run stuck in deliver/close phase. Mark as interrupted so
// a fresh run is created on the next tool call.
try {
  const { markChecklistRunInterrupted } = require("../../lib/execution-checklist");
  const clSid = session.opencode_session_id || gateSessionId;
  markChecklistRunInterrupted("deliver", "active");
  markChecklistRunInterrupted("close", "active");
} catch { /* checklist reset must not block re-arm */ }
```

#### Fix 2c: gate 进入 recoverable 时主动标记 checklist

**文件**: `.opencode/scripts/mcp-tools/compliance-gate.ts` L1877 和 L2134（`saveStore(store)` 之后，return 之前）

在两处 `recoverable` 设置点添加：

```js
// L1877 (runGateComplete recoverable path) 和 L2134 (runGateSubmitDeliverables recoverable path)
// P0-CHECKLIST: proactively mark stuck checklist run as interrupted
try {
  const { markChecklistRunInterrupted } = require("../../lib/execution-checklist");
  markChecklistRunInterrupted("close", "active");   // L1877 处
  markChecklistRunInterrupted("deliver", "active");  // L2134 处
} catch {}
```

**理由**: 在 gate 进入 `recoverable` 的那一刻就清除 checklist 障碍，而不是等到 agent 调用 `retry_confirm` 时才发现被阻塞。这与 `session.ts` 中断恢复时标记 `dispatch_payload` 的模式一致。

---

### Fix 3 — Gate-anchored dispatch context 保全（P0，Lock 3）

**目标**: 在 session.ts 清理 dispatch context 前，检查是否有活跃 gate session 引用同一 `dag_task_id`。如果有，跳过清理。

#### Fix 3a: Step 5 session_map orphan cleanup 添加 gate 保护

**文件**: `.opencode/plugins/session.ts` L291–296

```sql
-- 修改前:
DELETE FROM session_map
WHERE session_id NOT IN (
  SELECT DISTINCT session_id FROM session_log WHERE session_id IS NOT NULL
)

-- 修改后:
DELETE FROM session_map
WHERE session_id NOT IN (
  SELECT DISTINCT session_id FROM session_log WHERE session_id IS NOT NULL
)
AND (
  dag_task_id IS NULL
  OR dag_task_id NOT IN (
    SELECT task_id FROM gate_sessions
    WHERE status IN ('armed', 'recoverable', 'delivered', 'approved')
      AND consumed_at IS NULL
      AND task_id IS NOT NULL
  )
)
```

**效果**: 只要有一个活跃 gate session 引用某 `dag_task_id`，该 `dag_task_id` 对应的所有 session_map 行（包括 `dispatch:child:` 槽位）都不会被删除。

#### Fix 3b: Step 6 ctx GC 添加 gate 保护

**文件**: `.opencode/plugins/session.ts` L342–345

```ts
// 修改前:
const row = db
  .query("SELECT 1 FROM session_map WHERE dag_task_id = ?")
  .get(dagTaskId);
exists = !!row;

// 修改后:
const row = db
  .query(
    `SELECT 1 FROM session_map WHERE dag_task_id = ?
     UNION
     SELECT 1 FROM gate_sessions
     WHERE task_id = ? AND status IN ('armed', 'recoverable')
       AND consumed_at IS NULL`,
  )
  .get(dagTaskId, dagTaskId);
exists = !!row;
```

**效果**: ctx 文件在有活跃 gate session 引用时不会被删除，即使 session_map 行已被其他原因删除。

#### Fix 3c: `resolve_domain_id` 添加 gate_sessions fallback

**文件**: `.opencode/tools/resolve_domain_id.ts` L100–108 之后

作为 Priority 1.5（session_map 和 dispatch_ctx 之间），添加从 gate_sessions 的 `domain_id` 回退查询：

```ts
// Priority 1.5: gate_sessions fallback
// If the gate session has a domain_id snapshot, use it.
// This covers the edge case where session_map was cleaned but
// the gate session persists (shouldn't happen after Fix 3a/3b,
// but defense-in-depth).
if (!domainId && dagTaskId) {
  try {
    const { getDb } = require("../lib/db-manager");
    const db = getDb();
    const row = db.query(
      `SELECT domain_id FROM gate_sessions
       WHERE task_id = ? AND status IN ('armed', 'recoverable')
         AND consumed_at IS NULL AND domain_id IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
    ).get(dagTaskId) as { domain_id: string } | undefined;
    if (row?.domain_id) {
      domainId = row.domain_id;
      resolvedFrom = "gate_sessions";
      confidence = "medium";
    }
  } catch {}
}
```

**前提**: 需要在 `gate_sessions` 表中添加 `domain_id` 列（v26 迁移）。在 `runGateConfirm` 或 `runGateCheck` 时，将 `inferredDomainId` 快照到 gate session 中。

#### Fix 3d: gate_sessions 表添加 domain_id 列（v26 迁移）

**文件**: `.opencode/lib/db-manager.ts` 迁移部分

```ts
// v26 migration: add domain_id to gate_sessions for recoverable fallback
{
  version: 25, // migration index 25 → schema version 26
  up: `
    ALTER TABLE gate_sessions ADD COLUMN domain_id TEXT DEFAULT NULL;
  `,
},
```

在 `runGateConfirm`（武装时）和 `dispatch_subagent`（派发时）将 `inferredDomainId` 写入 gate_sessions.domain_id。

**注意**: Fix 3c/3d 是 defense-in-depth 层。Fix 3a/3b 是根因修复 — 如果 dispatch context 不被清理，`resolve_domain_id` 的 Priority 1 (session_map) 就能成功返回。3c/3d 覆盖的是极端边缘情况。

---

### Fix 4 — `resolve_domain_id` null 时提供诊断信息（P1）

**目标**: 当 `resolve_domain_id()` 返回 null 时，在返回值中包含诊断信息，帮助 agent 理解为什么无法解析并采取行动。

**文件**: `.opencode/tools/resolve_domain_id.ts` L123–130

```ts
// 修改 null 返回:
return JSON.stringify({
  domain_id: domainId,
  resolved_from: resolvedFrom,
  confidence: confidence,
  note: domainId
    ? "Use this domain_id as the 'module' argument for module_scope_declare()"
    : "No dispatch domain assigned — agent_domain_map may not have this agent type, or the dispatch hasn't been recorded yet",
  // 新增诊断字段:
  diagnosis: domainId ? undefined : {
    session_map_row: hasSessionMapRow,
    child_slot: hasChildSlot,
    ctx_files: ctxFileCount,
    active_gate_sessions: activeGateCount,
    suggestion: activeGateCount > 0
      ? "Active gate session exists but dispatch context is missing. Call compliance_gate_retry_confirm to re-arm, then re-dispatch."
      : "No active gate session. Start a new compliance_gate_check and dispatch_subagent flow.",
  },
});
```

---

## §4 子系统合规矩阵

| Fix | DB-Canonical | Execution Checklist | Gate State | Session Tracking | Dispatch Queue | Agent Identity | Route Validation | Plugin Lifecycle | Interrupt Guard | Log Rotation | State Transaction | Framework Enforcer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1a | ✅ gate_sessions DB | ✅ drain 时清 checklist | ✅ 补全 drain 路径 | — | — | — | — | — | — | ✅ drain 日志 | — | — |
| 1b | ✅ 同 1a | ✅ 同 1a | ✅ 同 1a | — | — | — | — | — | — | ✅ 同 1a | — | — |
| 1c | ✅ SQL 操作 gate_sessions | ✅ 同 1a | ✅ 同 1a | ✅ Step 3 修正 | — | — | — | ✅ session.ts 钩子 | — | ✅ 同 1a | — | — |
| 1d | — | ✅ markChecklistRunInterrupted | ✅ drain 联动 | — | — | — | — | — | — | ✅ 日志 | — | — |
| 2a | — | ✅ passthrough 列表 | — | — | — | — | — | ✅ checklist-before.ts | — | — | — | ✅ 非越界 |
| 2b | — | ✅ 重置 checklist | ✅ retry 联动 | — | — | — | — | — | — | ✅ 日志 | — | — |
| 2c | — | ✅ 主动 interrupt | ✅ recoverable 联动 | — | — | — | — | — | — | ✅ 日志 | — | — |
| 3a | ✅ SQL JOIN gate_sessions | — | ✅ gate 保护 | ✅ Step 5 修正 | — | ✅ 保留 identity | — | ✅ session.ts | — | ✅ 日志 | — | — |
| 3b | ✅ SQL UNION | — | ✅ gate 保护 | ✅ Step 6 修正 | — | ✅ 保留 ctx | — | ✅ session.ts | — | ✅ 日志 | — | — |
| 3c | ✅ gate_sessions 查询 | ✅ domain_resolved wiring | ✅ fallback | — | — | ✅ domain 解析 | — | — | — | — | — | — |
| 3d | ✅ v26 迁移 | — | ✅ domain 快照 | — | — | — | — | — | — | — | — | — |
| 4 | — | ✅ 诊断辅助 | — | ✅ 诊断信息 | — | ✅ identity 诊断 | — | — | — | — | — | — |

---

## §5 实现顺序

按依赖关系和紧急程度排序：

| 阶段 | Fix | 优先级 | 依赖 | 预计工作量 |
| --- | --- | --- | --- | --- |
| Phase 1 | Fix 3a + 3b | P0 | 无 | 1h（SQL 修改 + 测试） |
| Phase 1 | Fix 2a | P0 | 无 | 15min（一行代码） |
| Phase 1 | Fix 2c | P0 | 无 | 30min（两处添加） |
| Phase 2 | Fix 2b | P0 | Fix 2a | 30min |
| Phase 2 | Fix 1a + 1b + 1c | P0 | 无 | 1h（三处对称修改） |
| Phase 2 | Fix 1d | P0 | Fix 1a | 30min |
| Phase 3 | Fix 3d + 3c | P1 | Fix 3a/3b | 2h（v26 迁移 + fallback 逻辑） |
| Phase 3 | Fix 4 | P1 | 无 | 30min |

**Phase 1 即可破环当前死锁**: Fix 3a/3b 防止 dispatch context 丢失，Fix 2a 允许 `retry_confirm` 调用，Fix 2c 在进入 recoverable 时清除 checklist 障碍。

**Phase 2 提供安全网**: Fix 1 系列确保 `recoverable` session 不会无限期存活。

**Phase 3 提供 defense-in-depth**: Fix 3c/3d 在极端边缘情况下仍有 fallback 路径。

---

## §6 验证方案

### 6.1 单元测试

| 测试用例 | Fix | 验证点 |
| --- | --- | --- |
| `drainStaleSessions` 处理 recoverable > 4h | 1a | drain 后 status=drained |
| `purgeStaleSessions` 处理 recoverable > 4h | 1b | purge 后 session 不在 active_sessions |
| session.ts Step 3 drain recoverable | 1c | SQL 执行后 recoverable 行被 drain |
| drain 后 checklist run 被标记 interrupted | 1d | execution_checklist_runs.status=interrupted |
| `retry_confirm` 在 checklist 卡住时可调用 | 2a | checklist-before 不阻塞 |
| retry 成功后 checklist 被重置 | 2b | 新 run 在 retry 后创建 |
| gate 进入 recoverable 时 checklist 被标记 | 2c | recoverable 后 deliver/close run=interrupted |
| Step 5 保留有活跃 gate 的 session_map 行 | 3a | dag_task_id 有活跃 gate 时行不被删 |
| Step 6 保留有活跃 gate 的 ctx 文件 | 3b | dag_task_id 有活跃 gate 时文件不被删 |
| resolve_domain_id gate_sessions fallback | 3c | session_map 清空后仍能返回 domain_id |
| v26 迁移添加 domain_id 列 | 3d | ALTER TABLE 成功 |
| null 返回时包含诊断信息 | 4 | diagnosis 字段存在 |

### 6.2 集成测试（E2E）

复现 `E2E-FULL-PARAM-TEST` 场景：

1. 创建 gate session，armed → recoverable（缺 artifacts）
2. 中断 agent 对话
3. 重启 session，运行 `chatMessageHook` 启动清理
4. 验证：
   - [Fix 3a/3b] dispatch context（session_map + ctx 文件）**未被清理**
   - [Fix 2c] checklist run 已被标记 interrupted
5. Agent 调用 `compliance_gate_retry_confirm`
   - [Fix 2a] 不被 checklist 阻塞
   - [Fix 2b] 成功后 checklist 被重置
6. Agent 调用 `resolve_domain_id()`
   - [Fix 3a/3b] 返回非 null domain_id
   - [Fix 3c] 即使 session_map 被清，gate_sessions fallback 也能返回
7. Agent 完成 preflight → execute → deliver → close
8. 验证 gate session 到达 `completed`

### 6.3 回归测试

- 确认 `armed`/`checked`/`delivered`/`approved` 的原有 drain 逻辑不受影响
- 确认 Step 5/6 在没有活跃 gate session 时仍正常清理 orphan 数据
- 确认 `markChecklistRunInterrupted("deliver")/("close")` 不影响正常流程中的 active run（因为正常流程中 run 已 passed/advanced）

---

## §7 临时手动解法（立即使用）

在 Fix 部署前，可手动解除当前死锁：

```bash
# 1. 查看 stale session
bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('.opencode/state/framework-state.db');
const rows = db.query('SELECT session_id, task_id, status, consumed_at FROM gate_sessions WHERE status = ?').all('recoverable');
console.log(rows);
"

# 2. 手动 drain stale session（替换 cg_ses_XXX 为实际 ID）
bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('.opencode/state/framework-state.db');
db.run('UPDATE gate_sessions SET status = ?, consumed_at = ?, updated_at = ? WHERE session_id = ?', ['drained', Date.now(), Date.now(), 'cg_ses_1782458969478']);
console.log('drained');
"

# 3. 清除卡住的 checklist run
bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('.opencode/state/framework-state.db');
db.run('UPDATE execution_checklist_runs SET status = ?, updated_at = ? WHERE status = ? AND phase IN (?, ?)', ['interrupted', Date.now(), 'active', 'deliver', 'close']);
console.log('interrupted');
"
```

**注意**: 手动操作后仍需部署 Fix 以防止复发。

---

## §8 影响范围

| 文件 | 修改类型 | 影响范围 |
| --- | --- | --- |
| `.opencode/lib/gate-core.ts` | drainStaleSessions 添加 recoverable 条件 | 所有 gate drain 调用 |
| `.opencode/scripts/mcp-tools/compliance-gate.ts` | purgeStaleSessions + runGateRetryConfirm + recoverable 转换点 | 所有 gate 操作 |
| `.opencode/plugins/checklist-before.ts` | CORE_PASSTHROUGH_TOOLS 添加一项 | checklist 验证逻辑 |
| `.opencode/plugins/session.ts` | Step 3 SQL + Step 5 SQL + Step 6 SQL | 启动清理流程 |
| `.opencode/tools/resolve_domain_id.ts` | 添加 gate_sessions fallback + 诊断字段 | domain 解析逻辑 |
| `.opencode/lib/db-manager.ts` | v26 迁移（domain_id 列） | schema 版本升级 |
| `.opencode/lib/execution-checklist.ts` | 无代码修改（markChecklistRunInterrupted 已存在） | 仅使用范围扩展 |

---

_本文档基于 `.opencode/` 下 15+ 个源文件的代码审计，所有行号均已在 2026-06-26 验证。_
