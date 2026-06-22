# DB-Canonical P0 Checklist Optimization Plan

**生成日期**: 2026-06-22  
**复核更新**: 2026-06-22 — 当前框架更新后复审，方案仍适用，已补充 UC7-003、declared deliverables HANDOVER 路径、dispatch/session DB 化进展。  
**状态**: 待实施方案  
**适用范围**: 当前 OpenCode 本地框架 `.opencode/`、根配置、`.task_temp/` 运行态、`docs/review/framework-refactor/` 方案文档。业务代码仅作为权限与写入目标消费者。  
**目标**: 将长 P0 协议模板收敛为 DB-canonical 阶段性 checklist 状态机，减少子 Agent prompt 负担，同时用 TypeScript/Bun 插件、OpenCode custom tools、MCP gate、统一日志与 Harness 物理保证执行稳定性。  

---

## 1. 结论

最优实施路径是：**不再把 200+ 行 P0 协议作为主要执行保障，而是把 P0 协议拆成 DB 中的阶段项，由已有工具成功调用后写入 checklist 状态，再由 `tool.execute.before` 插件在写入、派遣、提交、审批等关键节点阻断未完成阶段。**

这条路径同时满足三个诉求：

1. **精简 Prompt**: 子 Agent prompt 先放任务 payload，再放 40-70 行短 P0 指令；长表格、长流程、错误恢复说明进入 DB policy、工具返回值和文档，不再每次注入。
2. **缓解注意力稀释**: 模型不需要长期记忆所有 P0 规则；每个阶段只需调用 `checklist_status` 或响应工具返回的 pending blockers。
3. **保证可靠性**: 是否能写、能派遣、能提交、能审批由 DB 状态和 before hook 决定，不由模型是否记住模板决定。

运行态事实必须 DB-canonical。`opencode.json`、`.opencode/agents/*.md`、`.opencode/plugins/*.ts`、`.opencode/tools/*.ts`、`docs/official_docs/**` 等仍按官方 OpenCode 要求保留为文件，因为 OpenCode 的配置、插件、工具和 read evidence 都依赖文件系统发现；但框架运行态状态、执行阶段、证据、队列、决策和检查结果以 `.opencode/state/framework-state.db` 为唯一真实来源。

---

## 2. 当前代码事实

| 子系统 | 当前事实 | 方案影响 |
| --- | --- | --- |
| P0 Prompt | `.opencode/subagent-preamble.md` 当前约 243 行，dispatch prompt 中任务正文位于 P0、deliverables、agent config、project context 之后 | 必须瘦身并改为 task payload first |
| Dispatch | `.opencode/scripts/command-tools/dispatch-subagent.ts` 生成 full prompt 和 `DISPATCH_TOKEN`；`.opencode/tools/dispatch_subagent.ts` 使用 Bun 执行脚本；`task-before.ts` 从 auto-dispatch queue 读取 prompt 并校验 hash | 在 dispatch 入口增加 payload 完整性验证与 DB payload 记录 |
| Gate | `compliance-gate.ts` 已验证 declared deliverables、submit order、approval hash、read-before-approve、logs checked、findings | 将 gate 成功事实写入 checklist items |
| Config Attest | `config_read_attest.ts` 使用 OpenCode custom tool 形态，读 `read_audit` 并写 DB substate | 成功后写入 `config_read_attested` checklist item |
| UC7KS | `knowledge_cache_attest.ts` 已拒绝空 `files_read`，校验 discovery、manifest、read_audit，并写 typed knowledge tables | 成功后写入 `knowledge_attested` checklist item |
| Scope | `scope-before.ts` 当前分别检查 opencode.json 权限、route、config read、UC7KS | 保留这些权威检查，同时增加统一 checklist 前置层 |
| DB | `db-manager.ts` 当前已有 WAL、busy_timeout、schema v17、dispatch/gate/knowledge/read_audit/approval tables | 新增 schema v18 checklist 与 payload integrity 表 |
| Log | `log-manager.ts` 已统一 `writeLog(source, category, fields)` 到 `.task_temp/_logs` | 所有 checklist 状态变化必须写 DB event + `writeLog` |
| Harness | `framework-self-test.ts` 仍有检查依赖长 preamble 文本，如 Step 0d、Step 0e、question protocol | 必须先改成验证短标记、DB schema、工具接线、插件阻断 |

### 2.1 当前框架更新后的修订结论

当前框架已有若干更新，不改变本方案方向，但会改变实施落点：

| 更新点 | 当前代码事实 | 对本方案的修订 |
| --- | --- | --- |
| Orchestrator 模型 | `.opencode/agents/Orchestrator.md` 与 `opencode.json` 已从 `deepseek/deepseek-v4-flash` 切到 `deepseek/deepseek-v4-pro` | 不改变方案。模型升级不能替代 checklist 物理约束；短 prompt + DB gate 仍是主路径 |
| 并发 domain/task 解析 | `agent-resolver.ts` 多 ctx 文件场景已改为交叉检查 `dispatch:child:{dagTaskId}` child slot，不再按 newest ctx 猜测 | checklist run 创建必须复用 child slot / `session_map` 作为 session-context 事实源 |
| Dispatch resume | `dispatch-subagent.ts` resume 分支已用 `dbQueryLatestSessionByDagTaskId()` 查询 `session_log` | checklist 不再设计任何 `SESSION_ID.md` 或文件式 resume fallback |
| HANDOVER 路径 | `compliance-gate.ts` approval、Step 0d audit、read-before-approve 已优先读取 `declared_deliverables[].artifact_path` 中的 `HANDOVER.md` | checklist 的 `handover_hash_bound` 与 `read_before_approve_verified` 必须绑定 declared artifact path，禁止硬编码 `.task_temp/{taskId}/HANDOVER.md` |
| UC7-003 | `uc7ks-after.ts` 已新增 post-write save-or-fail 验证，事件包括 `UC7-003-VERIFIED`、`UC7-003-MISSING`、`UC7-003-STATE-UPDATED` | 不再新增 UC7-003 逻辑；改为把现有 UC7-003 事件映射为 checklist item `knowledge_post_write_verified` |
| UC7-003 E2E 文档 | `uc7-003-e2e-findings.md` 记录了 post-write verification 对 Orchestrator 不可见、domain-first discovery 缺口、E2E pending 步骤 | 本方案必须把 UC7-003/UC7-007 可见性纳入 DB checklist，并要求 `knowledge_cache_search` 先按 `domain` 字段匹配 |

---

## 3. 目标架构

### 3.1 DB 状态机

新增 schema v18，所有阶段推进以 DB 为准：

```sql
CREATE TABLE IF NOT EXISTS execution_checklist_runs (
  run_id              TEXT PRIMARY KEY,
  opencode_session_id TEXT NOT NULL,
  parent_session_id   TEXT,
  task_id             TEXT,
  agent               TEXT NOT NULL,
  domain_id           TEXT,
  worktree            TEXT,
  phase               TEXT NOT NULL,
  status              TEXT NOT NULL,
  task_payload_hash   TEXT,
  payload_ref         TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  completed_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ecr_session
  ON execution_checklist_runs(opencode_session_id);
CREATE INDEX IF NOT EXISTS idx_ecr_task
  ON execution_checklist_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_ecr_agent_status
  ON execution_checklist_runs(agent, status);

CREATE TABLE IF NOT EXISTS execution_checklist_items (
  item_id       TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES execution_checklist_runs(run_id),
  item_key      TEXT NOT NULL,
  phase         TEXT NOT NULL,
  required_when TEXT NOT NULL,
  status        TEXT NOT NULL,
  blocking      INTEGER NOT NULL DEFAULT 1,
  verifier      TEXT NOT NULL,
  evidence_ref  TEXT,
  fail_reason   TEXT,
  remediation   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(run_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_eci_run_status
  ON execution_checklist_items(run_id, status);
CREATE INDEX IF NOT EXISTS idx_eci_item
  ON execution_checklist_items(item_key);

CREATE TABLE IF NOT EXISTS execution_checklist_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL,
  item_id      TEXT,
  event_type   TEXT NOT NULL,
  actor        TEXT,
  tool_name    TEXT,
  old_status   TEXT,
  new_status   TEXT,
  evidence_ref TEXT,
  message      TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ece_run_created
  ON execution_checklist_events(run_id, created_at);

CREATE TABLE IF NOT EXISTS dispatch_payload_integrity (
  payload_id          TEXT PRIMARY KEY,
  dispatch_ref_id     TEXT,
  parent_session_id   TEXT,
  agent_type          TEXT NOT NULL,
  dag_task_id         TEXT,
  task_description    TEXT NOT NULL,
  normalized_payload  TEXT NOT NULL,
  sha256              TEXT NOT NULL,
  completeness_status TEXT NOT NULL,
  completeness_error  TEXT,
  prompt_path         TEXT,
  created_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dpi_session
  ON dispatch_payload_integrity(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_dpi_task
  ON dispatch_payload_integrity(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_dpi_status
  ON dispatch_payload_integrity(completeness_status);
```

### 3.2 阶段定义

| Phase | 必须完成项 | 写入者 | 阻断点 |
| --- | --- | --- | --- |
| `dispatch_payload` | `payload_complete`, `dispatch_token_created`, `session_context_bound` | `dispatch_subagent`, `dispatch-subagent.ts`, `task-before.ts`, `session_map` child slot | Task 派遣、子 Agent 首次写入 |
| `preflight` | `dag_entry_verified`, `agent_scope_resolved`, `domain_resolved`, `module_scope_declared` | `dispatch-before.ts`, `resolve_domain_id`, `module_scope_declare` | 所有 modify tools |
| `read_attest` | `config_read_attested`, `knowledge_search_completed`, `knowledge_attested` | `config_read_attest`, `knowledge_cache_search`, `knowledge_cache_attest` | 所有受控文件写入 |
| `gate_armed` | `compliance_gate_checked`, `compliance_gate_armed`, `deliverables_declared` | `compliance_gate_check`, `compliance_gate_confirm` | 执行阶段写入、submit |
| `execute` | `task_log_written`, `required_logs_checked`, `findings_section_present`, `knowledge_post_write_verified` | submit/approve gate + file evidence verifier + existing `uc7ks-after.ts` UC7-003 events | submit/approve |
| `deliver` | `deliverables_submitted`, `handover_hash_bound`, `declared_handover_path_bound` | `compliance_gate_submit_deliverables` | complete/approve |
| `close` | `read_before_approve_verified`, `deliverables_approved`, `gate_closed` | `compliance_gate_approve_deliverables`, `compliance_gate_complete` | 后续 DAG 调度 |

所有 item 的 `required_when` 必须由 `.opencode/project.config.json` 中的 `p0_checklist_policy` 解析后写入 DB run snapshot。运行时只读取 DB snapshot，不在 hot path 反复解析 JSON 文件。

### 3.3 通用 checklist 原则

1. checklist 是机器状态，不是 Markdown checkbox。
2. 每个 item 只能由对应工具、插件或 MCP gate 写入，Agent 不能直接伪造。
3. 每个阻断错误都必须返回下一步唯一动作，例如 `read unread_files then call config_read_attest(task_id)`。
4. `checklist_status` 只读 DB，返回当前 phase、pending blocking items、remediation，不修改状态。
5. 并发 session 按 `opencode_session_id + run_id` 隔离，parent/child 关系通过 `parent_session_id` 关联。
6. HANDOVER、TASK_LOG、报告文件的校验必须以 `declared_deliverables[].artifact_path` 为准；`.task_temp/{taskId}/...` 只作为 legacy fallback。
7. 写入 `docs/official_docs/**` 后的落盘事实由现有 UC7-003 after-hook 提供，checklist 只消费其事件和状态，不复制文件检查逻辑。

---

## 4. 实施步骤

### Step 1: 增加 DB schema v18

修改 `.opencode/lib/db-manager.ts`：

1. 在 `initializeSchema()` 中创建 `execution_checklist_runs`、`execution_checklist_items`、`execution_checklist_events`、`dispatch_payload_integrity`。
2. 插入 `schema_version=18`，comment 固定为 `P0-CHECKLIST: add DB-canonical execution checklist and dispatch payload integrity tables`。
3. 所有 DDL 使用 `CREATE TABLE IF NOT EXISTS` 和 `CREATE INDEX IF NOT EXISTS`。
4. migration 失败必须 `writeLog("lib-db-manager", "WARN", { event: "DB-SCHEMA-MIGRATION-SKIPPED", detail: "v18: ..." })`。

验收：

```bash
bun --no-cache .opencode/scripts/framework-self-test.ts
```

自测必须能报告 schema v18 表存在。

### Step 2: 新增 checklist DB API

新增 `.opencode/lib/execution-checklist.ts`，导出以下函数：

| 函数 | 行为 |
| --- | --- |
| `createChecklistRun(input)` | 在 `execution_checklist_runs` 创建或复用 run，并批量创建当前 agent/task 的 required items |
| `markChecklistPassed(input)` | 单事务更新 item 为 `passed`，追加 `execution_checklist_events` |
| `markChecklistFailed(input)` | 单事务更新 item 为 `failed`，写入 `fail_reason` 和 `remediation` |
| `requireChecklistPassed(input)` | 查询 blocking items；未通过时返回结构化 blockers |
| `advanceChecklistPhase(input)` | 只有当前 phase blocking items 全部 passed 才推进 |
| `getChecklistSummary(input)` | 返回 Agent 可读的 phase、pending、next_action |
| `recordDispatchPayloadIntegrity(input)` | 写入 `dispatch_payload_integrity` |
| `validateDispatchPayload(input)` | 校验任务描述完整性，返回 pass/fail 和错误 |

代码规范：

- 使用 `bun:sqlite` 现有 `getDb()`。
- 所有写入使用 `db.transaction()`。
- 不读写 JSON 状态文件。
- 不使用 `console.log`。
- 每个状态变化同时调用 `writeLog("execution-checklist", "runtime", ...)`。

### Step 3: 建立 dispatch payload 完整性门

修改 `.opencode/scripts/command-tools/dispatch-subagent.ts` 与 `.opencode/tools/dispatch_subagent.ts`：

1. 在生成 prompt 前调用 `validateDispatchPayload()`。
2. 当任务描述包含以下模式时，必须验证 payload 里存在实际内容、文件引用或 DB artifact 引用：
   - `provided below`
   - `以下`
   - `上面的`
   - `the findings`
   - `specific findings`
   - `append`
   - `追加`
   - `根据以下`
3. 对 `the 5 specific findings provided below` 但没有实际 findings 的 payload，直接拒绝 dispatch。
4. 成功后写入 `dispatch_payload_integrity`，并创建 `payload_complete` item。
5. checklist run 的 `session_context_bound` 必须读取当前 `session_map` / `session_log` / `dispatch:child:{dagTaskId}` 事实；resume 场景必须使用 `dbQueryLatestSessionByDagTaskId()` 的结果，不得恢复 `SESSION_ID.md` 文件路径。
6. 生成 prompt 时将任务 payload 移到最前面，格式固定为：

```markdown
## Task Payload

- task_id: ...
- agent: ...
- payload_sha256: ...
- payload_ref: ...

<actual task description or artifact reference>

## P0 Checklist

Call checklist_status first, then complete pending blocking items in order.
```

验收：

- 缺失 findings 的 dispatch 被拒绝，错误含 `PAYLOAD-INCOMPLETE`。
- 正常 dispatch 在 DB 中出现 `dispatch_payload_integrity.completeness_status='passed'`。

### Step 4: 新增 `checklist_status` custom tool

新增 `.opencode/tools/checklist_status.ts`：

```typescript
import { tool } from "@opencode-ai/plugin";
```

必须使用 `export default tool({ ... })`，参数：

| 参数 | 类型 | 要求 |
| --- | --- | --- |
| `task_id` | string | required |

返回 JSON 字符串：

```json
{
  "run_id": "...",
  "phase": "read_attest",
  "status": "blocked",
  "pending_blockers": [
    {
      "item_key": "config_read_attested",
      "remediation": "Read .opencode/agents/<Agent>.md, opencode.json, .opencode/project.config.json, then call config_read_attest(task_id)."
    }
  ]
}
```

权限接线：

1. 在 `opencode.json` 中为所有 Agent 开启 `checklist_status`。
2. 在 `.opencode/agents/*.md` 的工具清单中加入 `checklist_status`。
3. `framework-self-test.ts` 新增检查，确保所有非 exempt Agent 可调用该 tool。

### Step 5: 将现有工具成功事实写入 checklist

修改以下工具或 MCP 函数，成功后调用 `markChecklistPassed()`，失败时调用 `markChecklistFailed()`：

| 文件 | 成功 item |
| --- | --- |
| `.opencode/tools/resolve_domain_id.ts` | `domain_resolved` |
| `.opencode/tools/module_scope_declare.ts` | `module_scope_declared` |
| `.opencode/tools/config_read_attest.ts` | `config_read_attested` |
| `.opencode/tools/knowledge_cache_search.ts` | `knowledge_search_completed` |
| `.opencode/tools/knowledge_cache_attest.ts` | `knowledge_attested` |
| `.opencode/plugins/uc7ks-after.ts` | `knowledge_post_write_verified` |
| `.opencode/scripts/mcp-tools/compliance-gate.ts::check` | `compliance_gate_checked` |
| `.opencode/scripts/mcp-tools/compliance-gate.ts::confirm` | `compliance_gate_armed`, `deliverables_declared` |
| `.opencode/scripts/mcp-tools/compliance-gate.ts::submit_deliverables` | `deliverables_submitted`, `handover_hash_bound`, `declared_handover_path_bound` |
| `.opencode/scripts/mcp-tools/compliance-gate.ts::approve_deliverables` | `read_before_approve_verified`, `deliverables_approved` |
| `.opencode/scripts/mcp-tools/compliance-gate.ts::complete` | `gate_closed` |

必须保留现有验证逻辑。checklist 记录是统一执行状态，不替代 `read_audit`、UC7KS、permission、gate、route 的权威检查。

`knowledge_cache_search.ts` 在写入 `knowledge_search_completed` 前必须先按 `index.json` / typed DB entry 的 `domain` 字段直接匹配，再使用 `library_id -> context7_libraries` 派生匹配。这样 `library_id="e2e-test"` 但 `domain="backend_api"` 的补充测试文档能被发现并允许后续 attestation。

`uc7ks-after.ts` 已有 UC7-003 post-write save-or-fail 实现，接线规则固定为：

1. `UC7-003-VERIFIED` + `UC7-003-STATE-UPDATED` → `knowledge_post_write_verified=passed`。
2. `UC7-003-MISSING` → `knowledge_post_write_verified=failed`，strict/locked 继续沿用现有 throw。
3. `UC7-003-STATE-FAIL` → 文件写入不回滚，但 checklist event 必须记录 `evidence_ref` 缺失，供 Orchestrator/approval 阶段发现。
4. 不新增第二套 `fs.existsSync()` 检查，避免 UC7-003 逻辑分叉。

### Step 6: 新增 `checklist-before.ts` enforcement plugin

新增 `.opencode/plugins/checklist-before.ts`：

1. 使用 `withPluginLifecycle("checklist-before", { "tool.execute.before": toolExecuteBefore })`。
2. Hook 函数定义在同一模块内。
3. 对 modify tools 调用 `requireChecklistPassed()`。
4. 对 `Task` 调用要求 `payload_complete` 与 `dispatch_token_created` 已通过。
5. 对 `dispatch_subagent` 调用要求调用者符合 Multi-Agent 派遣规则，并在 DB 中创建 parent run。
6. 对 `compliance_gate_submit_deliverables` 要求 `compliance_gate_armed` 与 `deliverables_declared` 已通过。
7. 对 `compliance_gate_approve_deliverables` 要求 `deliverables_submitted`、`declared_handover_path_bound`、session-bound read evidence 已通过。
8. 当 declared deliverables 或 evidence 涉及 `docs/official_docs/**` 写入时，approve 前要求 `knowledge_post_write_verified` 已通过。

阻断规则：

- `locked` 和 `strict` 模式：未通过 blocking item 直接 `throw new Error("[FW-ENFORCE][P0-CHECKLIST] ...")`。
- `advisory` 模式：写 WARN 日志并继续，但 DB event 仍记录为 `blocked_advisory`。

日志：

```typescript
writeLog("checklist-before", "runtime", {
  sessionID: input.sessionID,
  callID: input.callID,
  agent,
  agentType: agent,
  level: "ERROR",
  event: "P0-CHECKLIST-BLOCKED",
  detail: "tool=safe_edit task_id=... blockers=config_read_attested,knowledge_attested"
});
```

### Step 7: 收敛 P0 preamble 与 prompt 生成

修改 `.opencode/subagent-preamble.md`：

1. 保留短协议，不超过 70 行。
2. 删除长日志源表、长 domain 表、长 deliverables 示例、长错误恢复说明。
3. 保留以下短标记，供自测和 Agent 定位：
   - `Step 0: checklist_status`
   - `Step 0d: Investigation evidence`
   - `## Logs Checked`
   - `Step 0e: Config Read Attestation`
   - `Subagent Interaction Protocol`
   - `Do NOT call question`
4. 将“读哪些文件、调用哪个工具、下一步是什么”交给 `checklist_status` 和工具错误返回。

修改 `.opencode/scripts/command-tools/dispatch-subagent.ts`：

1. prompt 顺序固定为 `Task Payload -> P0 Checklist -> Agent Config Pointer -> Project Context Summary -> Context7 Requirements -> Scope Line`。
2. project context 只保留当前任务相关字段。
3. Context7 只在 `relevantStacks.length > 0` 时注入。
4. deliverables 模板只注入文件名、路径和 required 标志；详细规范由 compliance gate 和 DB policy 校验。

### Step 8: 更新 Harness 与 self-test

修改 `.opencode/scripts/framework-self-test.ts`：

1. Check 34 改为检查：
   - 短 preamble 包含 `Step 0d: Investigation evidence`
   - compliance gate approval 仍强制 `## Logs Checked`
   - `execution_checklist_items` 存在 `required_logs_checked`
2. Check 47 改为检查：
   - `config_read_attest.ts` 存在并编译
   - `scope-before.ts` 或 `checklist-before.ts` 会阻断缺失 `config_read_attested`
   - DB schema v18 存在 checklist 表
   - 短 preamble 包含 `Step 0e: Config Read Attestation`
3. Check 63 改为检查：
   - 短 preamble 包含 `Subagent Interaction Protocol`
   - `question-policy-before.ts` 注册在 `opencode.json`
   - subagents 仍是 `question: deny`
4. 新增 Check 64：
   - `checklist-before.ts` 存在、注册、使用 `withPluginLifecycle`
   - `checklist_status.ts` 使用 `tool()`
   - `execution-checklist.ts` 不读写 JSON 状态文件
5. 新增 Check 65：
   - dispatch payload incomplete 用例必须失败
   - dispatch payload complete 用例必须写入 DB
6. 新增 Check 66：
   - `knowledge_cache_search(domain="backend_api")` 能发现 `domain="backend_api"` 但 `library_id` 非标准库名的条目
   - UC7-003 `UC7-003-VERIFIED` 能映射到 `knowledge_post_write_verified`
   - compliance gate approval 读取 declared `HANDOVER.md.artifact_path`，不是只读 `.task_temp/{taskId}/HANDOVER.md`

### Step 9: 多 Agent 派遣规则进入 checklist

将当前派遣约束写入 DB policy snapshot，并由 `dispatch-before.ts`、`dispatch_subagent.ts`、`checklist-before.ts` 三层执行：

1. 主 session 只能通过 `dispatch_subagent` 派遣子 Agent。
2. 子 session 中允许派遣的子子 session 只有 `Knowledge-Curator`。
3. 其他 subagent 只能存在于子 session 中，不能继续派遣非 KC subagent。
4. @Super-Admin 只允许在既有规则下直派 `Knowledge-Curator`。
5. locked 模式继续禁止自动 Super-Admin 修复派遣。

DB 记录：

- parent run 的 `execution_checklist_events` 写入 `SUBSESSION-DISPATCH-REQUESTED`。
- child run 的 `parent_session_id` 必须等于 parent OpenCode session id。
- 违规派遣写 `P0-CHECKLIST-BLOCKED` 与 `DISPATCH-ROLE-BLOCKED`。

### Step 10: 写前知识读取范围纳入 policy

在 `.opencode/project.config.json` 增加 `p0_checklist_policy.monitored_write_targets`，并在 DB run 创建时快照：

```json
{
  "p0_checklist_policy": {
    "monitored_write_targets": [
      ".opencode/**",
      "docs/review/**",
      "docs/design/**",
      "AGENTS.md",
      "contract.yaml",
      "opencode.json"
    ],
    "excluded_write_targets": [
      "logs/**",
      "**/logs/**",
      ".opencode/logs/**",
      "node_modules/**",
      "node_modles/**",
      "task_temp/**",
      ".task_temp/**"
    ]
  }
}
```

执行规则：

1. exclusion 先于 inclusion 计算，命中 `excluded_write_targets` 的路径不触发知识读取 checklist。
2. 写入 monitored target 前必须完成 `knowledge_search_completed` 和 `knowledge_attested`。
3. `knowledge_attested.files_read` 不能为空，且必须能在 `read_audit` 中匹配当前 session。
4. `.opencode/**` 框架文件仍由现有 route/permission 规则限制到 @Super-Admin；checklist 不放宽权限。
5. `docs/official_docs/**` 继续由 Knowledge-Curator 管理，作为 materialized read evidence 文件视图。

### Step 11: 日志系统集成

所有新增或修改代码必须写以下事件：

| Source | Event | 触发点 |
| --- | --- | --- |
| `execution-checklist` | `CHECKLIST-RUN-CREATED` | 创建 run |
| `execution-checklist` | `CHECKLIST-ITEM-PASSED` | item passed |
| `execution-checklist` | `CHECKLIST-ITEM-FAILED` | item failed |
| `execution-checklist` | `CHECKLIST-PHASE-ADVANCED` | phase 推进 |
| `checklist-before` | `P0-CHECKLIST-BLOCKED` | before hook 阻断 |
| `dispatch_subagent` | `PAYLOAD-INTEGRITY-PASSED` | payload 完整 |
| `dispatch_subagent` | `PAYLOAD-INTEGRITY-FAILED` | payload 缺失 |
| `mcp-compliance-gate` | `CHECKLIST-GATE-MARKED` | gate 写 checklist |
| `uc7ks-after` | `CHECKLIST-UC7-003-MAPPED` | UC7-003 现有事件映射到 checklist |

日志规范：

1. 插件和 custom tools 使用 `writeLog()`，不使用 `console.log`。
2. MCP server stdout 保持 JSON-RPC 专用；诊断只用 `process.stderr.write()` 和 `writeLog()`。
3. CLI scripts 可以保留用户可见 `console.log`，但任何审计相关事件必须同时 `writeLog()`。
4. `detail` 必须包含 `run_id`、`task_id`、`item_key`、`status`、`evidence_ref`。

---

## 5. 官方 OpenCode 规范符合性

| 类型 | 必须遵循 | 方案落点 |
| --- | --- | --- |
| Plugin | 项目插件位于 `.opencode/plugins/`；使用 TypeScript；`tool.execute.before` 可通过 throw 阻断 | `checklist-before.ts` |
| Local convention | 插件默认导出，使用 `withPluginLifecycle`；hook 函数在同一模块定义；共享逻辑放 `.opencode/lib/` | `checklist-before.ts` + `execution-checklist.ts` |
| Custom Tool | 文件位于 `.opencode/tools/`；单文件 `export default tool({...})`；参数使用 `tool.schema` | `checklist_status.ts` |
| MCP | MCP server 由 `opencode.json.mcp` command array 启动；stdout 不输出日志 | 只修改现有 `compliance-gate.ts`，不新增 MCP server |
| Script | Bun 原生执行 TypeScript；命令调用使用 `execFileSync` array，避免 shell 拼接 | 修改 `dispatch-subagent.ts` 和 self-test 时保持现有 Bun TS 模式 |
| Logging | MCP 用 stderr 诊断；插件/custom tools 使用框架 `writeLog` | 所有新增状态变化走 `writeLog` |

---

## 6. 子系统符合性矩阵

| 子系统 | 保证方式 |
| --- | --- |
| Layout Architecture System | 新增文件只放 `.opencode/lib/`、`.opencode/plugins/`、`.opencode/tools/`；不改变 OpenCode 文件发现规则 |
| Permission Matrix System | `opencode.json` 仍是权限权威源；DB checklist 只记录已验证事实，不授予新权限 |
| Concurrent session/dispatch write system | 所有 run、item、payload 按 session/run 主键隔离；SQLite transaction + WAL；不再依赖共享 Markdown checkbox |
| Hardened enforcement System | `checklist-before.ts` 在写入、派遣、提交、审批前 fail-closed；现有 `scope-before`、`gate-before`、`dispatch-before` 保留 |
| Harness System | self-test 改为验证 schema、工具、插件、阻断行为；新增 payload completeness 和 checklist gating 测试 |
| Central State Management | 运行态阶段、证据、事件全部进入 DB；`substate_kv` 只保留兼容 rollup |
| Multi-Agent System | parent/child session 显式入 DB；复用 `dispatch:child:{dagTaskId}` slot；子 session 只能派遣 Knowledge-Curator |
| Log Central Management System | DB event 是事实源，`.task_temp/_logs` 是诊断索引；所有事件有 source-aware log |
| DB management system | schema v18 idempotent migration；不使用文件复制模拟 DB；沿用 WAL 安全策略 |
| Templatization & Parameterization System For Universality | `p0_checklist_policy` 从 project config 解析后快照入 DB；prompt 模板只保留短指令 |
| TypeScript + Bun Based System | 新代码 TypeScript；使用 Bun SQLite；不引入 Python/Node-only 迁移路径 |

---

## 7. Prompt 精简后的目标形态

目标 preamble 必须控制在 70 行以内，结构固定：

```markdown
## P0 Checklist

1. Call checklist_status(task_id).
2. Complete pending blocking items in returned order.
3. Do not write before checklist_status returns no blocking item for the target tool/path.
4. If blocked, perform the exact remediation returned by the tool.

## Required Milestones

- Step 0: checklist_status
- Step 0d: Investigation evidence. Investigation tasks must produce ## Logs Checked.
- Step 0e: Config Read Attestation.
- Compliance gate must be checked/armed before execution and submitted before close.
- Subagent Interaction Protocol: Do NOT call question. Record non-blocking questions in HANDOVER.md.

## Runtime Authority

DB checklist + OpenCode plugins/tools decide whether execution may proceed.
```

任务 payload 必须放在 preamble 前。这样关键任务内容不再被 200+ 行协议推到后面。

---

## 8. 验收标准

### 8.1 静态验收

```bash
bun --no-cache .opencode/scripts/framework-self-test.ts
```

必须通过：

1. schema v18 表存在。
2. `checklist-before.ts` 注册在 `opencode.json`。
3. `checklist_status.ts` 使用 OpenCode custom tool 标准导出。
4. `execution-checklist.ts` 没有 JSON 状态文件写入。
5. 短 preamble 标记存在，self-test 不再依赖长表格。

### 8.2 行为验收

| 场景 | 预期 |
| --- | --- |
| dispatch 描述声称有 findings 但未提供 | `PAYLOAD-INCOMPLETE`，不生成 Task prompt |
| dispatch 描述提供实际 findings 或 artifact ref | 生成 prompt，DB 记录 payload hash |
| 未读 3 个配置文件就写 monitored target | `CONFIG-READ-ATTEST` 或 `P0-CHECKLIST` 阻断 |
| `knowledge_cache_attest(files_read=[])` | 拒绝，`knowledge_attested` 不通过 |
| 写 `.opencode/**` 但非 @Super-Admin | route/permission 阻断，checklist 不放行 |
| 子 session 派遣非 Knowledge-Curator | `DISPATCH-ROLE-BLOCKED` |
| submit 前未写 HANDOVER/TASK_LOG | compliance gate 拒绝，checklist 不推进 |
| approve 前未 read HANDOVER | read-before-approve 拒绝 |
| approve 使用 declared HANDOVER 路径而不是默认路径 | `declared_handover_path_bound` 通过后才允许审批 |
| investigation HANDOVER 无 `## Logs Checked` | approve 拒绝 |
| 并发两个 session 同 task_id | run_id 不同，item 状态不串线 |
| `domain="backend_api"` 且 `library_id="e2e-test"` 的知识条目 | `knowledge_cache_search` 必须发现该条目 |
| KC 写入 `docs/official_docs/**` 后没有 UC7-003 verified 事件 | submit/approve 阶段阻断 |

### 8.3 日志验收

必须能在 `.task_temp/_logs/{date}/` 找到：

1. `plugin-checklist-before-runtime.log`
2. `plugin-execution-checklist-runtime.log`
3. `plugin-dispatch_subagent-runtime.log` 或现有 source-aware 等价文件
4. `plugin-mcp-compliance-gate-runtime.log`

每次阻断必须同时存在 DB event 和 log line。

---

## 9. 实施顺序约束

必须按以下顺序提交代码，不能跳步：

1. `db-manager.ts` schema v18。
2. `.opencode/lib/execution-checklist.ts`。
3. `checklist_status.ts` custom tool + permissions 接线。
4. dispatch payload integrity 接线。
5. 现有 tools/MCP gate 成功事实写 checklist。
6. `checklist-before.ts` enforcement plugin。
7. self-test/harness 更新。
8. prompt 生成顺序调整。
9. `.opencode/subagent-preamble.md` 瘦身。
10. E2E 行为验收与日志验收。

这个顺序保证在瘦身 prompt 前，DB 状态、工具、插件和 Harness 已经具备物理约束能力。

---

## 10. 完成定义

实施完成必须同时满足：

1. 长 P0 协议不再是执行可靠性的主要来源。
2. 子 Agent 看到的任务 payload 位于 prompt 前部。
3. 所有 P0 阶段都有 DB item、verifier、evidence_ref、event。
4. 所有关键阻断由插件或 MCP gate 执行。
5. 所有审计相关事件写入 DB event 并通过 `writeLog` 进入统一日志。
6. self-test 不依赖长 preamble 文本。
7. 并发 dispatch/session 不共享 mutable JSON 状态。
8. 框架保持 TypeScript + Bun，不新增非必要运行时依赖。
9. OpenCode custom tool、plugin、MCP、script 代码形态符合官方文档和本地约定。
10. DB 是运行态状态、执行证据、阶段推进和 enforcement decision 的唯一真实来源。
