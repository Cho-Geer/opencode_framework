# DB-Canonical 迁移与原子性回退机制实施方案

**版本**: 1.0.0

**日期**: 2026-06-26

**作者**: @Super-Admin

**状态**: 待实施 — 基于 framework-hard-constraints.md v2.0.0 + framework-state-persistence.md v2.1.0 实测审计

---

## 一、背景与目标

### 1.1 问题陈述

根据 `framework-state-persistence.md` v2.1.0 和 `framework-hard-constraints.md` v2.0.0 的实测审计，框架的 DB-only/DB-canonical 迁移和原子性/回退机制存在以下未完成项：

**DB-canonical 迁移（6 项未完成）**:
1. `compliance-gate.ts:266` 仍双写 `gate-state.json`（DB + JSON）
2. `dispatch-subagent.ts:1251` 仍双写 `.pending.json`（DB + JSON）
3. `knowledge-store.ts:744,1362` 仍直接写 `index.json`
4. `agent-resolver.ts:199` + `dispatch_subagent.ts:744` 仍写 `ctx/*.json` 文件
5. `scripts/state-transaction.ts` `.transaction-log` 已废弃但仍可写
6. `dispatch-db.ts` Phase 1（file fallback）未升级到 Phase 2（DB-only）

**原子性缺口（7 项）**:
1. `dag-version-manager.ts:323,340,357,364,366` — 4 处非原子 writeFileSync
2. `state-compactor.ts:405,658` — 2 处非原子 writeFileSync
3. `dispatch-subagent.ts:1009,1251` — 2 处非原子 writeFileSync（prompt + pending）
4. `agent-resolver.ts:199` — 1 处非原子 ctx 文件写
5. `dispatch-db.ts:114-127` `dbEnqueueDispatch` — 2 个独立 `db.run` 无事务包裹
6. `gate-core.ts:1386 vs 1412` `drainStaleSessions` — 跨事务不一致（archive + save）
7. `dispatch-subagent.ts:720-1318` — 7 步无原子性无回退

**回退/清理缺口（7 项）**:
1. `approved` + null `consumed_at` — 启动清理不覆盖（当前 2 个孤儿）
2. `armed` + null `armed_at` — drain 规则漏判（当前 2 个孤儿）
3. `checked` + null `confirmed_at` stale — 启动清理不覆盖
4. `dispatch_queue` pending stale — 不清理（当前 325 个 stale）
5. `session_map` 孤儿 — 无清理机制（当前 270 个）
6. `ctx/*.json` 孤儿文件 — 无 GC
7. 孤儿 prompt 文件 — 无未引用扫描

### 1.2 目标

1. 完成 DB-canonical 迁移：移除所有 JSON 双写，JSON 文件降级为只读导出缓存
2. 补全原子性：所有状态写入使用 SQLite 事务或 temp+rename
3. 建立回退机制：跨事务操作增加补偿逻辑
4. 补全启动清理：覆盖所有孤儿状态类型
5. 符合 12 子系统规范，正确集成日志系统，符合 OpenCode mcp/plugin/tool 代码规范

---

## 二、12 子系统对齐分析

### 2.1 Layout Architecture Subsystem ✅ 对齐

**当前状态**: `.opencode/` 布局规范已就绪，所有状态文件路径符合 `lib/state-utils.ts` + `lib/db-manager.ts` 定义。

**变更影响**: 无新增目录。`ctx/*.json` 迁移到 DB 后，`.task_temp/_dispatch/ctx/` 目录将逐步废弃。

### 2.2 DB-only and DB-canonical based ⚠️ 部分对齐（本次重点修复）

**当前状态**:
- 核心 state 层（substate/gate-core/audit）已 DB-only ✅
- `compliance-gate.ts` 仍双写 `gate-state.json` ❌
- `dispatch-subagent.ts` 仍双写 `.pending.json` ❌
- `knowledge-store.ts` 仍直接写 `index.json` ❌
- `ctx/*.json` 仍文件权威 ❌
- Schema v25（`db-manager.ts:1828`），DB 基础设施完善 ✅

**修复方案**: 见 §三 Phase 1

### 2.3 Permission Matrix Subsystem ✅ 对齐

**当前状态**: `project.config.json` 的 `agent_tool_scopes` + `dispatch_policy.fallback_tools` + `route_rules` 已定义权限矩阵。

**变更影响**: 本次修复不改变权限矩阵。dispatch pipeline 原子化后，`dispatch_subagent` 工具的权限保持不变。

### 2.4 Session/Same-Agent/Different-Agent/Task Concurrency Safe ⚠️ 部分对齐

**当前状态**:
- `uc7ks_pipeline_state` 有 `UNIQUE(pipeline_id, agent, domain_id)` + UPSERT ✅
- `dbAtomicWriteSubState` 使用 `db.transaction` 保证原子 RMW ✅
- `dbDequeueWithLease` 使用事务保证并发安全 ✅
- `dbEnqueueDispatch` **无事务包裹**，2 个独立 `db.run` ❌
- `drainStaleSessions` 跨事务不一致 ❌

**修复方案**: 见 §三 Phase 2.5 + Phase 2.6

### 2.5 Hardened Enforcement Subsystem ✅ 对齐

**当前状态**: `knowledge_cache_attest.ts` Step 4.5 强制链已实现（L412-520），`checklistWirePassed/Failed` 已集成。

**变更影响**: 启动清理补全后，Step 4.5 的 `mandatory_knowledge` 检查不受影响。`compliance_gate_complete` 的 ESLint mock-audit 不受影响。

### 2.6 Framework Harness Subsystem ⚠️ 部分对齐

**当前状态**: `framework-self-test.ts` Check 30 验证 12 个 requiredDomains。Check 35 验证陈旧 `.pending.json`。

**变更影响**: `.pending.json` 迁移到 DB-only 后，Check 35 需更新为验证 `dispatch_queue` 表。本次方案包含 Check 35 更新。

### 2.7 Central State Management Subsystem ⚠️ 部分对齐（本次重点修复）

**当前状态**:
- DB-canonical 状态层：`db-state-manager.ts` 10 个函数 ✅
- JSON blob 状态层：`substate_kv` 13 个键 ✅
- `drainStaleSessions` 跨事务不一致 ❌
- 启动清理漏判 armed+null / approved+null ❌
- `session_map` 孤儿无清理 ❌

**修复方案**: 见 §三 Phase 3

### 2.8 Multi-Agent Subsystem ✅ 对齐

**当前状态**: `dispatch_subagent` 工具 + `dispatch-before.ts` + `task-before.ts` 已实现 PLAN-FIRST L1+L2 强制。

**变更影响**: dispatch pipeline 原子化后，PLAN-FIRST 检查逻辑不变。`session_map` 孤儿清理不影响正常 dispatch 流程。

### 2.9 Log Central Management Subsystem ✅ 对齐

**当前状态**: `log-manager.ts` v3.0，API 为 `writeLog(plugin, category, fields)`，category 为 `"loaded"|"hooks"|"runtime"`。

**变更影响**: 本次所有新增代码必须使用 `writeLog(plugin, "runtime", { ... })` 记录关键事件。日志事件清单见 §五。

### 2.10 DB-canonical Management Subsystem ⚠️ 部分对齐（本次重点修复）

**当前状态**:
- `knowledge_entries/files/entry_tags` 表已存在，有数据（63 行）✅
- `knowledge-store.ts` 仍直接写 `index.json` ❌
- `dispatch_queue` 表已存在 ✅，但 `dispatch-subagent.ts` 仍双写 `.pending.json` ❌
- `gate_sessions` 表已存在 ✅，但 `compliance-gate.ts` 仍双写 `gate-state.json` ❌

**修复方案**: 见 §三 Phase 1.1-1.3

### 2.11 Templatization & Parameterization Universality Subsystem ✅ 对齐

**当前状态**: `gate_stale_thresholds` 已参数化（`project.config.json` 的 `template_resolution.gate_stale_thresholds`），支持 `armed_hours/checked_hours/delivered_hours/startup_cleanup_armed_hours`。

**变更影响**: 新增 `approved_hours` 和 `dispatch_queue_stale_hours` 阈值参数。

### 2.12 TypeScript + Bun Based Runtime Subsystem ✅ 对齐

**当前状态**: 所有框架代码使用 TypeScript + Bun 运行时。`bun:sqlite` 同步 API 用于 DB 操作。

**变更影响**: 新增代码使用 TypeScript + `bun:sqlite`。`BUN-CACHE-VERSION` 注释添加到迁移脚本。

---

## 三、实施 Phase

### Phase 1: DB-canonical 迁移收尾（P0）

#### 1.1 移除 compliance-gate.ts gate-state.json 双写

**位置**: `scripts/mcp-tools/compliance-gate.ts:238-281` `writeJson()` 函数

**当前代码**:
```typescript
function writeJson(p, data) {
  // 1. DB write (primary)
  try {
    if (isGateState && typeof data === "object") {
      const store = hotToGateStore(data, p);
      dbSaveGateStore(store);  // L246
    }
  } catch (dbErr) { ... }

  // 2. JSON file write (frozen snapshot, non-transactional)
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const content = JSON.stringify(data, null, 2);
  try {
    fs.writeFileSync(p, content, "utf8");  // L266 — 删除此段
  } catch (writeErr) { ... }
}
```

**修改后**:
```typescript
function writeJson(p, data) {
  // DB-only write (P2-A Step 8 完成收尾)
  try {
    if (isGateState && typeof data === "object") {
      const store = hotToGateStore(data, p);
      const dbOk = dbSaveGateStore(store);
      if (!dbOk) {
        writeLog("mcp-compliance-gate", "ERROR", {
          event: "DB-SAVE-GATE-FAILED-NO-FALLBACK",
          detail: `gate-state.json write skipped — DB is canonical source`,
        });
      }
      return;  // 不再写 JSON 文件
    }
  } catch (dbErr) {
    writeLog("mcp-compliance-gate", "ERROR", {
      event: "DB-WRITE-FATAL",
      error: dbErr.message,
    });
    const enfMode = getEnforcementMode();
    if (enfMode !== "advisory") throw dbErr;
    return;
  }

  // 非 gate-state 的 JSON 文件：保留 writeFileSync（如 rule_registry.json）
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(p, content, "utf8");
}
```

**日志事件**:
- `DB-SAVE-GATE-FAILED-NO-FALLBACK` (ERROR): DB 写入失败，不再回退到 JSON
- `DB-WRITE-FATAL` (ERROR): DB 写入异常

**影响文件**:
- `scripts/mcp-tools/compliance-gate.ts` L238-281
- `hooks/lib/hook-layers.ts` L116,249（已为只读，无需修改）

#### 1.2 移除 dispatch-subagent.ts .pending.json 双写

**位置**: `scripts/command-tools/dispatch-subagent.ts:1251` + `tools/dispatch_subagent.ts:622`

**当前代码**（dispatch-subagent.ts CLI 入口）:
```typescript
// L1251: 写 .pending.json
fs.writeFileSync(PENDING_FILE, JSON.stringify(queue, null, 2));

// L1318: 写 dispatch_queue 表
dbEnqueueDispatch(...);
```

**修改后**:
```typescript
// DB-only enqueue（Phase 2: 移除 file fallback）
const dbOk = dbEnqueueDispatch(...);
if (!dbOk) {
  writeLog("dispatch-subagent", "ERROR", {
    event: "DB-ENQUEUE-FAILED-NO-FALLBACK",
    detail: `dispatchId=${dispatchId} — .pending.json write skipped, DB is canonical`,
  });
  // strict/locked 模式下阻断
  const enfMode = getEnforcementMode();
  if (enfMode !== "advisory") {
    throw new Error(`[FW-ENFORCE][DB-ENQUEUE-FAILED] DB is canonical source, cannot fallback to .pending.json`);
  }
}
// 删除 fs.writeFileSync(PENDING_FILE, ...) 调用
```

**同步修改** `tools/dispatch_subagent.ts` L622（`.auto-dispatch.json` 写入）:
```typescript
// 保留 .auto-dispatch.json 作为 LLM-free bridge 的运行时 marker
// 但不再作为持久化权威——dispatch_queue 表是权威
// 添加注释说明 .auto-dispatch.json 是 ephemeral marker
```

**task-before.ts 回退路径修改** (`plugins/task-before.ts:362,406`):
```typescript
// L362: "Fallback: if DB is empty or fails, try file-based .pending.json."
// 修改为：DB-only，移除 .pending.json fallback
// 如果 DB 查询返回空，返回错误而非回退到文件
```

**日志事件**:
- `DB-ENQUEUE-FAILED-NO-FALLBACK` (ERROR): DB enqueue 失败
- `PENDING-FILE-FALLBACK-REMOVED` (INFO): 确认 .pending.json fallback 已移除

**影响文件**:
- `scripts/command-tools/dispatch-subagent.ts` L1251, L1318
- `tools/dispatch_subagent.ts` L622
- `plugins/task-before.ts` L362, L406
- `plugins/dispatch-auto.ts` L34（MAX_AGE_MS 清理保留，但 .auto-dispatch.json 是 ephemeral）

#### 1.3 knowledge-store.ts index.json DB-canonical 化

**位置**: `lib/knowledge-store.ts:744,1362` `writeManifest()` / `addEntry()`

**当前代码**: 直接 `fs.writeFileSync('docs/official_docs/index.json', ...)`

**修改方案**:
```typescript
// 新增 DB-canonical manifest 函数
export function dbWriteManifest(manifest: KnowledgeManifest): boolean {
  try {
    const db = getDb();
    const txn = db.transaction(() => {
      // 1. UPSERT knowledge_entries（已存在）
      // 2. UPSERT knowledge_files（已存在）
      // 3. UPSERT knowledge_entry_tags（已存在）
      // 4. 更新 manifest 缓存表（新增 manifest_cache 表或复用 gate_store_meta 模式）
    });
    txn();
    return true;
  } catch (e: any) {
    writeLog("knowledge-store", "ERROR", {
      event: "DB-WRITE-MANIFEST-FAILED",
      detail: e.message,
    });
    return false;
  }
}

// 导出缓存：DB → index.json（只读快照）
export function dbMaterializeManifest(root?: string): void {
  const db = getDb();
  const entries = db.query("SELECT ... FROM knowledge_entries JOIN knowledge_files ...").all();
  const manifest = { libraries: entries };
  atomicWriteJson(path.join(root || OPENCODE_ROOT, "docs/official_docs/index.json"), manifest);
  writeLog("knowledge-store", "runtime", {
    event: "MANIFEST-MATERIALIZED",
    detail: `Exported ${entries.length} entries to index.json (read-only cache)`,
  });
}

// writeManifest() 修改为 DB-first + 导出缓存
export function writeManifest(manifest: KnowledgeManifest): void {
  const dbOk = dbWriteManifest(manifest);
  if (!dbOk) {
    writeLog("knowledge-store", "ERROR", {
      event: "DB-MANIFEST-FALLBACK-BLOCKED",
      detail: "index.json write skipped — DB is canonical source",
    });
    return;
  }
  // 导出只读缓存（非事务，atomicWriteJson）
  dbMaterializeManifest();
}
```

**影响文件**:
- `lib/knowledge-store.ts` L744, L1362, 新增 `dbWriteManifest` / `dbMaterializeManifest`
- `lib/db-state-manager.ts` 可能需要新增 manifest 相关 DB 函数

#### 1.4 ctx/*.json 迁移到 DB

**位置**: `lib/agent-resolver.ts:199` + `tools/dispatch_subagent.ts:744`

**当前代码**: `fs.writeFileSync(ctxFile, JSON.stringify(ctx, ...))`

**修改方案**:
```typescript
// 新增 dispatch_context 表（如果不存在）
// Schema: (dag_task_id TEXT PRIMARY KEY, parent_session_id, agent_type, prompt_hash, ctx_json, created_at, updated_at)

// dbWriteDispatchCtx — 事务包裹
export function dbWriteDispatchCtx(dagTaskId: string, ctx: DispatchCtx): boolean {
  try {
    const db = getDb();
    const txn = db.transaction(() => {
      db.run(
        `INSERT OR REPLACE INTO dispatch_context (dag_task_id, parent_session_id, agent_type, prompt_hash, ctx_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dagTaskId, ctx.parentSessionId, ctx.agentType, ctx.promptHash, JSON.stringify(ctx), Date.now(), Date.now()],
      );
    });
    txn();
    return true;
  } catch (e: any) {
    writeLog("agent-resolver", "ERROR", { event: "DB-WRITE-CTX-FAILED", detail: e.message });
    return false;
  }
}

// dbReadDispatchCtx — 读取
export function dbReadDispatchCtx(dagTaskId: string): DispatchCtx | null {
  const db = getDb();
  const row = db.query("SELECT ctx_json FROM dispatch_context WHERE dag_task_id = ?").get(dagTaskId);
  return row ? JSON.parse(row.ctx_json) : null;
}
```

**Schema migration**: 在 `db-manager.ts:initializeSchema()` 新增 v26 migration:
```sql
CREATE TABLE IF NOT EXISTS dispatch_context (
  dag_task_id TEXT PRIMARY KEY,
  parent_session_id TEXT,
  agent_type TEXT,
  prompt_hash TEXT,
  ctx_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**影响文件**:
- `lib/db-state-manager.ts` 新增 `dbWriteDispatchCtx` / `dbReadDispatchCtx`
- `lib/db-manager.ts` 新增 v26 schema migration
- `lib/agent-resolver.ts` L199 改为调用 `dbWriteDispatchCtx`
- `tools/dispatch_subagent.ts` L744 改为调用 `dbWriteDispatchCtx`

#### 1.5 废弃 .transaction-log 清理

**位置**: `scripts/state-transaction.ts:175,806,939`

**修改方案**: 将 `StateTransaction` 类标记为 `@deprecated`，移除 `compliance-gate.ts` 中对 `.transaction-log` 的引用（如果有）。保留代码但添加运行时警告日志。

```typescript
// scripts/state-transaction.ts 头部添加
/**
 * @deprecated P2-A Step 8 后，状态持久化以 SQLite 事务为准。
 * 本模块保留作为历史参考，不应在新代码中使用。
 * 新代码应使用 db.transaction() 或 atomicWriteSubState()。
 */
```

---

### Phase 2: 原子性补全（P0）

#### 2.1 dag-version-manager.ts 原子化

**位置**: `lib/dag-version-manager.ts:323,340,357,364,366`

**修改方案**: 将所有 `writeFileSync` 替换为 `atomicWriteJson`:

```typescript
// L323: writeDAG()
atomicWriteJson(this.hotFile, this.dag);  // 替换 writeFileSync

// L340: writeSnapshot()
atomicWriteJson(snapshotPath, snapshot);  // 替换 writeFileSync

// L357,364,366: appendChangelog()
// append 模式不能用 atomicWriteJson，改为先读后写原子化
const existing = fs.existsSync(this.changelogFile) ? JSON.parse(fs.readFileSync(this.changelogFile, "utf8")) : [];
existing.push(entry);
atomicWriteJson(this.changelogFile, existing);
```

**日志事件**:
- `DAG-WRITE-ATOMIC` (DEBUG): 原子写入 DAG 文件
- `DAG-SNAPSHOT-ATOMIC` (DEBUG): 原子写入快照

#### 2.2 state-compactor.ts 原子化

**位置**: `lib/state-compactor.ts:405,658`

**修改方案**:
```typescript
// L405: indexFile
atomicWriteJson(this.indexFile, index);  // 替换 writeFileSync

// L658: archiveFile
atomicWriteJson(this.archiveFile, archive);  // 替换 writeFileSync

// L359: historyFile (append-only)
// append 模式保留 fs.writeFileSync flag:"a"，但添加 writeLog 记录
```

#### 2.3 dispatch-subagent.ts prompt 文件原子化

**位置**: `scripts/command-tools/dispatch-subagent.ts:1009`

**修改方案**:
```typescript
// L1009: 替换 fs.writeFileSync 为 atomicWriteJson（或 atomicWriteText）
atomicWriteJson(outputFile, tokenizedPrompt);  // 如果是 JSON
// 或新增 atomicWriteText 函数（temp+rename 用于文本）
```

**新增工具函数** `lib/state-utils.ts`:
```typescript
export function atomicWriteText(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}
```

#### 2.4 dbEnqueueDispatch 事务包裹

**位置**: `lib/dispatch-db.ts:102-142`

**当前代码**:
```typescript
// L114: db.run(prompt_ref insert)
// L122: db.run(queue insert)  — 两个独立 db.run，无事务
```

**修改方案**:
```typescript
export function dbEnqueueDispatch(entry: DispatchQueueEntry): boolean {
  try {
    const db = getDb();
    const txn = db.transaction(() => {
      // 1. INSERT dispatch_prompt_refs
      db.run(
        `INSERT OR REPLACE INTO dispatch_prompt_refs (id, prompt_hash, file_path, created_at)
         VALUES (?, ?, ?, ?)`,
        [entry.promptRefId, entry.promptHash, entry.filePath, Date.now()],
      );
      // 2. INSERT dispatch_queue
      db.run(
        `INSERT INTO dispatch_queue (status, agent_type, dag_task_id, session_id, prompt_ref_id, lease_owner, lease_expiry, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["pending", entry.agentType, entry.dagTaskId, entry.sessionId, entry.promptRefId, null, null, Date.now(), Date.now()],
      );
    });
    txn();
    writeLog("dispatch-db", "runtime", {
      event: "DB-ENQUEUE-ATOMIC",
      detail: `dispatchId=${entry.dispatchId} agent=${entry.agentType} taskId=${entry.dagTaskId}`,
    });
    return true;
  } catch (e: any) {
    writeLog("dispatch-db", "ERROR", {
      event: "DB-ENQUEUE-FAILED",
      detail: e.message,
    });
    return false;
  }
}
```

#### 2.5 drainStaleSessions 跨事务统一

**位置**: `lib/gate-core.ts:1324-1428`

**当前问题**: `dbArchiveDrainedSession(sid)` (L1386) 和 `saveGateStore(store)` (L1412) 是两个独立事务。如果 archive 成功但 save 失败，session 在 `gate_audit_history` 已归档但 `gate_sessions` 仍为旧状态。

**修改方案**: 将 archive + 状态更新合并为单一事务:

```typescript
export function drainStaleSessions(armedHours = 24, checkedHours = 48, root?: string): DrainResult {
  const store = loadGateStore(root);
  const nowTs = Date.now();
  const drainedIds: string[] = [];
  let drainedArmed = 0, drainedChecked = 0, drainedDelivered = 0;

  // 收集需要 drain 的 session
  const toDrain: Array<{ sid: string; ses: GateSession; drainType: string; reason: string }> = [];
  for (const sid of Object.keys(store.sessions)) {
    const ses = store.sessions[sid];
    if (!ses) continue;
    // ... 现有逻辑判断 shouldDrain，收集到 toDrain ...
  }

  // 单一事务：archive + update status
  const db = getDb();
  const txn = db.transaction(() => {
    for (const { sid, ses, drainType, reason } of toDrain) {
      // 1. INSERT into gate_audit_history (archive)
      db.run(
        `INSERT INTO gate_audit_history (session_id, task_desc, reason, drain_type, snapshot, archived_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sid, ses.task_description || "", reason, drainType, JSON.stringify(ses), Date.now()],
      );
      // 2. UPDATE gate_sessions status = 'drained'
      db.run(
        `UPDATE gate_sessions SET status = 'drained', updated_at = ? WHERE session_id = ?`,
        [Date.now(), sid],
      );
    }
  });
  txn();

  // 更新内存 store
  for (const { sid } of toDrain) {
    delete store.sessions[sid];
    drainedIds.push(sid);
  }
  store.last_updated = new Date().toISOString();
  // saveGateStore 不再需要单独调用——DB 已在事务内更新
  // 但为了保持内存与 DB 一致，仍调用 saveGateStore（此时是 no-op，因为 DB 已更新）
  
  writeLog("gate-core", "runtime", {
    event: "DRAIN-STALE-ATOMIC",
    detail: `Drained ${drainedIds.length} sessions (armed=${drainedArmed}, checked=${drainedChecked}, delivered=${drainedDelivered})`,
  });

  return { purged: 0, drained_sessions: drainedIds, ... };
}
```

#### 2.6 dispatch-subagent.ts 7 步原子化（补偿机制）

**位置**: `scripts/command-tools/dispatch-subagent.ts:720-1318`

**当前问题**: 7 步独立写入，无回退。

**修改方案**: 引入补偿（compensation）模式而非单一事务（因为涉及文件 IO + DB 混合）:

```typescript
// 新增 DispatchCompensationTracker
interface CompensationStep {
  name: string;
  undo: () => void;
}

class DispatchCompensationTracker {
  private steps: CompensationStep[] = [];
  
  add(name: string, undo: () => void) {
    this.steps.push({ name, undo });
  }
  
  rollback() {
    writeLog("dispatch-subagent", "ERROR", {
      event: "DISPATCH-ROLLBACK-START",
      detail: `Rolling back ${this.steps.length} steps`,
    });
    // 逆序回退
    for (let i = this.steps.length - 1; i >= 0; i--) {
      try {
        this.steps[i].undo();
        writeLog("dispatch-subagent", "runtime", {
          event: "DISPATCH-ROLLBACK-STEP",
          detail: `Undid: ${this.steps[i].name}`,
        });
      } catch (e: any) {
        writeLog("dispatch-subagent", "ERROR", {
          event: "DISPATCH-ROLLBACK-FAILED",
          detail: `Failed to undo ${this.steps[i].name}: ${e.message}`,
        });
      }
    }
    writeLog("dispatch-subagent", "runtime", {
      event: "DISPATCH-ROLLBACK-COMPLETE",
      detail: `Rolled back ${this.steps.length} steps`,
    });
  }
}

// 使用示例
const tracker = new DispatchCompensationTracker();
try {
  // Step 1: dbWriteSessionMap(parent)
  dbWriteSessionMap(parent, agent, dagTaskId);
  tracker.add("parent-session-map", () => dbDeleteSessionMap(parent));
  
  // Step 2: dbWriteDispatchCtx
  dbWriteDispatchCtx(dagTaskId, ctx);
  tracker.add("dispatch-ctx", () => dbDeleteDispatchCtx(dagTaskId));
  
  // Step 3: dbWriteSessionMap(child)
  dbWriteSessionMap(childSlotKey, ...);
  tracker.add("child-session-map", () => dbDeleteSessionMap(childSlotKey));
  
  // Step 4: atomicWriteText(prompt)
  atomicWriteText(outputFile, tokenizedPrompt);
  tracker.add("prompt-file", () => { try { fs.unlinkSync(outputFile); } catch {} });
  
  // Step 5-6: checklist + pending（已迁移到 DB-only）
  // Step 7: dbEnqueueDispatch（已事务化）
  dbEnqueueDispatch(entry);
  tracker.add("dispatch-queue", () => dbDequeueDispatch(entry.dispatchId));
  
} catch (e: any) {
  tracker.rollback();
  throw e;
}
```

**新增 DB 函数** `lib/db-state-manager.ts`:
```typescript
export function dbDeleteSessionMap(key: string): boolean { ... }
export function dbDeleteDispatchCtx(dagTaskId: string): boolean { ... }
export function dbDequeueDispatch(dispatchId: string): boolean { ... }
```

---

### Phase 3: 回退/清理机制补全（P1）

#### 3.1 修复 confirmed_at/approved 双盲区

**位置**: `plugins/session.ts:209`, `lib/gate-core.ts:596,1354`, `scripts/mcp-tools/compliance-gate.ts:682`

**修改方案**: 所有 drain 机制的 SQL/JS 过滤条件增加 `confirmed_at IS NULL` 分支:

**session.ts L209**:
```typescript
// 修改前
WHERE status = 'armed' AND confirmed_at IS NOT NULL AND confirmed_at < ?

// 修改后
WHERE status = 'armed' AND (
  (confirmed_at IS NOT NULL AND confirmed_at < ?)
  OR (confirmed_at IS NULL AND created_at < ?)  -- 中断产生的孤儿
)
```

**gate-core.ts L596** (`reconcileGateStore`):
```typescript
// 修改前
if (ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at) {

// 修改后
if (ses.gate_status === "armed" && !ses.consumed_at) {
  const age = ses.confirmed_at
    ? nowTs - new Date(ses.confirmed_at).getTime()
    : nowTs - new Date(ses.created_at).getTime();  // null confirmed_at 用 created_at
  if (age > STALE_MS) {
    reconciled = true;
    return false;
  }
}
```

**gate-core.ts L1354** (`drainStaleSessions`):
```typescript
// 修改前
if (ses.gate_status === "armed" && !ses.consumed_at && ses.confirmed_at) {
  const age = nowTs - new Date(ses.confirmed_at).getTime();

// 修改后
if (ses.gate_status === "armed" && !ses.consumed_at) {
  const refTime = ses.confirmed_at || ses.created_at;
  const age = nowTs - new Date(refTime).getTime();
```

**compliance-gate.ts L682**: 同上修改

#### 3.2 修复 approved 状态 drain 盲区

**位置**: `plugins/session.ts:173` (Step2), `lib/gate-core.ts:1373` (drainStaleSessions delivered 类型)

**修改方案**:

**session.ts Step2** (L164-187):
```typescript
// 修改前
WHERE status = 'delivered' AND ... 

// 修改后
WHERE status IN ('delivered', 'approved') AND consumed_at IS NULL AND created_at < ?
```

**gate-core.ts L1373** (drainStaleSessions):
```typescript
// 修改前
if (ses.gate_status === "delivered" && ses.submitted_deliverables) {

// 修改后
if ((ses.gate_status === "delivered" || ses.gate_status === "approved") && ses.submitted_deliverables) {
```

#### 3.3 新增 dispatch_queue 启动清理

**位置**: `plugins/session.ts` 新增 Step4

```typescript
// Step 4: Drain stale dispatch_queue entries (>24h)
try {
  if (db) {
    const staleHours = __readConfigGateThreshold("dispatch_queue_stale_hours", 24);
    const cutoff = Date.now() - staleHours * 3600000;
    const txn = db.transaction(() => {
      const result = db.run(
        `UPDATE dispatch_queue SET status = 'expired', updated_at = ?
         WHERE status IN ('stale', 'pending') AND created_at < ?`,
        [Date.now(), cutoff],
      );
      return result.changes;
    });
    const expired = txn();
    if (expired > 0) {
      writeLog("session", "runtime", {
        sessionID: sid, agent,
        event: "DISPATCH-QUEUE-CLEANUP",
        detail: `${expired} stale dispatch_queue entries expired (> ${staleHours}h)`,
      });
    }
  }
} catch (e: any) {
  writeLog("session", "ERROR", {
    sessionID: sid, agent,
    event: "DISPATCH-QUEUE-CLEANUP-FAILED",
    detail: e.message,
  });
}
```

**配置新增** `project.config.json`:
```json
{
  "template_resolution": {
    "gate_stale_thresholds": {
      "armed_hours": 24,
      "checked_hours": 48,
      "delivered_hours": 4,
      "startup_cleanup_armed_hours": 1,
      "approved_hours": 4,
      "dispatch_queue_stale_hours": 24
    }
  }
}
```

#### 3.4 新增 session_map 孤儿清理

**位置**: `plugins/session.ts` 新增 Step5

```typescript
// Step 5: Clean orphan session_map entries (no corresponding session_log)
try {
  if (db) {
    const txn = db.transaction(() => {
      const result = db.run(
        `DELETE FROM session_map
         WHERE session_id NOT IN (
           SELECT DISTINCT session_id FROM session_log WHERE session_id IS NOT NULL
         )`,
      );
      return result.changes;
    });
    const cleaned = txn();
    if (cleaned > 0) {
      writeLog("session", "runtime", {
        sessionID: sid, agent,
        event: "SESSION-MAP-ORPHAN-CLEANUP",
        detail: `${cleaned} orphan session_map entries removed`,
      });
    }
  }
} catch (e: any) {
  writeLog("session", "ERROR", {
    sessionID: sid, agent,
    event: "SESSION-MAP-CLEANUP-FAILED",
    detail: e.message,
  });
}
```

#### 3.5 新增 ctx/ 孤儿文件 GC

**位置**: `plugins/session.ts` 新增 Step6（ctx 迁移到 DB 后，清理残留文件）

```typescript
// Step 6: GC orphan ctx/*.json files (after DB migration)
try {
  const ctxDir = path.join(root, ".task_temp", "_dispatch", "ctx");
  if (fs.existsSync(ctxDir)) {
    const files = fs.readdirSync(ctxDir).filter(f => f.endsWith(".json"));
    let cleaned = 0;
    for (const f of files) {
      const dagTaskId = f.replace(".json", "");
      const exists = db?.query("SELECT 1 FROM dispatch_context WHERE dag_task_id = ?").get(dagTaskId);
      if (!exists) {
        fs.unlinkSync(path.join(ctxDir, f));
        cleaned++;
      }
    }
    if (cleaned > 0) {
      writeLog("session", "runtime", {
        sessionID: sid, agent,
        event: "CTX-FILE-GC",
        detail: `${cleaned} orphan ctx/*.json files removed`,
      });
    }
  }
} catch (e: any) {
  writeLog("session", "ERROR", {
    sessionID: sid, agent,
    event: "CTX-FILE-GC-FAILED",
    detail: e.message,
  });
}
```

#### 3.6 新增孤儿 prompt 文件扫描

**位置**: `plugins/session.ts` 新增 Step7

```typescript
// Step 7: Scan for orphan prompt files (not referenced in dispatch_queue)
try {
  const dispatchDir = path.join(root, ".task_temp", "_dispatch");
  if (fs.existsSync(dispatchDir)) {
    const promptFiles = fs.readdirSync(dispatchDir)
      .filter(f => f.startsWith("dispatch-") && f.endsWith(".md"));
    let cleaned = 0;
    for (const f of promptFiles) {
      const filePath = path.join(dispatchDir, f);
      // 检查 dispatch_prompt_refs 或 dispatch_queue 是否引用
      const relPath = path.relative(root, filePath);
      const ref = db?.query("SELECT 1 FROM dispatch_prompt_refs WHERE file_path = ?").get(filePath);
      if (!ref) {
        // 超过 24h 的未引用文件才清理
        const stat = fs.statSync(filePath);
        if (Date.now() - stat.mtimeMs > 24 * 3600000) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) {
      writeLog("session", "runtime", {
        sessionID: sid, agent,
        event: "PROMPT-FILE-GC",
        detail: `${cleaned} orphan prompt files removed`,
      });
    }
  }
} catch (e: any) {
  writeLog("session", "ERROR", {
    sessionID: sid, agent,
    event: "PROMPT-FILE-GC-FAILED",
    detail: e.message,
  });
}
```

---

### Phase 4: 状态迁移兼容性修复（P1）

#### 4.1 修复 GATE-APPROVAL-LOCK status='delivered' → 'approved'

**位置**: `plugins/dispatch-before.ts:240`

**当前代码**:
```typescript
const rows = db.query("SELECT session_id FROM gate_sessions WHERE status = ?").all("delivered");
```

**修改后**:
```typescript
const rows = db.query("SELECT session_id FROM gate_sessions WHERE status IN ('delivered', 'approved') AND consumed_at IS NULL").all();
```

#### 4.2 统一 drain 逻辑状态值

**位置**: 所有 drain 机制的 `status = 'delivered'` 查询

**修改**: 全部改为 `status IN ('delivered', 'approved')`

---

### Phase 5: Framework Harness 更新（P2）

#### 5.1 更新 Check 35（陈旧 .pending.json）

**位置**: `scripts/framework-self-test.ts` Check 35

**修改**: `.pending.json` 迁移到 DB-only 后，Check 35 改为验证 `dispatch_queue` 表:

```typescript
// 修改前：检查 .pending.json 是否陈旧
// 修改后：检查 dispatch_queue 表是否有 stale 条目
const staleCount = db.query("SELECT COUNT(*) as c FROM dispatch_queue WHERE status = 'stale' AND created_at < ?").get(Date.now() - 24 * 3600000);
if (staleCount.c > 0) {
  issues.push(`Check 35: ${staleCount.c} stale dispatch_queue entries older than 24h`);
}
```

#### 5.2 新增 Check 69（DB-canonical 验证）

```typescript
// Check 69: 验证无 JSON 双写残留
const complianceGateWriteJson = fs.readFileSync("scripts/mcp-tools/compliance-gate.ts", "utf8");
if (complianceGateWriteJson.includes('fs.writeFileSync(p, content, "utf8")') && 
    complianceGateWriteJson.includes('isGateState')) {
  // 检查 writeJson 是否仍对 gate-state.json 做 writeFileSync
  issues.push("Check 69: compliance-gate.ts writeJson still does JSON dual-write for gate-state.json");
}
```

---

## 四、实施顺序

```
Phase 1 (DB-canonical 收尾) — P0
  ├── 1.1 compliance-gate.ts gate-state.json 双写移除
  ├── 1.2 dispatch-subagent.ts .pending.json 双写移除
  ├── 1.3 knowledge-store.ts index.json DB-canonical 化
  ├── 1.4 ctx/*.json 迁移到 DB（新增 v26 schema）
  └── 1.5 .transaction-log 废弃标记

Phase 2 (原子性补全) — P0
  ├── 2.1 dag-version-manager.ts 原子化（4 处）
  ├── 2.2 state-compactor.ts 原子化（2 处）
  ├── 2.3 dispatch-subagent.ts prompt 原子化 + atomicWriteText
  ├── 2.4 dbEnqueueDispatch 事务包裹
  ├── 2.5 drainStaleSessions 跨事务统一
  └── 2.6 dispatch-subagent.ts 7 步补偿机制

Phase 3 (回退/清理补全) — P1
  ├── 3.1 修复 confirmed_at 盲区（4 处）
  ├── 3.2 修复 approved 状态 drain 盲区（2 处）
  ├── 3.3 新增 dispatch_queue 启动清理
  ├── 3.4 新增 session_map 孤儿清理
  ├── 3.5 新增 ctx/ 孤儿文件 GC
  └── 3.6 新增孤儿 prompt 文件扫描

Phase 4 (状态迁移兼容性) — P1
  ├── 4.1 GATE-APPROVAL-LOCK status='delivered' → 'approved'
  └── 4.2 统一 drain 逻辑状态值

Phase 5 (Framework Harness) — P2
  ├── 5.1 更新 Check 35
  └── 5.2 新增 Check 69
```

---

## 五、日志事件清单

所有新增代码必须使用 `writeLog(plugin, category, fields)` API（`log-manager.ts` v3.0）:

| 事件 | category | level | 触发条件 | plugin |
|------|----------|-------|---------|--------|
| `DB-SAVE-GATE-FAILED-NO-FALLBACK` | runtime | ERROR | compliance-gate DB 写失败 | mcp-compliance-gate |
| `DB-WRITE-FATAL` | runtime | ERROR | compliance-gate DB 写异常 | mcp-compliance-gate |
| `DB-ENQUEUE-FAILED-NO-FALLBACK` | runtime | ERROR | dispatch DB enqueue 失败 | dispatch-subagent |
| `PENDING-FILE-FALLBACK-REMOVED` | runtime | INFO | .pending.json fallback 移除确认 | dispatch-subagent |
| `DB-WRITE-MANIFEST-FAILED` | runtime | ERROR | knowledge manifest DB 写失败 | knowledge-store |
| `MANIFEST-MATERIALIZED` | runtime | INFO | DB → index.json 导出缓存 | knowledge-store |
| `DB-MANIFEST-FALLBACK-BLOCKED` | runtime | ERROR | index.json 直接写被阻断 | knowledge-store |
| `DB-WRITE-CTX-FAILED` | runtime | ERROR | dispatch ctx DB 写失败 | agent-resolver |
| `DAG-WRITE-ATOMIC` | runtime | DEBUG | 原子写入 DAG 文件 | dag-version-manager |
| `DAG-SNAPSHOT-ATOMIC` | runtime | DEBUG | 原子写入快照 | dag-version-manager |
| `DB-ENQUEUE-ATOMIC` | runtime | INFO | 事务化 enqueue 成功 | dispatch-db |
| `DB-ENQUEUE-FAILED` | runtime | ERROR | 事务化 enqueue 失败 | dispatch-db |
| `DRAIN-STALE-ATOMIC` | runtime | INFO | 原子化 drain 完成 | gate-core |
| `DISPATCH-ROLLBACK-START` | runtime | ERROR | dispatch 补偿回退开始 | dispatch-subagent |
| `DISPATCH-ROLLBACK-STEP` | runtime | INFO | dispatch 补偿回退单步 | dispatch-subagent |
| `DISPATCH-ROLLBACK-COMPLETE` | runtime | INFO | dispatch 补偿回退完成 | dispatch-subagent |
| `DISPATCH-ROLLBACK-FAILED` | runtime | ERROR | dispatch 补偿回退单步失败 | dispatch-subagent |
| `DISPATCH-QUEUE-CLEANUP` | runtime | INFO | dispatch_queue stale 清理 | session |
| `DISPATCH-QUEUE-CLEANUP-FAILED` | runtime | ERROR | dispatch_queue 清理失败 | session |
| `SESSION-MAP-ORPHAN-CLEANUP` | runtime | INFO | session_map 孤儿清理 | session |
| `SESSION-MAP-CLEANUP-FAILED` | runtime | ERROR | session_map 清理失败 | session |
| `CTX-FILE-GC` | runtime | INFO | ctx 文件 GC | session |
| `CTX-FILE-GC-FAILED` | runtime | ERROR | ctx 文件 GC 失败 | session |
| `PROMPT-FILE-GC` | runtime | INFO | prompt 文件 GC | session |
| `PROMPT-FILE-GC-FAILED` | runtime | ERROR | prompt 文件 GC 失败 | session |

---

## 六、代码规范合规

### 6.1 Plugin 规范

本次不新增 plugin。所有修改在现有 plugin 文件内进行:
- `plugins/session.ts` — 启动清理扩展
- `plugins/dispatch-before.ts` — GATE-APPROVAL-LOCK 修复
- `plugins/dispatch-auto.ts` — 无需修改（.auto-dispatch.json 是 ephemeral marker）

### 6.2 Tool 规范

本次不新增 tool。修改现有 tool:
- `tools/dispatch_subagent.ts` — ctx 文件 DB 化
- `scripts/command-tools/dispatch-subagent.ts` — 补偿机制 + prompt 原子化

### 6.3 MCP 工具规范

本次不新增 MCP 工具。修改现有 MCP tool:
- `scripts/mcp-tools/compliance-gate.ts` — writeJson DB-only 化

### 6.4 writeLog 规范

所有新增代码使用 `writeLog(plugin, "runtime", { ... })` 格式（见 §五）。

### 6.5 safe_edit 规范

本次代码修改使用 `safe_edit` 工具（通过 @Super-Admin 或 @Coder-BE 执行）。

### 6.6 checklist 集成

关键步骤调用 `checklistWirePassed/Failed`:
- Phase 1 完成后：`checklistWirePassed("db-canonical-migration")`
- Phase 2 完成后：`checklistWirePassed("atomicity-complete")`
- Phase 3 完成后：`checklistWirePassed("recovery-complete")`

---

## 七、风险评估

| 风险 | 影响 | 缓解 | 优先级 |
|------|------|------|:------:|
| compliance-gate.ts DB-only 后 DB 故障导致 gate 不可用 | gate 操作全部阻断 | strict/locked 模式抛异常，advisory 模式继续；DB 健康检查 `getDbHealth()` | P0 |
| dispatch .pending.json 移除后 DB 故障导致 dispatch 不可用 | 新 dispatch 阻断 | DB 健康检查 + advisory 模式降级 | P0 |
| drainStaleSessions 事务合并后性能影响 | 单事务处理大量 session | 批量处理（每批 100 个 session） | P1 |
| ctx DB 化后 schema v26 migration 失败 | 框架启动失败 | migration 前自动备份 framework-state.db | P1 |
| 补偿机制回退不完整 | 残留部分状态 | 回退失败时记录 ERROR 日志 + 写入 `dispatch_failed_log` | P1 |

---

## 八、验证计划

### 8.1 Phase 1 验证

```bash
# 验证 compliance-gate.ts 不再写 gate-state.json
grep -n "writeFileSync.*gate-state" .opencode/scripts/mcp-tools/compliance-gate.ts
# 期望：无匹配（或仅在非 gate-state 路径）

# 验证 dispatch-subagent.ts 不再写 .pending.json
grep -n "writeFileSync.*pending" .opencode/scripts/command-tools/dispatch-subagent.ts
# 期望：无匹配

# 验证 schema v26
bun -e "const {Database} = require('bun:sqlite'); const db = new Database('.opencode/state/framework-state.db', {readonly:true}); console.log(db.query('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get());"
# 期望：{ version: 26 }
```

### 8.2 Phase 2 验证

```bash
# 验证 dag-version-manager 使用 atomicWriteJson
grep -n "atomicWriteJson\|atomicWriteText" .opencode/lib/dag-version-manager.ts
# 期望：有匹配

# 验证 dbEnqueueDispatch 使用 db.transaction
grep -n "db.transaction" .opencode/lib/dispatch-db.ts
# 期望：有匹配
```

### 8.3 Phase 3 验证

```bash
# 验证 session.ts 包含 approved 状态清理
grep -n "'approved'" .opencode/plugins/session.ts
# 期望：有匹配

# 验证 session.ts 包含 dispatch_queue 清理
grep -n "dispatch_queue" .opencode/plugins/session.ts
# 期望：有匹配

# 运行 framework-self-test
bun .opencode/scripts/framework-self-test.ts
# 期望：Check 35 和 Check 69 通过
```

### 8.4 孤儿状态清理验证

```bash
# 清理后查询孤儿数量
bun -e "
const {Database} = require('bun:sqlite');
const db = new Database('.opencode/state/framework-state.db', {readonly:true});
console.log('armed+null:', db.query('SELECT COUNT(*) as c FROM gate_sessions WHERE status=? AND armed_at IS NULL').get('armed'));
console.log('approved+null:', db.query('SELECT COUNT(*) as c FROM gate_sessions WHERE status=? AND consumed_at IS NULL').get('approved'));
console.log('dispatch_queue stale:', db.query('SELECT COUNT(*) as c FROM dispatch_queue WHERE status=?').get('stale'));
console.log('session_map orphans:', db.query('SELECT COUNT(*) as c FROM session_map sm LEFT JOIN session_log sl ON sm.session_id = sl.session_id WHERE sl.session_id IS NULL').get());
"
# 期望：全部为 0
```

---

## 九、结论

当前框架的 DB-only/DB-canonical 迁移**核心层已完成**（substate/gate-core/audit），但**外围层未完成**（compliance-gate 双写 / dispatch 双写 / knowledge-store 直接写 / ctx 文件权威）。

原子性机制**核心已完成**（atomicWriteSubState / dbSaveGateStore / StateTransaction），但**外围存在 7 类缺口**（非原子 writeFileSync / 非事务 multi-insert / 跨事务不一致 / 7 步无回退）。

回退/清理机制**覆盖不全**（4 类孤儿状态无清理 + 3 类孤儿文件无 GC）。

本方案分 5 个 Phase 实施，优先级 P0（Phase 1-2）→ P1（Phase 3-4）→ P2（Phase 5），确保符合 12 子系统规范，正确集成日志系统，符合 OpenCode mcp/plugin/tool 代码规范。
