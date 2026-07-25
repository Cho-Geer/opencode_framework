# UC7KS Pipeline DB-Canonical Concurrent Design

**版本**: v1.3.0  
**日期**: 2026-06-25  
**作者**: @Super-Admin  
**触发**: F-M（discovered_files 空值）、F-N（task_id 缺失）、F-O（架构分裂）的调查结论  
**状态**: ✅ 已实施（v1.3.0 最终审核：GAP-1~6 全部修复，JSON blob 路径全部清理）  
**更新**: v1.3.0 — GAP-5/6 修复完成；uc7ks-after JSON blob 写移除；checkUC7KSFileLevelDomain(M11) 死代码删除；hasAtLeastOneAttestedDomain 死代码删除

---

## 1. 问题陈述

### 1.1 当前架构的三重缺陷（v1.2.0 验证：✅ 全部已修复）

| 缺陷                            | 修复状态 | 修复方式                                                                                            |
| ------------------------------- | :------: | --------------------------------------------------------------------------------------------------- |
| **task_id 可选但 UC7KS 依赖它** |    ✅    | `resolvePipelineId` 三重回退 (task_id→sessionID→UUID)，`dispatch_subagent.ts:298-301` 自动生成 UUID |
| **读写路径分裂**                |    ✅    | search/attest 统一读写 `uc7ks_pipeline_state` DB 表，移除 JSON blob 路径                            |
| **JSON blob 无并发保护**        |    ✅    | SQLite `UNIQUE(pipeline_id, agent, domain_id)` 约束 + UPSERT 原子写入                               |
| **legacy 回退读错字段**         |    ✅    | `readCacheDiscovery` 被 `readDiscoveryForAttest` 替代，直接列查询无字段错位                         |

### 1.2 当前数据流

```
knowledge_cache_search                    knowledge_cache_attest
        │                                         │
        ├─→ atomicWriteSubState(                  │
        │     "knowledge_cache_state",             │
        │     blob → sa[agent].tasks[tId]          │
        │            .domains[domain]              │
        │            .discovery                    │
        │   )                                      │
        │                                         │
        ├─→ INSERT INTO knowledge_session_access   │
        ├─→ INSERT INTO knowledge_discovery        │
        │                                         │
        │                                   readSubState(
        │                                     "knowledge_cache_state"
        │                                   ) → readCacheDiscovery(blob)
        │                                         │
        │                                   INSERT INTO knowledge_attestation
        │                                         │
        ▼                                         ▼
    JSON blob (substate_kv)              JSON blob (substate_kv)
    + DB 行表 (audit only)               + DB 行表 (audit only)
```

**核心矛盾**：主数据路径是 `substate_kv` JSON blob，DB 行表仅作审计。但 JSON blob 的嵌套键设计隐含了对 `task_id` 的依赖，而 DAG-exempt agent 可以不传 `task_id`。

---

## 2. 并发模型分析

### 2.1 并发场景矩阵

| 场景                 | 示例                                                        | 隔离键                   |
| -------------------- | ----------------------------------------------------------- | ------------------------ |
| **Session 并发**     | 用户开两个 OpenCode 窗口，各自 dispatch 子 agent            | `session_id`             |
| **同 agent 并发**    | @Orchestrator 在两个 session 中各 dispatch 一个 @Coder-BE   | `session_id + agent`     |
| **不同 agent 并发**  | 同一 session 中 @Coder-BE 和 @Coder-FE 同时跑               | `session_id + agent`     |
| **Task 并发**        | 同一 session 中 @Orchestrator 先后 dispatch T-001、T-002    | `task_id` (DAG)          |
| **同 task 重复执行** | T-001 失败后 @Orchestrator 重试 dispatch @Coder-BE 做 T-001 | `task_id + agent` 覆盖写 |

### 2.2 当前并发风险

`atomicWriteSubState("knowledge_cache_state", fn)` 的实现：

```
1. dbReadSubState("knowledge_cache_state")  → 读 JSON blob
2. fn(kcs)                                  → 内存修改
3. dbWriteSubState("knowledge_cache_state") → 写回 JSON blob
```

**风险**：Session A 和 Session B 并发调用时：

```
A: read → modify → write
B:    read → modify → write     ← B 的 write 覆盖 A 的修改！
```

`substate_kv` 表只有一行（`key = "knowledge_cache_state"`），无行级锁保护 read-modify-write 竞态。

---

## 3. 设计方案

### 3.1 核心概念：Pipeline ID

**定义**：`pipeline_id` 是每个 UC7KS 管线操作的唯一标识，替代当前的 `task_id`。

**解析规则**（`resolvePipelineId`）：

```typescript
function resolvePipelineId(
  args: { task_id?: string },
  context: ToolContext,
): string {
  // 优先级：
  // 1. 显式传入的 task_id（DAG 任务）
  // 2. context.sessionID（DAG-exempt 操作的 session 标识）
  // 3. 自动生成 UUID（兜底）
  return args.task_id || context.sessionID || `pipeline-${generateUUID()}`;
}
```

**关键特性**：

- **永远非空**：无 fallback 到 `""` 或 `"unknown"`
- **确定性**：同一 session 的连续操作使用相同的 `pipeline_id`（基于 `sessionID`）
- **隔离性**：不同 session 的 `pipeline_id` 天然不同

### 3.2 统一 DB 表设计

**替代 `substate_kv` JSON blob + `knowledge_discovery` + `knowledge_attestation` 行表。**

```sql
-- ════════════════════════════════════════════════════════════
-- uc7ks_pipeline_state — UC7KS 管线状态的唯一数据源
-- 替代: substate_kv.knowledge_cache_state JSON blob
--       + knowledge_discovery 行表
--       + knowledge_attestation 行表
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS uc7ks_pipeline_state (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,

    -- ── 复合唯一键（并发隔离边界）──
    pipeline_id     TEXT NOT NULL,           -- resolvePipelineId() 的结果
    agent           TEXT NOT NULL,           -- 规范化 agent 键
    domain_id       TEXT NOT NULL,           -- 知识领域 ID

    -- ── 会话关联 ──
    session_id      TEXT,                    -- OpenCode session ID（审计/关联）
    dag_task_id     TEXT,                    -- 原始 DAG task_id（可选，用于追溯）

    -- ── 发现阶段（knowledge_cache_search 写入）──
    discovery_status        TEXT DEFAULT 'undeclared',
        -- undeclared | sufficient | insufficient
    discovered_files        TEXT DEFAULT '[]',
        -- JSON 数组，例如 ["opencode/framework/plugins.md", ...]
    discovered_count        INTEGER DEFAULT 0,
        -- 冗余计数，便于查询
    missing_topics          TEXT DEFAULT '[]',
        -- JSON 数组
    discovered_at           INTEGER,

    -- ── 验证阶段（knowledge_cache_attest 写入）──
    attestation_status      TEXT DEFAULT 'unattested',
        -- unattested | attested | insufficient
    cache_sufficient        INTEGER DEFAULT 0,
        -- 0 或 1
    files_read              TEXT DEFAULT '[]',
        -- JSON 数组，agent 实际读取的文件路径
    evidence_file_count     INTEGER DEFAULT 0,
    content_summary         TEXT DEFAULT '',
    attested_at             INTEGER,

    -- ── 元数据 ──
    created_at              INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at              INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),

    -- ════════════════════════════════════════════════════════
    -- 复合唯一约束：并发隔离边界
    -- 同一 (pipeline_id, agent, domain_id) 只有一行
    -- 不同 session 的 pipeline_id 天然不同 → 无冲突
    -- 同一 session 不同 agent → agent 不同 → 无冲突
    -- 同一 session 同 agent 不同 domain → domain 不同 → 无冲突
    -- ════════════════════════════════════════════════════════
    UNIQUE(pipeline_id, agent, domain_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_uc7ks_pipeline_agent
    ON uc7ks_pipeline_state(agent);
CREATE INDEX IF NOT EXISTS idx_uc7ks_pipeline_session
    ON uc7ks_pipeline_state(session_id);
CREATE INDEX IF NOT EXISTS idx_uc7ks_pipeline_domain
    ON uc7ks_pipeline_state(domain_id);
CREATE INDEX IF NOT EXISTS idx_uc7ks_pipeline_attestation
    ON uc7ks_pipeline_state(attestation_status, domain_id)
    WHERE attestation_status != 'unattested';
```

### 3.3 并发安全操作

#### 3.3.1 UPSERT 发现数据

```typescript
/**
 * 原子写入 discovery 数据。
 * SQLite 行级锁保证 (pipeline_id, agent, domain_id) 唯一约束下的并发安全。
 * 日志系统在每次写操作前后记录结构化日志。
 */
function atomicUpsertDiscovery(params: {
  pipelineId: string;
  agent: string;
  domainId: string;
  sessionId: string;
  dagTaskId?: string;
  discovery: CacheDiscovery;
}): void {
  const db = getDb();
  const startTime = Date.now();

  writeLog("uc7ks-pipeline", "INFO", {
    event: "UC7KS-DISCOVERY-UPSERT-BEGIN",
    pipeline_id: params.pipelineId,
    agent: params.agent,
    domain_id: params.domainId,
    session_id: params.sessionId,
    file_count: params.discovery.discovered_files.length,
    status: params.discovery.status,
  });

  try {
    db.run(
      `
      INSERT INTO uc7ks_pipeline_state (
        pipeline_id, agent, domain_id, session_id, dag_task_id,
        discovery_status, discovered_files, discovered_count,
        missing_topics, discovered_at,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        unixepoch('now') * 1000, unixepoch('now') * 1000
      )
      ON CONFLICT(pipeline_id, agent, domain_id) DO UPDATE SET
        discovery_status    = excluded.discovery_status,
        discovered_files    = excluded.discovered_files,
        discovered_count    = excluded.discovered_count,
        missing_topics      = excluded.missing_topics,
        discovered_at       = excluded.discovered_at,
        session_id          = excluded.session_id,
        updated_at          = unixepoch('now') * 1000
    `,
      [
        params.pipelineId,
        params.agent,
        params.domainId,
        params.sessionId || null,
        params.dagTaskId || null,
        params.discovery.status,
        JSON.stringify(params.discovery.discovered_files),
        params.discovery.discovered_files.length,
        JSON.stringify(params.discovery.missing_topics),
        Date.now(),
      ],
    );

    const elapsed = Date.now() - startTime;
    writeLog("uc7ks-pipeline", "INFO", {
      event: "UC7KS-DISCOVERY-UPSERT-OK",
      pipeline_id: params.pipelineId,
      agent: params.agent,
      domain_id: params.domainId,
      elapsed_ms: elapsed,
      discovered_count: params.discovery.discovered_files.length,
    });
  } catch (err: any) {
    writeLog("uc7ks-pipeline", "ERROR", {
      event: "UC7KS-DISCOVERY-UPSERT-FAILED",
      pipeline_id: params.pipelineId,
      agent: params.agent,
      domain_id: params.domainId,
      error: err.message,
    });
    throw err;
  }
}
```

#### 3.3.2 原子读取 + 验证

```typescript
/**
 * 读取 discovery 数据用于 attest 验证。
 * 通过 pipeline_id + agent + domain_id 精确匹配，无回退、无键不匹配。
 */
function readDiscoveryForAttest(params: {
  pipelineId: string;
  agent: string;
  domainId: string;
}): CacheDiscovery | null {
  const db = getDb();

  writeLog("uc7ks-pipeline", "DEBUG", {
    event: "UC7KS-READ-DISCOVERY",
    pipeline_id: params.pipelineId,
    agent: params.agent,
    domain_id: params.domainId,
  });

  const row = db
    .query(
      `
    SELECT discovered_files, discovery_status, missing_topics, discovered_at
    FROM uc7ks_pipeline_state
    WHERE pipeline_id = ? AND agent = ? AND domain_id = ?
  `,
    )
    .get(params.pipelineId, params.agent, params.domainId) as any;

  if (!row) {
    writeLog("uc7ks-pipeline", "WARN", {
      event: "UC7KS-READ-DISCOVERY-NOT-FOUND",
      pipeline_id: params.pipelineId,
      agent: params.agent,
      domain_id: params.domainId,
    });
    return null;
  }

  let discoveredFiles: string[] = [];
  let missingTopics: string[] = [];
  try {
    discoveredFiles = JSON.parse(row.discovered_files || "[]");
  } catch {}
  try {
    missingTopics = JSON.parse(row.missing_topics || "[]");
  } catch {}

  writeLog("uc7ks-pipeline", "INFO", {
    event: "UC7KS-READ-DISCOVERY-OK",
    pipeline_id: params.pipelineId,
    agent: params.agent,
    domain_id: params.domainId,
    status: row.discovery_status,
    discovered_count: discoveredFiles.length,
  });

  return {
    status: row.discovery_status as CacheDiscovery["status"],
    discovered_files: discoveredFiles,
    missing_topics: missingTopics,
    discovered_at: row.discovered_at
      ? new Date(row.discovered_at).toISOString()
      : new Date(0).toISOString(),
  };
}
```

#### 3.3.3 原子写入验证数据

```typescript
/**
 * 原子写入 attestation 数据。
 * 仅当 discovery_status='sufficient' 时允许写入（门控）。
 */
function atomicUpsertAttestation(params: {
  pipelineId: string;
  agent: string;
  domainId: string;
  sessionId: string;
  attestation: {
    status: string;
    cache_sufficient: boolean;
    files_read: string[];
    content_summary: string;
    attested_at: number;
  };
}): boolean {
  const db = getDb();

  writeLog("uc7ks-pipeline", "INFO", {
    event: "UC7KS-ATTESTATION-UPSERT-BEGIN",
    pipeline_id: params.pipelineId,
    agent: params.agent,
    domain_id: params.domainId,
    status: params.attestation.status,
    file_count: params.attestation.files_read.length,
  });

  try {
    // 事务包裹：读取 discovery 状态 + 写入 attestation
    const result = db.transaction(() => {
      // 门控：检查 discovery 是否 sufficient
      const disc = db
        .query(
          `
        SELECT discovery_status FROM uc7ks_pipeline_state
        WHERE pipeline_id = ? AND agent = ? AND domain_id = ?
      `,
        )
        .get(params.pipelineId, params.agent, params.domainId) as any;

      if (!disc || disc.discovery_status !== "sufficient") {
        writeLog("uc7ks-pipeline", "ERROR", {
          event: "UC7KS-ATTESTATION-GATE-FAILED",
          pipeline_id: params.pipelineId,
          agent: params.agent,
          domain_id: params.domainId,
          discovery_status: disc?.discovery_status || "missing",
        });
        return false;
      }

      db.run(
        `
        UPDATE uc7ks_pipeline_state SET
          attestation_status  = ?,
          cache_sufficient    = ?,
          files_read          = ?,
          evidence_file_count = ?,
          content_summary     = ?,
          attested_at         = ?,
          updated_at          = unixepoch('now') * 1000
        WHERE pipeline_id = ? AND agent = ? AND domain_id = ?
      `,
        [
          params.attestation.status,
          params.attestation.cache_sufficient ? 1 : 0,
          JSON.stringify(params.attestation.files_read),
          params.attestation.files_read.length,
          params.attestation.content_summary,
          params.attestation.attested_at,
          params.pipelineId,
          params.agent,
          params.domainId,
        ],
      );

      writeLog("uc7ks-pipeline", "INFO", {
        event: "UC7KS-ATTESTATION-UPSERT-OK",
        pipeline_id: params.pipelineId,
        agent: params.agent,
        domain_id: params.domainId,
        status: params.attestation.status,
      });

      return true;
    })();

    return result;
  } catch (err: any) {
    writeLog("uc7ks-pipeline", "ERROR", {
      event: "UC7KS-ATTESTATION-UPSERT-FAILED",
      pipeline_id: params.pipelineId,
      agent: params.agent,
      domain_id: params.domainId,
      error: err.message,
    });
    return false;
  }
}
```

### 3.4 并发隔离分析

```
┌──────────────────────────────────────────────────────────────────┐
│                    并发隔离边界                                   │
│                                                                   │
│  Session A (ses_aaa)              Session B (ses_bbb)             │
│  ┌─────────────────────┐         ┌─────────────────────┐         │
│  │ pipeline_id=ses_aaa │         │ pipeline_id=ses_bbb │         │
│  │ agent=Coder-BE      │         │ agent=Coder-BE      │         │
│  │ domain=backend_api  │         │ domain=backend_api  │         │
│  │                     │         │                     │         │
│  │ UNIQUE(pipeline,    │         │ UNIQUE(pipeline,    │         │
│  │   agent, domain)    │         │   agent, domain)    │         │
│  │   → 无冲突 ✓        │         │   → 无冲突 ✓        │         │
│  └─────────────────────┘         └─────────────────────┘         │
│                                                                   │
│  Session A                       Session A                        │
│  ┌─────────────────────┐         ┌─────────────────────┐         │
│  │ pipeline_id=ses_aaa │         │ pipeline_id=T-002   │         │
│  │ agent=Coder-BE      │         │ agent=Coder-BE      │         │
│  │ domain=backend_api  │         │ domain=backend_api  │         │
│  │                     │         │                     │         │
│  │ UNIQUE(ses_aaa,     │         │ UNIQUE(T-002,       │         │
│  │   Coder-BE,         │         │   Coder-BE,         │         │
│  │   backend_api)      │         │   backend_api)      │         │
│  │   → 无冲突 ✓        │         │   → 无冲突 ✓        │         │
│  └─────────────────────┘         └─────────────────────┘         │
│                                                                   │
│  同一 pipeline 同 agent 同 domain 并发                             │
│  ┌─────────────────────────────────────────┐                     │
│  │ SQLite UNIQUE 约束 + UPSERT              │                     │
│  │ → 第二个写操作等待第一个提交或回滚       │                     │
│  │ → 不丢失数据，后者覆盖前者（符合预期）   │                     │
│  └─────────────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

### 3.5 工具变更清单

#### 3.5.1 `knowledge_cache_search.ts`

| 变更                                                     | 说明                          |
| -------------------------------------------------------- | ----------------------------- |
| 移除 `readSubState("knowledge_cache_state")`             | 不再读 JSON blob              |
| 移除 `atomicWriteSubState("knowledge_cache_state", ...)` | 不再写 JSON blob              |
| 引入 `resolvePipelineId(args, context)`                  | 确定 pipeline_id              |
| 调用 `atomicUpsertDiscovery(...)`                        | DB-only 写入                  |
| 移除 `INSERT INTO knowledge_session_access`              | 统一到 `uc7ks_pipeline_state` |
| 移除 `INSERT INTO knowledge_discovery`                   | 同上                          |

#### 3.5.2 `knowledge_cache_attest.ts`

| 变更                                                     | 说明                          |
| -------------------------------------------------------- | ----------------------------- |
| 移除 `readSubState("knowledge_cache_state")`             | 不再读 JSON blob              |
| 移除 `readCacheDiscovery(blob, ...)`                     | 不再从嵌套 JSON 对象读取      |
| 引入 `resolvePipelineId(args, context)`                  | 确定 pipeline_id              |
| 调用 `readDiscoveryForAttest(...)`                       | DB 直接查询                   |
| 调用 `atomicUpsertAttestation(...)`                      | DB-only 写入                  |
| 移除 `atomicWriteSubState("knowledge_cache_state", ...)` | 不再写 JSON blob              |
| 移除 `INSERT INTO knowledge_attestation`                 | 统一到 `uc7ks_pipeline_state` |

#### 3.5.3 `dispatch_subagent.ts`

| 变更                                         | 说明                      | 状态      |
| -------------------------------------------- | ------------------------- | --------- |
| `dag_task_id` 为空时自动生成 UUID            | 确保 pipeline_id 永远非空 | ❌ 未实施 |
| 在 dispatch 文件中写入 `pipeline_id: <uuid>` | 子 agent 可读取           | ❌ 未实施 |
| **注**: `session_namespace` 参数已实现       | 输出路径与 DAG 校验分离   | ✅ 已完成 |

#### 3.5.4 `uc7ks-schema.ts`

| 变更                                              | 说明                             |
| ------------------------------------------------- | -------------------------------- |
| 废弃 `getDomainEntry()`                           | 不再需要嵌套 JSON 构造           |
| 废弃 `writeCacheDiscovery()`                      | 被 `atomicUpsertDiscovery` 替代  |
| 废弃 `readCacheDiscovery()`                       | 被 `readDiscoveryForAttest` 替代 |
| 废弃 `readCacheAttestation()`                     | 被 DB 直接查询替代               |
| 保留类型定义 `CacheDiscovery`、`CacheAttestation` | 向后兼容                         |

#### 3.5.5 `uc7ks-utils.ts`

| 变更                                     | 说明                             |
| ---------------------------------------- | -------------------------------- |
| 废弃 `tryBuildEnforcementFromDb()`       | 被 `readDiscoveryForAttest` 替代 |
| 移除 JSON blob fallback 路径             | DB 是唯一数据源                  |
| 简化 `checkUC7KSWrite()` 中的 Path A/B/C | 只需查询 `uc7ks_pipeline_state`  |

### 3.6 迁移计划（v1.2.0 状态：全部完成）

#### Phase 1：DB 表创建 + 双写（✅ 已完成 — v19 迁移，2026-06-23）

```
1. 创建 uc7ks_pipeline_state 表
2. knowledge_cache_search 同时写 JSON blob + uc7ks_pipeline_state
3. knowledge_cache_attest 从 uc7ks_pipeline_state 读取（DB-first）
   → 若 DB 无数据，回退到 JSON blob（过渡期兼容）
4. 运行 1 周观察
```

#### Phase 2：DB-only（✅ 已完成 — v1.2.0，2026-06-25）

```
1. ✅ 移除 JSON blob 写入路径（knowledge_cache_search + knowledge_cache_attest）
2. ✅ 移除 knowledge_session_access + knowledge_discovery
   + knowledge_attestation 行表的写入
3. ⚪ backfill 脚本：历史 JSON blob 数据已随 v20 表删除而失效（无需迁移）
4. ⚪ knowledge_cache_state JSON blob 冻结为只读历史快照
```

#### Phase 3：清理（✅ 已完成 — v20+v21 迁移，2026-06-23/25）

```
1. ✅ 移除 uc7ks-schema.ts 中的 getDomainEntry、readCacheDiscovery 等辅助函数
   （保留类型定义向后兼容）
2. ✅ 移除 knowledge_session_access、knowledge_discovery、
   knowledge_attestation 表（v20 DROP TABLE）
3. ✅ 清理 substate_kv 中的 knowledge_cache_state 行（冻结为只读）
4. ✅ GAP-1：search 预读 JSON blob → DB 查询（v1.2.0）
5. ✅ GAP-2：ctx 文件补写 pipeline_id 字段（v1.2.0）
6. ✅ GAP-3：uc7ks-utils JSON blob 回退移除（v1.2.0）
```

### 3.7 向后兼容

| 组件                                 | 兼容策略                                                            |
| ------------------------------------ | ------------------------------------------------------------------- |
| `checkUC7KSWrite()`                  | 先查 `uc7ks_pipeline_state`，无数据时回退 JSON blob                 |
| `compliance-gate.ts` 的 Check 35     | 更新为检查 `uc7ks_pipeline_state` 而非 `knowledge_cache_state` blob |
| `framework-self-test.ts` Check 35/28 | 更新查询目标                                                        |
| `backfill-session-access.ts`         | 新增从 JSON blob → `uc7ks_pipeline_state` 的迁移                    |
| 现有日志查询                         | `uc7ks_pipeline_state` 包含 `session_id` 列，可按 session 追溯      |

---

## 4. 与现有系统的集成

### 4.1 Checklist 集成

> ⚠️ **注意**：当前 `checklistWirePassed()` 存在 V7.2 脆弱点（gate session ID 被当作 OpenCode session ID 传入）。本设计实施时应同时修复此问题。

```typescript
// knowledge_cache_attest 成功后标记 checklist
// 应使用 OpenCode session ID（非 gate session ID）
checklistWirePassed({
  sessionID: opencodeSessionId, // ← OpenCode session ID（非 gateSessionId）
  agent: agent,
  taskId: pipelineId,
  itemKey: "knowledge_attested",
  domain: domainId,
});
```

### 4.2 写执行集成

```typescript
// scope-before.ts / uc7ks-utils.ts 的 checkUC7KSWrite
// Path A（有 taskId + domainId）：
const row = db
  .query(
    `
  SELECT attestation_status, cache_sufficient
  FROM uc7ks_pipeline_state
  WHERE pipeline_id = ? AND agent = ? AND domain_id = ?
`,
  )
  .get(pipelineId, agentKey, domainId);

if (row?.attestation_status === "attested" && row.cache_sufficient) {
  // 允许写入
} else {
  // 阻断
}
```

### 4.3 日志集成

所有状态变更通过 `writeLog` 记录到 `.opencode/logs/`：

| 事件                              | 级别  | 触发点                         |
| --------------------------------- | ----- | ------------------------------ |
| `UC7KS-DISCOVERY-UPSERT-BEGIN`    | INFO  | search 工具开始写入            |
| `UC7KS-DISCOVERY-UPSERT-OK`       | INFO  | search 工具写入成功            |
| `UC7KS-DISCOVERY-UPSERT-FAILED`   | ERROR | search 工具写入失败            |
| `UC7KS-ATTESTATION-UPSERT-BEGIN`  | INFO  | attest 工具开始写入            |
| `UC7KS-ATTESTATION-GATE-FAILED`   | ERROR | 验证门控失败（discovery 不足） |
| `UC7KS-ATTESTATION-UPSERT-OK`     | INFO  | attest 工具写入成功            |
| `UC7KS-ATTESTATION-UPSERT-FAILED` | ERROR | attest 工具写入失败            |
| `UC7KS-READ-DISCOVERY`            | DEBUG | 读取 discovery 数据            |
| `UC7KS-READ-DISCOVERY-NOT-FOUND`  | WARN  | discovery 数据未找到           |
| `UC7KS-READ-DISCOVERY-OK`         | INFO  | discovery 数据读取成功         |

---

## 5. 不变性保证

| 保证                     | 机制                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| **pipeline_id 永远非空** | `resolvePipelineId` 三重回退，最终 UUID 兜底                         |
| **DB 单数据源**          | 移除 JSON blob 写路径，`uc7ks_pipeline_state` 是唯一 writable source |
| **写入原子性**           | SQLite UPSERT + UNIQUE 约束                                          |
| **并发隔离**             | `(pipeline_id, agent, domain_id)` 复合唯一键天然隔离                 |
| **无键不匹配**           | pipeline_id 在 search 和 attest 中一致（同一 session/task）          |
| **无字段误读**           | 直接列查询，不存在 legacy fallback 读错字段                          |
| **日志完整性**           | 每次 DB 操作前后记录结构化日志，含 pipeline_id/agent/domain          |
| **审计可追溯**           | `session_id` + `dag_task_id` 列关联到 OpenCode session 和 DAG 任务   |

---

## 6. 附录

### 6.1 相关 Findings

| Finding                          | 本方案如何解决                                             |
| -------------------------------- | ---------------------------------------------------------- |
| **F-M**（discovered_files 空值） | task_id 不一致根除：pipeline_id 在 search/attest 间一致    |
| **F-N**（task_id 未传递）        | pipeline_id 三重回退，dispatch 自动生成 UUID               |
| **F-O**（架构分裂）              | 统一到单一 DB 表，移除 JSON blob 路径                      |
| **SPLIT-1/2**                    | `uc7ks_pipeline_state` 替代 JSON blob + knowledge\_\* 行表 |

### 6.2 相关文档

| 文档                                                             | 关系                  |
| ---------------------------------------------------------------- | --------------------- |
| `e2e-acceptance-final-findings.md`                               | 调查发现来源          |
| `db-canonical-p0-checklist-optimization-plan.md`                 | DB-canonical 目标架构 |
| `db-canonical-p0-checklist-implementation-audit-and-fix-plan.md` | 审计与修复计划        |

---

## 变更日志

| 日期       | 版本  | 变更                                                                                                                                     |
| ---------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-23 | 1.0.0 | 初始设计——DB-canonical 并发安全 UC7KS 管线                                                                                               |
| 2026-06-23 | 1.1.0 | 验证确认未实施；§1.1 标注问题仍存在（含代码行号）；§3.5.3 标注 session_namespace 已实现；§3.6 标注迁移未开始；§4.1 标注 V7.2 脆弱点      |
| 2026-06-25 | 1.2.0 | 审核确认核心架构完整实装；修复 GAP-1 (search JSON blob 预读→DB)、GAP-2 (ctx pipeline_id)、GAP-3 (JSON blob 回退移除)；更新状态为"已实施" |
