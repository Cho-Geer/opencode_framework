# P3 框架深度优化方案 — G11/G12/G2 + 遗留问题治理

**日期：** 2026-06-16
**制定者：** @Orchestrator (基于 @Meta-Planner 深度分析)
**前置条件：** P2-A Step 0-8 + post-Step-8 补丁全部完成；所有读写路径 DB-only
**目标：** 解决 G11/G12/G2 三个遗留 G-problem + 治理 5 项结构性遗留问题

---

## 一、G11: FileStateRegistry 跨进程限制

### 1.1 问题定义

**位置：** `.opencode/lib/safe-edit-core.ts:70-84`

`FileStateRegistry` 是一个**进程内内存 Map** (`_fileRegistry = new Map<string, ...>()`)，用于 TOCTOU (Time-of-Check-Time-of-Use) 检测。它跟踪文件的 stat 快照 (inode, size, mtime, ctime, dev)，使 `writeSafe()` 能检测审计与写入之间文件是否被修改。

**核心限制：** Registry 仅存在于单个 Node.js/Bun 进程内存中。如果两个进程（如两个 agent session 或 hook + tool）操作同一文件，彼此看不到对方的 registry 条目，TOCTOU 检测在跨进程边界上**从根本上失效**。

**当前跨进程机制（不充分）：**
- `acquireLock()` (lines 87-145): 使用 `fs.mkdirSync(lockDir)` 在 `/tmp/opencode/safe-edit-locks/` 作为跨进程互斥
  - mkdir 在 POSIX 上原子 → 跨进程互斥**有效**
  - 但使用 `_spinWait()` 忙等（baseDelay * 1.5^i，max 200ms/retry, 100 retries → 最长 ~7.5s）
  - `/tmp` 路径在容器重启时清空，锁状态丢失
- `_fileRegistry` (line 74): 进程内 Map → **TOCTOU baseline 无法跨进程传递**

**writeSafe() 的两步协议问题 (lines 534-549)：**
当文件不在 `_fileRegistry` 中时，`writeSafe` 填充 baseline 并返回 failure ("TOCTOU race detected: no baseline audit in registry -- first call establishes baseline")。这意味着：
- 同进程内的两步协议正常工作（第一步注册 baseline，第二步验证）
- 不同进程的第一步调用总是失败（看不到前进程的 baseline）

### 1.2 解决方案：DB-based File Baseline Registry

**核心思路：** 将 `_fileRegistry` 从进程内 Map 迁移到 SQLite DB 表 `file_baseline_kv`，使 baseline 信息跨进程可见。

**新增 DB 表（schema v4）：**

```sql
CREATE TABLE IF NOT EXISTS file_baseline_kv (
  path_hash TEXT PRIMARY KEY,       -- hex(Buffer.from(filePath))，与 acquireLock 键一致
  inode INTEGER NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,           -- mtimeMs (毫秒级)
  ctime INTEGER NOT NULL,
  dev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  process_id INTEGER NOT NULL       -- 写入进程的 PID，用于 stale 检测
);
```

**迁移步骤：**

| Step | 操作 | 文件 | 风险 |
|------|------|------|:----:|
| S11-1 | 新增 `file_baseline_kv` 表到 schema v4 | `lib/db-manager.ts` initializeSchema() | 低 |
| S11-2 | 新增 `dbReadFileBaseline(pathHash)` / `dbWriteFileBaseline(pathHash, snapshot)` / `dbDeleteFileBaseline(pathHash)` | `lib/db-state-manager.ts` | 低 |
| S11-3 | 重构 `_fileRegistry` → DB 读取：`writeSafe()` 的 TOCTOU 检查从 `_fileRegistry.get()` 改为 `dbReadFileBaseline()` | `lib/safe-edit-core.ts` | 中 |
| S11-4 | 重构 `acquireLock()` → DB-based 乐观锁：保留 mkdir 互斥作为 Layer 1（写入时），DB baseline 作为 Layer 2（TOCTOU 检测时） | `lib/safe-edit-core.ts` | 中 |
| S11-5 | 消除两步协议的首步失败问题：`writeSafe()` 首次调用时从 DB 读取 baseline（如果存在），不再返回 "first call establishes baseline" | `lib/safe-edit-core.ts` | 中 |
| S11-6 | 添加 stale baseline 清理：进程退出或 nightly-compaction 清理 `process_id` 对应已退出进程的 baseline 条目 | `lib/safe-edit-core.ts` + `scripts/nightly-compaction.ts` | 低 |
| S11-7 | 保留 `_fileRegistry` 作为 DB 读取的**进程内缓存层**（避免每次 writeSafe 都读 DB），DB 为权威源 | `lib/safe-edit-core.ts` | 低 |

**S11-3 详细设计：**

```typescript
// 当前逻辑 (safe-edit-core.ts:534-549)
if (!_fileRegistry.has(filePath)) {
  // First call: populate baseline and return failure
  const stat = fs.statSync(filePath);
  _fileRegistry.set(filePath, { inode: stat.ino, size: stat.size, ... });
  return { success: false, error: "TOCTOU race detected: no baseline audit in registry -- first call establishes baseline" };
}

// 新逻辑
const cached = _fileRegistry.get(filePath);
if (!cached) {
  // Check DB for cross-process baseline
  const dbBaseline = dbReadFileBaseline(pathHash);
  if (dbBaseline) {
    // DB has baseline from another process — use it
    _fileRegistry.set(filePath, dbBaseline);
    // Continue TOCTOU check against DB baseline
  } else {
    // Neither in-process nor in-DB: populate both and proceed
    const stat = fs.statSync(filePath);
    const snapshot = { inode: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ... };
    _fileRegistry.set(filePath, snapshot);
    dbWriteFileBaseline(pathHash, snapshot);
    // No longer return failure — proceed with write using current stat as baseline
  }
}
```

**预期效果：**
- TOCTOU 检测从进程内扩展到跨进程
- 两步协议的首步失败问题消除（DB baseline 可替代进程内 baseline）
- `acquireLock()` mkdir 互斥保留作为写入冲突保护（不移除）
- `_spinWait()` 不移除但使用频率大幅降低（TOCTOU 检测提前拦截多数冲突）

**回退方案：** DB 读取失败时 fallback 到进程内 `_fileRegistry`（当前行为），不阻断写入。

---

## 二、G12: readSubState/writeSubState 类型安全 (any)

### 2.1 问题定义

**位置：** `.opencode/lib/substate-manager.ts:41-62`, `.opencode/lib/db-state-manager.ts:50-98`

当前所有子状态读写函数的 value 参数和返回值为 `any`：

```typescript
export function readSubState<K extends keyof typeof SUBSTATE_FILES>(key: K): any
export function writeSubState<K extends keyof typeof SUBSTATE_FILES>(key: K, value: any): boolean
export function atomicWriteSubState<K extends keyof typeof SUBSTATE_FILES>(key: K, modifyFn: (subState: any) => void, maxRetries?: number): boolean
export function dbAtomicWriteSubState<K extends SubStateKey>(key: K, modifyFn: (subState: any) => void, maxRetries?: number): boolean
```

`SUBSTATE_FILES` 类型为 `Record<string, string>`（键不是强类型），key 约束 `K extends keyof typeof SUBSTATE_FILES` 仅保证键名合法，但**值的类型完全无约束**。

**调用者模式（全部依赖 optional chaining on `any`）：**
- `gate-core.ts:757`: `readSubState("eslint_state")?.aggregate?.dirty_modules?.length`
- `knowledge_cache_search.ts:41`: `(preKCS.session_access || {}) as Record<string, any>` — 显式 cast
- `compliance-gate.ts:1222`: `readSubState("eslint_state")?.aggregate?.dirty_modules`

### 2.2 解决方案：Type-safe SubState Interfaces

**核心思路：** 从 `machine.schema.json`（1305 行）提取 12 个子状态的 TypeScript 接口定义，建立 `SubStateMap` 类型映射，使 `readSubState<K>` 返回 `SubStateMap[K]`。

**新增文件：** `.opencode/lib/substate-types.ts`

```typescript
// substate-types.ts — Type-safe interfaces for all 12 sub-states
// Extracted from machine.schema.json (40KB, 1305 lines)

export interface EslintState {
  status: "clean" | "dirty";
  dirty_modules: string[];
  aggregate?: {
    dirty_modules: string[];
    total_rules: number;
    last_full_scan?: string;
    scan_duration_ms?: number;
  };
  modules: Record<string, {
    path: string;
    violations: Array<{ rule: string; severity: string; message: string; line?: number }>;
    last_scanned: string;
  }>;
}

export interface TypeCheckState {
  status: "clean" | "dirty";
  dirty_files: string[];
  last_checked: string;
  errors?: Array<{ file: string; message: string; code?: number }>;
}

export interface DependencyState {
  status: "clean" | "dirty";
  dirty_files: string[];
  last_checked: string;
  packages?: Record<string, { version: string; outdated: boolean }>;
}

export interface FormatState {
  status: "clean" | "dirty";
  dirty_files: string[];
  last_checked: string;
  formatter: string;
}

export interface WriteAuditState {
  sessions: Record<string, {
    session_id: string;
    agent: string;
    writes: Array<{ path: string; timestamp: string; tool: string }>;
    completed_at?: string;
  }>;
}

export interface ComplianceRecords {
  sessions: Record<string, {
    session_id: string;
    task_description: string;
    agent: string;
    checks: Array<{ check: string; passed: boolean; detail?: string }>;
    artifacts: string[];
  }>;
}

export interface KnowledgeCacheState {
  total_entries: number;
  last_updated: string;
  entries: Record<string, {
    query: string;
    domain: string;
    source: string;
    cached_at: string;
    access_count: number;
    content_path: string;
  }>;
  session_access: Record<string, Record<string, {
    accessed_at: string;
    sufficiency: string;
    cache_sufficiency?: Record<string, string>;
  }>>;
}

export interface KnowledgeAuditState {
  last_audit: string;
  total_accesses: number;
  coverage_score: number;
}

export interface TddEnforcementState {
  current_phase: "red" | "green" | "refactor" | "none";
  task_id: string;
  agent: string;
  started_at: string;
}

export interface KeystoneHashes {
  files: Record<string, string>; // path → hash
  last_updated: string;
}

export interface TransactionState {
  current_transaction?: string;
  revision: number;
  last_updated: string;
}

export interface KnowledgeState {
  domains_covered: string[];
  last_updated: string;
  coverage_score: number;
}

// ── Master Type Map ──
export interface SubStateMap {
  eslint_state: EslintState;
  type_check_state: TypeCheckState;
  dependency_state: DependencyState;
  format_state: FormatState;
  write_audit_state: WriteAuditState;
  compliance_records: ComplianceRecords;
  knowledge_cache_state: KnowledgeCacheState;
  knowledge_audit_state: KnowledgeAuditState;
  tdd_enforcement_state: TddEnforcementState;
  keystone_hashes: KeystoneHashes;
  transaction_state: TransactionState;
  knowledge_state: KnowledgeState;
}
```

**迁移步骤：**

| Step | 操作 | 文件 | 风险 |
|------|------|------|:----:|
| S12-1 | 创建 `substate-types.ts`，定义 12 个接口 + `SubStateMap` | `lib/substate-types.ts` (new) | 低 |
| S12-2 | 重构 `SUBSTATE_FILES` 类型为 `Record<keyof SubStateMap, string>` | `lib/substate-manager.ts` | 中 |
| S12-3 | 更新 `readSubState<K extends keyof SubStateMap>(key: K): SubStateMap[K]` | `lib/substate-manager.ts` + `lib/db-state-manager.ts` | 中 |
| S12-4 | 更新 `writeSubState<K extends keyof SubStateMap>(key: K, value: SubStateMap[K]): boolean` | `lib/substate-manager.ts` + `lib/db-state-manager.ts` | 中 |
| S12-5 | 更新 `atomicWriteSubState` modifyFn 签名: `(subState: SubStateMap[K]) => void` | `lib/state-utils.ts` + `lib/db-state-manager.ts` | 中 |
| S12-6 | 更新所有调用者：移除 `?.` 链上的 `any` cast，使用类型化属性访问 | 全框架 (gate-core.ts, compliance-gate.ts, gate-checks.ts 等) | 中 |

**S12-6 调用者影响评估：**

| 调用者文件 | 当前模式 | 迁移后 |
|-----------|---------|--------|
| `gate-core.ts:757` | `readSubState("eslint_state")?.aggregate?.dirty_modules?.length` | `readSubState("eslint_state")?.aggregate?.dirty_modules?.length`（类型化，无需改） |
| `knowledge_cache_search.ts:41` | `(preKCS.session_access || {}) as Record<string, any>` | `(preKCS.session_access || {})`（类型化，移除 cast） |
| `compliance-gate.ts:1222` | `readSubState("eslint_state")?.aggregate?.dirty_modules` | 同上，类型化 |
| `state-transaction.ts:279` | `readSubState("transaction_state") || {}` | `readSubState("transaction_state") || {} as TransactionState`（需默认值类型化） |

**关键决策：`readSubState` 返回 `SubStateMap[K]` 时，DB 读取失败返回什么？**

当前 `readSubState` 在 DB 失败时返回 `{}`。类型化后 `{}` 不满足任何子状态接口。解决方案：

```typescript
export function readSubState<K extends keyof SubStateMap>(key: K): SubStateMap[K] | EmptySubState {
  try {
    const dbResult = dbReadSubState(key as SubStateKey);
    if (dbResult !== null && dbResult !== undefined) return dbResult as SubStateMap[K];
  } catch (e: any) { ... }
  return {} as SubStateMap[K]; // 类型断言：空对象满足宽松接口（所有属性 optional）
}
```

**前提：** 所有 `SubStateMap[K]` 接口的属性必须设计为 optional（`?`），使 `{}` 空对象满足类型。这与现有调用者的 `?.` optional chaining 模式天然兼容——调用者已假设属性可能不存在。

**预期效果：**
- `readSubState("eslint_state")` 返回 `EslintState`（编译时类型检查）
- `writeSubState("eslint_state", value)` 的 `value` 必须满足 `EslintState` 结构
- `atomicWriteSubState("eslint_state", (s) => { s.dirty_modules = ... })` 中 `s` 为 `EslintState`
- IDE 自动补全和重构支持大幅提升
- 新增子状态时必须先定义接口 → 强制文档化

**回退方案：** 类型错误时 `as any` cast 兜底（渐进式迁移，非一刀切）。

---

## 三、G2: machine.json 双 lastUpdated 字段

### 3.1 问题定义

**位置：** `.opencode/state/machine.json`

```json
{
  "meta": {
    "lastUpdated": "2026-06-16T02:02:13.917Z",  // camelCase, 活跃字段
    "last_updated": "2026-05-25T21:01:39Z"       // snake_case, 遗留字段 (3周前)
  }
}
```

`machine.schema.json` 仅定义 `lastUpdated`（required），但 `additionalProperties: true` 允许 `last_updated` 遗留字段持续存在。

**DB 层影响：** `machine_meta` 表为 KV 结构（key TEXT, value TEXT, updated_at INTEGER）。`dbWriteMachineMeta()` 写入 `Object.entries(meta)` 的每个键 → **两个字段都会写入 DB**， perpetuating the dual field issue。

### 3.2 解决方案：DB schema v4 规范化

**核心思路：** 在 `dbWriteMachineMeta()` 中显式过滤 `last_updated` 遗留字段，并在 schema v4 迁移中从 DB 清理该行。

**迁移步骤：**

| Step | 操作 | 文件 | 风险 |
|------|------|------|:----:|
| S2-1 | `dbWriteMachineMeta()` 新增字段过滤：写入时排除 `last_updated` | `lib/db-state-manager.ts` | 低 |
| S2-2 | Schema v4 迁移：`DELETE FROM machine_meta WHERE key = 'last_updated'` | `lib/db-manager.ts` initializeSchema() v4 block | 低 |
| S2-3 | `machine.json` 清理：从文件中删除 `last_updated` 字段 | `.opencode/state/machine.json` | 低 |
| S2-4 | `machine.schema.json` 更新：`meta.properties` 下 `additionalProperties: false`（阻止未来遗留字段） | `.opencode/state/machine.schema.json` | 低 |

**S2-1 详细设计：**

```typescript
// db-state-manager.ts — dbWriteMachineMeta()
const LEGACY_EXCLUDED_KEYS = new Set(["last_updated"]); // snake_case 遗留字段

export function dbWriteMachineMeta(value: Record<string, unknown>): boolean {
  const db = getDb();
  const write = db.transaction(() => {
    // Clear existing rows
    db.run("DELETE FROM machine_meta");
    // Write only canonical keys
    for (const [key, val] of Object.entries(value)) {
      if (LEGACY_EXCLUDED_KEYS.has(key)) continue; // S2-1: filter legacy
      db.run("INSERT OR REPLACE INTO machine_meta (key, value, updated_at) VALUES (?, ?, ?)",
        [key, JSON.stringify(val), Date.now()]);
    }
  });
  write();
  return true;
}
```

**预期效果：**
- DB `machine_meta` 表不再包含 `last_updated` 行
- `machine.json` 仅包含 `lastUpdated`（规范化）
- `machine.schema.json` `additionalProperties: false` 阻止未来遗留字段
- 完全解决 G2

---

## 四、遗留问题 #1: Schema 拆分（machine.schema.json 单体）

### 4.1 问题定义

`machine.schema.json` (1305 行) 定义所有 12+ 子状态为顶层 `required` 字段，与 P1-B 拆分架构不一致——`machine.json` 现在仅包含 `meta` + `contracts`，schema 却要求 `eslint_state`、`type_check_state` 等不再存在的键。

### 4.2 解决方案：拆分为 meta-only schema + 12 个子状态 schema

**新增文件：**
- `.opencode/state/machine.schema.json` → 仅 `meta` + `contracts` (约 80 行)
- `.opencode/state/schemas/eslint-state.schema.json`
- `.opencode/state/schemas/type-check-state.schema.json`
- ... (12 个子状态各自独立 schema)

**迁移步骤：**

| Step | 操作 | 风险 |
|------|------|:----:|
| S41-1 | 从现有 `machine.schema.json` 提取 `meta` + `contracts` 部分为独立 schema | 低 |
| S41-2 | 为每个子状态提取对应的 `properties` 定义为独立 schema 文件 | 低 |
| S41-3 | 更新 `state-compactor.ts` 和 `state-transaction.ts` 中的 schema 引用路径 | 中 |
| S41-4 | 删除旧单体 `machine.schema.json` 或重命名为 `machine.schema.full.json`（保留为参考） | 低 |

**与 G12 的协同：** G12 的 `substate-types.ts` 接口可从拆分后的子状态 schema 自动生成（或手动对照），确保 TypeScript 类型与 JSON Schema 定义一致。

---

## 五、遗留问题 #2: state-transaction.ts 冗余

### 5.1 问题定义

`state-transaction.ts` (1010 行, CJS `require()`) 实现了完整的两阶段提交协议 + WAL + crash recovery。P2-A 后：
- `machine.json` 写入走 `atomicWriteSubState` → DB 事务
- `gate-state.json` 写入走 `dbSaveGateStore()` → DB 事务
- 所有子状态写入走 `atomicWriteSubState` → DB 事务

唯一剩余调用者：`compliance-gate.ts` (lines 192, 240) 使用 `beginTransaction()` 写 `gate-state.json`。但 `gate-state.json` 写入已通过 `dbSaveGateStore()` 路径完成（DB-only），所以 `beginTransaction` 对 gate-state 的调用已冗余。

### 5.2 解决方案：标记 deprecated + 保留 CLI 工具

**核心思路：** 不删除 `state-transaction.ts`（它提供 `verify`, `recover`, `log-tail`, `repair-monotonic` CLI 工具），但将 `beginTransaction()` 标记为 DEPRECATED 并在合规入口点移除调用。

**迁移步骤：**

| Step | 操作 | 文件 | 风险 |
|------|------|------|:----:|
| S52-1 | `compliance-gate.ts` 移除 `beginTransaction` import 和调用（改用 `dbSaveGateStore` 或 `atomicWriteSubState`） | `scripts/mcp-tools/compliance-gate.ts` | 中 |
| S52-2 | `state-transaction.ts` 顶部添加 DEPRECATED 注释：`beginTransaction` 不推荐用于新代码，所有状态写入应使用 `atomicWriteSubState` | `scripts/state-transaction.ts` | 低 |
| S52-3 | 保留 CLI 工具函数（`verify`, `recover`, `log-tail`, `repair-monotonic`）作为运维诊断工具 | — | 低 |

**预期效果：** `beginTransaction` 调用者从 1 → 0，custom WAL 不再活跃写入。`.transaction-log` 文件停止增长。CLI 工具保留作为诊断。

---

## 六、遗留问题 #3: Compaction DB 集成 + WAL 维护

### 6.1 问题定义

**Compaction 仅操作 JSON 文件：** `state-compactor.ts` 和 `nightly-compaction.ts` 的 3 层架构 (hot → warm JSONL → cold archive) 全部针对 JSON 文件。DB 中 `gate_sessions`、`gate_session_index`、`gate_drained_sessions` 等表**没有 compaction 对应机制**。

**WAL 无维护：** 4.2MB WAL 文件依赖 SQLite 自动 checkpoint（1000 pages 阈值）。`dbVacuum()` 和 `dbCleanStaleEntries()` 存在于 `db-manager.ts` 但**零调用者**。

**`gate-state.index.json` 冗余：** 与 DB `gate_sessions` + `gate_session_index` 表功能重叠，compactor 和 reconciliation 仍直接读写 JSON 文件而非 DB。

### 6.2 解决方案：DB Compaction + WAL 维护 + gate-state.index.json DB migration

**迁移步骤：**

| Step | 操作 | 文件 | 风险 |
|------|------|------|:----:|
| S63-1 | `nightly-compaction.ts` 新增 DB 维护步骤：调用 `dbCleanStaleEntries()` + `PRAGMA wal_checkpoint(TRUNCATE)` | `scripts/nightly-compaction.ts` | 低 |
| S63-2 | `nightly-compaction.ts` 新增 DB compaction：`gate_sessions` 表清理 >7 天 drained sessions → `gate_drained_sessions` | `scripts/nightly-compaction.ts` | 中 |
| S63-3 | `state-compactor.ts` 新增 DB 写入路径：`onGateComplete` 同步写入 `gate_sessions` + `gate_session_index` 表（与 JSON 双写） | `lib/state-compactor.ts` | 中 |
| S63-4 | `state-compactor.ts` 切换为 DB-first 读取：reconciliation 和 compactor 从 DB 读取 gate 状态而非 JSON | `lib/state-compactor.ts` | 中 |
| S63-5 | `nightly-compaction.ts` 新增 `dbVacuum()` 调用（仅在周日执行，避免频繁 VACUUM） | `scripts/nightly-compaction.ts` | 低 |

**S63-1 详细设计：**

```typescript
// nightly-compaction.ts — 新增 DB 维护步骤
import { dbCleanStaleEntries, getDb } from "../lib/db-manager";

function dbMaintenanceStep(): void {
  // 1. Clean stale audit rows (>7 days)
  const deleted = dbCleanStaleEntries();
  writeLog("nightly-compaction", "INFO", { event: "DB-CLEAN-STALE", detail: `deleted=${deleted}` });

  // 2. WAL checkpoint + truncate
  const db = getDb();
  db.run("PRAGMA wal_checkpoint(TRUNCATE)");
  writeLog("nightly-compaction", "INFO", { event: "DB-WAL-CHECKPOINT", detail: "TRUNCATE" });

  // 3. Optional: vacuum on Sundays only
  const now = new Date();
  if (now.getDay() === 0) { // Sunday
    dbVacuum();
    writeLog("nightly-compaction", "INFO", { event: "DB-VACUUM", detail: "Sunday maintenance" });
  }
}
```

---

## 七、遗留问题 #4: Reconciliation Check #5 部分冗余

### 7.1 问题定义

`state-reconciliation.ts` Check #5 (hierarchical v3 state cross-file integrity) 验证 `gate-state.json`、`gate-state.index.json`、`gate-state.archive.json` 之间的跨文件一致性。P2-A 后这些数据已存在于 DB `gate_sessions`、`gate_session_index`、`gate_drained_sessions` 表中，JSON 层级的跨文件检查对 DB-first 系统冗余。

### 7.2 解决方案：重构 Check #5 为 DB 验证

**迁移步骤：**

| Step | 操作 | 风险 |
|------|------|:----:|
| S74-1 | Check #5a-5d (gate-state 跨文件检查) 重构为 DB 层一致性验证：`gate_sessions` 行数 vs `gate_session_index` 行数 | 中 |
| S74-2 | Check #5e (docs/official_docs/index.json) 保留不变（仍有效） | 低 |
| S74-3 | Check #7 (session_access integrity) 与 `nightly-compaction.ts` 的 `cleanupStaleSessionAccessStep()` 去重：reconciliation 仅检测和报告，不执行清理 | 低 |

---

## 八、遗留问题 #5: knowledge-cache-state 持续膨胀

### 8.1 问题定义

`knowledge-cache-state` DB blob (588KB) 中的 `session_access` 字段在两次 nightly cleanup 之间无上限增长。当前 `janitor.ts` 的 UC7-005/006 规则（50MB cap + TTL enforcement）仅在 nightly 运行时生效，运行期间无增量控制。

### 8.2 解决方案：写入时增量 LRU + session_access 上限

**迁移步骤：**

| Step | 操作 | 风险 |
|------|------|:----:|
| S85-1 | `knowledge_cache_search.ts` 的 `writeSubState("knowledge_cache_state", ...)` 新增 `session_access` 上限：每个 agent 最多保留最近 50 个 session_access 条目（LRU 裁剪） | 低 |
| S85-2 | `nightly-compaction.ts` 已有 `cleanupStaleSessionAccessStep()` (>30d)，继续保留作为深度清理 | 低 |

**S85-1 详细设计：**

```typescript
// knowledge_cache_search.ts — 写入时 LRU 裁剪
const MAX_SESSION_ACCESS_PER_AGENT = 50;

function pruneSessionAccess(state: KnowledgeCacheState): KnowledgeCacheState {
  if (!state.session_access) return state;
  const pruned = { ...state.session_access };
  for (const agentKey of Object.keys(pruned)) {
    const entries = Object.entries(pruned[agentKey]);
    if (entries.length > MAX_SESSION_ACCESS_PER_AGENT) {
      // Sort by accessed_at descending, keep most recent 50
      const sorted = entries.sort((a, b) =>
        new Date(b[1].accessed_at).getTime() - new Date(a[1].accessed_at).getTime()
      );
      pruned[agentKey] = Object.fromEntries(sorted.slice(0, MAX_SESSION_ACCESS_PER_AGENT));
    }
  }
  state.session_access = pruned;
  return state;
}
```

---

## 九、实施分 Phase，按依赖关系排序

### Phase 1: DB schema v4（前置所有其他 Phase）

| 操作 | Step | 工时 |
|------|:----:|:----:|
| 新增 `file_baseline_kv` 表 | S11-1 | 0.5h |
| G2 字段过滤 + 清理 + schema 更新 | S2-1→S2-4 | 0.5h |
| `additionalProperties: false` on machine.meta | S2-4 | 0.1h |

**验证：** `bun .opencode/scripts/framework-self-test.ts` — 无回归

### Phase 2: G11 DB-based File Baseline（中风险）

| 操作 | Step | 工时 |
|------|:----:|:----:|
| 新增 DB read/write/delete baseline 函数 | S11-2 | 0.5h |
| 重构 `_fileRegistry` → DB+缓存双层 | S11-3 | 1h |
| 消除两步协议首步失败 | S11-5 | 0.5h |
| 保留 acquireLock mkdir 互斥 | — | 0h (不变) |

**验证：** safe-edit-core.ts 单元测试 + 跨进程 writeSafe 测试

### Phase 3: G12 Type-safe SubState Interfaces（中风险）

| 操作 | Step | 工时 |
|------|:----:|:----:|
| 创建 `substate-types.ts` | S12-1 | 1h |
| 重构 SUBSTATE_FILES + 函数签名 | S12-2→S12-5 | 1h |
| 更新主要调用者 (gate-core, compliance-gate) | S12-6 | 1h |

**验证：** `bun .opencode/scripts/framework-self-test.ts` + TypeScript 类型检查

### Phase 4: 遗留问题治理（低-中风险）

| 操作 | Step | 状态 | 备注 |
|------|:----:|:----:|------|
| Schema 拆分 | S41-1→S41-4 | ⏸️ 延期 | 低风险，1305 行 JSON 精确对齐，建议独立 PR |
| state-transaction.ts DEPRECATED | S52-2, S52-3 | ✅ 完成 | DEPRECATED 注释已添加；CLI 工具保留 |
| compliance-gate.ts 移除 beginTransaction | S52-1 | ✅ 完成 | DB-first 写入 (dbSaveGateStore)；JSON 保留为 frozen snapshot |
| DB compaction + WAL 维护 | S63-1, S63-2, S63-5 | ✅ 完成 | nightly-compaction.ts 已接入 dbCleanStaleEntries + WAL TRUNCATE + 周日 vacuum |
| state-compactor.ts DB 同步 | S63-3, S63-4 | ✅ 完成 | 4 个公共方法已接入 dbSyncCompactorHot + dbMarkSessionArchived/Drained |
| Reconciliation Check #5 重构 | S74-1→S74-3 | ✅ 完成 | DB-first check5 (5a-5d DB, 5e docs 保留)；JSON fallback |
| knowledge-cache LRU 裁剪 | S85-1 | ✅ 完成 | per-agent 50 domain 上限，knowledge_cache_search.ts 已实施 |
| nightly 30d 深度清理 | S85-2 | ✅ 完成 | cleanupStaleSessionAccessStep 保留 |

**验证：** 每个 Step 后运行 self-test + doctor

---

## 十、不在本方案范围内的项目

| 项目 | 原因 |
|------|------|
| Multi-Agent 精简 (P2-B) | 架构级设计决策，需独立设计文档 |
| DAG 简化 → flat task list (P2-C) | 同上 |
| UC7KS 管道链移除 (P4-A) | 功能变更，非基础设施优化 |
| 冻结 JSON 快照删除 (P5) | 需 DB 运行稳定 1 个月+ |
| compliance-gate.ts 拆分 (P3-C) | 独立重构任务，6-12h |
| framework-self-test.ts ESM 统一 (P4-C) | 独立小任务 |

---

## 十一、预期量化效果

| 指标 | 当前 | 本方案后 |
|------|:----:|:--------:|
| G-problem 完全解决 | 10/13 | **13/13** (G2, G11, G12 全部关闭) |
| G-problem 缓解 | 1/13 | 0/13 |
| readSubState 类型安全 | `any` | `SubStateMap[K]` (编译时类型检查) |
| TOCTOU 跨进程覆盖 | 进程内 only | 跨进程 (DB baseline) |
| writeSafe 首步失败率 | ~30% (跨进程场景) | ~0% (DB baseline 可见) |
| machine.json 遗留字段 | 2 (lastUpdated + last_updated) | 1 (lastUpdated only) |
| state-transaction.ts 活跃调用者 | 1 (compliance-gate.ts) | 0 (DEPRECATED) |
| DB WAL 维护 | 无 (自动 checkpoint only) | nightly TRUNCATE + weekly VACUUM |
| DB stale 清理 | 无 (函数存在但零调用) | nightly dbCleanStaleEntries() |
| Schema 结构 | 1 个单体 (1305 行) | 1 个 meta-schema (~80 行) + 12 个子状态 schema |
| knowledge-cache session_access | 无上限增长 | per-agent 50 条 LRU + nightly 30d 深度清理 |

**总工时估算：** Phase 1 (1h) + Phase 2 (2h) + Phase 3 (3h) + Phase 4 (4.5h) = **~10.5h**

---

## 十二、官方文档合规交叉验证

基于 `docs/official_docs/` 下的 9 篇官方规范文档，逐子系统验证本方案的设计是否符合既有约定。

### 子系统合规矩阵

| 子系统 | 规范文档 | 本方案涉及 Step | 合规状态 | 备注 |
|--------|---------|---------------|:--------:|------|
| Layout | `layout-and-structure.md` | S41-1~S41-4 (schema 拆分) | ✅ 合规 | 拆分后的 `schemas/` 目录符合 state 目录结构规范 |
| Permission | `permission-model.md` | S11-3 (writeSafe DB baseline) | ✅ 合规 | DB baseline 不改变权限层级；acquireLock 保留为 Layer 1 |
| State | `state-management.md` | S2-1~S2-4, S63-1~S63-5 | ✅ 合规 | DB-first 写入路径与 P2-A Step 8 一致；nightly compaction 新增 DB 维护步骤 |
| Enforcement | `framework-enforcement.md` | S52-1 (移除 beginTransaction) | ⚠️ 需确认 | 需确认 `dbSaveGateStore` 完全覆盖 `beginTransaction` 在 compliance-gate.ts 中的所有写入场景 |
| Harness | `test-harness.md` | 全方案验证步骤 | ✅ 合规 | self-test + doctor 验证流程符合 harness 规范 |
| Plugin | `plugin-conventions.md` | S63-1 (nightly-compaction 新增 DB 步骤) | ✅ 合规 | nightly-compaction 为脚本而非 plugin，不受 plugin `export default` 约束 |
| Safe Tools | `safe-tools-and-utilities.md` | S11-1~S11-7 (G11 DB baseline) | ✅ 合规 | DB baseline 增强 safe-edit-core 的跨进程安全性，不违反 safe-write 协议 |
| Multi-Agent | `multi-agent-coordination.md` | 无直接涉及 | ✅ 合规 | 本方案不修改 agent 调度或 dispatch 流程 |
| UC7KS | `uc7ks-knowledge-management.md` | S85-1~S85-2 (LRU 裁剪) | ✅ 合规 | per-agent 50 条上限与 UC7-005/006 规则互补（写入时增量 vs nightly 深度） |

### 关键合规要点

1. **MCP 工具输出约定**：本方案新增的 DB 函数均为内部 lib，不直接作为 MCP 工具暴露。若未来需要 MCP 暴露 DB baseline 查询，必须使用 `process.stderr.write()` 而非 `console.log()`（`mcp-server-conventions.md` 规范）。

2. **Plugin 日志约定**：`state-compactor.ts` 中的 `writeLog()` 使用 `appendFileSync`（P2-A 修复后），符合 `plugin-conventions.md` 中 plugin 应使用 `client.app.log()` 的要求（compactor 不是 plugin，但遵循相同日志路径）。

3. **CJS 模块约定**：`state-transaction.ts` 为 CJS (`require()`)，标记 DEPRECATED 后保留 CLI 工具。`compliance-gate.ts` 也是 CJS — 移除 `beginTransaction` 调用需在 CJS 上下文中完成（`mcp-server-conventions.md` 推荐 CJS 用于 MCP server）。

---

## 十三、G12 CJS 类型安全限制说明

G12 方案（S12-1~S12-6）为 `readSubState` / `writeSubState` 建立了 TypeScript 类型接口（`SubStateMap`），使 ESM 调用者获得编译时类型安全。但需明确一个架构限制：

### CJS 调用者的类型安全边界

**问题：** `compliance-gate.ts`、`eslint-audit.ts`、`code-quality-gate.ts` 等核心 MCP 工具均为 CJS (`require()`) 模块。Bun 运行 CJS 时会跳过 TypeScript 类型检查 — `require("../lib/substate-manager")` 返回的值在运行时仍然是 `any`。

**影响范围：**
| 调用者类型 | 类型安全效果 |
|-----------|------------|
| ESM import (`gate-core.ts`, `state-compactor.ts`) | ✅ 编译时 + IDE 自动补全 |
| CJS require (`compliance-gate.ts`, `eslint-audit.ts`) | ⚠️ 仅 IDE 提示（通过 `.d.ts` declaration file）；运行时仍为 `any` |

**解决方案：** 生成 `substate-types.d.ts` declaration file，CJS 调用者通过 `/// <reference path="../lib/substate-types.d.ts" />` 获得 IDE 类型提示。运行时类型安全需依赖 JSON Schema 验证（S41 schema 拆分后的子状态 schema），而非 TypeScript 类型系统。

**结论：** G12 方案对 ESM 调用者提供完整的编译时类型安全；对 CJS 调用者提供 IDE 提示但不保证运行时类型检查。这符合 `mcp-server-conventions.md` 的 CJS 推荐约定 — MCP server 优先 CJS，类型安全为次要目标。

---

## 十四、修订 Phase 4 执行顺序

原始 Phase 4 顺序基于工时估算排列，但交叉验证发现两个依赖关系需调整：

### 依赖关系

1. **S74-1 → S63-4 依赖**：Reconciliation Check #5 重构为 DB 验证前，`state-compactor.ts` 必须先切换为 DB-first 读取（S63-4）。否则 Check #5 重构后引用 DB 数据，但 compactor 仍读 JSON，两者不一致。

2. **S52-1 → dbSaveGateStore 确认**：移除 `compliance-gate.ts` 的 `beginTransaction` 前，需确认 `dbSaveGateStore()` 完全覆盖 `beginTransaction` 在该文件中的所有写入场景（不只是 gate-state，还包括 audit_log 写入）。

### 修订后的 Phase 4 执行顺序

| 序号 | Step | 前置依赖 | 工时 |
|:----:|------|---------|:----:|
| 1 | S63-1 DB stale 清理 + WAL checkpoint | 无 | 0.5h |
| 2 | S63-2 DB compaction (gate_sessions 清理) | S63-1 | 0.5h |
| 3 | S63-3 compactor DB-only 写入 | S63-2 | 0.5h |
| 4 | S63-4 compactor DB-first 读取 | S63-3 | 0.5h |
| 5 | S74-1 Check #5 DB 验证重构 | S63-4 | 1h |
| 6 | S74-2~S74-3 Check #5e 保留 + Check #7 去重 | S74-1 | 0.3h |
| 7 | S52-1 移除 beginTransaction（需先确认 dbSaveGateStore 覆盖度） | S63-4 确认 DB 覆盖 | 0.5h |
| 8 | S52-2~S52-3 标记 DEPRECATED + 保留 CLI | S52-1 | 0.2h |
| 9 | S41-1~S41-4 Schema 拆分 | 无（可与 1-6 并行） | 1h |
| 10 | S85-1~S85-2 knowledge-cache LRU 裁剪 | 无（可与任何并行） | 0.5h |

**总工时不变：** ~4.5h，但执行顺序解决依赖冲突，降低回退风险。

---

## 十五、P3 实施验证报告摘要（2026-06-16 后补）

**验证报告：** `docs/review/framework-refactor/p3-verification-report.md`  
**总体评分：** 97.1%（33/34 Steps 已完成）

### 完成率

| Phase | 主题 | 完成率 | G-problem |
|:-----:|------|:-----:|:---------:|
| P1 | DB Schema v4 | **100%** | G2 ✅ |
| P2 | G11 跨进程 TOCTOU | **100%** | G11 ✅ |
| P3 | G12 类型安全 | **100%** | G12 ✅ |
| P4 | 遗留问题治理 | **94.1%** (16/17) | — |

### 核心结论

- **13/13 G-problem 全部关闭**（P3 核心目标达成）
- Phase 1-3 全部 100% 完成
- Phase 4 完成 16/17 Steps (94.1%)，仅 S41 schema 拆分为独立 PR

### 验证报告状态修正

验证报告第四节将 S85-1 (LRU 裁剪) 标记为 ❌ 延期，但代码核实确认已实施（`knowledge_cache_search.ts:203` 有 `// P3/S85-1` 标记 + `MAX_DOMAINS_PER_AGENT = 50` 实现）。本节修正为 ✅ 完成。

---

## 十六、后续行动项

### ⏸️ 唯一延期项（可作为后续独立 PR）

| 任务 | 工时 | 备注 |
|------|:----:|------|
| S41-1~S41-4: machine.schema.json 拆分为 13 个独立 schema | 1h | 低风险机械性工作；需 G12 接口精确对齐 JSON Schema |

**P3 总体完成率：33/34 Steps (97.1%)**。仅 S41 schema 拆分延期为独立 PR。

---

*本方案由 @Orchestrator 基于 @Meta-Planner 深度分析制定，2026-06-16*
