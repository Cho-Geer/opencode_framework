# READ-BEFORE-APPROVE E2E 验证发现报告

**Version**: v1.1.0
**Created**: 2026-06-21
**Last Reviewed**: 2026-06-21 — 当前框架代码复审后更新
**Author**: @Orchestrator (findings by E2E tests)
**Status**: revised — S2 旧归因不成立；需要实施 session-bound approval 修复并重新验收

---

## §1 概述

对 READ-BEFORE-APPROVE 物理约束实施进行全场景 E2E 集成测试验收。测试覆盖 3 个并行派遣的子 Agent（S1+S2+S3 门禁测试、S4 verifyNonEmptyReadSet 空列表测试、S5 并发读测试），共 12 个子场景。

### §1.1 本次代码复审结论

结合当前 `.opencode/scripts/mcp-tools/compliance-gate.ts`、`.opencode/lib/read-audit.ts`、`.opencode/plugins/read-track-after.ts`、`.opencode/plugins/gate-before.ts`、`.opencode/lib/agent-resolver.ts` 与官方 OpenCode plugin/tool 文档复审后，原报告中 S2 的“同一 agent 身份下 S1 读记录被 S2 复用”解释不成立：

1. E2E 指令和现存文件显示 S1/S2/S3 使用不同 `task_id` 和不同 HANDOVER 路径：`.task_temp/E2E-READ-APPROVE-v3/HANDOVER.md`、`.task_temp/E2E-READ-APPROVE-v3-S2/HANDOVER.md`、`.task_temp/E2E-READ-APPROVE-v3-S3/HANDOVER.md`。
2. 当前 `verifyRead(agent, filePath)` 的 DB 查询包含 `agent + file_path + timestamp`，不同 `file_path` 不会被 S1 记录匹配。
3. 当前 DB 只能查到 S1 路径的 read 记录，S2/S3 路径无 read 记录。因此如果 S2 确实通过，根因不是 read 记录跨路径复用，而是 E2E harness/session 状态或 approve path 未按 S2 独立 session/路径执行。
4. 真正的设计缺口仍然存在：`approve_deliverables` 当前没有绑定调用它的 OpenCode `sessionID`，只按 `resolvedAgent + HANDOVER path + 5min` 验证。这个缺口在“同一审批 agent、同一 HANDOVER 路径、不同 gate session”场景下仍会复用读记录。

## §2 测试结果总表

|  #   | 测试                  | 测试内容                                               |       结果       | 详细说明                                                                                                                                                        |
| :--: | --------------------- | ------------------------------------------------------ | :--------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  P0  | Check 59              | framework-self-test self-check                         |     ✅ PASS      | 6 sub-checks all pass: plugin file, opencode.json registration, 7 exports, schema, SQLite table, verifyNonEmptyReadSet                                          |
|  S1  | Happy path            | read HANDOVER.md → approve                             |     ✅ PASS      | 正常审批流通过。read 事件被 read-track-after.ts 记录到 SQLite read_audit 表，verifyRead() 正确返回 verified=true                                                |
|  S2  | No read bypass        | approve without read (仅 sha256)                       | ⚠️ 旧归因不成立 | 当前代码与 DB 证据不支持“S1 读记录复用 S2 路径”。若 S2 曾通过，应优先排查 E2E harness 是否复用了 session/task_id/路径；系统仍需补 session-bound approval 防止同路径跨 session 复用 |
|  S3  | SHA bypass            | shell 算 sha256，不调 read 工具                        | ✅ PASS 核心验证 | `[READ-BEFORE-APPROVE]` 正确拒绝 ❌                                                                                                                             |
| S4a  | Empty targets         | verifyNonEmptyReadSet(filePaths=[])                    |     ✅ PASS      | `emptyTargets=true, verified=false, notRead=[]`——新 §12.1 硬化生效                                                                                              |
| S4b  | Has read              | verifyNonEmptyReadSet after read                       |     ✅ PASS      | `verified=true, all 1 deliverables verified`                                                                                                                    |
| S4c  | Not read              | verifyNonEmptyReadSet for unread file                  |     ✅ PASS      | `verified=false, file in notRead[]`——正确识别未读文件                                                                                                           |
| S5a  | Concurrent 1st        | First approver read → verifyRead                       |     ✅ PASS      | `verified=true`, tracked at SQLite                                                                                                                              |
| S5b  | Concurrent 2nd        | Second approver (different identity) read → verifyRead |     ✅ PASS      | 独立追踪通过，不同 agent 身份正确隔离                                                                                                                           |
| S5c  | Both recorded         | 两条记录均入库                                         |     ✅ PASS      | SQLite read_audit 表包含 2 条独立记录                                                                                                                           |
| Edge | Cross-agent isolation | Coder-BE (unrelated) → verifyRead                      |     ✅ PASS      | `verified=false`——隔离正确                                                                                                                                      |

**总计**: 10 项确认 PASS + 1 项核心验证按报告 PASS + S2 需重新验收。原 “11/12 PASS、1 设计局限” 统计不应作为最终验收结论，必须在完成 §8 修复后重跑 E2E。

---

## §3 三层防御验证

### §3.1 DELIVERABLES-REVIEW-LOCK (sha256 一致性)

- 机制：approve_deliverables 验证 handover_sha256 参数与磁盘文件内容一致
- E2E 验证：S3 提供正确哈希但未 read → `READ-BEFORE-APPROVE` 拒绝，非 sha256 拒绝
- 状态：**✅ 有效**

### §3.2 READ-BEFORE-APPROVE (read 工具调用追踪)

- 机制：read-track-after.ts plugin → read-audit.ts → SQLite read_audit 表
- 验证：S3 shell sha256sum 算哈希后直接 approve，不调 read 工具 → `[READ-BEFORE-APPROVE]` 拒绝 ❌
- 状态：**⚠️ 主链路有效但未完全闭环**。read 工具 after-hook 追踪有效；但 `approve_deliverables` 当前没有绑定调用者 OpenCode `sessionID`，且 read-audit 不可用时会降级为 sha256-only 放行。严格/locked 模式下应 fail-closed。

### §3.3 verifyNonEmptyReadSet (批量拒绝空列表)

- 机制：verifyNonEmptyReadSet() 拒绝空 filePaths 数组，fail-closed
- 验证：S4a empty → `{ verified: false, emptyTargets: true }`
- 状态：**✅ 有效**

---

## §4 发现清单

### 4.1 ✅ 确认项 (All Clear)

| ID  | 确认项                                                                               |     来源      |
| :-: | ------------------------------------------------------------------------------------ | :-----------: |
| C1  | read 工具事件被 read-track-after.ts 插件正确拦截并写入 SQLite                        |    S1, S5     |
| C2  | verifyRead() 正确查询 read_audit 表，在 agent+filePath+5min 窗口内返回 verified=true | S1, S5a, S5b  |
| C3  | verifyRead() 对未读文件返回 verified=false + 明确错误提示                            |    S3, S4c    |
| C4  | verifyNonEmptyReadSet 拒绝空路径列表 (fail-closed)                                   |      S4a      |
| C5  | verifyNonEmptyReadSet 正确区分已读/未读文件                                          |   S4b, S4c    |
| C6  | 并发 read：两个不同 agent 身份读同一文件，各自独立追踪、各自验证通过                 | S5a, S5b, S5c |
| C7  | 跨 agent 隔离：无关 agent (Coder-BE) 不能通过验证                                    |     Edge      |
| C8  | STATE_PATHS.readAudit() 集中路径管理正常工作                                         |  P1 实施验证  |
| C9  | Check 59 全量自检通过（框架完整性）                                                  |      P0       |
| C10 | compliance-gate.ts 新增 RESOLVED_FROM 日志                                           |  §12.3 硬化   |

### 4.2 ⚠️ 警告项 (Warnings)

| ID  | 警告                                                         | 严重性 | 说明                                                                                                | 建议                                                                                                                                     |
| :-: | ------------------------------------------------------------ | :----: | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | `approve_deliverables` 未绑定 OpenCode `sessionID`            | **P1** | 当前 `runGateApproveDeliverables()` 调 `verifyRead(resolvedAgent, resolvedHandoverPath)`，未传第三参数；只能验证 agent+path+时间窗口 | 通过 plugin before-hook 捕获 `compliance-gate_compliance_gate_approve_deliverables` 的 `input.sessionID/callID/output.args`，写入 DB，MCP 侧按同一 args hash 读取并传给 `verifyNonEmptyReadSet()` |
| W2  | verifyNonEmptyReadSet 未集成到 compliance-gate.ts approve 流 | **P1** | 当前 approve 流仍使用单文件 `verifyRead()`，`verifyNonEmptyReadSet()` 只是独立导出的 helper 函数 | 在 READ-BEFORE-APPROVE 检查块中改用 `verifyNonEmptyReadSet({ agent, sessionId, filePaths })`，即使目前只检查 HANDOVER.md，也为多交付物留出统一路径 |
| W3  | read-audit 加载失败时 approve fail-open                      | **P1** | 当前 catch `readAuditErr` 后记录 `READ_BEFORE_APPROVE_UNAVAILABLE` 并继续审批；这会退化为 sha256-only | strict/locked 模式 fail-closed；advisory 可 warn 并放行。日志必须含 mode、sessionID、agent、handoverPath |
| W4  | S2 旧结论缺少可审计原始输出                                  | **P2** | 当前仓库只保留 dispatch prompt 和目标文件，未保留 S2 approve 返回体；DB 证据不支持旧归因 | E2E harness 必须保存每个 MCP 调用返回 JSON、gate session id、OpenCode session id、read_audit 查询结果和日志片段 |

### 4.3 ℹ️ 其他观察

| ID  | 观察                                                      | 说明                                    |
| :-: | --------------------------------------------------------- | --------------------------------------- |
| O1  | SQLite WAL 模式安全支持并发 read 记录                     | 无竞态条件                              |
| O2  | read_audit 表增长稳定（本次 DB 查询中 E2E S1 记录存在）   | cleanupOldRecords 保留最新 10000 条     |
| O3  | S3 是最强验证：shell 绕过尝试被正确阻断                   | 证明 READ-BEFORE-APPROVE 物理不可绕过   |
| O4  | S2 旧归因与当前代码/DB 证据冲突                           | 需要重新跑可审计 E2E，而不是沿用“设计局限”判断 |

---

## §5 风险矩阵与缓解

| 风险                                       | 概率 | 影响 | 缓解措施                                                      | 剩余风险 |
| :----------------------------------------- | :--: | :--: | ------------------------------------------------------------- | :------: |
| read-track-after.ts 插件加载失败           |  低  |  高  | strict/locked 下 fail-closed；Check 59 + startup plugin load 日志 |    中    |
| read_audit 表过大                          |  中  |  低  | cleanupOldRecords 保留 10000 条                               |    低    |
| 审批人读文件后超 5 分钟才审批              |  中  |  低  | 错误提示明确告知可重读；READ_MAX_AGE_MS 可配置                |    低    |
| 5-min 窗口内同 agent 同路径跨 session 复用读记录 |  中  |  中  | approve 绑定 OpenCode sessionID；JSONL fallback 对 sessionId fail-closed |    低    |
| before-hook 异常阻断 after-hook 链         |  低  |  高  | read 是框架内置工具，其 after hook 独立于 before 链           |    低    |
| read 工具重命名/重构                       |  低  |  高  | Check 59 监控插件加载状态；日志中记录 UNKNOWN_TOOL            |    低    |
| MCP approve 调用上下文不可得               |  中  |  高  | 使用 OpenCode plugin before-hook 捕获 `input.sessionID/callID/output.args` 到 DB；不在 MCP 参数中信任用户自报 session |    低    |

---

## §6 改进建议

### P1 (高优先级)

- **Session-bound approval**：新增 approve tool-call context DB 表和插件捕获逻辑，把 `approve_deliverables` 调用的 OpenCode `sessionID` 传递给 MCP 服务端验证路径。见 §8。
- **Integrate verifyNonEmptyReadSet**：approve 阶段改用 `verifyNonEmptyReadSet()`，并传入捕获到的 `opencode_session_id`。
- **Fail-closed on read-audit unavailable**：strict/locked 模式下 `READ_BEFORE_APPROVE_UNAVAILABLE` 必须拒绝审批。

### P2 (中优先级)

- **verifyRead JSONL fallback session 精确匹配**：当传入 `sessionId` 时，JSONL fallback 中缺失 `entry.sessionId` 的历史记录不得匹配。
- **E2E harness evidence pack**：每个场景保存 MCP 返回体、DB 查询、日志行、gate-state/session_map 摘要。

### P3 (低优先级)

- **提升 READ_MAX_AGE_MS 可配置性**：当前硬编码 5min，可改为从 project.config.json 读取

---

## §7 与方案文档的关系

| 方案文档 § | 对应项                                |      状态      |
| :--------: | ------------------------------------- | :------------: |
|  §8.2 S1   | 正常审批流 read HANDOVER.md → approve |    ✅ PASS     |
|  §8.2 S2   | 未读审批 approve (仅 sha256) → 拒绝   | ⚠️ 需重跑可审计 E2E |
|  §8.2 S3   | sha256 绕过从 task_result 获取 → 拒绝 |    ✅ PASS     |
|  §8.2 S5   | 并发 read 两审批人各自通过            |    ✅ PASS     |
|  §11.6 P1  | STATE_PATHS.readAudit()               |   ✅ 已实施    |
|  §11.6 P2  | Check 59 self-test                    |    ✅ PASS     |
|   §12.1    | verifyNonEmptyReadSet                 | ✅ 已实施+验证 |
|   §12.2    | 日志事件常量                          |   ✅ 已实施    |
|   §12.3    | RESOLVED_FROM 日志                    |   ✅ 已实施    |

---

## §8 当前根因分析与修复方案

### §8.1 代码事实

| 位置 | 当前行为 | 结论 |
|------|----------|------|
| `.opencode/plugins/read-track-after.ts` | 使用 `tool.execute.after`，从 `input.args.filePath`、`input.sessionID`、`input.callID` 记录 read 事件 | 符合官方 OpenCode plugin hook 形状；read 事件能带 OpenCode session id |
| `.opencode/lib/read-audit.ts` | `verifyRead(agent, filePath, sessionId?)` 传 `sessionId` 时 DB 精确匹配 `opencode_session_id`；不传时只匹配 `agent + file_path + timestamp` | 底层已具备 session 精确验证能力，但 approve 主路径没有使用 |
| `.opencode/lib/read-audit.ts` | `verifyNonEmptyReadSet()` 已导出，内部调用 `verifyRead()` | helper 可复用，但 `windowMs` 参数当前未实际影响 `verifyRead()` 的窗口 |
| `.opencode/scripts/mcp-tools/compliance-gate.ts` | approve 阶段 `const { verifyRead } = require("../../lib/read-audit"); ... verifyRead(resolvedAgent, resolvedHandoverPath)` | 根因入口：未传 OpenCode session id，也未使用批量 helper |
| `.opencode/scripts/mcp-tools/compliance-gate.ts` | read-audit 加载失败 catch 后记录 WARN 并继续审批 | strict/locked 模式下不符合 Hardened enforcement；应 fail-closed |
| `.opencode/plugins/gate-before.ts` / `gate-after.ts` | 已能识别 `compliance-gate_compliance_gate*` MCP 工具，plugin hook 可取得 `input.sessionID/callID` | 可作为 MCP 服务端缺少 OpenCode context 的桥接层 |

### §8.2 根因

**RC1 — approve 阶段缺少 OpenCode session 绑定。**  
READ-BEFORE-APPROVE 的证据源是 OpenCode `read` tool after-hook 写入的 `opencode_session_id`。但 `compliance_gate_approve_deliverables` 是 MCP server 工具，当前服务端函数只拿到 compliance gate `session_id`（`cg_ses_*`），没有拿到 OpenCode `sessionID`（`ses_*`）。结果是 approve 只能做 `agent + path + time window` 验证。

**RC2 — S2 旧归因把“同 session/path 复用风险”误写成“跨 task path 复用事实”。**  
E2E v3 的 S1/S2/S3 路径不同；当前 DB 只存在 S1 路径 read 记录，S2/S3 路径无 read 记录。因此 S2 旧结论缺少证据。应将其视为 E2E 证据链不完整，而不是已验证的低风险设计局限。

**RC3 — `verifyNonEmptyReadSet()` 未进入审批主路径。**  
空列表 fail-closed 已经实现并验证，但 approve 主路径仍是单文件 `verifyRead()`。这让未来多交付物审批无法共享同一验证入口，也让 S4 的硬化没有覆盖真实审批流程。

**RC4 — read-audit unavailable fail-open。**  
READ-BEFORE-APPROVE 是物理约束，`lib/read-audit.ts` 加载失败或 DB 验证不可用时，strict/locked 模式不应退回 sha256-only。

**RC5 — E2E harness 缺少可审计原始证据。**  
当前仓库只保留 dispatch prompt、测试 HANDOVER/TASK_LOG 和最终 findings 摘要，缺少每次 MCP 调用返回体、gate session id、OpenCode session id、read_audit 查询结果、相关日志行。导致 S2 结果无法复盘。

### §8.3 修复设计

#### P1-A: 新增 approve tool-call context DB 桥接

新增 `.opencode/lib/approval-read-context.ts`，并在 DB schema 添加 v17 表：

```sql
CREATE TABLE IF NOT EXISTS approval_read_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gate_session_id TEXT NOT NULL,
  opencode_session_id TEXT NOT NULL,
  call_id TEXT,
  agent TEXT,
  tool_name TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  UNIQUE(gate_session_id, args_hash)
);

CREATE INDEX IF NOT EXISTS idx_approval_read_context_lookup
  ON approval_read_context(gate_session_id, args_hash, consumed_at, created_at DESC);
```

`gate-before.ts` 在 `tool.execute.before` 中识别 `compliance-gate_compliance_gate_approve_deliverables`：

1. 按官方 OpenCode hook 形状读取 `input.sessionID`、`input.callID`、`output.args`。
2. 从 `output.args.session_id` 取得 gate session id。
3. 计算 `args_hash = sha256(stableJson({ session_id, approval_decision, handover_sha256, agent_id }))`。
4. 写入 `approval_read_context`。
5. 记录日志 `APPROVAL_READ_CONTEXT_RECORDED`。

不得要求调用者在 MCP 参数里自报 `approver_session_id`，因为这会把 session 绑定变成可伪造输入。

#### P1-B: approve 主路径改用 `verifyNonEmptyReadSet()`

`runGateApproveDeliverables()` 的 READ-BEFORE-APPROVE 块改为：

1. 使用同样的 stable args hash 查 `approval_read_context`。
2. 取出 `opencode_session_id`。
3. 调用：

```typescript
const { verifyNonEmptyReadSet } = require("../../lib/read-audit");
const readResult = verifyNonEmptyReadSet({
  agent: resolvedAgent,
  sessionId: approvalCtx.opencode_session_id,
  filePaths: [resolvedHandoverPath],
});
```

4. 成功后 mark context consumed，记录 `READ_BEFORE_APPROVE_PASSED`，日志必须包含 `gate_session_id`、`opencode_session_id`、`callID`、`agent`、`handoverPath`。
5. 失败时拒绝审批，并记录 `READ_BEFORE_APPROVE_FAILED_NOT_READ` 或 `READ_BEFORE_APPROVE_FAILED_EMPTY_TARGETS`。

#### P1-C: read-audit unavailable fail-closed

`READ_BEFORE_APPROVE_UNAVAILABLE` 的处理改为：

| enforcement mode | 行为 |
|------------------|------|
| `locked` / `strict` | reject；reason 明确要求修复 read-audit/plugin/DB 后重试 |
| `advisory` | warn + allow；日志保留 `READ_BEFORE_APPROVE_UNAVAILABLE_ADVISORY` |

#### P2-A: JSONL fallback session 精确匹配

`verifyReadJsonl()` 中，当调用方传入 `sessionId` 时，必须要求 `entry.sessionId === sessionId`；历史 JSONL 无 sessionId 的记录不得匹配：

```typescript
if (sessionId && entry.sessionId !== sessionId) continue;
```

这不会影响无 sessionId 的旧调用，但能保证 session-bound approve 不被历史无 session 记录放行。

#### P2-B: E2E harness evidence pack

新增/更新 E2E 脚本，所有场景输出 `.task_temp/E2E-READ-APPROVE-v4/evidence.json`：

```json
{
  "scenario": "S2",
  "gate_session_id": "cg_ses_*",
  "opencode_session_id": "ses_*",
  "task_id": "E2E-READ-APPROVE-v4-S2",
  "handover_path": ".task_temp/E2E-READ-APPROVE-v4-S2/HANDOVER.md",
  "approve_result": {},
  "read_audit_rows_before": [],
  "read_audit_rows_after": [],
  "expected": "rejected",
  "actual": "rejected",
  "log_refs": []
}
```

S2/S3 必须断言目标路径在 `read_audit` 中没有 matching `opencode_session_id`，并且 approve 返回 `[READ-BEFORE-APPROVE]`。

### §8.4 日志集成要求

所有新增日志必须使用 `.opencode/lib/log-manager.ts` 的 `writeLog()`，不得 `console.log` 或直接写散落文件。

| Source | Event | Level | 说明 |
|--------|-------|-------|------|
| `gate-before` | `APPROVAL_READ_CONTEXT_RECORDED` | INFO | approve MCP 调用上下文已写 DB |
| `gate-before` | `APPROVAL_READ_CONTEXT_RECORD_FAILED` | ERROR | 上下文写入失败 |
| `mcp-compliance-gate` | `APPROVAL_READ_CONTEXT_MISSING` | ERROR | approve 侧找不到 OpenCode session 绑定 |
| `mcp-compliance-gate` | `READ_BEFORE_APPROVE_PASSED` | INFO | session-bound read 验证通过 |
| `mcp-compliance-gate` | `READ_BEFORE_APPROVE_FAILED` | ERROR | session-bound read 验证失败 |
| `mcp-compliance-gate` | `READ_BEFORE_APPROVE_UNAVAILABLE` | ERROR/WARN | read-audit 不可用；strict/locked 为 ERROR 并拒绝 |
| `lib-read-audit` | `READ_BEFORE_APPROVE_FAILED_EMPTY_TARGETS` | WARN | 空列表 fail-closed |
| `lib-read-audit` | `READ_BEFORE_APPROVE_FAILED_NOT_READ` | WARN | 未读文件列表 |

日志字段至少包含：`sessionID`（OpenCode session id，若在 plugin 侧）、`gate_session_id`、`callID`、`agent`、`task_id`、`handoverPath`、`args_hash`。

### §8.5 官方 OpenCode 规范符合性

| 规范来源 | 要求 | 本方案符合性 |
|----------|------|--------------|
| Layout Architecture | custom tools 在 `.opencode/tools/`；plugins 在 `.opencode/plugins/`；MCP server 在 `opencode.json.mcp` 注册 | 不新增 custom tool；只新增 `.opencode/lib/` helper、DB schema 和现有 `.opencode/plugins/gate-before.ts` 逻辑 |
| Plugin Hooks | `tool.execute.before` 参数为 `input: { tool, sessionID, callID }` 与 `output.args`；after-hook args 在 `input.args` | approve context 捕获必须在 `gate-before.ts` 使用 `output.args`，read 追踪继续在 after-hook 使用 `input.args` |
| Hook Chaining | 多插件同 hook 会全部触发 | 不依赖单插件独占；新增逻辑保持 best-effort 记录，失败时由 MCP strict/locked fail-closed |
| Permission Matrix | MCP/custom/built-in 工具名统一参与权限匹配，last match wins | 不新增可被 agent 直接调用的工具；不扩大普通 agent 权限 |
| MCP vs Custom Tool | MCP 工具命名与 OpenCode custom tool 命名必须区分 | `compliance-gate_compliance_gate_approve_deliverables` 仍是 MCP 工具；`approval-read-context.ts` 是 lib，不注册为 custom tool |

### §8.6 子系统符合性

| 子系统 | 要求 |
|--------|------|
| Layout Architecture System | 新 helper 放 `.opencode/lib/`；DB schema 放 `db-manager.ts`；插件逻辑保留在 `.opencode/plugins/gate-before.ts`；E2E 产物放 `.task_temp/` |
| Permission Matrix System | 不信任用户传入的 `approver_session_id`；只信任 OpenCode plugin `input.sessionID` |
| concurrent session/dispatch write system | 以 `gate_session_id + args_hash` 唯一约束防并发串扰；context 消费后置 `consumed_at` |
| Hardened enforcement System | strict/locked 下 missing context、read-audit unavailable、empty target、not read 均 fail-closed |
| Harness System | E2E v4 必须保存 evidence pack，覆盖 S1/S2/S3/S4/S5 和同路径跨 session 复用场景 |
| Central State Management | approve context 进入 SQLite DB canonical state；不新增 JSON substate |
| Multi-Agent System | 不改变 @Orchestrator/@Super-Admin 审批权限；不同 agent/session 的 read 证据隔离 |
| Log Central Management System | 所有事件进入 `writeLog()`，source 分别为 `gate-before`、`mcp-compliance-gate`、`lib-read-audit` |
| DB management system | schema v17 幂等迁移、索引、唯一键；写入/消费使用事务 |
| Templatization & Parameterization | `READ_MAX_AGE_MS` 后续从 `.opencode/project.config.json` 模板项读取；当前不硬编码路径到工作区绝对值 |
| TypeScript + Bun Based System | 新代码使用 TypeScript/Bun native require/import；不引入 Python/外部服务 |

### §8.7 验收标准

| ID | 验收项 | 预期 |
|----|--------|------|
| A1 | S1 same OpenCode session read → approve | approved/completed |
| A2 | S2 no read → approve with correct sha256 | rejected，reason 含 `[READ-BEFORE-APPROVE]` |
| A3 | S3 shell sha256 bypass | rejected，不能因 hash 正确放行 |
| A4 | same agent + same path + different OpenCode session | rejected，证明 session-bound 生效 |
| A5 | same agent + same path + same OpenCode session | approved |
| A6 | read-audit lib load failure in strict/locked | rejected + `READ_BEFORE_APPROVE_UNAVAILABLE` ERROR |
| A7 | advisory mode read-audit unavailable | warn + allow，日志可审计 |
| A8 | verifyNonEmptyReadSet empty filePaths | rejected/fail-closed |
| A9 | Check 59 更新 | 验证 plugin registration、DB table、context helper、session-bound read test |
| A10 | E2E evidence pack | 每个场景有 MCP 返回体、DB 查询、日志引用 |

_E2E execution by @Super-Admin × 3 (parallel), orchestrated by @Orchestrator. All findings documented for review._
