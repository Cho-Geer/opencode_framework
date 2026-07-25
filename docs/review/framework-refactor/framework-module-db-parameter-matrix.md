# Framework Module × DB × Parameter 全量矩阵

**版本**: v2.2.0  
**日期**: 2026-06-23  
**作者**: @Super-Admin  
**目的**: 全量审计框架中每个功能模块的所需参数及其与 DB 表的对应关系  
**更新**: v2.2.0 — OPT-01~10 全量实施 + E2E 验证（4 子 agent × 64 checks）；新增 §11 调查发现（Task() 绕过根因、插件注册缺失、SRC 未定义 bug）

---

## 0. 子系统对齐声明

本文档覆盖以下子系统，所有模块、DB 表、参数均映射到对应子系统：

| 子系统                                                   | 覆盖章节                              | DB-canonical 状态 |
| -------------------------------------------------------- | ------------------------------------- | ----------------- |
| Layout Architecture Subsystem                            | §1（目录结构扫描）                    | ✅                |
| DB-only and DB-canonical based                           | §3（DB 表映射）                       | ✅ v20 完成       |
| Permission Matrix Subsystem                              | §1.4 L23-L24 + §3 Permission 表       | ✅                |
| Session/Same-Agent/Different-Agent/Task Concurrency Safe | §5（并发安全）                        | ⚠️ 部分完成       |
| Hardened Enforcement Subsystem                           | §1.1 Plugins + §4（身份参数）         | ⚠️                |
| Framework Harness Subsystem                              | §1.1 Plugins（hook 链）               | ✅                |
| Central State Management Subsystem                       | §1.6 Schema + §3 System 表            | ✅                |
| Multi-Agent Subsystem                                    | §1.2 Tools + §4（身份参数）           | ⚠️                |
| Log Central Management Subsystem                         | §1.4 L21 + §6（日志集成）             | ✅ v3.0           |
| DB-canonical Management Subsystem                        | §3 全文                               | ✅ v20 完成       |
| Templatization & Parameterization Universality Subsystem | §4（参数统一）                        | ⚠️                |
| TypeScript + Bun Based Runtime Subsystem                 | 全文（所有模块均为 .ts + bun:sqlite） | ✅                |

---

## 1. 功能模块全量清单（7 类 100+ 模块）

### 1.1 Plugin 模块（24 个活跃 + 1 备份）

| #   | 文件                        | 功能                                         | 所需身份参数                                                              | 日志集成    |
| --- | --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- | ----------- |
| P01 | `session.ts`                | Session 生命周期管理、agent→session 映射写入 | `input.sessionID`, `input.agent`                                          | ✅ writeLog |
| P02 | `checklist-before.ts`       | P0 checklist 物理阻断                        | `input.sessionID` → resolveAgent → agent; resolveChecklistTaskId → taskId | ✅ writeLog |
| P03 | `scope-before.ts`           | Write-scope 阻断 + UC7KS 写前检查            | `input.sessionID` → agent; taskId; domainId                               | ✅ writeLog |
| P04 | `scope-after.ts`            | 写后 scope 日志                              | `input.sessionID` → agent                                                 | ✅ writeLog |
| P05 | `dispatch-before.ts`        | PLAN-FIRST dispatch 阻断                     | `input.sessionID` → agent caller                                          | ✅ writeLog |
| P06 | `dispatch-after.ts`         | dispatch 后清理                              | `input.sessionID`                                                         | ✅ writeLog |
| P07 | `dispatch-auto.ts`          | Auto-plan 触发                               | `input.sessionID`                                                         | ✅ writeLog |
| P08 | `task-before.ts`            | Task() 工具校验（DISPATCH_TOKEN）            | `input.sessionID` → agent; taskId                                         | ✅ writeLog |
| P09 | `task-after.ts`             | Task() 后清理                                | `input.sessionID`                                                         | ✅ writeLog |
| P10 | `gate-before.ts`            | Gate 工具前置校验                            | `input.sessionID` → agent; taskId                                         | ✅ writeLog |
| P11 | `gate-after.ts`             | Gate 后日志                                  | `input.sessionID` → agent                                                 | ✅ writeLog |
| P12 | `audit-before.ts`           | 审计前检查                                   | `input.sessionID` → agent; taskId                                         | ✅ writeLog |
| P13 | `audit-after.ts`            | 审计后日志                                   | `input.sessionID` → agent                                                 | ✅ writeLog |
| P14 | `question-policy-before.ts` | 子 session 阻断 question 工具                | `input.sessionID` → agent                                                 | ✅ writeLog |
| P15 | `format-after.ts`           | 自动格式化                                   | （无身份依赖）                                                            | —           |
| P16 | `read-track-after.ts`       | 读操作追踪                                   | `input.sessionID`                                                         | ✅ writeLog |
| P17 | `cache-after.ts`            | 缓存管理                                     | `input.sessionID` → agent                                                 | ✅ writeLog |
| P18 | `json-validate.ts`          | JSON 校验                                    | `input.sessionID` → agent                                                 | ✅ writeLog |
| P19 | `hook-config-guard.ts`      | Hook 配置守护                                | `input.sessionID` → agent                                                 | ✅ writeLog |
| P20 | `git-guard-before.ts`       | Git 操作守护                                 | `input.sessionID` → agent                                                 | ✅ writeLog |
| P21 | `tdd-before.ts`             | TDD 强制执行                                 | `input.sessionID` → agent                                                 | ✅ writeLog |
| P22 | `tdd-after.ts`              | TDD 后日志                                   | `input.sessionID` → agent                                                 | ✅ writeLog |
| P23 | `uc7ks-before.ts`           | UC7KS 前置检查                               | `input.sessionID` → agent                                                 | ✅ writeLog |
| P24 | `uc7ks-after.ts`            | UC7KS 后日志                                 | `input.sessionID` → agent                                                 | ✅ writeLog |
| P25 | `dispatch-before.ts.bak`    | （备份，非活跃）                             | —                                                                         | —           |

### 1.2 Tool 模块（18 个）

| #   | 文件                         | 功能                      | 所需身份参数                                                         | 日志集成    |
| --- | ---------------------------- | ------------------------- | -------------------------------------------------------------------- | ----------- |
| T01 | `dispatch_subagent.ts`       | 生成 dispatch 包装 prompt | `context.agent` caller; `args.agent_type` target; `args.dag_task_id` | ✅ writeLog |
| T02 | `checklist_status.ts`        | 查询 checklist 状态       | `args.task_id`                                                       | ✅ writeLog |
| T03 | `advance_checklist_phase.ts` | 推进 checklist 阶段       | `args.task_id`                                                       | ✅ writeLog |
| T04 | `config_read_attest.ts`      | Config 读取验证           | `context.agent`; `context.sessionID`; `args.task_id`                 | ✅ writeLog |
| T05 | `knowledge_cache_search.ts`  | 本地缓存搜索              | `context.agent`; `context.sessionID`; `args.task_id`; `args.domain`  | ✅ writeLog |
| T06 | `knowledge_cache_attest.ts`  | 读取证据验证              | `context.agent`; `context.sessionID`; `args.task_id`; `args.domain`  | ✅ writeLog |
| T07 | `knowledge_gap_report.ts`    | 缓存覆盖分析              | （无身份依赖）                                                       | ✅ writeLog |
| T08 | `module_scope_declare.ts`    | 模块作用域声明            | `context.agent`; `context.sessionID`; `args.task_id`; `args.module`  | ✅ writeLog |
| T09 | `resolve_domain_id.ts`       | 解析当前 domain_id        | `context.sessionID`; `args.dag_task_id`                              | ✅ writeLog |
| T10 | `janitor.ts`                 | 缓存清理                  | （无身份依赖）                                                       | ✅ writeLog |
| T11 | `nightly-compaction.ts`      | 夜间压缩                  | （无身份依赖）                                                       | ✅ writeLog |
| T12 | `safe_edit.ts`               | 安全文件编辑              | `context.agent`; `context.sessionID`                                 | ✅ writeLog |
| T13 | `safe_shell.ts`              | 安全 shell 执行           | `context.agent`; `context.sessionID`                                 | ✅ writeLog |
| T14 | `safe_delete.ts`             | 安全文件删除              | `context.agent`; `context.sessionID`                                 | ✅ writeLog |
| T15 | `safe_mkdir.ts`              | 安全目录创建              | `context.agent`; `context.sessionID`                                 | ✅ writeLog |
| T16 | `safe_restore.ts`            | 安全文件恢复              | `context.agent`; `context.sessionID`                                 | ✅ writeLog |
| T17 | `safe_diff.ts`               | 安全 diff 生成            | （无身份依赖）                                                       | ✅ writeLog |
| T18 | `safe_test.ts`               | 安全测试执行              | `context.agent`; `context.sessionID`                                 | ✅ writeLog |

### 1.3 MCP Tool 模块（6 个）

> **v2.0 更新**: 从 5 个修正为 6 个 — 补充 `reconciliation-validate.ts`

| #   | 文件                         | 功能                                                       | 所需身份参数                                    | 日志集成    |
| --- | ---------------------------- | ---------------------------------------------------------- | ----------------------------------------------- | ----------- |
| M01 | `compliance-gate.ts`         | 合规门 MCP server（check/confirm/complete/submit/approve） | `args.session_id`; `args.task_id`; `args.agent` | ✅ writeLog |
| M02 | `code-quality-check.ts`      | 代码质量检查（tsc/depcruise/prettier）                     | `args.changed_file`                             | ✅ writeLog |
| M03 | `eslint-audit.ts`            | ESLint mock-audit                                          | `args.changed_file`; `args.full_scan`           | ✅ writeLog |
| M04 | `keystone-validate.ts`       | Keystone 哈希验证                                          | （无身份依赖）                                  | ✅ writeLog |
| M05 | `code-quality-lib.ts`        | 代码质量共享库                                             | （无身份依赖）                                  | ✅ writeLog |
| M06 | `reconciliation-validate.ts` | 状态一致性验证（pre-commit 集成）                          | （无身份依赖）                                  | ✅ writeLog |

### 1.4 Core Library 模块（42 个）

> **v2.0 更新**: 从 17 个"关键"模块扩展为 42 个完整清单

| #   | 文件                           | 功能                           | 所需身份参数                                        | 日志集成    |
| --- | ------------------------------ | ------------------------------ | --------------------------------------------------- | ----------- |
| L01 | `agent-resolver.ts`            | session→agent/task/domain 解析 | `sessionID`                                         | ✅ writeLog |
| L02 | `approval-read-context.ts`     | 审批读取上下文管理             | `sessionID`                                         | ✅ writeLog |
| L03 | `audit-log.ts`                 | 审计日志写入                   | `sessionID`; `agent`                                | ✅ writeLog |
| L04 | `checklist-hooks.ts`           | Checklist 钩子逻辑             | `opencode_session_id`; `agent`; `task_id`           | ✅ writeLog |
| L05 | `critical-files.ts`            | 关键文件检测                   | `filePath`                                          | ✅ writeLog |
| L06 | `dag-policy.ts`                | DAG 策略管理                   | `agent` (for isDagExempt)                           | ✅ writeLog |
| L07 | `dag-version-manager.ts`       | DAG 版本管理                   | —                                                   | ✅ writeLog |
| L08 | `db-maintenance.ts`            | DB 维护（VACUUM 等）           | —                                                   | ✅ writeLog |
| L09 | `db-manager.ts`                | DB 连接和 schema（v20）        | —                                                   | ✅ writeLog |
| L10 | `db-state-manager.ts`          | DB 状态读写                    | `key`; `sessionID`                                  | ✅ writeLog |
| L11 | `deliverables-templates.ts`    | 交付物模板                     | —                                                   | ✅ writeLog |
| L12 | `dispatch-db.ts`               | Dispatch DB 操作               | `sessionID`; `dagTaskId`                            | ✅ writeLog |
| L13 | `execution-checklist.ts`       | Checklist 状态机               | `opencode_session_id`; `agent`; `task_id`; `run_id` | ✅ writeLog |
| L14 | `gate-checks.ts`               | Gate 校验逻辑                  | `task_id`; `dag_task_id`                            | ✅ writeLog |
| L15 | `gate-core.ts`                 | Gate 状态管理                  | `session_id`; `agent`; `task_id`                    | ✅ writeLog |
| L16 | `hook-lifecycle.ts`            | Hook 生命周期管理              | —                                                   | ✅ writeLog |
| L17 | `index.ts`                     | Lib 统一导出                   | —                                                   | —           |
| L18 | `interrupt-guard.ts`           | 中断保护                       | —                                                   | ✅ writeLog |
| L19 | `knowledge-audit.ts`           | 知识审计计数器                 | —                                                   | ✅ writeLog |
| L20 | `knowledge-store.ts`           | 知识存储（KC 工具用）          | —                                                   | ✅ writeLog |
| L21 | `log-manager.ts`               | 日志管理 v3.0（O_APPEND）      | `sessionID`; `agent`                                | — (自身)    |
| L22 | `log-rotator.ts`               | 日志轮转                       | —                                                   | ✅ writeLog |
| L23 | `permission-isolation-core.ts` | 权限隔离核心                   | `agent`                                             | ✅ writeLog |
| L24 | `permission-reader.ts`         | 权限读取                       | `agent`                                             | ✅ writeLog |
| L25 | `read-audit.ts`                | 读审计验证（DB-first）         | `sessionID`; `filePath`                             | ✅ writeLog |
| L26 | `route-validator.ts`           | 路由校验                       | `agent`; `filePath`                                 | ✅ writeLog |
| L27 | `safe-bash-core.ts`            | 安全 shell 核心                | `agent`; `sessionID`                                | ✅ writeLog |
| L28 | `safe-edit-core.ts`            | 安全编辑核心                   | `agent`; `sessionID`                                | ✅ writeLog |
| L29 | `safe-test-core.ts`            | 安全测试核心                   | `agent`; `sessionID`                                | ✅ writeLog |
| L30 | `shared-infra.ts`              | 共享基础设施                   | —                                                   | ✅ writeLog |
| L31 | `state-cache.ts`               | 状态缓存                       | `key`                                               | ✅ writeLog |
| L32 | `state-compactor.ts`           | 状态压缩器                     | —                                                   | ✅ writeLog |
| L33 | `state-manager.ts`             | 状态管理器                     | `key`                                               | ✅ writeLog |
| L34 | `state-utils.ts`               | 状态工具函数                   | `key`; `value`                                      | ✅ writeLog |
| L35 | `substate-manager.ts`          | Sub-state 读写                 | `key`                                               | ✅ writeLog |
| L36 | `substate-types.ts`            | Sub-state 类型定义             | —                                                   | —           |
| L37 | `tolerant-json.ts`             | 容错 JSON 解析                 | —                                                   | ✅ writeLog |
| L38 | `tool-scope.ts`                | 工具范围检查                   | `agent`; `tool`; `filePath`                         | ✅ writeLog |
| L39 | `uc7ks-pipeline-db.ts`         | UC7KS Pipeline DB-Canonical    | `agent`; `taskId`; `domainId`                       | ✅ writeLog |
| L40 | `uc7ks-schema.ts`              | UC7KS 数据模型                 | `agent`; `taskId`; `domain`                         | ✅ writeLog |
| L41 | `uc7ks-utils.ts`               | UC7KS 执行检查                 | `agent`; `mode`; `sessionId`; `taskId`; `domainId`  | ✅ writeLog |
| L42 | `write-audit-lib.ts`           | 写审计库                       | `agent`; `sessionID`; `filePath`                    | ✅ writeLog |

### 1.5 脚本模块（32 个）

> **v2.0 更新**: 从 3 个扩展为 32 个完整清单

| #   | 文件                              | 功能                       | 日志集成    |
| --- | --------------------------------- | -------------------------- | ----------- |
| S01 | `framework-self-test.ts`          | 框架自我诊断（64+ checks） | ✅ writeLog |
| S02 | `state-reconciliation.ts`         | 状态一致性校验             | ✅ writeLog |
| S03 | `framework-doctor.ts`             | 框架诊断修复（13 checks）  | ✅ writeLog |
| S04 | `pre-execution-gate.ts`           | 执行前门禁                 | ✅ writeLog |
| S05 | `pre-execution-hook.sh`           | 执行前 Shell 钩子          | — (shell)   |
| S06 | `install-hooks.ts`                | Git hooks 安装             | ✅ writeLog |
| S07 | `state-machine-reset.sh`          | 状态机重置                 | — (shell)   |
| S08 | `state-reset.ts`                  | 状态重置（TS）             | ✅ writeLog |
| S09 | `state-transaction.ts`            | 状态事务                   | ✅ writeLog |
| S10 | `state-canonicalize.ts`           | 状态规范化                 | ✅ writeLog |
| S11 | `state-integrity-scan.ts          | 状态完整性扫描             | ✅ writeLog |
| S12 | `migrate-read-audit.ts`           | read_audit JSONL→DB 迁移   | ✅ writeLog |
| S13 | `migrate-machine-to-substates.ts` | machine.json→substate 迁移 | ✅ writeLog |
| S14 | `migrate-dag-v2.ts`               | DAG v1→v2 迁移             | ✅ writeLog |
| S15 | `migrate-gate-state-v2-to-v3.ts`  | gate-state v2→v3 迁移      | ✅ writeLog |
| S16 | `rollback-state-migration.ts`     | 状态迁移回滚               | ✅ writeLog |
| S17 | `archive-dag-tasks.ts`            | DAG 任务归档               | ✅ writeLog |
| S18 | `reset-interrupt-state.ts`        | 中断状态重置               | ✅ writeLog |
| S19 | `rotate-logs.ts`                  | 日志轮转脚本               | ✅ writeLog |
| S20 | `monitoring-status.ts`            | 监控状态报告               | ✅ writeLog |
| S21 | `nightly-compaction.ts`           | 夜间压缩脚本               | ✅ writeLog |
| S22 | `gate-lifecycle-audit.ts`         | Gate 生命周期审计          | ✅ writeLog |
| S23 | `framework-compliance-check.ts`   | 框架合规检查               | ✅ writeLog |
| S24 | `ci-critical-files-check.ts`      | CI 关键文件检查            | ✅ writeLog |
| S25 | `ci-semantic-validator.ts`        | CI 语义验证器              | ✅ writeLog |
| S26 | `compliance-audit.sh`             | 合规审计 Shell             | — (shell)   |
| S27 | `enforcement-mode-check.sh`       | 执行模式检查 Shell         | — (shell)   |
| S28 | `framework-health-check.sh`       | 框架健康检查 Shell         | — (shell)   |
| S29 | `integrity-chain-bundle.sh`       | 完整性链打包 Shell         | — (shell)   |
| S30 | `path-canonical-lint.sh`          | 路径规范化检查 Shell       | — (shell)   |
| S31 | `reconciliation-check.sh`         | 状态一致性检查 Shell       | — (shell)   |
| S32 | `setup.sh`                        | 框架安装 Shell             | — (shell)   |

### 1.6 状态 Schema（18 个）

| #    | Schema 文件                         | 对应模块                      |
| ---- | ----------------------------------- | ----------------------------- |
| SC01 | `eslint-state.schema.json`          | eslint-audit                  |
| SC02 | `type-check-state.schema.json`      | code-quality-check            |
| SC03 | `dependency-state.schema.json`      | code-quality-check            |
| SC04 | `format-state.schema.json`          | format-after                  |
| SC05 | `write-audit-state.schema.json`     | audit-after                   |
| SC06 | `knowledge-cache-state.schema.json` | knowledge_cache_search/attest |
| SC07 | `knowledge-state.schema.json`       | module_scope_declare          |
| SC08 | `knowledge-audit-state.schema.json` | janitor/nightly-compaction    |
| SC09 | `compliance-records.schema.json`    | compliance-gate               |
| SC10 | `config-read-state.schema.json`     | config_read_attest            |
| SC11 | `keystone-hashes.schema.json`       | keystone-validate             |
| SC12 | `tdd-enforcement-state.schema.json` | tdd-before/after              |
| SC13 | `transaction-state.schema.json`     | state-utils                   |
| SC14 | `read-audit.schema.json`            | read-audit                    |
| SC15 | `auto-plan-history.schema.json`     | dispatch-auto                 |
| SC16 | `dispatch-history.schema.json`      | dispatch-subagent             |
| SC17 | `plugin-state.schema.json`          | 全局 plugin 状态              |
| SC18 | `state-segments.schema.json`        | state-reconciliation          |

---

## 2. 参数依赖热力图

### 各身份参数被引用的模块数

| 参数            | 被引用模块数 | 来源                                                                   | 可靠性           |
| --------------- | ------------ | ---------------------------------------------------------------------- | ---------------- |
| **sessionID**   | 32+ 个模块   | `input.sessionID` / `context.sessionID`（L0）                          | ✅ 100% 可靠     |
| **agent**       | 28+ 个模块   | `resolveAgent(sessionID)` → DB session_map → ctx 文件回退 → `""`       | ⚠️ 可能返回空    |
| **taskId**      | 15+ 个模块   | `resolveTaskId(sessionID)` / `args.task_id` / `resolveChecklistTaskId` | ⚠️ 可能为 null   |
| **domainId**    | 6 个模块     | `resolveDomainId(sessionID)` / `args.domain`                           | ⚠️ 可能为 null   |
| **dag_task_id** | 4 个模块     | `args.dag_task_id`                                                     | ⚠️ `.optional()` |
| **pipelineId**  | 3 个模块     | `resolvePipelineId(args, sessionID)` — v19 统一解析                    | ✅ v19 统一      |

### sessionID 的传递链路（跨模块）

```
OpenCode 框架注入
  │  input.sessionID / context.sessionID
  │
  ├─→ 24 个 Plugin（通过 input.sessionID）
  │     └─→ resolveAgent(sessionID)     ← DB session_map → ctx 文件回退
  │     └─→ resolveTaskId(sessionID)    ← 同上
  │     └─→ resolveDomainId(sessionID)  ← 同上
  │
  ├─→ 18 个 Tool（通过 context.sessionID）
  │     └─→ 直接用作 key 或传给 L39/L41
  │
  ├─→ 6 个 MCP Tool（通过 args 或 env）
  │
  └─→ 42 个 Core Library（通过函数参数传入）
```

---

## 3. DB 表 → 功能模块映射（DB schema v32，42 张表，Phase 0 基线修正）

### 3.1 完整映射表

> **v2.3 更新**: DB schema v23。v22 新增 UC7KS 索引，v23 DROP `dispatch_context`（OPT-06 死表清理）。

| DB 表                              | 所属功能域               | 写模块                                                                   | 读模块                                                         | DB-canonical?                       |
| ---------------------------------- | ------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------- |
| `schema_version`                   | System                   | db-manager.ts                                                            | db-manager.ts, self-test                                       | ✅                                  |
| `substate_kv`                      | System（通用 JSON blob） | substate-manager, state-utils, knowledge_cache_search, compliance-gate   | substate-manager, uc7ks-utils, compliance-gate, self-test      | ✅ 唯一写源                         |
| `file_baseline_kv`                 | System                   | state-utils                                                              | state-compactor                                                | ✅                                  |
| `machine_meta`                     | Machine                  | db-state-manager                                                         | db-state-manager, self-test                                    | ✅                                  |
| `machine_contracts`                | Machine                  | db-state-manager                                                         | db-state-manager, keystone-validate                            | ✅                                  |
| **`gate_sessions`**                | **Gate**                 | **compliance-gate**                                                      | **compliance-gate, gate-core, self-test**                      | **✅ 主路径（JSON 回退冻结）**      |
| `gate_drained_sessions`            | Gate                     | compliance-gate                                                          | compliance-gate                                                | ✅                                  |
| `gate_session_index`               | Gate                     | compliance-gate                                                          | compliance-gate                                                | ✅                                  |
| `gate_store_meta`                  | Gate                     | compliance-gate                                                          | compliance-gate                                                | ✅                                  |
| `gate_audit_history`               | Gate                     | compliance-gate                                                          | compliance-gate                                                | ✅                                  |
| `gate_compactor_index`             | Gate                     | state-compactor                                                          | state-compactor                                                | ✅                                  |
| **`session_map`**                  | **Session**              | **session.ts, dispatch_subagent.ts**                                     | **agent-resolver, checklist-before, scope-before, 9+ plugins** | **✅ 主路径（ctx 文件回退）**       |
| `session_log`                      | Session                  | dispatch_subagent                                                        | task-after                                                     | ✅                                  |
| `dispatch_queue`                   | Dispatch                 | dispatch_subagent                                                        | task-before, task-after                                        | ✅                                  |
| `dispatch_context`                 | Dispatch (❌ v23 DROP)   | (已移除)                                                                 | (已移除)                                                       | ❌ v23 DROP                         |
| `dispatch_prompt_refs`             | Dispatch                 | dispatch_subagent                                                        | task-before                                                    | ✅                                  |
| `dispatch_attempts`                | Dispatch                 | dispatch_subagent                                                        | dispatch_subagent                                              | ✅                                  |
| `dispatch_failed_log`              | Dispatch                 | dispatch_subagent                                                        | —                                                              | ✅                                  |
| `dispatch_payload_integrity`       | Dispatch                 | dispatch_subagent                                                        | task-before                                                    | ✅                                  |
| `execution_checklist_runs`         | Checklist                | execution-checklist                                                      | checklist-before, checklist_status                             | ✅                                  |
| `execution_checklist_items`        | Checklist                | execution-checklist, checklist-before                                    | checklist-before, checklist_status                             | ✅                                  |
| `execution_checklist_events`       | Checklist                | checklist-before                                                         | checklist-before                                               | ✅                                  |
| `audit_log`                        | Audit                    | audit-after, log-manager                                                 | —                                                              | ✅                                  |
| `audit_trail`                      | Audit                    | audit-after                                                              | —                                                              | ✅                                  |
| `read_audit`                       | Audit                    | read-track-after                                                         | read-audit, knowledge_cache_attest                             | ✅ 主路径（JSONL 回退冻结）         |
| **`uc7ks_pipeline_state`**         | **Knowledge**            | **knowledge_cache_search, knowledge_cache_attest, module_scope_declare** | **uc7ks-utils, knowledge_cache_attest**                        | **✅ v19 DB-Canonical（唯一写源）** |
| `knowledge_entries`                | Knowledge                | knowledge-store（KC 工具）                                               | knowledge_cache_search                                         | ✅                                  |
| `knowledge_files`                  | Knowledge                | knowledge-store                                                          | knowledge_cache_search                                         | ✅                                  |
| `knowledge_entry_tags`             | Knowledge                | knowledge-store                                                          | knowledge_cache_search                                         | ✅                                  |
| `knowledge_materialization_jobs`   | Knowledge                | KC 工具                                                                  | KC 工具                                                        | ✅                                  |
| `knowledge_session_access_archive` | Knowledge                | nightly-compaction                                                       | —                                                              | ✅                                  |
| `permission_snapshot`              | Permission               | permission-reader                                                        | permission-reader                                              | ✅                                  |
| `agent_registry_snapshot`          | Permission               | permission-reader                                                        | permission-reader                                              | ✅                                  |
| `template_resolution_snapshot`     | Permission               | permission-reader                                                        | permission-reader                                              | ✅                                  |
| `approval_read_context`            | Approval                 | approval-read-context                                                    | compliance-gate                                                | ✅                                  |

### 3.2 表与功能模块对应关系

```
功能域                  DB 表数    模块数    是否完整对应？
─────────────────────────────────────────────────────────
Gate                    6          2         ✅ 完整
Checklist               3          2         ✅ 完整
Dispatch                6          5         ✅ 完整
Session                 2          3         ⚠️ session_map 有文件回退
Audit                   3          3         ✅ read_audit 有 JSONL 回退
Knowledge               5          6         ✅ v19 DB-Canonical 统一
Permission              3          1         ✅
Machine                 2          2         ✅
System                  3          4         ✅
Approval                1          1         ✅
─────────────────────────────────────────────────────────
合计                    35         29
```

### 3.3 v19/v20/v21 迁移变更说明

| 变更                                          | Schema 版本 | 描述                                                                                   |
| --------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| ➕ 新增 `uc7ks_pipeline_state`                | v19         | 统一 UC7KS pipeline 状态管理，替代 JSON blob + 3 张遗留行表                            |
| ➖ 删除 `knowledge_session_access`            | v20         | 被 `uc7ks_pipeline_state` 替代                                                         |
| ➖ 删除 `knowledge_discovery`                 | v20         | 被 `uc7ks_pipeline_state` 替代                                                         |
| ➖ 删除 `knowledge_attestation`               | v20         | 被 `uc7ks_pipeline_state` 替代                                                         |
| ➕ `gate_sessions` 加列 `opencode_session_id` | v21         | V7.2 修复：gate session 创建时捕获 OpenCode session ID，用于 checklist run 正确 wiring |

**v19 `uc7ks_pipeline_state` 表结构**:

```sql
CREATE TABLE uc7ks_pipeline_state (
  pipeline_id          TEXT NOT NULL,
  agent                TEXT NOT NULL,
  domain_id            TEXT NOT NULL,
  session_id           TEXT,
  dag_task_id          TEXT,
  discovery_status     TEXT,
  discovered_files     TEXT,    -- JSON array
  discovered_count     INTEGER,
  missing_topics       TEXT,    -- JSON array
  discovered_at        INTEGER,
  attestation_status   TEXT,
  cache_sufficient     INTEGER,
  files_read           TEXT,    -- JSON array
  evidence_file_count  INTEGER,
  content_summary      TEXT,
  attested_at          INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  UNIQUE(pipeline_id, agent, domain_id)
)
```

**关键改进**:

- `pipeline_id` 由 `resolvePipelineId(args, sessionID)` 统一解析，消除 `"unknown"` vs `""` 不一致
- SQLite UNIQUE + UPSERT 提供行级锁，消除 RMW 竞态
- 直接列查询，无 JSON blob 解析，无 legacy fallback

---

## 4. 身份参数统一性分析

### 4.1 同一参数的不同来源

| 模块                     | 需要的参数  | 实际来源                                                                                      | 一致性风险                         |
| ------------------------ | ----------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| `checklist-before`       | taskId      | `resolveChecklistTaskId(input)` → `args.task_id` → `dbReadSessionMap(sid).dag_task_id` → null | 三源回退，可能 null                |
| `scope-before`           | agent       | `resolveAgent(sessionID)` → DB session_map → ctx 文件回退 → `""`                              | 可能 "" → write-scope 跳过         |
| `scope-before`           | taskId      | 同 checklist-before                                                                           | 同上                               |
| `scope-before`           | domainId    | `resolveDomainId(sessionID)`                                                                  | 同上                               |
| `knowledge_cache_search` | pipelineId  | `resolvePipelineId(args, sessionID)` — v19 统一                                               | ✅ v19 已统一                      |
| `knowledge_cache_attest` | pipelineId  | `resolvePipelineId(args, sessionID)` — v19 统一                                               | ✅ v19 已统一                      |
| `compliance-gate`        | sessionId   | `args.session_id`（gate session，非 OpenCode session）                                        | **与 checklist 的 session 不同！** |
| `session.ts`             | agent       | `input.agent`（来自 chat.message hook）                                                       | ✅ 可靠                            |
| `dispatch_subagent`      | dag_task_id | `args.dag_task_id`（`.optional()`）                                                           | 可能空                             |

### 4.2 同一概念的不同命名

| 概念                           | 在不同模块中的名称                                                                |
| ------------------------------ | --------------------------------------------------------------------------------- |
| 当前 agent 的 OpenCode session | `input.sessionID`, `context.sessionID`, `sessionId`, `sid`, `opencode_session_id` |
| Gate session                   | `session_id` (args), `cg_ses_*` (runtime value), `gateSessionId` (v1.1 统一)      |
| DAG task ID                    | `dag_task_id`, `task_id`, `taskId`, `dagTaskId`                                   |
| Domain ID                      | `domain_id`, `domainId`, `domain`                                                 |
| Agent type                     | `agent`, `agentType`, `agent_type`, `agentRef`, `agentKey`                        |
| Pipeline ID (v19)              | `pipeline_id`, `pipelineId` — 统一解析自 `resolvePipelineId()`                    |

---

## 5. 汇总：所有模块按身份参数依赖分组

| 依赖级别                                     | 模块数 | 典型模块                                                                                                                                                                           | 如果 identity 解析失败 |
| -------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **重度依赖**（需 agent + taskId + domainId） | 6      | knowledge_cache_search, knowledge_cache_attest, scope-before, checklist-before, module_scope_declare, compliance-gate                                                              | 🔴 功能完全失效        |
| **中度依赖**（需 agent + taskId）            | 9      | dispatch_subagent, config_read_attest, task-before, gate-before, audit-before, tdd-before, uc7ks-before, safe_edit/shell/delete/mkdir/test                                         | 🟡 部分功能降级        |
| **轻度依赖**（需 agent only）                | 13     | session, dispatch-before, question-policy, format-after, hook-config-guard, git-guard, json-validate, cache-after, uc7ks-after, tdd-after, audit-after, gate-after, scope-after    | 🟢 日志/审计降级       |
| **无依赖**                                   | 12+    | knowledge_gap_report, janitor, nightly-compaction, safe_diff, keystone-validate, code-quality-check, eslint-audit, dag-policy, db-manager, log-manager, critical-files, tool-scope | ✅ 不受影响            |

---

## 6. 日志系统集成状态（Log Central Management Subsystem v3.0）

| 日志功能                | 实现位置           | 状态 | 说明                                     |
| ----------------------- | ------------------ | ---- | ---------------------------------------- |
| 缓冲异步写入            | `log-manager.ts`   | ✅   | 内存缓冲 → POSIX O_APPEND 原子刷盘       |
| 源感知索引              | `log-manager.ts`   | ✅   | LogIndex.sources 按 source+category 追踪 |
| 日志级别过滤            | `log-manager.ts`   | ✅   | config.logLevel: DEBUG/INFO/WARN/ERROR   |
| 自动归档                | `log-manager.ts`   | ✅   | archiveCheck() 按 retention_days 归档    |
| 自错误日志              | `log-manager.ts`   | ✅   | \_error.log 兜底                         |
| 原子索引更新            | `log-manager.ts`   | ✅   | tmp + rename 原子写                      |
| Plugin 调用方集成       | 全部 24 个 plugin  | ✅   | 100% 覆盖                                |
| Tool 调用方集成         | 全部 18 个 tool    | ✅   | 100% 覆盖                                |
| MCP Tool 调用方集成     | 全部 6 个 MCP tool | ✅   | 100% 覆盖                                |
| Core Library 调用方集成 | 38/42 个 lib       | ⚠️   | 90% 覆盖，L17L36 为类型定义无需日志      |

---

## 7. 并发安全分析

| 共享状态                                       | 并发保护                  | 风险描述               | v20 状态    |
| ---------------------------------------------- | ------------------------- | ---------------------- | ----------- |
| `uc7ks_pipeline_state`（统一 pipeline 状态）   | ✅ SQLite UNIQUE + UPSERT | 行级锁，无 RMW 竞态    | ✅ v19 修复 |
| `substate_kv`（单行 JSON blob）                | ❌ 无行级锁               | RMW 竞态——后写覆盖先写 | ❌ 待修复   |
| `dispatch_ctx/.dispatch_ctx`（共享文件）       | ❌ 无锁                   | 并发 dispatch 相互覆盖 | ❌ 待迁移   |
| `dispatch_ctx/ctx/*.json`（per-dispatch 文件） | ✅ 天然隔离               | `dagTaskId` 为键       | ✅          |
| `session_map` DB                               | ✅ SQLite UNIQUE          | 行级锁                 | ✅          |
| `execution_checklist_*` DB                     | ✅ SQLite 事务            | 行级锁                 | ✅          |
| `gate_sessions` DB                             | ✅ SQLite 事务            | 行级锁                 | ✅          |

---

## 8. 建议修复优先级（v2.2 更新 — OPT 全量实施 + E2E 验证）

> **v2.2 更新**: 全部 OPT-01~10 已实施并通过 E2E 验证（4 子 agent × 64 checks）。G2 DB-canonical 收尾完成。
> **v2.1 更新**: V1.1/V1.2/V7.2/V1.3/G3 已通过代码验证修复。

| 优先级 | 修复项                                                                                                  | 状态      |
| ------ | ------------------------------------------------------------------------------------------------------- | --------- |
| P0     | ✅ 统一 knowledge_cache 的 task_id fallback（`resolvePipelineId` v19）                                  | ✅ 已修复 |
| P0     | ✅ 修复 knowledge_cache_state 双路径分裂（`uc7ks_pipeline_state` v19/v20）                              | ✅ 已修复 |
| P0     | ✅ dag_task_id 缺失时 WARNING 日志（V1.1, dispatch_subagent.ts:287）                                    | ✅ 已修复 |
| P1     | ✅ session_map 无条件写入（V1.2, agent="pending" 占位, L772）                                           | ✅ 已修复 |
| P1     | ✅ gateSessionId → opencode_session_id 正确 wiring（V7.2, v21 加列）                                    | ✅ 已修复 |
| P1     | ✅ resolveAgent FRAMEWORK_AGENT 回退（V1.4, agent-resolver.ts:181）                                     | ✅ 已修复 |
| P1     | ✅ scope-before 空 agent 阻断（V6.1, scope-before.ts:200）                                              | ✅ 已修复 |
| P1     | ✅ tool-scope FALLBACK 扩展至 20 工具（V6.2, tool-scope.ts:442）                                        | ✅ 已修复 |
| P1     | ✅ config_read_attest FRAMEWORK_AGENT fallback（V3.3, L82）                                             | ✅ 已修复 |
| P2     | ✅ substate_kv 并发保护（G3, dbWriteSubState 乐观锁, L91）                                              | ✅ 已修复 |
| P2     | ✅ .dispatch_ctx 写入移除（V1.3 Phase 2, dispatch_subagent.ts:702）                                     | ✅ 已修复 |
| P2     | ✅ 统一 session_id 概念 — gate_sessions 已有 opencode_session_id 列                                     | ✅ 已修复 |
| P2     | ✅ 移除 gate-state.json 文件回退（OPT-01, state-compactor.ts writeHotState no-op）                      | ✅ 已修复 |
| P2     | ✅ 移除 session_map ctx 文件回退（OPT-02, agent-resolver.ts .dispatch_ctx/\_dispatch_target.json 移除） | ✅ 已修复 |

---

## 9. 相关文档

| 文档                                             | 关系                             |
| ------------------------------------------------ | -------------------------------- |
| `agent-execution-flow-vulnerability-analysis.md` | 脆弱点详细分析                   |
| `db-canonical-p0-checklist-optimization-plan.md` | DB-canonical 目标架构            |
| `uc7ks-pipeline-db-canonical-design.md`          | UC7KS Pipeline DB-Canonical 设计 |
| `log-backlog/framework-log-system-design.md`     | 日志系统设计                     |

---

## 10. 优化项与实施方案（v2.1 新增）

### 10.1 优化项总览（v2.2 — 全量实施完成）

> **v2.2 更新**: 全部 10 个 OPT 项已实施并通过 E2E 验证（2026-06-23）。

| 优先级 | 优化项 ID | 名称                                    | 目标子系统          | 实施状态  | 实施摘要                                                                                                    |
| ------ | --------- | --------------------------------------- | ------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| **P1** | OPT-01    | gate-state.json 文件回退移除            | DB-canonical        | ✅ 已实施 | `writeHotState` → no-op; `GATE-FILE-FALLBACK` → `GATE-DB-*`; read fallback → throw                          |
| **P1** | OPT-02    | session_map ctx 文件回退移除            | DB-canonical        | ✅ 已实施 | `.dispatch_ctx` 写入/读取移除; `_dispatch_target.json` 回退移除; `ResolvedWithSource` 类型清理              |
| **P1** | OPT-03    | read_audit JSONL 回退移除               | DB-canonical        | ✅ 已实施 | `verifyRead`/`getReadEventsForSession` JSONL fallback 移除; DB 唯一路径                                     |
| **P2** | OPT-04    | substate_kv 行级锁升级                  | Concurrency Safety  | ✅ 已就绪 | `expectedUpdatedAt` 参数已存在; 高频调用方可逐步迁移（infra 就绪）                                          |
| **P2** | OPT-05    | session_id 概念统一（gate vs OpenCode） | Identity Management | ✅ 已实施 | `dispatch-db.ts` 参数 `sessionId`→`opencodeSessionId` (3 函数, ~10 处)；v21 `opencode_session_id` 列 + 回退 |
| **P2** | OPT-06    | dispatch_context DB 表清理              | DB-canonical        | ✅ 已实施 | v23 DROP, `dbInsertDispatchContext` 调用移除, `session_map` 是规范来源                                      |
| **P3** | OPT-07    | agent-resolver 回退链简化               | Identity Management | ✅ 已实施 | `_dispatch_target.json` fallback 从 `resolveAgent()` 移除; 链: session_map → FRAMEWORK_AGENT → ERROR        |
| **P3** | OPT-08    | tool-scope FALLBACK 动态化              | Permission Matrix   | ✅ 已实施 | `configFallback` 从 `dispatch_policy.fallback_tools` 读取; `project.config.json` 新增 24 工具列表           |
| **P3** | OPT-09    | uc7ks_pipeline_state 索引优化           | DB Performance      | ✅ 已实施 | v22: `idx_uc7ks_agent_domain` + `idx_uc7ks_dag_task` (partial)                                              |
| **P3** | OPT-10    | 日志归档自动化                          | Log Central Mgmt    | ✅ 已实施 | `logArchiveStep()` 集成到 `nightly-compaction.ts` main()                                                    |

### 10.2 实施方案

#### OPT-01: gate-state.json 文件回退移除

**当前状态**: `gate_sessions` DB 表为主路径，`gate-state.json` 为冻结快照回退（G2 ⚠️ 85%）

**实施方案**:

1. `gate-core.ts`: 移除 `writeGateStateJson()` 调用（L629-633）
2. `state-compactor.ts`: 移除 `GATE-FILE-FALLBACK` 日志事件（L334, L438, L518）
3. `framework-self-test.ts`: 更新 Check（gate-state.json 存在性检查 → 不再要求）
4. 保留 `gate-state.json` 作为一次性迁移快照（只读），不再写入
5. 验证: `bun .opencode/scripts/framework-self-test.ts` 全通过

**风险**: 低 — DB 已是主路径，JSON 仅冻结快照
**回滚**: 恢复 `writeGateStateJson()` 调用

---

#### OPT-02: session_map ctx 文件回退移除

**当前状态**: `session_map` DB 表为主路径，`ctx/{dagTaskId}.json` 文件为回退（G2 ⚠️ 70%）

**实施方案**:

1. `agent-resolver.ts`: 移除 `DISPATCH-CTX-FALLBACK` 读取路径（L471, L660）
2. `resolve_domain_id.ts`: 移除 `.dispatch_ctx` 文件回退注释（L5, L21, L80, L99, L103）
3. `task-after.ts`: 移除 legacy `.dispatch_ctx` 只读清理代码（L203-222）
4. 保留 `ctx/{dagTaskId}.json` 写入（dispatch_subagent.ts 仍写，用于 task-after.ts 读取）
5. 迁移 task-after.ts 直接从 `session_map` DB 读取 `dag_task_id`
6. 验证: dispatch → task-after 全链路测试

**风险**: 中 — 需确保 `session_map` DB 写入在 task-after 读取前完成
**回滚**: 恢复 ctx 文件回退路径

---

#### OPT-03: read_audit JSONL 回退移除

**当前状态**: `read_audit` DB 表为主路径，`read_audit.jsonl` 为只读历史回退（⚠️ 90%）

**实施方案**:

1. `read-audit.ts`: 移除 JSONL fallback 读取逻辑（L282-466 中的 fallback 分支）
2. 保留 `migrate-read-audit.ts` 脚本（用于一次性历史数据迁移）
3. 验证: `verifyRead()` 和 `getReadEventsForSession()` 仅走 DB 路径

**风险**: 低 — JSONL 仅含历史数据，DB 已覆盖所有新写入
**回滚**: 恢复 fallback 分支

---

#### OPT-04: substate_kv 行级锁升级

**当前状态**: G3 已添加 `expectedUpdatedAt` 乐观锁，但默认调用未使用（向后兼容）

**实施方案**:

1. 审计所有 `dbWriteSubState()` 调用方，标注是否需要乐观锁
2. 高频并发写入方（`compliance-gate`, `knowledge_cache_search`）改用 `dbWriteSubStateWithLock()`
3. 低频写入方（`state-reset`, `migrate-*`）保持无锁
4. 添加 `dbAtomicWriteSubState()` 事务封装（SQLite BEGIN IMMEDIATE）

**风险**: 低 — 乐观锁接口向后兼容
**回滚**: 调用方改回无锁版本

---

#### OPT-05: session_id 概念统一

**当前状态**: ✅ 已实施（最小化方案，2026-06-24）。v21 已加 `opencode_session_id` 列做运行时区分。

**实施完成**:

1. ~~全局审计~~ → 已完成：全量审计确认仅 `dispatch-db.ts` 有实际歧义
2. ~~gate 相关统一为 gateSessionId~~ → 已在 v1.1 完成（state-compactor, gate-core, compliance-gate）
3. `dispatch-db.ts` 参数 `sessionId`→`opencodeSessionId`（3 函数, ~10 处）：**已完成**
4. DB 列名保持 `session_id`（gate）+ `opencode_session_id`（OpenCode）：**已完成（v21）**
5. ~~JSDoc 注释~~ → 已完成：`dispatch-db.ts` 3 函数 JSDoc 均标注 "NOT a gate session (cg*ses*\*)"

**审计结论**: 除 `dispatch-db.ts` 外，其他文件均已有显式命名（gateSessionId/opencodeSessionId）或 runtime fallback。无剩余运行时风险。
**回滚**: git revert

---

#### OPT-06: dispatch_context DB 表清理

**当前状态**: `dispatch_context` DB 表存在但 V1.3 Phase 2 后 `.dispatch_ctx` 文件写入已移除

**实施方案**:

1. 审计 `dispatch_context` 表的读写方
2. 如果仅被 `agent-resolver.ts` 读取（且已有 session_map 替代）→ 标记为 deprecated
3. 添加迁移脚本：将 `dispatch_context` 数据导入 `session_map`（如尚未迁移）
4. v22 schema: DROP TABLE `dispatch_context`
5. 更新 `db-manager.ts` schema 版本

**风险**: 中 — 需确认无活跃读取方
**回滚**: 恢复表定义

---

#### OPT-07: agent-resolver 回退链简化

**当前状态**: `resolveAgent()` 回退链为 session_map DB → \_dispatch_target.json → FRAMEWORK_AGENT → ""

**实施方案**:

1. V1.4 已添加 FRAMEWORK_AGENT 回退
2. 评估 `_dispatch_target.json` 文件回退是否仍需要（OPT-02 完成后可能冗余）
3. 如果 session_map DB 可靠性已足够 → 移除 `_dispatch_target.json` 读取
4. 最终回退链: session_map DB → FRAMEWORK_AGENT → ERROR

**风险**: 中 — 需确保 session_map DB 写入时机
**回滚**: 恢复文件回退

---

#### OPT-08: tool-scope FALLBACK 动态化

**当前状态**: V6.2 已将 FALLBACK 从 7 扩展到 20 个工具，但仍是硬编码列表

**实施方案**:

1. 从 `project.config.json` 的 `dispatch_policy.fallback_tools` 读取配置
2. 未配置时使用当前 20 工具作为默认值
3. 允许项目级自定义 FALLBACK 列表

**风险**: 低 — 配置驱动，默认值不变
**回滚**: 移除配置读取

---

#### OPT-09: uc7ks_pipeline_state 索引优化

**当前状态**: `uc7ks_pipeline_state` 表有 UNIQUE(pipeline_id, agent, domain_id) 索引

**实施方案**:

1. 分析高频查询模式（`uc7ks-utils.ts` 中的查询）
2. 添加覆盖索引: `CREATE INDEX idx_uc7ks_agent_session ON uc7ks_pipeline_state(agent, session_id)`
3. 添加覆盖索引: `CREATE INDEX idx_uc7ks_dag_task ON uc7ks_pipeline_state(dag_task_id) WHERE dag_task_id IS NOT NULL`
4. v22 schema: 添加索引

**风险**: 低 — 仅添加索引，不修改数据
**回滚**: DROP INDEX

---

#### OPT-10: 日志归档自动化

**当前状态**: `log-rotator.ts` 和 `rotate-logs.ts` 存在但需手动触发

**实施方案**:

1. 在 `nightly-compaction.ts` 中集成日志归档调用
2. 添加 cron-like 调度（或依赖外部 cron 调用 `nightly-compaction`）
3. 归档阈值: 日志文件 > 10MB 或 > 7 天
4. 归档路径: `.task_temp/_logs/archive/{date}/`

**风险**: 低 — 归档操作非破坏性
**回滚**: 移除归档调用

### 10.3 执行优先级与依赖关系

```
Phase 1 (P1 — DB-canonical 收尾):
  OPT-01 (gate-state.json) ──┐
  OPT-02 (session_map ctx) ──┤── G2 完成度 → 100%
  OPT-03 (read_audit JSONL) ─┘
                              │
Phase 2 (P2 — 并发与命名):    │
  OPT-04 (substate_kv 锁) ◄──┘ (依赖 G3 乐观锁)
  OPT-05 (session_id 统一)
  OPT-06 (dispatch_context 清理) ◄── OPT-02 (依赖 ctx 回退移除)

Phase 3 (P3 — 性能与维护):
  OPT-07 (agent-resolver 简化) ◄── OPT-02 (依赖 ctx 回退移除)
  OPT-08 (FALLBACK 动态化)
  OPT-09 (索引优化)
  OPT-10 (日志归档自动化)
```

### 10.4 预期收益矩阵

| 优化项 | DB-canonical 完成度 | 并发安全 | 可维护性 | 性能 | 实施风险 |
| ------ | ------------------- | -------- | -------- | ---- | -------- |
| OPT-01 | +10%                | —        | +        | —    | 低       |
| OPT-02 | +15%                | +        | +        | —    | 中       |
| OPT-03 | +5%                 | —        | +        | —    | 低       |
| OPT-04 | —                   | ++       | —        | —    | 低       |
| OPT-05 | —                   | —        | ++       | —    | 低       |
| OPT-06 | +5%                 | —        | +        | +    | 中       |
| OPT-07 | —                   | —        | +        | +    | 中       |
| OPT-08 | —                   | —        | +        | —    | 低       |
| OPT-09 | —                   | —        | —        | ++   | 低       |
| OPT-10 | —                   | —        | +        | —    | 低       |

---

## 11. E2E 验证与调查发现（v2.2 新增, 2026-06-23）

### 11.1 E2E 验证结果

4 个子 agent 并行验证，全部通过：

| 验证 Agent   | 测试数 | 通过 | 失败 | 验证内容                                                  |
| ------------ | :----: | :--: | :--: | --------------------------------------------------------- |
| DB Schema    |   5    |  5   |  0   | v22 索引、DROP 表、opencode_session_id、pipeline_state 列 |
| Code Audit   |   6    |  6   |  0   | OPT-01~08 源码 grep 确认                                  |
| Self-Test    |   64   |  61  | 3\*  | framework-self-test.ts 全量检查                           |
| Config & Log |   6    |  5   | 1⛔  | project.config.json + nightly-compaction + tool-scope     |

\*3 项预存在失败（Check 26/27/48），与 OPT 变更无关。
⛔1 项被 P0 checklist 阻塞（safe_shell 不可用）。

### 11.2 🔴 关键发现：Task() 绕过 dispatch_subagent 的根因

**现象**: 主 agent 在 `dispatch_subagent` 失败后，直接使用 `Task()` 携带手工编写的 `//DISPATCH_TOKEN:<hex>` 成功派遣子 agent，绕过了全部 P0 协议。

**根因链**:

| 层次       | 问题                                                         | 文件                                       | 影响                                                                                       |
| ---------- | ------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **根因 1** | `dispatch_subagent.ts` 工具中 `SRC` 变量未定义               | `.opencode/tools/dispatch_subagent.ts:290` | `dispatch_subagent` 在首次调用时 `ReferenceError: SRC is not defined`，无法生成包装 prompt |
| **根因 2** | `task-before.ts` 插件未在 `opencode.json` 中注册             | `opencode.json:884-890`                    | DISPATCH-INTEGRITY 哈希验证从未执行——`Task()` 可携带任意 prompt 通过                       |
| **结果**   | P0 checklist `dispatch_payload` 阶段 3 项 blocker 无法被满足 | `execution-checklist.ts:135-155`           | 子 agent 写工具被阻断，但 Task() 本身不被阻断                                              |

**详细分析**:

1. **`SRC` 未定义**: `.opencode/tools/dispatch_subagent.ts` 第 290 行使用 `writeLog(SRC, "WARN", {...})`，但 `SRC` 常量从未在该文件中声明。首次调用 `dispatch_subagent` 时，当 `dagTaskId` 为空触发 WARNING 日志，立即抛出 `ReferenceError`。

2. **插件注册缺失**: `opencode.json` 的 `plugin` 数组仅注册 5 个插件：
   - `read-track-after.ts`, `scope-before.ts`, `question-policy-before.ts`, `format-after.ts`, `checklist-before.ts`

   磁盘上有 24 个插件文件，但 **19 个未注册**，包括：
   - `task-before.ts` (DISPATCH-INTEGRITY 验证)
   - `dispatch-before.ts` (PLAN-FIRST 阻断)
   - `gate-before.ts` (Gate 工具前置校验)
   - `task-after.ts` (Task() 后清理)
   - `audit-before.ts`, `audit-after.ts` (审计)
   - `tdd-before.ts`, `tdd-after.ts` (TDD 强制)
   - `uc7ks-before.ts`, `uc7ks-after.ts` (UC7KS)
   - 等 11 个

3. **安全影响**: 由于 `task-before.ts` 未加载，`DISPATCH_TOKEN` 哈希验证从未执行。主 agent 可以：
   - 手工编写任意 `Task()` prompt（含伪造的 `//DISPATCH_TOKEN`）
   - 绕过 `dispatch_subagent` 的 P0 协议注入
   - 绕过 scope boundary 声明
   - 绕过 UC7KS 知识管道注入

   **实际影响有限**: 子 agent 仍受 `scope-before.ts`（已注册）和 `checklist-before.ts`（已注册）约束，写工具被 P0 checklist 阻断。但子 agent 的 _执行_ 不被阻断——它可以读取代码、运行测试、返回结果。

### 11.3 修复建议

| 优先级 | 修复项             | 文件                                   | 方案                                                                               |
| ------ | ------------------ | -------------------------------------- | ---------------------------------------------------------------------------------- |
| **P0** | 定义 `SRC` 常量    | `.opencode/tools/dispatch_subagent.ts` | 在文件顶部添加 `const SRC = "tool-dispatch-subagent";`                             |
| **P0** | 注册全部 24 个插件 | `opencode.json`                        | 将 `plugin` 数组扩展为 24 个条目                                                   |
| **P1** | 验证插件加载完整性 | `framework-self-test.ts`               | 新增 Check: 验证 `opencode.json.plugin` 数组包含所有 `.opencode/plugins/*.ts` 文件 |

### 11.4 其他 E2E 发现

| #   | 发现                                                                  | 严重度 | 来源       |
| --- | --------------------------------------------------------------------- | :----: | ---------- |
| F1  | `uc7ks_pipeline_state` 实际 19 列（期望 ≥16）— schema 演进            |  LOW   | DB Schema  |
| F2  | 6 个 UC7KS 索引（超过要求的 2 个）— 额外索引有益                      |  INFO  | DB Schema  |
| F3  | `writeHotState` no-op 仍在 4 处被调用 (L237/280/545/561) — 无害可清理 |  LOW   | Code Audit |
| F4  | ~11 orphan index.json 条目 — janitor 可清理                           | MEDIUM | Self-Test  |
| F5  | `.pending.json` 有 10 个待处理条目                                    | MEDIUM | Self-Test  |
| F6  | Check 54: 420 标签仅 54 被 semantic_map 覆盖 (13%)                    |  LOW   | Self-Test  |
| F7  | v1→v22 迁移历史完整无损                                               |  INFO  | DB Schema  |
