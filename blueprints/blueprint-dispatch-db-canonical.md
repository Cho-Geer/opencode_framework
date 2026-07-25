# Blueprint: Dispatch 双轨持久化收敛至 DB-Canonical

**版本**: 1.0.0
**日期**: 2026-07-03
**状态**: 待实施
**优先级**: P1

---

## 一、问题背景

### 1.1 问题描述

Dispatch 系统违反框架 DB-only / DB-canonical 原则，在 `dispatch_queue` DB 表已具备完整 enqueue/dequeue/lease/fail/cleanup 能力的前提下，仍并行维护三套文件级队列（`.pending.json`、`.auto-dispatch.json`、`ctx/{dagTaskId}.json`），导致：

1. **双写不一致**：CLI 脚本 `dispatch-subagent.ts` 同时写 `.pending.json` 和 DB，`router.ts` 再写 `.auto-dispatch.json`，三处写入无事务保证，任一失败导致状态分裂。
2. **Silent failure**：`writeAutoDispatchQueue()` 原静默 `catch{}` 导致队列写入失败无日志（已修，但根因是文件队列本身多余）。
3. **清理逻辑分散**：`.pending.json` 有 30min（cleanup.ts）和 1h（lifecycle.ts）两套清理路径；`.auto-dispatch.json` 有 5min 清理（auto-cleanup.ts）；DB 有 lease reclaim + 24h expire + 7 天 compaction。四套清理机制各自独立。
4. **消费链复杂**：`marker-consume.ts` 优先读文件队列（三级 fallback），再调 `dbDequeueWithLease()`，两套验证可能不一致。

### 1.2 根因分析

**直接原因**：`dispatch_queue` DB 表（schema v15）是后期引入的，引入时未移除文件级队列，形成双轨。

**根本原因**：文件级队列最初是 dispatch_subagent（CLI 脚本进程）和 Task() before-hook（框架 hook 进程）之间的 IPC 机制。当时框架无 DB 层。DB 层加入后，文件队列未退役，形成冗余。

### 1.3 代码验证

通过全量搜索确认：

- `.pending.json`：1 个写入点（CLI 脚本 L107）、2 个清理点（cleanup.ts L70-121、lifecycle.ts L221-245）、1 个 self-test 验证点。无消费点——它不参与 dispatch_subagent → Task() 的桥接，纯粹是审计/追踪用途。
- `.auto-dispatch.json`：1 个写入点（router.ts L292 writeAutoDispatchQueue）、1 个消费点（marker-consume.ts L63-164）、1 个清理点（auto-cleanup.ts L48-88）。这是唯一的跨进程 IPC 桥梁。
- `dispatch_queue` DB：1 个写入点（CLI 脚本 L116 调 `dbEnqueueDispatch`）、1 个消费点（marker-consume.ts L229 调 `dbDequeueWithLease`）、2 个清理点（auto-cleanup.ts L33 `dbCleanStaleLeases`、lifecycle.ts L114 expire）。**已具备完整的入队→消费→清理链路**。
- `ctx/{dagTaskId}.json`：1 个写入点（router.ts L302）、0 个运行时消费点（仅 nightly-compaction 清理 + agent-resolver.ts 有 export 但无调用方读取）。

**结论**：文件级队列的功能已被 DB 完全覆盖。三个文件（`.pending.json`、`.auto-dispatch.json`、`ctx/{dagTaskId}.json`）可安全移除，仅保留 prompt blob 文件（`dispatch-{agent}-{ts}.md`）作为大 payload 载体。

---

## 二、解决方案

### 2.1 方案对比

| 维度 | 方案 A: 全收敛至 DB | 方案 B: 保留文件为主、DB 为审计 |
|------|-------|-------|
| 核心思路 | 移除 `.pending.json`、`.auto-dispatch.json`、`ctx/`；marker-consume 改为 DB-first 查询 | 保留文件队列为 IPC 主通道，DB 仅做 append-only 审计日志 |
| 实现复杂度 | 中（改 5 文件、删 3 函数块、加 1 个 DB 查询函数） | 低（仅需补日志，不改架构） |
| 可维护性 | 高（单一数据源，清理逻辑统一） | 低（继续维护双轨，两套清理逻辑） |
| 一致性风险 | 低（DB 事务保证原子性） | 高（文件无锁、双写不一致持续存在） |
| 性能影响 | 可忽略（SQLite 同进程，查询 <1ms） | 无变化 |
| 符合框架原则 | 完全符合 DB-only | 继续违反 |
| 回滚难度 | 中（需恢复文件写入代码，但可 git revert） | 无需回滚 |

### 2.2 选择结论

选择**方案 A: 全收敛至 DB**。理由：

1. `dispatch_queue` 表已具备完整生命周期管理，不是"新建"而是"切换主通道"。
2. `framework-self-test.ts` L6039-6089 已有 `.pending.json` 双写移除验证 check，说明迁移在计划中。
3. `dispatch_context` 表在 schema v23 被 drop 而非重建，说明 ctx 文件是临时方案。

### 2.3 否决理由

- 方案 B：继续违反 DB-only 原则，双写不一致问题持续存在，两套清理逻辑增加维护负担。

---

## 三、核心设计

### 3.1 方案概述

| 需求 | 当前实现 | 迁移后 |
|------|---------|--------|
| dispatch_subagent → Task() 桥接 | `.auto-dispatch.json` 文件队列 | `dispatch_queue` DB + `dispatch_prompt_refs` |
| 去重（同 agentType+dagTaskId） | `.pending.json` 数组 filter | DB 查询 `WHERE agent_type=? AND dag_task_id=? AND status IN ('pending','running')` |
| 审计/生命周期追踪 | `.pending.json` 30min/1h drain | `dispatch_queue` 24h expire + `dispatch_failed_log` 归档 |
| per-dispatch context | `ctx/{dagTaskId}.json` 文件 | `session_map` DB（已有 dag_task_id + domain_id） |
| prompt 大 payload | `dispatch-{agent}-{ts}.md` 文件 | **不变**（blob 载体保留） |
| DISPATCH_TOKEN 完整性 | 不变 | **不变**（SHA-256 校验逻辑独立于存储层） |

### 3.2 数据模型变更

**无需新增表或字段。** 现有 `dispatch_queue` + `dispatch_prompt_refs` + `session_map` 已覆盖全部数据需求。

验证：当前 `dbEnqueueDispatch()` 写入的数据 vs 文件队列写入的数据对比：

| 数据项 | dispatch_queue DB | .pending.json | .auto-dispatch.json | ctx/*.json |
|--------|:-:|:-:|:-:|:-:|
| agentType | `agent_type` | `agentType` | `agentType` | `agentType` |
| dagTaskId | `dag_task_id` | `taskId` | `taskId` | `dagTaskId` |
| prompt filePath | via `prompt_ref_id` → `dispatch_prompt_refs.file_path` | `filePath` | `filePath` | — |
| promptHash | via `prompt_ref_id` → `dispatch_prompt_refs.sha256` | `promptHash` | — | — |
| sessionId | `session_id` (dequeue 时) | — | `sessionId` | `parentSessionId` |
| domainId | via `session_map.domain_id` | — | — | `domainId` |
| createdAt | `created_at` | `createdAt` | `createdAt` | `createdAt` |

**覆盖度：100%**。DB 已包含文件队列的全部数据字段。

### 3.3 核心代码变更

#### 3.3.1 新增函数：`dbFindPendingDispatch()` — queue.ts

替代 `.auto-dispatch.json` 的三级 fallback 消费逻辑：

```typescript
// service/dispatch/queue.ts — 新增
export function dbFindPendingDispatch(
  agentType: string,
  sessionId?: string
): { queueId: number; filePath: string; sha256?: string } | null {
  const db = getFrameworkDB();
  if (!db) return null;

  // Strategy 1: exact match (agentType + dag_task_id via session_map)
  // Strategy 2: agentType-only oldest pending
  // Strategy 3: any oldest pending (logged as mismatch)
  const row = db.prepare(`
    SELECT dq.id, pr.file_path, pr.sha256, dq.agent_type, dq.dag_task_id
    FROM dispatch_queue dq
    JOIN dispatch_prompt_refs pr ON dq.prompt_ref_id = pr.id
    WHERE dq.status = 'pending' AND dq.agent_type = ?
    ORDER BY dq.created_at ASC
    LIMIT 1
  `).get(agentType) as any;

  return row ? { queueId: row.id, filePath: row.file_path, sha256: row.sha256 } : null;
}
```

三级 fallback 保留在 `marker-consume.ts` 的调用层（DB 查询 + session_map 交叉验证），不在此函数内。

#### 3.3.2 新增函数：`dbCheckDuplicateDispatch()` — queue.ts

替代 `.pending.json` 的去重逻辑：

```typescript
// service/dispatch/queue.ts — 新增
export function dbCheckDuplicateDispatch(
  agentType: string,
  dagTaskId: string
): boolean {
  const db = getFrameworkDB();
  if (!db) return false;
  const row = db.prepare(`
    SELECT 1 FROM dispatch_queue
    WHERE agent_type = ? AND dag_task_id = ? AND status IN ('pending', 'running')
    LIMIT 1
  `).get(agentType, dagTaskId);
  return !!row;
}
```

#### 3.3.2a 并发安全加固：改造 `dbDequeueWithLease()` — queue.ts

**现有缺陷**：当前 UPDATE 仅有 `WHERE id = ?`，缺少 `AND status = 'pending'` 守卫。事务使用 `BEGIN DEFERRED`（bun:sqlite 默认），并发两个事务可 SELECT 到同一条 pending 记录，第二个 UPDATE 会幂等覆盖已变 running 的记录，导致两个 Task() 拿到同一个 prompt。

```typescript
// 现有（不安全）:
db.transaction(() => {
  const row = db.prepare(`SELECT ... WHERE status = 'pending' AND agent_type = ? ... LIMIT 1`).get(agentType);
  if (!row) return null;
  db.prepare(`UPDATE dispatch_queue SET status = 'running', lease_owner = ?, lease_expiry = ? WHERE id = ?`).run(...);  // ← 无 status 守卫
  return row;
})();

// 修复后:
db.transaction(() => {
  const row = db.prepare(`SELECT ... WHERE status = 'pending' AND agent_type = ? ... LIMIT 1`).get(agentType);
  if (!row) return null;
  const result = db.prepare(`UPDATE dispatch_queue SET status = 'running', lease_owner = ?, lease_expiry = ? WHERE id = ? AND status = 'pending'`).run(...);
  if (result.changes === 0) return null;  // ← 已被其他事务消费，放弃
  return row;
})();
```

改动点：
1. UPDATE 加 `AND status = 'pending'` 守卫条件
2. 检查 `result.changes === 0`，为 0 则说明被并发消费，返回 null
3. 可选加固：`db.transaction()` 改为 `db.transaction().immediate()` 使用 `BEGIN IMMEDIATE`，在事务开始即获取 EXCLUSIVE lock，消除 DEFERRED 下的 SHARED→EXCLUSIVE 升级窗口

#### 3.3.3 改造 `consumeDispatchMarker()` — marker-consume.ts

移除全部文件读取逻辑（L63-164），改为 DB-first：

```
原流程:
  读 .auto-dispatch.json → 三级匹配 → 读 prompt 文件 → DISPATCH_TOKEN 校验 → dbDequeueWithLease

新流程:
  dbFindPendingDispatch(agentType) → 读 prompt 文件(dispatch_prompt_refs.file_path) → DISPATCH_TOKEN 校验 → dbDequeueWithLease
```

DISPATCH_TOKEN SHA-256 校验逻辑（L177-220）**完全不变**——它校验的是 prompt 内容，与存储层无关。

#### 3.3.4 精简 `cleanupDispatch()` — cleanup.ts

移除 `.pending.json` 的 stale drain 逻辑（L70-121），改为查询 DB：

```
原流程:
  删 _dispatch_target.json → 读 .pending.json → 找 >30min entry → dbAppendDispatchFailed → 写回文件

新流程:
  删 _dispatch_target.json → (无需操作，DB 的 24h expire 由 lifecycle.ts Step 4 处理)
```

注：30min stale drain 是文件队列特有的——因为文件无自动过期。DB 有 `lease_expiry` + `dbCleanStaleLeases()`，不需要主动 drain。

#### 3.3.5 精简 `reclaimAutoDispatch()` — auto-cleanup.ts

移除 `.auto-dispatch.json` 和 `.auto-dispatch` 文件清理（L48-111），仅保留 DB lease reclaim：

```
原流程:
  dbCleanStaleLeases() → 读 .auto-dispatch.json → 过滤 >5min → 写回/删除 → 读 .auto-dispatch → 删除

新流程:
  dbCleanStaleLeases()
```

#### 3.3.6 精简 CLI 脚本 — dispatch-subagent.ts

移除 `.pending.json` 写入逻辑（L86-112），仅保留：

```
原流程:
  buildDispatchPrompt() → 写 prompt 文件 → 写 .pending.json → dbEnqueueDispatch() → stdout

新流程:
  buildDispatchPrompt() → 写 prompt 文件 → dbEnqueueDispatch() → stdout
```

去重逻辑从文件 filter 改为调用 `dbCheckDuplicateDispatch()`（通过 `require("../../lib/dispatch-db")`）。

#### 3.3.7 精简 `dispatch()` — router.ts

移除 `writeAutoDispatchQueue()` 函数（L354-436）和调用（L292），移除 `writeDispatchCtx()` 调用（L302）。

dispatch() 在 execFileSync 成功后的步骤从：
```
writeAutoDispatchQueue → writeDispatchCtx → dbWriteSessionMap(父) → dbWriteSessionMap(子) → execFileSync(返回prompt)
```
简化为：
```
dbWriteSessionMap(父) → dbWriteSessionMap(子) → execFileSync(返回prompt)
```

#### 3.3.8 精简 lifecycle.ts

移除 Step 9 `.pending.json` 清理（L221-245），因文件不再存在。

### 3.4 与现有机制的关系

| 机制 | 关系 |
|------|------|
| `dispatch_queue` DB 表 | **升为唯一队列真实源**（无 schema 变更） |
| `dispatch_prompt_refs` DB 表 | **升为 prompt 文件唯一索引**（无变更） |
| `session_map` DB 表 | **替代 ctx/*.json**（无变更，字段已覆盖） |
| `dispatch_failed_log` DB 表 | 不变（仍由 lifecycle.ts expire 触发归档） |
| DISPATCH_TOKEN 校验 | **不变**（独立于存储层） |
| before-hook: task.ts | 调用 `consumeDispatchMarker()` 签名不变 |
| after-hook: dispatch.ts | 调用 `cleanupDispatch()` + `reclaimAutoDispatch()` 签名不变 |
| project.config.json | 不变（bypass agents 配置不受影响） |

---

## 四、实施清单

### 4.1 文件变更列表

| 序号 | 文件 | 变更类型 | 说明 |
|------|------|---------|------|
| 1 | `service/dispatch/queue.ts` | 修改 | 新增 `dbFindPendingDispatch()` + `dbCheckDuplicateDispatch()` + 改造 `dbDequeueWithLease()` 加 status 守卫（并发安全加固 3.3.2a） |
| 2 | `service/dispatch/marker-consume.ts` | **重写** | 移除文件读取（~110 行），改为 DB-first 查询 + prompt 文件读取（日志统一走 writeLog→_logs/） |
| 3 | `service/dispatch/router.ts` | 修改 | 删除 `writeAutoDispatchQueue()` 函数（~83 行）+ 移除调用 + 删除 `writeDispatchCtx()` 调用 |
| 4 | `service/dispatch/cleanup.ts` | 修改 | 删除 `.pending.json` stale drain 逻辑（~52 行） |
| 5 | `service/dispatch/auto-cleanup.ts` | 修改 | 删除文件清理逻辑（~63 行），仅保留 `dbCleanStaleLeases()` |
| 6 | `scripts/command-tools/dispatch-subagent.ts` | 修改 | 删除 `.pending.json` 写入（~27 行），增加去重 DB 查询 |
| 7 | `service/session/lifecycle.ts` | 修改 | 删除 Step 9 `.pending.json` 清理（~25 行） |
| 8 | `lib/dispatch-db.ts` | 修改 | re-export 新增的 `dbFindPendingDispatch` + `dbCheckDuplicateDispatch` |
| 9 | `service/dispatch/index.ts` | 修改 | re-export 新增函数 |
| 10 | `scripts/framework-self-test.ts` | 修改 | Check 33 改为验证文件不存在 + DB-only 验证；更新 L6039-6089 双写移除 check |

**净效果**：删除约 **360 行**文件操作代码，新增约 **40 行** DB 查询代码。

### 4.2 实施步骤

**Phase 1: 基础设施层（DB 查询函数 + 并发安全加固）**
1. `queue.ts` 新增 `dbFindPendingDispatch()` 和 `dbCheckDuplicateDispatch()`
2. `queue.ts` 改造 `dbDequeueWithLease()`：UPDATE 加 `AND status = 'pending'` 守卫 + `result.changes === 0` 检查（3.3.2a）
3. `dispatch-db.ts` 和 `index.ts` 添加 re-export
4. 验证：bun run 单元测试，含并发 dequeue 竞争测试

**Phase 2: 写入侧迁移（移除文件写入）**
4. `dispatch-subagent.ts`：移除 `.pending.json` 写入，增加 `dbCheckDuplicateDispatch()` 去重
5. `router.ts`：删除 `writeAutoDispatchQueue()` 函数 + L292 调用；删除 `writeDispatchCtx()` L302 调用
6. 验证：ACP 创建 session → dispatch_subagent → 确认 DB 有记录、无文件生成

**Phase 3: 消费侧迁移（marker-consume 改造）**
7. `marker-consume.ts`：移除文件读取（L63-164），改为 `dbFindPendingDispatch()` + 读 prompt blob + DISPATCH_TOKEN 校验
8. 验证：ACP dispatch_subagent → Task() 完整链路，确认 prompt 注入正确、TOKEN 校验通过

**Phase 4: 清理侧精简**
9. `cleanup.ts`：删除 `.pending.json` stale drain
10. `auto-cleanup.ts`：删除文件清理逻辑
11. `lifecycle.ts`：删除 Step 9
12. 验证：多次 dispatch 后确认 DB lease reclaim + 24h expire 正常工作

**Phase 5: 验证与 self-test 更新**
13. `framework-self-test.ts`：更新 Check 33 + L6039-6089
14. 端到端 ACP 测试：Orchestrator dispatch @Knowledge-Curator 完整流程
15. bun cache 清理 + serve 重启

---

## 五、验证计划

### 5.1 单元测试

- [ ] `dbFindPendingDispatch(agentType)` 返回正确的 `{queueId, filePath, sha256}`
- [ ] `dbFindPendingDispatch(agentType)` 无 pending 时返回 `null`
- [ ] `dbFindPendingDispatch` 按 `created_at ASC` 排序（FIFO）
- [ ] `dbCheckDuplicateDispatch(agentType, dagTaskId)` 存在 pending 时返回 `true`
- [ ] `dbCheckDuplicateDispatch(agentType, dagTaskId)` 存在 running 时返回 `true`
- [ ] `dbCheckDuplicateDispatch(agentType, dagTaskId)` 仅 consumed/failed/stale 时返回 `false`
- [ ] `dbCheckDuplicateDispatch` 不同 dagTaskId 不匹配

**并发安全测试（3.3.2a 加固验证）：**
- [ ] `dbDequeueWithLease` 并发调用：两个事务同时 dequeue 同一 agentType，仅一个成功返回 entry，另一个返回 null（`result.changes === 0`）
- [ ] `dbDequeueWithLease` UPDATE 带 `AND status = 'pending'`：已变 running 的记录不被二次消费
- [ ] `dbDequeueWithLease` lease 过期后 `dbCleanStaleLeases()` 正确标记为 stale

### 5.2 集成测试

- [ ] CLI 脚本 `dispatch-subagent.ts` 执行后：`dispatch_queue` 有 pending 记录、`dispatch_prompt_refs` 有文件记录、`.pending.json` 不存在、prompt blob 文件存在
- [ ] `router.ts::dispatch()` 执行后：`session_map` 有父/子记录、`ctx/` 目录无新文件、`.auto-dispatch.json` 不存在
- [ ] `marker-consume.ts` 消费后：`dispatch_queue` 状态变为 running + lease、prompt blob 被正确读取、DISPATCH_TOKEN 校验通过
- [ ] DISPATCH_TOKEN 篡改场景：修改 prompt 内容后 SHA-256 不匹配 → blocked=true
- [ ] bypass agent 场景：`dispatch_integrity_bypass_agents` 中的 agent 跳过 TOKEN 校验
- [ ] `cleanupDispatch` 执行后：`_dispatch_target.json` 被删除、无文件操作错误
- [ ] `reclaimAutoDispatch` 执行后：`dbCleanStaleLeases()` 正确回收过期 lease

### 5.3 端到端测试（ACP 实测）

- [ ] Orchestrator dispatch @Knowledge-Curator → sub-agent 成功启动并执行任务
- [ ] Orchestrator dispatch @Coder-BE → sub-agent 成功启动（多 agent 场景）
- [ ] dispatch_subagent 返回 prompt → Task() 使用前 prompt 被完整替换（含 compliance rules）
- [ ] 重复 dispatch（同 agentType + dagTaskId）被去重阻断
- [ ] Orphan 场景：dispatch_subagent 后不调 Task()，DB 中 pending 记录 24h 后被 expire
- [ ] `framework-self-test` Check 33 通过

---

## 六、风险与缓解

### 6.1 风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| DB 不可用时 dispatch 完全失败 | 高（当前文件队列在 DB 不可用时可降级） | `marker-consume.ts` 保留 DB 不可用时的 fallback 错误路径：返回 `blocked: true` + `DISPATCH-DB-UNAVAILABLE`，而非静默通过。框架 DB 与框架进程同生命周期，DB 不可用 = 框架不可用 |
| CLI 脚本 `dbEnqueueDispatch` 失败 | 中（当前 DB 写入在 CLI 脚本中是 non-fatal） | 将 `dbEnqueueDispatch` 提升为 fatal：失败时 CLI 脚本 exit(1)，router.ts catch execFileSync 异常并返回错误给调用者。DB 不可用 = dispatch 不可用 |
| prompt blob 文件读取失败 | 中（文件路径来自 DB，但文件可能被外部删除） | `dbFindPendingDispatch` 返回 filePath 后，读取前检查 `fs.existsSync()`；不存在则返回 `blocked: true` + `DISPATCH-PROMPT-FILE-MISSING` |
| 并发 dispatch 竞争同一 agentType 的 pending 记录 | 中 | `dbDequeueWithLease()` 改造（3.3.2a）：UPDATE 加 `AND status = 'pending'` 守卫 + 检查 `result.changes === 0`；可选 `BEGIN IMMEDIATE` 消除 SHARED→EXCLUSIVE 升级窗口 |

### 6.2 回滚方案

1. `git revert` 恢复所有文件变更
2. `rm -rf ~/.cache/bun` 清理 bun 缓存
3. 重启 `serve`
4. 无 DB schema 变更，无需 DB 回滚

### 6.3 数据迁移

**无需数据迁移。** 旧文件（`.pending.json`、`.auto-dispatch.json`、`ctx/*.json`）在迁移后不再被读写，由下次 `lifecycle.ts` 启动或 `nightly-compaction.ts` 自动清理。如需立即清理，手动 `rm .task_temp/_dispatch/.pending.json .task_temp/_dispatch/.auto-dispatch.json` 即可。

---

## 七、成功标准

- [ ] `.pending.json` 不再被创建或读写（全局搜索零引用）
- [ ] `.auto-dispatch.json` 和 `.auto-dispatch` 不再被创建或读写（全局搜索零引用）
- [ ] `ctx/{dagTaskId}.json` 不再被创建（全局搜索 `writeDispatchCtx` 零调用）
- [ ] ACP 端到端 dispatch 成功率 ≥ 实施前水平
- [ ] DISPATCH_TOKEN 篡改检测正常阻断
- [ ] `framework-self-test` 全部 check 通过
- [ ] 代码净减少 ≥ 300 行
- [ ] `dispatch_queue` DB 表成为唯一队列真实源，无文件级并行队列

---

## 八、附录

### 8.1 相关文件索引

| 文件 | 行数 | 角色 |
|------|------|------|
| `service/dispatch/router.ts` | 459 | dispatch() 主函数 + writeAutoDispatchQueue + writeDispatchCtx |
| `service/dispatch/marker-consume.ts` | 260 | consumeDispatchMarker — 文件消费 + TOKEN 校验 |
| `service/dispatch/queue.ts` | 260 | dispatch_queue DB CRUD |
| `service/dispatch/cleanup.ts` | 151 | .pending.json stale drain |
| `service/dispatch/auto-cleanup.ts` | 112 | .auto-dispatch.json 文件清理 |
| `scripts/command-tools/dispatch-subagent.ts` | 121 | CLI 薄壳 — prompt 构建 + 文件/DB 双写 |
| `service/session/lifecycle.ts` | 466 | Step 4 (DB expire) + Step 9 (.pending.json cleanup) |
| `lib/db-manager.ts` | 2629 | Schema 定义 + 7 天 compaction |
| `lib/db-state-manager.ts` | 1949 | dispatch_failed_log 归档 + session_map CRUD |
| `lib/dispatch-db.ts` | 30 | thin re-export bridge |
| `service/dispatch/session-log.ts` | 154 | 诊断查询 |
| `plugin-handlers/before/task.ts` | — | 调用 consumeDispatchMarker |
| `plugin-handlers/after/dispatch.ts` | — | 调用 cleanupDispatch + reclaimAutoDispatch |
| `scripts/framework-self-test.ts` | — | Check 33 + L6039 双写验证 |

### 8.2 DB 表 schema（不变，仅供参考）

```sql
-- dispatch_queue: 唯一队列真实源
CREATE TABLE dispatch_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending/running/consumed/failed/stale/expired
  agent_type    TEXT NOT NULL,
  dag_task_id   TEXT NOT NULL,
  session_id    TEXT,
  prompt_ref_id INTEGER REFERENCES dispatch_prompt_refs(id),
  lease_owner   TEXT,
  lease_expiry  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- dispatch_prompt_refs: prompt blob 文件索引
CREATE TABLE dispatch_prompt_refs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path  TEXT NOT NULL,
  sha256     TEXT,
  size_bytes INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- session_map: 替代 ctx/*.json
CREATE TABLE session_map (
  session_id TEXT PRIMARY KEY,
  agent      TEXT NOT NULL,
  dag_task_id TEXT,
  domain_id  TEXT,
  parent_id  TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```
