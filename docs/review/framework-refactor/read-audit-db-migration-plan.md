# read_audit.jsonl → SQLite 迁移实施方案

**文档版本**: v1.2.0  
**制定日期**: 2026-06-18  
**本次复核**: 2026-06-18 23:50，本地框架更新后复审  
**作者**: @Super-Admin  
**状态**: v1.3.0 已实施完成/已全面验证
**关联文档**: [read-audit-db-migration-audit-report.md](./read-audit-db-migration-audit-report.md) | [storage-entity-landscape.md](./storage-entity-landscape.md) | [uc7ks-read-before-write-plan.md](./uc7ks-read-before-write-plan.md)

---

## 一、复审结论

旧版 v1.1.0 需要更新。原因不是 DB schema 设计本身不可行，而是框架已经新增 UC7KS read-before-write attestation，`read_audit.jsonl` 的职责从“审批前读 HANDOVER.md 的审计文件”扩大为两个强约束共同依赖的证据源：

1. READ-BEFORE-APPROVE：`compliance-gate.ts` 调用 `verifyRead(agent, handoverPath)`，验证审批者最近读过 `HANDOVER.md`。
2. UC7KS READ-BEFORE-WRITE：`knowledge_cache_attest.ts` 当前直接读取 `read_audit.jsonl`，按 OpenCode `sessionID` + agent 验证 cache 文件确实被读过。

因此，迁移必须覆盖 `recordRead()`、`verifyRead()`、`getReadEventsForSession()`、`normalizeReadAuditPath()` 以及 `knowledge_cache_attest.ts` 的直读 JSONL 路径。只改 `recordRead/verifyRead` 会让 UC7KS 继续依赖 JSONL，形成新的双源不一致。

---

## 二、当前事实快照

| 项 | 当前状态 |
|----|----------|
| DB schema | v9，当前尚无 `read_audit` 表 |
| DB 文件 | `.opencode/state/framework-state.db` |
| JSONL 文件 | `.opencode/state/read_audit.jsonl`，约 48 KB / 171 行 |
| `read-audit.ts` | 293 行，仍是 JSONL 主路径 |
| `knowledge_cache_attest.ts` | 344 行，当前内置 `readAuditLog()` 直接读 JSONL |
| `read-track-after.ts` | 72 行，调用 `recordRead(entry)` |
| `compliance-gate.ts` | `approve_deliverables` 调用 `verifyRead(resolvedAgent, resolvedHandoverPath)`，不传 gate session id |
| `framework-self-test.ts` | 已有 Check 39 = schema file integrity，新增 read-audit 检查不得复用 ST-39/40/41 的旧编号假设 |

关键语义修正：`ReadAuditEntry.sessionId` 记录的是 OpenCode session id（`ses_*`），不是 compliance gate session id（`cg_ses_*`）。旧版方案里“JOIN gate_sessions 验证 session_id 合法性”的设计是错误的，会重引入此前 `verifyRead()` sessionId mismatch 类 bug。

---

## 三、迁移目标

### 3.1 必须达成

1. 新增 SQLite `read_audit` 表，schema 版本升至 v10。
2. `recordRead()` Phase 1 双写：DB 写入优先，但 DB 失败时仍必须写 JSONL，避免 read 证据丢失。
3. `verifyRead()` DB-first；DB 异常时 Phase 1 降级到 JSONL。
4. `getReadEventsForSession()` DB-first；DB 异常时 Phase 1 降级到 JSONL。
5. `knowledge_cache_attest.ts` 删除内部 JSONL 读取/路径规范化副本，改用 `getReadEventsForSession()` 和 `normalizeReadAuditPath()`。
6. 迁移脚本能幂等导入现有 JSONL，重复运行不产生重复行。
7. self-test 新增不与现有编号冲突的 read-audit DB 检查。

### 3.2 暂不做

1. 不把 `Task.DAG.json` 或 gate compactor 索引纳入本任务。
2. 不在 `read_audit` 表上 JOIN `gate_sessions`，因为二者 session id 语义不同。
3. Phase 1 不删除 `read_audit.jsonl`。DB-only 与 JSONL 归档作为 Phase 2 单独执行。

---

## 四、SQLite Schema v10

### 4.1 表结构

使用 `opencode_session_id` 命名 DB 列，避免与 gate session 混淆。TypeScript API 仍保留 `sessionId` 字段名以兼容调用方。

```sql
-- v10: FW-READ-AUDIT-DB
CREATE TABLE IF NOT EXISTS read_audit (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key           TEXT    NOT NULL UNIQUE,
  timestamp           TEXT    NOT NULL,
  agent               TEXT    NOT NULL,
  file_path           TEXT    NOT NULL,
  opencode_session_id TEXT,
  task_id             TEXT,
  call_id             TEXT,
  raw_agent           TEXT,
  raw_file_path       TEXT,
  created_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_read_audit_lookup
  ON read_audit(agent, file_path, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_read_audit_session_agent
  ON read_audit(opencode_session_id, agent, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_read_audit_task
  ON read_audit(task_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_read_audit_created
  ON read_audit(created_at);
```

### 4.2 去重策略

旧版的 `UNIQUE(timestamp, agent, file_path)` 过窄：同一 agent 同一毫秒读取同一文件但来自不同 call/session 时会误判重复；同时 SQLite `UNIQUE` 对 NULL 字段语义容易踩坑。

本方案新增 `event_key`：

```typescript
event_key = sha256([
  timestamp,
  normalizeAgent(agent),
  normalizeReadAuditPath(filePath),
  sessionId || "",
  taskId || "",
  callId || "",
].join("\u001f"))
```

迁移脚本和运行时写入使用同一函数生成 `event_key`，配合 `INSERT OR IGNORE` 实现真正幂等。

### 4.3 字段映射

| JSONL 字段 | DB 列 | 说明 |
|------------|-------|------|
| `timestamp` | `timestamp` | 原始 ISO 8601 |
| `agent` | `agent` | 规范化：去 `@`、小写 |
| `agent` | `raw_agent` | 原始值，用于返回 `matchedEntry` |
| `filePath` | `file_path` | 规范化绝对路径、小写、去尾斜杠 |
| `filePath` | `raw_file_path` | 原始值，用于日志/回显 |
| `sessionId` | `opencode_session_id` | OpenCode `ses_*`，不是 gate `cg_ses_*` |
| `taskId` | `task_id` | DAG task id |
| `callId` | `call_id` | OpenCode tool call id |

---

## 五、代码改造方案

### 5.1 `.opencode/lib/db-manager.ts`

在 v9 后追加 v10 schema。`getDbHealth()` 不需要特殊改造，schema_version 最大值会自然变为 10。

`dbCleanStaleEntries()` 当前仍包含已删除 typed tables 的遗留清理列表，是否顺手加入 `read_audit` 不作为本迁移必需项。`read_audit` 的容量控制由 `recordRead()` 事务内 DELETE 负责。

### 5.2 `.opencode/lib/read-audit.ts`

保留现有公开接口，并扩展 DB-first 实现：

```typescript
export function recordRead(entry: ReadAuditEntry): void
export function verifyRead(agent: string, filePath: string, sessionId?: string): ReadVerifyResult
export function getReadEventsForSession(agent: string, sessionId: string): ReadAuditEntry[]
export function normalizeReadAuditPath(filePath: string): string
export { READ_MAX_AGE_MS, MAX_RECORDS }
```

Phase 1 的 `recordRead()` 必须分离 DB 写和 JSONL 写，不能把二者放在同一个外层 try 里：

```typescript
export function recordRead(entry: ReadAuditEntry): void {
  let dbOk = false;
  let jsonlOk = false;

  try {
    const db = getDb();
    db.transaction(() => {
      db.run(
        `INSERT OR IGNORE INTO read_audit
         (event_key, timestamp, agent, file_path, opencode_session_id, task_id, call_id, raw_agent, raw_file_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        toDbBindings(entry),
      );
      db.run(
        `DELETE FROM read_audit
         WHERE id NOT IN (SELECT id FROM read_audit ORDER BY id DESC LIMIT ?)`,
        [MAX_RECORDS],
      );
    })();
    dbOk = true;
  } catch (err: any) {
    writeLog(SRC, "ERROR", { event: "READ_AUDIT_DB_WRITE_FAILED", detail: err.message });
  }

  try {
    appendReadAuditJsonl(entry);
    cleanupOldRecordsJsonl();
    jsonlOk = true;
  } catch (err: any) {
    writeLog(SRC, "ERROR", { event: "READ_AUDIT_JSONL_WRITE_FAILED", detail: err.message });
  }

  if (!dbOk && !jsonlOk) {
    writeLog(SRC, "ERROR", { event: "READ_AUDIT_WRITE_FAILED_BOTH" });
  }
}
```

`verifyRead()` 的 session 参数只允许匹配 OpenCode session id。当前 `compliance-gate.ts` 不传第三参数，这是正确行为。不要在审批路径重新传入 `cg_ses_*`。

`getReadEventsForSession()` 必须迁入 DB-first，因为 UC7KS attestation 依赖它按 session + agent 收集 read 文件集合：

```sql
SELECT timestamp, raw_agent, raw_file_path, opencode_session_id, task_id, call_id
FROM read_audit
WHERE opencode_session_id = ? AND agent = ?
ORDER BY timestamp DESC
```

### 5.3 `.opencode/tools/knowledge_cache_attest.ts`

必须改造。旧版方案没有覆盖这里，是当前最大的缺口。

改造要求：

1. 删除本文件里的 `readAuditLog()`。
2. 删除本文件里的 `normalizePathForAudit()`，改用 `normalizeReadAuditPath()`。
3. 引入：

```typescript
import {
  getReadEventsForSession,
  normalizeReadAuditPath,
} from "../lib/read-audit";
```

4. Step 3 使用共享 API：

```typescript
const sessionEntries = getReadEventsForSession(agent, sessionId);
const readPaths = new Set(sessionEntries.map((e) => normalizeReadAuditPath(e.filePath)));
```

这样 Phase 1 时 UC7KS 自动获得 DB-first + JSONL fallback；Phase 2 移除 JSONL 时不需要再改 attestation 工具。

### 5.4 `.opencode/plugins/read-track-after.ts`

接口不变，原则上零修改。它继续调用 `recordRead({ timestamp, agent, filePath, sessionId, taskId, callId })`。

### 5.5 `.opencode/scripts/mcp-tools/compliance-gate.ts`

接口不变，原则上零修改。保持：

```typescript
verifyRead(resolvedAgent, resolvedHandoverPath)
```

不要改成：

```typescript
verifyRead(resolvedAgent, resolvedHandoverPath, sessionId)
```

`sessionId` 在这里是 compliance gate session id（`cg_ses_*`），和 read-track-after 记录的 OpenCode session id（`ses_*`）不一致。

---

## 六、迁移脚本

新增 `.opencode/scripts/migrate-read-audit.ts`。

要求：

1. 读取 `.opencode/state/read_audit.jsonl`。
2. 逐行 JSON.parse，损坏行跳过并记录 stderr。
3. 使用与运行时相同的 `normalizeAgent()`、`normalizeReadAuditPath()`、`makeEventKey()`。
4. 使用 `INSERT OR IGNORE` 写入 `read_audit`。
5. 输出 imported/skipped/errors/normMismatch/preCount/postCount。
6. 重复运行必须 skipped 增加、postCount 不重复膨胀。

迁移脚本可以直接复用 `read-audit.ts` 导出的 normalization/event-key helper；如果不导出 event-key helper，则脚本内实现必须保持完全一致，并用测试覆盖。

---

## 七、验证方案

### 7.1 正路验证

| 编号 | 验证项 | 预期 |
|------|--------|------|
| V1 | `bun .opencode/scripts/migrate-read-audit.ts` | 导入当前 JSONL，重复运行不重复 |
| V2 | `recordRead()` 后查询 DB 和 JSONL | Phase 1 两端均出现新记录 |
| V3 | `verifyRead(agent, path)` | DB-first 返回 `verified: true` |
| V4 | `getReadEventsForSession(agent, ses_*)` | 返回该 OpenCode session 的 read 事件 |
| V5 | `knowledge_cache_attest` Step 3 | 通过共享 read-audit API 验证，不再直读 JSONL |
| V6 | CJS require | `require("./.opencode/lib/read-audit")` 返回 `recordRead/verifyRead/getReadEventsForSession` 函数 |
| V7 | DB integrity | `PRAGMA integrity_check` 返回 `ok`，schema_version 最大值为 10 |

### 7.2 负路验证

| 编号 | 验证项 | 预期 |
|------|--------|------|
| N1 | 无匹配 agent/file | `verified: false` |
| N2 | 过期记录超过 `READ_MAX_AGE_MS` | `verified: false` |
| N3 | 模拟 DB 不可用 | `verifyRead/getReadEventsForSession` 降级 JSONL；`recordRead` 仍写 JSONL |
| N4 | 重复运行迁移脚本 | DB 行数不膨胀 |
| N5 | `verifyRead(..., "cg_ses_*")` | 不应被审批路径使用；单测覆盖该调用不能误判通过 |

### 7.3 self-test 集成

旧版文档的 ST-39/40/41 编号已不可用。当前 `framework-self-test.ts` 已存在 Check 39。实施时应选择当前文件中未占用的后续编号，建议命名而不是依赖数字表达含义。

建议新增 4 项：

| 建议名称 | 验证内容 |
|----------|----------|
| `read_audit_table_exists` | `read_audit` 表、4 个索引、schema v10 存在 |
| `read_audit_record_verify_roundtrip` | 插入测试 read → `verifyRead()` true → 清理 |
| `read_audit_session_events_roundtrip` | 插入同 session/agent 多条记录 → `getReadEventsForSession()` 返回 |
| `knowledge_cache_attest_uses_shared_api` | 静态检查 `knowledge_cache_attest.ts` 不再包含 `readAuditLog()` / `.opencode/state/read_audit.jsonl` 直读 |

---

## 八、实施步骤

| Step | 内容 | 文件 | 预估 |
|:--:|------|------|:--:|
| S1 | 添加 v10 `read_audit` schema + 索引 | `.opencode/lib/db-manager.ts` | 20 min |
| S2 | 添加 DB helpers/normalization/event_key | `.opencode/lib/read-audit.ts` | 25 min |
| S3 | Phase 1 改造 `recordRead/verifyRead/getReadEventsForSession` | `.opencode/lib/read-audit.ts` | 60 min |
| S4 | 改造 UC7KS attestation 使用共享 read-audit API | `.opencode/tools/knowledge_cache_attest.ts` | 30 min |
| S5 | 编写迁移脚本并导入现有 JSONL | `.opencode/scripts/migrate-read-audit.ts` | 35 min |
| S6 | 新增 self-test 检查 | `.opencode/scripts/framework-self-test.ts` | 45 min |
| S7 | 执行 V1-V7/N1-N5 + full self-test | — | 35 min |

总计约 4h。比旧版 3.5h 略增，主要增加 `knowledge_cache_attest.ts` 改造和 `getReadEventsForSession()` DB-first 覆盖。

---

## 九、回滚方案

Phase 1 回滚依赖 JSONL 双写：

1. 恢复 `.opencode/lib/read-audit.ts` 和 `.opencode/tools/knowledge_cache_attest.ts` 到迁移前版本。
2. 保留或删除 `read_audit` 表均可；删除命令：

```bash
bun -e "const { getDb } = require('./.opencode/lib/db-manager'); const db = getDb(); db.run('DROP TABLE IF EXISTS read_audit')"
```

3. 确认 `.opencode/state/read_audit.jsonl` 包含迁移期间新记录。
4. 移除新增 self-test 项或临时标记 skip。
5. 跑 `bun .opencode/scripts/framework-self-test.ts`。

---

## 十、Phase 2 条件

满足以下条件后再做 DB-only：

1. 至少一个完整审批周期通过 READ-BEFORE-APPROVE。
2. 至少一个 UC7KS `knowledge_cache_attest` 正路通过。
3. `read_audit` DB 行数与 Phase 1 JSONL 双写期抽样一致。
4. full self-test 通过。
5. DB integrity ok。

Phase 2 才允许：

1. 移除 JSONL 双写。
2. 移除 JSONL fallback。
3. 归档 `.opencode/state/read_audit.jsonl`。
4. 更新 `knowledge-cache-state.schema.json` 中关于 “verified against read_audit.jsonl” 的描述为 “verified through read-audit DB/API”。

---

## 十一、风险清单

| 风险 | 等级 | 缓解 |
|------|:--:|------|
| UC7KS attestation 继续直读 JSONL，DB 迁移不完整 | P0 | S4 强制改造 + self-test 静态检查 |
| 把 gate `cg_ses_*` 当作 read audit session 查询 | P0 | DB 列命名 `opencode_session_id`；审批路径禁止传第三参数 |
| DB 写失败导致 read 证据丢失 | P0 | Phase 1 DB 写和 JSONL 写分离，DB 失败仍写 JSONL |
| 迁移脚本重复导入膨胀 | P0 | `event_key UNIQUE` + `INSERT OR IGNORE` |
| self-test 编号冲突 | P1 | 使用当前未占用编号，不复用旧 ST-39/40/41 假设 |
| Phase 2 过早删除 JSONL | P1 | 需同时满足审批 + UC7KS + self-test + DB integrity 条件 |

---

*本方案基于当前 `.opencode/lib/read-audit.ts`、`.opencode/tools/knowledge_cache_attest.ts`、`.opencode/plugins/read-track-after.ts`、`.opencode/scripts/mcp-tools/compliance-gate.ts`、`.opencode/lib/db-manager.ts`、`.opencode/scripts/framework-self-test.ts` 和当前 `read_audit.jsonl` 快照复审。*

---
## 实施完成记录

| 项 | 内容 |
|---|------|
| **实施日期** | 2026-06-18 |
| **实施 Agent** | @Super-Admin (READ-AUDIT-DB-MIGRATE-001) |
| **验收 Agent** | @Orchestrator |
| **文档版本** | v1.3.0 |
| **S1-S7 状态** | ✅ 全部完成 |
| **迁移脚本** | `.opencode/scripts/migrate-read-audit.ts` 新建（158行） |
| **DB 行数** | 250（原 JSONL 250 行，幂等迁移） |
| **Self-test** | Checks 40-43 全部 PASS |
| **验证结果** | V1-V7 ✅ / N1-N5 ✅ — 12/12 全部通过 |
| **Phase 2** | 条件已基本满足，待安排 |
| **HANDOVER** | `.task_temp/READ-AUDIT-DB-MIGRATE-001/HANDOVER.md` |
