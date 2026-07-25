# TSC Diagnostic Gate v2 — 零容忍 + 并发安全实现方案

**日期**: 2026-06-27
**制定者**: @Super-Admin
**状态**: 待实施
**前置文档**:

- `docs/review/framework-refactor/lsp-diagnostic-gate-implementation-plan.md` (v1, baseline-diff 模型)
- `docs/review/framework-refactor/lsp-diagnostic-gate-e2e-acceptance-gaps.md` (E2E 验收缺口)
- `docs/review/framework-refactor/g7-ts-baseline-cleanup-plan.md` (G-7 baseline 清理)
  **取代**: v1 的 baseline-diff 模型（保留 `diagnostic_baseline` 作为进度追踪，不再作为豁免依据）

---

## 0. 执行摘要

### 0.1 问题

当前 TSC Diagnostic Gate (v1) 存在两个严重缺陷：

1. **首次写入不阻塞**: Layer 1 (before-write) 不运行 `tsc`，只读 `diagnostic_state` 缓存。缓存为空时不阻塞，导致首次引入新错误的写入不被拦截。
2. **Baseline 豁免技术债**: `compareWithBaseline()` 对已存在于 baseline 中的错误返回 `"unchanged"`，不阻塞。这意味着预存的 374 个 TSC 错误永远不会被强制清理。

**量化证据** (2026-06-27 DB 验证):

| DB 字段                            | 值                    | 说明                                  |
| ---------------------------------- | --------------------- | ------------------------------------- |
| `diagnostic_state.files`           | `{}` (空)             | 没有任何文件被标记为有错误            |
| `diagnostic_baseline.total_errors` | `374`                 | 基线预存 374 个错误                   |
| `session.ts` 在 baseline 中        | ✅ (3 errors)         | session.ts 的错误被预存在 baseline 中 |
| `diagnostic_baseline.captured_at`  | `2026-06-27T00:28:13` | 手动捕获                              |

### 0.2 v2 核心变更

| 维度               | v1 (当前)                    | v2 (本方案)                                           |
| ------------------ | ---------------------------- | ----------------------------------------------------- |
| **错误检测模型**   | Baseline-diff (只阻新增错误) | **Zero-tolerance** (目标文件的任何 TSC error 都阻塞)  |
| **写入前检查**     | 只读缓存，不运行 tsc         | **运行 tsc，检查目标文件是否有错误**                  |
| **写入后检查**     | 运行 tsc，更新缓存           | **运行 tsc，立即更新 diagnostic_state**               |
| **错误清理范围**   | 只关心自己引入的错误         | **任何被修改过的文件，所有 TSC 错误都必须清理**       |
| **Baseline 角色**  | 预存技术债的"白名单"         | **进度追踪器** (记录已知错误用于减少噪声，不豁免错误) |
| **并发安全**       | 无并发控制                   | **文件级锁 + tsc 运行互斥**                           |
| **非目标文件错误** | 不检查                       | **记录到 diagnostic_state 但不阻塞当前写入**          |

### 0.3 已确认的设计决策

| 决策点            | 选择               | 理由                                              |
| ----------------- | ------------------ | ------------------------------------------------- |
| Before-write 行为 | **阻塞写入**       | 目标文件有 TSC 错误时禁止写入，Agent 必须先修复   |
| 非目标文件错误    | **记录不阻塞**     | 并发友好，不同 agent 修改不同文件不互相阻塞       |
| Baseline 策略     | **保留为进度追踪** | 不再豁免错误，只展示"已知错误数→当前错误数"的进度 |
| TSC 运行频率      | **每次写入都运行** | before + after 都运行 tsc，最准确                 |

---

## 1. 12 子系统符合性设计

### 1.1 Layout Architecture Subsystem

**文件布局**:

| 文件                                       | 操作     | 说明                                                |
| ------------------------------------------ | -------- | --------------------------------------------------- |
| `.opencode/lib/tsc-gate-db.ts`             | **新增** | 文件锁 + 审计事件 DB 管理                           |
| `.opencode/plugins/tsc-diag-track.ts`      | **重写** | Layer 1 运行 tsc + 阻塞; Layer 1.5 更新状态         |
| `.opencode/lib/tsc-diagnostic.ts`          | **增强** | 增加 tsc 运行互斥锁支持                             |
| `.opencode/lib/baseline-diagnostic.ts`     | **重构** | 移除豁免逻辑，保留进度追踪                          |
| `.opencode/lib/db-manager.ts`              | **更新** | 新增 `tsc_gate_locks` + `tsc_gate_events` 表 schema |
| `.opencode/lib/substate-types.ts`          | **更新** | `diagnostic_state` schema 增加 `source` 字段        |
| `.opencode/lib/gate-core.ts`               | **更新** | `compliance_gate` 中的 diagnostic 检查适配 v2       |
| `.opencode/project.config.json`            | **更新** | 新增 `tsc_gate_*` 配置项                            |
| `.opencode/scripts/framework-self-test.ts` | **更新** | 新增 v2 验证检查                                    |

### 1.2 DB-only and DB-canonical based

**存储**:

- 所有 TSC 错误状态存储在 SQLite `substate_kv` 表中 (key: `diagnostic_state`, `diagnostic_baseline`)
- 新增 `tsc_gate_locks` 表: 文件级锁
- 新增 `tsc_gate_events` 表: 审计事件日志
- 无 JSON 状态文件 (完全 DB-canonical, P1-B split architecture)

**新 DB 表**:

```sql
-- tsc_gate_locks: 文件级写入锁
CREATE TABLE IF NOT EXISTS tsc_gate_locks (
  file_path TEXT NOT NULL,           -- 文件绝对路径
  session_id TEXT NOT NULL,          -- 持有锁的 session
  locked_at INTEGER NOT NULL,        -- 加锁时间 (ms timestamp)
  lock_type TEXT NOT NULL DEFAULT 'file_write', -- 锁类型
  PRIMARY KEY (file_path)
);

-- tsc_gate_events: 审计事件日志
CREATE TABLE IF NOT EXISTS tsc_gate_events (
  event_id TEXT PRIMARY KEY,        -- UUID
  session_id TEXT,                   -- 触发 session
  file_path TEXT NOT NULL,           -- 目标文件
  event_type TEXT NOT NULL,          -- TSC-CHECK-START/PASS/FAIL/LOCK-ACQUIRED/LOCK-RELEASED/LOCK-CONFLICT
  error_count INTEGER DEFAULT 0,     -- 错误数
  elapsed_ms INTEGER,               -- tsc 运行耗时
  detail TEXT,                       -- 详细信息 (JSON)
  created_at INTEGER NOT NULL        -- 时间戳
);

CREATE INDEX IF NOT EXISTS idx_tsc_gate_events_session ON tsc_gate_events(session_id);
CREATE INDEX IF NOT EXISTS idx_tsc_gate_events_file ON tsc_gate_events(file_path);
CREATE INDEX IF NOT EXISTS idx_tsc_gate_events_type ON tsc_gate_events(event_type);
```

### 1.3 Permission Matrix Subsystem

| Agent          | TSC Gate 权限                                                             | 说明                       |
| -------------- | ------------------------------------------------------------------------- | -------------------------- |
| @Super-Admin   | 可通过 `tsc-gate-reset` 重置文件锁                                        | 紧急修复时清理死锁         |
| 其他所有 Agent | 无 bypass 权限                                                            | 必须修复错误才能继续写入   |
| opencode.json  | `safe_edit`/`write`/`edit`/`safe_shell` 对 `.ts`/`.tsx` 文件自动触发 gate | 通过 `isModifyTool()` 判定 |

**权限矩阵更新** (opencode.json):

- 不需要新增权限 key — TSC gate 通过 plugin hook 自动触发，不需要显式权限声明
- `safe_shell` 中的写入命令 (cp/mv/rm/sed/tee 等) 同样触发 gate (通过 `getEffectivePathScopePaths`)

### 1.4 Session/Same-Agent/Different-Agent/Task Concurrency Safe

**核心挑战**: 多 agent 并行修改不同文件时如何避免 tsc 互相阻塞

**解决方案**: 文件级锁 + tsc 运行互斥

```
                    ┌──────────────────────────────────┐
                    │     tsc_gate_locks (DB table)     │
                    │  ┌────────────────────────────┐  │
                    │  │ file_path | session_id |   │  │
                    │  │ locked_at | lock_type     │  │
                    │  └────────────────────────────┘  │
                    └──────────────────────────────────┘
                                  ▲
                    ┌─────────────┴──────────────┐
                    │                            │
              Agent A 写 file-a.ts          Agent B 写 file-b.ts
                    │                            │
         1. acquireLock(file-a)         1. acquireLock(file-b) ✅
              → OK (不同文件)              → OK (不同文件)
                    │                            │
         2. runTsc(file-a)             2. runTsc(file-b)
              → 等待 tsc 互斥锁          → 等待 tsc 互斥锁
                    │                            │
         3. tsc 完成, 检查 file-a      3. tsc 完成, 检查 file-b
                    │                            │
         4. 允许写入或阻塞              4. 允许写入或阻塞
                    │                            │
         5. 写入完成                   5. 写入完成
                    │                            │
         6. after: runTsc(file-a)     6. after: runTsc(file-b)
                    │                            │
         7. releaseLock(file-a)       7. releaseLock(file-b)
```

**同文件冲突场景**:

```
Agent A 写 file-a.ts → acquireLock(file-a) → OK
Agent B 写 file-a.ts → acquireLock(file-a) → ❌ BLOCKED
    → throw [FW-ENFORCE][TSC-LOCK-CONFLICT]
    → Agent B 必须等待 Agent A 释放锁
```

**锁超时**:

- 默认 60 秒 (配置: `tsc_gate_lock_timeout_ms`)
- 超时后自动释放 (防止 agent 崩溃导致死锁)
- 超时释放记录 `TSC-LOCK-TIMEOUT` 事件

**tsc 运行互斥**:

- `tsc --noEmit --incremental` 不是线程安全的 (`.tsbuildinfo` 文件竞争)
- 使用 `tsc_gate_locks` 表中 `file_path = '__TSC_MUTEX__'` 作为 tsc 运行互斥锁
- 同一时间只有一个 tsc 进程运行

### 1.5 Hardened Enforcement Subsystem

| 模式     | 行为                                                                |
| -------- | ------------------------------------------------------------------- |
| Advisory | 警告但不阻塞; 框架文件 (`.opencode/**`) 例外 — 即使 advisory 也阻塞 |
| Strict   | 任何 TSC error → `throw Error` 阻塞                                 |
| Locked   | 同 Strict, 且不接受任何豁免                                         |

**错误消息格式**:

```
[FW-ENFORCE][TSC-ERROR-BLOCK] File {absPath} has {N} TSC error(s).
Fix ALL TypeScript errors before writing.
Errors:
  L{line}: {message} (TS{code})
  L{line}: {message} (TS{code})
  ... (max 5 shown)
```

### 1.6 Framework Harness Subsystem

**插件注册**: `tsc-diag-track.ts` 通过 `.opencode/plugins/` 目录自动加载

**Hook 链**:

- `tool.execute.before` (Layer 1): 运行 tsc + 阻塞
- `tool.execute.after` (Layer 1.5): 运行 tsc + 更新状态

**Hook 执行顺序** (在 OpenCode plugin chain 中的位置):

1. `checklist-before.ts` — P0 checklist 检查
2. `scope-before.ts` — 文件 scope + config_read_attest 检查
3. **`tsc-diag-track.ts` (before)** — TSC 错误检查 ← 本方案
4. **(写入操作执行)**
5. `format-after.ts` — Prettier 格式化
6. **`tsc-diag-track.ts` (after)** — TSC 状态更新 ← 本方案
7. `uc7ks-after.ts` — UC7-003 写后验证

### 1.7 Central State Management Subsystem

**子状态**:

- `diagnostic_state` (SQLite `substate_kv`): 存储每个文件的当前 TSC 错误
- `diagnostic_baseline` (SQLite `substate_kv`): 存储基线快照 (进度追踪)
- `machine.json`: 不存储 TSC 状态 (P1-B DB-canonical)

**diagnostic_state schema v2**:

```typescript
interface DiagnosticStateV2 {
  files: Record<
    string,
    {
      errors: TscDiagnosticError[];
      updated_at: string; // ISO timestamp
      source: "before-write-gate" | "after-write-gate"; // ← v2 新增
      session_id?: string; // ← v2 新增: 哪个 session 写入的
    }
  >;
  last_updated: string;
  dirty: boolean;
  last_scan: number;
  schema_version: "2.0"; // ← v2 新增
}
```

### 1.8 Multi-Agent Subsystem

**并行 Agent 安全**:

- 文件级锁确保不同 agent 修改不同文件不会互相阻塞
- 同文件冲突: 第二个 agent 被阻塞直到第一个释放锁
- Task 隔离: `write_audit_state` 记录每个 task 的文件，gate 只检查当前 task 的文件

**跨 Agent 诊断传播**:

- Agent A 修改 file-a.ts → after hook 运行 tsc → 发现 file-b.ts 有错误 → 写入 `diagnostic_state.files[file-b.ts]`
- Agent B 尝试修改 file-b.ts → before hook 读 `diagnostic_state` → 发现 file-b.ts 有错误 → **阻塞 Agent B**
- Agent B 必须先修复 file-b.ts 的错误才能写入

### 1.9 Log Central Management Subsystem

**日志输出**: 所有事件通过 `writeLog("tsc-diag-track", ...)` 写入 `.task_temp/_logs/` 统一日志

**审计事件类型**:

| 事件                      | 说明                             | 日志级别 |
| ------------------------- | -------------------------------- | -------- |
| `TSC-CHECK-START`         | tsc 检查开始                     | runtime  |
| `TSC-CHECK-PASS`          | tsc 检查通过 (目标文件无错误)    | runtime  |
| `TSC-CHECK-FAIL`          | tsc 检查失败 (目标文件有错误)    | ERROR    |
| `TSC-CHECK-PROJECT-DIRTY` | 目标文件干净但项目有其他错误     | WARN     |
| `TSC-CHECK-UNKNOWN`       | tsc 超时或崩溃                   | WARN     |
| `TSC-LOCK-ACQUIRED`       | 文件锁获取成功                   | runtime  |
| `TSC-LOCK-RELEASED`       | 文件锁释放                       | runtime  |
| `TSC-LOCK-CONFLICT`       | 文件锁冲突 (被其他 session 持有) | ERROR    |
| `TSC-LOCK-TIMEOUT`        | 文件锁超时自动释放               | WARN     |
| `TSC-MUTEX-WAIT`          | 等待 tsc 运行互斥锁              | runtime  |
| `TSC-MUTEX-ACQUIRED`      | tsc 互斥锁获取成功               | runtime  |

**日志格式**: 结构化 JSON，包含 `sessionID`, `callID`, `file`, `elapsed`, `error_count`

### 1.10 DB-canonical Management Subsystem

**Schema 版本管理**:

- `diagnostic_state.schema_version` = `"2.0"`
- `tsc_gate_locks` 和 `tsc_gate_events` 表通过 `db-manager.ts` 的 `SCHEMA_VERSION` migration 创建

**Migration 计划**:

1. 清空 `diagnostic_state.files` (v1 的缓存数据不适用于 v2)
2. 保留 `diagnostic_baseline` (用于进度追踪)
3. 创建新表 `tsc_gate_locks` + `tsc_gate_events`
4. 设置 `diagnostic_state.schema_version` = `"2.0"`

### 1.11 Templatization & Parameterization Universality Subsystem

**配置项** (`project.config.json.template_resolution`):

| 配置项                         | 类型    | 默认值             | 说明                                                              |
| ------------------------------ | ------- | ------------------ | ----------------------------------------------------------------- |
| `tsc_gate_mode`                | string  | `"zero-tolerance"` | Gate 模式: `"zero-tolerance"` (v2) 或 `"baseline-diff"` (v1 兼容) |
| `tsc_gate_timeout_ms`          | number  | `30000`            | tsc 运行超时 (ms)                                                 |
| `tsc_gate_lock_timeout_ms`     | number  | `60000`            | 文件锁超时 (ms)                                                   |
| `tsc_gate_block_on_all_errors` | boolean | `true`             | 是否阻塞所有错误 (false = 只阻塞目标文件错误)                     |
| `tsc_gate_max_errors_shown`    | number  | `5`                | 错误消息中最多显示的错误数                                        |

### 1.12 TypeScript + Bun Based Runtime Subsystem

**tsc 调用**: `execSync("npx tsc --noEmit --incremental --pretty false --tsBuildInfoFile ...")`

- 保持现有方式，使用 `--incremental` + `--tsBuildInfoFile` 加速增量编译
- 超时 30 秒 (配置: `tsc_gate_timeout_ms`)

**Bun 兼容**:

- 所有代码用 TypeScript 编写
- 通过 Bun 运行时加载
- 使用 `import` (ESM) 语法，不使用 `require` (CJS)
- 遵循 `framework/plugin-programming-conventions.md` 约束

---

## 2. 核心逻辑设计

### 2.1 tsc-gate-db.ts — 文件锁 + 事件管理

```typescript
// .opencode/lib/tsc-gate-db.ts

import { getDb } from "./db-manager";
import { writeLog } from "./log-manager";

const SRC = "tsc-gate-db";

/**
 * 获取文件级写入锁。
 * 如果文件未被锁定，或锁已超时，则获取锁。
 * 如果文件被其他 session 锁定且未超时，则失败。
 *
 * @returns true 如果获取锁成功，false 如果锁冲突
 */
export function acquireFileLock(
  filePath: string,
  sessionId: string,
  lockTimeoutMs: number = 60000,
): boolean {
  const db = getDb();
  const now = Date.now();
  const expiredThreshold = now - lockTimeoutMs;

  // 尝试插入锁，如果已存在且未超时则失败
  const result = db.transaction(() => {
    // 检查现有锁
    const existing = db
      .query(
        "SELECT session_id, locked_at FROM tsc_gate_locks WHERE file_path = ?",
      )
      .get(filePath) as { session_id: string; locked_at: number } | null;

    if (existing) {
      if (existing.session_id === sessionId) {
        // 同一 session 已持有锁 — 幂等，返回成功
        return true;
      }
      if (existing.locked_at > expiredThreshold) {
        // 锁未超时，被其他 session 持有
        return false;
      }
      // 锁已超时，清除旧锁
      db.run("DELETE FROM tsc_gate_locks WHERE file_path = ?", [filePath]);
    }

    // 插入新锁
    db.run(
      `INSERT OR REPLACE INTO tsc_gate_locks (file_path, session_id, locked_at, lock_type)
       VALUES (?, ?, ?, 'file_write')`,
      [filePath, sessionId, now],
    );
    return true;
  })();

  if (result) {
    writeLog(SRC, "runtime", {
      event: "TSC-LOCK-ACQUIRED",
      detail: `file=${filePath} session=${sessionId}`,
    });
  } else {
    writeLog(SRC, "ERROR", {
      event: "TSC-LOCK-CONFLICT",
      detail: `file=${filePath} session=${sessionId} blocked by existing lock`,
    });
  }

  return result;
}

/**
 * 释放文件级写入锁。
 */
export function releaseFileLock(filePath: string, sessionId: string): boolean {
  const db = getDb();
  const result = db.run(
    "DELETE FROM tsc_gate_locks WHERE file_path = ? AND session_id = ?",
    [filePath, sessionId],
  );
  if (result.changes > 0) {
    writeLog(SRC, "runtime", {
      event: "TSC-LOCK-RELEASED",
      detail: `file=${filePath} session=${sessionId}`,
    });
  }
  return result.changes > 0;
}

/**
 * 获取 tsc 运行互斥锁。
 * 使用 file_path = '__TSC_MUTEX__' 作为互斥锁。
 */
export function acquireTscMutex(
  sessionId: string,
  lockTimeoutMs: number = 60000,
): boolean {
  return acquireFileLock("__TSC_MUTEX__", sessionId, lockTimeoutMs);
}

export function releaseTscMutex(sessionId: string): boolean {
  return releaseFileLock("__TSC_MUTEX__", sessionId);
}

/**
 * 记录 TSC gate 审计事件。
 */
export function logTscGateEvent(input: {
  session_id: string;
  file_path: string;
  event_type: string;
  error_count?: number;
  elapsed_ms?: number;
  detail?: string;
}): void {
  const db = getDb();
  const eventId = `tge_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  db.run(
    `INSERT INTO tsc_gate_events (event_id, session_id, file_path, event_type, error_count, elapsed_ms, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      input.session_id,
      input.file_path,
      input.event_type,
      input.error_count ?? 0,
      input.elapsed_ms ?? null,
      input.detail ?? null,
      Date.now(),
    ],
  );
}
```

### 2.2 tsc-diag-track.ts v2 — 核心 Gate 逻辑

```typescript
// .opencode/plugins/tsc-diag-track.ts v2

import * as path from "node:path";
import { writeLog } from "../lib/log-manager";
import { withPluginLifecycle } from "../lib/hook-lifecycle";
import {
  isModifyTool,
  getModifyPath,
  getEffectivePathScopePaths,
} from "../lib/tool-scope";
import { getEnforcementMode } from "../lib/gate-core";
import { readSubState } from "../lib/substate-manager";
import { atomicWriteSubState } from "../lib/state-utils";
import { runTscDiagnostic } from "../lib/tsc-diagnostic";
import {
  acquireFileLock,
  releaseFileLock,
  acquireTscMutex,
  releaseTscMutex,
  logTscGateEvent,
} from "../lib/tsc-gate-db";
import { getTscGateConfig } from "../lib/tsc-gate-config";

const PLUGIN_NAME = "tsc-diag-track";

export default withPluginLifecycle(PLUGIN_NAME, {
  "tool.execute.before": beforeWriteBlock,
  "tool.execute.after": afterWriteTscCheck,
});

// ── Helper: get TS/TSX write targets ──

function getTypeScriptWriteTargets(tool: string, args: any): string[] {
  const scope = getEffectivePathScopePaths(tool, args || {});
  if (scope.applies && scope.paths.length > 0) {
    return scope.paths.filter(
      (p) => typeof p === "string" && /\.(ts|tsx)$/.test(p),
    );
  }
  // Fallback: direct file path for safe_edit/write/edit
  const directPath = getModifyPath(args);
  if (directPath && /\.(ts|tsx)$/.test(directPath)) {
    return [directPath];
  }
  return [];
}

// ── Layer 1: BEFORE write — 运行 tsc, 检查目标文件, 阻塞有错误的写入 ──

async function beforeWriteBlock(input: any, output: any): Promise<void> {
  if (!isModifyTool(input?.tool)) return;

  const args = output?.args || input?.args || {};
  const targets = getTypeScriptWriteTargets(input.tool, args);
  if (targets.length === 0) return;

  const mode = getEnforcementMode();
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const sessionID = input?.sessionID || "unknown";
  const config = getTscGateConfig();

  for (const filePath of targets) {
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(projectRoot, filePath);

    // 1. 获取文件锁
    const lockAcquired = acquireFileLock(
      absPath,
      sessionID,
      config.lock_timeout_ms,
    );
    if (!lockAcquired) {
      const blockEvent =
        mode !== "advisory"
          ? "TSC-LOCK-CONFLICT-BLOCK"
          : "TSC-LOCK-CONFLICT-WARN";
      writeLog(PLUGIN_NAME, "ERROR", {
        sessionID,
        callID: input?.callID,
        event: blockEvent,
        detail: `${absPath} locked by another session`,
      });
      logTscGateEvent({
        session_id: sessionID,
        file_path: absPath,
        event_type: "TSC-LOCK-CONFLICT",
        detail: "File locked by another session",
      });
      if (mode !== "advisory") {
        throw new Error(
          `[FW-ENFORCE][TSC-LOCK-CONFLICT] File ${absPath} is locked by another session. ` +
            `Wait for the other agent to complete or modify a different file.`,
        );
      }
      return;
    }

    // 2. 获取 tsc 运行互斥锁
    const mutexAcquired = acquireTscMutex(sessionID, config.lock_timeout_ms);
    if (!mutexAcquired) {
      writeLog(PLUGIN_NAME, "runtime", {
        sessionID,
        callID: input?.callID,
        event: "TSC-MUTEX-WAIT",
        detail: `Waiting for tsc mutex to run tsc on ${absPath}`,
      });
      // 等待互斥锁释放 (简化实现: 轮询)
      const maxWait = config.timeout_ms;
      const startTime = Date.now();
      while (Date.now() - startTime < maxWait) {
        if (acquireTscMutex(sessionID, config.lock_timeout_ms)) break;
        await sleep(100);
      }
      if (!acquireTscMutex(sessionID, config.lock_timeout_ms)) {
        releaseFileLock(absPath, sessionID);
        if (mode !== "advisory") {
          throw new Error(
            `[FW-ENFORCE][TSC-MUTEX-TIMEOUT] Could not acquire tsc mutex for ${absPath} within ${maxWait}ms.`,
          );
        }
        return;
      }
    }

    // 3. 运行 tsc
    logTscGateEvent({
      session_id: sessionID,
      file_path: absPath,
      event_type: "TSC-CHECK-START",
      detail: "before-write",
    });

    const result = runTscDiagnostic(absPath, projectRoot);

    // 4. 释放 tsc 互斥锁
    releaseTscMutex(sessionID);

    // 5. 检查目标文件是否有错误
    if (result.errors && result.errors.length > 0) {
      // 目标文件有错误 → 阻塞 (零容忍)
      releaseFileLock(absPath, sessionID); // 释放锁，因为写入被阻塞

      logTscGateEvent({
        session_id: sessionID,
        file_path: absPath,
        event_type: "TSC-CHECK-FAIL",
        error_count: result.errors.length,
        elapsed_ms: result.elapsed,
        detail: result.errors
          .slice(0, config.max_errors_shown)
          .map((e) => `L${e.line}: ${e.message} (TS${e.code})`)
          .join("; "),
      });

      // 更新 diagnostic_state (即使写入被阻塞，也要记录错误状态)
      atomicWriteSubState("diagnostic_state", (state: any) => {
        state.files = state.files || {};
        state.files[absPath] = {
          errors: result.errors,
          updated_at: new Date().toISOString(),
          source: "before-write-gate",
          session_id: sessionID,
        };
        state.last_updated = new Date().toISOString();
        state.schema_version = "2.0";
      });

      const frameworkDir = path.join(projectRoot, ".opencode");
      const isFrameworkFile = absPath.startsWith(frameworkDir + path.sep);
      const shouldBlock = mode !== "advisory" || isFrameworkFile;

      if (shouldBlock) {
        writeLog(PLUGIN_NAME, "ERROR", {
          sessionID,
          callID: input?.callID,
          event: "TSC-BASELINE-DIFF-BLOCK",
          detail: `${absPath} | ${result.errors.length} error(s) | zero-tolerance mode`,
        });
        throw new Error(
          `[FW-ENFORCE][TSC-ERROR-BLOCK] File ${absPath} has ${result.errors.length} TSC error(s).\n` +
            `Fix ALL TypeScript errors before writing.\n` +
            `Errors:\n  ${result.errors
              .slice(0, config.max_errors_shown)
              .map((e) => `L${e.line}: ${e.message} (TS${e.code})`)
              .join("\n  ")}`,
        );
      }
    } else {
      // 目标文件干净
      logTscGateEvent({
        session_id: sessionID,
        file_path: absPath,
        event_type: "TSC-CHECK-PASS",
        elapsed_ms: result.elapsed,
        detail: result.diagnostic_status || "clean",
      });

      // 清除 diagnostic_state 中该文件的错误 (如果之前有)
      atomicWriteSubState("diagnostic_state", (state: any) => {
        state.files = state.files || {};
        if (state.files[absPath]) {
          delete state.files[absPath];
          state.last_updated = new Date().toISOString();
        }
        state.schema_version = "2.0";
      });

      // 如果项目有其他错误，记录但不阻塞
      if (result.diagnostic_status === "target_clean_project_dirty") {
        writeLog(PLUGIN_NAME, "WARN", {
          sessionID,
          callID: input?.callID,
          event: "TSC-CHECK-PROJECT-DIRTY",
          detail: `${absPath} clean but project has other TS errors`,
        });
      }
    }
  }
}

// ── Layer 1.5: AFTER write — 运行 tsc, 更新 diagnostic_state ──

async function afterWriteTscCheck(input: any, _output: any): Promise<void> {
  if (!isModifyTool(input?.tool)) return;

  const args = input?.args || {};
  const targets = getTypeScriptWriteTargets(input.tool, args);
  if (targets.length === 0) return;

  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const sessionID = input?.sessionID || "unknown";
  const config = getTscGateConfig();

  for (const filePath of targets) {
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(projectRoot, filePath);

    // 1. 获取 tsc 运行互斥锁 (文件锁已在 before hook 中获取)
    const mutexAcquired = acquireTscMutex(sessionID, config.lock_timeout_ms);
    if (!mutexAcquired) {
      // 等待互斥锁
      const maxWait = config.timeout_ms;
      const startTime = Date.now();
      while (Date.now() - startTime < maxWait) {
        if (acquireTscMutex(sessionID, config.lock_timeout_ms)) break;
        await sleep(100);
      }
    }

    // 2. 运行 tsc
    logTscGateEvent({
      session_id: sessionID,
      file_path: absPath,
      event_type: "TSC-CHECK-START",
      detail: "after-write",
    });

    const result = runTscDiagnostic(absPath, projectRoot);

    // 3. 释放 tsc 互斥锁
    releaseTscMutex(sessionID);

    // 4. 更新 diagnostic_state
    atomicWriteSubState("diagnostic_state", (state: any) => {
      state.files = state.files || {};
      if (result.pass && !result.errors?.length) {
        // tsc 通过或目标文件无错误 → 清除
        delete state.files[absPath];
      } else if (result.errors && result.errors.length > 0) {
        // 目标文件有错误 → 记录
        state.files[absPath] = {
          errors: result.errors,
          updated_at: new Date().toISOString(),
          source: "after-write-gate",
          session_id: sessionID,
        };
      }
      state.last_updated = new Date().toISOString();
      state.schema_version = "2.0";
    });

    // 5. 记录审计事件
    if (result.errors && result.errors.length > 0) {
      logTscGateEvent({
        session_id: sessionID,
        file_path: absPath,
        event_type: "TSC-CHECK-FAIL",
        error_count: result.errors.length,
        elapsed_ms: result.elapsed,
        detail: result.errors
          .slice(0, config.max_errors_shown)
          .map((e) => `L${e.line}: ${e.message} (TS${e.code})`)
          .join("; "),
      });
    } else {
      logTscGateEvent({
        session_id: sessionID,
        file_path: absPath,
        event_type: "TSC-CHECK-PASS",
        elapsed_ms: result.elapsed,
        detail: result.diagnostic_status || "clean",
      });
    }

    // 6. 释放文件锁
    releaseFileLock(absPath, sessionID);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### 2.3 baseline-diagnostic.ts 重构

**变更**: 移除 `compareWithBaseline()` 的豁免逻辑，保留 `captureBaseline()` 用于进度追踪

```typescript
// baseline-diagnostic.ts v2 变更说明

// REMOVED: compareWithBaseline() — 不再用于 gate 判定
// KEPT: captureBaseline() — 仍用于进度追踪
// KEPT: recordBaselineDrift() — 仍用于可观测性 (advisory only)

// compareWithBaseline() 的 verdict 仍可用于日志输出，但不影响 gate 阻塞决策
// gate 阻塞决策只基于: 目标文件是否有任何 TSC error (零容忍)
```

### 2.4 gate-core.ts 适配

**变更**: `compliance_gate` 中的 diagnostic 检查适配 v2

```typescript
// gate-core.ts 变更

// BEFORE (v1): 只检查 write_audit_state 中的文件是否有 diagnostic_state 错误
// AFTER (v2): 检查 diagnostic_state.files 中所有文件的错误
//   - 如果任何文件有错误，gate 返回 "recoverable"
//   - Agent 必须修复所有被修改过的文件的 TSC 错误

// submitDeliverables 中的检查 (L1257-1283):
//   - 保持只检查 task 相关文件 (write_audit_state.current_session.files_written)
//   - 但不再与 baseline 比较，直接检查 diagnostic_state.files[absPath].errors

// checkMachineCleanliness (L2030-2041):
//   - 保持现有逻辑: 如果 diagnostic_state.files 有任何错误 → dirty
//   - 这影响 compliance_gate_complete 的最终检查
```

---

## 3. 实现步骤 (TDD)

### 3.1 RED 阶段 — 测试先行

**测试文件**: `.opencode/lib/__tests__/tsc-diag-track-v2.test.ts`

**测试用例**:

| #   | 测试场景                                    | 预期结果                                               |
| --- | ------------------------------------------- | ------------------------------------------------------ |
| T1  | before hook: 目标文件有 TSC 错误            | `throw [FW-ENFORCE][TSC-ERROR-BLOCK]`                  |
| T2  | before hook: 目标文件无 TSC 错误            | 允许写入 (不 throw)                                    |
| T3  | before hook: 目标文件无错误但项目有其他错误 | 允许写入, 记录 `TSC-CHECK-PROJECT-DIRTY`               |
| T4  | before hook: tsc 超时                       | 记录 `TSC-CHECK-UNKNOWN`, advisory 不阻塞, strict 阻塞 |
| T5  | 文件锁: 不同 agent 修改同一文件             | 第二个 agent 被阻塞                                    |
| T6  | 文件锁: 不同 agent 修改不同文件             | 都成功获取锁                                           |
| T7  | 文件锁超时: 锁自动释放                      | 超时后新 agent 可获取锁                                |
| T8  | tsc 互斥锁: 同时只有一个 tsc 运行           | 第二个 tsc 等待                                        |
| T9  | after hook: 更新 diagnostic_state           | 文件错误写入 DB                                        |
| T10 | after hook: tsc 通过, 清除错误              | diagnostic_state.files 中该文件被删除                  |
| T11 | advisory 模式: 框架文件有错误               | 仍然阻塞                                               |
| T12 | advisory 模式: 非框架文件有错误             | 警告但不阻塞                                           |

### 3.2 GREEN 阶段 — 实现使测试通过

1. 创建 `.opencode/lib/tsc-gate-db.ts` (文件锁 + 事件管理)
2. 创建 `.opencode/lib/tsc-gate-config.ts` (配置读取)
3. 重写 `.opencode/plugins/tsc-diag-track.ts` (核心 gate 逻辑)
4. 更新 `.opencode/lib/db-manager.ts` (新增表 schema)
5. 更新 `.opencode/lib/substate-types.ts` (diagnostic_state schema v2)

### 3.3 REFACTOR 阶段

1. 重构 `.opencode/lib/baseline-diagnostic.ts` (移除豁免逻辑)
2. 更新 `.opencode/lib/gate-core.ts` (适配 v2)
3. 更新 `.opencode/project.config.json` (新增配置项)
4. 更新 `.opencode/scripts/framework-self-test.ts` (新增 v2 检查)

---

## 4. Migration 计划

### 4.1 Schema 迁移

```sql
-- 在 db-manager.ts 的 schema migration 中添加:

CREATE TABLE IF NOT EXISTS tsc_gate_locks (
  file_path TEXT NOT NULL,
  session_id TEXT NOT NULL,
  locked_at INTEGER NOT NULL,
  lock_type TEXT NOT NULL DEFAULT 'file_write',
  PRIMARY KEY (file_path)
);

CREATE TABLE IF NOT EXISTS tsc_gate_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT,
  file_path TEXT NOT NULL,
  event_type TEXT NOT NULL,
  error_count INTEGER DEFAULT 0,
  elapsed_ms INTEGER,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tsc_gate_events_session ON tsc_gate_events(session_id);
CREATE INDEX IF NOT EXISTS idx_tsc_gate_events_file ON tsc_gate_events(file_path);
CREATE INDEX IF NOT EXISTS idx_tsc_gate_events_type ON tsc_gate_events(event_type);
```

### 4.2 数据迁移

1. 清空 `diagnostic_state.files` (v1 缓存不适用于 v2)
2. 设置 `diagnostic_state.schema_version` = `"2.0"`
3. 保留 `diagnostic_baseline` (用于进度追踪)
4. `tsc_gate_locks` 和 `tsc_gate_events` 表为空 (新创建)

### 4.3 配置迁移

在 `project.config.json.template_resolution` 中新增:

```json
{
  "tsc_gate_mode": "zero-tolerance",
  "tsc_gate_timeout_ms": 30000,
  "tsc_gate_lock_timeout_ms": 60000,
  "tsc_gate_block_on_all_errors": true,
  "tsc_gate_max_errors_shown": 5
}
```

---

## 5. 风险评估

| 风险                               | 严重性 | 缓解措施                                                    |
| ---------------------------------- | ------ | ----------------------------------------------------------- |
| tsc 运行慢 (每次写入 2-5 秒)       | 中     | 使用 `--incremental` + `--tsBuildInfoFile` 加速; 可配置超时 |
| 文件锁死锁 (agent 崩溃)            | 低     | 锁超时自动释放 (默认 60 秒)                                 |
| 并行 agent tsc 等待                | 中     | tsc 互斥锁 + 轮询等待; 不同文件不互相阻塞                   |
| 374 个 baseline 错误需要清理       | 高     | v2 要求所有被修改的文件必须 0 错误; baseline 只用于进度追踪 |
| 旧代码依赖 `compareWithBaseline()` | 中     | 保留函数但移除豁免逻辑; 更新所有调用方                      |

---

## 6. 验收标准

- [ ] T1-T12 测试全部通过
- [ ] `framework-self-test.ts` v2 检查通过
- [ ] 修改有 TSC 错误的文件时被阻塞
- [ ] 修改无 TSC 错误的文件时不被阻塞
- [ ] 并行修改不同文件时不会互相阻塞
- [ ] 并行修改同一文件时第二个 agent 被阻塞
- [ ] `compliance_gate_complete` 检查 `diagnostic_state` 中是否有错误
- [ ] 审计事件记录在 `tsc_gate_events` 表中
- [ ] 所有日志通过 `writeLog()` 写入统一日志

---

## 7. 相关文档

| 文档                                                 | 关系                                             |
| ---------------------------------------------------- | ------------------------------------------------ |
| `lsp-diagnostic-gate-implementation-plan.md`         | v1 方案 (baseline-diff 模型)，本方案取代         |
| `lsp-diagnostic-gate-e2e-acceptance-gaps.md`         | E2E 验收缺口，本方案解决 GAP 1/3/8               |
| `g7-ts-baseline-cleanup-plan.md`                     | G-7 baseline 清理，v2 保留 baseline 用于进度追踪 |
| `framework-tsc-tdd-feasibility-analysis-20260626.md` | TSC TDD 可行性分析                               |
| `UC7KS-PIPELINE-STANDARD.md`                         | UC7KS 知识管道 (与 TSC gate 无直接关系但需对齐)  |
| `enforcement-modes-standard.md`                      | advisory/strict/locked 模式定义                  |
| `state-machine-standard.md`                          | 状态机标准                                       |
| `TEMPLATE_VARIABLE_STANDARD.md`                      | 模板变量标准 (新增 `tsc_gate_*` 配置项)          |
