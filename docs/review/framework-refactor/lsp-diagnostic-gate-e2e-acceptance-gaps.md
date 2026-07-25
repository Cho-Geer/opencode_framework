# LSP Diagnostic Gate — Current E2E Acceptance Gaps

**日期**: 2026-06-27  
**状态**: 根据当前框架代码、参考方案文档与本地验证结果更新  
**参考文档**:
- `docs/review/framework-refactor/lsp-diagnostic-gate-implementation-plan.md`
- `docs/review/framework-refactor/dispatch-shell-checklist-gaps-fix-plan-20260627.md`
- `docs/official_docs/opencode/lsp/lsp-hook-integration-analysis.md`
- `docs/official_docs/opencode/plugins/plugin-hook-reference.md`
- `docs/official_docs/framework/plugin-programming-conventions.md`

---

## 1. 结论

`diagnostic_state` **保存于 SQLite DB 的 `substate_kv` 表**，key 为 `diagnostic_state`，payload 存在 `json` 列中。默认 DB 文件为：

```text
.opencode/state/framework-state.db
```

如果设置了环境变量，则使用：

```text
FRAMEWORK_DB_PATH=<custom sqlite path>
```

当前框架是 DB-only / DB-canonical：`.opencode/state/diagnostic-state.json` 不是当前读写源，只能理解为 `SUBSTATE_FILES` 的历史/类型映射名或 frozen snapshot 语义。

当前 LSP diagnostic gate 的主要代码修复已经完成：before hook 参数位置、`runTscDiagnostic()` 三态、safe_shell 多路径、schema 残留、`runAllChecks()` 旧 tsc 路径、DB 写失败日志均已修复或接线。最新验证暴露的阻塞点已经从 LSP 单点实现转移到 dispatch route、approval read context、P0 checklist 主会话启动、gate approval lock、caller identity 与 TypeScript baseline。

本次复核的关键修正：

1. 用户给出的 `.task_temp/._logs/` 路径不存在；当前框架日志目录是 `.task_temp/_logs/`。
2. G-2 的原根因“不记录 Orchestrator read”与当前日志不符；日志已出现 `@Orchestrator | READ_TRACKED`，审批阻塞应优先落到 G-3 的 approval context/hash 失配修复。
3. G-1、G-3、G-5、G-6、G-7、G-8 有当前代码或日志证据支持；G-4 有部分代码修复，但日志仍显示启动阶段 checklist blocker，因此仍保留为 open gap。

---

## 2. diagnostic_state 保存位置

### 2.1 DB 文件路径

`.opencode/lib/db-manager.ts:57-63`：

```text
export const DB_FILENAME = "framework-state.db";
export function getDbPath(root?: string): string {
  const envPath = process.env.FRAMEWORK_DB_PATH;
  if (envPath) return envPath;
  return path.join(resolveStateDir(root), DB_FILENAME);
}
```

`.opencode/lib/db-manager.ts:39-55` 说明默认 state dir 是 `.opencode/state`。

### 2.2 DB 表

`.opencode/lib/db-manager.ts:303-313`：

```text
CREATE TABLE IF NOT EXISTS substate_kv (
  key        TEXT PRIMARY KEY,
  json       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)
```

`.opencode/lib/db-manager.ts:191-197`：

```text
typed sub-state tables REMOVED (v7)
All sub-state I/O uses substate_kv JSON blob (dbReadSubState/dbWriteSubState).
```

### 2.3 读写 API

`.opencode/lib/substate-manager.ts:1-6`：

```text
DB (SQLite) is now the single source of truth for all sub-states.
JSON files remain on disk as frozen snapshots ... but are no longer read or written by this module.
```

`.opencode/lib/substate-manager.ts:44-55`：

```text
readSubState(key) -> dbReadSubState(key)
```

`.opencode/lib/substate-manager.ts:63-77`：

```text
writeSubState(key, value) -> dbWriteSubState(key, value)
```

`.opencode/lib/db-state-manager.ts:48-58`：

```text
SELECT json FROM substate_kv WHERE key = ?
return JSON.parse(row.json)
```

`.opencode/lib/db-state-manager.ts:146-170`：

```text
dbAtomicWriteSubState(key, modifyFn)
SELECT json FROM substate_kv WHERE key = ?
INSERT OR REPLACE INTO substate_kv (key, json, updated_at) VALUES (?, ?, ?)
```

### 2.4 当前 DB 实测

本地查询：

```bash
bun -e "const { getDb } = require('./.opencode/lib/db-manager'); const db=getDb(); console.log(db.query('SELECT key, substr(json,1,300) AS preview, updated_at FROM substate_kv WHERE key = ?').get('diagnostic_state'))"
```

输出摘要：

```json
{
  "key": "diagnostic_state",
  "preview": "{\"files\":{},\"last_updated\":\"2026-06-26T17:14:00.153Z\"}",
  "updated_at": 1782494040153
}
```

这证明当前 `diagnostic_state` 已在 SQLite `substate_kv` 中存在。

---

## 3. 当前已完成项

| 项 | 当前状态 | 证据 |
|---|---:|---|
| DB-only 存储 | ✅ | `substate-manager.ts:1-6` 声明 DB-only；`db-state-manager.ts:54` 从 `substate_kv` 读 |
| `diagnostic_state` 类型注册 | ✅ | `substate-manager.ts:24-25` deprecated `type_check_state`，注册 `diagnostic_state` |
| before hook 参数位置 | ✅ | `tsc-diag-track.ts:106-115` 注释并使用 `output.args` |
| safe_shell 多路径目标 | ✅ | `tsc-diag-track.ts:21-25` 引入 `getEffectivePathScopePaths`；`39-45` 过滤 TS/TSX targets |
| `runTscDiagnostic()` 三态 | ✅ | `code-quality-lib.ts:482-512` 区分 `unknown`、target errors、`target_clean_project_dirty` |
| DB 写失败可观测 | ✅ | `tsc-diag-track.ts:181-193`, `202-214`, `223-243` 检查 `atomicWriteSubState()` 返回值并写 `TSC-DIAG-DB-WRITE-FAILED` |
| schema 中 `type_check_state` required 残留 | ✅ | `machine.schema.full.json:7-20` required 中只有 `diagnostic_state`，无 `type_check_state` |
| `runAllChecks()` 旧 tsc 路径 | ✅ | `code-quality-lib.ts:827-829` 明确移除 tsc check，由 plugin 维护 `diagnostic_state` |
| output.parts 禁改 | ✅ | `framework-self-test.ts` Check 67-69 当前通过 |

---

## 4. Logs Checked

用户给出的 `.task_temp/._logs/` 未命中当前工作区日志；当前配置与文件系统均指向 `.task_temp/_logs/`：

- `.opencode/project.config.json:280`：`"dir": ".task_temp/_logs"`。
- `rg --files .task_temp | rg '(^|/)\._logs/|(^|/)_logs/'` 输出包含 `.task_temp/_logs/index.json`、`.task_temp/_logs/plugin-session-loaded.txt`、`.task_temp/_logs/plugin-session-hooks.txt`。

本次复核读取的日志源：

| 日志源 | 用途 |
|---|---|
| `.task_temp/_logs/index.json` | 确认 centralized log registry 与插件日志路径 |
| `.task_temp/_logs/2026-06-26/plugin-dispatch-before-runtime.log` | 确认 ROUTE-MISMATCH、GATE-APPROVAL-LOCK、M14 caller 空 |
| `.task_temp/_logs/2026-06-26/plugin-read-track-after-runtime.log` | 复核 Orchestrator read 是否被记录 |
| `.task_temp/_logs/2026-06-26/plugin-lib-approval-read-context-runtime.log` | 确认 approval context lookup missing |
| `.task_temp/_logs/2026-06-26/plugin-checklist-before-runtime.log` | 确认 P0 checklist preflight blocker |
| `.task_temp/_logs/2026-06-26/plugin-execution-checklist-runtime.log` | 确认 checklist item pass/fail 与 run 复用情况 |
| `.task_temp/_logs/2026-06-26/plugin-tool-dispatch-subagent-runtime.log` | 对比 custom tool 与 plugin 侧 caller identity 差异 |

---

## 5. 当前仍存在的 Gaps

### G-1 [P0]: dispatch ROUTE-MISMATCH keyword 碰撞

**复核结论**: 属实，但根因不是简单的 `@Guardian` 一条规则，而是 L1 keyword route 在缺少 DAG/planned-target 优先级时会把验收、review、验证类任务硬路由到与用户指定 target 不一致的 agent。

**证据**:

- `.opencode/project.config.json:1046-1052`：`route_rules.enforcement.dispatch` 是 `block`，`dispatch_exempt_agents` 只有 `["@Meta-Planner", "@Super-Admin"]`。
- `.opencode/project.config.json:1081-1092`：Guardian 规则名为 `审查_合规_验证`，keywords 包含 `"验证"`、`"review"`、`"audit"`、`"lint"`、`"check"`。
- `.opencode/lib/route-validator.ts:208-247`：`l1_verbCandidates()` 对 task description 执行 `\bkeyword\b` 匹配并返回候选 agent；注释只说明防 substring，不解决完整 keyword 本身过宽的问题。
- `.task_temp/_logs/2026-06-26/plugin-dispatch-before-runtime.log` 出现：`ERROR | DISPATCH-BEFORE | ROUTE-MISMATCH | task="PING — 验证 dispatch 路由已修复... | dispatched_to=@explore | expected=@Guardian`。

**修复方案**:

1. 在 `dispatch-before.ts` 中增加 “DAG planned target authoritative” 分支：当 `dag_task_id` 存在且 `Task.DAG.json` 的任务 agent 与 dispatch target 一致时，route keyword 只做 advisory log，不再覆盖 planned target。
2. 保留 Permission Matrix 与 framework-enforcer 的写权限硬阻断：planned target 只能绕过 keyword ambiguity，不能绕过 path/scope 权限。
3. 将 `review/check/验证` 从 hard route 改为低权重 signal，或仅在 task description 同时包含审查对象与审查动作时命中 Guardian。
4. 新增 E2E：路径含 `/review/`、描述含 `验证`、target 为 `@Meta-Planner` 或 `@Architect` 且 DAG 中有对应 task 时不得 ROUTE-MISMATCH。

### G-2 [P0]: READ-BEFORE-APPROVE 原根因不成立，需转为回归保护

**复核结论**: “read-track-after 不记录 Orchestrator read” 与当前日志不符。当前确实有 Orchestrator read 事件；审批阻塞不应继续归因于 read-track-after 只记录 dispatched sub-agent。

**证据**:

- `.opencode/plugins/read-track-after.ts:29-33`：hook 覆盖 `read` / `Read` 工具。
- `.opencode/plugins/read-track-after.ts:48-56`：无条件调用 `recordRead({ agent, filePath, sessionId, taskId, callId })`。
- `.task_temp/_logs/2026-06-26/plugin-read-track-after-runtime.log` 出现多条 `@Orchestrator | INFO | READ_TRACKED`，包括 `HANDOVER.md`、`handover-cross-audit-verification.md`、`Task.DAG.json`。

**修复方案**:

1. 不按原建议重写 `read-track-after.ts`；当前应保留“记录所有 read”的行为。
2. 增加回归测试：primary `@Orchestrator` 读取 `HANDOVER.md` 后，`read_audit` 必须存在对应 `session_id + file_path + agent` 行。
3. 将审批失败诊断优先串到 G-3：当 read 已记录但 approval 失败时，错误信息必须输出 `gate_session_id`、`args_hash`、`resolved handover path`、`read_audit matching rows count`。

### G-3 [P0]: approval_read_context hash 校验不一致

**复核结论**: 属实。插件侧记录 approval context 与 MCP 工具侧读取 context 使用的 hash 参数名不一致，导致 `getApprovalContext()` 查不到记录。

**证据**:

- `.opencode/plugins/gate-before.ts:323-328` 计算 hash 的字段是 `session_id`、`approval_decision`、`handover_sha256`、`agent_id`。
- `.opencode/scripts/mcp-tools/compliance-gate.ts:2671-2676` 计算 hash 的字段是 `gate_session_id`、`approval_decision`、`handover_sha256`、`agent_id`。
- `.opencode/lib/approval-read-context.ts:62-65` 使用传入对象的 sorted keys 直接 hash，字段名不同会产生不同 hash。
- `.task_temp/_logs/2026-06-26/plugin-lib-approval-read-context-runtime.log` 多次出现：`APPROVAL_READ_CONTEXT_MISSING | No approval context found for this gate session + args hash`。

**修复方案**:

1. 在 `.opencode/lib/approval-read-context.ts` 新增唯一 canonical builder：

```ts
export function buildApprovalArgsHashInput(args: {
  gate_session_id?: string;
  session_id?: string;
  approval_decision?: string;
  handover_sha256?: string;
  agent_id?: string;
}) {
  return {
    gate_session_id: args.gate_session_id || args.session_id || "",
    approval_decision: args.approval_decision || "",
    handover_sha256: args.handover_sha256 || "",
    agent_id: args.agent_id || "",
  };
}
```

2. `gate-before.ts` 与 `compliance-gate.ts` 都只能调用 `computeApprovalArgsHash(buildApprovalArgsHashInput(args))`。
3. `approval-read-context` 日志记录 hash input keys 与 canonical `gate_session_id`，避免再次出现 “missing but unreadable”。
4. E2E 验收：同一 approve 调用中 `recordApprovalContext()` 写入后，`getApprovalContext()` 必须用同一个 args hash 命中。

### G-4 [P1]: P0 Checklist 主会话启动阻塞

**复核结论**: 部分属实。当前代码已经尝试给 DAG-exempt 主会话自动标记 preflight，但执行顺序与 run/task_id 绑定仍会让主会话在早期工具调用中被 blocker 阻断。

**证据**:

- `.opencode/lib/execution-checklist.ts:157-180`：preflight 阶段包含 `dag_entry_verified`、`agent_scope_resolved`、`domain_resolved`、`module_scope_declared`。
- `.opencode/lib/execution-checklist.ts:600-611`：main-agent/DAG-exempt run 创建时只自动通过 `dispatch_payload` 与 `dag_entry_verified`，没有在同一处原子通过 `agent_scope_resolved`、`domain_resolved`、`module_scope_declared`。
- `.opencode/plugins/session.ts:563-617`：chat.message hook 里另行尝试为 DAG-exempt main-agent 标记 `agent_scope_resolved`、`domain_resolved`、`module_scope_declared`。
- `.task_temp/_logs/2026-06-26/plugin-checklist-before-runtime.log` 仍出现 `P0-CHECKLIST-BLOCKED | phase=preflight blockers=[[object Object]...]`。

**修复方案**:

1. 将 DAG-exempt 主会话的 preflight auto-pass 从 `session.ts` chat hook 下沉到 `createChecklistRun()` 或 `checklist-before` 的同一事务路径。
2. 对 primary `@Orchestrator`、`@Meta-Planner`、`@Super-Admin` 使用 `agent_domain_map` fallback 自动解析 domain；解析失败时阻断信息必须给出可执行 remediation。
3. 所有自动标记必须使用同一个 `opencode_session_id + task_id` run，禁止产生 null-task run 或 task_id split。
4. 把 blocker 日志从 `[[object Object]]` 改成结构化 JSON，至少包含 `item_key`、`status`、`remediation`。

### G-5 [P1]: dispatch GATE-APPROVAL-LOCK 串行化

**复核结论**: 属实。当前 dispatch-before 会在存在未消费的 `delivered` 或 `approved` gate session 时直接阻断新 dispatch。

**证据**:

- `.opencode/plugins/dispatch-before.ts:243-283` 查询 `gate_sessions WHERE status IN ('delivered', 'approved') AND consumed_at IS NULL`，命中后抛出 `[FW-ENFORCE][GATE-APPROVAL-LOCK]`。
- `.task_temp/_logs/2026-06-26/plugin-dispatch-before-runtime.log` 出现：`ERROR | GATE-APPROVAL-LOCK | BLOCKED | 2 unapproved sessions: cg_ses_1782490953496, cg_ses_1782491819809`。
- `.opencode/project.config.json:146-152` 已有 `gate_stale_thresholds.delivered_hours` 与 `approved_hours`，但该 lock 查询没有应用 stale/timeout 释放策略。

**修复方案**:

1. 新增 `compliance_gate_bulk_review_deliverables(session_ids, decision, evidence)` MCP 工具，支持 Orchestrator 一次性 approve/reject 多个 delivered sessions。
2. dispatch-before 保持 fail-closed，但允许 Orchestrator 派遣与审批清理相关的 exempt task，例如 `@Guardian` 审批复核或 `@Meta-Planner` 状态修复；禁止借此写业务代码。
3. 对超过 `gate_stale_thresholds.delivered_hours` 的 delivered session 进入 `stale_delivered` 状态，要求显式 reject/approve，不继续静默阻塞所有新派遣。
4. 日志必须写入 `gate_session_id[]`、`age_ms`、`declared_deliverables[]`，并进入 central log index。

### G-6 [P1]: M14 Caller 身份为空

**复核结论**: 属实，但需要精确定义为 plugin-side identity resolution gap，而不是笼统断言 OpenCode runtime 一定未传 `context.agent`。

**证据**:

- `.opencode/tools/dispatch_subagent.ts:291` 与 `:407` 都使用 `context.agent || ""`。
- `.opencode/plugins/dispatch-before.ts:61` 使用 `const caller = resolveAgent(input.sessionID) || "";`，plugin hook 侧并不直接使用 MCP tool 的 `context.agent`。
- `.task_temp/_logs/2026-06-26/plugin-dispatch-before-runtime.log` 出现：`enter | caller= | target=Coder-BE`，随后 `M14 BLOCKED | caller= is a sub-agent`。
- 同时 `.task_temp/_logs/2026-06-26/plugin-tool-dispatch-subagent-runtime.log` 出现 `caller=Orchestrator`，说明 custom tool 侧并非总是空，plugin 侧 resolver 与 tool context 存在分裂。

**修复方案**:

1. 新增统一 `resolveCallerIdentity(input, contextLike?)`，优先级为：OpenCode hook/tool context agent、`session_map.agent`、DB gate session agent、最近 read/write audit agent、环境变量 fallback。
2. `dispatch-before.ts`、`dispatch_subagent.ts`、route-validator 只能调用该统一 resolver。
3. caller 仍为空时，不得误报 “caller is a sub-agent”；应返回 `CALLER-IDENTITY-UNRESOLVED`，附 remediation：先写 session_map 或重新绑定 primary agent。
4. E2E 覆盖：primary session、same-agent subtask、different-agent subtask、Task child session 四类 caller 解析，全部写入 central logs。

### G-7 [P1]: 根 `npx tsc` 仍有 715 条预存 TS 错误

**复核结论**: 属实。当前问题已不是先前单一 `bun-types` 缺失，而是 `.opencode/` 代码库存在大量预存 TS 错误，导致 LSP diagnostic gate 容易被全量 baseline 噪声污染。

**证据**:

- 本地命令 `npx tsc --noEmit --pretty false > /tmp/tsc-current-lsp-gap.txt 2>&1; rg -c "error TS" /tmp/tsc-current-lsp-gap.txt` 输出 `715`。
- 同一输出前几条包括：

```text
.opencode/lib/__tests__/gate-core.test.ts(107,18): error TS2552: Cannot find name 'generateSessionId'. Did you mean 'generateGateSessionId'?
.opencode/lib/__tests__/gate-core.test.ts(115,27): error TS2552: Cannot find name 'createSession'. Did you mean 'createGateSession'?
.opencode/lib/__tests__/safe-bash-core.test.ts(13,3): error TS2451: Cannot redeclare block-scoped variable 'DEFAULT_ALLOWLIST'.
```

**修复方案**:

1. 不让每次 write gate 直接等价于 “全仓库 tsc 必须为 0”。`diagnostic_state` 应记录 target file diagnostic 与 project baseline 的差分。
2. 新增 DB-canonical `diagnostic_baseline`，存储当前已知全量 TS 错误 hash，不写 JSON 文件。
3. LSP gate 阻断条件改为：
   - touched target 新增 error：block；
   - touched target 原有 error 数增加：block；
   - project baseline 有旧 error 但 touched target clean：记录 `target_clean_project_dirty`，不阻断本次无关写；
   - baseline hash 变化但 target clean：要求运行 baseline refresh task，不直接误伤普通写。
4. 逐步清理 715 条 TS 错误，优先清理 tests 顶层 const 冲突、缺失 rename export、过宽 any/nullability。

### G-8 [P2]: 注释漂移 JSON split 语义

**复核结论**: 属实。

**证据**:

- `.opencode/lib/gate-checks.ts:257`：`eslint_state, diagnostic_state, format_state) live in separate files.`。
- `.opencode/lib/gate-core.ts:2012-2013`：`eslint_state, diagnostic_state, dependency_state, and format_state live in separate JSON files under .opencode/state/.`
- 当前 DB-only 证据仍是 `.opencode/lib/substate-manager.ts:1-6`：sub-state 读写以 SQLite 为 single source of truth。

**修复方案**:

将上述注释改成：

```text
Sub-states are read through readSubState()/atomicWriteSubState() from SQLite substate_kv.
JSON snapshots, if present, are frozen historical artifacts and not canonical.
```

---

## 6. 子系统符合性矩阵

| 子系统 | 当前状态 | 需要补齐 |
|---|---:|---|
| Layout Architecture Subsystem | ⚠️ | G-1 需要 DAG planned target 优先于 keyword hard route；G-6 需要统一 identity resolver |
| DB-only and DB-canonical based | ✅/⚠️ | `diagnostic_state` 已存 SQLite `substate_kv`；G-7 的 baseline 也必须进 DB，G-8 注释需移除 JSON canonical 误导 |
| Permission Matrix Subsystem | ⚠️ | G-1 planned-target bypass 只能绕过 keyword ambiguity，不能绕过 path/scope 写权限 |
| Session/Same-Agent/Different-Agent/Task Concurrency Safe | ⚠️ | G-4/G-6 需要覆盖 primary、same-agent、different-agent、Task child session |
| Hardened Enforcement Subsystem | ⚠️ | G-3/G-5 必须 fail-closed，但错误需可诊断且提供审批清理路径 |
| Framework Harness Subsystem | ⚠️ | 已有 `.opencode/scripts/e2e/lsp-diagnostic-gate-e2e.ts`，但还需加入 G-1~G-6 的 dispatch/gate/checklist E2E |
| Central State Management Subsystem | ✅/⚠️ | substate 读写是 DB；approval context/hash 与 diagnostic baseline 需继续统一到 DB canonical |
| Multi-Agent Subsystem | ⚠️ | G-1/G-5/G-6 当前直接影响多 agent dispatch 与审批流并行能力 |
| Log Central Management Subsystem | ⚠️ | 日志已集中在 `.task_temp/_logs/`；需补 approval hash input、checklist blocker JSON、gate lock age_ms |
| DB-canonical Management Subsystem | ✅/⚠️ | `substate_kv` key-value JSON blob 是事实；禁止为 diagnostic baseline 或 approval context 引入 JSON dual-write |
| Templatization & Parameterization Universality Subsystem | ⚠️ | E2E 必须参数化 `FRAMEWORK_DB_PATH`、project root、task_id、agent、domain，不绑定 booking-system |
| TypeScript + Bun Based Runtime Subsystem | ❌ | G-7 当前 `npx tsc --noEmit` 有 715 条错误，必须 baseline 化或分阶段清零 |

---

## 7. 与参考文档的一致性判断

### `lsp-diagnostic-gate-implementation-plan.md`

满足 DB-only / DB-canonical 方向。关键证据：

```text
diagnostic_state 通過 atomicWriteSubState 寫入 substate_kv 表；無 JSON 雙寫
子狀態存儲在 substate_kv SQLite 表，無 DB 遷移
```

需要注意：文档中提到 `SUBSTATE_FILES.diagnostic_state -> "diagnostic-state.json"`，这只是类型/映射遗留语义，不代表当前写 JSON 文件。

### `dispatch-shell-checklist-gaps-fix-plan-20260627.md`

满足本次 DB-only 口径。该文档明确：

```text
checklist、session_map、read-audit、write-audit 继续以 SQLite 为 source of truth；禁止恢复 JSON dual-write
```

它不是 LSP diagnostic 专项文档，但与 `diagnostic_state` 的 DB-canonical 要求不冲突。

### 本文件

已更新为当前代码事实：保留 `diagnostic_state` DB-only 结论，替换过期 gaps，并将最新验证的 G-1~G-8 按日志和代码证据重新归因。G-2 的原根因被当前日志推翻，已改成回归保护与 G-3 hash 修复项。

---

## 8. 验收命令

```bash
bun --check .opencode/plugins/tsc-diag-track.ts
bun --check .opencode/scripts/mcp-tools/code-quality-lib.ts
npx tsc --noEmit --incremental --pretty false --tsBuildInfoFile .opencode/state/.tsbuildinfo
bun .opencode/scripts/framework-self-test.ts
FRAMEWORK_DB_PATH=/tmp/lsp-diagnostic-gate-e2e.db bun .opencode/scripts/e2e/lsp-diagnostic-gate-e2e.ts
```

当前已知：
- `npx tsc --noEmit --pretty false` 当前输出 715 条 `error TS`，不再是单一 `bun-types` 缺失。
- dispatch/gate/checklist 的 E2E 需要新增 G-1~G-6 场景，不能只跑 LSP diagnostic gate isolated DB harness。
- 验收日志必须落到 `.task_temp/_logs/`，并由 `.task_temp/_logs/index.json` 可索引。

---

*本文件已按 2026-06-27 当前框架代码更新。*
