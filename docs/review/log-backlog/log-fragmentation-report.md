# OpenCode 日志碎片化全景报告

**日期**: 2026-06-11
**作者**: @Orchestrator
**版本**: v3.0（全面对齐源码 — FW-LOG-UNIFY 迁移状态、Agent Propagation 链、Custom Tools/Lib 清单扩充）
**最后审核**: 2026-06-12 @Super-Admin

---

## 一、日志输出分布 — 按模块类型

### 1. Plugin（插件）— 16 个 ✅ 100% 统一

| 插件 | 日志方式 | 验证 |
|------|---------|:--:|
| audit-before/after | writeLog("audit-*", ...) | ✅ loaded log 存在 |
| cache-after | writeLog("cache-after", ...) | ✅ |
| dispatch-before/after | writeLog("dispatch-*", ...) | ✅ |
| gate-before/after | writeLog("gate-*", ...) | ✅ |
| json-validate | writeLog("json-validate", ...) — **已接入** | ✅ 运行时日志 |
| scope-before/after | writeLog("scope-*", ...) | ✅ |
| session | writeLog("session", ...) | ✅ |
| task-after | writeLog("task-after", ...) | ✅ |
| tdd-before/after | writeLog("tdd-*", ...) | ✅ |
| uc7ks-before/after | writeLog("uc7ks-*", ...) | ✅ |

**统一度**: ✅ **16/16（100%）**。全部走 log-manager.ts，索引 index.json。

> **v2.0 勘误**: v2.0 误将 json-validate 标记为"未使用 writeLog"，实际代码 L16-19 已导入 log-manager，L34-35 已调用 writeLog + updateIndex，L102-107 已用 ERROR 级别记录阻断事件。

> **Agent 传播日志**: 所有 16 个插件的 writeLog 调用均包含 `agent` 和 `agentType` 字段（由 `resolveAgent(input.sessionID)` 注入），构成 agent propagation 的持久化审计链。详见 §二。

---

### 2. MCP Tool — 6 个 ⚠️ 部分迁移

| 工具 | 模块系统 | 日志方式 | 迁移状态 | 目标 |
|------|---------|---------|:--------:|------|
| compliance-gate.ts | CJS (require) | writeLog + process.stderr.write | ⚠️ **P2-A1 部分迁移** | ✅ .task_temp/_logs/ + ❌ stderr |
| code-quality-gate.ts | CJS | writeLog + process.stderr.write | ⚠️ **P2-A2 部分迁移** | ✅ .task_temp/_logs/ + ❌ stderr |
| code-quality-lib.ts | CJS | 无日志（纯审计函数库） | ✅ N/A | — |
| eslint-audit.ts | CJS | process.stderr.write (2处) | ❌ 未迁移 | ❌ stderr |
| keystone-validate.ts | CJS | process.stderr.write (3处) | ⚠️ **P2-A5 迁移至 stderr** | ❌ stderr |
| reconciliation-validate.ts | CJS | console.log + console.error (19处) | ❌ 未迁移 | ❌ stderr |

**统一度**: ⚠️ **2/6 部分迁移至 writeLog，1/6 纯库无日志，3/6 仍为 stderr**。

**v3.0 勘误**: v2.1 将所有 MCP Tool 标记为"❌ stderr"。实际源码显示：
- **compliance-gate.ts**: `FW-LOG-UNIFY-P2-A1`（2026-06-12）已将 14+ 处 debugStderr/process.stderr.write 迁移至 writeLog（L41 导入，L201/L214/L224/L248/L261/L512/L829/L835/L849/L861/L1388/L1461/L1520/L1528）。仍保留少量 process.stderr.write 用于 MCP 协议安全输出。
- **code-quality-gate.ts**: `FW-LOG-UNIFY-P2-A2`（2026-06-12）已将 10+ 处迁移至 writeLog（L60 导入，L227/L239/L249/L259/L272/L282/L325/L333/L466/L573）。仍保留 process.stderr.write 用于 MCP 输出。
- **keystone-validate.ts**: `FW-LOG-UNIFY-P2-A5`（2026-06-12）将 console.error 迁移至 process.stderr.write（非 writeLog），因 console.error 在 Bun 中可能写至 stdout 污染 MCP 协议。
- **code-quality-lib.ts**: 纯函数库（6 个 check 函数），无日志调用。v2.1 错误地将其列为"console.error (9处)"。

**特殊约束**: MCP 协议通过 stdin/stdout 传输 JSON-RPC。console.log() 污染协议（绝对禁止），只能用 process.stderr.write()。已迁移的 writeLog 调用通过 CJS require() ESM log-manager，持久化至 .task_temp/_logs/。

---

### 3. Custom Tool — 12 个

| 工具 | 模块系统 | 日志方式 | 目标 |
|------|---------|---------|------|
| dispatch_subagent.ts | ESM (import) | 无 | — |
| safe_shell.ts | ESM | safe-bash-core.ts → JSON 行 | .opencode/logs/safe-bash.log |
| safe_edit.ts | ESM | 无 | — |
| safe_delete.ts | ESM | 无 | — |
| safe_diff.ts | ESM | 无 | — |
| safe_mkdir.ts | ESM | 无 | — |
| safe_restore.ts | ESM | 无 | — |
| safe_test.ts | ESM | 无 | — |
| knowledge_cache_search.ts | ESM | 无 | — |
| knowledge_gap_report.ts | ESM | 无 | — |
| module_scope_declare.ts | ESM | 无 | — |

**统一度**: ❌ 11 个无日志，1 个独立审计日志。

**v3.0 勘误**: v2.1 仅列出 5 个 custom tools。实际 `.opencode/tools/` 目录包含 12 个文件（含 .opencode_backups/ 排除）。v2.1 错误地将 `dispatch_subagent.ts` 标记为"console.error (23处)"——这是脚本版本 `.opencode/scripts/command-tools/dispatch-subagent.ts` 的日志，而非 custom tool 版本。Custom tool 版本（`.opencode/tools/dispatch_subagent.ts`）无任何 console/process.stderr/writeLog 调用。

---

### 4. Script（脚本）— 30+ 个

| 脚本 | 模块系统 | 日志方式 | 迁移状态 | 目标 |
|------|---------|---------|:--------:|------|
| **pre-execution-gate.ts** ⚠️ | CJS | console.error (44处) + gateLog/writeLog (17处) | ⚠️ **P3-C2 部分迁移** | ✅ .task_temp/_logs/ + ❌ stderr |
| dispatch-subagent.ts (command) | CJS | console.error (22处) | ❌ 未迁移 | ❌ stderr |
| framework-self-test.ts | CJS | console.log (10处) | ❌ 未迁移 | ❌ stderr |
| framework-doctor.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| state-reconciliation.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| rule-registry-verify.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| rotate-logs.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| monitoring-status.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| framework-compliance-check.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| gate-lifecycle-audit.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| archive-dag-tasks.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| migrate-dag-v2.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| migrate-gate-state-v2-to-v3.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| nightly-compaction.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| rollback-state-migration.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| state-canonicalize.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| state-integrity-scan.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| state-reset.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| state-transaction.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| knowledge/archiver.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| knowledge/compressor.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| knowledge/deduplicator.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| knowledge/indexer.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| knowledge/janitor.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| knowledge/scout-extractor.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| knowledge/scout-trigger.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| knowledge/size-reporter.ts | CJS | console | ❌ 未迁移 | ❌ stderr |
| Shell scripts (.sh) × 11 | Shell | echo/printf | N/A | stdout |

**统一度**: ⚠️ **1/30+ 部分迁移至 writeLog，其余 stderr**。

**v3.0 勘误**:
- v2.1 列出 "15+" 脚本。实际 `.opencode/scripts/` 目录含 20+ .ts 脚本 + 11 .sh 脚本 + 8 knowledge/ 子目录脚本。
- **pre-execution-gate.ts**: `FW-LOG-UNIFY-P3-C2`（2026-06-12）新增 lazy-load writeLog 机制（L5-25）。通过 `gateLog()` 辅助函数将关键事件（gate_check_failed, dag_skip, rule_registry_*, super_admin_bypass, uc7ks_*, gate_result）持久化至 log-manager。v2.1 标记为"console.error (48处) ❌ stderr"不再准确——实际 44 console.error + 17 gateLog/writeLog。

---

### 5. Lib（共享库）— 21 个

| 库 | 模块系统 | 日志方式 | 目标 |
|------|---------|---------|------|
| log-manager.ts | ESM | writeLog + _error.log | .task_temp/_logs/_error.log |
| log-rotator.ts | ESM | **writeLog** (L313) + 注释 | ✅ .task_temp/_logs/ |
| safe-bash-core.ts | ESM | JSON 行 | .opencode/logs/safe-bash.log |
| gate-core.ts | ESM | 注释引用 console.error (L332) | ❌ stderr |
| shared-infra.ts | ESM | **writeLog** (L29) | ✅ .task_temp/_logs/ |
| agent-resolver.ts | ESM | demoLog (3处) | ❌ stderr |
| audit-log.ts | ESM | 无 | — |
| dag-version-manager.ts | ESM | console.error (1处) | ❌ stderr |
| gate-checks.ts | ESM | 无 | — |
| permission-isolation-core.ts | ESM | 无 | — |
| safe-edit-core.ts | ESM | 无 | — |
| safe-test-core.ts | ESM | 无 | — |
| state-cache.ts | ESM | 无 | — |
| state-compactor.ts | ESM | console.error (8处) | ❌ stderr |
| state-manager.ts | ESM | console.error (1处) | ❌ stderr |
| state-utils.ts | ESM | 无 | — |
| tolerant-json.ts | ESM | 无 | — |
| tool-scope.ts | ESM | 无 | — |
| uc7ks-schema.ts | ESM | 无 | — |
| uc7ks-utils.ts | ESM | 无 | — |
| write-audit-lib.ts | ESM | 无 | — |

**统一度**: ⚠️ **3/21 已接入 writeLog (log-manager, log-rotator, shared-infra)，4/21 使用 stderr，14/21 无日志**。

**v3.0 勘误**:
- v2.1 仅列出 5 个 lib 文件。实际 `.opencode/lib/` 目录含 21 个 .ts 文件（排除 dist/, __tests__/, .opencode_backups/, hooks/, scripts/ 子目录、tsconfig.json、.bak 文件）。
- **shared-infra.ts**: v2.1 标记为"demoLog (1处)"。实际已迁移至 writeLog（L12 导入，L29 调用 `writeLog("lib-shared-infra", ...)`），`FW-LOG-UNIFY-P1-D1`。
- **log-rotator.ts**: v2.1 标记为"console (4处)"。实际已导入 writeLog（L52）并在 compress_failed 事件中调用 writeLog（L313），`FW-LOG-UNIFY-P1-D2`。
- **agent-resolver.ts**: 使用 `demoLog`（来自 shared-infra.ts），实际走 writeLog → .task_temp/_logs/。

---

### 6. Hook（Git 钩子）

| 钩子 | 日志方式 | 目标 |
|------|---------|------|
| pre-commit | console.log (69处) | Git hook stdout |
| commit-msg | console (5处) | 同上 |

---

## 二、Agent Propagation 链 — 日志视角

本节记录 agent 身份如何在系统中传播，以及每个传播节点的日志覆盖情况。

### 2.1 传播链总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                    AGENT IDENTITY PROPAGATION CHAIN                    │
│                                                                       │
│  ① WRITERS (identity creation)                                       │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ session.ts (chat.message hook)                               │     │
│  │   → .session_map.json {sessionID: {agent, ts}}              │     │
│  │   → writeLog("session", "runtime") ✅ persisted              │     │
│  ├─────────────────────────────────────────────────────────────┤     │
│  │ dispatch-before.ts L340-388 (P0-6 TASK-IDENTITY)             │     │
│  │   → _dispatch_target.json {agent, task_id, run_id, ts}      │     │
│  │   → writeLog("dispatch-before", "runtime") ✅ persisted      │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                         │                                             │
│                         ▼                                             │
│  ② RESOLVER (identity lookup)                                        │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ agent-resolver.ts                                             │     │
│  │   resolveAgent(sessionID):                                    │     │
│  │     Priority 1: .session_map.json (session-specific, safe)    │     │
│  │     Priority 2: _dispatch_target.json (fallback, race-prone)  │     │
│  │     Staleness: run_id check + 30-min timestamp               │     │
│  │   → demoLog("INFO") → writeLog via shared-infra ✅ persisted │     │
│  ├─────────────────────────────────────────────────────────────┤     │
│  │   resolveTaskId():                                            │     │
│  │     Priority 1: FRAMEWORK_TASK_ID env var                     │     │
│  │     Priority 2: _dispatch_target.json.task_id                │     │
│  │     ⚠️ No staleness checks (open gap G1)                      │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                         │                                             │
│                         ▼                                             │
│  ③ READERS (12 plugins + 2 MCP tools + 1 script)                     │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ Plugins: dispatch-before/after, gate-before/after,            │     │
│  │   scope-before, audit-before/after, tdd-before/after,        │     │
│  │   task-after, uc7ks-before/after, json-validate              │     │
│  │   → All include agent/agentType in writeLog ✅ persisted     │     │
│  ├─────────────────────────────────────────────────────────────┤     │
│  │ MCP: compliance-gate.ts (L993-1016, L1785-1824)              │     │
│  │      code-quality-lib.ts (L942-957)                           │     │
│  │   → Read _dispatch_target.json for gate attribution           │     │
│  ├─────────────────────────────────────────────────────────────┤     │
│  │ Script: pre-execution-gate.ts (DAG gate identity)             │     │
│  │   → Read _dispatch_target.json + FRAMEWORK_TASK_ID           │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                         │                                             │
│                         ▼                                             │
│  ④ CLEANUP (identity teardown)                                       │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ dispatch-after.ts L42-69 (P0-7 TASK-IDENTITY CLEANUP)        │     │
│  │   → fs.unlinkSync(_dispatch_target.json)                     │     │
│  │   → writeLog("dispatch-after", "runtime") ✅ persisted       │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                       │
│  LOG COVERAGE: ①②③④ all writeLog-persisted except demoLog in ②      │
│  which routes through shared-infra.ts → writeLog (also persisted).   │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 Agent Propagation 日志覆盖矩阵

| 传播节点 | 源文件 | 行号 | 日志方式 | 持久化 | 包含 agent 字段 |
|---------|--------|------|---------|:------:|:--------------:|
| Session map write | session.ts | L54-97 | writeLog("session") | ✅ | ✅ |
| _dispatch_target.json write | dispatch-before.ts | L370-377 | writeLog("dispatch-before") | ✅ | ✅ |
| Session map read | agent-resolver.ts | L50 | demoLog → writeLog | ✅ | ✅ |
| _dispatch_target.json read | agent-resolver.ts | L70, L82 | demoLog → writeLog | ✅ | ✅ |
| _dispatch_target.json cleanup | dispatch-after.ts | L59-66 | writeLog("dispatch-after") | ✅ | ✅ |
| Plugin agent injection | 12 plugins | various | writeLog(各自) | ✅ | ✅ |
| MCP gate attribution | compliance-gate.ts | L993-1016 | writeLog + stderr | ⚠️ partial | ✅ |
| MCP audit attribution | code-quality-lib.ts | L942-957 | 无日志 | ❌ | N/A |
| Script gate identity | pre-execution-gate.ts | various | gateLog + console.error | ⚠️ partial | ✅ |

### 2.3 已知 Agent Propagation 设计缺陷

| 缺陷 ID | 描述 | 影响 | 来源 |
|---------|------|------|------|
| **G1** | `resolveTaskId()` 缺少 run_id + 30min 时间戳过期检查 | 陈旧的 _dispatch_target.json 返回错误的 task_id | priority.md Appendix A.5 |
| **G2** | `gate-before.ts` DAG 检查缺少 `applyPathScope` 守卫 | 只读 safe_shell 命令误触发 DAG 违规 | priority.md Appendix A.5 |
| **RACE** | _dispatch_target.json 为单文件共享资源 | 并行 dispatch 导致 last-write-wins 竞态（已通过 session map 优先级缓解） | agent-resolver.ts L35-46 |

---

## 三、汇总：日志最终落点

```
┌──────────────────────────────────────────────────────────────────┐
│                    日志最终落点                                    │
├──────────────────────────┬───────────────────────────────────────┤
│ .task_temp/_logs/        │ ✅ 所有 16 个插件 (log-manager)        │
│                          │ ✅ 3 MCP tools (compliance-gate,      │
│                          │    code-quality-gate, 部分迁移)       │
│                          │ ✅ 1 Script (pre-execution-gate, 部分)│
│                          │ ✅ 3 Lib (log-manager, log-rotator,   │
│                          │    shared-infra)                      │
│ .opencode/logs/          │ ✅ 仅 safe_shell (safe-bash-core)      │
│ stderr (丢弃)            │ ❌ MCP Tools 3 (eslint, keystone,     │
│                          │    reconciliation)                    │
│                          │ ❌ Scripts 29+                         │
│                          │ ❌ Lib 4 (gate-core, dag-version,     │
│                          │    state-compactor, state-manager)    │
│                          │ ❌ Custom Tool 1 (dispatch_subagent   │
│                          │    script version)                    │
│ 无日志                   │ ❌ Custom Tools 10                     │
│                          │ ❌ Lib 14                              │
│                          │ ❌ MCP Tool 1 (code-quality-lib)      │
│ stdout (Git)             │ ❌ Hooks 2                             │
└──────────────────────────┴───────────────────────────────────────┘
```

### 统计

| 指标 | 数值 | v2.1 → v3.0 变化 |
|------|------|:--:|
| log-manager 覆盖的模块 | **16 插件 + 3 MCP + 1 脚本 + 3 Lib = 23** | 16 → 23 |
| safe-bash 覆盖的模块 | 1 (safe_shell) | 不变 |
| stderr 丢弃的模块 | **37+** | 25+ → 37+ |
| 无日志的模块 | **25** (10 custom + 14 lib + 1 MCP) | 3 → 25 |
| 日志系统数量 | **2 套独立** (log-manager + safe-bash-core) | 不变 |
| Custom Tools 总数 | **12** | 5 → 12 |
| Lib 总数 | **21** | 5 → 21 |
| Scripts 总数 | **30+** (.ts + .sh) | 15+ → 30+ |

---

## 四、统一化可行性分析

### 4.1 已验证的技术前提

| 验证项 | 结果 | 证据 |
|--------|:----:|------|
| CJS 能否 require() ESM 的 log-manager | ✅ | compliance-gate.ts L41, code-quality-gate.ts L60 |
| Lazy-load writeLog from CJS | ✅ | pre-execution-gate.ts L13-19 (`FW-LOG-UNIFY-P3-C2`) |
| process.exit() 前缓冲区能否 flush | ✅ | writeLog → exit(0) → 日志文件已写入 |
| flush 是否同步 | ✅ | log-manager L228: fs.appendFileSync |
| MCP Tool 能否用 ESM | 技术上可以 | Bun 原生支持 |
| MCP Tool 官方推荐 | **CJS (require)** | 避免 CJS/ESM 互操作脆弱性 |
| Plugin 官方要求 | **ESM (export default)** | CJS module.exports 静默失败 |

### 4.2 按模块类型可行性

| 模块类型 | 数量 | 模块系统 | 可行性 | 关键约束 |
|---------|------|---------|:------:|---------|
| Plugin | 16 | ESM | ✅ 已统一 (100%) | 无改动 |
| MCP Tool | 6 | CJS | ⚠️ 3/6 已部分迁移 | 保留 stderr 用于 MCP 协议；CJS require ESM log-manager 已验证 |
| Custom Tool | 12 | ESM | ⚠️ 低优先 | 11/12 无日志——需评估是否需要日志 |
| Script | 30+ | CJS | ⚠️ 1/30+ 已部分迁移 | pre-exec-gate stderr 被 dispatch-subagent 消费 |
| Lib | 21 | ESM | ⚠️ 3/21 已迁移 | 14/21 无日志——需评估是否需要日志 |
| Hook | 2 | Shell | ❌ 不改 | Git 协议 |

### 4.3 日志文件命名统一

| 当前 | 统一后 |
|------|--------|
| plugin-{name}-{category}.log | plugin-{name}-{category}.log（不变） |
| mcp-{name}-{category}.log | mcp-{name}-{category}.log（已部分实现） |
| — | **tool**-{name}-{category}.log |
| — | **script**-{name}-{category}.log |
| — | **lib**-{name}-{category}.log |

### 4.4 FW-LOG-UNIFY 已完成的迁移

| 阶段 ID | 模块 | 状态 | 文件 |
|---------|------|:----:|------|
| P1-D1 | shared-infra.ts | ✅ 完成 | demoLog → writeLog |
| P1-D2 | log-rotator.ts | ✅ 完成 | console.error → writeLog |
| P2-A1 | compliance-gate.ts | ⚠️ 部分 | 14+ writeLog + 残留 stderr |
| P2-A2 | code-quality-gate.ts | ⚠️ 部分 | 10+ writeLog + 残留 stderr |
| P2-A5 | keystone-validate.ts | ⚠️ stderr 迁移 | console.error → process.stderr.write |
| P3-C2 | pre-execution-gate.ts | ⚠️ 部分 | lazy-load writeLog + 17 gateLog |

### 4.5 建议实施顺序

| 阶段 | 模块 | 难度 | 文件数 | 备注 |
|------|------|:--:|:--:|------|
| 1 | MCP Tools 残留 | 低 | 3 | eslint-audit, keystone-validate, reconciliation-validate |
| 2 | MCP Tools 双输出统一 | 中 | 2 | compliance-gate, code-quality-gate — 去除残留 stderr |
| 3 | Lib stderr 迁移 | 低 | 4 | gate-core, dag-version-manager, state-compactor, state-manager |
| 4 | Scripts | 中-高 | 29+ | 评估 lazy-load 模式适用性 |
| 5 | Custom Tools | 低 | 10 | 评估是否需要日志 |

### 4.6 不改的部分

| 模块 | 原因 |
|------|------|
| Git Hooks | Git 协议不受框架控制 |
| safe_shell → safe-bash-core | 独立命令审计日志，后续评估是否合并 |
| Plugin (16个) | **已 100% 统一** |
| 无日志的 Lib/Custom Tools | 纯函数库/工具，评估后再决定 |
