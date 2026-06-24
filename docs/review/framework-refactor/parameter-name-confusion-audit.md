# Framework Parameter Name Confusion — 全量审计

**版本**: v1.0.0  
**日期**: 2026-06-23  
**作者**: @Super-Admin  
**状态**: 审计完成

---

## 概述

对 `.opencode/` 下 70+ 个模块（25 plugins + 18 tools + 5 MCP tools + 17 core libs + 3 scripts）中所有参数命名进行全量搜索，发现 **11 个核心概念存在 51 种不同写法**。

---

## 1. Session 标识（8 种写法）

| #   | 写法                  | 出现位置                          | 示例                                                 |
| --- | --------------------- | --------------------------------- | ---------------------------------------------------- |
| 1   | `sessionID`           | Plugin hook input, context, 日志  | `input.sessionID`, `context.sessionID`               |
| 2   | `sessionId`           | 工具 args, 内部变量               | `args.sessionId`, `var sessionId = ...`              |
| 3   | `session_id`          | DB 列名, MCP args, 迁移脚本       | `session_map.session_id`, `gate_sessions.session_id` |
| 4   | `opencode_session_id` | DB 列名, checklist, backfill      | `execution_checklist_runs.opencode_session_id`       |
| 5   | `sid`                 | 局部变量简写                      | `const sid = input.sessionID \|\| ""`                |
| 6   | `OPENCODE_SESSION_ID` | env var（dispatch 传播）          | `process.env.OPENCODE_SESSION_ID`                    |
| 7   | `parentSessionId`     | dispatch ctx, parent-run fallback | `ctx.parentSessionId`                                |
| 8   | `childSessionId`      | dispatch 子槽位                   | `"dispatch:child:" + dagTaskId`                      |

### ⚠️ 最严重混淆

`session_id` 在 `compliance-gate.ts` 中指 **Gate session**（`cg_ses_*`），在其他模块中指 **OpenCode session**（`ses_*`）。直接导致 **F-I**（gate facts 写错 checklist run）。

---

## 2. Task 标识（6 种写法）

| #   | 写法                | 出现位置                    | 示例                                                                |
| --- | ------------------- | --------------------------- | ------------------------------------------------------------------- |
| 1   | `task_id`           | DB 列名, args, MCP, schema  | `knowledge_discovery.task_id`, `args.task_id`, `compliance-gate.ts` |
| 2   | `taskId`            | Plugin 变量, 函数参数, 日志 | `resolveChecklistTaskId(input)`, `var taskId`                       |
| 3   | `dag_task_id`       | dispatch args, DB 列名      | `args.dag_task_id`, `session_map.dag_task_id`                       |
| 4   | `dagTaskId`         | dispatch 工具内部变量       | `const dagTaskId = args.dag_task_id \|\| ""`                        |
| 5   | `pipeline_task_id`  | JSON blob legacy 字段       | `kcs.session_access[agent].pipeline_task_id`                        |
| 6   | `FRAMEWORK_TASK_ID` | env var（已废弃，v4.0.0）   | `process.env.FRAMEWORK_TASK_ID`                                     |

### ⚠️ 最严重混淆

`task_id` vs `dag_task_id`：同一概念在 DB 列、工具 args、函数参数中使用不同名称。`knowledge_cache_search` 和 `knowledge_cache_attest` 对空值的 fallback 不同（`"unknown"` vs `""`），导致 **F-M**。

---

## 3. Agent 标识（7 种写法）

| #   | 写法              | 出现位置                               | 示例                                                            |
| --- | ----------------- | -------------------------------------- | --------------------------------------------------------------- |
| 1   | `agent`           | Plugin 日志 key, DB 列, 函数参数       | `resolveAgent(sid)`, `input.agent`, `writeLog(..., {agent})`    |
| 2   | `agentType`       | Plugin 内部变量, 日志 key              | `const agentType = agent \|\| "unknown"`, `{agentType}`         |
| 3   | `agent_type`      | dispatch args, DB 列                   | `args.agent_type`, `session_map.agent_type`                     |
| 4   | `agentRef`        | UC7KS 工具内部（normalizeAgentKey 后） | `var agentRef = normalizeAgentKey(agent)`                       |
| 5   | `agentKey`        | UC7KS schema 函数参数                  | `readCachedSessionAccess(agentKey)`, `normalizeAgentKey(agent)` |
| 6   | `agentName`       | framework-doctor, 循环变量             | `for (const [agentName, agentCfg] of ...)`                      |
| 7   | `FRAMEWORK_AGENT` | env var（legacy, v4.0.0 deprecated）   | `process.env.FRAMEWORK_AGENT`                                   |

### ⚠️ 最严重混淆

`agent` 和 `agentType` 在日志中作为不同 key 同时出现，但值相同（`{agent, agentType: agent}`），形成冗余。

---

## 4. Domain 标识（5 种写法）

| #   | 写法             | 出现位置                     | 示例                                                     |
| --- | ---------------- | ---------------------------- | -------------------------------------------------------- |
| 1   | `domain`         | args, 函数参数, 日志         | `args.domain`, `domainId: domain`                        |
| 2   | `domainId`       | 内部变量, 日志               | `const domainId = resolveDomainId(sid)`                  |
| 3   | `domain_id`      | DB 列名, schema 字段, config | `knowledge_session_access.domain_id`, `domain.domain_id` |
| 4   | `domainName`     | UC7KS 工具内部变量           | `var domainName = args.domain \|\| "all"`                |
| 5   | `declared_scope` | JSON blob legacy 字段        | `kcs.session_access[agent].declared_scope`               |

---

## 5. Enforcement Mode（5 种写法）

| #   | 写法                       | 出现位置                        | 示例                                                                     |
| --- | -------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| 1   | `ENFORCEMENT_MODE`         | env var（运行时覆盖）           | `process.env.ENFORCEMENT_MODE`                                           |
| 2   | `enforcement_mode`         | DB 列, config legacy            | `gate_sessions.enforcement_mode`, `template_resolution.enforcement_mode` |
| 3   | `develop_enforcement_mode` | project.config.json（本地开发） | `template_resolution.develop_enforcement_mode`                           |
| 4   | `runtime_enforcement_mode` | project.config.json（CI/生产）  | `template_resolution.runtime_enforcement_mode`                           |
| 5   | `mode`                     | 局部变量简写                    | `const mode = getEnforcementMode()`                                      |

### ⚠️ 历史遗留

`enforcement_mode` 是原始单键；`develop`/`runtime` 是 FW-HARNESS-P6 双键重构。三者在 `gate-core.ts:333-345` 中按优先级解析。

---

## 6. Run 标识（3 种写法）

| #   | 写法              | 出现位置                    | 示例                                                   |
| --- | ----------------- | --------------------------- | ------------------------------------------------------ |
| 1   | `run_id`          | DB 列名, checklist 函数参数 | `execution_checklist_runs.run_id`, `{ run_id: runId }` |
| 2   | `runId`           | Plugin 变量                 | `const runId = resolveChecklistRun(...)`               |
| 3   | `OPENCODE_RUN_ID` | env var                     | `process.env.OPENCODE_RUN_ID`                          |

---

## 7. Dispatch Context（4 种写法）

| #   | 写法                         | 出现位置                  | 示例                                                      |
| --- | ---------------------------- | ------------------------- | --------------------------------------------------------- |
| 1   | `FRAMEWORK_DISPATCH_CONTEXT` | env var                   | `process.env.FRAMEWORK_DISPATCH_CONTEXT = "orchestrated"` |
| 2   | `DISPATCH_TASK_DESC`         | env var                   | `process.env.DISPATCH_TASK_DESC`                          |
| 3   | `.dispatch_ctx`              | 文件名（legacy 共享单例） | `.task_temp/_dispatch/.dispatch_ctx`                      |
| 4   | `ctx/{dagTaskId}.json`       | 文件名（per-dispatch）    | `.task_temp/_dispatch/ctx/T-001.json`                     |

---

## 8. Gate Session（2 种写法，同名异义）

| #   | 写法                 | 实际含义                                   | 使用模块                                                                               |
| --- | -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1   | `session_id` (args)  | **Gate session**（`cg_ses_*`）             | `compliance-gate.ts`                                                                   |
| 2   | `session_id` (DB 列) | **Gate session**（同上）                   | `gate_sessions.session_id`                                                             |
| ❌  | —                    | 与 OpenCode session (`ses_*`) **同名异义** | checklist-before 用 OpenCode session 解析 run，gate 用 gate session 写 facts → **F-I** |

---

## 9. Call / Message 标识（3 种写法）

| #   | 写法      | 出现位置                                                  |
| --- | --------- | --------------------------------------------------------- |
| 1   | `callID`  | Plugin input: `input.callID`                              |
| 2   | `call_id` | DB 列: `read_audit.call_id`                               |
| 3   | `callId`  | 内部变量, read-audit 迁移: `const callId = input?.callID` |

---

## 10. File Path（5 种写法）

| #   | 写法         | 出现位置                           |
| --- | ------------ | ---------------------------------- |
| 1   | `filePath`   | safe_edit args, 函数参数（最常用） |
| 2   | `absPath`    | 安全工具内部 normalize 后          |
| 3   | `scopePath`  | scope-before 内部变量              |
| 4   | `targetPath` | safe_restore, safe_diff args       |
| 5   | `file_path`  | DB 列: `read_audit.file_path`      |

---

## 11. Project Root（3 种写法）

| #   | 写法            | 出现位置                         |
| --- | --------------- | -------------------------------- |
| 1   | `OPENCODE_ROOT` | env var（标准，全项目统一）      |
| 2   | `projectRoot`   | 内部变量简写                     |
| 3   | `worktree`      | Tool context: `context.worktree` |

---

## 汇总统计

| 概念                 | 不同写法数    | 最严重混淆                                             | 相关 Finding |
| -------------------- | ------------- | ------------------------------------------------------ | ------------ |
| **Session**          | 8             | `session_id` 同名异义（Gate vs OpenCode）              | F-I          |
| **Agent**            | 7             | `agent`/`agentType`/`agentRef`/`agentKey` 混用         | —            |
| **Task**             | 6             | `task_id` vs `dag_task_id`；空值 fallback 不一致       | F-M, F-N     |
| **Domain**           | 5             | `domain` vs `domain_id` vs `domainName`                | —            |
| **Enforcement Mode** | 5             | legacy `enforcement_mode` + 双键 `develop`/`runtime`   | —            |
| **File Path**        | 5             | `filePath` vs `absPath` vs `scopePath` vs `targetPath` | —            |
| **Dispatch Context** | 4             | env vars vs 文件路径混用                               | F-J          |
| **Run**              | 3             | `run_id` vs `runId` vs `OPENCODE_RUN_ID`               | —            |
| **Call**             | 3             | `callID` vs `call_id` vs `callId`                      | —            |
| **Project Root**     | 3             | `OPENCODE_ROOT` vs `projectRoot` vs `worktree`         | —            |
| **Gate Session**     | 2（同名异义） | 与 OpenCode session 命名冲突                           | F-I          |
| **合计**             | **51**        | —                                                      | —            |

---

## 建议统一命名规范

| 概念             | 建议统一为                                                     | 理由                           |
| ---------------- | -------------------------------------------------------------- | ------------------------------ |
| OpenCode session | `sessionID` (camelCase, 上下文) / `session_id` (DB/schema)     | 与 OpenCode 上游一致           |
| Gate session     | `gate_session_id`                                              | 消除同名异义                   |
| DAG task         | `dag_task_id` (args/DB) / `dagTaskId` (变量)                   | 区分于 pipeline task           |
| Agent type       | `agent` (上下文) / `agent_type` (DB/schema)                    | 简化冗余的 `agentType`         |
| Domain           | `domain_id` (args/DB) / `domainId` (变量)                      | 统一                           |
| Enforcement mode | 仅保留 `develop_enforcement_mode` + `runtime_enforcement_mode` | 移除 legacy `enforcement_mode` |
| Run              | `run_id` (DB) / `runId` (变量)                                 | 统一                           |
| File path        | `filePath` (上下文) / `file_path` (DB)                         | 统一                           |
