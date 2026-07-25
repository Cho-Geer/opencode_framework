# Gate Approval 死循环 + GATE-APPROVAL-LOCK 单线程阻塞 — 根因与解决方案

**日期**: 2026-06-27
**版本**: v1.0.0
**作者**: @Super-Admin
**状态**: 根因已确认，方案待实施
**影响范围**: `gate_sessions` SQLite 表 / `dispatch-before.ts` / `compliance-gate.ts` / `session.ts` / `gate-core.ts` / `db-state-manager.ts`

---

## 0. 执行摘要

本次分析揭示两个相互耦合的严重缺陷，共同导致多智能体管道陷入死循环与单线程序列化：

| 问题 | 根因 | 严重度 |
|---|---|---|
| **P1**：Orchestrator approve 后 DB 未更新 → 反复 approve/reject → session 状态振荡（armed ↔ delivered ↔ approved）→ 死循环 | gate_sessions 存在**双写者竞态**（`dbSaveGateStore` 的 DELETE+INSERT 全量重写 vs `session.ts` 的 raw SQL UPDATE）+ **`saveGateStore()` 静默吞错**（`gate-core.ts:759-769` try/catch 仅写日志不抛错）+ **approve 不写 `consumed_at`**（`compliance-gate.ts:2826`） | P0 严重 |
| **P2**：`GATE-APPROVAL-LOCK` 单线程序列化所有 `dispatch_subagent` 调用 | 锁查询是**全局无差别扫描**（无 session/task/agent 过滤）+ **DAG-exempt bypass 在锁之后**（dispatch-before.ts:405 永远到不了）+ **approve 不释放锁**（approved 状态仍在锁查询 `status IN ('delivered','approved')` 中） | P0 严重 |

两者叠加效果：Orchestrator approve → DB 未持久化 → 锁持续命中 → 无法派遣下一个 subagent → 重试 approve → `saveGateStore` 与 `session.ts` 相互覆盖 → 状态振荡 → 死循环。

---

## 1. 问题重述

### 1.1 现象

```
Orchestrator → approve session X → (DB 未更新)
          → 再次 approve session X → reject
          → 再次 approve session X → session X 状态变 armed（不是 delivered）
          → 死循环
          → 同时：所有 dispatch_subagent 被 GATE-APPROVAL-LOCK 阻断
          → 即使派遣 @Meta-Planner/@Super-Admin 等 DAG-exempt agent 也被阻断
```

### 1.2 日志证据（2026-06-27）

**Episode 1** — `cg_ses_1782520243407`（00:44-00:46 UTC，2.5 分钟内 7 次阻断）：
```
00:44:09 | ERROR | GATE-APPROVAL-LOCK | 1 unapproved: cg_ses_1782520243407
00:44:28 | ERROR | GATE-APPROVAL-LOCK | 1 unapproved: cg_ses_1782520243407
00:44:35 | ERROR | GATE-APPROVAL-LOCK | 1 unapproved: cg_ses_1782520243407
00:45:18 | ERROR | GATE-APPROVAL-LOCK | 1 unapproved: cg_ses_1782520243407
00:45:55 | ERROR | GATE-APPROVAL-LOCK | 1 unapproved: cg_ses_1782520243407
00:46:14 | ERROR | GATE-APPROVAL-LOCK | 1 unapproved: cg_ses_1782520243407
00:46:29 | ERROR | GATE-APPROVAL-LOCK | 1 unapproved: cg_ses_1782520243407
```

**Episode 2** — `cg_ses_1782527300870`（04:07-04:10 UTC，5 次阻断；目标是 DAG-exempt 的 @Super-Admin）：
```
04:07:26 | ERROR | GATE-APPROVAL-LOCK | 1 unapproved: cg_ses_1782527300870  ← target @Super-Admin
04:08:21 | ERROR | GATE-APPROVAL-LOCK | 1 unapproved: cg_ses_1782527300870
04:08:27 | ERROR | GATE-APPROVAL-LOCK | 1 unapproved: cg_ses_1782527300870
04:09:02 | ERROR | GATE-APPROVAL-LOCK | 1 unapproved: cg_ses_1782527300870
04:09:14 | ERROR | GATE-APPROVAL-LOCK | 1 unapproved: cg_ses_1782527300870
04:10:24 | INFO  | DISPATCH-BEFORE   | exit (pass) | target @Super-Admin is DAG-exempt  ← 锁释放后才通过
```

---

## 2. 状态机与写路径盘点

### 2.1 `gate_sessions.status` 全值域

`db-manager.ts:200-226` 的 schema 与当前代码使用 9 种状态：

```
            ┌───────────────────────────────────────────┐
            │             gate_sessions 状态机           │
            └───────────────────────────────────────────┘

  checked ──► armed ──► confirmed ──► delivered ──► approved ──► completed
                 │                      │              │
                 │                      │              └──► drained (stale)
                 │                      └──► drained (stale / post-write)
                 └──► drained (interrupt orphans / stale)

  (任何状态) ──► archived (历史归档)
```

### 2.2 所有 SQL 写路径（8 处）

| # | 写路径 | 文件:行 | 写入方式 | 并发安全 |
|---|--------|---------|----------|----------|
| W1 | MCP server 全量重写 | `db-state-manager.ts:469-483` | `DELETE FROM gate_sessions` + 逐行 `INSERT` | ⚠️ **DELETE+INSERT 全表重写**，与 W2/W3 竞态 |
| W2 | session.ts drain  delivered/approved | `session.ts:170-174` | raw `UPDATE gate_sessions SET status='drained'` | ✅ 独立 UPDATE |
| W3 | session.ts drain armed | `session.ts:211-219` | raw `UPDATE gate_sessions SET status='drained'` | ✅ 独立 UPDATE |
| W4 | gate-core drain stale | `gate-core.ts:1480` | raw `UPDATE gate_sessions SET status='drained'` | ✅ 独立 UPDATE |
| W5 | db-state-manager archive | `db-state-manager.ts:811` | raw `UPDATE gate_sessions SET status='archived'` | ✅ 独立 UPDATE |
| W6 | db-state-manager drain | `db-state-manager.ts:837` | raw `UPDATE gate_sessions SET status='drained'` | ✅ 独立 UPDATE |
| W7 | db-state-manager INSERT OR REPLACE（两个内部路径） | `db-state-manager.ts:748, 773` | `INSERT OR REPLACE` | ⚠️ 与 W1 冲突 |
| W8 | gate_session_index 同步 | `db-state-manager.ts:527-531` | `INSERT OR REPLACE INTO gate_session_index` | ✅ 独立表 |

**核心问题**：W1（MCP server 路径）使用 **DELETE + INSERT 全表重写**，与 W2/W3（session.ts 的 raw UPDATE）相互覆盖。

---

## 3. 根因诊断

### 3.1 根因 A：双写者竞态（P1 的主因）

**机制**：

1. MCP server 的 `compliance_gate_approve_deliverables`（`compliance-gate.ts:2823-2826`）修改**内存** `store.sessions[id].gate_status = "approved"`。
2. 调用 `saveGateStore(store)`（`gate-core.ts:759-769`）→ `dbSaveGateStore(store)`（`db-state-manager.ts:448-511`）。
3. `dbSaveGateStore` 执行：
   ```sql
   DELETE FROM gate_sessions;        -- L469: 全表删除
   INSERT INTO gate_sessions (...); -- L472-483: 逐行从内存 store 重写
   ```
4. **同一时刻**，`session.ts` 的启动清理逻辑（`session.ts:170-174`）执行：
   ```sql
   UPDATE gate_sessions SET status = 'drained', updated_at = ?
     WHERE status IN ('delivered', 'approved') AND consumed_at IS NULL AND created_at < ?
   ```
5. **竞态时序**（任一顺序都会丢失更新）：
   - **Order A**: W1 DELETE+INSERT → W2 UPDATE 命中新插入行 → 状态被改回 drained。approve 丢失。
   - **Order B**: W2 UPDATE 先执行（delivered→drained）→ W1 DELETE+INSERT 用内存中的旧状态（approved）覆盖 → 状态回退到 approved 但**其他字段**被 session.ts 的写入覆盖。
   - **Order C（最隐蔽）**: MCP approve 改内存 → session.ts drain 把内存中的同一个 store 对象的某个 session 字段也改了 → W1 写入时，approved 状态已被 drain 状态覆盖。

### 3.2 根因 B：`saveGateStore()` 静默吞错

**证据**: `gate-core.ts:759-769`:
```ts
export function saveGateStore(store: GateStore, root?: string): void {
  try {
    dbSaveGateStore(store);
  } catch (e: any) {
    writeLogSafe(SRC, "ERROR", {
      event: "DB-SAVE-GATE-FAILED",
      detail: e.message,
    });
    // ← 吞掉异常！调用方无感知
  }
}
```

**`dbSaveGateStore` 本身** (`db-state-manager.ts:448-511`) 虽然返回 `boolean`，但 `saveGateStore` 不传回此返回值，且 catch 吞错。MCP 工具的 `approve_deliverables` 链式调用 `saveGateStore` 后无法知道 DB 写是否成功。

### 3.3 根因 C：approve 不写 `consumed_at`（锁永不释放）

**证据**: `compliance-gate.ts:2823-2826`:
```ts
session.deliverables_approved_by = "Orchestrator";
session.deliverables_approved_at = now;
session.deliverables_approval_note = approvalNote || null;
session.gate_status = "approved";
// ← 无 consumed_at = now；
// ← 无 gate_status = "completed"；
```

仅当提供 `executionSummary` 时才 auto-complete（`compliance-gate.ts:2864-2866`）：
```ts
if (executionSummary) {
  session.gate_status = "completed";
  session.consumed_at = now;
  ...
}
```

**但 Orchestrator 标准 approve 流程**（工具 description 中指引）是传 `handover_sha256 + execution_summary`。**若 Orchestrator 省略 execution_summary**，approve 后 `gate_status='approved'` + `consumed_at=NULL`，**仍在锁查询 `status IN ('delivered','approved') AND consumed_at IS NULL` 中**，锁持续命中。

### 3.4 根因 D：GATE-APPROVAL-LOCK 是全局无差别扫描

**证据**: `dispatch-before.ts:363-370`:
```ts
const rows = db
  .query(
    `SELECT session_id FROM gate_sessions
     WHERE status IN ('delivered', 'approved')
       AND consumed_at IS NULL
       AND updated_at > ?`,
  )
  .all(staleCutoff) as Array<{ session_id: string }>;
```

无 `session_id = ?`、无 `task_id = ?`、无 `agent = ?`、无 `caller = ?` 过滤。**单 session 未 approve 即阻塞所有 dispatch_subagent 调用，包括完全不相关的任务/Agent。**

### 3.5 根因 E：DAG-exempt bypass 在锁之后

**证据**: `dispatch-before.ts:325-414`:
```
L325-402  GATE-APPROVAL-LOCK check（先跑）
L405-414  isDagExempt(target) bypass（后跑，被锁挡住）
```

即使 dispatch 目标是 `@Meta-Planner / @Orchestrator / @Super-Admin / @Knowledge-Curator` 这四个 DAG-exempt agent，**锁先 throw，bypass 永远到不了**。日志 Episode 2 直接印证此现象。

### 3.6 根因 F：Stale threshold 读取不一致

- `dispatch-before.ts:359` 仅读 `delivered_hours`。
- `session.ts:164-166` 读 `delivered_hours` 与 `approved_hours` 取最大。

`project.config.json` 配置 `approved_hours=4` 在 dispatch-before 中**不生效**，导致 approved 状态永远用 delivered_hours 阈值，行为不一致。

---

## 4. 根因叠加导致死循环的时序

```
T0: Sub-agent A 完成 → submit_deliverables → gate_status='delivered', consumed_at=NULL
     → LOCK ENGAGED

T1: Orchestrator 调用 approve_deliverables(id, "approve", handover_sha256)
     → 内存 store: gate_status='approved'
     → saveGateStore → DELETE + INSERT 到 DB: gate_status='approved', consumed_at=NULL
     → LOCK 仍命中（status='approved' AND consumed_at IS NULL）

T2: session.ts 启动清理跑：
     UPDATE gate_sessions SET status='drained'
     WHERE status IN ('delivered','approved') AND created_at < cutoff
     → 命中 T1 插入的行 → DB: gate_status='drained'

T3: Orchestrator 再次查询 gate_sessions → 发现状态是 'drained'（不是 'approved'）
     → 误判 approve 失败 → 重试 approve

T4: Orchestrator 第二次 approve → MCP server 内存 store 已是 'approved'（旧对象）
     → saveGateStore DELETE+INSERT → DB 又变回 'approved'

T5: session.ts drain 再次跑 → DB 又变 'drained'

T6: 状态振荡开始：approved ↔ drained ↔ armed（re-arm 路径略）

T7: 同时：LOCK 持续命中（任一时刻 status='delivered' 或 'approved' 总有一行 consumed_at IS NULL）
     → 所有 dispatch_subagent 被阻断
```

---

## 5. 解决方案

### 5.1 方案总览

| 修复项 | 解决根因 | 文件 | 复杂度 |
|---|---|---|---|
| **F1**: 统一写路径（DELETE+INSERT → 单行 UPDATE） | A, B | `db-state-manager.ts` | 中 |
| **F2**: 乐观锁（`version` 列 + 冲突重试） | A | `db-manager.ts`, `db-state-manager.ts` | 中 |
| **F3**: approve 必写 `consumed_at`（auto-complete 默认） | C | `compliance-gate.ts` | 低 |
| **F4**: GATE-APPROVAL-LOCK scope 收窄（按 caller task_id/agent） | D | `dispatch-before.ts` | 低 |
| **F5**: DAG-exempt bypass 提前到锁之前 | E | `dispatch-before.ts` | 低 |
| **F6**: Stale threshold 统一读取 | F | `dispatch-before.ts` | 低 |
| **F7**: 新增 `compliance_gate_bulk_review_deliverables` MCP 工具 | D (pipeline) | `compliance-gate.ts` | 中 |
| **F8**: Status transition audit log + error surfacing | A, B | `gate-core.ts`, `db-state-manager.ts` | 低 |

### 5.2 子系统符合性矩阵

| 子系统 | F1 | F2 | F3 | F4 | F5 | F6 | F7 | F8 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Layout Architecture（不新增文件） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| DB-only / DB-canonical | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Permission Matrix（不引入新权限） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Session/Task Concurrency Safe | ✅ | ✅✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Hardened Enforcement（advisory/strict/locked） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Framework Harness（withPluginLifecycle） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Central State Management（readSubState/atomicWriteSubState 模式） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multi-Agent | ✅ | ✅ | ✅ | ✅✅ | ✅ | ✅ | ✅✅ | ✅ |
| Log Central Management（writeLog + runtime category + level） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅✅ |
| DB-canonical Management（无 JSON dual-write） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Templatization & Parameterization | ✅ | ✅ | ✅ | ✅✅ | ✅ | ✅ | ✅ | ✅ |
| TypeScript + Bun Runtime | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

> F2 的乐观锁特别加强 Session/Concurrency Safe；F4/F5 特别加强 Multi-Agent（避免单 session 阻塞不相关 agent）。

---

## 6. 详细实施

### 6.1 F1：统一写路径（DELETE+INSERT → 单行 UPDATE）

**目标**：消除 `dbSaveGateStore` 的 DELETE+INSERT 全表重写，改为 per-session UPDATE/UPSERT。

**修改**: `db-state-manager.ts:448-511`（替换 `dbSaveGateStore` 主体）：

```ts
export function dbSaveGateStore(store: any): boolean {
  try {
    const db = getDb();
    const now = Date.now();

    const txn = db.transaction((s: any) => {
      // Save meta (unchanged)
      db.run("DELETE FROM gate_store_meta");
      const metaEntries: Array<[string, any]> = [
        ["formatVersion", s.formatVersion || "2.0"],
        ["last_updated", s.last_updated || new Date().toISOString()],
        ["active_sessions", s.active_sessions || []],
      ];
      for (const [k, v] of metaEntries) {
        db.run(
          "INSERT OR REPLACE INTO gate_store_meta (key, value, updated_at) VALUES (?, ?, ?)",
          [k, JSON.stringify(v), now],
        );
      }

      // Per-session UPSERT（替代 DELETE+INSERT）
      const sessions = s.sessions || {};
      const upsert = db.prepare(`
        INSERT INTO gate_sessions (
          session_id, task_desc, status, agent, task_id, plan_summary,
          execution_summary, mode, checked_at, armed_at, completed_at, drained_at,
          created_at, consumed_at, expires_at, enforcement_mode, last_check_passed,
          failed_items, missing_artifacts, fail_reason, worktree, audit, updated_at,
          declared_deliverables, submitted_deliverables, deliverables_approved_by,
          deliverables_approved_at, deliverables_approval_note, approval_required,
          version
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, 1
        )
        ON CONFLICT(session_id) DO UPDATE SET
          task_desc = excluded.task_desc,
          status = excluded.status,
          agent = excluded.agent,
          task_id = excluded.task_id,
          plan_summary = excluded.plan_summary,
          execution_summary = excluded.execution_summary,
          mode = excluded.mode,
          checked_at = excluded.checked_at,
          armed_at = excluded.armed_at,
          completed_at = excluded.completed_at,
          consumed_at = excluded.consumed_at,
          expires_at = excluded.expires_at,
          enforcement_mode = excluded.enforcement_mode,
          last_check_passed = excluded.last_check_passed,
          failed_items = excluded.failed_items,
          missing_artifacts = excluded.missing_artifacts,
          fail_reason = excluded.fail_reason,
          worktree = excluded.worktree,
          audit = excluded.audit,
          updated_at = excluded.updated_at,
          declared_deliverables = excluded.declared_deliverables,
          submitted_deliverables = excluded.submitted_deliverables,
          deliverables_approved_by = excluded.deliverables_approved_by,
          deliverables_approved_at = excluded.deliverables_approved_at,
          deliverables_approval_note = excluded.deliverables_approval_note,
          approval_required = excluded.approval_required,
          version = gate_sessions.version + 1
      `);

      for (const [sid, ses] of Object.entries(sessions) as Array<[string, any]>) {
        upsert.run(
          sid,
          ses.task_description || "",
          ses.gate_status || "checked",
          ses.agent || null,
          ses.task_id || null,
          /* ... 其余字段同原 INSERT ... */
          now,
        );
      }

      // Detect sessions removed from memory but still in DB → mark archived
      const memIds = new Set(Object.keys(sessions));
      const dbRows = db.query(`SELECT session_id FROM gate_sessions`).all() as Array<{ session_id: string }>;
      for (const { session_id } of dbRows) {
        if (!memIds.has(session_id)) {
          db.run(
            `UPDATE gate_sessions SET status = 'archived', updated_at = ? WHERE session_id = ?`,
            [now, session_id],
          );
        }
      }

      // Sync index + audit_history（保留现有逻辑）
      /* ... 原 L527-549 ... */
    });

    txn(store);
    return true;
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-SAVE-GATE-STORE-FAILED",
      detail: e.message,
    });
    return false;
  }
}
```

**关键改进**：
- `ON CONFLICT DO UPDATE` 替代 DELETE+INSERT，**仅修改内存中存在的 session**，不触碰其他 session。
- `version = gate_sessions.version + 1` 自动递增，配合 F2 乐观锁。
- 保留 audit_history 与 gate_session_index 同步逻辑。

### 6.2 F2：乐观锁（`version` 列 + 冲突重试）

**6.2.1 Schema 变更**: `db-manager.ts:200-226`:

```ts
db.run(`
  CREATE TABLE IF NOT EXISTS gate_sessions (
    session_id        TEXT PRIMARY KEY,
    /* ... 原有 24 列 ... */
    version           INTEGER NOT NULL DEFAULT 1,
    updated_at        INTEGER NOT NULL
  )
`);
// 迁移：为已存在表补 version 列
try {
  db.run(`ALTER TABLE gate_sessions ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
} catch { /* 列已存在 */ }
```

**6.2.2 写 API**: 新增 `dbAtomicUpdateGateSession()`:

```ts
// db-state-manager.ts 新增
export function dbAtomicUpdateGateSession(
  sessionId: string,
  modifier: (row: any) => any,
): { ok: boolean; newVersion: number; staleRetries: number } {
  const db = getDb();
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const txn = db.transaction(() => {
      const row = db.query(
        `SELECT *, version FROM gate_sessions WHERE session_id = ?`,
      ).get(sessionId) as any;
      if (!row) return { ok: false, reason: "NOT_FOUND" };

      const currentVersion = row.version;
      const updated = modifier({ ...row });

      const result = db.run(
        `UPDATE gate_sessions
         SET status = ?, consumed_at = ?, completed_at = ?, updated_at = ?,
             audit = ?, version = version + 1
         WHERE session_id = ? AND version = ?`,
        [
          updated.status, updated.consumed_at, updated.completed_at, Date.now(),
          JSON.stringify(updated.audit || null), sessionId, currentVersion,
        ],
      );
      if (result.changes === 0) {
        throw new Error("OPTIMISTIC_LOCK_CONFLICT");
      }
      return { ok: true, newVersion: currentVersion + 1 };
    });

    try {
      const r = txn();
      if (r.ok) return { ok: true, newVersion: r.newVersion, staleRetries: attempt };
    } catch (e: any) {
      if (e.message !== "OPTIMISTIC_LOCK_CONFLICT") throw e;
      // 重试
      writeLog(SRC, "WARN", {
        event: "GATE-SESSION-OPTIMISTIC-RETRY",
        detail: `session=${sessionId} attempt=${attempt + 1}`,
      });
    }
  }
  writeLog(SRC, "ERROR", {
    event: "GATE-SESSION-OPTIMISTIC-EXHAUSTED",
    level: "ERROR",
    detail: `session=${sessionId} retries=${MAX_RETRIES}`,
  });
  return { ok: false, newVersion: 0, staleRetries: MAX_RETRIES };
}
```

**6.2.3 `saveGateStore` 改造**: 抛错而非吞错。

```ts
// gate-core.ts:759
export function saveGateStore(store: GateStore, root?: string): boolean {
  try {
    const ok = dbSaveGateStore(store);
    if (!ok) {
      writeLogSafe(SRC, "ERROR", {
        event: "DB-SAVE-GATE-FAILED",
        level: "ERROR",
        detail: "dbSaveGateStore returned false",
      });
    }
    return ok;
  } catch (e: any) {
    writeLogSafe(SRC, "ERROR", {
      event: "DB-SAVE-GATE-FAILED",
      level: "ERROR",
      detail: e.message,
    });
    return false;  // 明确失败信号
  }
}
```

MCP `approve_deliverables` 调用方必须检查返回值，失败时返回 `{status: "rejected", reason: "DB write failed: ..."}`。

### 6.3 F3：approve 必写 `consumed_at`（锁必释放）

**修改**: `compliance-gate.ts:2823-2880`:

```ts
session.deliverables_approved_by = "Orchestrator";
session.deliverables_approved_at = now;
session.deliverables_approval_note = approvalNote || null;
session.gate_status = "approved";
session.consumed_at = now;  // ← 新增：approve 即视为消费，释放 GATE-APPROVAL-LOCK

// Auto-complete if execution_summary provided（保留）
if (executionSummary) {
  session.gate_status = "completed";
  // consumed_at already set above
  /* ... 原 checklist wire + active_sessions filter ... */
} else {
  // 无 executionSummary：保持 approved，但已 consumed
  // 记录 approved-but-not-completed 标记，由 stale 阈值兜底
  writeLog("mcp-compliance-gate", "runtime", {
    sessionID: gateSessionId,
    agent: resolvedAgent,
    level: "WARN",
    event: "APPROVED-WITHOUT-EXECUTION-SUMMARY",
    detail: `session=${gateSessionId} consumed_at=${now} but gate_status='approved' (not completed)`,
  });
}
```

**效果**：approve 后 `consumed_at` 始终非 NULL，锁查询 `status IN ('delivered','approved') AND consumed_at IS NULL` 不再命中。

### 6.4 F4：GATE-APPROVAL-LOCK scope 收窄

**修改**: `dispatch-before.ts:325-402` 替换为：

```ts
// ── GATE-APPROVAL-LOCK v2: Scope to same (caller_session_id OR task_id OR agent) ──
{
  let blockingSessions: string[] = [];
  try {
    const { getDb } = require("../lib/db-manager");
    const db = getDb();
    if (db) {
      // 统一读取两个阈值
      const configPath = path.join(
        process.env.OPENCODE_ROOT || process.cwd(),
        ".opencode",
        "project.config.json",
      );
      let deliveredHours = 4, approvedHours = 4;
      try {
        const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
        const t = cfg?.gate_stale_thresholds;
        if (t?.delivered_hours) deliveredHours = t.delivered_hours;
        if (t?.approved_hours) approvedHours = t.approved_hours;
      } catch {}
      const now = Date.now();
      const deliveredCutoff = now - deliveredHours * 3600000;
      const approvedCutoff = now - approvedHours * 3600000;

      const callerSession = input.sessionID;
      const callerTask = resolveTaskId(input.sessionID) || null;
      const callerAgent = caller || null;

      // Scope：同一 caller session / 同一 task / 同一 caller agent 名下未消费 session
      // 不相关 task 或完全不相关的 agent 不应阻塞当前 dispatch
      const rows = db.query(`
        SELECT session_id, task_id, agent, status
        FROM gate_sessions
        WHERE status IN ('delivered', 'approved')
          AND consumed_at IS NULL
          AND (
            (status = 'delivered' AND updated_at > ?)
            OR (status = 'approved' AND updated_at > ?)
          )
          AND (
            ? IS NOT NULL AND task_id = ?
            OR ? IS NOT NULL AND agent = ?
            OR ? IS NOT NULL AND session_id = ?
          )
      `).all(
        deliveredCutoff, approvedCutoff,
        callerTask, callerTask,
        callerAgent, callerAgent,
        callerSession, callerSession,
      ) as Array<{ session_id: string; status: string; task_id: string; agent: string }>;

      blockingSessions = rows.map((r) => r.session_id);
    }
  } catch (e: any) {
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent: caller,
      level: "ERROR",
      event: "GATE-APPROVAL-LOCK-QUERY-FAILED",
      detail: e.message?.substring(0, 300),
    });
    // fail-closed 在 strict/locked，但记录事件便于诊断
  }

  if (blockingSessions.length > 0) {
    const msg =
      `[FW-ENFORCE][GATE-APPROVAL-LOCK-v2] Cannot dispatch — ` +
      `${blockingSessions.length} related session(s) awaiting approval: ` +
      `${blockingSessions.join(", ")}. ` +
      `Call compliance_gate_approve_deliverables or compliance_gate_bulk_review_deliverables.`;
    writeLog("dispatch-before", "runtime", {
      sessionID: input.sessionID,
      callID: input.callID,
      agent: caller,
      agentType: caller,
      level: "ERROR",
      event: "GATE-APPROVAL-LOCK",
      detail: `BLOCKED-v2 | scope=related | ${blockingSessions.length} related sessions: ${blockingSessions.join(", ")}`,
    });
    if (mode === "strict" || mode === "locked") {
      throw new Error(msg);
    }
    // advisory 模式继续（保留原有）
  }
}
```

**效果**：
- 仅当**未消费的 session 与当前 dispatch 共享 task_id 或 agent 或 caller session** 时才阻断。
- 不相关 task 的 unapproved session 不再阻塞全局。

### 6.5 F5：DAG-exempt bypass 提前

**修改**: `dispatch-before.ts` 把 `isDagExempt(target)` bypass **移到 GATE-APPROVAL-LOCK 之前**：

```ts
// dispatch-before.ts 执行顺序调整：
// 1. M14 sub-agent target restriction
// 2. Route validation L1-L4
// 3. **DAG-exempt bypass（移到这里，最早）**
if (isDagExempt(target)) {
  writeLog("dispatch-before", "runtime", {
    sessionID: input.sessionID,
    callID: input.callID,
    agent: caller,
    agentType: caller,
    event: "DISPATCH-BEFORE",
    detail: `exit (pass) | target @${target} is DAG-exempt (pre-lock bypass)`,
  });
  return;  // 不走 GATE-APPROVAL-LOCK
}
// 4. GATE-APPROVAL-LOCK v2
// 5. ...
```

**效果**：@Meta-Planner / @Super-Admin / @Knowledge-Curator 等 DAG-exempt agent 的 dispatch **完全绕过** GATE-APPROVAL-LOCK。

### 6.6 F6：Stale threshold 统一读取

**抽出 helper**: `lib/gate-stale.ts`（新文件）:

```ts
// gate-stale.ts — 统一读取 gate_stale_thresholds
import * as fs from "node:fs";
import * as path from "node:path";

export interface GateStaleThresholds {
  delivered_hours: number;
  approved_hours: number;
  armed_hours: number;
}

export function readGateStaleThresholds(): GateStaleThresholds {
  const defaults: GateStaleThresholds = {
    delivered_hours: 4,
    approved_hours: 4,
    armed_hours: 1,
  };
  try {
    const root = process.env.OPENCODE_ROOT || process.cwd();
    const cfgPath = path.join(root, ".opencode", "project.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const t = cfg?.gate_stale_thresholds || {};
    return {
      delivered_hours: t.delivered_hours ?? defaults.delivered_hours,
      approved_hours: t.approved_hours ?? defaults.approved_hours,
      armed_hours: t.startup_cleanup_armed_hours ?? defaults.armed_hours,
    };
  } catch {
    return defaults;
  }
}
```

`dispatch-before.ts` / `session.ts` / `gate-core.ts` 统一调用此 helper，消除阈值读取漂移。

### 6.7 F7：新增 `compliance_gate_bulk_review_deliverables` MCP 工具

**位置**: `compliance-gate.ts`（同其他 compliance-gate 工具）。

```ts
{
  name: "compliance_gate_bulk_review_deliverables",
  description:
    "Bulk approve or reject multiple gate sessions in a single transaction. " +
    "Releases GATE-APPROVAL-LOCK for all listed sessions atomically. " +
    "Use when multiple sub-agents have submitted deliverables and the " +
    "Orchestrator wants to review them in batch without pipeline serialization.",
  parameters: {
    session_ids: {
      type: "array",
      items: { type: "string" },
      description: "List of gate_session_id values to review",
    },
    decision: {
      type: "string",
      enum: ["approve", "reject"],
      description: "Bulk decision applied to all listed sessions",
    },
    execution_summary: {
      type: "string",
      description: "Optional summary (sets gate_status='completed' when provided with approve)",
    },
    approval_note: { type: "string", description: "Optional note stored on each session" },
  },
}
```

**实现要点**：
- 单一 `db.transaction(() => {...})` 包裹所有 session 的 UPDATE。
- 使用 `dbAtomicUpdateGateSession` (F2) per-session UPDATE，含乐观锁重试。
- 每个 session 独立 writeLog `BULK-REVIEW-APPLIED` 事件。
- 末尾写单条汇总 `BULK-REVIEW-COMPLETE` 事件，含 `session_count` / `decision` / `total_elapsed_ms`。
- 返回结构化结果：`{ status, applied: [{session_id, new_status, version}], failed: [...] }`。

### 6.8 F8：Status transition audit log + error surfacing

**8.1 Status transition log**: 每次 `gate_sessions.status` UPDATE 前/后写 `GATE-STATUS-TRANSITION` 事件。

```ts
// db-state-manager.ts 新增 helper
export function updateGateSessionStatus(
  sessionId: string,
  newStatus: string,
  caller: { source: string; agent?: string; sessionID?: string },
  extra: Record<string, any> = {},
): boolean {
  const db = getDb();
  const row = db.query(`SELECT status, version FROM gate_sessions WHERE session_id = ?`).get(sessionId) as any;
  if (!row) return false;

  const prevStatus = row.status;
  const now = Date.now();
  const fields = {
    status: newStatus,
    updated_at: now,
    ...(extra.consumed_at !== undefined ? { consumed_at: extra.consumed_at } : {}),
    ...(extra.completed_at !== undefined ? { completed_at: extra.completed_at } : {}),
    ...(extra.drained_at !== undefined ? { drained_at: extra.drained_at } : {}),
  };

  const setClause = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
  const values = [...Object.values(fields), sessionId, row.version];

  const result = db.run(
    `UPDATE gate_sessions SET ${setClause}, version = version + 1
     WHERE session_id = ? AND version = ?`,
    values,
  );

  writeLog(SRC, "runtime", {
    sessionID: caller.sessionID || sessionId,
    agent: caller.agent,
    level: result.changes === 0 ? "ERROR" : "INFO",
    event: "GATE-STATUS-TRANSITION",
    detail: `session=${sessionId} | prev=${prevStatus} → new=${newStatus} | source=${caller.source} | version=${row.version}→${row.version + 1} | ok=${result.changes > 0}`,
  });

  return result.changes > 0;
}
```

**8.2 Error surfacing**: `saveGateStore` 返回 boolean（见 F2 §6.2.3）；MCP 工具检查返回值，失败时返回 `status: "rejected"`。

---

## 7. 实施顺序

```
Week 1 (low-risk, independent):
  F3 (approve 必写 consumed_at)            ← 1 行修改
  F5 (DAG-exempt bypass 提前)              ← 移动代码块
  F6 (Stale threshold helper)              ← 新文件 + 3 处替换
  F8.1 (Status transition audit log)       ← 新 helper + 3 处替换

Week 2 (core, depends on F6):
  F1 (DELETE+INSERT → UPSERT)              ← 重写 dbSaveGateStore
  F2 (乐观锁 + saveGateStore 错误透传)     ← schema migration + API + 调用方改造

Week 3 (feature):
  F4 (GATE-APPROVAL-LOCK scope 收窄)       ← 依赖 F1/F2 已落地
  F7 (bulk review MCP 工具)                ← 依赖 F2 dbAtomicUpdateGateSession
```

每阶段独立可验证，无跨阶段回滚风险。

---

## 8. 验证清单

### 8.1 P1（死循环）验证

- [ ] **V1.1**: approve 后 `SELECT status, consumed_at FROM gate_sessions WHERE session_id=?` 返回 `('approved', <非 NULL>)`
- [ ] **V1.2**: 再次查询 `status` 在 10 秒窗口内不漂移（`session.ts` drain 不会把 approved 误 drain，因为 consumed_at 已非 NULL）
- [ ] **V1.3**: `session.ts` drain 跑完后，DB 中 approved session 状态仍为 approved
- [ ] **V1.4**: 同时触发 MCP approve + session.ts drain（并发测试），最终状态一致（乐观锁重试成功）
- [ ] **V1.5**: `saveGateStore` 返回 `false` 时，MCP `approve_deliverables` 返回 `status: "rejected"` + 含 `DB write failed` 原因
- [ ] **V1.6**: `GATE-STATUS-TRANSITION` 日志事件覆盖每次 status 变更，含 prev/new/version/source

### 8.2 P2（单线程阻塞）验证

- [ ] **V2.1**: Session X 未 approve，Orchestrator 派遣**不相关 task** 的 subagent → **不被阻断**
- [ ] **V2.2**: Session X 未 approve，Orchestrator 派遣**同 task** 的另一 subagent → **被阻断**
- [ ] **V2.3**: Session X 未 approve，Orchestrator 派遣 `@Meta-Planner` (DAG-exempt) → **不被阻断**（F5 生效）
- [ ] **V2.4**: Session X 未 approve，Orchestrator 派遣 `@Super-Admin` (DAG-exempt) → **不被阻断**
- [ ] **V2.5**: 两个 task A/B 各有一个未 approve session，A task 的 Orchestrator 派遣 B task 的 subagent → **不被阻断**
- [ ] **V2.6**: `compliance_gate_bulk_review_deliverables` 一次 approve 5 个 session，原子成功，全部 `consumed_at` 非 NULL
- [ ] **V2.7**: `GATE-APPROVAL-LOCK` 日志事件 `detail` 含 `scope=related` 与 `related sessions` 列表（不再是全量 unapproved sessions）

### 8.3 回归验证

- [ ] **V3.1**: `compliance_gate_check` 仍能创建 armed session
- [ ] **V3.2**: `compliance_gate_confirm` 仍能 arm → confirmed
- [ ] **V3.3**: `compliance_gate_submit_deliverables` 仍能 confirmed → delivered
- [ ] **V3.4**: `compliance_gate_complete` 仍能 delivered → completed
- [ ] **V3.5**: `compliance_gate_drain_stale` 仍能 drained 老 session
- [ ] **V3.6**: `framework-self-test.ts` Check 67-69（output.parts 禁改）通过
- [ ] **V3.7**: `db-manager.ts` schema 迁移（ALTER TABLE ADD COLUMN version）在已存在表上成功；新建表直接含 version

### 8.4 验收命令

```bash
bun --check .opencode/lib/db-state-manager.ts
bun --check .opencode/lib/gate-core.ts
bun --check .opencode/lib/gate-stale.ts  # 新文件
bun --check .opencode/plugins/dispatch-before.ts
bun --check .opencode/plugins/session.ts
bun --check .opencode/scripts/mcp-tools/compliance-gate.ts
FRAMEWORK_DB_PATH=/tmp/gate-e2e.db bun .opencode/scripts/framework-self-test.ts
```

---

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| F1 的 UPSERT 在 schema 缺列时失败 | schema migration 先于 F1 实施；新列全有 DEFAULT |
| F2 乐观锁重试导致延迟 | 上限 3 次重试；`GATE-SESSION-OPTIMISTIC-EXHAUSTED` 事件触发告警 |
| F3 `consumed_at = now` 改变 approved 语义 | approved 含义改为「已审批且已消费」；auto-complete 路径 `gate_status='completed'` 不变 |
| F4 scope 收窄可能漏掉某些阻塞场景 | 保留 `compliance_gate_drain_stale` 兜底；日志持续审计 `GATE-APPROVAL-LOCK-v2` 事件 |
| F5 DAG-exempt bypass 提前后被滥用 | DAG-exempt 名单固定在 `dag-policy.ts`；Permission Matrix 仍强制路径/范围权限 |
| F7 bulk tool 一次 approve 大量 session 导致 audit_history 膨胀 | bulk tool 每 session 写 1 条 `BULK-REVIEW-APPLIED`；上限 50 session/call |
| 迁移期间旧 session 无 `version` 列 | DEFAULT 1 兼容；迁移脚本先跑 |

---

## 10. 与既有文档一致性

| 文档 | 一致性 |
|---|---|
| `gate-stuck-diagnosis-report.md` | ✅ 本方案吸收其「stuck session 无法释放」结论，F3/F4 直接修复 |
| `gate-stuck-fix-and-deliverables-plan.md` | ✅ 本方案 F7 实现其 bulk review 提议 |
| `three-lock-deadlock-root-cause-diagnosis-20260626.md` | ✅ 本方案扩展其分析（新增双写者竞态根因 A） |
| `dispatch-gap-bug-analysis.md` | ✅ 本方案 F4/F5 修复 dispatch 阻塞 |
| `dispatch-shell-checklist-gaps-fix-plan-20260627.md` | ✅ 不冲突；本方案保持 DB-canonical |
| `lsp-diagnostic-gate-e2e-acceptance-gaps.md` §G-5 | ✅ 本方案 F7 实现其建议的 `compliance_gate_bulk_review_deliverables` |

---

_参考_:

- `.opencode/lib/db-manager.ts` (L200-226 gate_sessions schema, L227 idx_gate_status, L242-248 gate_session_index, L251-259 gate_store_meta)
- `.opencode/lib/db-state-manager.ts` (L448-511 dbSaveGateStore, L748/773 INSERT OR REPLACE, L811 archive UPDATE, L837 drain UPDATE)
- `.opencode/lib/gate-core.ts` (L759-769 saveGateStore, L1480 raw UPDATE)
- `.opencode/plugins/dispatch-before.ts` (L325-402 GATE-APPROVAL-LOCK, L405-414 isDagExempt bypass)
- `.opencode/plugins/session.ts` (L170-174 drain delivered/approved, L211-219 drain armed)
- `.opencode/scripts/mcp-tools/compliance-gate.ts` (L2823-2880 approve_deliverables, L2864-2866 auto-complete)
- `.opencode/project.config.json` (L153-159 gate_stale_thresholds)
- `.task_temp/_logs/2026-06-27/plugin-dispatch-before-runtime.log` (Episode 1: cg_ses_1782520243407; Episode 2: cg_ses_1782527300870)

*本文件为 Gate Approval 死循环 + GATE-APPROVAL-LOCK 单线程阻塞的根因分析与解决方案。待 `/compliance-gate` 武装后由 @Meta-Planner 产生 DAG、@Super-Admin 主导 F1/F2/F8 核心改造、@Orchestrator 验证 F3/F4/F5/F6/F7 上线。*
