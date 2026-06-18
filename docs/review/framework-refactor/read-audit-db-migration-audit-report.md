# read-audit-db-migration-plan.md 审核报告

**审核人**: @Super-Admin (QoderCN)  
**审核日期**: 2026-06-18  
**审核文档**: `docs/review/framework-refactor/read-audit-db-migration-plan.md` v1.0.0  
**审核依据**: 官方OpenCode文档 + 本地框架代码 + framework-evaluation-report.md  
**审核结论**: **有条件通过 — 6项P0缺陷需修复后方可实施**

---

## 审核总评

迁移计划**方向正确**：将 JSONL I/O 替换为 SQLite DB 是 P2-A 数据库迁移的自然延续，动机（M1-M5）充分，API 透明设计合理。但在 11 个子系统维度下存在 **6项P0缺陷** 和 **8项P1改进建议**，主要集中在：数据去重机制失效、缺乏事务保护、缺少双写过渡实现、DB 不可用时硬约束阻断、日志行为变更未声明、self-test 扩展缺失。

---

## 一、P0 缺陷（必须修复，否则不可实施）

### P0-1: 迁移脚本去重机制失效（INSERT OR IGNORE 无 UNIQUE 约束）

**位置**: §五 5.1 `migrate-read-audit.ts` 迁移脚本

**问题**: 迁移脚本使用 `INSERT OR IGNORE` 实现幂等去重，但 `read_audit` 表仅有 `INTEGER PRIMARY KEY AUTOINCREMENT` 主键，**没有 `(timestamp, agent, file_path)` 的 UNIQUE 约束**。SQLite 的 `INSERT OR IGNORE` 仅在违反 UNIQUE/PRIMARY KEY 约束时跳过。由于自增 id 永不重复，每次 INSERT 都会成功，`skipped` 永远为 0。

**后果**: 多次运行脚本会产生重复记录。77 条 JSONL 运行两次 → 154 条 DB 记录。verifyRead 查到多条匹配行，虽然 `LIMIT 1` 不影响正确性，但数据膨胀违反 MAX_RECORDS 语义。

**修复**: 在 schema 设计中添加去重唯一索引：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_read_audit_dedup
  ON read_audit(timestamp, agent, file_path);
```

文档 §三 3.5 附录的"注意"段落已讨论此索引但选择不添加，理由是"避免大量写入时维护唯一索引的性能开销"。此理由**不成立**：read_audit 写入频率极低（仅在 `read` 工具调用时），每秒远低于 1 次。唯一索引的维护成本在此场景下微不足道。

**修复后**: 迁移脚本 `INSERT OR IGNORE` 才能真正去重，幂等性得以保证。

---

### P0-2: recordRead() INSERT+DELETE 缺乏事务保护

**位置**: §四 4.1 `recordRead()` 替换方案

**问题**: `recordRead()` 执行两个独立 DB 操作：先 `INSERT` 新记录，再 `DELETE` 旧记录。这两步**不在同一事务中**。如果 INSERT 成功后 DELETE 失败（DB 锁、进程中断），旧记录不会被清理，表持续膨胀超出 MAX_RECORDS 限制。

**对比**: 当前 `cleanupOldRecords()` 的 RMW 操作虽然也有竞态（M1），但至少是在同一文件操作周期内完成。DB 版本拆成两个独立语句反而**降低了原子性**。

**修复**: 使用 bun:sqlite 事务包裹：

```typescript
export function recordRead(entry: ReadAuditEntry): void {
  try {
    const db = getDb();
    const normalizedAgent = normalizeAgent(entry.agent);
    const normalizedPath = normalizeFilePath(entry.filePath);

    // 单事务：INSERT + 原子化 DELETE
    db.transaction(() => {
      db.run(`INSERT INTO read_audit (...) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        entry.timestamp, normalizedAgent, normalizedPath,
        entry.sessionId || null, entry.taskId || null, entry.callId || null,
        Date.now(),
      ]);
      db.run(`DELETE FROM read_audit WHERE id NOT IN (
        SELECT id FROM read_audit ORDER BY id DESC LIMIT ?
      )`, [MAX_RECORDS]);
    })();

    writeLog(SRC, "INFO", { event: "READ_RECORDED", ... });
  } catch (err: any) {
    writeLog(SRC, "ERROR", { event: "RECORD_READ_FAILED", ... });
  }
}
```

**说明**: bun:sqlite 的 `db.transaction(fn)` 返回一个事务函数，调用时自动包裹 `BEGIN/COMMIT`，失败时 `ROLLBACK`。这确保 INSERT+DELETE 的原子性。

---

### P0-3: 缺少真正的双写过渡实现

**位置**: §一 1.4 设计约束 #2 "双写过渡"

**问题**: 计划声明"迁移期间保持 JSONL 与 DB 双写"，但实际实现方案（§四）是**完全替换**：recordRead() 只写 DB，不再写 JSONL。这不是双写，是单写切换。后果：

- 迁移后 JSONL 文件停止更新，成为**过时数据**
- 回滚方案（§七）依赖"JSONL 不删除"来恢复，但 JSONL 缺少迁移后的新记录
- 如果迁移后 1 小时内需要回滚，JSONL 仅有迁移前的 77 条记录，丢失迁移后所有新记录

**修复**: 实施真正的双写过渡（两个阶段）：

**Phase 1（双写期，至少 1 个完整审批周期）**:
```typescript
export function recordRead(entry: ReadAuditEntry): void {
  try {
    const db = getDb();
    // DB 写入（主路径）
    db.transaction(() => {
      db.run(`INSERT INTO read_audit (...) VALUES (...)`, [...]);
      db.run(`DELETE FROM read_audit WHERE id NOT IN (...)`, [MAX_RECORDS]);
    })();

    // JSONL 双写（备用路径，确保回滚时数据完整）
    const auditPath = getReadAuditPath();
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(auditPath, line, "utf8");

    writeLog(SRC, "INFO", { event: "READ_RECORDED_DUAL_WRITE", ... });
  } catch (err: any) { ... }
}
```

**Phase 2（DB-only，JSONL 退役）**: 双写期验证通过后，移除 `fs.appendFileSync`，删除 JSONL 文件（或归档到 `.opencode/state/_archive/`）。

**双写期验证条件**: 
- 至少 1 个审批周期通过（READ-BEFORE-APPROVE 从 DB 查到匹配记录）
- self-test 全量通过
- DB integrity_check = ok

---

### P0-4: DB 不可用时 verifyRead 硬性返回 false → READ-BEFORE-APPROVE 完全阻断

**位置**: §四 4.2 `verifyRead()` 替换方案

**问题**: 当 DB 连接失败（`getDb()` 抛异常）时，verifyRead() 返回 `{verified: false, reason: "Read audit verification failed: ..."}`。在 READ-BEFORE-APPROVE 硬约束下，`compliance-gate.ts` 会**拒绝审批**。这意味着 DB 故障 = 审批流程完全瘫痪。

**对比**: 当前 JSONL 方案下，文件 I/O 失败的概率极低（POSIX appendFileSync 几乎不会失败）。DB 不可用场景更常见：进程锁冲突（busy_timeout 5s 超时）、WAL 文件损坏、磁盘空间不足。

**合规门现有降级模式**: `compliance-gate.ts` 已有 `read-audit.ts unavailable → sha256-only fallback` 的 catch 分支（line 2066-2075）。但 verifyRead() 本身的 DB 异常不会被这个 catch 捕获——它只会捕获 `require("../../lib/read-audit")` 的模块加载失败。

**修复**: verifyRead() 应在 DB 不可用时**降级为 JSONL 读取**，而非硬性返回 false：

```typescript
export function verifyRead(agent: string, filePath: string, sessionId?: string): ReadVerifyResult {
  try {
    const db = getDb();
    // ... DB 查询逻辑 ...
  } catch (dbErr: any) {
    writeLog(SRC, "WARN", {
      event: "VERIFY_READ_DB_FALLBACK",
      detail: `DB query failed: ${dbErr.message}. Falling back to JSONL.`,
    });
    // 降级到 JSONL 读取（双写期间 JSONL 仍有最新数据）
    return verifyReadFromJsonl(agent, filePath, sessionId);
  }
}

// 保留旧 JSONL 逻辑作为降级路径（双写期后可移除）
function verifyReadFromJsonl(agent: string, filePath: string, sessionId?: string): ReadVerifyResult {
  // ... 原 fs.readFileSync + 逐行扫描逻辑 ...
}
```

这要求 **P0-3 的双写方案** 先实施，确保降级时 JSONL 有最新数据。

---

### P0-5: verifyRead() 新增 writeLog 调用改变了现有行为，未声明

**位置**: §四 4.2 `verifyRead()` 替换方案的 catch 块

**问题**: 当前 `verifyRead()` 在 catch 块中调用 `writeLog("lib-read-audit", "ERROR", ...)` 记录 DB 查询失败。但现有代码的 verifyRead() catch 块（line 174-183）**也已有 writeLog 调用**。迁移后新增的 writeLog 场景：

1. DB 查询异常 → writeLog ERROR（新增）
2. DB 连接失败 → writeLog ERROR（新增）

而 `compliance-gate.ts` 在 verifyRead 返回 false 后也会调用 `writeLog("mcp-compliance-gate", "ERROR", ...)` 记录 READ_BEFORE_APPROVE_FAILED。这会导致**同一失败事件被两个模块分别记录**，产生冗余日志。

**修复**: 方案有二：

- **方案 A**（推荐）：verifyRead() catch 块不写 writeLog，仅返回 `{verified: false, reason}`，让调用方（compliance-gate.ts）统一记录。这与现有 JSONL 版本的 catch 块行为一致（虽然现有代码也有 writeLog，但那是文件 I/O 失败的记录，DB 查询失败应视为同等级别，由调用方统一处理）。

- **方案 B**：保留 verifyRead 内部的 writeLog，但降级为 WARN 级别（而非 ERROR），因为 verifyRead 返回 false 是合法业务行为，不是系统错误。

**建议**: 采用方案 A，保持与现有行为的一致性。

---

### P0-6: 缺少 self-test 扩展项定义

**位置**: §六 6.4 验证检查清单

**问题**: 验证步骤仅列出手动验证（V1-V6, N1-N3），但未定义 `framework-self-test.ts` 中需要新增的自动化测试项。现有 38 项 self-test 不覆盖 read_audit DB 操作。

**后果**: 迁移后 self-test 无法自动检测 read_audit DB 退化，每次验证需手动执行 V1-N3，违反框架 Harness System 的自动化验证原则。

**修复**: 定义至少 3 项新增 self-test：

| # | 测试项 | 验证内容 |
|---|--------|---------|
| ST-39 | `read_audit_table_exists` | `SELECT name FROM sqlite_master WHERE type='table' AND name='read_audit'` 返回非空 |
| ST-40 | `read_audit_insert_verify_roundtrip` | INSERT 一条测试记录 → verifyRead() 返回 `verified: true` |
| ST-41 | `read_audit_cleanup_under_max` | INSERT 11 条记录（MAX_RECORDS=10 临时）→ DELETE 后 count ≤ 10 |

并在 §九 实施步骤中新增 S9: "新增 3 项 self-test 到 framework-self-test.ts"。

---

## 二、P1 改进建议（建议修复，非阻断性）

### P1-1: 常量参数化 — MAX_RECORDS / READ_MAX_AGE_MS 应可配置

**子系统**: Templatization & Parameterization System

**问题**: `MAX_RECORDS = 10000` 和 `READ_MAX_AGE_MS = 300000` 是硬编码常量。框架其他子系统（log-manager 的 `bufferSize`/`flushIntervalMs`、safe-bash 的 `rotationSize`）均通过 `project.config.json` 的 `template_resolution` 参数化。read_audit 应遵循相同模式。

**建议**: 
```typescript
const READ_MAX_AGE_MS = ((): number => {
  const cfg = readProjectConfig();
  const override = cfg?.template_resolution?.read_audit?.max_age_ms;
  return override || 5 * 60 * 1000;
})();
```

---

### P1-2: 路径规范化与 pathsMatch() 的一致性验证

**子系统**: Layout Architecture System + Central State Management

**问题**: 迁移计划引入 `normalizeFilePath()` 做 DB 存储规范化（resolve + normalize + lowercase），而现有 `pathsMatch()` 也做 resolve + normalize + lowercase（line 199）。两者逻辑一致，但代码重复：迁移后 `pathsMatch()` 被移除，`normalizeFilePath()` 成为唯一规范化函数。

**风险**: `normalizeFilePath()` 和 `pathsMatch()` 的实现细节可能有微小差异（例如 `.task_temp/{taskId}/HANDOVER.md` 的 `{taskId}` 替换处理）。现有 pathsMatch() 有 fallback（line 204: `return p1.toLowerCase() === p2.toLowerCase()`），而 normalizeFilePath() 没有 fallback。

**建议**: 在迁移脚本中增加"规范化一致性验证"步骤：对每条 JSONL 记录，验证 `normalizeFilePath(entry.filePath)` 与 `pathsMatch(entry.filePath, entry.filePath)` 的结果一致。

---

### P1-3: compliance-gate.ts 的 CJS require 兼容性

**子系统**: TypeScript + Bun Based System

**问题**: `compliance-gate.ts` 使用 `require("../../lib/read-audit")` 加载 verifyRead()（CJS 模式）。迁移后的 read-audit.ts 使用 `import { getDb } from "./db-manager"` (ESM 模式)。Bun 支持 CJS/ESM 混合，但 db-manager.ts 的 `bun:sqlite` import 在 CJS require 链中的行为需验证。

**建议**: 在 V1 验证步骤中增加：`require("../../lib/read-audit")` 返回的模块对象包含正确的 `verifyRead` 和 `recordRead` 函数。这是 Bun 的 CJS→ESM 桥接已知脆弱点（文档: `docs/official_docs/opencode/mcp-typescript-bun/findings-summary.md` SA-UNIFY-005）。

---

### P1-4: session_id 与 gate_sessions 的 JOIN 验证缺失

**子系统**: Multi-Agent System + Hardened Enforcement System

**问题**: 计划设计 `idx_read_audit_session` 索引并声明"可 JOIN gate_sessions"，但未定义验证步骤确认 session_id 值与 `gate_sessions.session_id` 的一致性。如果 read_audit.session_id 引用了一个不存在于 gate_sessions 的 session_id，JOIN 查询会返回空结果。

**建议**: 在 §六 添加验证项 V7: "read_audit 中所有非 NULL session_id 值均存在于 gate_sessions 表"。

---

### P1-5: 迁移脚本缺少 JSONL 行数与 DB 行数的一致性断言

**位置**: §五 5.1 迁移脚本末尾

**问题**: 迁移脚本输出 JSONL 行数和 DB 总行数，但**没有断言它们应该相等**。如果 JSONL 有 77 行但 DB 有 77 + 之前残留 = 100 行，脚本不会报错。

**建议**: 添加严格断言（仅首次迁移时）：
```typescript
const preExistingCount = // 迁移前 read_audit 行数
if (imported > 0 && imported !== lines.length) {
  console.error(`[migrate-read-audit] WARNING: imported ${imported} != JSONL lines ${lines.length}`);
}
```

---

### P1-6: 迁移后 JSONL 文件的最终处置策略未定义

**子系统**: Central State Management

**问题**: 计划说"JSONL 不删除"（双写过渡期），但未定义过渡期结束后的处置：归档？删除？保留为只读历史？

**建议**: 明确 JSONL 退役策略：
1. 双写期结束后：JSONL 移至 `.opencode/state/_archive/read_audit.jsonl.archive`
2. 保留 30 天后自动删除（log-rotator 的 archive 机制已有此模式）
3. 或：保留为只读审计对照（但有数据一致性风险）

---

### P1-7: db-manager.ts v10 schema 注释应引用 FW-编号

**子系统**: DB Management System

**问题**: v8/v9 的 schema_version comment 均使用 FW-编号（`FW-DISPATCH-TASKID-IMMUTABLE`, `FW-UC7KS-DOMAIN-001`）。v10 的 comment 是 `'P2-A v10: add read_audit table (replaces read_audit.jsonl)'`，缺少 FW-编号。

**建议**: 统一为 `'FW-READ-AUDIT-DB: add read_audit table replacing read_audit.jsonl'` 或类似编号。

---

### P1-8: Permission Matrix 考量 — @Super-Admin 独占修改权

**子系统**: Permission Matrix System + Hardened Enforcement

**问题**: 涉及修改的文件均位于 `.opencode/lib/` 和 `.opencode/scripts/` 下，属于框架基础设施文件。根据 AGENTS.md 的 Agent Scope 边界矩阵，**只有 @Super-Admin 可以修改 `.opencode/` 框架文件**。计划未声明此权限约束。

**建议**: 在 §九 实施步骤开头添加前置条件："所有 S1-S8 步骤必须由 @Super-Admin 执行或经 @Orchestrator dispatch_subagent @Super-Admin 授权。其他 Agent 修改 .opencode/ 文件将被 framework-enforcer.ts 阻断。"

---

## 三、子系统合规性逐项审核

| # | 子系统 | 合规状态 | 详细说明 |
|---|--------|:--------:|---------|
| 1 | **Layout Architecture System** | ✅ 合规 | 迁移脚本位于 `.opencode/scripts/`（遵循 layout 约定）；lib 文件在 `.opencode/lib/`；state 文件在 `.opencode/state/`。唯一问题：P1-2 规范化一致性。 |
| 2 | **Permission Matrix System** | ⚠️ 需补充 | P1-8：计划未声明 @Super-Admin 独占修改权。修改 `.opencode/lib/` 文件需 Super-Admin scope。 |
| 3 | **Concurrent Session/Dispatch Write System** | ❌ P0 缺陷 | P0-2：recordRead() 的 INSERT+DELETE 缺事务保护，破坏并发写入原子性。P0-4：DB 不可用时无降级路径。 |
| 4 | **Hardened Enforcement System** | ❌ P0 缺陷 | P0-4：DB 不可用 → verifyRead false → READ-BEFORE-APPROVE 完全阻断，违反"硬约束应有降级机制"原则。compliance-gate.ts 的 catch 分支仅覆盖模块加载失败，不覆盖 DB 查询失败。 |
| 5 | **Harness System (Self-test)** | ❌ P0 缺陷 | P0-6：无新增 self-test 项定义。迁移后 38 项 self-test 不覆盖 read_audit DB 操作。 |
| 6 | **Central State Management** | ⚠️ 需补充 | P0-3：缺少双写过渡实现；P1-6：JSONL 退役策略未定义。state 路径遵循 `.opencode/state/` 约定。 |
| 7 | **Multi-Agent System** | ⚠️ 需补充 | P1-4：session_id JOIN 验证缺失；P1-8：权限边界未声明。read-track-after.ts 调用链不变。 |
| 8 | **Log Central Management System** | ⚠️ 需修正 | P0-5：verifyRead() 新增 writeLog 调用未声明行为变更；日志源 `"lib-read-audit"` 与现有一致；日志格式遵循 pipe-delimited 约定。 |
| 9 | **DB Management System** | ❌ P0 缺陷 | P0-1：去重唯一索引缺失；P0-2：事务保护缺失；P1-7：v10 comment 缺 FW-编号。schema 设计与 db-manager.ts 的 initializeSchema() 模式一致。 |
| 10 | **Templatization & Parameterization** | ⚠️ 需补充 | P1-1：MAX_RECORDS/READ_MAX_AGE_MS 硬编码，应通过 project.config.json template_resolution 参数化。 |
| 11 | **TypeScript + Bun Based System** | ⚠️ 需验证 | P1-3：CJS require 兼容性需验证（Bun CJS→ESM 桥接已知脆弱点）。`bun:sqlite` API 使用正确（db.run/db.query/db.prepare/db.transaction）。import 风格遵循本地约定。 |

---

## 四、OpenCode 官方规范合规性

| 规范维度 | 合规状态 | 说明 |
|---------|:--------:|------|
| **MCP 工具日志**: `process.stderr.write()` | ⚠️ 不适用 | read-audit.ts 不是 MCP server，是 lib 模块。使用本地框架的 `writeLog()` 是正确的。 |
| **插件日志**: `client.app.log()` | ⚠️ 不适用 | read-audit.ts 不是 plugin，是 lib 模块。 |
| **自定义工具日志**: return value | ⚠️ 不适用 | read-audit.ts 不是 custom tool。 |
| **Lib 模块日志**: `writeLog()` | ✅ 合规 | 使用本地框架的 writeLog()，源名 `"lib-read-audit"` 符合约定。 |
| **Plugin export**: `export default` | ✅ 不适用 | read-audit.ts 是 lib 模块，export 多个 named exports。read-track-after.ts 是 plugin，已有 export default。 |
| **CJS/ESM 混合**: Bun 支持 | ⚠️ 需验证 | P1-3：compliance-gate.ts 的 CJS require 加载 ESM lib 模块的链式依赖需验证。 |
| **Module resolution**: Bun 原生 TS | ✅ 合规 | 所有文件为 `.ts`，Bun 直接执行，无需编译步骤。 |
| **Agent identity in hooks**: `process.env.FRAMEWORK_AGENT` | ✅ 合规 | read-track-after.ts 通过 `input.agent` 或 env 获取 agent 身份，传给 recordRead()。 |
| **Hook args asymmetry**: before→output.args, after→input.args | ✅ 合规 | read-track-after.ts 是 after-hook，使用 `input.args`。 |
| **`console.log()` 禁止** | ✅ 合规 | 计划中无 `console.log()` 使用。迁移脚本用 `console.log()` 是合理的（CLI 工具，不是 MCP/plugin）。 |

---

## 五、修复优先级矩阵

| 优先级 | ID | 问题 | 修复工时 | 阻断实施？ |
|:------:|:--:|------|:--------:|:---------:|
| **P0** | P0-1 | 唯一索引缺失 → 去重失效 | 10 min | ✅ 是 |
| **P0** | P0-2 | INSERT+DELETE 缺事务 | 15 min | ✅ 是 |
| **P0** | P0-3 | 缺双写过渡实现 | 30 min | ✅ 是 |
| **P0** | P0-4 | DB 不可用 → 硬约束阻断 | 30 min | ✅ 是 |
| **P0** | P0-5 | verifyRead writeLog 行为变更 | 10 min | ✅ 是 |
| **P0** | P0-6 | self-test 扩展缺失 | 45 min | ✅ 是 |
| P1 | P1-1 | 常量参数化 | 20 min | ❌ 否 |
| P1 | P1-2 | 规范化一致性验证 | 15 min | ❌ 否 |
| P1 | P1-3 | CJS require 兼容性验证 | 10 min | ❌ 否 |
| P1 | P1-4 | session_id JOIN 验证 | 10 min | ❌ 否 |
| P1 | P1-5 | 迁移行数一致性断言 | 10 min | ❌ 否 |
| P1 | P1-6 | JSONL 退役策略 | 15 min | ❌ 否 |
| P1 | P1-7 | v10 FW-编号 | 5 min | ❌ 否 |
| P1 | P1-8 | @Super-Admin 权限声明 | 5 min | ❌ 否 |

**P0 总修复工时**: ~2h  
**P1 总修复工时**: ~1.5h  
**原计划实施工时**: ~2.5h  
**含 P0 修复后总工时**: ~4.5h（含双写过渡期等待时间）

---

## 六、对原计划章节的修改建议

| 章节 | 需修改 | 修改内容 |
|------|:------:|---------|
| §一 1.4 设计约束 | ✅ | 约束 #2 "双写过渡"需改为真正双写定义 |
| §三 3.1 read_audit 表 | ✅ | 添加 `idx_read_audit_dedup` UNIQUE 索引 |
| §三 3.5 db-manager.ts 集成 | ✅ | comment 使用 FW-编号；添加 UNIQUE 索引创建 |
| §四 4.1 recordRead() | ✅ | db.transaction() 包裹 INSERT+DELETE；添加 JSONL 双写 |
| §四 4.2 verifyRead() | ✅ | DB 异常降级到 JSONL；移除内部 writeLog ERROR |
| §四 4.4 移除的代码 | ✅ | 双写期不移除 fs.appendFileSync；保留 pathsMatch |
| §四 4.6 接口兼容性 | ✅ | 添加 "降级模式" 说明 |
| §五 5.1 迁移脚本 | ✅ | UNIQUE 索引使 INSERT OR IGNORE 生效；添加行数断言 |
| §六 验证步骤 | ✅ | 添加 V7 session_id JOIN 验证；P1-3 CJS 兼容性验证 |
| §六 6.4 检查清单 | ✅ | 添加 ST-39/40/41 self-test 项 |
| §七 回滚方案 | ✅ | 双写期 JSONL 有最新数据，回滚更安全 |
| §八 涉及文件 | ✅ | 双写期 read-audit.ts 变更行数增加 |
| §九 实施步骤 | ✅ | 添加 S9 self-test 扩展；添加 @Super-Admin 权限前置条件 |
| §十 风险 | ✅ | 添加 R6: DB 不可用风险及降级缓解 |

---

*审核完成。6 项 P0 缺陷需在文档更新后方可进入实施阶段。*
