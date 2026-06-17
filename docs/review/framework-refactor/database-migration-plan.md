# P2-A: 数据库引入 — 技术选型与迁移实施方案

**日期：** 2026-06-17（六次更新；初始 2026-06-16）
**状态：** **Step 0-8 全部已完成（2026-06-17，含 drain DB 化 + writeLog 修复）** + P3 schema v4（2026-06-16）+ gate-stuck-fix Phase 1-5 schema v5/v6（2026-06-17）
**Self-test 基线：** framework-self-test.ts 39/40 PASS（唯一失败 Check 33 为预先存在的 stale dispatch entries）
**DB Schema：** **v7** — initial (v1) + substate_kv (v2) + eslint_state.last_full_scan (v3) + file_baseline_kv + G2 cleanup (v4) + gate_sessions deliverables columns (v5) + session_log + dispatch_failed_log + session_map (v6) + drop 13 unused typed tables (v7)
**DB 表数：** **16 张**（12 active typed + 4 auxiliary + sqlite_sequence，v7 清理 13 张未使用的 typed 表）
**前置条件：** P1-A（CAS 统一）✅、P1-B（machine.json 拆分）✅ 已完成

**Schema 演进时间线：**

| 版本 | 日期 | 内容 | 实施来源 |
|:----:|:----:|------|----------|
| v1 | — | Initial: 19 typed 表 + 4 auxiliary + sqlite_sequence（共 24 张） | P2-A Step 0-2 |
| v2 | — | 新增 `substate_kv` 表（12 子状态 JSON blob） | P2-A Step 1 |
| v3 | — | `eslint_state.last_full_scan` 列 | P2-A Step 2 |
| **v4** | 2026-06-16 | 新增 `file_baseline_kv` 表（G11 关闭）+ `machine_meta.last_updated` 统一清理（G2 DB 侧）+ `substate-types.ts` `SubStateMap` 强类型（G12 关闭） | P3-deep |
| **v5** | 2026-06-17 | `gate_sessions` 表扩展 6 列 deliverables 硬约束（`declared_deliverables`、`submitted_deliverables`、`deliverables_approved_by/_at/_note`、`approval_required`） | gate-stuck-fix Phase 1-5 |
| **v6** | 2026-06-17 | 新增 `session_log`、`dispatch_failed_log`、`session_map` 三张表（替代 `SESSION_ID.md` / `.pending.json.failed` / `.session_map.json`） | gate-stuck-fix §14 v4 方案 |
| **v7** | 2026-06-17 | DROP 13 张未使用的 typed 子状态表（`eslint_state`、`write_audit_state`、`compliance_records` 等），`substate_kv` 为子状态唯一存储层 | P2-A §11.6 清理 |

---

## 一、技术调查背景

P1-B 将 1.1MB 的 `machine.json` 拆分为 12 个独立子状态文件（最大 582KB），消除了并发写入冲突。但评估报告指出"中期仍需评估引入数据库以进一步改善性能和可靠性"。本文档完成技术选型调查和迁移方案设计。

### 当前状态架构的问题矩阵

| 编号 | 问题 | 严重程度 | 当前缓解 | 数据库解决方案 |
|------|------|---------|---------|-------------|
| G1 | `gate-state.json` 写入非原子（saveGateStore 使用 writeFileSync，无 tmp+rename） | **P0** | ✅ Step 3: DB 事务原子写 + JSON 双写 | SQLite WAL 事务保证原子性 |
| G2 | `machine.json` 双 `lastUpdated/last_updated` 字段 | P3 | ✅ **P3 schema v4**: DB 侧 `last_updated` 写入已清理；JSON 兼容字段暂保留（低影响 307B） | Schema 表强制统一 |
| G3 | `atomicWriteMachine` CAS 弱验证（post-read 期间可能被二次写入） | P1 | ✅ Step 5: atomicWriteSubState 使用 DB 事务替代 CAS | SQLite 行级锁 |
| G4 | 退避使用忙等自旋（空耗 CPU） | P2 | ✅ Step 5: DB 事务 + busy_timeout=5000 | SQLite 内核调度 |
| G5 | `code-quality-gate.ts` 自定义 writeMachine 混合模式 | P1 | ✅ Step 7: writeMachine 已使用 writeMachineMeta+writeSubState 双写代理 | 统一 DB API |
| G6 | `writeAuditLogEntry` 使用 appendFileSync（无缓冲） | P2 | ✅ Step 4: DB INSERT + JSONL 双写 | DB INSERT 原子 |
| G7 | `flushAuditTrail` 非原子写入 | P2 | ✅ Step 4: DB upsert + JSON 双写 | DB 事务 |
| G8 | `safe-bash-core.ts` 绕过 writeLog 写独立文件 | P2 | ✅ **Step 8 已修复**：`logAction` → `writeLog()` 统一 | 统一到 DB 或 writeLog |
| G9 | gate-core ↔ log-manager 循环依赖导致 gate-core 使用 appendFileSync | P2 | ✅ Step 3: DB 作为中间层解耦 | DB 作为中间层解耦 |
| G10 | uc7ks-schema.ts re-export atomicWriteMachine 鼓励旧模式 | P3 | ✅ **Step 8 已删除**：dead code 全部清理 | 统一 DB API |
| G11 | safe-edit-core.ts FileStateRegistry 进程内限 | P1 | ✅ **P3 schema v4 已关闭**：新增 `file_baseline_kv` 表提供跨进程基线注册，替代 mkdir 互斥 | DB 事务跨进程 |
| G12 | readSubState/writeSubState 缺乏类型安全（any） | P2 | ✅ **P3 已关闭**：`substate-types.ts` 导出 `SubStateKey`/`SubStateMap` 泛型，`db-state-manager.ts` 强类型化 | Schema 表类型约束 |
| G13 | compliance-gate.ts inline fallback 函数与原子模式不一致 | P1 | ✅ Step 6: 所有读取已通过 readSubState 双写代理 (DB-first) | DB 连接统一 |

**G-problem 最终统计：** 12/13 完全解决（G1, G3-G13），1/13 缓解（G2 JSON 兼容字段保留，低影响 307B）。

---

## 二、技术选型分析

### 2.1 候选技术

| 技术 | 类型 | Bun 集成 | 运行时依赖 | ACID | WAL 支持 | 领域适配性 |
|------|------|---------|---------|------|---------|---------|
| **bun:sqlite** | 嵌入式关系型 | ✅ 内置（零依赖） | 无 | ✅ 完整 | ✅ | 文档/结构化状态 |
| LMDB | 嵌入式 KV | ❌ npm 包（node-lmdb） | C 绑定 | ❌ | ❌ mmap | 纯 KV 缓存 |
| better-sqlite3 | 嵌入式关系型 | ❌ npm 包 | C 绑定 | ✅ | ✅ | 文档/结构化状态 |
| LevelDB | 嵌入式 KV | ❌ npm 包 | C 绑定 | ❌ | ️ | 纯 KV 缓存 |
| PostgreSQL | 服务端关系型 | ❌ 需连接 | 服务进程 | ✅ | ✅ | 大规模/分布式 |
| Redis | 内存 KV+持久 | ❌ 需连接 | 服务进程 | ❌ | AOF/RDB | 纯缓存/临时 |

### 2.2 OpenCode 上游验证

OpenCode 自身使用 SQLite 存储核心数据（会话、消息、事件、权限等）：

```bash
# 实际数据库
~/.local/share/opencode/opencode.db  (7.4GB, WAL 模式)
# 表结构
session: id(TEXT), project_id(TEXT), title(TEXT), cost(REAL), tokens_input/output/reasoning(INTEGER), ...
message: id(TEXT), session_id(TEXT), data(TEXT)
event:   id(TEXT), aggregate_id(TEXT), seq(INTEGER), type(TEXT), data(TEXT)
permission: id(TEXT), project_id(TEXT), action(TEXT), resource(TEXT)
credential: id(TEXT), integration_id(TEXT), value(TEXT)
```

**关键发现：** OpenCode 已在 Bun 运行时中使用 `bun:sqlite`（WAL 模式，page_size=4096）管理 1611 个会话、46828 条消息。这证明 `bun:sqlite` 在生产环境可承载本框架的状态规模。

### 2.3 选型决定：bun:sqlite

**选定理由（6 维度评估）：**

| 维度 | bun:sqlite | LMDB | better-sqlite3 | PostgreSQL |
|------|-----------|------|---------------|-----------|
| **Bun 集成度** | ⭐⭐⭐ 内置零依赖 | ⭐ npm 包+C 绑定 | ⭐ npm 包+C 绑定 | ⭐ 网络依赖 |
| **OpenCode 一致性** | ⭐⭐⭐ 上游同技术栈 | ⭐ 异构 | ⭐ 异构 | ⭐ 异构 |
| **ACID/事务** | ⭐⭐⭐ 完整 | ⭐ 无 | ⭐⭐⭐ 完整 | ⭐⭐⭐ 完整 |
| **WAL 并发** | ⭐⭐⭐ 支持 | ⭐ mmap 只读并发 | ⭐⭐⭐ 支持 | ⭐⭐⭐ 支持 |
| **运维复杂度** | ⭐⭐⭐ 零部署 | ⭐⭐ 额依赖 | ⭐⭐ 额依赖 | ⭐ 高 |
| **性能** | ⭐⭐⭐ 同步 API+JSC | ⭐⭐ mmap 读快 | ⭐⭐⭐ V8+N-API | ⭐ 网络 RTT |

**综合评分：** bun:sqlite **18/18**，LMDB 8/18，better-sqlite3 12/18，PostgreSQL 10/18。

**排除理由：**
- **LMDB/LevelDB**：无 ACID、无 WAL、需要 C 绑定编译、不支持结构化查询（框架需要按 agent/session/task 查询状态，纯 KV 需要应用层维护索引）
- **better-sqlite3**：与 bun:sqlite 功能等价但额外依赖、使用 V8 N-API（与 Bun 的 JSC 引擎有兼容风险）、OpenCode 上游不使用
- **PostgreSQL**：违反"嵌入式零部署"原则、需要网络连接增加故障域、违反 Layout Architecture 的"代码与运行时状态共存"设计

### 2.4 bun:sqlite 特性验证

| 特性 | 验证结果 | 框架影响 |
|------|---------|---------|
| WAL 模式并发 | ✅ OpenCode 7.4GB DB 运行于 WAL | 消除 G1 非原子写入 |
| 事务原子性 | ✅ `db.transaction()` 保证 all-or-nothing | 消除 G7 非原子写入 |
| 同步 API | ✅ 无异步回调，与框架同步模式一致 | 保持框架调用风格 |
| Prepared Statements | ✅ `db.prepare()` 编译一次执行多次 | 热点查询性能提升 |
| 批量写入 | ✅ 事务内批量操作比逐条快数百倍 | 写审计批量更新 |
| 行级锁 | ✅ WAL 下读不阻塞写 | 消除 G3 CAS 弱验证 |
| 跨进程可见 | ✅ WAL 模式其他进程可并发读 | 消除 G11 进程内限制 |
| 无外部依赖 | ✅ Bun 内置 | 满足零部署要求 |

---

## 三、数据库 Schema 设计

### 3.1 设计原则

1. **向后兼容**：Schema 忠实映射现有 12 个子状态 JSON 结构，不改变数据语义
2. **最小侵入**：仅替换 JSON 文件存储层，不改变业务逻辑
3. **类型安全**：SQLite 列类型替代 `any` 类型
4. **审计可追溯**：保留 `meta.revision` 和 `meta.lastUpdated` 字段

### 3.2 表设计

#### 核心元数据表

```sql
CREATE TABLE IF NOT EXISTS machine_meta (
  key     TEXT PRIMARY KEY,  -- 'version', 'createdAt', 'project', 'framework'
  value   TEXT NOT NULL,
  updated_at INTEGER NOT NULL  -- Unix timestamp ms
);

CREATE TABLE IF NOT EXISTS machine_contracts (
  contract_path TEXT PRIMARY KEY,  -- 'contract.yaml', etc.
  updated_at    INTEGER NOT NULL
);
```

#### 子状态表（逐个映射）

```sql
-- 1. eslint_state (58KB, 高频写入)
CREATE TABLE IF NOT EXISTS eslint_state (
  audit_id     TEXT PRIMARY KEY,  -- unique audit identifier
  agent        TEXT NOT NULL,
  session_id   TEXT,
  rule_id      TEXT,
  severity     TEXT,  -- 'error'|'warning'|'info'
  file_path    TEXT,
  line         INTEGER,
  message      TEXT,
  category     TEXT,  -- CAT1.0, CAT1.1, etc.
  status       TEXT DEFAULT 'active',  -- 'active'|'resolved'|'waived'
  last_full_scan TEXT,  -- ISO timestamp of last full scan (top-level field from JSON)
  timestamp    INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eslint_agent ON eslint_state(agent);
CREATE INDEX IF NOT EXISTS idx_eslint_session ON eslint_state(session_id);
CREATE INDEX IF NOT EXISTS idx_eslint_status ON eslint_state(status);

-- 2. write_audit_state (151KB, 高频写入)
CREATE TABLE IF NOT EXISTS write_audit_state (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent        TEXT NOT NULL,
  session_id   TEXT,
  task_id      TEXT,
  tool         TEXT,  -- 'write'|'edit'|'safe_edit'|'bash'
  file_path    TEXT NOT NULL,
  operation    TEXT,  -- 'create'|'modify'|'delete'
  checks_run   INTEGER DEFAULT 0,
  violations   INTEGER DEFAULT 0,
  scope_result TEXT,  -- 'allowed'|'blocked'|'warning'
  timestamp    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_write_audit_agent ON write_audit_state(agent);
CREATE INDEX IF NOT EXISTS idx_write_audit_session ON write_audit_state(session_id);
CREATE INDEX IF NOT EXISTS idx_write_audit_file ON write_audit_state(file_path);

-- 3. compliance_records (193KB, 中频写入)
CREATE TABLE IF NOT EXISTS compliance_records (
  session_id   TEXT PRIMARY KEY,
  task_desc    TEXT NOT NULL,
  agent        TEXT,
  task_id      TEXT,
  status       TEXT NOT NULL,  -- 'checked'|'armed'|'completed'|'drained'|'failed'
  plan_summary TEXT,
  execution_summary TEXT,
  rule_status  TEXT,  -- JSON string of rule check results
  mode         TEXT,  -- 'advisory'|'strict'|'locked'
  checked_at   INTEGER,
  armed_at     INTEGER,
  completed_at INTEGER,
  drained_at   INTEGER,
  failed_items TEXT  -- JSON array
);
CREATE INDEX IF NOT EXISTS idx_compliance_status ON compliance_records(status);
CREATE INDEX IF NOT EXISTS idx_compliance_agent ON compliance_records(agent);

-- 4. knowledge_cache_state (582KB, 高频读写，最复杂嵌套结构)
CREATE TABLE IF NOT EXISTS knowledge_session_access (
  agent_key    TEXT NOT NULL,  -- normalized PascalCase key
  task_id      TEXT NOT NULL,
  domain_id    TEXT NOT NULL,
  sufficient   INTEGER DEFAULT 0,  -- 0=false, 1=true
  pipeline     TEXT,  -- JSON: pipeline agent + stage info
  accessed_at  INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (agent_key, task_id, domain_id)
);
CREATE INDEX IF NOT EXISTS idx_kcache_agent ON knowledge_session_access(agent_key);
CREATE INDEX IF NOT EXISTS idx_kcache_task ON knowledge_session_access(task_id);
CREATE INDEX IF NOT EXISTS idx_kcache_sufficient ON knowledge_session_access(sufficient);

-- knowledge cache sufficiency summary (flat fallback)
CREATE TABLE IF NOT EXISTS knowledge_cache_meta (
  agent_key    TEXT PRIMARY KEY,
  total_tasks  INTEGER DEFAULT 0,
  sufficient_count INTEGER DEFAULT 0,
  last_pipeline_complete TEXT,  -- agent name
  updated_at   INTEGER NOT NULL
);

-- 5. tdd_enforcement_state (228B)
CREATE TABLE IF NOT EXISTS tdd_enforcement_state (
  session_id   TEXT PRIMARY KEY,
  agent        TEXT NOT NULL,
  task_id      TEXT,
  current_phase TEXT NOT NULL,  -- 'RED'|'GREEN'|'REFACTOR'
  phase_files  TEXT,  -- JSON array of test files
  last_verified INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- 6. keystone_hashes (2.8KB)
CREATE TABLE IF NOT EXISTS keystone_hashes (
  contract_path TEXT PRIMARY KEY,
  hash_value    TEXT NOT NULL,  -- SHA-256 hex
  updated_at    INTEGER NOT NULL
);

-- 7. transaction_state (208B)
CREATE TABLE IF NOT EXISTS transaction_state (
  key          TEXT PRIMARY KEY,  -- 'auto_plan_history', etc.
  value        TEXT NOT NULL,  -- JSON string
  updated_at   INTEGER NOT NULL
);

-- 8. knowledge_state (639B)
CREATE TABLE IF NOT EXISTS knowledge_state (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,  -- JSON string
  updated_at   INTEGER NOT NULL
);

-- 9. knowledge_audit_state (661B, 只读)
CREATE TABLE IF NOT EXISTS knowledge_audit_state (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,  -- JSON string
  updated_at   INTEGER NOT NULL
);

-- 10-12. 简单状态表 (type_check, format, dependency — 结构类似)
CREATE TABLE IF NOT EXISTS type_check_state (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent        TEXT NOT NULL,
  session_id   TEXT,
  file_path    TEXT,
  check_type   TEXT,  -- 'type_error'|'type_warning'
  message      TEXT,
  status       TEXT DEFAULT 'active',
  timestamp    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_typecheck_agent ON type_check_state(agent);

CREATE TABLE IF NOT EXISTS format_state (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent        TEXT NOT NULL,
  session_id   TEXT,
  file_path    TEXT,
  rule_id      TEXT,
  message      TEXT,
  status       TEXT DEFAULT 'active',
  timestamp    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_format_agent ON format_state(agent);

CREATE TABLE IF NOT EXISTS dependency_state (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent        TEXT NOT NULL,
  session_id   TEXT,
  package_name TEXT,
  version      TEXT,
  check_type   TEXT,  -- 'outdated'|'vulnerable'|'missing'
  message      TEXT,
  status       TEXT DEFAULT 'active',
  timestamp    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dep_agent ON dependency_state(agent);
```

#### gate-state 独立表（解决 G1 非原子写入）

```sql
-- gate-state.json（当前 810B，最频繁写入）
CREATE TABLE IF NOT EXISTS gate_sessions (
  session_id   TEXT PRIMARY KEY,
  task_desc    TEXT NOT NULL,
  status       TEXT NOT NULL,  -- 'checked'|'armed'|'completed'|'drained'|'failed'
  agent        TEXT,
  task_id      TEXT,
  plan_summary TEXT,
  execution_summary TEXT,
  mode         TEXT,
  checked_at   INTEGER,
  armed_at     INTEGER,
  completed_at INTEGER,
  drained_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_gate_status ON gate_sessions(status);

-- gate-state.drained_sessions (归档)
CREATE TABLE IF NOT EXISTS gate_drained_sessions (
  session_id   TEXT PRIMARY KEY,
  original_task_desc TEXT,
  drain_reason TEXT,
  drained_at   INTEGER NOT NULL
);

-- gate-state.index (会话索引)
CREATE TABLE IF NOT EXISTS gate_session_index (
  session_id   TEXT PRIMARY KEY,
  status       TEXT NOT NULL,
  last_updated INTEGER NOT NULL
);
```

#### gate-state 辅助表（解决 G1，拆分存储）

```sql
-- gate-state 格式版本/元数据/活跃会话列表
CREATE TABLE IF NOT EXISTS gate_store_meta (
  key        TEXT PRIMARY KEY,  -- 'formatVersion', 'last_updated', 'active_sessions'
  value      TEXT NOT NULL,     -- JSON string (active_sessions is JSON array)
  updated_at INTEGER NOT NULL
);

-- gate 操作历史追踪（append-only）
CREATE TABLE IF NOT EXISTS gate_audit_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        TEXT NOT NULL,
  task_description  TEXT,
  plan_summary      TEXT,
  agent             TEXT,
  task_id           TEXT,
  confirmed_at      INTEGER,
  consumed_at       INTEGER,
  execution_summary TEXT,
  gate_status       TEXT
);
CREATE INDEX IF NOT EXISTS idx_gate_audit_session ON gate_audit_history(session_id);
```

#### 子状态通用 KV 表（双写过渡保障）

```sql
-- substate_kv: JSON blob 存储表，保证双写过渡期间 100% API 兼容性
-- 每个 sub-state key 存储完整 JSON 结构，避免早期迁移时字段丢失
-- 后续 Step 5-7 逐步将高频子状态迁移到 typed 表后，此表降级为低频后备
CREATE TABLE IF NOT EXISTS substate_kv (
  key        TEXT PRIMARY KEY,  -- SUBSTATE_FILES 的 key (eslint_state, etc.)
  json       TEXT NOT NULL,     -- 完整 JSON blob
  updated_at INTEGER NOT NULL
);
```

#### Schema 版本追踪表

```sql
-- schema_version: DB schema 迁移版本追踪，为后续 schema evolution 提供基础设施
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  comment    TEXT
);
-- 当前版本:
-- v1 = P2-A initial schema (20 typed tables + 4 auxiliary)
-- v2 = P2-A Step 1: add substate_kv for dual-write transition
-- v3 = P2-A Step 0 (INC-3 fix): ALTER TABLE eslint_state ADD last_full_scan TEXT
```

#### 审计日志表（解决 G6/G7）

```sql
-- audit_log.jsonl 替换
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT,
  agent        TEXT,
  event_type   TEXT NOT NULL,
  detail       TEXT,  -- JSON string
  timestamp    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_type);

-- audit_trail 替换（解决 G7 非原子写入）
CREATE TABLE IF NOT EXISTS audit_trail (
  session_id   TEXT PRIMARY KEY,
  trail_data   TEXT NOT NULL,  -- JSON string
  updated_at   INTEGER NOT NULL
);
```

### 3.3 Schema 设计注意事项

1. **嵌套结构处理**：`knowledge_cache_state.session_access` 的三层嵌套（agent→task→domain）映射为 `knowledge_session_access` 表的三列主键，保留扁平元数据表 `knowledge_cache_meta` 作为快速查询路径。双写过渡期间，`substate_kv` 表存储完整 JSON blob，保证 API 兼容性；`knowledge_session_access` typed 表在 Step 6 增量迁移时逐步填充
2. **JSON 字段**：仅对高频查询字段提取为独立列；低频/可变结构保留为 JSON TEXT（如 `rule_status`, `failed_items`, `pipeline`）
3. **时间戳统一**：所有 `timestamp/updated_at` 使用 INTEGER（Unix ms），与现有 `meta.lastUpdated` ISO 格式兼容（提供转换函数）
4. **主键策略**：有自然唯一标识的用 TEXT 主键（session_id, agent_key+task_id+domain_id）；纯追加记录用 AUTOINCREMENT
5. **顶层字段保留**：`eslint_state.last_full_scan`（全局扫描时间戳）作为独立列 `last_full_scan TEXT` 保留在 typed 表中，不丢失原始 JSON 顶层字段
6. **双写兼容设计**：`substate_kv` 表为双写过渡的核心保障——每个 sub-state key 的完整 JSON 结构作为 blob 存储，`dbReadSubState/dbWriteSubState` 直接读写 blob；typed 表（eslint_state, write_audit_state 等）是结构化查询的优化层，两者共存不冲突

---

## 四、迁移实施方案

### 4.1 实施原则

1. **渐进式迁移**：分 8 个 Step，每步可独立验证和回滚
2. **API 层优先**：先建 DB 访问层，再逐个迁移调用者
3. **双写过渡**：迁移期间 JSON 和 DB 同时写入，读取优先 DB
4. **框架不变**：Permission Matrix、Safe Tools、Enforcement、Harness、Multi-Agent 等子系统逻辑不改变，仅替换存储层

### 4.2 Step 详细计划

#### Step 0: 基础设施（DB 初始化 + 连接管理） ✅ 已实施

**目标**：创建 `.opencode/lib/db-manager.ts`，提供统一 DB 连接管理

**产出文件**：`.opencode/lib/db-manager.ts` (659 行, 23139 bytes)

**实际实施**：
- 单例连接 `getDb()` — WAL + NORMAL + foreign_keys + busy_timeout=5000 + temp_store=MEMORY + cache_size=-4000
- `initializeSchema()` 创建 24 张表（含 4 张计划外表: gate_store_meta, gate_audit_history, substate_kv, schema_version）
- `closeDb()` — 进程 exit/SIGINT/SIGTERM handler 自动关闭
- `getDbHealth()` — PRAGMA integrity_check + page_count + journal_mode diagnostics
- `dbVacuum()` / `dbCleanStaleEntries()` / `dbExportTable()` / `dbListTables()` — 维护和导出工具
- DB 文件路径: `.opencode/state/framework-state.db`（`framework-state.db-wal` / `-shm` 已加入 `.gitignore`）
- Schema 版本: v1 (initial) + v2 (substate_kv) + v3 (eslint_state.last_full_scan, INC-3 修复)
- Schema 迁移机制: `pragma_table_info` 检测列存在 → ALTER TABLE 按需添加 → schema_version 记录（幂等）

**核心接口**：

```typescript
import { Database } from "bun:sqlite";

const DB_PATH = path.join(STATE_DIR, "framework-state.db");

// 单例连接，WAL 模式，启动时初始化
let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    _db = new Database(DB_PATH, { create: true });
    _db.run("PRAGMA journal_mode = WAL");
    _db.run("PRAGMA synchronous = NORMAL");  // WAL 下 NORMAL 足够安全
    _db.run("PRAGMA foreign_keys = ON");
    _db.run("PRAGMA busy_timeout = 5000");   // 5s 等待锁
    initializeSchema(_db);
  }
  return _db;
}

export function closeDb(): void {
  if (_db) { _db.close(); _db = null; }
}

// 从 JSON 到 DB 的迁移入口
export function migrateJsonToDb(): MigrationResult { ... }

// Schema 初始化（CREATE TABLE IF NOT EXISTS）
function initializeSchema(db: Database): void { ... }
```

**验证**：`bun -e "import {getDb} from './.opencode/lib/db-manager'; const db = getDb(); console.log(db.query('PRAGMA journal_mode').all());"` → WAL

**日志集成**：所有 DB 操作通过 `writeLog(SRC, ...)` 记录，事件标识符：
- `DB-INITIALIZED`, `DB-CONN-FAILED`, `DB-WAL-ENABLED`
- `DB-QUERY-FAILED`, `DB-TRANSACTION-FAILED`, `DB-MIGRATION-START/COMPLETE/FAILED`

#### Step 1: CRUD API 层（替换 substate-manager.ts） ✅ 已实施

**目标**：创建 `.opencode/lib/db-state-manager.ts`，提供与现有 `readSubState/writeSubState` 等价的 DB API

**产出文件**：`.opencode/lib/db-state-manager.ts` (603 行, 20319 bytes)

**实际实施**：
- `dbReadSubState/dbWriteSubState/dbAtomicWriteSubState` — 基于 `substate_kv` JSON blob 表，100% API 兼容
- `dbReadMachineMeta/dbWriteMachineMeta` — machine_meta + machine_contracts 表读写
- `dbLoadGateStore/dbSaveGateStore` — 从 gate_sessions + gate_store_meta + gate_audit_history 三表重建 GateStore
- `dbWriteAuditLogEntry/dbFlushAuditTrail` — audit_log + audit_trail 表写入
- `migrateJsonToDb()` — 一次性迁移入口，将 12 个 JSON 子状态 + machine.json 写入 DB（idempotent, INSERT OR REPLACE）
- 迁移验证结果: 13 items migrated, ~1MB total

**核心接口**（保持与现有 API 签名兼容）：

```typescript
export function dbReadSubState<K extends keyof SUBSTATE_FILES>(key: K): any;
export function dbWriteSubState<K extends keyof SUBSTATE_FILES>(key: K, value: any): boolean;
export function dbReadMachineMeta(): any;
export function dbWriteMachineMeta(value: any): boolean;
export function dbAtomicWriteSubState<K extends keyof SUBSTATE_FILES>(
  key: K, modifyFn: (subState: any) => void, maxRetries: number = 3
): boolean;

// gate-state 专用（解决 G1）
export function dbLoadGateStore(): GateStore;
export function dbSaveGateStore(store: GateStore): boolean;

// 审计日志专用（解决 G6/G7）
export function dbWriteAuditLogEntry(entry: Record<string, unknown>): void;
export function dbFlushAuditTrail(sessionID: string): void;
```

**实现细节**：

- `dbReadSubState("eslint_state")` → `SELECT ... FROM eslint_state WHERE ...` 组装为现有 JSON 结构
- `dbWriteSubState("eslint_state", value)` → 事务内 `DELETE FROM eslint_state` + 批量 `INSERT`
- `dbAtomicWriteSubState` → 使用 `db.transaction()` 包装 read→modify→write，行级锁保证原子性
- `dbLoadGateStore/dbSaveGateStore` → 事务内原子读写，解决 G1 非原子写入

**性能考虑**：`dbWriteSubState` 全量替换模式对于小状态表（<30KB）是高效的；对于大状态表（knowledge-cache-state 582KB），提供增量更新路径：

```typescript
// 增量更新 API（仅用于高频大状态）
export function dbUpdateKnowledgeCacheAccess(
  agentKey: string, taskId: string, domainId: string,
  updates: Partial<SessionAccessEntry>
): boolean;
```

#### Step 2: 双写过渡层（substate-manager.ts 代理模式） ✅ 已实施

**目标**：修改现有 `substate-manager.ts`，写入时同时写 JSON + DB，读取优先 DB

**修改文件**：`.opencode/lib/substate-manager.ts`

**实际实施**：
- 原有 `readSubState/writeSubState` 重命名为 `readSubStateJson/writeSubStateJson`（内部）
- 原有 `readMachineMeta/writeMachineMeta` 重命名为 `readMachineMetaJson/writeMachineMetaJson`（内部）
- 新 `readSubState`: `dbReadSubState()` 优先 → null/error 时 fallback `readSubStateJson()`
- 新 `writeSubState`: `writeSubStateJson()` + `dbWriteSubState()` 双写；JSON 成功为权威返回值；DB 失败记录 `DB-WRITE-FALLBACK`
- 新 `readMachineMeta`: DB 优先（非空 meta/contracts 才接受）→ JSON fallback
- 新 `writeMachineMeta`: JSON + DB 双写
- `readMachine()/writeMachine()` deprecated 函数不变（委托到双写层）

**过渡时间**：7 天（2026-06-16 → 2026-06-23），期间监控 DB 写入失败率

#### Step 3: gate-state.json 迁移（解决 G1，最高优先级） ✅ 已实施

**目标**：将 `gate-state.json` 的读写迁移到 DB

**修改文件**：
- `.opencode/lib/gate-core.ts` — `loadGateStore/saveGateStore` → DB + JSON 双路径
- `.opencode/scripts/mcp-tools/compliance-gate.ts` — gate 读写委托给 gate-core（不变）

**实际实施**：
- `loadGateStore` 拆分: `loadGateStoreJson()`（内部 JSON 读取）+ `reconcileGateStore()`（提取对账逻辑为独立函数）
- 新 `loadGateStore(root?)`: `dbLoadGateStore()` 优先 → JSON fallback → `reconcileGateStore()` → 修改则双写持久化
- `saveGateStore` 拆分: `saveGateStoreJson()`（内部 JSON 写入）
- 新 `saveGateStore(store, root?)`: `dbSaveGateStore()` + `saveGateStoreJson()` 双写，DB 失败非阻塞
- gate-state.json (5KB) 仍在双写（INC-7: 待 Step 8 关闭 JSON 写入）
- 下游函数 `createSession/armSession/completeSession/drainStaleSessions` 无变更（调用已路由的双写 `loadGateStore/saveGateStore`）

**验证**：
- 所有 gate 操作（check/arm/complete/drain）仍然正确
- 并发 gate 操作（两个 Agent 同时 arm）不再出现非原子写入
- `framework-self-test` Check 5（Compliance gate Layer 0）和 Check 33（stale sessions）PASS

#### Step 4: 审计日志迁移（解决 G6/G7） ✅ 已实施

**目标**：将 `audit_log.jsonl` 和 `audit_trail.json` 迁移到 DB

**修改文件**：
- `.opencode/lib/audit-log.ts` — `writeAuditLogEntry` → DB INSERT + JSONL 双写
- `.opencode/lib/audit-log.ts` — `flushAuditTrail` → DB upsert + JSON 双写

**实际实施**：
- `writeAuditLogEntry`: DB INSERT 优先 (`dbWriteAuditLogEntry`) → JSONL `appendFileSync` 作为人类可读备份
- `logAuditEntry`: 签名不变，委托到双写 `writeAuditLogEntry`
- `flushAuditTrail`: 读取已有 JSON trail → push 新条目 → DB upsert 优先 (`dbFlushAuditTrail`) → JSON `writeFileSync`
- 两条路径均有 try/catch — DB 失败非阻塞，JSON 保持安全网

**JSONL 保留策略**：审计日志同时写 DB + JSONL（双写），JSONL 作为人类可读备份。7 天后可停止 JSONL 双写。

#### Step 5: 高频子状态迁移（eslint_state, write_audit_state） ✅ 已实施

**目标**：迁移 2 个高频写入子状态

**修改文件**：
- `.opencode/lib/state-utils.ts` — `atomicWriteSubState` 内部实现升级：DB 事务原子写 + JSON 同步

**实际实施**（统一升级策略，所有调用者自动受益）：
- `atomicWriteSubState` 改为使用 `dbAtomicWriteSubState` 进行 SQLite 事务级原子读-改-写（解决 G3 CAS 弱验证、G4 忙等自旋）
- 事务完成后，从 DB 读取最新状态，通过 `writeSubState` 同步到 JSON（维持双写过渡期兼容性）
- 自动受益的调用者（无需单独修改）：
  - `.opencode/plugins/scope-after.ts` — `atomicWriteSubState("eslint_state")` ✅
  - `.opencode/plugins/audit-after.ts` — `atomicWriteSubState("write_audit_state")` ✅
  - `.opencode/lib/write-audit-lib.ts` — 5 个 `atomicWriteSubState` 调用 ✅
- gate-core.ts 读取路径已通过 Step 2 双写代理自动使用 DB 优先读取：
  - `readSubState("eslint_state")` — ✅ DB-first
  - `readSubState("type_check_state")` — ✅ DB-first
  - `readSubState("format_state")` — ✅ DB-first
  - `readSubState("dependency_state")` — ✅ DB-first

**验证**：self-test 35/38 PASS，ESLint mock-audit 全量扫描正确，DB↔JSON 数据完全同步

#### Step 6: 中频子状态迁移（compliance_records, knowledge_cache_state） ✅ 已实施

**目标**：迁移 2 个中频+大体积子状态

**修改文件**：无代码修改 — 所有调用站点已通过 Step 2/5 代理层自动使用 DB

**实际实施**（统一代理层自动覆盖）：
- `compliance-gate.ts` — `readSubState("compliance_records")` → DB-first (Step 2 双写代理)
- `compliance-gate.ts` — `readSubState("eslint_state")` + `atomicWriteSubState("eslint_state")` → DB 事务 (Step 5)
- `cache-after.ts` — `atomicWriteSubState("knowledge_cache_state")` → DB 事务 (Step 5)
- `uc7ks-after.ts` — `atomicWriteSubState("knowledge_cache_state")` → DB 事务 (Step 5)
- `knowledge_cache_search.ts` — `readSubState` + `atomicWriteSubState` → DB (Step 2/5)
- `uc7ks-utils.ts` — `readSubState("knowledge_cache_state")` → DB-first (Step 2)

**增量更新路径**：`knowledge_cache_state` 当前使用 `substate_kv` JSON blob 全量替换（通过 `dbAtomicWriteSubState` 事务），性能可接受。typed 表 `knowledge_session_access` 增量更新为 Step 8 后优化项。

#### Step 7: 低频子状态 + 其余迁移（剩余 8 个子状态） ✅ 已实施

**目标**：完成所有剩余子状态迁移

**修改文件**：无代码修改 — 所有调用站点已通过 Step 2/5 代理层自动使用 DB

**实际实施**（统一代理层自动覆盖，共审计 30+ 调用站点）：
- `tdd_enforcement_state` — tdd-before.ts (read), tdd-after.ts (atomic write), state-canonicalize.ts (read) → DB (Step 2/5)
- `transaction_state` — dag-policy.ts (atomic write + read), state-transaction.ts (read + write), code-quality-gate.ts (read) → DB (Step 2/5)
- `keystone_hashes` — code-quality-gate.ts (read), state-integrity-scan.ts (read) → DB-first (Step 2)
- `knowledge_state` — janitor.ts (atomic write), state-reconciliation.ts (atomic write + read), knowledge_cache_search.ts (atomic write), code-quality-gate.ts (read) → DB (Step 2/5)
- `knowledge_audit_state` — code-quality-gate.ts (read) → DB-first (Step 2)
- `type_check_state/format_state/dependency_state` — write-audit-lib.ts (atomic write), gate-checks.ts (read), framework-compliance-check.ts (read), state-canonicalize.ts (read), state-integrity-scan.ts (read) → DB (Step 2/5)
- G5 已解决：`code-quality-gate.ts` 的本地 `writeMachine()` 函数使用 `writeMachineMeta()` + `writeSubState()`（均为 Step 2 双写代理），无绕过框架的直接 JSON I/O
- G10 状态：`uc7ks-schema.ts` 的 `atomicWriteMachine` re-export 已确认无调用者（dead code），待 Step 8 清理

**验证**：self-test 34/38 PASS（Check 26/27 待 commit 后自动解决，Check 33 为临时 stale entry）

#### Step 8: 清理 + 最终验证 ✅ 已完成 (2026-06-16 初版 + 2026-06-17 drain DB 化)

**目标**：移除 JSON 双写层，删除废弃兼容代码，drain 归档 DB 化

**清理清单**：

| 删除项 | 说明 |
|--------|------|
| `atomicWriteMachine()` 兼容层 | 0 调用者，已删除 |
| `readMachine()/writeMachine()` | 0 调用者，已删除 |
| `uc7ks-schema.ts` re-export + 过期注释 | G10，已删除并清理 |
| 12 个子状态 JSON 文件 | 冻结为只读后备（长期删除） |
| `gate-state.json` | DB-only，gate_sessions 表为主存储 |
| `gate-state.drained_sessions.json` | **DB 化**：`gate_drained_sessions` 表（`dbArchiveDrainedSession`）|
| `writeJsonFile()` + `getDrainedStorePath()` + `DrainedStore` | drain DB 化后无调用者，已删除 |
| `gate-core.ts` writeLog 引用错误 | **修复**：`writeLogSafe()` 懒加载（打破 log-manager↔gate-core 循环依赖） |
| `compliance-gate.ts` drain fallback | **DB 化**：`purgeStaleSessions()` + `drainStaleSessions()` 均改用 DB |
| `state-transaction.ts` 过期注释 | **修复**：`atomicWriteMachine()` → `atomicWriteSubState()` |
| `audit_log.jsonl` 双写 | 已停止 JSONL 写入 |
| `safe-bash-core.ts` 独立日志文件 | 统一到 `writeLog()`（解决 G8） |

**验证**：
- `framework-self-test` 39/40 PASS（Check 33 为预先存在的 stale dispatch entries）
- `framework-doctor` 12/13 PASS（Check 6 检测未提交变更，提交后自动恢复）

---

## 五、子系统兼容性保证

### 5.1 Layout Architecture System

| 保障项 | 方案 |
|--------|------|
| 代码与运行时状态分离 | DB 文件存放于 `.opencode/state/framework-state.db`，与代码目录 `.opencode/lib/` 分离 |
| 人类可读性 | 提供 `db-export-json()` 函数导出子状态为 JSON；`bun -e "..."` 可直接查询 |
| Git 可追踪 | `machine.json`（307B）保留为 Git 追踪文件（meta + contracts）；DB 文件加入 `.gitignore` |
| 目录结构 | `.opencode/state/` 保持不变，新增 `framework-state.db` + `framework-state.db-wal` + `framework-state.db-shm` |

### 5.2 Permission Matrix System

| 保障项 | 方案 |
|--------|------|
| Agent 写入范围检查 | `write_audit_state` 表新增 `scope_result` 列；`isWriteAllowed()` 逻辑不变，仅存储层迁移 |
| 15 Permission Keys | 不改变；DB 存储 permission 配置在 `project.config.json`（JSON 保留） |
| Enforcement 模式 | 不改变；`getEnforcementMode()` 从 `project.config.json` 读取（JSON 保留） |
| MCP 协议 stdout 纯净 | DB 操作在 MCP 工具内部，日志通过 `process.stderr.write()` 输出，不污染 stdout |

### 5.3 Concurrent Session/Dispatch Write System

| 保障项 | 方案 |
|--------|------|
| CAS 协议 | SQLite WAL + `busy_timeout=5000` + `db.transaction()` 替代 CAS retry；行级锁保证原子性 |
| 子状态隔离 | 每个子状态为独立 DB 表，不同 Agent 写不同表时互不阻塞 |
| 跨进程可见 | WAL 模式下，不同 Bun 进程（多 Agent 并发）可同时读写同一 DB |
| 自愈机制 | `dbAtomicWriteSubState` 使用 `db.transaction()` 失败自动回滚；`busy_timeout` 避免立即失败 |
| dispatch_subagent DAG 约束 | `transaction_state.auto_plan_history` 迁移到 DB 表；`appendAutoPlanRecord()` 使用事务写入 |

### 5.4 Hardened Enforcement System

| 保障项 | 方案 |
|--------|------|
| CRITICAL_FILES 保护 | `CRITICAL_FILES` 定义不变（26 项）；新增 `framework-state.db` 到列表 |
| Keystone hash 验证 | `keystone_hashes` 表存储 SHA-256；pre-commit hook 从 DB 读取（或保留 JSON 双写直到 Step 7） |
| Plugin integrity check | SHA-256 验证逻辑不变；`checkPluginIntegrity()` 读取文件哈希 |
| TOCTOU 保护 | `safe-edit-core.ts` 逻辑不变；`acquireLock` mkdir 互斥保留（用于文件写入）；DB 事务用于状态写入 |
| Non-atomic write 消除 | G1（gate-state.json）→ DB 事务；G7（audit_trail）→ DB 事务 |

### 5.5 Harness System

| 保障项 | 方案 |
|--------|------|
| 32/38 self-test | 迁移后 Step 0-4 实施验证: **35/38 PASS**（3 项预先存在失败: Check 26/27 未提交文件、Check 33 stale dispatch）; 迁移无新增回归 |
| 新增 DB 健康检查 | Check: DB WAL mode enabled；Check: DB file exists and readable；Check: Schema tables all present (24) |
| 框架自测试脚本 | `framework-self-test.ts` 新增 3-5 项 DB 专项检查 |
| `framework-doctor.ts` | DB 健康诊断：PRAGMA integrity_check, page_count, free_list |

### 5.6 Central State Management

| 保障项 | 方案 |
|--------|------|
| P1-A CAS 统一 | `atomicWriteSubState` → `dbAtomicWriteSubState`（事务原子性替代 CAS revision） |
| P1-B 拆分架构 | 12 个 JSON 文件 → 24 个 DB 表（20 typed + 4 辅助: gate_store_meta, gate_audit_history, substate_kv, schema_version）；`substate_kv` 保证双写期间 API 兼容性；子状态语义完全保留 |
| `meta.revision` | 迁移到 `machine_meta` 表，通过 `SELECT COUNT(*) FROM machine_meta WHERE key='revision'` 获取 |
| 向后兼容 | 双写过渡期（Step 2）保证 JSON 和 DB 数据一致 |
| 子状态膨胀治理 | DB 表支持 `VACUUM` 和 `DELETE WHERE timestamp < cutoff`；替代 JSON 手动清理 |

### 5.7 Multi-Agent System

| 保障项 | 方案 |
|--------|------|
| DAG 调度 | `Task.DAG.json` 保留为 Git 追踪文件（不变） |
| dispatch 约束 | `transaction_state.auto_plan_history` → DB；`countAutoPlanAttempts()` 使用 `SELECT COUNT(*)` |
| Agent scope 隔离 | `write_audit_state` 表的 `agent` 列；`compliance_records` 表的 `agent` 列 |
| Compliance Gate 流程 | gate_sessions 表原子性保证 check→arm→complete→drain 链路不断裂 |
| @Meta-Planner/@Orchestrator/@Super-Admin | 不改变角色定义和路由规则 |

### 5.8 Log Central Management System

| 保障项 | 方案 |
|--------|------|
| writeLog() 统一 | `log-manager.ts` 保留；DB 操作日志通过 `writeLog(SRC, ...)` 记录 |
| 结构化事件标识 | DB 事件标识符：`DB-INITIALIZED`, `DB-CONN-FAILED`, `DB-QUERY-FAILED`, `DB-TRANSACTION-FAILED`, `DB-WRITE-FALLBACK`, `DB-READ-FALLBACK`, `DB-MIGRATION-*` |
| 日志缓冲+flush | `log-manager.ts` 缓冲机制不变；DB 操作不依赖缓冲 |
| MCP stdout 纯净 | DB 初始化/查询日志全部通过 `writeLog` → `process.stderr.write()`，不污染 stdout |
| G9 循环依赖解决 | DB 作为中间层：gate-core 不再直接写 JSON（需要 log-manager），而是写 DB（不需要 log-manager）；循环依赖消除 |

### 5.9 Templatization & Parameterization System For Universality

| 保障项 | 方案 |
|--------|------|
| 参数化配置 | `project.config.json` 保留为 JSON（人类可编辑、Git 可追踪）；DB 仅存储运行时状态 |
| 模板变量 | `template_resolution` 不改变；DB 不参与模板解析 |
| 跨项目复用 | DB Schema 为标准 CREATE TABLE，可跨项目复用；`db-manager.ts` 为通用库 |
| 数据导出 | `db-export-json()` 函数支持导出任意子状态为 JSON，便于跨项目迁移 |

---

## 六、性能预估

### 6.1 存储空间对比

| 维度 | 当前 JSON | 预估 DB |
|------|----------|---------|
| 总数据量 | ~1.1MB（12 文件） | ~1.0-1.2MB（SQLite 存储效率与 JSON 略有差异） |
| 最大单文件 | 582KB (knowledge-cache-state.json) | DB 整体文件（WAL 下约 1.5MB 含索引） |
| 文件数量 | 12 JSON + schemas + backups | 1 DB + 1 WAL + 1 SHM |
| 索引开销 | 无（全量 JSON 解析） | ~200-300KB（8 个索引表） |

### 6.2 操作性能对比

| 操作 | 当前 JSON (readFileSync+parse) | DB (prepared statement) | 预估提升 |
|------|-------------------------------|------------------------|---------|
| 读小状态（<10KB） | ~2ms（parse） | ~0.1ms（索引查询） | **20x** |
| 读大状态（582KB） | ~50ms（parse+alloc） | ~5ms（结构化查询） | **10x** |
| 写小状态 | ~3ms（serialize+tmp+rename） | ~0.5ms（事务 INSERT） | **6x** |
| 写大状态（全量替换） | ~100ms（serialize+tmp+rename） | ~10ms（事务内 DELETE+批量 INSERT） | **10x** |
| 增量更新（单条） | 需读→改→写全量 ~100ms | ~0.2ms（单行 UPDATE） | **500x** |
| 并发写入（不同子状态） | 文件级隔离（已 P1-B 解决） | 表级隔离+行级锁 | 等价 |
| 并发写入（同子状态） | CAS 重试 ~0-50ms | WAL busy_timeout ~0-5ms | **10x** |

### 6.3 关键性能路径

- **ESLint mock-audit（compliance_gate_complete）**：当前读 eslint_state ~5ms → DB 查询 ~0.5ms
- **knowledge_cache_search**：当前读 582KB ~50ms → DB 按 agent+task 查询 ~1ms
- **gate arm/complete**：当前非原子 writeFileSync ~2ms → DB 事务 ~0.5ms（且保证原子性）
- **write_audit scope check**：当前 5 个子状态写入 ~15ms → DB 事务内 5 表写入 ~2ms

---

## 七、风险与缓解

| 风险 | 严重程度 | 缓解措施 |
|------|---------|---------|
| Bun:sqlite API 变更（Bun 版本升级） | 低 | Bun 内置模块稳定性高；OpenCode 上游依赖同一模块 |
| DB 文件损坏（崩溃/断电） | 中 | WAL 模式 + `PRAGMA synchronous=NORMAL` 保证崩溃恢复；定期 `PRAGMA integrity_check` |
| 迁移期间数据不一致 | 中 | 双写过渡层（Step 2）；DB 读取失败自动 fallback 到 JSON |
| DB 文件被 Git 追踪 | 低 | `.gitignore` 排除 `framework-state.db*`；machine.json（307B）保留追踪 |
| DB 文件膨胀（长期无清理） | 中 | `dbVacuum()` 定期执行；`dbCleanStaleEntries()` 清理过期记录 |
| 循环依赖引入 | 低 | `db-manager.ts` 仅依赖 `log-manager.ts`（writeLog）；不依赖 gate-core |
| MCP 工具并发访问 | 低 | WAL 模式 + busy_timeout=5000 保证并发安全 |

---

## 八、实施时间线

| Step | 预估耗时 | 状态 | 前置条件 | 验证标准 |
|------|---------|:--:|---------|---------|
| Step 0 | 2h | ✅ 完成 | 无 | DB 文件创建、WAL 启用、24 张 Schema 表初始化 |
| Step 1 | 3h | ✅ 完成 | Step 0 | dbReadSubState/dbWriteSubState 等价测试 + migrateJsonToDb 验证 |
| Step 2 | 1h | ✅ 完成 | Step 1 | 双写层正确、DB fallback 正常 |
| Step 3 | 2h | ✅ 完成 | Step 2 | gate-state DB+JSON 双路径、reconcileGateStore 提取 |
| Step 4 | 1h | ✅ 完成 | Step 2 | audit_log DB+JSONL 双写、audit_trail DB+JSON 双写 |
| Step 5 | 2-3h | ✅ 完成 | Step 2 | atomicWriteSubState→DB事务, 所有调用者自动受益, gate-core读取DB-first |
| Step 6 | 3-4h | ✅ 完成 | Step 5 | compliance/knowledge 调用站点已通过 Step 2/5 代理层自动使用 DB |
| Step 7 | 2-3h | ✅ 完成 | Step 5/6 | 30+ 调用站点审计完成，G5/G10 已确认解决 |
| Step 8 | 1-2h | ✅ 完成 | Step 7 | JSON 双写移除、兼容层删除、drain DB 化、writeLog 修复、self-test 39/40 PASS |

**已完成耗时：~20h（Step 0-8 全部完成）**
**总计耗时：~20h**（原 14h 偏乐观，已按验证报告 INC-5 调整）

---

## 九、回滚计划

每个 Step 均可独立回滚：

1. **Step 0-1 回滚**：删除 `framework-state.db`，无功能影响（DB 尚未被读取）
2. **Step 2 回滚**：修改 `substate-manager.ts` 移除 DB 双写/DB 优先读取，恢复纯 JSON 模式
3. **Step 3-7 回滚**：恢复各文件对 JSON API 的调用，DB 写入停止，JSON 继续工作
4. **Step 8 回滚**：恢复 JSON 双写层，保留 DB 作为只读备份

**数据安全**：双写过渡期保证 JSON 文件始终有最新数据，DB 损坏不影响框架运行。

---

## 十、参考资料

### 官方文档
- `docs/official_docs/opencode/findings/01-log-central-management.md` — 日志三机制规范
- `docs/official_docs/opencode/findings/05-central-state-management.md` — 状态管理模式
- `docs/official_docs/opencode/findings/03-permission-matrix.md` — 权限矩阵
- `docs/official_docs/opencode/framework/plugins.md` — Plugin 集成规范
- `docs/official_docs/bun/bun-overview.md` — Bun 运行时特性

### 外部参考
- [How to Use SQLite with Bun's Native Support](https://oneuptime.com/blog/post/2026-01-31-bun-sqlite/view) — bun:sqlite API 完整指南
- [Using SQLite with Bun: A Complete Guide](https://www.dbpro.app/blog/bun-sqlite) — WAL 模式、事务、性能
- [OpenCode GitHub Repository](https://github.com/opencode-ai/opencode) — OpenCode 上游 SQLite 使用验证
- [SQLite 2026 重回巅峰](https://m.toutiao.cn/a7620453865532293678/) — SQLite 行业趋势

### 内部文档
- `docs/review/framework-refactor/machine-split-implementation-plan.md` — P1-B 拆分实施
- `docs/review/framework-refactor/cas-unify-implementation-plan.md` — P1-A CAS 统一
- `docs/review/framework-refactor/framework-evaluation-report.md` — 框架评估报告（二次修订版）

### 数据验证
- OpenCode 内部 DB：`~/.local/share/opencode/opencode.db`（7.4GB, WAL, 1611 sessions, 46828 messages）
- 当前框架状态：`.opencode/state/` 12 子状态文件，总计 ~1.1MB
- DB 迁移验证：`.opencode/state/framework-state.db`（~248KB after migration, 24 tables, WAL mode）

### 验证报告
- `docs/review/framework-refactor/db-migration-verification-report.md` — L1/L2 双层验证，4/5 ⭐，7 处不一致已修正：
  - INC-1/INC-6: DB 表数 25 → 方案已补充 4 张额外表说明 ✅
  - INC-2: 方案状态 → 更新为「Step 0-7 已实施」 ✅
  - INC-3: ESLint `last_full_scan` → DB schema v3 ALTER TABLE 已应用 ✅
  - INC-4: knowledge 嵌套 → `substate_kv` JSON blob 保留完整结构 ✅
  - INC-5: 工时 14h → 调整为 20-22h ✅
  - INC-7: gate-state.json 双写 → L3 验证正常，Step 8 关闭 ✅
  - INC-8: `substate_kv` 列名 `json` → 方案已补充说明 ✅

---

## 十一、实施进度总结（2026-06-17 最新）

### 11.1 DB 运行时状态

| 指标 | 实际值 |
|------|--------|
| DB 文件大小 | 1.1MB (framework-state.db) + 4MB WAL + 32KB SHM |
| Schema 版本 | **v7** (initial + substate_kv + last_full_scan + file_baseline_kv + deliverables columns + session/dispatch tables + drop 13 unused typed tables) |
| 表数量 | **16 张** (12 active typed + 4 auxiliary + sqlite_sequence，v7 清理 13 张未使用 typed 表) |
| 新增表（v4-v6） | `file_baseline_kv` (v4)、`session_log` / `dispatch_failed_log` / `session_map` (v6) |
| 清理表（v7） | DROP 13 张未使用 typed 子状态表（`eslint_state`、`write_audit_state`、`compliance_records`、`knowledge_session_access`、`knowledge_cache_meta`、`tdd_enforcement_state`、`keystone_hashes`、`transaction_state`、`knowledge_state`、`knowledge_audit_state`、`type_check_state`、`format_state`、`dependency_state`） |
| gate_sessions 扩展（v5） | 6 列 deliverables 硬约束 |
| substate_kv 行数 | 12 (全部子状态 DB-only，JSON 快照已冻结) |
| WAL 模式 | active |
| PRAGMA integrity_check | ok |
| Self-test 基线 | **framework-self-test.ts — 39/40 PASS**（Check 33 为预先存在的 stale dispatch entries；含 Check 38: v6 DB schema + Check 39: S41 schema 文件完整性） |
| 集成测试 | **3/3 PASS**（auto-declare、normal lifecycle、resume lifecycle） |

### 11.2 G1-G13 问题矩阵（最终状态）

| 编号 | 缓解状态 | 实施 Step |
|------|:--:|:--:|
| G1 gate-state.json 非原子 | ✅ 已解决 | Step 3 (DB 事务 + JSON 双写) |
| G2 machine.json 双 lastUpdated 字段 | ✅ **已缓解** | **P3 schema v4** (DB 侧清理；JSON 兼容字段暂保留，低影响 307B) |
| G3 CAS 弱验证 | ✅ 已解决 | Step 5 (DB 事务替代 CAS) |
| G4 忙等自旋 | ✅ 已解决 | Step 5 (DB busy_timeout=5000) |
| G5 code-quality-gate 混合 writeMachine | ✅ 已解决 | Step 7 (本地 writeMachine 已使用双写代理) |
| G6 appendFileSync 审计日志 | ✅ 已解决 | Step 4 (DB INSERT + JSONL 双写) |
| G7 flushAuditTrail 非原子 | ✅ 已解决 | Step 4 (DB upsert + JSON 双写) |
| G8 safe-bash-core 绕过 writeLog | ✅ **已解决** | **Step 8** (`logAction` → `writeLog()`) |
| G9 gate-core ↔ log-manager 循环依赖 | ✅ 已解决 | Step 3 (DB 作为中间层) |
| G10 uc7ks-schema re-export dead code | ✅ **已解决** | **Step 8** (dead code 全部清理) |
| G11 FileStateRegistry 进程内限制 | ✅ **已解决** | **P3 schema v4** (`file_baseline_kv` 表) |
| G12 readSubState/writeSubState any 类型 | ✅ **已解决** | **P3** (`substate-types.ts` SubStateMap 泛型) |
| G13 compliance-gate inline fallback | ✅ 已解决 | Step 6 (所有读取已通过 readSubState 双写代理) |

**最终统计：12/13 完全解决（G1, G3-G13）+ 1/13 缓解（G2 低影响设计约束）**
**INC-1 ~ INC-8 全部关闭**

### 11.3 Step 8 清理清单（✅ 2026-06-16 初版 + 2026-06-17 drain DB 化完成）

| 清理项 | 状态 | 备注 |
|--------|:--:|------|
| `atomicWriteMachine()` (state-utils.ts) | ✅ 已删除 | 0 残留调用者 |
| `readMachine()/writeMachine()` (substate-manager.ts) | ✅ 已删除 | 外部 0 调用者 |
| `uc7ks-schema.ts` re-export atomicWriteMachine | ✅ 已删除 | dead code + 过期注释已清理 |
| `code-quality-gate.ts` 本地 `writeMachine` 函数 | ✅ 已重构 | writeMachineMeta+writeSubState 双写代理 |
| 12 个 JSON 子状态文件 | ✅ 冻结 | 保留为只读后备，DB 为实际读写目标 |
| `gate-state.json` (2.2KB) | ✅ DB-only | DB gate_sessions 表为主要存储 |
| `gate-state.index.json` (159KB) | ✅ 保留 | compactor v3 架构，非双写对象 |
| `audit_log.jsonl` 双写 | ✅ 移除 | 仅 DB INSERT |
| `writeJsonFile()` (gate-core) | ✅ 已删除 | drain 归档迁移至 DB `gate_drained_sessions` 表后无调用者 |
| `getDrainedStorePath()` (gate-core) | ✅ 已删除 | drain 归档 DB 化，路径解析不再需要 |
| `DrainedStore` interface (gate-core) | ✅ 已删除 | drain 数据模型迁移至 DB 表 |
| drain 归档 JSON 文件 | ✅ DB 化 | `gate-state.drained_sessions.json` → `gate_drained_sessions` DB 表 |
| `gate-core.ts` writeLog 引用错误 | ✅ 修复 | `writeLog(SRC,...)` 未导入 → `writeLogSafe()` 懒加载（打破 log-manager↔gate-core 循环依赖） |
| `compliance-gate.ts` drain fallback | ✅ DB 化 | `purgeStaleSessions()` + `drainStaleSessions()` fallback 均改用 `dbArchiveDrainedSession()` |
| `state-transaction.ts` 过期注释 | ✅ 修复 | `atomicWriteMachine()` 引用 → `atomicWriteSubState()` |
| `safe-bash-core.ts` 独立日志 | ✅ 修复 | 统一到 `writeLog()` |

**实际耗时**：~2h（初版）+ ~1h（drain DB 化 + writeLog 修复 + 注释清理）
**实际效果**：JSON 双写层全部移除（JSON 快照冻结为只读后备）、dead code 全部清理、drain 归档完全 DB 化、日志系统循环依赖已解决、self-test 39/40 PASS（唯一失败为预先存在的 Check 33）。

### 11.4 P3 schema v4 增量（2026-06-16 已完成）

| 变更 | 文件 | 状态 |
|------|------|:--:|
| 新增 `file_baseline_kv` 表 | `db-manager.ts` v4 block | ✅ |
| `machine_meta.last_updated` 统一清理 | `db-state-manager.ts` | ✅ |
| `substate-types.ts` SubStateMap 泛型 | `lib/substate-types.ts` (新) | ✅ |
| `db-state-manager.ts` 强类型化 | 导入 `SubStateKey`/`SubStateMap` | ✅ |
| state-transaction.ts DEPRECATED | beginTransaction 移除 | ✅ |

详见 `p3-deep-optimization-plan.md` + `p3-verification-report.md`。

### 11.5 gate-stuck-fix schema v5/v6 增量（2026-06-17 已完成）

**v5 — deliverables 硬约束（Phase 1-5）：**

| 变更 | 表 | 状态 |
|------|-----|:--:|
| `declared_deliverables` TEXT (JSON) | gate_sessions | ✅ |
| `submitted_deliverables` TEXT (JSON) | gate_sessions | ✅ |
| `deliverables_approved_by` TEXT | gate_sessions | ✅ |
| `deliverables_approved_at` INTEGER | gate_sessions | ✅ |
| `deliverables_approval_note` TEXT | gate_sessions | ✅ |
| `approval_required` INTEGER | gate_sessions | ✅ |

**v6 — session 基础设施（§14 v4 方案）：**

| 表 | 用途 | 状态 |
|----|------|:--:|
| `session_log` | sub-agent session 持久记录（替代 SESSION_ID.md） | ✅ |
| `dispatch_failed_log` | dispatch 失败归档（替代 .pending.json.failed） | ✅ |
| `session_map` | session→agent 映射（替代 .session_map.json） | ✅ |

**配套代码修改：**
- `.dispatch_ctx` 单次消费文件机制（替代 process.env.FRAMEWORK_TASK_ID，解决 Bug 1+2）
- `db-state-manager.ts` 新增 7 个 CRUD 函数（`dbAppendSessionLog`、`dbQuerySessionByDagTaskId`、`dbAppendDispatchFailed`、`dbReadSessionMap`、`dbWriteSessionMap`、`dbCleanupSessionLog`、`dbCleanupDispatchFailed`）
- `task-after.ts` / `dispatch-after.ts` / `session.ts` 改 DB 写入路径
- `agent-resolver.ts` / `dispatch-subagent.ts` 改 DB 读取路径
- `framework-self-test.ts` 新增 Check 38（验证 v6 三表存在且可查询）
- **Session Resume v4 端到端验证通过（Phase 6, 2026-06-17）**：commits `49b93ea3` + `2dcbf41b`，3/3 集成测试 PASS（auto-declare / normal lifecycle / resume lifecycle）
- **`approve_deliverables` 物理限制已实施（SA-FIX-APPROVE-PERMISSION）**：三层 agent identity fallback + `agent_id` 参数，非 @Orchestrator/@Super-Admin 调用被物理拒绝

**S41 Schema 拆分（2026-06-17 已完成，与 v5/v6 独立）：**
- `machine.schema.json` 从 1304 行瘦身至 64 行（仅 `meta` + `contracts`）
- 12 子状态 + 4 扩展 schema 拆分至 `.opencode/state/schemas/`（16 个独立 JSON Schema 文件）
- 原始单体 schema 保留为 `machine.schema.full.json` 供参考
- `framework-self-test.ts` 新增 Check 39：验证 16 个子状态 schema 文件存在性、JSON 有效性、`machine.schema.json` slim 属性（≤5 properties，required 包含 `meta` + `contracts`）

详见 `gate-stuck-fix-and-deliverables-plan.md` §14-16 + `p3-deep-optimization-plan.md` §15。

### 11.6 待跟进（全部完成 ✅）

| 项目 | 状态 | 说明 |
|------|:--:|------|
| ~~**gate-stuck-fix Phase 6**~~ | ✅ **已完成 (2026-06-17)** | Session Resume v4 方案全部 7 步验证通过（commits `49b93ea3` + `2dcbf41b`），3/3 集成测试 PASS；`.dispatch_ctx` + `session_log` DB 端到端 resume 验证通过；`approve_deliverables` 物理限制（三层 agent identity fallback + `agent_id` 参数）已实施（SA-FIX-APPROVE-PERMISSION） |
| ~~**nightly-compaction v6 表清理**~~ | ✅ **已完成 (2026-06-17)** | `dbCleanStaleEntries()` 已扩展覆盖 `session_log` / `dispatch_failed_log` / `session_map`（7 天 TTL + session_map 50 条上限）；`nightly-compaction.ts` 的 `dbMaintenanceStep()` 已调度此函数 |
| ~~**machine.schema.json 拆分 (S41)**~~ | ✅ **已完成 (2026-06-17)** | `machine.schema.json` 从 1304 行瘦身至 64 行（仅 `meta` + `contracts`）；12 子状态 + 4 扩展 schema 拆分至 `.opencode/state/schemas/`（16 个独立文件）；原始单体保留为 `machine.schema.full.json` 供参考；framework-self-test.ts 新增 Check 39 验证 schema 文件完整性 |
| ~~**typed DB 表结构化查询**~~ | ✅ **已完成 (2026-06-17)** | v7 schema 清理 13 张未使用 typed 表（DROP TABLE）；`substate_kv` JSON blob 为子状态唯一存储层，性能可接受（1-2ms）；零 SQL 读写引用确认 |
| ~~**JSON 快照文件删除**~~ | ✅ **已完成 (2026-06-17)** | 12 个冻结子状态 JSON + `gate-state.drained_sessions.json` + `audit_log.jsonl` 已删除；`substate_kv` DB 为唯一数据源 |

