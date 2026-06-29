## framework-state.db 健康维护实施方案

**日期**: 2026-06-27
**状态**: 待实施
**优先级**: P0 — 阻塞性性能问题

---

### 一、根因诊断

framework-state.db 从 1.3MB 膨胀至 7.2GB，导致磁盘 I/O 打满、系统卡顿。经数据库实测和源码审计，确认根因是四个缺陷的叠加。

**缺陷 1：O(n²) 回环写入（主因）**

`dbLoadGateStore()`（db-state-manager.ts:420）执行 `SELECT * FROM gate_audit_history ORDER BY id ASC`，将全表 785 万行一次性加载到内存数组。`dbSaveGateStore()`（db-state-manager.ts:580）对该数组做逐条 INSERT，无去重、无截断。gate-core.ts 中有 16 处 `saveGateStore` 调用（check → arm → deliver → approve → complete 各调一次），每次 gate 状态变迁都触发"全量加载 → 追加新条目 → 全量回写"。数组只增不减，写入量随时间呈平方级增长。

**缺陷 2：清理代码列名错误（静默失败）**

`dbCleanStaleEntries()`（db-manager.ts:2328）包含对 `gate_audit_history` 的清理逻辑，但使用了 `WHERE timestamp < ?`。该表没有 `timestamp` 列——实际列名是 `confirmed_at`。try-catch 静默吞掉了 SQL 错误，导致清理从未生效。

**缺陷 3：Compactor 从未执行**

v14 migration 已添加 `compactor_event` 和 `archive_path` 列，设计了 warm/hot/cold/export 四级生命周期。但 785 万行的 `compactor_event` 全部为 NULL，`archive_path` 全部为 NULL。compactor 机制代码存在但从未被触发。

**缺陷 4：Nightly compaction 是手动脚本**

`scripts/nightly-compaction.ts` 设计为手动执行的 CLI 脚本（`bun .opencode/scripts/nightly-compaction.ts`），没有挂载到任何 plugin hook 或 cron 调度。实际上从未运行。

**数据库实测数据**:

| 指标 | 值 |
|------|-----|
| 数据库总大小 | 7.2 GB |
| gate_audit_history 行数 | 7,852,032 |
| gate_audit_history 数据量 | 5.88 GB（占 81%） |
| 平均行大小 | ~694 bytes |
| compactor_event = NULL 占比 | 100% |
| archive_path 非空占比 | 0% |
| 数据时间跨度 | 2026-06-03 ~ 2026-06-23（20 天） |
| WAL 模式 | wal, autocheckpoint=1000 |
| 其他表最大 | execution_checklist_items: 4.6 MB |

---

### 二、实施方案总览

方案分为三个阶段：紧急修复（止血）、源码修复（治本）、Plugin 硬化（长期免疫）。

```
阶段 0: 紧急修复（手动执行，立即止血）
  ├─ 0.1 备份当前数据库
  ├─ 0.2 截断 gate_audit_history 全表
  ├─ 0.3 VACUUM 回收空间
  └─ 0.4 验证数据库完整性

阶段 1: 源码修复（修改 3 个文件，消除根因）
  ├─ 1.1 修复 dbCleanStaleEntries 列名 bug
  ├─ 1.2 改造 dbLoadGateStore 禁止全表恢复
  └─ 1.3 改造 dbSaveGateStore 为纯增量追加

阶段 2: Plugin 硬化（新建 db-health.ts，长期免疫）
  ├─ 2.1 session.created → 启动健康检查
  ├─ 2.2 session.idle → 周期性维护
  ├─ 2.3 session.compacted → 压缩后清理
  └─ 2.4 tool.execute.after → 写入放大监控
```

---

### 三、阶段 0：紧急修复

在 WSL 中执行。预计耗时 2-5 分钟。

```bash
cd /home/zhaoge/workspace/opencode/work-one

# 0.1 备份（遵循框架约定：DB 备份放 .task_temp/.backups/，参见 backup-manager.ts:22）
mkdir -p .task_temp/.backups
cp .opencode/state/framework-state.db .task_temp/.backups/framework-state.db.bloat-backup-$(date +%Y%m%d)
cp .opencode/state/framework-state.db-wal .task_temp/.backups/framework-state.db-wal.bloat-backup-$(date +%Y%m%d) 2>/dev/null

# 0.2 截断 gate_audit_history（保留表结构，清空数据）
# 使用 bun 执行：
bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('.opencode/state/framework-state.db');
console.log('Before:', db.query('SELECT COUNT(*) as c FROM gate_audit_history').get());
db.run('DELETE FROM gate_audit_history');
db.run('DELETE FROM sqlite_sequence WHERE name=\"gate_audit_history\"');
console.log('After:', db.query('SELECT COUNT(*) as c FROM gate_audit_history').get());
db.close();
"

# 0.3 清理 WAL + VACUUM
bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('.opencode/state/framework-state.db');
db.run('PRAGMA wal_checkpoint(TRUNCATE)');
db.run('VACUUM');
console.log('Size after vacuum:', require('fs').statSync('.opencode/state/framework-state.db').size);
db.close();
"

# 0.4 完整性验证
bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('.opencode/state/framework-state.db');
console.log(db.query('PRAGMA integrity_check').all());
console.log('Tables:', db.query('SELECT name FROM sqlite_master WHERE type=\"table\"').all().map(t=>t.name));
db.close();
"
```

预期结果：数据库从 7.2GB 降至 ~2MB，所有表结构完整，integrity_check 返回 ok。

---

### 四、阶段 1：源码修复

#### 4.1 修复 dbCleanStaleEntries 列名 bug

**文件**: `.opencode/lib/db-manager.ts`
**位置**: `dbCleanStaleEntries()` 函数，约第 2328 行
**问题**: `gate_audit_history` 没有 `timestamp` 列，应为 `confirmed_at`

当前代码将 `gate_audit_history` 放在统一循环中用 `WHERE timestamp < ?` 清理，因列名不匹配而静默失败。修复方案：将 `gate_audit_history` 从统一循环中移出，单独用正确的列名清理。

```typescript
// 修改前（统一循环，列名错误）：
for (const table of ["audit_log", "write_audit_state", "eslint_state", "gate_audit_history"]) {
  try {
    const res = db.run(`DELETE FROM ${table} WHERE timestamp < ?`, [cutoff]);
    total += res.changes;
  } catch { /* 静默失败 */ }
}

// 修改后：
// 1. 统一循环只处理有 timestamp 列的表
for (const table of ["audit_log", "write_audit_state", "eslint_state"]) {
  try {
    const res = db.run(`DELETE FROM ${table} WHERE timestamp < ?`, [cutoff]);
    total += res.changes;
  } catch { /* skip */ }
}

// 2. gate_audit_history 单独处理，使用正确的列名
try {
  const res = db.run(
    "DELETE FROM gate_audit_history WHERE confirmed_at < ?",
    [cutoff],
  );
  total += res.changes;
} catch { /* skip */ }
```

#### 4.2 改造 dbLoadGateStore 禁止全表恢复

**文件**: `.opencode/lib/db-state-manager.ts`
**位置**: `dbLoadGateStore()` 函数，约第 386 行
**问题**: `SELECT * FROM gate_audit_history ORDER BY id ASC` 加载全表到内存

`audit_history` 是 append-only 审计日志，在 GateStore 对象中携带整个历史数组没有业务意义——没有任何消费者需要读取完整的审计历史来做决策。改造方案：不再加载 `gate_audit_history`，返回空数组。审计查询改为按需进行。

```typescript
// 修改前：
const auditRows = db
  .query("SELECT * FROM gate_audit_history ORDER BY id ASC")
  .all() as any[];
const audit_history = auditRows.map(reconstructAuditEntry);

// 修改后：
// audit_history 不再全量加载。GateStore 中返回空数组。
// 审计数据通过 dbQueryAuditHistory() 按需查询（见 4.4）。
const audit_history: any[] = [];
```

#### 4.3 改造 dbSaveGateStore 为纯增量追加

**文件**: `.opencode/lib/db-state-manager.ts`
**位置**: `dbSaveGateStore()` 函数，约第 580 行
**问题**: 对 `store.audit_history` 数组做逐条 INSERT，由于 load 返回空数组（4.2 的修改），save 也不会再回写历史数据

经过 4.2 的修改后，`loadGateStore` 返回的 `audit_history` 始终为空数组。因此 `dbSaveGateStore` 中的 audit_history INSERT 循环不会执行（空数组遍历 0 次）。这从根本上断开了 O(n²) 回环。

但为了防御性编程，建议在 INSERT 前加一个 guard：

```typescript
// 在 dbSaveGateStore 的 audit_history 写入段添加：
const history = s.audit_history || [];
// 防御性截断：单次 save 最多追加 100 条审计记录
if (history.length > 100) {
  writeLog(SRC, "WARN", {
    event: "DB-SAVE-AUDIT-TRUNCATE",
    detail: `audit_history has ${history.length} entries, truncating to last 100`,
  });
  history.splice(0, history.length - 100);
}
```

#### 4.4 新增按需审计查询 API

**文件**: `.opencode/lib/db-state-manager.ts`
**新增函数**:

```typescript
/**
 * 按需查询 gate 审计历史（替代全量加载）。
 * 支持按 session_id、时间窗口、状态过滤。
 */
export function dbQueryAuditHistory(opts: {
  session_id?: string;
  since?: number;       // timestamp ms
  status?: string;
  limit?: number;
}): any[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }
  if (opts.since) {
    conditions.push("confirmed_at >= ?");
    params.push(opts.since);
  }
  if (opts.status) {
    conditions.push("gate_status = ?");
    params.push(opts.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit || 100;

  return db.query(
    `SELECT * FROM gate_audit_history ${where} ORDER BY id DESC LIMIT ?`,
  ).all(...params, limit) as any[];
}
```

---

### 五、阶段 2：Plugin 硬化

新建 `.opencode/plugins/db-health.ts`，将数据库健康维护硬化到 OpenCode 生命周期中。

#### 5.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│  OpenCode Lifecycle Events                                   │
├──────────────┬──────────────────┬───────────────────────────┤
│ session.     │ session.         │ session.                  │
│ created      │ idle             │ compacted                 │
│              │                  │                           │
│ ▼            │ ▼                │ ▼                         │
│ ┌──────────┐ │ ┌──────────────┐ │ ┌───────────────────────┐ │
│ │ Phase 1: │ │ │ Phase 2:     │ │ │ Phase 3:              │ │
│ │ Startup  │ │ │ Idle         │ │ │ Post-Compaction       │ │
│ │ Health   │ │ │ Maintenance  │ │ │ Cleanup               │ │
│ │ Check    │ │ │              │ │ │                       │ │
│ │          │ │ │ • 表大小检查 │ │ │ • 清理 in-memory      │ │
│ │ • integrity│ │ • 超限清理   │ │ │   stale references    │ │
│ │ • 大小   │ │ │ • WAL ckpt   │ │ │                       │ │
│ │   告警   │ │ │ • 统计上报   │ │ │                       │ │
│ └──────────┘ └──────────────┘ └───────────────────────────┘ │
│                                                               │
│ tool.execute.after                                            │
│ ▼                                                             │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ Phase 4: Write Amplification Monitor                      │ │
│ │                                                           │ │
│ │ • 监控 compliance_gate_* 工具调用频率                     │ │
│ │ • 记录 gate_audit_history 行数变化                        │ │
│ │ • 行数超阈值时触发紧急清理                                │ │
│ └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### 5.2 Plugin 实现

```typescript
// db-health.ts — Plugin: 数据库健康维护（硬化到 OpenCode 生命周期）
// ═══════════════════════════════════════════════════════════════
// 将 SQLite 数据库的健康检查和维护硬化到 OpenCode 会话生命周期中，
// 确保数据库长期健康运行，防止 gate_audit_history 等表无限膨胀。
//
// Hook events:
//   - session.created:     启动健康检查（integrity + 表大小）
//   - session.idle:        周期性维护（清理 + checkpoint + vacuum）
//   - session.compacted:   压缩后清理（reset in-memory counters）
//   - tool.execute.after:  写入放大监控（gate 操作频率）
//
// 配置项（通过 gate-stale.json 或 project.config.json）：
//   - DB_HEALTH_MAX_ROWS:         gate_audit_history 行数上限（默认 10000）
//   - DB_HEALTH_RETENTION_DAYS:   审计记录保留天数（默认 7）
//   - DB_HEALTH_MAX_DB_SIZE_MB:   数据库总大小上限 MB（默认 100）
//   - DB_HEALTH_VACUUM_THRESHOLD: 空闲多少次后触发 VACUUM（默认 5）
// ═══════════════════════════════════════════════════════════════

import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import { getDb } from "../lib/db-manager";
import {
  safeCheckpoint,
  integrityCheck,
} from "../lib/db-maintenance";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = "plugin-db-health";

// ── 配置 ──────────────────────────────────────────────────────

const CONFIG = {
  /** gate_audit_history 行数上限 */
  MAX_AUDIT_ROWS: 10_000,
  /** 审计记录保留天数 */
  RETENTION_DAYS: 7,
  /** 数据库总大小上限 (MB) */
  MAX_DB_SIZE_MB: 100,
  /** 空闲多少次后触发 VACUUM */
  VACUUM_EVERY_IDLE_COUNT: 5,
  /** 单表大小告警阈值 (MB) */
  TABLE_SIZE_WARN_MB: 50,
};

// ── 状态 ──────────────────────────────────────────────────────

let _idleCount = 0;
let _lastHealthReport = 0;
const HEALTH_REPORT_INTERVAL = 5 * 60 * 1000; // 5 分钟内最多报告一次

export default withPluginLifecycle("db-health", {
  "session.created": onSessionCreated,
  "session.idle": onSessionIdle,
  "session.compacted": onSessionCompacted,
  "tool.execute.after": onToolExecuteAfter,
});

// ═══════════════════════════════════════════════════════════════
// Phase 1: session.created — 启动健康检查
// ═══════════════════════════════════════════════════════════════

async function onSessionCreated(input: any, _output: any) {
  writeLog(SRC, "INFO", {
    event: "DB-HEALTH-STARTUP-CHECK",
    detail: "Session started — running startup health check",
  });

  try {
    const db = getDb();

    // 1. Integrity check
    const integrity = integrityCheck();
    if (!integrity.ok) {
      writeLog(SRC, "ERROR", {
        event: "DB-HEALTH-INTEGRITY-FAILED",
        detail: `Integrity check failed: ${JSON.stringify(integrity.details)}`,
      });
      return; // 完整性失败时跳过后续检查
    }

    // 2. 表大小检查
    const tableSizes = getTableSizes(db);
    const dbFile = path.join(
      process.env.OPENCODE_ROOT || process.cwd(),
      ".opencode/state/framework-state.db",
    );
    const dbSizeMB = fs.existsSync(dbFile)
      ? fs.statSync(dbFile).size / 1024 / 1024
      : 0;

    // 3. 告警判定
    const warnings: string[] = [];
    if (dbSizeMB > CONFIG.MAX_DB_SIZE_MB) {
      warnings.push(`DB size ${dbSizeMB.toFixed(1)}MB exceeds limit ${CONFIG.MAX_DB_SIZE_MB}MB`);
    }
    for (const [table, sizeMB] of Object.entries(tableSizes)) {
      if (sizeMB > CONFIG.TABLE_SIZE_WARN_MB) {
        warnings.push(`Table ${table}: ${sizeMB.toFixed(1)}MB exceeds ${CONFIG.TABLE_SIZE_WARN_MB}MB`);
      }
    }

    if (warnings.length > 0) {
      writeLog(SRC, "WARN", {
        event: "DB-HEALTH-STARTUP-WARNING",
        detail: warnings.join("; "),
      });
      // 启动时如果已经超标，立即执行清理
      await runCleanup(db, "startup");
    } else {
      writeLog(SRC, "INFO", {
        event: "DB-HEALTH-STARTUP-OK",
        detail: `db=${dbSizeMB.toFixed(1)}MB tables=${Object.keys(tableSizes).length} integrity=ok`,
      });
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-HEALTH-STARTUP-FAILED",
      detail: e.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// Phase 2: session.idle — 周期性维护
// ═══════════════════════════════════════════════════════════════

async function onSessionIdle(_input: any, _output: any) {
  _idleCount++;

  try {
    const db = getDb();

    // 1. 每次 idle 都做轻量检查
    const auditRowCount = db
      .query("SELECT COUNT(*) as c FROM gate_audit_history")
      .get() as { c: number };

    if (auditRowCount.c > CONFIG.MAX_AUDIT_ROWS) {
      writeLog(SRC, "WARN", {
        event: "DB-HEALTH-AUDIT-ROW-LIMIT",
        detail: `gate_audit_history has ${auditRowCount.c} rows (limit: ${CONFIG.MAX_AUDIT_ROWS}) — triggering cleanup`,
      });
      await runCleanup(db, "idle-overflow");
    }

    // 2. 每 N 次 idle 做一次完整维护
    if (_idleCount % CONFIG.VACUUM_EVERY_IDLE_COUNT === 0) {
      writeLog(SRC, "INFO", {
        event: "DB-HEALTH-PERIODIC-MAINTENANCE",
        detail: `idle_count=${_idleCount} — running periodic maintenance`,
      });

      // 2a. 清理过期数据
      await runCleanup(db, "idle-periodic");

      // 2b. WAL checkpoint
      try {
        const cp = safeCheckpoint();
        writeLog(SRC, "INFO", {
          event: "DB-HEALTH-CHECKPOINT",
          detail: `busy=${cp.busy} log=${cp.log} checkpointed=${cp.checkpointed}`,
        });
      } catch (e: any) {
        writeLog(SRC, "WARN", {
          event: "DB-HEALTH-CHECKPOINT-FAILED",
          detail: e.message,
        });
      }

      // 2c. VACUUM（仅在有空闲页时）
      try {
        const fl = db.query("PRAGMA freelist_count").get() as { freelist_count: number };
        if (fl.freelist_count > 100) {
          db.run("VACUUM");
          writeLog(SRC, "INFO", {
            event: "DB-HEALTH-VACUUM",
            detail: `freelist_pages=${fl.freelist_count} reclaimed`,
          });
        }
      } catch (e: any) {
        writeLog(SRC, "WARN", {
          event: "DB-HEALTH-VACUUM-FAILED",
          detail: e.message,
        });
      }

      // 2d. 统计上报
      reportHealthStats(db);
    }
  } catch (e: any) {
    writeLog(SRC, "ERROR", {
      event: "DB-HEALTH-IDLE-MAINTENANCE-FAILED",
      detail: e.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// Phase 3: session.compacted — 压缩后清理
// ═══════════════════════════════════════════════════════════════

async function onSessionCompacted(_input: any, _output: any) {
  // OpenCode 压缩会话上下文后，重置 in-memory 计数器
  // 防止 stale session 引用导致不必要的 DB 查询
  writeLog(SRC, "INFO", {
    event: "DB-HEALTH-SESSION-COMPACTED",
    detail: "Session compacted — resetting in-memory health counters",
  });
  _idleCount = 0;
}

// ═══════════════════════════════════════════════════════════════
// Phase 4: tool.execute.after — 写入放大监控
// ═══════════════════════════════════════════════════════════════

let _gateToolCallCount = 0;
const GATE_TOOLS = new Set([
  "compliance_gate_check",
  "compliance_gate_arm",
  "compliance_gate_deliver",
  "compliance_gate_approve",
  "compliance_gate_complete",
]);

async function onToolExecuteAfter(input: any, _output: any) {
  if (!GATE_TOOLS.has(input.tool)) return;

  _gateToolCallCount++;

  // 每 50 次 gate 工具调用检查一次行数
  if (_gateToolCallCount % 50 === 0) {
    try {
      const db = getDb();
      const count = db
        .query("SELECT COUNT(*) as c FROM gate_audit_history")
        .get() as { c: number };

      if (count.c > CONFIG.MAX_AUDIT_ROWS) {
        writeLog(SRC, "WARN", {
          event: "DB-HEALTH-GATE-AMPLIFICATION",
          detail: `gate_tool_calls=${_gateToolCallCount} audit_rows=${count.c} — write amplification detected`,
        });
        await runCleanup(db, "amplification-guard");
      }
    } catch {
      // 非关键路径，静默
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 共享工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 执行清理：删除过期 gate_audit_history 行 + 其他审计表
 */
async function runCleanup(db: any, trigger: string) {
  const cutoff = Date.now() - CONFIG.RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let totalDeleted = 0;

  // 1. 清理 gate_audit_history（使用正确的列名）
  try {
    const res = db.run(
      "DELETE FROM gate_audit_history WHERE confirmed_at < ?",
      [cutoff],
    );
    totalDeleted += res.changes;
  } catch { /* skip */ }

  // 2. 如果清理后仍超限，强制截断（保留最新 N 行）
  try {
    const count = db
      .query("SELECT COUNT(*) as c FROM gate_audit_history")
      .get() as { c: number };
    if (count.c > CONFIG.MAX_AUDIT_ROWS) {
      const res = db.run(`
        DELETE FROM gate_audit_history
        WHERE id NOT IN (
          SELECT id FROM gate_audit_history
          ORDER BY id DESC
          LIMIT ?
        )
      `, [CONFIG.MAX_AUDIT_ROWS]);
      totalDeleted += res.changes;
    }
  } catch { /* skip */ }

  // 3. 清理其他审计表
  for (const [table, col] of [
    ["audit_log", "timestamp"],
    ["read_audit", "created_at"],
    ["execution_checklist_events", "created_at"],
    ["dispatch_failed_log", "failed_at"],
    ["session_log", "created_at"],
  ] as const) {
    try {
      const res = db.run(`DELETE FROM ${table} WHERE ${col} < ?`, [cutoff]);
      totalDeleted += res.changes;
    } catch { /* skip */ }
  }

  if (totalDeleted > 0) {
    writeLog(SRC, "INFO", {
      event: "DB-HEALTH-CLEANUP",
      detail: `trigger=${trigger} deleted=${totalDeleted} cutoff=${new Date(cutoff).toISOString()}`,
    });
  }
}

/**
 * 获取所有表的大小估算（MB）
 */
function getTableSizes(db: any): Record<string, number> {
  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];

  const result: Record<string, number> = {};
  for (const t of tables) {
    try {
      const cols = db.query(`PRAGMA table_info("${t.name}")`).all() as { name: string }[];
      const lenExprs = cols
        .map((c) => `COALESCE(LENGTH(CAST("${c.name}" AS TEXT)), 0)`)
        .join(" + ");
      const size = db
        .query(`SELECT SUM(${lenExprs}) as total_bytes FROM "${t.name}"`)
        .get() as { total_bytes: number | null };
      result[t.name] = ((size.total_bytes || 0) / 1024 / 1024);
    } catch {
      result[t.name] = 0;
    }
  }
  return result;
}

/**
 * 上报健康统计
 */
function reportHealthStats(db: any) {
  const now = Date.now();
  if (now - _lastHealthReport < HEALTH_REPORT_INTERVAL) return;
  _lastHealthReport = now;

  try {
    const tableSizes = getTableSizes(db);
    const dbFile = path.join(
      process.env.OPENCODE_ROOT || process.cwd(),
      ".opencode/state/framework-state.db",
    );
    const dbSizeMB = fs.existsSync(dbFile)
      ? fs.statSync(dbFile).size / 1024 / 1024
      : 0;

    const topTables = Object.entries(tableSizes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, mb]) => `${name}=${mb.toFixed(2)}MB`)
      .join(", ");

    writeLog(SRC, "INFO", {
      event: "DB-HEALTH-REPORT",
      detail: `db=${dbSizeMB.toFixed(1)}MB top=[${topTables}] gate_calls=${_gateToolCallCount} idle_cycles=${_idleCount}`,
    });
  } catch {
    // 非关键路径
  }
}
```

#### 5.3 挂载点选择理由

| Hook 事件 | 触发时机 | 维护动作 | 选择理由 |
|-----------|---------|---------|---------|
| `session.created` | 每次新会话启动 | integrity_check + 表大小检查 + 超标时立即清理 | 确保每次启动时数据库处于健康状态；如果上次会话遗留了膨胀问题，第一时间修复 |
| `session.idle` | 会话空闲（Agent 完成一轮对话后） | 行数检查 + 过期清理 + WAL checkpoint + 定期 VACUUM | 最自然的维护窗口——用户正在思考或阅读输出时执行后台维护，不影响用户体验 |
| `session.compacted` | OpenCode 压缩上下文后 | 重置 in-memory 计数器 | 防止跨 compaction 周期的 stale 计数导致误判 |
| `tool.execute.after` | 每次工具调用后 | 监控 gate 工具调用频率 + 行数采样检查 | gate 操作是写入放大的主要来源；每 50 次采样一次，开销极低但能及时发现膨胀 |

---

### 六、实施顺序与依赖关系

```
阶段 0（紧急修复）
  │  无依赖，立即执行
  ▼
阶段 1.1（修复 dbCleanStaleEntries 列名）
  │  无依赖，独立修改
  ▼
阶段 1.2（改造 dbLoadGateStore）
  │  依赖 1.1（清理函数需要正确列名才能维持清理后的健康）
  ▼
阶段 1.3（改造 dbSaveGateStore 防御性截断）
  │  依赖 1.2（load 返回空数组后 save 自然不再回写）
  ▼
阶段 1.4（新增 dbQueryAuditHistory 按需 API）
  │  依赖 1.2（替代被移除的全量加载功能）
  ▼
阶段 2（新建 db-health.ts plugin）
  │  依赖阶段 1 全部完成
  │  需要在 opencode.json 的 plugin 数组中注册
  ▼
验证
```

---

### 七、验证计划

#### 7.1 阶段 0 验证

```bash
# 确认数据库大小
ls -lh .opencode/state/framework-state.db
# 预期：< 5MB

# 确认表结构完整
bun -e "import {Database} from 'bun:sqlite'; const db = new Database('.opencode/state/framework-state.db'); console.log(db.query('SELECT COUNT(*) as c FROM sqlite_master WHERE type=\"table\"').get()); db.close();"
# 预期：约 39 张表

# 确认 gate_audit_history 为空
bun -e "import {Database} from 'bun:sqlite'; const db = new Database('.opencode/state/framework-state.db'); console.log(db.query('SELECT COUNT(*) as c FROM gate_audit_history').get()); db.close();"
# 预期：{ c: 0 }

# 确认完整性
bun -e "import {Database} from 'bun:sqlite'; const db = new Database('.opencode/state/framework-state.db'); console.log(db.query('PRAGMA integrity_check').all()); db.close();"
# 预期：[{ integrity_check: "ok" }]
```

#### 7.2 阶段 1 验证

修改后运行 OpenCode 正常开发流程（创建 DAG → 分发任务 → gate check/arm/deliver/approve），观察：
- `gate_audit_history` 行数随 gate 操作正常增长
- 每次 `dbLoadGateStore` 不再返回 audit_history 数据（空数组）
- 日志中无 `DB-LOAD-GATE-STORE-FAILED` 错误

#### 7.3 阶段 2 验证

- 启动 OpenCode 后检查日志中是否出现 `DB-HEALTH-STARTUP-CHECK`
- 空闲后检查是否出现 `DB-HEALTH-IDLE-MAINTENANCE`
- 故意写入大量 gate 操作后检查 `DB-HEALTH-GATE-AMPLIFICATION` 是否触发
- 长时间运行后确认 `gate_audit_history` 行数稳定在 `MAX_AUDIT_ROWS` 以下

---

### 八、长期健康指标

Plugin 硬化后，以下指标可通过日志持续监控：

| 指标 | 日志事件 | 健康阈值 |
|------|---------|---------|
| 数据库总大小 | `DB-HEALTH-REPORT` | < 100 MB |
| gate_audit_history 行数 | `DB-HEALTH-AUDIT-ROW-LIMIT` | < 10,000 |
| 单表最大大小 | `DB-HEALTH-STARTUP-WARNING` | < 50 MB |
| WAL 文件大小 | `DB-HEALTH-CHECKPOINT` | checkpoint 后 = 0 |
| 写入放大比 | `DB-HEALTH-GATE-AMPLIFICATION` | gate 调用 50 次后行数 < 200 |
| 完整性状态 | `DB-HEALTH-INTEGRITY-FAILED` | 始终 ok |
