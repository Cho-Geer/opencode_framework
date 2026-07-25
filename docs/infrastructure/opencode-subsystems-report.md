# OpenCode 框架 11 子系统深度分析报告

> **生成日期**: 2026-07-01
> **源码版本**: work-one（develop 分支当前状态）
> **分析范围**: `.opencode/` 469+ 文件，~200 个自定义框架文件
> **方法论**: 源码阅读 + CodeGraph 影响分析 + 跨文件调用链追踪

---

## 目录

1. [MVC Architecture](#1-mvc-architecture)
2. [DB-only & DB-canonical Design](#2-db-only--db-canonical-design)
3. [Permission Matrix Subsystem](#3-permission-matrix-subsystem)
4. [Session / Concurrency Safety](#4-session--concurrency-safety)
5. [Hardened Enforcement Subsystem](#5-hardened-enforcement-subsystem)
6. [Framework Harness Subsystem](#6-framework-harness-subsystem)
7. [Multi-Agent Subsystem](#7-multi-agent-subsystem)
8. [Log Central Management Subsystem](#8-log-central-management-subsystem)
9. [DB-canonical Management Subsystem](#9-db-canonical-management-subsystem)
10. [Templatization & Parameterization Universality Subsystem](#10-templatization--parameterization-universality-subsystem)
11. [TypeScript + Bun Based Runtime Subsystem](#11-typescript--bun-based-runtime-subsystem)

---

## 1. MVC Architecture

### 1.1 架构定位

框架的架构并非经典 MVC，而是 **Pipes-and-Filters / Chain of Responsibility** 模式，之上叠加了 MVC 概念映射。工具执行请求按序流经拦截链。

```
LLM Tool Call → Before Dispatcher → Handler Chain(13层) → Tool Executes → After Dispatcher → Handler Chain(13层) → LLM
```

### 1.2 MVC 概念映射

| 层 | 文件 | 角色 |
|----|------|------|
| **Controller** | `plugins/before-dispatcher.ts` | 编排 13 个 before-handler 串行执行，控制 pass/fail |
| **Controller** | `plugins/after-dispatcher.ts` | 编排 13 个 after-handler（fire-and-forget，永不出错阻断） |
| **Controller** | `plugins/system-dispatcher.ts` | 编排 system transform handler（注入 prompt 指令） |
| **Model** | `lib/db-manager.ts` + `lib/db-state-manager.ts` | SQLite 单例连接 + CRUD + 乐观锁 + schema 迁移 |
| **Model** | `service/gate/store.ts` + `store-types.ts` | Gate Session 类型定义、Store CRUD |
| **Model** | `service/permission/reader.ts` + `isolation.ts` | 权限配置加载、权限检查 |
| **Middleware** | `plugin-handlers/before/anti-bypass.ts` | 第一道防线：anti-bypass 引导门 + 阈值强制 |
| **Middleware** | `plugin-handlers/before/scope.ts` → `scope-validate.ts` | 12 步写入作用域验证 |
| **Middleware** | `plugin-handlers/before/codegraph.ts` | CodeGraph impact 分析强制 |
| **Middleware** | `plugin-handlers/before/tdd.ts` | TDD 测试先行强制 |
| **Middleware** | `plugin-handlers/before/gate.ts` | Gate/DAG 强制 |
| **Middleware** | `plugin-handlers/before/git-guard.ts` | Git hook 绕过防护 |
| **View** | `lib/enforce-stop-message.ts` | 标准化 `[FW-ENFORCE][STOP]` 错误消息 |
| **View** | `lib/log-manager.ts` | 结构化日志输出 |
| **Infrastructure** | `lib/hook-lifecycle.ts` | 所有 Plugin 的统一 HOF 包装器（16 行样板代码消除） |
| **Infrastructure** | `lib/interrupt-guard.ts` | 协同中断捕获（SIGINT/AbortError → 结构化 JSON） |

### 1.3 Controller 层详解

#### Before Dispatcher（49 行核心逻辑）

```typescript
// 以配置化的顺序执行 13 个 handler
for (const name of order) {
  if (shouldRun(name, toolName)) {
    await handler(input, output);  // throw = 阻断整个链
  }
}
```

- **ant-bypass FIRST** — 解决 codegraph-enforce 的 throw-preemption bug
- 13 个 handler 按 `project.config.json > plugin_execution_order.before` 顺序串行执行
- **throw 透传语义**：任何一个 handler throw，后续全部被阻断

#### After Dispatcher（fire-and-forget）

```typescript
for (const name of order) {
  try { await handler(input, output); }
  catch (err) { writeLog("after-dispatcher", "ERROR", {...}); }
  // NEVER re-throw — 后置处理器是副作用处理器，不能阻断
}
```

#### System Dispatcher

注册在 `experimental.chat.system.transform` 事件，目前只有 anti-bypass handler，用于动态注入 `output.system.push()` 引导指令。

### 1.4 核心设计决策

1. **Before=阻断，After=副作用** — 框架不变式，Before 是安全门（fail-closed），After 是清理器（fail-open with logging）
2. **Config-driven execution order** — `project.config.json` 可热覆盖执行顺序，mtime 缓存无效化
3. **静态 handler 注册** — 无动态发现，所有 handler 在 `HANDLER_MAP` 中显式 import 和注册
4. **标准化错误消息** — `[FW-ENFORCE][STOP][<ruleId>]` 格式让 LLM 可解析合规指令

---

## 2. DB-only & DB-canonical Design

### 2.1 核心原则

**DB 是唯一规范数据源**。所有 JSON 文件（`gate-state.json`、`machine.json`、`eslint-state.json` 等）都是 DB 的导出缓存，可通过 `dbRegenerateGateFiles()` 从 DB 完全重建。

### 2.2 证据链

```
dbRegenerateGateFiles()
  ├── 重建 gate-state.json         ← dbReadCompactorHotFull() (JOIN gate_sessions + gate_session_index)
  ├── 重建 gate-state.index.json   ← dbReadCompactorIndex()
  ├── 重建 gate-state.history/*.jsonl ← gate_audit_history 表分组
  └── 原子写入 (tmp + rename)
```

### 2.3 迁移路径

```
Phase 1 (dual-write): JSON files ←→ substate_kv 表
Phase 2 (DB-primary):   DB = canonical, JSON = export cache
Phase 3 (cleanup):      migrateJsonToDb() 全量迁移
```

### 2.4 SQLite WAL 模式配置

```sql
PRAGMA journal_mode = WAL;      -- 并发读取 + 快速写入
PRAGMA synchronous = NORMAL;    -- WAL 安全级别
PRAGMA foreign_keys = ON;       -- 引用完整性
PRAGMA busy_timeout = 5000;     -- 锁等待 5 秒
PRAGMA temp_store = MEMORY;     -- 临时表在内存
PRAGMA cache_size = -4000;      -- 4MB 页缓存
```

### 2.5 Schema 版本演进（v1→v32，Phase 0 基线修正）

| 版本 | 里程碑 | 关键变更 |
|------|--------|---------|
| v1 | P2-A 初始化 | machine_meta, machine_contracts |
| v2 | 双写过渡 | substate_kv 通用 KV 表 |
| v4 | P3/G11+G2 | file_baseline_kv TOCTOU 检测 |
| v5 | P3 交付物 | 6 个交付物列 |
| v7 | 清理 | DROP 13 个废弃类型化子状态表 |
| v10 | 读审计 | read_audit 表 + 4 个索引 |
| v11 | KC-05 | 7 个知识库表 |
| v15 | A7 dispatch | dispatch_queue + 租约 |
| v18 | P0-CHECKLIST | execution_checklist 3 表 |
| v19 | UC7KS Pipeline | uc7ks_pipeline_state |
| v24 | 模型身份 | session_map.model_id |
| v26 | TSC Gate v2 | tsc_gate_locks + events |
| v28 | acp_notify | notifications 反向通道 |
| v29 | anti-bypass v2 | tool_enforcement 表 |

---

## 3. Permission Matrix Subsystem

### 3.1 架构总览

权限子系统是 7+ 层防御体系，从 `opencode.json` 静态配置到运行时 shell 内容扫描。

### 3.2 权限源

| 源 | 文件 | 角色 |
|----|------|------|
| **Agent 权限** | `opencode.json > agent.{Name}.permission` | 唯一规范源（P2-D v2.1） |
| **全局危险模式** | `DENIED_WRITE_PATTERNS` + `DANGEROUS_PATTERNS` | 硬编码全局规则 |
| **Agent 可派发工具** | `project.config.json > agent_dispatch_allowed_tools` | 派发阶段限制 |
| **Agent 危险绕过** | `project.config.json > agent_dangerous_bypass` | Agent 特定豁免 |
| **Shell 允许列表** | `DEFAULT_ALLOWLIST` + config override | 命令级允许 |

### 3.3 权限检查管线

```
opencode.json 加载
  └→ getAgentPermission(agentName)     [reader.ts]
      └→ cfg.agent[toDisplayName(agent)].permission

权限模式加载
  └→ PERMISSION_PROFILES (10 Agent 硬编码配置文件)

写入前拦截
  └→ isPathAllowedForAgent(agent, path, "safe_edit")  [reader.ts:198]
      ├── deny patterns 优先检查（deny-first 语义）
      ├── allow patterns 从宽匹配
      └── 无匹配但存在 scope → 默认 DENY

Shell 命令拦截
  └→ safeBashTool() [shell-guard.ts:163]
      ├── opencode.json safe_shell vetos (deny/ask)
      ├── DANGEROUS_PATTERNS check
      ├── getAllowlist() 合并允许列表
      ├── 脚本内容扫描 (node *.ts/*.js)
      ├── Eval 内容扫描 (node -e / bun -e)
      └── 执行
```

### 3.4 10 步验证管线（validateWriteScope）

1. 模式门控 — advisory 模式全部放行
2. 非修改工具 — 直接通过
3. Agent 工具允许列表 — 不允许使用该工具的 Agent 被阻断
4. 多路径 shell 解析 — 提取写入目标路径
5. 不可解析 shell — 分类为只读/写入/不可解析
6. **BACKUP-BYPASS 检查** — safe_shell/bash 不能修改文件（缺乏备份机制）
7. **ROUTE-MISMATCH** — Agent 写入其他 Agent 的文件作用域
8. **UC7-008** — Knowledge-Curator 作用域隔离
9. **Write Path Scope** — opencode.json safe_edit 检查
10. **Config Read Attest** — 必须先读取配置并认证

### 3.5 Deny-First 优先级

OpenCode 全局语义是 "last matching wins"，但本项目使用 **deny-first**。

### 3.6 "ask" 降级策略

`"ask"` 权限在非交互框架上下文中降级为 `deny`。

---

## 4. Session / Concurrency Safety

### 4.1 并发安全机制全景

| 机制 | 并发原语 | 作用域 | 核心文件 |
|------|---------|--------|---------|
| Dispatch Queue Lease | SQLite transaction + lease_expiry | 同 Agent 分发串行化 | `queue.ts` |
| session_map Agent 绑定 | COALESCE on INSERT OR REPLACE + agent IS NOT NULL guard | 跨 Agent 身份隔离 | `session-map.ts` |
| DAG 任务状态检查 | Read + enforce (no blind write) | 每个任务的派发门控 | `dispatch-validate.ts` |
| 文件基线 TOCTOU | inode/mtime/dev snapshot + INSERT OR REPLACE | 跨进程文件修改 | `db-state-manager.ts:182-278` |
| 子状态乐观 CAS | WHERE updated_at = ? + changes check | 每个 key 的并发写 | `db-state-manager.ts:88-131` |
| Gate Session 乐观锁 | WHERE version = ? + 最多 3 次重试 | 每 session gate 状态变更 | `db-state-manager.ts:637-693` |
| 序列化 RMW 事务 | db.transaction() 包裹 read+modify+write | 子状态修改 | `db-state-manager.ts:146-179` |
| Gate UPSERT | INSERT ... ON CONFLICT DO UPDATE | Gate store 保存 | `db-state-manager.ts:468-508` |
| 原子文件写入 | tmp+rename (POSIX atomic) | 所有 JSON/TXT 文件 | `state-utils.ts:251-271` |
| GATE-APPROVAL-LOCK-v2 | dispatch 前读取 gate_sessions | 跨 session 审批依赖 | `dispatch-validate.ts:208-272` |
| 启动过期排空 | Batch UPDATE in db.transaction() | 重启时清理 | `lifecycle.ts:65-112` |

### 4.2 Dispatch Queue 租约机制

```
ENQUEUE (FIFO)
  dbEnqueueDispatch() → INSERT status='pending' + created_at

DEQUEUE WITH LEASE (pessimistic lock)
  dbDequeueWithLease() → SELECT oldest pending + UPDATE to running with lease
  租约 TTL: 60s (可配 DISPATCH_LEASE_TTL_MS)

CONSUME
  dbConsumeDispatch() → UPDATE status='consumed'

STALE RECLAMATION
  dbCleanStaleLeases() → UPDATE expired leases to 'stale'
```

### 4.3 Optimistic Locking（乐观锁）模式

**Pattern 1: `updated_at` CAS（子状态 KV）**
```typescript
UPDATE substate_kv SET json=?, updated_at=? WHERE key=? AND updated_at=?
// changes===0 → 并发写冲突 → 返回 false，调用方重试
```

**Pattern 2: `version` 列乐观锁（Gate Session）**
```typescript
// 最多 3 次重试
UPDATE gate_sessions SET ..., version=version+1 WHERE session_id=? AND version=?
// changes===0 → OPTIMISTIC_LOCK_CONFLICT → 重新读取并重试
```

**Pattern 3: SQLite 事务序列化**
```typescript
const txn = db.transaction((k) => {
  read current → modify → INSERT OR REPLACE
});
txn(key); // SQLite 自动序列化所有写事务
```

### 4.4 启动清理 9 步流程

1. 排空过期 gate sessions (>24h armed, >48h checked)
2. 清理 stale dispatch_queue entries
3. 会话映射一致性检查
4. 配置重置（config_read_state 过期）
5. DB WAL 检查点 + VACUUM
6. gate_audit_history 膨胀检测 (>10K 行 → 审计清理)
7. 孤儿 session_map 清理 (>24h 无 session_log 引用)
8. dispatch 过期排空 (>30min pending, >2h delivered)
9. 健康状态报告

---

## 5. Hardened Enforcement Subsystem

### 5.1 9 层执行强制管线

```
Layer 0: GUIDANCE GATE (anti-bypass Phase 1)
  → 只有 clear_guidance 和 acp_notify 工具被允许

Layer 1: P0 CHECKLIST (checklist)
  → 7 阶段任务清单强制完成，否则阻断

Layer 2: ANTI-BYPASS THRESHOLD (anti-bypass threshold)
  → 连续失败 >= hardThreshold(4) 时阻断所有工具

Layer 3: WRITE SCOPE VALIDATION (scope-validate, 12 步)
  → 最复杂的验证层

Layer 4: CODEGRAPH IMPACT (codegraph)
  → 修改代码前必须先 codegraph_search + codegraph_impact

Layer 5: TDD ENFORCEMENT (tdd)
  → Coder Agent 必须先写 .spec.ts/.test.ts

Layer 6: GIT GUARD (git-guard)
  → 阻止 --no-verify、hooksPath、skipHooks 绕过

Layer 7: CONFIG GUARD (config-guard)
  → 阻止修改 Git hook 配置

Layer 8: JSON VALIDATION (json-validate)
  → 关键 JSON 文件语法 + 执行模式降级保护

Layer 9: SYSTEM TRANSFORM (system/anti-bypass)
  → 动态注入 [FW-ENFORCE] 指令到 LLM prompt
```

### 5.2 三种执行模式

| 行为 | advisory | strict | locked |
|------|----------|--------|--------|
| 写入作用域违规 | 日志警告 | 阻断 | 阻断 |
| 配置读取认证 | 不要求 | 要求 | 要求 |
| P0 清单 | 日志警告 | 阻断 | 阻断 |
| TDD 强制 | 日志警告 | 阻断 | 阻断 |
| JSON 验证 | 日志警告 | 阻断 | 阻断 |
| 模式降级 | N/A | 不能降级到 advisory | 完全不能改变 |
| ENV 覆盖 | 可以 | 可以 | **不能**（locked 不可被环境变量覆盖） |

### 5.3 Anti-Bypass 引导门（Guidance Gate）

```
Phase 0: Agent 正常操作，失败在 SQLite 累积

Phase 1: hardThreshold(4) 达到
  → before-hook 抛出 [FW-ENFORCE] 错误
  → Agent 必须调用 acp_notify 报告

Phase 2: Agent 报告后
  → rewardReport() 生成加密 token (crypto.randomBytes(16))
  → awaiting_guidance = 1（门已锁）
  → stop_injected = 1（system handler 注入指令）
  → Agent 不持有 token，无法自清除

Phase 3: System Transform 注入指令
  3a: token 未交付 → [GUIDANCE-GATE] 告知 Agent 等待
  3b: QoderWork 交付 token → [GUIDANCE-READY] 包含 token + 恢复指引

Phase 4: Agent 调用 clear_guidance(token)
  → 验证 token 匹配 → 所有计数器重置 → 会话恢复
```

### 5.4 "Hardened" 的设计特征

1. **DB-canonical 状态** — 强制状态持久化在 SQLite，重启不丢失
2. **Hard constraint (throw Error)** — 阻断工具，Agent 无法继续
3. **Token-based 门锁** — 加密随机 token，Agent 物理上无法自清除
4. **跨层死锁防护** — 所有强制层在引导门活跃时放行 clear_guidance/acp_notify
5. **孤儿检测** — before-hook 触发但 after-hook 未运行时增量合规计数器
6. **累积不重置** — Success 不重置 failure count，只有显式引导清除才重置

---

## 6. Framework Harness Subsystem

### 6.1 Plugin 加载机制

**统一 HOF 包装器** (`hook-lifecycle.ts`)：

```typescript
function withPluginLifecycle(name: string, hooks: PluginHooks): PluginExport {
  ensureLogDir();
  writeLog(name, "loaded", { event: "PLUGIN-LOADED" });
  updateIndex(name, "PLUGIN-LOADED");
  return (async (ctx) => {
    writeLog(name, "hooks", { event: "HOOK-REGISTERED" });
    return hooks;
  });
}
```

所有 29 个 Plugin handler 传入此 HOF，消除样板代码。

### 6.2 三阶段派发架构

| 阶段 | 事件 | 文件 | 注册数 | 语义 |
|------|------|------|--------|------|
| Before | `tool.execute.before` | `before-dispatcher.ts` | 15 handlers | throw 透传阻断 |
| After | `tool.execute.after` | `after-dispatcher.ts` | 14 handlers | fire-and-forget 不阻断 |
| System | `experimental.chat.system.transform` | `system-dispatcher.ts` | 1 handler | fire-and-forget 不阻断 |

### 6.3 热重载机制

`config-loader.ts` 使用 **mtime-based 缓存**：

```typescript
const stat = statSync(configPath);
if (stat.mtimeMs === _cachedMtime && _cached) return _cached;
// 缓存失效 → 重新读取 project.config.json
```

每次派发调用时读取缓存，project.config.json 修改后下一次调用自动获取新配置。

### 6.4 框架自诊断

**framework-self-test.ts** — 33+ 完整性检查：
- 配置文件存在性和有效性
- Agent skills 清洁度
- Git hooks 安装状态
- 绝对路径泄露扫描
- P0 清单完整性
- Agent 文件引用有效性
- "{placeholder}" 未解析检测

**framework-doctor.ts** — 13 项健康检查：
- opencode.json 同步检查
- DAG 验证
- State reconciliation
- Transaction verification
- 关键基础设施文件
- Git hook 安装
- 路径可移植性
- 编码/mojibake 扫描
- `--fix` 自动修复模式

### 6.5 Session 生命周期管理

`plugins/session.ts` 注册 **6 个生命周期钩子**：

| Hook | 触发 | 操作 |
|------|------|------|
| `chat.message` | 每轮对话开始 | 9 步清理 + config_read 重置 + 合规审计 |
| `session.created` | 新会话创建 | session_map 写入 + DB 健康检查 |
| `session.idle` | 每 5 个空闲周期 | WAL 检查点 + VACUUM + 审计清理 |
| `session.compacted` | 上下文压缩 | 重置健康计数器 |
| `session.error` | 会话错误 | 级联错误上下文记录 |
| `experimental.session.compacting` | 压缩前 | 共享变量生命周期管理 |

---

## 7. Multi-Agent Subsystem

### 7.1 PLAN-FIRST 三层强制

| Layer | 位置 | 机制 |
|-------|------|------|
| **Layer 1** | `dispatch-validate.ts` (before-hook) | 策略驱动验证 — 最早感知和拒绝 |
| **Layer 2** | `router.ts` (pre-flight) | 无条件的代码级 DAG 查找 |
| **Layer 3** | `gate-before.ts` | P2-1 防御深度审计（修改工具时） |

### 7.2 4 层路由链（L0-L4）

```
L0: 目的推断 (inferDispatchPurpose + purposeFilter)
  → keyword 匹配 + 优先级评分 → 覆盖/增强 L1

L1: 动词候选 (l1_verbCandidates)
  → 动词关键词 → 中文/英文映射到 Agent 池

L2: 作用域过滤 (l2_scopeFilter)
  → DAG target_files → 文件路径 → 匹配 scope_to_agent 规则

L3: 权限否决 (l3_permissionFilter)
  → opencode.json safe_edit glob → 逐文件检查每个候选 Agent

L4: 启发式选择 (l4_heuristicSelect)
  → 加权评分: scopeScore*0.35 + permissionScore*0.40 + domainScore*0.25
```

**DAG Authoritative Override**: 如果 DAG 条目指定了特定 Agent 而路由选了不同的，DAG 条目优先级更高。

### 7.3 Prompt 构建管线

```
dispatch_subagent 调用
  → buildDispatchPrompt()
    ├── resolveTemplateVariables() — 解析 {template.key} 占位符
    ├── subagent-preamble.md 注入 — P0 协议首节
    ├── Deliverables 模板 + KC gate flow
    ├── Coding standards — 载入 Agent 特定编码标准
    ├── Agent 配置 — SLIM reference to .opencode/agents/{name}.md
    ├── Project 上下文 — 技术栈 + Context7 技术查询
    └── DISPATCH_TOKEN + promptHash — SHA-256 完整性验证
```

### 7.4 DAG 豁免 Agent

| Agent | 原因 |
|-------|------|
| @Orchestrator | 自身任务协调 |
| @Super-Admin | 紧急修复 |
| @Knowledge-Curator | 按需知识管道 |
| @Meta-Planner | 规划/计划生成 |

其余 Agent 必须在 `Task.DAG.json` 中有条目。

### 7.5 自动规划机制

```
DAG 条目缺失 + auto_plan=true
  → 策略门控: auto_plan_enabled? (locked 模式下强制 false)
  → 速率限制: max 5 次/session
  → 合成规划 prompt → dispatch @Meta-Planner
  → 轮询 Task.DAG.json (每 1000ms, timeout 120s)
  → 验证新条目 status = "pending" | "in_progress"
```

---

## 8. Log Central Management Subsystem

### 8.1 架构（v3.0, FW-LOG-UNIFY Phase 0）

| 组件 | 实现 |
|------|------|
| 写 API | `writeLog(plugin, category, fields)` — 统一入口 |
| 缓冲区 | 内存 `Map<string, string[]>` 按 `{plugin}:{category}` 分组 |
| 刷写 | POSIX `O_APPEND` 原子写入（fs.openSync + fs.writeSync） |
| 定时器 | 每 5 秒周期性刷写 |
| 进程退出 | `process.on("exit"/"SIGINT"/"SIGTERM")` 全量刷写 |

### 8.2 日志类别

| Category | 描述 | 文件模式 |
|----------|------|---------|
| `loaded` | Plugin 加载事件 | `{prefix}-{plugin}-loaded.log` |
| `hooks` | Hook 执行事件 | `{prefix}-{plugin}-hooks.log` |
| `runtime` | 运行时操作事件 | `{prefix}-{plugin}-runtime.log` |

### 8.3 索引维护（index.json v3.0）

```typescript
interface LogIndex {
  version: "3.0";
  last_updated: string;
  plugins: Record<string, PluginIndexEntry>;    // 加载追踪
  dates: Record<string, DateIndexEntry>;        // 每日计数
  sources: Record<string, SourceIndexEntry>;    // 源感知追踪
}
```

**关键规则**: `"loaded"` 类别的日志**立即刷写**（因为 `updateIndex()` 扫描日志目录，需要文件存在）。

### 8.4 日志轮转

| 策略 | 默认值 | 描述 |
|------|--------|------|
| maxSize | 100 KB | 文件超过此值触发轮转 |
| maxRotatedFiles | 3 | 最多保留 3 个轮转副本 |
| compressAfterDays | 3 天 | gzip 压缩旧轮转文件 |
| archiveAfterDays | 30 天 | 移到月度归档 |
| lockTimeout | 5000 ms | 并发轮转锁 |

### 8.5 审计追踪（四层）

```
Layer 1: Write Audit Trail (recordWriteAudit)
  → safe_edit/safe_delete/safe_shell → write_audit_state.history (200 条上限)

Layer 2: DB Audit Entry (dbWriteAuditLogEntry)
  → session_id, agent, event_type, detail, timestamp

Layer 3: Write Audit Scope Check (executeWriteAuditCheck)
  → 对于每个写入的源文件: isWriteAllowed(agent, file)
  → 追踪 5 种子状态的 dirty 标记

Layer 4: Super-Admin Dispatch Audit
  → logOrchestratorSADispatch() / logSuperAdminDispatchBypass()
```

---

## 9. DB-canonical Management Subsystem

### 9.1 主连接管理

`db-manager.ts` 实现 **单例 Database 连接**：

- `getDb()` — 返回或创建连接
- `closeDb()` — 优雅关闭
- `initializeSchema()` — 创建所有表（v1→v32，Phase 0 基线修正）
- `getDbPath()` — 解析 DB 文件路径

### 9.2 JSON → DB 迁移

`migrateJsonToDb()`:
1. 遍历所有子状态 JSON 文件
2. 每个文件：读取 → 验证 JSON → `dbWriteSubState()` (UPSERT to substate_kv)
3. machine.json 特殊处理（meta + contracts 写入独立表）
4. 返回 `MigrationResult { migrated, failed, skipped, total_bytes }`
5. **幂等** — 已有行被覆盖

### 9.3 状态压缩器（State Compactor）

三层存储层次：

| 层 | 文件/表 | 内容 |
|----|---------|------|
| **Hot** | gate_sessions 表 → gate-state.json | 活跃 + 最近 7 天完成 |
| **Warm** | gate-state.history/YYYY-MM-DD.jsonl | 每个完成的 session 的完整详细数据 |
| **Cold** | gate-state.index.json | 所有 session 的元数据条目 |

压缩触发条件：
- `RECENT_DAYS: 7` — 超过 7 天的 session 移出热层
- `MAX_RECENT_SESSIONS: 50` — 触发归档批处理
- `MAX_HOT_FILE_SIZE: 100KB` — 触发压缩

### 9.4 DB 膨胀预防

| 机制 | 触发条件 | 操作 |
|------|---------|------|
| gate_audit_history 监控 | >10,000 行 | 运行审计清理（7 天保留） |
| WAL 检查点 | 每 5 个空闲周期 | `safeCheckpoint()` |
| VACUUM | 每 5 个空闲周期 | `runDbVacuum()` 回收 freelist 页 |
| 定期报告 | 每 5 分钟 | 健康统计 |

### 9.5 状态重建

`dbRegenerateGateFiles()` — DB 作为规范源：

```
gate_sessions + gate_session_index + gate_audit_history
  ↓
gate-state.json + gate-state.index.json + gate-state.history/*.jsonl
```

所有文件使用 `tmp + rename` 原子写入。

### 9.6 一致性检查

`state-reconciliation.ts` 执行 4 项跨引用检查：
1. 每个完成的 DAG 任务都有 consumed gate session
2. 每个 armed gate session 都引用 pending/in_progress DAG 任务
3. 检测孤儿 session（已 armed >24h + 已完成任务 → 过期排空）
4. DAG 元计数 vs 实际任务状态

`--fix` 标志自动修复过期排空、DAG 计数修正和回填审计记录。

---

## 10. Templatization & Parameterization Universality Subsystem

### 10.1 模板变量解析

使用 `{namespace.key}` 双花括号语法。两阶段系统：

**Phase 1: Map 构建** (`buildTemplateResolutionMap()`)

三层优先级构建：

```typescript
// Layer 1 (base — 最低优先级)
map["project.name"] = projectConfig.project.name;
map["backend.framework"] = techStack.backend.framework;
// Layer 2 (mid)
map["backend.orm.schema"] = ...;
// Layer 3 (override — 最高优先级)
// template_resolution 中的任何键如果有 "." → 直接插入
// 没有 "." 的键 → 加 "project." 前缀
```

**Phase 2: Regex 替换** (`resolveTemplateVariables()`)

```typescript
content.replace(/\{([a-z_]+\.[a-z_.]+)\}/g, (match, key) => {
  if (templateMap.hasOwnProperty(key)) return templateMap[key];
  return `UNRESOLVED${match}`;  // 可检测的未解析占位符
});
```

### 10.2 解析时机

五种内容流在派发时被解析：

1. Task description — `{task.description}`
2. Agent config — `.opencode/agents/{name}.md` 中的占位符
3. Preamble — `subagent-preamble.md`
4. Coding standards — Agent 特定的编码规范文件
5. 完整组装 prompt — 最终遍

### 10.3 覆盖链

| 优先级 | 层 | 源 | 示例 |
|--------|-----|----|------|
| 1 (base) | Project root | `project.config.json` 根字段 | `project.name`, `project_root` |
| 2 (mid) | Tech stack | `tech_stack.*` 嵌套字段 | `backend.framework`, `db.orm` |
| 3 (override) | Template resolution | `template_resolution.*` 键 | 任意 `namespace.key` → value |

### 10.4 Agent Config 中的使用

```markdown
# Coder-BE.md
❌ 绝对禁止: 修改 {backend.orm.schema} 而不先运行 {project.contract_hash_command}

# Coder-FE.md
❌ 绝对禁止: 修改 {frontend.dto_path} 或 {frontend.env_path} 而不先运行 {project.contract_hash_command}

# Architect.md
❌ 绝对禁止: 提交 contract.yaml 修改而不先运行 {project.contract_hash_command}
```

### 10.5 扩展占位符

12 个扩展占位符用于在规则文档中描述 domain-specific 模式：
- `{backend.orm.transaction}`, `{backend.auth}`, `{backend.rate_limit}` 等 7 个
- `{frontend.css_strategy}`, `{frontend.state_pattern}` 等 5 个

### 10.6 Fail-Safe 设计

未解析的占位符产生 `UNRESOLVED{template_key}` — **从不静默忽略**。`framework-self-test.ts` Check 17 扫描任何 `UNRESOLVED{` 字符串。

---

## 11. TypeScript + Bun Based Runtime Subsystem

### 11.1 零构建、直接执行模型

**无编译步骤**:
- 无 `tsc`、`build`、`compile` 脚本
- 无 `dist/` 或 `out/` 目录
- Bun 内部转译 TypeScript，去除类型但不进行类型检查（速度优先）

**所有 .ts 文件直接执行**:
```bash
bun file.ts  # Bun 原生 TypeScript 支持
```

### 11.2 Bun 特定 API 使用

**a) `bun:sqlite` — 零依赖嵌入式数据库**

7 个文件使用 `bun:sqlite`：
- `lib/db-manager.ts` — 主连接管理器
- `service/enforcement/tool-tracker.ts` — 强制追踪
- `service/notification/mcp-notify.ts` — 通知持久化
- `service/session/lifecycle.ts` — 会话生命周期
- `plugins/session.ts` — 插件 DB 访问
- `scripts/backfill-session-map.ts`、`knowledge/capture-config-snapshot.ts`

**b) `execFileSync` 子进程编排**

`router.ts` 中 3 处使用 `execFileSync("bun", ...)`：

```typescript
// 自动规划 Meta-Planner
execFileSync("bun", ["--no-cache", scriptPath, "Meta-Planner", planningDagId, planningPrompt], {
  encoding: "utf8", timeout: policy.auto_plan_timeout_ms,
});

// 主派发 CLI
const stdout = execFileSync("bun", ["--no-cache", scriptPath, ...scriptArgs], {
  encoding: "utf8", timeout: 60000,
});
```

`--no-cache` 确保每次调用都是干净模块缓存。

**c) Shebang 直接执行**

42+ 个 .ts 文件使用 `#!/usr/bin/env bun` 可直接作为可执行文件运行。

### 11.3 最小化依赖

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",  // MCP 协议
    "@opencode-ai/plugin": "1.17.6"           // OpenCode SDK
  },
  "devDependencies": {
    "@types/node": "^25.9.1",                 // IDE 类型
    "bun-types": "^1.3.14"                    // Bun API 类型
  }
}
```

只有 **2 个运行时依赖**：
- 无 ORM、无 Web 框架、无数据库驱动（bun:sqlite 内置）
- 无构建工具（Bun 原生处理 TypeScript）
- 无测试框架在运行时（测试使用外部 Jest 配置）

### 11.4 自定义工具模式

所有 21 个自定义工具遵循**瘦控制器**模式：

```typescript
import { tool } from "@opencode-ai/plugin";

export default tool({
  description: "工具描述...",
  args: {
    paramName: tool.schema.string().describe("参数描述"),
  },
  async execute(args, context) {
    // 业务逻辑委托给 service/ 层
  },
});
```

工具处理参数解析和响应格式化；所有业务逻辑在 `.opencode/service/` 下。

### 11.5 MCP 服务器模式

所有 MCP 服务器遵循统一架构：

```typescript
#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "xxx", version: "1.0.0" });
server.registerTool("tool_name", { inputSchema }, (args) => {
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});
const transport = new StdioServerTransport();
server.connect(transport);
```

**6 个 MCP 服务器**:
- `compliance-gate.ts` (8 个工具)
- `eslint-audit.ts`
- `keystone-validate.ts`
- `code-quality-check.ts`
- `notify-server.ts` (acp_notify 反向通道)
- `code-quality-lib.ts` (共享库)

### 11.6 性能优势利用

| 优势 | 机制 |
|------|------|
| 启动速度 | 42+ shebang 脚本，亚毫秒冷启动 |
| 嵌入式 SQLite | `bun:sqlite` 编译时集成，零开销 |
| 直接 .ts 执行 | 无编译管道，即时反馈 |
| 子进程性能 | `execFileSync("bun", ...)` 快速启动 |
| 最小依赖树 | 仅 2 个运行时依赖 |

---

## 附录 A: 关键文件位置速查

| 子系统 | 核心文件 |
|--------|---------|
| MVC | `plugins/before-dispatcher.ts`, `plugins/after-dispatcher.ts`, `lib/hook-lifecycle.ts` |
| DB-canonical | `lib/db-manager.ts`, `lib/db-state-manager.ts`, `lib/state-utils.ts` |
| Permission | `service/permission/reader.ts`, `service/permission/isolation.ts`, `service/gate/scope-validate.ts` |
| Concurrency | `service/dispatch/queue.ts`, `lib/db-state-manager.ts` (CAS/version patterns), `service/session/lifecycle.ts` |
| Hardened Enforcement | `plugin-handlers/before/anti-bypass.ts`, `service/enforcement/tool-tracker.ts`, `service/gate/scope-validate.ts` |
| Framework Harness | `plugins/session.ts`, `scripts/framework-self-test.ts`, `scripts/framework-doctor.ts` |
| Multi-Agent | `tools/dispatch_subagent.ts`, `service/dispatch/router.ts`, `service/dispatch/route-validator-l3-l4.ts` |
| Log | `lib/log-manager.ts`, `lib/log-rotator.ts`, `service/file-guard/audit.ts` |
| DB Management | `lib/db-manager.ts`, `service/gate/compactor-core.ts`, `scripts/state-reconciliation.ts` |
| Templatization | `service/dispatch/prompt-sections.ts`, `project.config.json` (template_resolution section), `rules/rule_detail/TEMPLATE_VARIABLE_STANDARD.md` |
| TS+Bun Runtime | `tools/safe_edit.ts`, `scripts/mcp-tools/compliance-gate.ts`, `lib/db-manager.ts` (bun:sqlite) |

## 附录 B: 架构决策记录（ADR）

1. **Deny-First 权限** — 覆盖 OpenCode 的 "last matching wins" 语义
2. **Before=阻断, After=副作用** — 框架基础不变式
3. **DB as Single Source of Truth** — JSON 文件是可重建导出缓存
4. **anti-bypass FIRST** — 解决 codegraph-enforce throw-preemption bug
5. **Token-based Gate Lock** — Agent 无法自清除，需要外部 QoderWork 交付 token
6. **累积不重置计数器** — Success 不重置 failure count
7. **Thin Controller Pattern** — 工具是薄控制器，业务逻辑在 service/
8. **Zero-build Runtime** — Bun 原生 TypeScript，不需要构建步骤
9. **Config-driven execution order** — 热可重配，mtime 缓存无效化
