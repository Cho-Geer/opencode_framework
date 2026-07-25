# HANDOVER.md 交叉审核验证报告

**日期**: 2026-06-26

**审核人**: @Super-Admin (audit mode)

**审核对象**: `.task_temp/E2E-STRICT-AFTER-REBOOT/HANDOVER.md`

**参考计划**: `db-canonical-atomicity-rollback-implementation-plan.md` v1.0.0

**模式**: read-only 代码逐项验证

---

## 一、审核结论

HANDOVER.md 整体质量高，20 项中 **19 项结论属实**，**1 项结论有误**（1.5），**1 项遗漏严重缺陷**（Step 6 数据丢失 bug）。

| 类别 | 数量 |
|------|:---:|
| 经代码验证属实的结论 | 19/20 |
| 结论有误需更正 | 1/20 (1.5) |
| 遗漏的严重缺陷 | 1 (Step 6 ctx GC) |

---

## 二、逐项验证结果

### Phase 1: DB-canonical 迁移收尾

| # | HANDOVER 结论 | 验证结果 | 证据 |
|---|------|--------|------|
| 1.1 | ✅ compliance-gate.ts DB-only | ✅ **属实** | `compliance-gate.ts` L246-278: gate-state.json 仅写 DB（`dbSaveGateStore`），L267 `return` 跳过 JSON 写入。L284 的 `fs.writeFileSync` 仅用于非 gate-state 文件（如 rule_registry.json）。日志事件 `DB-SAVE-GATE-FAILED-NO-FALLBACK` + `DB-WRITE-FATAL` 存在。 |
| 1.2 | ✅ dispatch-subagent.ts .pending.json 移除 | ✅ **属实** | `dispatch-subagent.ts` L1247-1290: 仅调用 `dbEnqueueDispatch()`，无 `fs.writeFileSync(PENDING_FILE)`。L1251-1252 注释明确 ".pending.json file write is REMOVED"。日志事件 `DB-ENQUEUE-FAILED-NO-FALLBACK` + `PENDING-FILE-FALLBACK-REMOVED` 存在。 |
| 1.3 | ✅ knowledge-store.ts DB-canonical | ✅ **属实** | `knowledge-store.ts` L930-1048 `writeManifest()`: 先 upsert 到 `knowledge_entries`/`knowledge_files`/`knowledge_entry_tags`（L938-1022），再调用 `materializeManifestFromDb()` 导出只读缓存（L1035）。 |
| 1.4 | ❌ dispatch_context 表设计冲突 | ✅ **属实** | `db-manager.ts` L1725-1747: v23 迁移 `DROP TABLE IF EXISTS dispatch_context`，注释 "OPT-06: write-only dead table, session_map is canonical"。`dispatch-db.ts` L341-372 `dbInsertDispatchContext()` 仍引用已删除的表 — 死代码。 |
| 1.5 | ❌ .transaction-log 废弃未标记 | ❌ **结论有误** | **详见第三节更正** |

### Phase 2: 原子性补全

| # | HANDOVER 结论 | 验证结果 | 证据 |
|---|------|--------|------|
| 2.1 | ✅ dag-version-manager.ts 原子化 | ✅ **属实** | `dag-version-manager.ts` L342: `atomicWriteJson` for `writeDAG()`。L363: `atomicWriteJson` for `writeSnapshot()`。L386/393/395: `atomicWriteText` for `appendChangelog()`。日志事件 `DAG-WRITE-ATOMIC` + `DAG-SNAPSHOT-ATOMIC` 存在。 |
| 2.2 | ✅ state-compactor.ts 原子化 | ✅ **属实** | `state-compactor.ts` L406: `atomicWriteJson` for `writeIndex()`。L659: `atomicWriteJson` for `writeArchive()`。 |
| 2.3 | ❌ dispatch prompt 非原子 | ✅ **属实** | `dispatch-subagent.ts` L1009: `fs.writeFileSync(outputFile, tokenizedPrompt, "utf8")` — 仍用直接 writeFileSync，未用 `atomicWriteText()`。 |
| 2.4 | ✅ dbEnqueueDispatch 事务包裹 | ✅ **属实** | `dispatch-db.ts` L121-137: `db.transaction()` 包裹 `INSERT INTO dispatch_prompt_refs` + `INSERT INTO dispatch_queue`。日志事件 `DB-ENQUEUE-ATOMIC` 存在。 |
| 2.5 | ✅ drainStaleSessions 单事务 | ✅ **属实** | `gate-core.ts` L1351-1468: Phase 1 收集（L1359-1412），Phase 2 单 `db.transaction()` 归档+状态更新（L1418-1440），Phase 3 仅在 DB 提交后清理内存（L1442-1454）。日志事件 `DRAIN-STALE-ATOMIC` 存在。 |
| 2.6 | ❌ 7步补偿机制未实现 | ✅ **属实** | Grep 全仓搜索 `DispatchCompensationTracker` 仅在计划文档中匹配，源代码中不存在。`dbDeleteSessionMap`/`dbDeleteDispatchCtx`/`dbDequeueDispatch` 函数均不存在。 |

### Phase 3: 回退/清理机制补全

| # | HANDOVER 结论 | 验证结果 | 证据 |
|---|------|--------|------|
| 3.1 | ✅ confirmed_at 盲区修复 (4处) | ✅ **属实** | `gate-core.ts` L601-602: `ses.confirmed_at \|\| ses.created_at` 回退。`gate-core.ts` L1374-1375: 同样回退。`session.ts` L215-219: SQL `(confirmed_at IS NOT NULL AND confirmed_at < ?) OR (confirmed_at IS NULL AND created_at < ?)`。`compliance-gate.ts` L705-706: `ses.confirmed_at \|\| ses.created_at` 回退。**4处全部覆盖。** |
| 3.2 | ✅ approved 状态 drain 盲区修复 | ✅ **属实** | `session.ts` L174: `WHERE status IN ('delivered', 'approved')`。`dispatch-before.ts` L245: `WHERE status IN ('delivered', 'approved') AND consumed_at IS NULL`。`gate-core.ts` L1394-1396: `(ses.gate_status === "delivered" \|\| ses.gate_status === "approved")`。 |
| 3.3 | ✅ dispatch_queue 启动清理 | ✅ **属实** | `session.ts` L252-285 Step 4: `UPDATE dispatch_queue SET status = 'expired'` for stale entries。日志事件 `DISPATCH-QUEUE-CLEANUP` 存在。 |
| 3.4 | ✅ session_map 孤儿清理 | ✅ **属实** | `session.ts` L287-316 Step 5: `DELETE FROM session_map WHERE session_id NOT IN (SELECT DISTINCT session_id FROM session_log)`。日志事件 `SESSION-MAP-ORPHAN-CLEANUP` 存在。 |
| 3.5 | ✅ ctx/ 孤儿文件 GC | ⚠️ **代码存在但有数据丢失 bug** | **详见第四节** |
| 3.6 | ✅ 孤儿 prompt 文件扫描 | ✅ **属实** | `session.ts` L364-409 Step 7: 扫描 `dispatch-*.md`，检查 `dispatch_prompt_refs` 表（L378），>24h 未引用则删除。日志事件 `PROMPT-FILE-GC` 存在。 |

### Phase 4: 状态迁移兼容性

| # | HANDOVER 结论 | 验证结果 | 证据 |
|---|------|--------|------|
| 4.1 | ✅ GATE-APPROVAL-LOCK 覆盖 approved | ✅ **属实** | `dispatch-before.ts` L245: `WHERE status IN ('delivered', 'approved') AND consumed_at IS NULL`。L233-236 注释 `FW-DB-CANONICAL-11` 记录变更。 |
| 4.2 | ✅ 统一 drain 逻辑状态值 | ✅ **属实** | 3处 drain 位置均用 `'delivered', 'approved'`。`project.config.json` 含 `approved_hours: 4`。 |

### Phase 5: Framework Harness

| # | HANDOVER 结论 | 验证结果 | 证据 |
|---|------|--------|------|
| 5.1 | ❌ Check 35 未更新 | ✅ **属实** | `framework-self-test.ts` L3577-3583: Check 35 `checkStaleInternalEvidence()` 仍验证 `knowledge_cache_state` 的 `cache_sufficiency` 条目，未改为 dispatch_queue 验证。 |
| 5.2 | ✅ Check 69 新增 | ✅ **属实** | `framework-self-test.ts` L5710-5758: `checkDbCanonicalMigration()` 验证 compliance-gate.ts 无 gate-state.json 双写、dispatch-subagent.ts 无 .pending.json 写入。 |

---

## 三、更正：Item 1.5 — .transaction-log 废弃标记

### HANDOVER 原结论

> ❌ NOT IMPLEMENTED — state-transaction.ts has NO @deprecated JSDoc banner as specified in the plan. .transaction-log path (L81) still actively referenced throughout the file. The plan called for a JSDoc deprecation notice and runtime warning — neither exists.

### 实际代码验证

**废弃标记 EXISTS** — `state-transaction.ts` L6-28 有完整的废弃横幅：

```typescript
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚠️  DEPRECATED (P3/S52-2, 2026-06-16)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// This custom WAL / two-phase commit engine is no longer the
// recommended path for state writes. After P2-A Step 8, all
// sub-state writes go through DB transactions via
// `atomicWriteSubState()` / `dbWriteSubState()` in lib/state-utils.ts
// and lib/db-state-manager.ts.
//
// NEW CODE: Do NOT use beginTransaction / commitTransaction /
// rollbackTransaction. Use `atomicWriteSubState()` or
// `dbSaveGateStore()` for gate-state writes.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**运行时警告 NOT EXISTS** — `beginTransaction()` (L561-564) 无 `console.warn` 或 `writeLog` 废弃警告：

```typescript
function beginTransaction(filePath, agent, taskId) {
  ensureStateDir();
  return new StateTransaction(filePath, agent, taskId);
}
```

### 更正结论

| 方面 | HANDOVER 结论 | 实际 | 判定 |
|------|-------------|------|------|
| JSDoc 废弃标记 | "NO @deprecated JSDoc banner" | L6-28 有完整废弃横幅（非 `@deprecated` 标签语法，但等效） | ❌ HANDOVER 有误 |
| 运行时警告 | "runtime warning — neither exists" | `beginTransaction()` 无运行时警告 | ✅ HANDOVER 属实 |

**更正为**: ⚠️ **PARTIALLY IMPLEMENTED** — 废弃横幅已存在于 L6-28（2026-06-16 标记，早于计划日期），明确禁止新代码使用 beginTransaction。但 `beginTransaction()` 函数本身缺少运行时废弃警告，调用时无提示。`.transaction-log` 路径仍被引用属预期行为（废弃横幅明确说明保留为 legacy bridge）。

---

## 四、遗漏缺陷：Step 6 ctx GC 数据丢失 Bug

### 缺陷描述

HANDOVER 的 Gap G3 提到 `session.ts` L329 查询已删除的 `dispatch_context` 表，但**未指出此 bug 导致的数据丢失后果**。

### 代码路径

`session.ts` L318-354 Step 6 (ctx/ 孤儿文件 GC):

```typescript
let exists = false;                                          // L326
try {
  if (db) {
    const row = db
      .query("SELECT 1 FROM dispatch_context WHERE dag_task_id = ?")  // L330 — 表已删除
      .get(dagTaskId);
    exists = !!row;
  }
} catch {
  /* DB lookup failed, keep file */                          // L334 — 空 catch，未设 exists=true
}
if (!exists) {                                               // L337 — exists 仍为 false → true
  try {
    fs.unlinkSync(path.join(ctxDir, f));                     // L339 — 文件被删除
    cleaned++;
  } catch { /* skip */ }
}
```

### 根因分析

1. v23 迁移（`db-manager.ts` L1732）`DROP TABLE IF EXISTS dispatch_context` — 表已删除
2. L330 查询 `dispatch_context` 表 → SQLite 抛出 "no such table" 异常
3. L334 catch 块为空，注释说 "keep file" 但**未设置 `exists = true`**
4. `exists` 保持 `false`，L337 `if (!exists)` 为 `true`
5. **所有** ctx/*.json 文件被删除（不仅仅是孤儿文件）

### 影响

| 维度 | 影响 |
|------|------|
| 严重性 | **P0 数据丢失** — 每次启动清理会删除全部 ctx 文件 |
| 触发条件 | `dispatch_context` 表不存在（v23 后必然）+ ctx 目录有文件 |
| 与 HANDOVER 关系 | Gap G3 提到 "queries a non-existent table" 但标注影响为 "will fail at runtime"，未识别数据丢失后果 |

### 修复建议

**方案A**（最小修复）— 在 catch 中设置 `exists = true`：

```typescript
} catch {
  exists = true; // DB lookup failed, keep file (don't risk deleting valid files)
}
```

**方案B**（根因修复）— 改用 `session_map` 表（v23 注释指明的 canonical source）：

```typescript
const row = db
  .query("SELECT 1 FROM session_map WHERE dag_task_id = ?")
  .get(dagTaskId);
```

推荐方案B，与 v23 设计决策一致（session_map is canonical）。

---

## 五、HANDOVER Gap 表更新

### 原 Gap 表

| Gap ID | HANDOVER 描述 | 审核验证 |
|--------|-------------|---------| 
| G1 | Phase 2.6 补偿机制未实现 | ✅ 属实 |
| G2 | Phase 2.3 prompt 非原子 | ✅ 属实 |
| G3 | dispatch_context 表删除但死代码残留 | ⚠️ 属实但**低估影响** — 应升级为 P0 数据丢失 |
| G4 | .transaction-log 废弃未标记 | ❌ **不属实** — 废弃横幅已存在 L6-28 |
| G5 | Check 35 未更新 | ✅ 属实 |
| G6 | dispatch-after.ts 引用 .pending.json | ✅ 属实（可接受） |

### 更正后的 Gap 表

| Gap ID | 描述 | 严重性 | 状态 |
|--------|------|--------|------|
| G1 | Phase 2.6 补偿机制未实现 — 无回滚能力 | P1 | 待决策：实现或接受风险 |
| G2 | Phase 2.3 prompt 文件非原子写入 | P1 | 替换 L1009 为 `atomicWriteText()` |
| **G3** | **Step 6 ctx GC 查询已删除表 + 空 catch 导致全部 ctx 文件被删除** | **P0** | **需立即修复**（方案A或B） |
| ~~G4~~ | ~~.transaction-log 废弃未标记~~ | — | **撤销** — 废弃横幅已存在 L6-28（2026-06-16）；仅缺运行时警告（P3） |
| G5 | Check 35 未按计划更新为 dispatch_queue 验证 | P2 | 新增检查或更新 Check 35 |
| G6 | dispatch-after.ts 引用 .pending.json 作为失败归档路径 | P3 | 可接受（临时标记） |
| **G7（新）** | **`dbInsertDispatchContext()` 死代码**（dispatch-db.ts L341-372 引用已删除表） | P2 | 删除函数或改造为 session_map 写入 |

---

## 六、验证方法说明

本次审核为 read-only 代码逐项验证，对 HANDOVER.md 中每项结论逐一对照源代码：

- **直接 Read**：读取 HANDOVER 引用的精确行号，验证代码内容与结论一致
- **Grep 搜索**：验证 `DispatchCompensationTracker` 不存在、废弃标记存在性
- **无文件修改**：审核过程未修改任何框架文件

验证覆盖的文件清单：

| 文件 | 验证项 |
|------|--------|
| `scripts/mcp-tools/compliance-gate.ts` | 1.1, 3.1 (L705-706) |
| `scripts/command-tools/dispatch-subagent.ts` | 1.2, 2.3 |
| `lib/knowledge-store.ts` | 1.3 |
| `lib/db-manager.ts` | 1.4 |
| `lib/dispatch-db.ts` | 1.4 (死代码), 2.4 |
| `lib/dag-version-manager.ts` | 2.1 |
| `lib/state-compactor.ts` | 2.2 |
| `lib/gate-core.ts` | 2.5, 3.1, 3.2 |
| `plugins/session.ts` | 3.1-3.6, 4.1 |
| `plugins/dispatch-before.ts` | 4.1 |
| `scripts/framework-self-test.ts` | 5.1, 5.2 |
| `scripts/state-transaction.ts` | 1.5 |

---

## 七、总结

HANDOVER.md 的审核质量整体优秀，20 项中 19 项经代码验证属实。需更正两处：

1. **Item 1.5**: 废弃标记已存在（L6-28），HANDOVER 误判为 "NOT IMPLEMENTED"。应更正为 "PARTIALLY IMPLEMENTED"（废弃横幅存在，运行时警告缺失）。

2. **Gap G3 升级**: Step 6 ctx GC 不仅是 "queries non-existent table"，而是因空 catch 块未设 `exists = true`，导致**全部 ctx/*.json 文件被删除**的 P0 数据丢失 bug。需立即修复。
