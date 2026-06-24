# 命名统一验证报告

**版本**: v1.0.0  
**日期**: 2026-06-23  
**Agent**: @Super-Admin  
**范围**: 根据 8 份审计文档对 `.opencode/` 框架代码进行全量命名合规验证

---

## §1 验证依据

以下 8 份审计文档定义了目标命名规范：

| #   | 文档                                 | 概念                         |
| --- | ------------------------------------ | ---------------------------- |
| 1   | `parameter-name-confusion-audit.md`  | 总清单（11 概念，51 种写法） |
| 2   | `gate-session-rename-plan.md`        | Gate Session 重命名          |
| 3   | `task-id-duality-complete-audit.md`  | Task ID 双重语义             |
| 4   | `agent-identity-complete-audit.md`   | Agent 身份标识               |
| 5   | `domain-identity-complete-audit.md`  | Domain 标识                  |
| 6   | `enforcement-mode-complete-audit.md` | Enforcement Mode             |
| 7   | `dispatch-context-complete-audit.md` | Dispatch Context             |
| 8   | `call-filepath-projectroot-audit.md` | Call/FilePath/ProjectRoot    |

---

## §2 验证结果汇总

### ✅ 完全合规（6 个概念）

| #   | 概念                  | 审计文档                             | 验证结果                                           | 残留                   |
| --- | --------------------- | ------------------------------------ | -------------------------------------------------- | ---------------------- |
| 1   | **Domain**            | `domain-identity-complete-audit.md`  | ✅ `domainName` → `domainId` 全量完成              | 0 处 `domainName`      |
| 2   | **Enforcement Mode**  | `enforcement-mode-complete-audit.md` | ✅ legacy `tr.enforcement_mode` 回退已移除         | 仅 1 处注释（解释性）  |
| 3   | **Agent (logs)**      | `agent-identity-complete-audit.md`   | ✅ `agent, agentType: agent` 双重写入已消除        | 0 处双重写入           |
| 4   | **Task ID**           | `task-id-duality-complete-audit.md`  | ✅ `session_namespace` / `sessionNamespace` 已实现 | 34 处正确使用          |
| 5   | **Call/FilePath**     | `call-filepath-projectroot-audit.md` | ✅ `callID`/`callId` + `filePath`/`file_path` 一致 | 已符合规范             |
| 6   | **FRAMEWORK_TASK_ID** | `task-id-duality-complete-audit.md`  | ✅ env var 已移除                                  | 仅 16 处注释（文档性） |

### ⚠️ 部分合规（2 个概念）

详见 §3 和 §4。

---

## §3 Gate Session — 部分合规

**审计文档**: `gate-session-rename-plan.md`

### 3.1 已完成

| 项目                                                                                                        | 状态 |
| ----------------------------------------------------------------------------------------------------------- | ---- |
| 函数名重命名：`createGateSession()`, `armGateSession()`, `completeGateSession()`, `generateGateSessionId()` | ✅   |
| 接口字段：`GateSession.gate_session_id`                                                                     | ✅   |
| `compliance-gate.ts`：99 处全部使用 `gateSessionId`/`gate_session_id`                                       | ✅   |
| `findArmedSession()` 返回类型和返回语句：`gateSessionId`                                                    | ✅   |
| `approval-read-context.ts`：25 处全部使用 `gate_session_id`                                                 | ✅   |
| `db-manager.ts`：DB schema `gate_session_id` 列                                                             | ✅   |

### 3.2 未完成（🔴 BUG）

| #   | 文件                                           | 行号                              | 问题                                                                                                                           | 严重性  |
| --- | ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- |
| B1  | `lib/gate-core.ts`                             | L728                              | `findAnyGateSession()` 返回类型声明 `sessionId: string \| null` 但代码返回 `gateSessionId` — **类型不匹配 BUG**                | 🔴 HIGH |
| B2  | `plugins/gate-before.ts`                       | L101                              | `session.sessionId` — `findArmedSession()` 返回 `gateSessionId`，访问 `.sessionId` 得到 `undefined`                            | 🔴 HIGH |
| B3  | `plugins/task-after.ts`                        | L89, L131, L145, L343, L349, L352 | `armed.sessionId` — 同上，**6 处访问不存在的属性**，导致 gate reminder 文件永远不写入                                          | 🔴 HIGH |
| B4  | `lib/gate-core.ts`                             | ~100 处                           | 内部变量/函数参数/JSDoc 仍用 `sessionId`（如 L781 `const sessionId = generateGateSessionId()`、L810 `sessionId: string` 参数） | 🟡 MED  |
| B5  | `scripts/mcp-tools/reconciliation-validate.ts` | L200, L205, L213, L250, L260      | 循环变量 `sessionId` 用于 gate session 迭代                                                                                    | 🟡 MED  |
| B6  | `lib/gate-core.ts`                             | L693-694, L720-721                | JSDoc 注释仍写 `@returns { found: true, sessionId }`                                                                           | 🟢 LOW  |

### 3.3 影响分析

**B1-B3 是运行时 BUG**：

- `task-after.ts` 中的 gate reminder 功能**静默失效**——`armed.sessionId` 恒为 `undefined`，条件 `armed.found && armed.sessionId` 恒为 `false`，导致 dispatch 完成后不会写入 gate reminder 文件。
- `gate-before.ts` L101 的日志输出 `id=${session.sessionId}` 恒为 `id=undefined`。
- `findAnyGateSession()` 的 TypeScript 类型声明与实际返回值不匹配，TypeScript 编译器可能不报错（因为 `gateSessionId` 是多余属性），但消费者按声明的 `sessionId` 访问会得到 `undefined`。

---

## §4 Dispatch Context — 部分合规

**审计文档**: `dispatch-context-complete-audit.md`

### 4.1 已完成

| 项目                                                  | 状态 |
| ----------------------------------------------------- | ---- |
| `DISPATCH_NAMESPACE` + `DISPATCH_DAG_TASK_ID` env var | ✅   |
| `session_namespace` MCP 参数                          | ✅   |
| `ctx/{dagTaskId}.json` per-dispatch 文件              | ✅   |
| `sessionNamespace` / `dagTaskId` 变量分离             | ✅   |

### 4.2 迁移中

| 项目                                | 状态              | 说明                                             |
| ----------------------------------- | ----------------- | ------------------------------------------------ |
| `.dispatch_ctx` legacy 共享单例     | ⚠️ Phase 2 淘汰中 | dual-write 模式（.dispatch_ctx + ctx/ 同时写入） |
| `declared_scope` legacy JSON blob   | ⚠️ 15 处保留      | 迁移兼容，见 §5                                  |
| `pipeline_task_id` legacy JSON blob | ⚠️ 15 处保留      | 迁移兼容，见 §5                                  |

---

## §5 Legacy 字段保留情况

以下 legacy 字段在代码中保留，用于向后兼容迁移：

### 5.1 `declared_scope`（15 处）

| 文件                                           | 行号                             | 用途                       |
| ---------------------------------------------- | -------------------------------- | -------------------------- |
| `lib/uc7ks-schema.ts`                          | L20, L99, L137, L264, L291, L335 | 接口定义 + 迁移兼容读取    |
| `tools/module_scope_declare.ts`                | L129                             | 写入 legacy flat 字段      |
| `tools/knowledge_cache_search.ts`              | L350                             | 写入 legacy flat 字段      |
| `scripts/knowledge/backfill-session-access.ts` | L48, L318, L321, L329            | 迁移脚本读取 legacy        |
| `scripts/framework-self-test.ts`               | L2266-2270                       | 自测检查 legacy 字段存在性 |

### 5.2 `pipeline_task_id`（15 处）

| 文件                                           | 行号                                   | 用途                       |
| ---------------------------------------------- | -------------------------------------- | -------------------------- |
| `lib/uc7ks-schema.ts`                          | L20, L98, L136, L237, L262, L289, L329 | 接口定义 + 迁移兼容读取    |
| `tools/module_scope_declare.ts`                | L128                                   | 写入 legacy flat 字段      |
| `tools/knowledge_cache_search.ts`              | L75, L349                              | 读取/写入 legacy flat 字段 |
| `scripts/knowledge/backfill-session-access.ts` | L47, L318, L321, L328                  | 迁移脚本读取 legacy        |
| `scripts/mcp-tools/compliance-gate.ts`         | L1323                                  | 读取 legacy flat 字段      |

### 5.3 `FRAMEWORK_TASK_ID`（16 处，全部为注释）

所有 16 处均为注释，标注 `FW-CLEANUP-FRAMEWORK-TASK-ID`，说明 env var 已移除。无运行时读取。

---

## §6 保留的合法 `agentType`（非违规）

以下 `agentType` 使用是合法的——它们是映射到 DB 列 `agent_type` 的 TypeScript 接口属性或函数参数：

| 文件                                         | 行号                         | 用途                                              |
| -------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| `lib/safe-edit-core.ts`                      | L51, L299                    | `WriteOptions.agentType` 接口 + 函数参数          |
| `lib/db-state-manager.ts`                    | L1356, L1442                 | `dbAppendSessionLog(agentType)` 函数参数          |
| `lib/deliverables-templates.ts`              | L168, L203                   | 接口 + 函数参数                                   |
| `lib/gate-checks.ts`                         | L163                         | `isWriteAllowed(agentType, filePath)` 函数参数    |
| `lib/permission-isolation-core.ts`           | L27-96, L122, L156, L174     | 接口属性 + 函数参数                               |
| `lib/log-manager.ts`                         | L46                          | `LogFields.agentType` 接口属性                    |
| `lib/dispatch-db.ts`                         | L103, L161, L328, L453, L489 | DB 映射接口 + 函数参数                            |
| `lib/gate-core.ts`                           | L2056                        | 函数参数                                          |
| `lib/agent-resolver.ts`                      | L185, L211                   | 接口属性 + 函数参数                               |
| `tools/safe_edit.ts`                         | L52, L57, L99, L104          | 传递给 `writeSafeFull({ agentType: agent })`      |
| `tools/safe_delete.ts`                       | L26, L28                     | 传递给 `safeDelete({ agentType: agent })`         |
| `scripts/command-tools/dispatch-subagent.ts` | L1224                        | 队列条目 `agentType` 字段（映射 DB `agent_type`） |

**判定依据**：审计文档 §13.2 明确规定"DB 列映射的 TypeScript 类型/参数保持 `agentType`（→ `agent_type`）"。

---

## §7 需要修复的 BUG 清单

| #   | 文件                                            | 修复内容                                                      | 优先级  |
| --- | ----------------------------------------------- | ------------------------------------------------------------- | ------- |
| 1   | `lib/gate-core.ts` L728                         | `sessionId: string \| null` → `gateSessionId: string \| null` | 🔴 立即 |
| 2   | `plugins/gate-before.ts` L101                   | `session.sessionId` → `session.gateSessionId`                 | 🔴 立即 |
| 3   | `plugins/task-after.ts` L89,131,145,343,349,352 | `armed.sessionId` → `armed.gateSessionId`（6 处）             | 🔴 立即 |
| 4   | `lib/gate-core.ts` ~100 处                      | 内部变量 `sessionId` → `gateSessionId`                        | 🟡 近期 |
| 5   | `reconciliation-validate.ts` 5 处               | `sessionId` → `gateSessionId`                                 | 🟡 近期 |
| 6   | `lib/gate-core.ts` JSDoc                        | `sessionId` → `gateSessionId`                                 | 🟢 低   |

---

## §8 验证方法

本次验证使用 `grep` 工具对 `.opencode/` 下所有 `.ts` 文件进行模式搜索，验证以下模式：

```bash
# Domain: 确认 domainName 已消除
grep -rn 'domainName' .opencode/ --include='*.ts'

# Enforcement: 确认 legacy 回退已移除
grep -rn 'tr\.enforcement_mode' .opencode/ --include='*.ts'

# Agent: 确认双重写入已消除
grep -rn 'agentType:\s*agent,' .opencode/ --include='*.ts'

# Task ID: 确认 session_namespace 已实现
grep -rn 'sessionNamespace\|session_namespace' .opencode/ --include='*.ts'

# Gate Session: 检查 sessionId 残留
grep -rn '\bsessionId\b' .opencode/lib/gate-core.ts
grep -rn '\.sessionId' .opencode/plugins/gate-before.ts .opencode/plugins/task-after.ts

# FRAMEWORK_TASK_ID: 确认 env var 已移除
grep -rn 'FRAMEWORK_TASK_ID' .opencode/ --include='*.ts'
```

---

## §9 结论

| 维度            | 结果                       |
| --------------- | -------------------------- |
| 完全合规概念    | 6/8（75%）                 |
| 部分合规概念    | 2/8（25%）                 |
| 运行时 BUG      | 3 个（🔴 HIGH）            |
| 命名不一致      | ~105 处（🟡 MED + 🟢 LOW） |
| Legacy 兼容字段 | 30 处（保留，迁移中）      |

**核心结论**：6 个概念的命名统一已完整完成。Gate Session 概念的函数/接口层重命名已完成，但 `gate-core.ts` 内部变量和 2 个消费者插件（`gate-before.ts`、`task-after.ts`）未同步更新，导致 3 个运行时 BUG。Dispatch Context 的 Phase 2 迁移仍在进行中。

---

_本报告由 @Super-Admin 于 2026-06-23 生成，基于 8 份审计文档的全量代码验证。_
