# OpenCode Tool 详细参考

> 生成日期: 2026-07-01 | 基于 work-one 项目当前代码状态（更新版）
> 配套文档: opencode-cognitive-map.md（第 1.3 节 Tool 全景）

---

## 1. 分类总览

框架中的 Tool 分三大类，共计 **50+ 个工具**：

| 类别 | 数量 | 来源 | 说明 |
|------|------|------|------|
| **OpenCode 内置工具** | 11 | 平台原生 | read/edit/bash/glob/grep/task/question/todowrite/webfetch/websearch/skill |
| **自定义工具** | 23 | `.opencode/tools/*.ts` | safe_* 安全包装 + 框架控制 + UC7KS 知识 + Read Attestation + 维护工具 |
| **MCP 工具** | 25+ | 12 个 MCP Server | compliance-gate(9) + codegraph(7) + docker(10) + context7(2) + eslint-audit(1) + code-quality-check(2) + github(?) + postgre_sql(?) + playwright(?) + pandoc(?) + excel(?) + notify-server(2) |

---

## 2. OpenCode 内置工具（11 个）

平台原生提供，框架通过 `opencode.json` permission 矩阵控制访问。

| 工具 | 功能 | 框架中的状态 | 拦截 Hook |
|------|------|-------------|-----------|
| `read` | 文件读取 | 多 Agent allow | `read-track-after`(读审计), `cache-after`(知识缓存同步), `uc7ks-after`(知识读追踪) |
| `edit` | 原生文件编辑 | **全局 deny** | 被 safe_edit 替代；scope-before/gate-before 仍拦截 |
| `bash` | 原生 Shell | **全局 deny** | 被 safe_shell 替代；scope-before 拦截 |
| `glob` | 文件模式匹配 | 多 Agent allow | 无专属 hook |
| `grep` | 内容搜索 | 多 Agent allow | 无专属 hook |
| `task` | 子任务管理 | Orchestrator/部分 Agent | `task-before`(DISPATCH_TOKEN 验证), `task-after`(结果记录+gate 提醒) |
| `question` | 向用户提问 | Orchestrator/Super-Admin only | `question-policy-before`(子 Agent 阻断) |
| `todowrite` | 待办列表 | 多 Agent allow | 无专属 hook |
| `webfetch` | 网页抓取 | **Knowledge-Curator only** | `uc7ks-after`(Layer C 审计) |
| `websearch` | 网页搜索 | **Knowledge-Curator only** | `uc7ks-after`(Layer C 审计) |
| `skill` | Skill 调用 | 多 Agent allow | 无专属 hook |

---

## 3. 自定义工具（23 个）

### 3.1 安全包装工具（8 个）

替代原生操作，提供 TOCTOU 保护、原子备份、中断安全。所有工具通过 `withInterruptGuard()` 包装。

#### 3.1.1 safe_edit

| 属性 | 值 |
|------|-----|
| **功能** | 原子文件编辑，支持 patch（查找替换）和 overwrite（全量覆写）两种模式 |
| **参数** | `filePath`(必填), `mode`("patch"/"overwrite"), `oldString`, `newString`, `content`, `dryRun` |
| **DB 读** | 无 |
| **DB 写** | 无 |
| **日志** | 无直接调用（委托给 lib/safe-edit-core） |
| **备份** | 通过 `safeEdit()`/`writeSafeFull()` 原子备份到 `.opencode_backups/` |
| **Lib 依赖** | `safeEdit`, `writeSafeFull`, `withInterruptGuard` |
| **拦截 Hook** | `gate-before`(门禁 armed 检查), `scope-before`(写入作用域), `tdd-before`(TDD 顺序), `uc7ks-before`(知识管线), `codegraph-enforce`(impact 分析), `checklist-before`(P0 清单), `tsc-diag-track`(TS 错误零容忍), `json-validate`(JSON 语法), `audit-after`(审计追踪), `scope-after`(dirty_modules), `tdd-after`(diff 验证), `cache-after`(docs/ 写入同步), `format-after`(Prettier 格式化), `read-track-after` |
| **调用者** | Architect, Coder-BE, Coder-FE, Guardian, Meta-Planner, Super-Admin, Knowledge-Curator |
| **特殊逻辑** | TOCTOU 首次调用建立基线，后续调用验证；失败自动重试一次 |

#### 3.1.2 safe_shell

| 属性 | 值 |
|------|-----|
| **功能** | 白名单 Shell 命令执行，仅允许预定义安全命令 |
| **参数** | `command`(必填), `timeout`(默认 300000ms), `dryRun` |
| **DB 读** | 无 |
| **DB 写** | 无 |
| **日志** | 无直接调用（委托给 lib/safe-bash） |
| **备份** | 无 |
| **Lib 依赖** | `safeBashTool`, `withInterruptGuard` |
| **拦截 Hook** | `gate-before`, `scope-before`(含 BACKUP-BYPASS 检查), `git-guard-before`(git hook 绕过阻断), `hook-config-guard`(defense-in-depth), `checklist-before`, `tsc-diag-track`, `audit-after`, `scope-after` |
| **调用者** | 所有 Agent（白名单内容各不相同，由 opencode.json permission 控制） |

#### 3.1.3 safe_delete

| 属性 | 值 |
|------|-----|
| **功能** | 安全删除文件，先备份后删除 |
| **参数** | `filePath`(必填), `dryRun` |
| **DB 读/写** | 无 |
| **备份** | 通过 `safeDelete()` 备份 |
| **Lib 依赖** | `safeDelete`, `withInterruptGuard` |
| **拦截 Hook** | 同 safe_edit（gate/scope/tdd/uc7ks/codegraph/checklist/tsc-diag/audit/scope-after） |
| **调用者** | Architect, Coder-BE, Coder-FE, Guardian, Meta-Planner, Super-Admin, Knowledge-Curator |
| **特殊逻辑** | TOCTOU 首次调用重试 |

#### 3.1.4 safe_mkdir

| 属性 | 值 |
|------|-----|
| **功能** | 安全创建目录，mkdir 天然原子无需 TOCTOU |
| **参数** | `dirPath`(必填), `recursive`(默认 true), `dryRun` |
| **DB/备份/日志** | 无 |
| **Lib 依赖** | `safeMkdir`, `withInterruptGuard` |
| **拦截 Hook** | `gate-before`, `scope-before`, `checklist-before`, `audit-after`, `scope-after` |
| **调用者** | Architect, Coder-BE, Coder-FE, Guardian, Meta-Planner, Super-Admin, Knowledge-Curator |

#### 3.1.5 safe_restore

| 属性 | 值 |
|------|-----|
| **功能** | 从备份恢复文件，原子恢复（tmp→rename） |
| **参数** | `uuid`(必填) — 备份记录 UUID |
| **DB 读/写** | 无直接（`getBackup()` 内部可能读 DB） |
| **备份** | `restoreBackup(uuid)`, `getBackup(uuid)` |
| **Lib 依赖** | `restoreBackup`, `getBackup`, `withInterruptGuard` |
| **拦截 Hook** | `codegraph-enforce`(before), `gate-before`(armed 检查) |
| **调用者** | Architect, Coder-BE, Coder-FE, Guardian, Meta-Planner, Orchestrator, Super-Admin, Knowledge-Curator |

#### 3.1.6 safe_diff

| 属性 | 值 |
|------|-----|
| **功能** | 生成 unified diff，支持两文件模式或内联内容模式 |
| **参数** | MODE1: `backupPath`+`targetPath`; MODE2: `fileA`+`content` |
| **DB/备份/日志** | 无（纯只读） |
| **Lib 依赖** | `generateDiff`, `withInterruptGuard` |
| **拦截 Hook** | 无专属写入 hook（只读工具） |
| **调用者** | Architect, Coder-BE, Coder-FE, Guardian, Meta-Planner, Orchestrator, Super-Admin, Knowledge-Curator |

#### 3.1.7 safe_hash

| 属性 | 值 |
|------|-----|
| **功能** | 计算文件 SHA-256 哈希，用于完整性校验 |
| **参数** | `filePath`(必填) |
| **DB/备份/日志** | 无（纯只读，零依赖） |
| **Lib 依赖** | **无** — 仅用 `node:crypto` + `node:fs`，刻意零依赖以便 strict 模式死锁恢复 |
| **拦截 Hook** | 无 |
| **调用者** | Orchestrator, Super-Admin |
| **设计意图** | 当 safe_shell 被 P0 清单阻断时，用 safe_hash 计算文件哈希作为 READ-BEFORE-APPROVE 证据 |

#### 3.1.8 safe_test

| 属性 | 值 |
|------|-----|
| **功能** | 验证 test_report.json 是否符合 TDD 阶段规则（red/green） |
| **参数** | `taskId`(必填), `phase`(必填: "red"/"green"), `dryRun` |
| **DB 读** | 无直接（委托给 `validateTestReport`） |
| **DB 写** | 无 |
| **Lib 依赖** | `validateTestReport`, `withInterruptGuard` |
| **拦截 Hook** | 无专属 hook（但 tdd-before/tdd-after 管理其前置状态） |
| **调用者** | Coder-BE, Coder-FE, Guardian |

### 3.2 框架控制工具（5 个）

#### 3.2.1 dispatch_subagent（~870 行，最复杂的工具）

| 属性 | 值 |
|------|-----|
| **功能** | 合规分发子 Agent，每次分发创建新 session，上下文通过 HANDOVER.md 传递 |
| **参数** | `agent_type`(必填), `task_description`(必填), `dag_task_id`, `session_namespace`, `auto_plan`, `resume_session_id` |
| **DB 读** | `session_map`（`dbReadSessionMap`） |
| **DB 写** | `session_map`（`dbWriteSessionMap` — 父 session + 子分发槽位）, `sub_state`（`atomicWriteSubState` — compliance_records） |
| **日志** | `writeLog` — 7+ 事件类型: `DAGTASK-ID-AUTO-GENERATED`, `AUTO-DISPATCH-LEGACY-MIGRATED`, `AUTO-DISPATCH-QUEUE-APPEND`, `AUTO-DISPATCH-QUEUE-TRUNCATED`, `DISPATCH-CTX-WRITTEN`, `SESSION-MAP-DAGTASK-WRITE`, `SESSION-MAP-DAGTASK-WRITE-FAILED` |
| **审计** | `writeAuditLogEntry` — 事件: `orchestrator_sa_dispatch`, `super_admin_kc_dispatch_bypass` |
| **Lib 依赖** | `dag-policy`(isDagExempt, readDispatchPolicy, autoPlan), `gate-checks`(findTaskInDag), `agent-identity`(isPrivileged, isKnowledgeCurator, normalize), `db-state-manager`(dbWriteSessionMap, dbReadSessionMap, dbQuerySessionByDagTaskId), `agent-resolver`(resolveCallerIdentity), `state-utils`(atomicWriteSubState, atomicWriteJson), `audit-log`(writeAuditLogEntry), `log-manager`(writeLog) |
| **拦截 Hook** | `dispatch-before`(PLAN-FIRST L0-L4 路由验证 + M14 目标限制 + GATE-APPROVAL-LOCK), `dispatch-after`(清理+排空) |
| **调用者** | Orchestrator(所有 Agent), Super-Admin(仅 Knowledge-Curator) |
| **关键流程** | 1) PLAN-FIRST L2 DAG 存在性验证 → 2) auto_plan 自愈(分发 @Meta-Planner) → 3) 安全门控(角色检查+执行模式) → 4) execFileSync 执行分发脚本 → 5) 写入 ctx/ 文件 + session_map DB |

#### 3.2.2 checklist_status

| 属性 | 值 |
|------|-----|
| **功能** | 查询当前 P0 清单执行状态，返回阶段、待办阻塞项及修复步骤 |
| **参数** | `task_id`(可选) |
| **DB 读** | `execution_checklist_runs`, `execution_checklist_items`（通过 lib） |
| **DB 写** | `execution_checklist_runs`（通过 `createChecklistRun`） |
| **Lib 依赖** | `execution-checklist`(createChecklistRun, getChecklistSummary, requireChecklistPassed) |
| **拦截 Hook** | 无（被 `checklist-before` 豁免，属于 passthrough 集合） |
| **调用者** | 所有 Agent（任务开始时调用以了解前置义务） |

#### 3.2.3 advance_checklist_phase

| 属性 | 值 |
|------|-----|
| **功能** | 推进 P0 清单到下一阶段，自动检测当前/下一阶段 |
| **参数** | `task_id`(必填) |
| **DB 读/写** | 通过 lib 委托给 `execution-checklist` |
| **日志** | `writeLog` — ERROR(未知阶段), WARN(已达最终阶段/推进阻断), runtime(成功) |
| **Lib 依赖** | `execution-checklist`, `log-manager` |
| **拦截 Hook** | 被 `checklist-before` 豁免 |
| **调用者** | 多 Agent |

#### 3.2.4 resolve_domain_id

| 属性 | 值 |
|------|-----|
| **功能** | 解析当前 session 的分发指派知识领域 ID |
| **参数** | `sessionId`(可选), `dag_task_id`(可选) |
| **DB 读** | `session_map`（`dbReadSessionMap` + 直接 SQL `SELECT session_id FROM session_map WHERE dag_task_id = ?`） |
| **DB 写** | 无 |
| **Lib 依赖** | `agent-resolver`(resolveDomainId), `db-state-manager`(dbReadSessionMap, getDb), `checklist-hooks`(checklistWirePassed) |
| **拦截 Hook** | 被 `checklist-before` 豁免 |
| **调用者** | 所有 Agent（在 module_scope_declare 之前自检查） |
| **三级优先级** | 1) session_map DB(高置信) → 2) ctx/ 分发文件(中置信) → 3) project.config.json agent_domain_map(中置信) |

#### 3.2.5 config_read_attest

| 属性 | 值 |
|------|-----|
| **功能** | 验证 Agent 已读取 3 个强制配置文件后才允许写入 |
| **参数** | `task_id`(必填) |
| **DB 读** | `read_audit`（通过 `verifyRead`） |
| **DB 写** | `config_read_state` sub-state（通过 `dbAtomicWriteSubState`） |
| **日志** | `writeLog` — WARN(FRAMEWORK_AGENT 回退), ERROR(身份缺失/认证失败), INFO(认证开始/通过/失败) |
| **Checklist** | 通过时 wire `config_read_attested` |
| **Lib 依赖** | `read-audit`(verifyRead, normalizeReadAuditPath), `substate-manager`(writeSubState), `db-state-manager`(dbAtomicWriteSubState), `log-manager`, `checklist-hooks` |
| **拦截 Hook** | 被 `checklist-before` 豁免 |
| **调用者** | 多 Agent（strict/locked 模式下强制） |
| **3 个强制文件** | Agent 配置 .md, opencode.json, project.config.json |

### 3.3 UC7KS 知识管理工具（5 个）

#### 3.3.1 knowledge_cache_search

| 属性 | 值 |
|------|-----|
| **功能** | 自动本地知识缓存搜索，读取 index.json 按 domain/tags 匹配 |
| **参数** | `domain`(必填), `task_id`(必填) |
| **DB 读** | `uc7ks_pipeline_state`（`readPipelineState` — 管线链验证） |
| **DB 写** | `uc7ks_pipeline_state`（`atomicUpsertDiscovery` — 写入发现结果） |
| **日志** | `writeLog` — INFO(管线未声明/KC-SEARCH-VIA-STORE), WARN(DB 验证/写入失败) |
| **审计计数** | `incrementAuditCounter` — total_cache_checks, total_cache_hits, total_cache_misses |
| **Checklist** | 通过时 wire `knowledge_cache_searched` |
| **Lib 依赖** | `tolerant-json`, `uc7ks-schema`, `knowledge-store`(readManifest, searchByTags, searchByDomain), `log-manager`, `knowledge-audit`, `checklist-hooks`, `uc7ks-pipeline-db` |
| **调用者** | 所有 Agent（UC7KS 管线 Step 1） |

#### 3.3.2 knowledge_cache_attest

| 属性 | 值 |
|------|-----|
| **功能** | Agent 提交的读证据认证，交叉验证 read_audit DB |
| **参数** | `domain`(必填), `task_id`(必填), `reason`(必填), `files_read`(必填, string[]), `content_summary`(必填) |
| **DB 读** | `uc7ks_pipeline_state`(readDiscoveryForAttest, readPipelineState), `read_audit`(getReadEventsForSession), knowledge-store manifest |
| **DB 写** | `uc7ks_pipeline_state`(atomicUpsertAttestation — 认证状态) |
| **日志** | `writeLog` — 10+ 事件类型（发现不足/空 files_read/文件不在发现集/不在 read_audit/空字段/写入失败/强制知识缺失等） |
| **审计计数** | 3 个计数器 |
| **Checklist** | 通过 wire pass，失败 wire fail |
| **Lib 依赖** | `uc7ks-schema`, `withInterruptGuard`, `log-manager`, `checklist-hooks`, `read-audit`, `knowledge-audit`, `uc7ks-pipeline-db`, `knowledge-store` |
| **调用者** | Architect, Coder-BE, Coder-FE, Meta-Planner, Super-Admin, Knowledge-Curator |
| **关键验证** | 1) 发现充分 → 2) files_read 非空 → 3) files_read ⊆ discovered_files → 4) manifest 交叉验证 → 5) read_audit 交叉验证 → 6) 重试限制 → 7) 强制知识文件检查 → 8) 写入认证 |

#### 3.3.3 knowledge_gap_report

| 属性 | 值 |
|------|-----|
| **功能** | 分析知识缓存覆盖率，对比 semantic_map domains 与 index.json 条目 |
| **参数** | 无（`args: {}`） |
| **DB/日志/备份** | 无（纯文件 I/O 只读） |
| **Lib 依赖** | `withInterruptGuard` only |
| **调用者** | Knowledge-Curator, Meta-Planner |
| **输出** | 每 domain 覆盖率 + 整体健康比 + KC-13 反向覆盖分析 |

#### 3.3.4 module_scope_declare

| 属性 | 值 |
|------|-----|
| **功能** | 声明当前任务的目标模块作用域，映射到知识领域 |
| **参数** | `module`(必填 — 知识领域 ID), `task_id`(必填) |
| **DB 写** | `uc7ks_pipeline_state`(atomicUpsertDiscovery — "declared"), `session_map`(dbWriteSessionMap — dag_task_id + domain_id 关联) |
| **日志** | `writeLog` — WARN(DOMAIN-OVERRIDE: 分发领域≠声明领域) |
| **Checklist** | 通过时 wire `module_scope_declared` |
| **审计** | `pushAuditEvent` |
| **Lib 依赖** | `tolerant-json`, `withInterruptGuard`, `checklist-hooks`, `agent-resolver`(resolveDomainId), `db-state-manager`, `log-manager`, `knowledge-audit`, `uc7ks-pipeline-db` |
| **调用者** | Coder-BE, Coder-FE（UC7KS 管线 Step 0a） |

#### 3.3.5 janitor（UC7KS 缓存清洁工）

| 属性 | 值 |
|------|-----|
| **功能** | 检测清理孤儿/过期知识缓存条目 |
| **参数** | `dry_run`(默认 false), `remove_orphans`(默认 false), `max_ttl_days`(默认 30) |
| **DB 写** | `knowledge_audit_state`(incrementAuditCounter — 文件级) |
| **日志** | `writeLog` — WARN(无 index.json), ERROR(解析/删除失败), INFO(清洁完成) |
| **审计计数** | reverse_orphan_count, last_cleanup_removed_session_entries |
| **审计事件** | `KC-JANITOR-RUN` |
| **Lib 依赖** | `tolerant-json`, `log-manager`, `state-utils`(atomicWriteSubState), `withInterruptGuard`, `knowledge-audit` |
| **调用者** | Knowledge-Curator, Super-Admin |

### 3.4 维护工具（2 个）

#### 3.4.1 nightly-compaction

| 属性 | 值 |
|------|-----|
| **功能** | UC7KS 夜间压缩：缓存清洁 + session_access 修剪 + 审计计数聚合 |
| **参数** | `compact_index`(默认 true), `prune_sessions`(默认 true), `max_session_age_days`(默认 30) |
| **DB 读** | `knowledge_cache_state` sub-state（frozen JSON 快照） |
| **DB 写** | `knowledge_cache_state` sub-state（修剪后写回）; `index.json` 磁盘原子重写 |
| **日志** | `writeLog` — ERROR(压缩/修剪失败), INFO(完成) |
| **审计计数** | incrementAuditCounter + pushAuditEvent(`KC-NIGHTLY-COMPACTION`) |
| **Lib 依赖** | `tolerant-json`, `log-manager`, `substate-manager`(readSubState, writeSubState), `state-utils`, `withInterruptGuard`, `uc7ks-schema`(pruneSessionAccess), `knowledge-audit` |
| **调用者** | 维护调度（非交互式） |

#### 3.4.2 tsc-gate-reset

| 属性 | 值 |
|------|-----|
| **功能** | 紧急 TSC 门禁锁重置，释放所有 session 持有的文件级 TSC 锁 |
| **参数** | `force`(必填，必须 true 确认) |
| **DB 读/写** | 通过 `tsc-gate-db` lib 操作 TSC 锁表 |
| **日志** | `writeLog` — WARN(force 未设置=取消), runtime(执行结果含 cleaned/released 计数) |
| **Lib 依赖** | `tsc-gate-db`(resetTscGateLocks, cleanExpiredLocks), `log-manager` |
| **权限** | **仅 Super-Admin** |
| **调用者** | Super-Admin（紧急解锁场景） |

---

### 3.5 Read Attestation 工具（3 个）

#### 3.5.1 read_skill

| 属性 | 值 |
|------|-----|
| **功能** | 读取 Skill 定义文件（`.opencode/skills/*/SKILL.md`），带读取审计追踪 |
| **参数** | `skill_name`(必填), `task_id`(必填) |
| **DB 读** | `read_audit`（记录读取事件，交叉验证后续 attest） |
| **日志** | `writeLog` — INFO(读取成功), ERROR(文件不存在/读取失败) |
| **Lib 依赖** | `read-audit`, `log-manager`, `withInterruptGuard` |
| **调用者** | 多 Agent（Skill 读取认证管线 Step 1） |

#### 3.5.2 skill_read_attest

| 属性 | 值 |
|------|-----|
| **功能** | Skill 读取认证，验证 Agent 已通过 read_skill 读取并理解 Skill 定义后才允许基于 Skill 执行操作 |
| **参数** | `skill_name`(必填), `task_id`(必填), `understanding_summary`(必填 — Agent 对 Skill 的理解摘要) |
| **DB 读** | `read_audit`(验证读取事件), `skill_attest_state`(已有认证状态) |
| **DB 写** | `skill_attest_state`(记录认证结果) |
| **日志** | `writeLog` — INFO(认证通过/失败), WARN(理解摘要不充分/未先调用 read_skill) |
| **Checklist** | 通过时 wire `skill_read_attested` |
| **Lib 依赖** | `read-audit`, `log-manager`, `withInterruptGuard`, `checklist-hooks`, `db-state-manager` |
| **调用者** | Architect, Coder-BE, Coder-FE, Meta-Planner, Super-Admin |

#### 3.5.3 rule_read_attest

| 属性 | 值 |
|------|-----|
| **功能** | Rule 读取认证，与 skill_read_attest 对称，验证 Agent 已读取并理解 Rule 定义（`.opencode/rules/`），防止盲目引用 Rule |
| **参数** | `rule_name`(必填), `task_id`(必填), `understanding_summary`(必填) |
| **DB 读** | `read_audit`, `rule_attest_state` |
| **DB 写** | `rule_attest_state` |
| **日志** | `writeLog` — INFO(认证通过/失败), WARN(理解摘要不充分) |
| **Checklist** | 通过时 wire `rule_read_attested` |
| **Lib 依赖** | `read-audit`, `log-manager`, `withInterruptGuard`, `checklist-hooks`, `db-state-manager` |
| **调用者** | Architect, Coder-BE, Coder-FE, Meta-Planner, Guardian |

---

## 4. MCP 工具

### 4.1 自定义 MCP Server（6 个）

#### 4.1.1 compliance-gate（9 个工具）

脚本: `.opencode/scripts/mcp-tools/compliance-gate.ts`

| 工具名 | 功能 | 调用者 |
|--------|------|--------|
| `compliance_gate_check` | 检查门禁前置条件，创建 gate session | 所有 Agent |
| `compliance_gate_confirm` | 确认/武装 gate session | 所有 Agent |
| `compliance_gate_complete` | 完成/关闭 gate session | 所有 Agent |
| `compliance_gate_submit_deliverables` | 提交交付物待审批 | Coder-BE, Coder-FE, Architect |
| `compliance_gate_approve_deliverables` | 审批/驳回交付物 | Orchestrator, Guardian, Arbiter |
| `compliance_gate_purge` | 清除过期 gate session | Orchestrator |
| `compliance_gate_drain_stale` | 排空 stale armed session | Orchestrator |
| `compliance_gate_retry_confirm` | 重试失败的 confirm | 所有 Agent |
| `compliance_gate_bulk_review_deliverables` | 批量审批/驳回交付物 | Orchestrator, Arbiter |

**DB 操作**: 读写 `gate_sessions`, `gate_drained_sessions`, `gate_session_index`, `gate_store_meta`, `gate_audit_history`
**拦截 Hook**: `gate-before`(armed 检查 + DAG 审计), `gate-after`(排空 stale), `db-health`(健康维护)

#### 4.1.2 eslint-audit（1 个工具）

脚本: `.opencode/scripts/mcp-tools/eslint-audit.ts`

| 工具名 | 功能 | 调用者 |
|--------|------|--------|
| `run_audit` | 对变更文件或全项目运行 ESLint 模拟审计，更新 eslint_state | Coder-BE, Coder-FE, Guardian, Architect, Super-Admin |

**DB 操作**: 更新 `eslint_state` dirty_modules
**拦截 Hook**: 无专属 hook

#### 4.1.3 code-quality-check（2 个工具）

脚本: `.opencode/scripts/mcp-tools/code-quality-check.ts`

| 工具名 | 功能 | 调用者 |
|--------|------|--------|
| `code_quality_check.run_depcruise_check` | 单文件 dependency-cruiser 架构边界检查 | Architect, Coder-BE, Coder-FE, Guardian, Super-Admin |
| `code_quality_check.run_full_scan` | 全项目扫描: depcruise + prettier | Architect, Guardian, Super-Admin |

**DB 操作**: 无
**拦截 Hook**: 无专属 hook

#### 4.1.4 baseline-diagnostic（1 个工具）

脚本: `.opencode/scripts/mcp-tools/baseline-diagnostic.ts`

| 工具名 | 功能 | 调用者 |
|--------|------|--------|
| `framework_capture_diagnostic_baseline` | 捕获当前 `tsc --noEmit` 错误集作为项目基线 | Super-Admin, Guardian |

**DB 操作**: 更新 `diagnostic_state`
**拦截 Hook**: 无

#### 4.1.5 keystone-validate（1 个工具）

脚本: `.opencode/scripts/mcp-tools/keystone-validate.ts`

| 工具名 | 功能 | 调用者 |
|--------|------|--------|
| `keystone_validate` | Keystone 验证（合约哈希、任务生命周期、TDD、门禁） | Super-Admin, Guardian |

**DB 操作**: 读取多个状态表
**拦截 Hook**: 无

#### 4.1.6 reconciliation-validate（非 MCP）

脚本: `.opencode/scripts/mcp-tools/reconciliation-validate.ts`
**注意**: 这是独立 CLI 脚本，非 MCP Server。交叉对比 Task.DAG.json、gate-state.json、machine.json 的状态一致性。

### 4.2 外部 MCP Server（5 个）

| Server | 工具 | 权限归属 | opencode.json permission key |
|--------|------|---------|------------------------------|
| **codegraph** | `codegraph_search`, `codegraph_explore`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_node`, `codegraph_status`, `codegraph_files` (8 个) | Meta-Planner, Architect, Coder-BE, Coder-FE, Guardian, Super-Admin, Knowledge-Curator | `codegraph_*` |
| **context7** | `context7_resolve-library-id`, `context7_query-docs` (2 个) | **仅 Knowledge-Curator** | `context7` |
| **docker** | `docker_list_containers`, `docker_run_container`, `docker_build_image`, `docker_create_network`, `docker_create_volume`, `docker_fetch_container_logs`, `docker_remove_container`, `docker_remove_image`, `docker_recreate_container`, `docker_start_container`, `docker_stop_container` (11 个) | **仅 CI-CD-Agent** | `docker` |
| **playwright** | 浏览器自动化工具集 | **仅 Coder-FE** | `playwright` |
| **github** | GitHub API 工具集（`github_get_file_contents`, `github_search_code` 等） | 无 Agent 声明权限（保留） | `github` |
| **postgre_sql** | SQL 查询工具 | **仅 Coder-BE** | `postgre_sql` |
| **pandoc** | 文档格式转换 | Architect, Coder-BE | `pandoc` |
| **excel** | Excel 电子表格操作 | 无 Agent 声明权限（保留） | — |

---

## 5. Hook ↔ Tool 拦截矩阵

### 5.1 Before Hook 拦截表

| Hook | 拦截的工具 | 阻断条件 |
|------|-----------|---------|
| `checklist-before` | 所有工具 **除了** passthrough 集 | P0 清单当前阶段有未解决阻塞项 |
| `gate-before` | `write`, `edit`, `safe_edit`, `safe_mkdir`, `safe_delete`, `safe_shell` | 存在 armed 的 gate session（advisory 模式跳过） |
| `scope-before` | `write`, `edit`, `safe_edit`, `safe_mkdir`, `safe_delete`, `safe_shell`, `bash` | Agent→文件作用域不匹配 / UC7KS 未搜索 / 配置未认证 / KC 隔离违规 |
| `dispatch-before` | `dispatch_subagent` | DAG 不存在 / 路由验证失败 / GATE-APPROVAL-LOCK / M14 目标限制 |
| `tdd-before` | 所有工具（按 service 层过滤） | 写实现前未写测试（strict/locked 模式） |
| `uc7ks-before` | 所有工具（按 checkUC7KS 过滤） | 知识管线未咨询 / UC7-001c 证据缺失 |
| `codegraph-enforce` | `safe_edit`, `safe_delete`, `safe_restore`, `safe_shell` | 本 session 未调用 `codegraph_impact` |
| `tsc-diag-track` | 所有修改工具（.ts/.tsx 目标） | 目标文件有任何 TS 编译错误（零容忍） |
| `json-validate` | `write`, `edit`, `safe_edit`（仅当目标是 config 文件） | JSON 语法错误 / 执行模式降级被阻断 |
| `git-guard-before` | `safe_shell` | git hook 绕过命令（--no-verify 等） |
| `hook-config-guard` | `safe_shell`, `bash` | git hook 绕过 / git update-index --skip-worktree |
| `question-policy-before` | `question` | 非 Orchestrator/Super-Admin 使用 question |
| `task-before` | `Task`, `task` | DISPATCH_TOKEN SHA-256 验证失败 |

**Passthrough 集合**（不被 checklist-before 阻断）:
`checklist_status`, `advance_checklist_phase`, `resolve_domain_id`, `knowledge_cache_search`, `config_read_attest`, `module_scope_declare`, `todowrite`, `question`, `skill`, `dispatch_subagent`

### 5.2 After Hook 拦截表

| Hook | 拦截的工具 | 动作 |
|------|-----------|------|
| `audit-after` | 所有修改工具 | 追加 write_audit_state |
| `scope-after` | 所有修改工具 | 更新 eslint_state.dirty_modules |
| `tdd-after` | 所有修改工具 | diff 验证 + 浅测试检测 |
| `format-after` | 所有修改工具 | Prettier 自动格式化 |
| `tsc-diag-track` | .ts/.tsx 修改工具 | 运行 tsc 更新 diagnostic_state |
| `cache-after` | `read`(index.json), `safe_edit`/`write`/`edit`/`safe_shell`(docs/ 写入) | 知识缓存同步 + 外部获取计数 |
| `uc7ks-after` | `read`, `write`, `edit`, `safe_edit`, `webfetch`, `websearch`, `context7_*`, `github_*` | Layer C 工具审计 + 知识读追踪 |
| `read-track-after` | `read`, `Read` | 记录读事件到 read_audit DB |
| `gate-after` | `compliance_gate_*` 全部 | 排空过期 gate session |
| `dispatch-after` | `Task`, `task` | 清理 _dispatch_target.json + 排空 stale |
| `task-after` | `Task`, `task` | 记录分发结果 + gate 提醒 + session log 持久化 |
| `codegraph-enforce` | `codegraph_impact` | 追踪 impact 调用目标符号 |
| `dispatch-auto` | 所有工具 | 清理 stale .auto-dispatch 标记 + 回收 stale DB 租约 |
| `db-health` | `compliance_gate_*` | DB 健康维护（WAL checkpoint + VACUUM） |

### 5.3 生命周期 Hook（非 Tool 拦截）

| Hook | 事件 | 动作 |
|------|------|------|
| `session.ts` | `chat.message`, `session.error`, `session.compacted`, `session.idle` | 9 步启动清理 + 配置认证重置 + 合规审计 + session_map 写入 |

---

## 6. DB 访问地图

### 6.1 自定义工具 DB 访问

| 工具 | 读的表 | 写的表 |
|------|--------|--------|
| safe_edit | — | — |
| safe_shell | — | — |
| safe_delete | — | — |
| safe_mkdir | — | — |
| safe_restore | — (getBackup 内部) | — |
| safe_diff | — | — |
| safe_hash | — | — |
| safe_test | — (validateTestReport 内部) | — |
| dispatch_subagent | session_map | session_map, sub_state(compliance_records) |
| checklist_status | execution_checklist_runs, execution_checklist_items | execution_checklist_runs |
| advance_checklist_phase | (via lib) | (via lib) |
| resolve_domain_id | session_map | — |
| config_read_attest | read_audit | config_read_state (sub-state) |
| knowledge_cache_search | uc7ks_pipeline_state | uc7ks_pipeline_state |
| knowledge_cache_attest | uc7ks_pipeline_state, read_audit, manifest | uc7ks_pipeline_state |
| knowledge_gap_report | — | — |
| module_scope_declare | — | uc7ks_pipeline_state, session_map |
| janitor | — (文件 I/O) | knowledge_audit_state (文件) |
| nightly-compaction | knowledge_cache_state (frozen) | knowledge_cache_state, index.json |
| tsc_gate_reset | (via tsc-gate-db) | (via tsc-gate-db) |

### 6.2 MCP 工具 DB 访问

| MCP Server | 读 | 写 |
|-----------|-----|-----|
| compliance-gate | gate_sessions, gate_session_index, gate_store_meta | gate_sessions, gate_drained_sessions, gate_session_index, gate_audit_history, gate_store_meta |
| eslint-audit | — | eslint_state (dirty_modules) |
| code-quality-check | — | — |
| baseline-diagnostic | — | diagnostic_state |
| keystone-validate | 多状态表 | — |

---

## 7. 日志系统集成

### 7.1 日志调用统计

| 工具 | writeLog 调用数 | 事件类型示例 |
|------|----------------|-------------|
| dispatch_subagent | 7+ | DAGTASK-ID-AUTO-GENERATED, DISPATCH-CTX-WRITTEN, SESSION-MAP-DAGTASK-WRITE |
| knowledge_cache_attest | 10+ | discovery_insufficient, files_not_in_read_audit, attestation_pass |
| config_read_attest | 4+ | attestation_start, attestation_passed, attestation_failed |
| advance_checklist_phase | 3 | ERROR(未知阶段), WARN(推进阻断), runtime(成功) |
| janitor | 3 | WARN(无 index), ERROR(解析失败), INFO(完成) |
| nightly-compaction | 3 | ERROR(压缩失败), INFO(完成) |
| knowledge_cache_search | 2 | INFO(管线未声明), WARN(DB 失败) |
| module_scope_declare | 1 | WARN(DOMAIN-OVERRIDE) |
| tsc_gate_reset | 2 | WARN(取消), runtime(执行) |
| safe_* 系列 | 0 | 日志在 lib 层处理 |

### 7.2 审计日志（writeAuditLogEntry）

仅 `dispatch_subagent` 直接调用：
- `orchestrator_sa_dispatch` — Orchestrator 分发任意 Agent
- `super_admin_kc_dispatch_bypass` — Super-Admin 分发 Knowledge-Curator

### 7.3 审计计数器（incrementAuditCounter / pushAuditEvent）

| 工具 | 计数器/事件 |
|------|-----------|
| knowledge_cache_search | total_cache_checks, total_cache_hits, total_cache_misses |
| knowledge_cache_attest | 3 个计数器 |
| janitor | reverse_orphan_count, last_cleanup_removed_session_entries; 事件 KC-JANITOR-RUN |
| nightly-compaction | 2 个计数器; 事件 KC-NIGHTLY-COMPACTION |
| module_scope_declare | pushAuditEvent |

---

## 8. 备份系统集成

| 工具 | 备份操作 | 备份位置 |
|------|---------|---------|
| safe_edit | 写入前原子备份 | `.opencode_backups/`（与源文件同级） |
| safe_delete | 删除前原子备份 | `.opencode_backups/` |
| safe_restore | 从备份恢复（原子 tmp→rename） | 读取 `.opencode_backups/` |
| safe_mkdir | 无备份需求 | — |
| safe_shell | 无备份（命令执行） | — |
| safe_diff | 无（只读） | — |
| safe_hash | 无（只读） | — |
| safe_test | 无（验证） | — |
| 其余工具 | 无备份需求 | — |

**备份文件命名**: `{filename}.bak.{timestamp}` 或 UUID 标识
**备份查询**: `getBackup(uuid)` 从 DB 或文件系统检索备份记录

---

## 9. 修改工具集定义

框架中 `isModifyTool()` 函数（`lib/tool-scope.ts`）定义的修改工具集合：

```
修改工具 = { write, edit, safe_edit, safe_mkdir, safe_delete, safe_shell }
```

这是多个 before hook 的拦截基础。所有修改工具都会触发：
1. `gate-before` — 门禁 armed 检查
2. `scope-before` — 写入作用域
3. `checklist-before` — P0 清单门控
4. `tsc-diag-track` — TS 编译错误零容忍
5. `audit-after` — 审计追踪
6. `scope-after` — dirty_modules 更新
7. `format-after` — Prettier 格式化

---

## 10. 工具权限速查

| 工具 | Orch | SA | MP | Arch | Coder-BE | Coder-FE | Guard | Arbi | CI-CD | KC |
|------|------|-----|-----|------|----------|----------|-------|------|-------|-----|
| safe_edit | .task_temp | 受限 | 受限 | 受限 | ✅ | ✅ | 受限 | 受限 | 受限 | 受限 |
| safe_shell | 白名单 | 白名单 | 白名单 | 白名单 | ✅ | ✅ | 白名单 | 白名单 | 白名单 | 白名单 |
| safe_delete | .task_temp | 受限 | 受限 | 受限 | ✅ | ✅ | 受限 | 受限 | 受限 | 受限 |
| safe_mkdir | .task_temp | 受限 | 受限 | 受限 | ✅ | ✅ | 受限 | 受限 | 受限 | 受限 |
| safe_restore | .task_temp | ✅ | 受限 | 受限 | ✅ | ✅ | 受限 | 受限 | 受限 | 受限 |
| safe_diff | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| safe_hash | ✅ | ✅ | — | — | — | — | — | — | — | — |
| safe_test | deny | — | — | — | ✅ | ✅ | ✅ | — | — | — |
| dispatch_subagent | ✅ | KC only | ✅ | ✅ | — | — | — | — | — | — |
| checklist_status | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| advance_checklist | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| config_read_attest | — | ✅ | — | ✅ | ✅ | ✅ | — | — | — | ✅ |
| knowledge_cache_search | — | — | — | — | — | — | — | — | — | ✅ |
| knowledge_cache_attest | — | ✅ | — | ✅ | ✅ | ✅ | — | — | — | ✅ |
| module_scope_declare | — | — | — | — | ✅ | ✅ | — | — | — | — |
| resolve_domain_id | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| knowledge_gap_report | — | — | ✅ | — | — | — | — | — | — | ✅ |
| janitor | — | ✅ | — | — | — | — | — | — | — | ✅ |
| nightly-compaction | — | — | — | — | — | — | — | — | — | — |
| tsc_gate_reset | — | ✅ | — | — | — | — | — | — | — | — |

> Orch=Orchestrator, SA=Super-Admin, MP=Meta-Planner, Arch=Architect, Guard=Guardian, Arbi=Arbiter, CI-CD=CI-CD-Agent, KC=Knowledge-Curator
> ✅=allow, —=deny/未声明, 受限=部分路径 allow
