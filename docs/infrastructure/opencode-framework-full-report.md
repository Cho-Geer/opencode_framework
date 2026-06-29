# OpenCode Framework 全面分析报告

**报告日期：** 2026-06-16
**调查范围：** docs/official_docs/（46 篇官方文档）、.opencode/（~200 个框架源码文件）、docs/review/framework-refactor/（7 篇重构计划）、日志系统全量源码
**访问方式：** WSL Ubuntu-24.04 /home/zhaoge/workspace/opencode/work-one/

---

## 第一部分：OpenCode 平台官方知识体系

### 1.1 知识域分布（docs/official_docs/，46 md + 4 json）

| 知识域 | 文件数 | 核心内容 |
|--------|:------:|---------|
| **OpenCode 平台** | 28 | Agent 系统（3 模式 × 8 内置角色）、Plugin 系统（30+ hook 事件、export default 强制、Bun 缓存陷阱）、Tool 系统（内置 + 自定义 .ts 自动注册）、MCP Server（stdio/SSE/OAuth/TypeScript+Bun）、Skill、Policy、Permission（15 权限键）、配置 8 层优先级、CLI 参考、v1.16.0 & v1.17.2 Release Notes |
| **框架技术栈** | 6 | Node.js 22.x（ESM 优先）、TypeScript 5.x（strict 模式）、ESLint 9.x（flat config）、Git hook 模式、GitHub Actions、JSON Schema Draft 7/2020-12 |
| **后端** | 4 | NestJS 11+（模块/控制器/服务/Guard/Pipe/Interceptor）、Prisma 7.x（schema/迁移/事务）、Express 中间件、JWT+Passport+RBAC |
| **前端** | 2 | Angular 21+（Signal Store、Standalone、PrimeNG）、React 19+（Hooks、Server Components） |
| **数据库** | 2 | PostgreSQL 16（索引/分区/优化）、Redis 7.x（缓存/队列/RediSearch） |
| **DevOps** | 4 | Docker Compose v2（不可变标签）、GitHub Actions CI/CD、BullMQ、Playwright E2E |

### 1.2 关键平台知识

**Plugin 系统约束：** 必须 `export default`（`export const` 静默失败）；hook 函数须本地定义（import 进来的静默失败）；多同 ID 插件链式叠加而非覆盖（曾导致 P0 双倍执行事故）；Bun 缓存不可靠，修改后需重命名文件或 `rm -rf ~/.cache/bun`。

**Agent 身份解析：** 使用 `.session_map.json` 作为主源，`_dispatch_target.json` 作为 fallback。修复了并行 dispatch 的 last-write-wins 竞态条件。

**配置优先级（8 层）：** 默认值 → 全局配置 → 项目 opencode.json → .opencode/rules/*.md → Agent prompt 文件 → Plugin hook 注入 → MCP 工具返回 → 用户运行时覆盖。

### 1.3 知识索引

`docs/official_docs/index.json`（v1.4.1，45 条记录）管理全部缓存文档。域分布：opencode 28 条（62%）、testing 5 条、devops 4 条、frontend 3 条、backend 2 条、infrastructure 3 条。每条记录包含 library_id、domain、tags、files[]（path/source/sha256/ttl_days/access_count）。

---

## 第二部分：本地框架架构全景

### 2.1 框架规模总览

| 维度 | 数据 |
|------|------|
| 框架源码 | 28 lib 模块 + 11 工具 + 16 插件 + 34 脚本 + 2 git hook |
| 配置文件 | opencode.json (918 行) + project.config.json (1256 行) + AGENTS.md (248 行) |
| 状态管理 | 14 个子状态 + gate-state.json + rule_registry.json (167 行) + schema (1304 行) |
| Agent 定义 | 10 角色，4 层 |
| 测试覆盖 | 17 框架自测试 + 集成测试 |
| Git 提交 | 226 次（44% 框架维护） |
| 关键文件追踪 | 22 CRITICAL_FILES + git diff 检测 + [INFRA] 标记 |

### 2.2 Agent 系统（10 角色，4 层）

| 层级 | Agent | 模式 | 核心职责 | 权限特征 |
|------|-------|:----:|---------|---------|
| **元认知** | @Meta-Planner | subagent | 需求拆解、DAG 生成、技术债扫描 | DAG-exempt |
| **元认知** | @Orchestrator | **primary** | 任务调度、状态管控、产物合并 | 只读 DAG/状态，无 edit/bash |
| **执行** | @Architect | subagent | 接口契约（contract.yaml）、技术规范 | 禁写 .opencode/ |
| **执行** | @Coder-BE | subagent | NestJS/Prisma 后端 | 限 booking-backend/src/ |
| **执行** | @Coder-FE | subagent | Angular 前端 | 限 booking-frontend/ |
| **执行** | @CI-CD-Agent | subagent | CI/CD 运维、Git 版本管理 | Docker/GitHub Actions |
| **验证** | @Guardian | subagent | 代码审查 + ESLint + TDD 证据验证 | 只读 + 审查工具 |
| **验证** | @Arbiter | subagent | 冲突裁决、技术债豁免审批 | 只读 + WAIVE 工具 |
| **治理** | @Super-Admin | **all** | 框架修复、紧急操作 | 不受限，匹配修复模式 |
| **治理** | @Knowledge-Curator | subagent | UC7KS 知识管道唯一网关 | Context7/webfetch/websearch |

**职责边界强制执行：** `framework-enforcer.ts` 物理层阻断越界写操作。@Architect/@Orchestrator 写 .opencode/ 自动转发 @Super-Admin，@Coder 越界自动阻断转 @Orchestrator。

### 2.3 Plugin 系统（16 个，8 对 before/after）

所有插件遵循统一 3 阶段生命周期（`withPluginLifecycle()` HOF，样板 16 行）：加载 → 注册 → 运行时。

| 插件对 | Before Hook 职责 | After Hook 职责 |
|--------|-----------------|----------------|
| **scope** | 验证 Agent 写操作在 agent_write_scopes 范围内 | — |
| **uc7ks** | 拦截外部查询工具，强制先查本地缓存 | 追踪缓存读取，更新 uc7_001_compliant |
| **dispatch** | PLAN-FIRST Layer 1 — 检查 DAG 条目存在 | 记录调度历史到 machine.json |
| **gate** | P2-1 纵深防御 — 修改工具时的 DAG 审计 | — |
| **audit** | executeWriteAuditCheck — 权限范围检查 | 追加 write_audit_state.history |
| **tdd** | 强制 RED→GREEN→REFACTOR 阶段顺序 | 验证测试阶段转换 |
| **cache** | — | 缓存热文件 |
| **task** | — | 检测 gate 未关闭并写提醒文件 |

**额外插件：** `session.ts`（会话生命周期 + 中断哨兵）、`json-validate.ts`（JSON 语法验证）。

### 2.4 Custom Tool 系统（11 个 MCP 工具）

| 工具 | 功能 | 安全特性 |
|------|------|---------|
| `safe_edit` | 原子文件编辑 | TOCTOU 保护 + mkdir 互斥锁 + backup + rollback + 自愈重试 |
| `safe_shell` | 白名单命令执行 | allowlist/denylist + Agent 级绕过 + 危险模式检测 + 脚本扫描 |
| `safe_test` | TDD 测试执行 + 证据捕获 | phase enum 强制 RED/GREEN/REFACTOR |
| `safe_mkdir` | 安全目录创建 | 路径解析 |
| `safe_delete` | 安全删除 | TOCTOU + backup |
| `safe_diff` | 统一 diff 生成 | 纯只读 |
| `safe_restore` | backup 恢复 | 原子 copy-temp-then-rename |
| `dispatch_subagent` | 子 Agent 派遣（550 行） | PLAN-FIRST Layer 2 + Super-Admin 修复验证 + execFileSync 防注入 |
| `module_scope_declare` | UC7KS Step 0a 作用域声明 | 模块白名单 + CAS 写入 |
| `knowledge_cache_search` | UC7KS Step 0b 缓存搜索 | 管道链验证 + CAS 写入 |
| `knowledge_gap_report` | 知识覆盖率分析 | 纯只读 |

全部工具统一使用 `withInterruptGuard()` 包装器捕获合作中断并返回结构化 JSON。

### 2.5 Library 模块（28 个共享 lib）

| 模块 | 职责 |
|------|------|
| `state-utils.ts` | 统一 `atomicWriteMachine()` CAS 写入 + `atomicWriteSubState()` 子状态写入 |
| `gate-core.ts` | 合规门禁状态管理（会话/执行模式/排水） |
| `safe-edit-core.ts` | TOCTOU 安全文件编辑（mkdir 互斥锁、状态注册表、备份/恢复） |
| `safe-bash-core.ts` | 命令 allowlist/denylist + Agent 级绕过 + 危险模式检测 |
| `permission-isolation-core.ts` | 按 Agent 权限配置 |
| `uc7ks-schema.ts` / `uc7ks-utils.ts` | UC7KS 管道链验证、CAS 原子写入 |
| `agent-resolver.ts` | Agent 身份解析（session map 主源 + dispatch target fallback） |
| `dag-policy.ts` | DAG-exempt Agent 名单（唯一定义点） |
| `dag-version-manager.ts` | DAG 版本快照管理 |
| `critical-files.ts` | 22 个关键基础设施文件清单 |
| `hook-layers.ts` / `hook-commit-msg.ts` / `hook-critical-files.ts` | Pre-commit hook TypeScript 实现 |
| `log-manager.ts` | 缓冲异步日志、O_APPEND 原子 flush、source 索引 |
| `log-rotator.ts` | Size/time 双策略轮转、gzip 压缩、归档 |
| `audit-log.ts` | 审计日志 JSONL 写入 |
| `write-audit-lib.ts` | 写入时 5 子状态审计检查 |
| `state-cache.ts` | mtime 无效的内存文件缓存 |
| `interrupt-guard.ts` | 中断保护包装器 |
| `hook-lifecycle.ts` | `withPluginLifecycle()` HOF 统一插件样板 |
| `tool-scope.ts` | 工具路径范围解析 |

### 2.6 状态管理（三层架构）

**Tier 1 热数据：**
- `gate-state.json` — 合规门禁活跃会话
- `Task.DAG.json` — 任务依赖图
- `write-audit-state.json`、`eslint-state.json`、`knowledge-audit-state.json` 等子状态文件（P1-B 拆分目标）

**Tier 2 温数据：**
- `.transaction-log` — JSONL 追加状态变更日志（BEGIN/PREPARE/COMMIT）
- `safe-bash.log` — 命令审计（437KB+，5 轮转 + gz）
- `gate-state.history/` — 日文件
- `.task_temp/_logs/{date}/` — 插件日志（按日）

**Tier 3 冷数据：**
- `.metadata/archives/` — 长期归档
- `_task_temp/_logs/_archive/` — 过期日志归档

**machine.json（1.1MB+）14 个子状态：** eslint_state、type_check_state、dependency_state、format_state、write_audit_state、compliance_records、tdd_enforcement_state、knowledge_audit_state、knowledge_cache_state、contracts、keystone_hashes、transaction_state、plugin_state、auto_plan_history。

### 2.7 合规门禁（Compliance Gate）

**两步协议（优化后）：**

1. `compliance_gate_check(task_description)` — 创建会话、运行规则检查、返回确认信息（已合并原 confirm 步骤）
2. `compliance_gate_complete(session_id, execution_summary)` — 关闭门禁、验证产物（HANDOVER.md、TASK_LOG.md、test_report.json）、ESLint 脏模块扫描

**三种执行模式：** advisory（仅警告）→ strict（阻断不合规操作，7 项检查）→ locked（无豁免无降级）。

**3 层提醒系统（防 LLM 遗忘 complete）：**
- MCP 响应内嵌提醒文本（`buildReminderText()`）
- `task-after` 插件写 `gate-reminder.{md,json}` 持久化文件
- `session.compacted` hook 推送提醒到压缩后的 context

**自修正循环（核心价值，不可替代）：**
```
LLM 调用 complete → 返回 "missing test_report.json"
  → LLM 补写 → 再次 complete → 返回 "evidence 缺失"
  → LLM 补充 → 再次 complete → pass ✓
```
即时反馈 + 精确失败原因 + LLM 端闭环驱动。

### 2.8 UC7KS 知识管道

**五级获取级联：**

| 级别 | 来源 | 触发条件 |
|:----:|------|---------|
| 0 | Local Cache（`docs/official_docs/` + `index.json`） | 每次任务强制首步 |
| 1 | Context7 MCP（`resolve-library-id` → `query-docs`） | 缓存 miss |
| 2 | webfetch（白名单 URL） | Context7 无覆盖 |
| 3 | websearch（白名单查询模式） | webfetch 不足 |
| 4 | Scout Agent（源码深度分析） | 文档层不足 + 关键词触发 |

**强制管道链：** `module_scope_declare`（Step 0a）→ `knowledge_cache_search`（Step 0b）→ 才允许写代码或外部查询。

**运行时拦截：** `uc7ks-before.ts` 拦截 `context7_*`、`webfetch`、`websearch`、`github_*`、`playwright_*` 等工具，未满足 UC7-001 协议时 strict/locked 模式下直接阻断。

**8 个知识维护脚本：** indexer（索引）、janitor（TTL+LRU）、compressor（HTML→MD）、deduplicator（SHA-256 去重）、size-reporter、archiver、scout-trigger（加权关键词触发）、scout-extractor（结构化输出）。

**协议开销：** 每任务 2000~5000 token（Steps 0a-0c），每次工具调用 ~200 token（hook 处理）。

### 2.9 Pre-commit Hook（TypeScript 实现）

**9 层验证链：**

| 层 | 检查内容 | 阻断条件 |
|:--:|---------|---------|
| 0 | 合规门禁 armed 检查 | gate 未武装 |
| 1.5 | 关键基础设施文件 git diff 检测 | 变更含 CRITICAL_FILES |
| 1.8 | Gate 生命周期审计 | — |
| 1.9 | 状态格式验证 | JSON 格式错误 |
| 1 | lint-staged 自动格式化 | — |
| 2.0 | JSON 语法验证 | 语法错误 |
| 2.5 | TDD 顺序检查 | RED/GREEN/REFACTOR 顺序错 |
| 2.6 | UC7KS 文档一致性 | 文档与代码不同步 |
| 2 | Keystone 哈希验证 | 哈希不匹配 |
| 3 | commit-msg 委托 | 缺少 [Red]/[Green]/[Refactor]/[INFRA] 标记 |

### 2.10 防御纵深总结

框架在 **四个独立层次** 执行强制约束：

| 层次 | 位置 | 职责 |
|------|------|------|
| Plugin Hook | 16 个插件 before/after | 工具调用实时拦截 |
| Tool 前置检查 | dispatch_subagent (Layer 2)、safe_edit (TOCTOU) | 工具内部验证 |
| Git Hook | pre-commit + commit-msg | 提交时 9 层验证 |
| MCP Tool | Compliance Gate、UC7KS | 协议级强制 |

---

## 第三部分：框架日志系统

### 3.1 子系统总览

| 子系统 | 核心模块 | 存储位置 | 写入方式 | 消费方 |
|--------|---------|---------|---------|--------|
| Plugin/Tool 结构化日志 | `log-manager.ts` (v3.0) | `.task_temp/_logs/{date}/` | 内存缓冲 → O_APPEND flush | 人类审计、故障排查 |
| Shell 命令审计 | `safe-bash-core.ts` | `.opencode/logs/safe-bash.log` | appendFileSync (JSON) | 人类审计、self-test |
| 日志轮转引擎 | `log-rotator.ts` + `rotate-logs.ts` | 同上 + `_archive/` | size/time 双策略 | CI/CD 定时任务 |
| 状态变更事务 | `.transaction-log` | `.opencode/state/` | JSONL append | 状态审计、回溯 |
| 写入审计追踪 | `audit-log.ts` + `write-audit-lib.ts` | `.task_temp/_global/` | JSONL append + CAS 子状态 | Guardian 审查 |

### 3.2 log-manager.ts 写入链路

```
writeLog(plugin, category, fields)
  → 级别过滤 (shouldLog)
  → 格式化: ISO时间 | sessionID | callID | agent | agentType | level | event | detail
  → 内存缓冲区 (Map<key, string[]>)
  → 触发条件: loaded 类型立即 flush / 缓冲 ≥ 20 条 / 定时器 5 秒
  → flushBuffer()
      → openSync(O_WRONLY | O_CREAT | O_APPEND, 0o644)
      → 64KB 分块 writeSync（防大缓冲阻塞）
  → updateIndex() [仅 loaded]
      → scanSources() 扫描目录
      → 原子写入 index.json (tmp + rename)
  → triggerArchiveCheck() [仅 runtime]
      → setImmediate → archiveCheck()
      → 超 7 天目录 → _archive/
```

**关键设计：** POSIX O_APPEND 确保多并发写入者的追加操作在内核层面原子化（seek-to-end + write 单 syscall），64KB 分块防大缓冲区阻塞。`normalizeCategory()` 修复 F1 问题——LogLevel 字符串自动映射到 "runtime"。

### 3.3 log-rotator.ts 轮转策略

| 策略 | 阈值 | 行为 |
|------|------|------|
| Size-based | 100KB | current → .1 → .2 → .3，空文件占位 |
| Compression | 3 天 | .2+ 文件 gzip 压缩 |
| Archival | 30 天 | 移入 `logs/archive/` |
| Monthly tar | 自动 | 同月归档文件 `tar -czf` 打包 |
| 并发保护 | lock 文件 | 5 秒超时自动过期 |

**当前 safe-bash.log 状态：** 614KB + 4 个轮转文件 + 2 个 gz，总 1.1MB。

### 3.4 session.ts 中断哨兵机制

```
session.error hook
  → isInterruptError() 检测合作中断
  → 写 .last-interrupt.json 哨兵
  → 后续工具检查哨兵 → 返回结构化 JSON

session.idle hook
  → 清除哨兵文件

session.compacted hook
  → 清空内存 session map（防过期映射）
```

### 3.5 写入审计数据流

```
Agent 调用修改类工具
  → audit-before.ts (tool.execute.before)
      → executeWriteAuditCheck()
          → isWriteAllowed() 权限检查
          → atomicWriteSubState() × 5 子状态
              ├── write_audit_state (文件列表、检查计数、违规计数)
              ├── eslint_state (脏模块追踪)
              ├── type_check_state (脏文件追踪)
              ├── format_state (未格式化文件)
              └── dependency_state (违规列表)
          → logAuditEntry() → audit_log.jsonl
  → [工具执行]
  → audit-after.ts (tool.execute.after)
      → atomicWriteSubState("write_audit_state") → history 追加 (cap 200)
      → writeLog("audit-after", "runtime") → 插件日志
```

---

## 第四部分：框架优化方向与实施状态

### 4.1 已完成的重构（5 项）

| 优先级 | 项目 | 变化 | 完成日期 |
|:------:|------|------|:--------:|
| **P0** | Pre-commit Hook Bash→TS | 1484 行 bash → 469 行 TypeScript，消除 75.9% 死代码 | 2026-06-15 |
| **P1-A** | CAS 协议统一 | 3 种写入协议 → 1 种 `atomicWriteMachine`，18/18 写入者统一，CAS 覆盖 60%→100% | 2026-06-16 |
| **P2** | Rule Registry 优化 | 1219 行 SHA-256 注册表 → 167 行文档清单 + git diff 检测 | 2026-06-15 |
| **P3** | Plugin 系统去重 | 9 类重复消除，`withPluginLifecycle()` HOF 引入，7 个裸写入插件迁移到 CAS | 2026-06-16 前 |
| — | Compliance Gate 优化 | 三步→两步协议，3 层提醒系统 | 2026-06-16 |

### 4.2 待实施（4 项）

| 优先级 | 项目 | 计划 | 依赖 |
|:------:|------|------|------|
| **P1-B** | machine.json 拆分 | 1.1MB → 14 独立子状态文件，8 步实施计划（`substate-manager.ts` → 迁移 5 插件 → 3 MCP → 10 脚本 → Schema → 数据迁移） | P1-A 已完成 |
| P2 | 引入数据库 | JSON 文件 → SQLite/Redis/DuckDB，解决并发和性能 | P1-B |
| P2 | Multi-Agent 10→3 | 保留 Coder-BE/FE + Guardian + CI-CD，Orchestrator 调度硬编码 | 设计文档 |
| P2 | DAG→flat task list | 图结构 → 优先级列表，261 任务多为线性依赖 | PLAN-FIRST 重写 |

### 4.3 已知技术债

| 类别 | 详情 |
|------|------|
| 超大脚本 | 6 文件超 900 行：compliance-gate.ts (2089)、state-reconciliation.ts (1590)、gate-core.ts (1465)、framework-doctor.ts (1410)、dispatch_subagent.ts (972)、pre-execution-gate.ts (965) |
| RED 阶段测试 | 7+ 测试处于 RED（safe_edit TOCTOU、safeBash allowlist 等），对应安全约束未生效 |
| 双配置源 | opencode.json 与 project.config.json 权限定义重叠，漂移风险 |
| state-reconciliation | check 5 返回 undefined，`checkKnowledgeStateIntegrity` 未正确接入 |

---

## 第五部分：CodeGraph 引入可行性

### 5.1 收益评估

| 指标 | 预期改善 | 来源 |
|------|---------|------|
| Token 消耗 | 平均降低 57% | 官方基准（7 仓库） |
| 工具调用次数 | 平均降低 71%（大仓库 94%） | 官方基准 |
| 速度 | 平均提升 46% | 官方基准 |
| 成本 | 平均降低 35% | 官方基准 |

**与 UC7KS 关系：** 完全互补，无重叠。UC7KS 管"文档怎么用"（外部技术文档），CodeGraph 管"代码什么结构"（内部符号关系）。CodeGraph 可直接替代 UC7KS Scout 层（Layer 3）。

### 5.2 复杂度评估

**低风险：** 纯本地 MCP Server，无外部 API，与框架"完全本地化"原则一致。安装配置仅需 opencode.json 加一条 MCP 声明 + 权限矩阵更新。8 个只读工具不与写操作工具冲突。

**中风险：** `uc7ks-before.ts` 需添加 CodeGraph 感知路由；权限矩阵需为 10 Agent × 8 工具配置。

### 5.3 实施方案

| 阶段 | 时间 | 内容 |
|:----:|:----:|------|
| Phase 1 | 1~2 天 | `codegraph init` → 注册 MCP Server → 权限矩阵 → 验证 |
| Phase 2 | 3~5 天 | 退役 Scout 层 → uc7ks-before 适配 → Agent prompt 更新 → Meta-Planner DAG 规划增强 |
| Phase 3 | 1~2 周 | Guardian 审查增强 → pre-commit 高扇入检查 → knowledge_gap_report 增强 |

### 5.4 CodeGraph vs Obsidian

| 维度 | CodeGraph | Obsidian |
|------|-----------|----------|
| 本质 | AI 面向的自动化代码结构图谱 | 人类面向的个人知识管理 |
| 数据源 | 源码（Tree-sitter 自动分析） | 手写 Markdown 笔记 |
| 消费者 | AI Agent（MCP 协议） | 人类用户（GUI） |
| 代码理解 | 完整（符号/调用图/路由） | 无（代码只是文本） |
| 维护成本 | 零（自动索引） | 高（手动编写） |
| 重叠风险 | 与 Obsidian 无重叠 | 与 CodeGraph 无重叠 |

**结论：** CodeGraph 强烈建议引入。Obsidian 当前阶段不建议——项目的 docs/official_docs/ + UC7KS 已覆盖 AI 消费文档知识的场景。

---

## 第六部分：业务项目概况

### 6.1 技术栈

| 层 | 技术 | 端口 |
|---|------|:----:|
| 后端 | NestJS 11+ / Node.js 22.x / TypeScript 5.x | 3000 |
| 前端 | Angular 21+ / TypeScript 5.x / Tailwind CSS v4 / PrimeNG | 4200 |
| 数据库 | PostgreSQL 16 / Prisma 7.x / Redis 7.x | 5432/6379 |
| 认证 | JWT (15m access + 7d refresh) / Bcrypt (12 rounds) / AES-256-GCM PII 加密 | — |
| 部署 | Docker Compose v2 / GitHub Actions / Prisma migrate | — |

### 6.2 测试策略

| 层 | 框架 | 覆盖率目标 |
|---|------|:---------:|
| Unit | Jest 29+ | 70%+ |
| Integration | Supertest + Testcontainers | 20% |
| E2E | Playwright | 10% |
| Mutation | Stryker | 80% |

---

*报告结束。生成于 2026-06-16，基于框架源码全量读取。*
