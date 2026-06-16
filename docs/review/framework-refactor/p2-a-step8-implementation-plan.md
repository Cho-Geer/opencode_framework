# P2-A Step 8 实施计划 — 跳过观察期，备份兜底

**日期：** 2026-06-16
**策略：** 先备份 JSON 状态文件 → 立即实施 → 现有 JSON 文件作为隐性兜底
**预期效果：** self-test 36→38/38，G1-G13 解决 8→11，代码 -500 行

---

## 一、备份策略

**核心思路：** 不删除任何 JSON 文件，只停止写入。现有 JSON 文件作为隐性兜底：
- 双写期间 JSON 与 DB 数据已一致（验证报告 V3 确认 12/12 等价）
- 停止写入后，JSON 文件冻结为最近一次双写的快照
- 如果 DB 出问题，JSON 快照仍可用于手动恢复或重新迁移
- `framework-state.db` 本身有 WAL + PRAGMA integrity_check 保护

**额外保障：**
- 实施前先 `git commit` 当前所有修改（含 JSON 状态文件），作为代码级备份
- 如需回滚：`git checkout` 恢复代码 + JSON 文件自然恢复

---

## 二、实施分 6 个 Phase，按风险从低到高排序

### Phase 1: 死代码删除（0 调用者，极低风险）

| 操作 | 文件 | 行 | 说明 |
|------|------|:--:|------|
| 1a | 删除 `atomicWriteMachine()` | `lib/state-utils.ts` | 180-219 | 0 调用者，被 atomicWriteSubState 替代 |
| 1b | 删除 `readMachine()` | `lib/substate-manager.ts` | 248-257 | 0 外部调用者，DEPRECATED |
| 1c | 删除 `writeMachine()` | `lib/substate-manager.ts` | 263-282 | 0 外部调用者，DEPRECATED |
| 1d | 删除 re-export | `lib/uc7ks-schema.ts` | 333 | 0 消费者，G10 |
| 1e | 删除 unused import | `scripts/migrate-machine-to-substates.ts` | 17 | `readMachine` import 未使用 |

**验证：** 每个 delete 后运行 `bun .opencode/scripts/framework-self-test.ts` 确认无回归

---

### Phase 2: 读路径简化 — DB-only（低风险）

将 `substate-manager.ts` 的读路径从 "DB-first + JSON fallback" 简化为 "DB-only"：

| 操作 | 函数 | 当前逻辑 | 新逻辑 |
|------|------|---------|--------|
| 2a | `readSubState()` | `dbReadSubState()` → fallback `readSubStateJson()` | 直接 `dbReadSubState()` |
| 2b | `readMachineMeta()` | `dbReadMachineMeta()` → fallback `readMachineMetaJson()` | 直接 `dbReadMachineMeta()` |

**同步删除内部 JSON-only helper：**
| 2c | `readSubStateJson()` | substate-manager.ts:64-79 | 删除（不再被调用） |
| 2d | `readMachineMetaJson()` | substate-manager.ts:163-175 | 删除 |

**风险兜底：** DB 读取失败时返回空对象 `{}`（与原 readSubStateJson 默认行为一致），而非 fallback 到 JSON。DB 有 WAL + busy_timeout=5000 保护，读取失败概率极低。

---

### Phase 3: 写路径简化 — DB-only（中风险）

将 `substate-manager.ts` 的写路径从 "JSON+DB dual-write" 简化为 "DB-only"：

| 操作 | 函数 | 当前逻辑 | 新逻辑 |
|------|------|---------|--------|
| 3a | `writeSubState()` | `writeSubStateJson()` + `dbWriteSubState()` | 直接 `dbWriteSubState()` |
| 3b | `writeMachineMeta()` | `writeMachineMetaJson()` + `dbWriteMachineMeta()` | 直接 `dbWriteMachineMeta()` |

**同步删除内部 JSON-only helper：**
| 3c | `writeSubStateJson()` | substate-manager.ts:86-106 | 删除 |
| 3d | `writeMachineMetaJson()` | substate-manager.ts:181-197 | 删除 |

**同步修改 atomicWriteSubState：**
| 3e | `atomicWriteSubState()` | state-utils.ts:242-272 | 删除 JSON sync 块（257-269），仅保留 DB 事务部分 |

3e 修改后的 `atomicWriteSubState` 逻辑：
```typescript
export function atomicWriteSubState(
  subStateKey: keyof typeof SUBSTATE_FILES,
  modifyFn: (subState: any) => void,
  maxRetries: number = 3,
): boolean {
  const dbOk = dbAtomicWriteSubState(subStateKey as any, modifyFn, maxRetries);
  if (!dbOk) {
    writeLog(SRC, "ERROR", { event: "DB-ATOMIC-WRITE-FAILED", detail: `key=${subStateKey}` });
    return false;
  }
  return true;
}
```

**连锁效应：** `code-quality-gate.ts` 的本地 `writeMachine()` 函数（312行，5 调用者）已自动变为 DB-only — 因为其内部调用的 `writeMachineMeta()` 和 `writeSubState()` 已在 Phase 2/3 简化为 DB-only。**无需单独重构此函数。**

---

### Phase 4: Gate 双写移除（中风险）

| 操作 | 函数 | 当前逻辑 | 新逻辑 |
|------|------|---------|--------|
| 4a | `saveGateStore()` | DB 事务 + `saveGateStoreJson()` | 仅 DB 事务 |
| 4b | `loadGateStore()` reconciliation | DB + JSON 双写 | 仅 DB 写 |

**保留：** `gate-state.index.json` — 纯 JSON，属于 compactor/reconciliation 架构，非双写对象。暂不迁移。

---

### Phase 5: 审计日志双写移除 + dispatch 绕道修复（低-中风险）

| 操作 | 函数/文件 | 当前逻辑 | 新逻辑 |
|------|----------|---------|--------|
| 5a | `writeAuditLogEntry()` | DB INSERT + `appendFileSync` JSONL | 仅 DB INSERT |
| 5b | `flushAuditTrail()` | DB upsert + `writeFileSync` JSON | 仅 DB upsert |
| 5c | `dispatch_subagent.ts:118,169` | 直接 `writeFileSync` audit_log.jsonl | 调用 `writeAuditLogEntry()` |

5c 需要修改 `logOrchestratorSaDispatch()` 和 `logSuperAdminDispatchBypass()` 两个函数，将直接写 JSONL 改为调用 `writeAuditLogEntry()`。

---

### Phase 6: Safe-Bash 日志统一 (G8)（低风险）

| 操作 | 函数 | 当前逻辑 | 新逻辑 |
|------|------|---------|--------|
| 6a | `logAction()` | `fs.appendFileSync` → safe-bash.log | `writeLog()` from log-manager |

修改 `safe-bash-core.ts:486-508`：
- 添加 `import { writeLog } from "./log-manager"`
- `logAction()` 调用 `writeLog("safe-bash", "INFO", { event: "SAFE-BASH-ACTION", ...result, timestamp })`
- 移除 `fs.appendFileSync` 和 log rotation 触发

---

## 三、不在 Step 8 范围内的项目

| 项目 | 原因 |
|------|------|
| `gate-state.index.json` 迁移 | 纯 JSON，属于 compactor v3 架构，需单独设计 |
| JSON 状态文件删除 | 保留为隐性兜底快照，不主动删除 |
| `code-quality-gate.ts` 本地 writeMachine 重构 | 已自动变为 DB-only，无需额外重构 |
| G2 (machine.json 双 lastUpdated) | Schema 问题，需 DB schema v4 迁移 |
| G11 (FileStateRegistry 进程内限) | 需要 DB 跨进程事务替代 mkdir 互斥，后续 P3 |
| G12 (readSubState/writeSubState 类型安全 any) | 需要 typed 表迁移，后续 P3 |

---

## 四、验证步骤

每个 Phase 完成后：
1. `bun .opencode/scripts/framework-self-test.ts` — 确认无回归
2. `bun -e "import {getDb} from './.opencode/lib/db-manager'; const db=getDb(); console.log(db.query('PRAGMA integrity_check').all())"` — DB 完整性
3. 手动验证 key 读写路径：`readSubState("eslint_state")` / `writeSubState("eslint_state", {...})` 正常工作

全部 Phase 完成后：
4. 重新运行完整 self-test（预期 38/38 PASS，因 uncommitted files 将随本次修改一并提交）
5. 确认 `gate_sessions` 表 CRUD 正常
6. 确认 `audit_log` 表写入正常
7. 确认 `substate_kv` 12 行完整

---

## 五、预期量化效果

| 指标 | 当前 | Step 8 后 |
|------|:----:|:--------:|
| self-test PASS | 36/38 | 38/38 |
| G-problem 解决数 | 8/13 | 11/13 (G8/G10+隐含G1/G3/G4/G6/G7) |
| 代码行数减少 | — | ~500 行（死代码 + JSON helper + dual-write 逻辑） |
| JSON 状态文件写入 | 12 个活跃双写 | 0 个写入（冻结快照） |
| 审计日志写入路径 | 3 条（audit-log.ts + dispatch 直写 + safe-bash 独立） | 1 条（writeLog / writeAuditLogEntry 统一） |
