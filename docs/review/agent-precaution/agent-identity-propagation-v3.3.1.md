# Agent 身份传递方案 v4.0.0-draft

**版本**: v4.0.0-draft（废弃 FRAMEWORK_AGENT）
**日期**: 2026-06-08
**作者**: @Super-Admin
**状态**: 已验证（三次穿插派遣 + 并行派遣测试通过）；废弃 FRAMEWORK_AGENT 待实施
**依赖**: `framework-enforcer` plugin (`.opencode/plugins/framework-enforcer/`)

---

## 目录

1. [问题背景](#1-问题背景)
2. [三层 Agent 解析架构](#2-三层-agent-解析架构)
3. [resolveAgent() 优先级链路](#3-resolveagent-优先级链路)
4. [核心代码实现](#4-核心代码实现)
5. [各场景 Agent 解析表](#5-各场景-agent-解析表)
6. [完整数据流](#6-完整数据流)
7. [关键技术约束](#7-关键技术约束)
8. [验证记录](#8-验证记录)
9. [待改进项](#9-待改进项)
10. [FRAMEWORK_AGENT 环境变量调查](#10-framework_agent-环境变量调查)
11. [废弃 FRAMEWORK_AGENT 可行性分析](#11-废弃-framework_agent-可行性分析)
12. [实施方案：废弃 FRAMEWORK_AGENT](#12-实施方案废弃-framework_agent)

---

## 1. 问题背景

### OpenCode 插件系统的硬限制

```
┌──────────────────────────────────────────────────────────────────┐
│ tool.execute.before 输入 = { tool, sessionID, callID }            │
│                    ↕  没有 agent 字段                             │
│                                                                   │
│ tool.execute.after 输入  = { tool, sessionID, callID, args }      │
│                    ↕  也没有 agent 字段                           │
│                                                                   │
│ 只有 chat.message 原生提供 agent:                                │
│   input = { sessionID, agent?, ... }                              │
│                                                                   │
│ AGENT env var = "1"  ← 布尔标志，不是 agent 类型标识              │
│ FRAMEWORK_AGENT     ← 不存在于 OpenCode 源码，是我们的发明        │
│ context.agent       ← 自定义工具 execute() 中可用（OpenCode 原生）│
└──────────────────────────────────────────────────────────────────┘
```

### 来源

| 文档 | 关键发现 |
|------|---------|
| `agent-identity-plugin-hooks.md` | `tool.execute.before` 官方类型定义无 agent 字段；`FRAMEWORK_AGENT` 是项目自行发明 |
| `agent-identity-plugin-hooks.md` | `AGENT=1` 是布尔标志；`Tool.Context.agent` 仅 tool execute() 回调可用 |
| `plugin-debugging-precautions.md` §6 | `Task()` 的 `output.args` 包含 `subagent_type` — 可拦截 |
| `plugin-debugging-precautions.md` §5 | `console.log` 在插件中不可见，必须用文件日志 |
| `plugin-debugging-precautions.md` §3 | Bun 编译缓存不自动失效，需修改入口文件注释刷新 |
| `plugin-debugging-precautions.md` §4 | 插件只加载 `index.ts`，所有 Hook 需从入口导入 |

---

## 2. 三层 Agent 解析架构

```
┌───────────────────────────────────────────────────────────────────┐
│                    Agent 身份解析系统 v4.0.0                        │
│                    （三层文件机制，零环境变量依赖）                  │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Layer 1: chat.message → Session Map (被动收集)              │  │
│  │                                                             │  │
│  │  Hook: chat.message                                        │  │
│  │  source: input.agent (OpenCode 原生提供)                    │  │
│  │  output: .task_temp/_dispatch/.session_map.json            │  │
│  │  格式: { sessionID: { agent: string, ts: ISO8601 } }        │  │
│  │  LRU: 最多保留 50 条                                        │  │
│  │                                                             │  │
│  │  覆盖场景: 主 Agent 的 tool.execute hook                    │  │
│  │  当 resolveAgent() 返回 "" 时，查表兜底                     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                           ↓                                       │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Layer 2: TASK-IDENTITY → _dispatch_target.json (主动注入)   │  │
│  │                                                             │  │
│  │  Hook: tool.execute.before                                  │  │
│  │  触发: tool="task" && caller∈{@Super-Admin,@Orchestrator}  │  │
│  │  source: output.args.subagent_type                          │  │
│  │  output: .task_temp/_dispatch_target.json                   │  │
│  │  格式: { agent, task_id, run_id, timestamp }                │  │
│  │                                                             │  │
│  │  覆盖场景: 子 Agent 进程的 tool.execute hook                 │  │
│  │  在 Task() 执行前写入，子进程启动时读取                       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                           ↓                                       │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Layer 3: toolExecuteAfter → Cleanup (自动清理)              │  │
│  │                                                             │  │
│  │  Hook: tool.execute.after                                   │  │
│  │  触发: tool="task" → 子 Agent 已结束                         │  │
│  │  action: fs.unlinkSync("_dispatch_target.json")             │  │
│  │                                                             │  │
│  │  时机: Task() 完成后，子 Agent 已退出，安全删除               │  │
│  │  效果: 每次 dispatch 后文件恢复干净状态                       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                           ↓                                       │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Safety Net: resolveAgent() 跨 Session 过期检查               │  │
│  │                                                             │  │
│  │  位置: resolveAgent() 函数内部                               │  │
│  │  检查: _dispatch_target.json 的 run_id 字段                  │  │
│  │                                                             │  │
│  │  run_id === OPENCODE_RUN_ID → ✅ 有效，使用                   │  │
│  │  run_id !== OPENCODE_RUN_ID → ❌ 过期，unlink + 忽略          │  │
│  │  run_id 缺失（旧版本文件）   → ❌ 同样 unlink + 忽略           │  │
│  │                                                             │  │
│  │  解决: 用户重启间隔 < 5min 时的 stale 文件问题                │  │
│  │        比纯时间戳检查更确定（基于唯一 Session ID）            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  自定义工具 (safe_edit, safe_shell, etc.):                         │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ context.agent (OpenCode 原生) — 在 execute(args, ctx) 中可用 │  │
│  │ 优先级高于任何自建机制，无需 FRAMEWORK_AGENT                  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

---

## 3. resolveAgent() 优先级链路（v4.0.0 目标）

```
resolveAgent():
  ┌──────────────────────────────────────────────────────┐
  │ ① _cachedAgent (模块级缓存)                          │
  │    如果已解析过 → 直接返回                             │
  ├──────────────────────────────────────────────────────┤
  │ ② _dispatch_target.json (条件: _agentResolved=false)  │
  │    仅在新进程首次调用时读取                            │
  │    ├─ run_id 匹配 → 缓存 + 返回                       │
  │    └─ run_id 不匹配/缺失 → unlink + return ""         │
  ├──────────────────────────────────────────────────────┤
  │ ③ process.env.AGENT                                   │
  │    OpenCode 原生 → 通常为 "1" → 返回                   │
  ├──────────────────────────────────────────────────────┤
  │ ④ "" (兜底)                                           │
  └──────────────────────────────────────────────────────┘
         │
         ▼ agent="1" 时的二次查表（仅 toolExecuteBefore）
  ┌──────────────────────────────────────────────────────┐
  │ ⑤ resolveAgentFromSessionMap(sessionID)               │
  │    查 .session_map.json                               │
  │    hit → 返回 agent 名称                               │
  │    miss → 返回 agent (原始值)                          │
  └──────────────────────────────────────────────────────┘
```

---

## 4. 核心代码实现

### 4.1 resolveAgent() — 身份解析引擎（v4.0.0 目标）

**文件**: `.opencode/plugins/framework-enforcer/enforce.ts`

```typescript
let _cachedAgent = ""; // 模块级缓存，替代 FRAMEWORK_AGENT env var

function resolveAgent(): string {
  // ① 已缓存的 agent
  if (_cachedAgent) return _cachedAgent;

  // ② _dispatch_target.json — TASK-IDENTITY 或 dispatch_subagent 写入
  // _agentResolved 确保每个进程只读一次
  if (!_agentResolved) {
    _agentResolved = true;
    try {
      const p = path.join(
        process.env.OPENCODE_ROOT || ".",
        ".task_temp",
        "_dispatch_target.json",
      );
      if (fs.existsSync(p)) {
        const d = JSON.parse(fs.readFileSync(p, "utf8"));
        const currentRunId = process.env.OPENCODE_RUN_ID || "";
        if (currentRunId && (!d.run_id || d.run_id !== currentRunId)) {
          try { fs.unlinkSync(p); } catch {}
          _cachedAgent = process.env.AGENT || "";
          return _cachedAgent;
        }
        if (d.agent) {
          _cachedAgent = d.agent;
          return d.agent;
        }
      }
    } catch {}
  }
  // ③ AGENT env → 通常为 "1"
  _cachedAgent = process.env.AGENT || "";
  return _cachedAgent;
}
```

### 4.2 chatMessageHook — Layer 1 被动收集

**不变**，同 v3.3.1。

### 4.3 TASK-IDENTITY — Layer 2 主动注入

**不变**，同 v3.3.1。

### 4.4 toolExecuteAfter Cleanup — Layer 3 自动清理

**不变**，同 v3.3.1。

### 4.5 Session Map 兜底查询

**不变**，同 v3.3.1。

---

## 5. 各场景 Agent 解析表

| # | 场景 | resolveAgent ①-④ | session map | 最终 agent | 数据来源 |
|---|------|:---:|:---:|------|------|
| 1 | 主 Agent 聊天 | ④ → `""` | ✅ → `Super-Admin` | `Super-Admin` | chat.message 原生 |
| 2 | 主 Agent 调工具 | ④ → `""` | ✅ → `Super-Admin` | `Super-Admin` | L1 兜底 |
| 3 | `dispatch_subagent` 派遣 | ② `@Coder-BE` | 不触发 | `@Coder-BE` | L2 + `_dispatch_target.json` |
| 4 | 直接 `Task()` 派遣 | ② `@explore` | 不触发 | `@explore` | L2 TASK-IDENTITY |
| 5 | 子 Agent 调工具 | ① `_cachedAgent` | 不触发 | `@explore` | 模块缓存 |
| 6 | 子 Agent chat | N/A | N/A | `explore` | chat.message 原生 |
| 7 | 跨 session 残留 | ② unlink → `""` | ✅ → 主Agent | 主Agent | L3 兜底 |
| 8 | 并行派遣 (相同Agent) | 串行写 → 各自正确 | — | 各自正确 | L2 串行安全 |
| 9 | 并行派遣 (不同Agent) | 串行写 → 各自正确 | — | 各自正确 | L2 串行安全 |

---

## 6. 完整数据流

```
┌──────────────────────────────────────────────────────────────────────┐
│ 主 Session (OPENCODE_RUN_ID=R1)                                      │
│                                                                       │
│  ① chat.message                                                     │
│     input.agent = "Super-Admin" → session_map: {S0→"Super-Admin"}   │
│                                                                       │
│  ② Super-Admin → Task(subagent_type="explore", prompt=...)           │
│                                                                       │
│     tool.execute.before (主进程):                                    │
│       resolveAgent() → _cachedAgent="" → _dispatch_target(不存在)     │
│                        → AGENT="1" → session map → "Super-Admin"     │
│       TASK-IDENTITY: 写 _dispatch_target.json                        │
│         { agent:"@explore", run_id:"R1" }                            │
│                                                                       │
│     Task() 执行 → OpenCode 创建子进程                                │
│                                                                       │
│  ═══════════════════════════════════════════════════════════════════ │
│  子 Session (explore, OPENCODE_RUN_ID=R1)                            │
│                                                                       │
│  ③ chat.message                                                     │
│     input.agent = "explore" → session_map: {S1→"explore"}           │
│                                                                       │
│  ④ explore → read(file)                                             │
│     tool.execute.before (子进程):                                    │
│       _agentResolved=false → 读 _dispatch_target.json                │
│       run_id "R1" === OPENCODE_RUN_ID "R1" → ✅ 有效                 │
│       _cachedAgent="@explore" → 返回                                 │
│                                                                       │
│  ⑤ explore 任务完成，子进程退出                                      │
│  ═══════════════════════════════════════════════════════════════════ │
│                                                                       │
│  ⑥ tool.execute.after (主进程):                                     │
│     tool="task" → fs.unlinkSync("_dispatch_target.json") → CLEAN    │
│                                                                       │
│  ⑦ 下次 OpenCode 重启 (OPENCODE_RUN_ID=R2)                          │
│     resolveAgent():                                                  │
│       _dispatch_target.json 存在?                                    │
│       run_id "R1" !== "R2" → ❌ 过期 → unlink                         │
│       _cachedAgent="" → AGENT="1" → session map → "Super-Admin"     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 7. 关键技术约束

| # | 约束 | 来源 | 应对 |
|---|------|------|------|
| 1 | `console.log` 在插件中不可见 | 错题集 §5 | 全部改用 `demoLog()` → 文件日志 |
| 2 | Bun 缓存不自动失效 | 错题集 §3 | 每次修改后更新 `index.ts` VERSION 注释 |
| 3 | 插件只加载 `index.ts` | 错题集 §4 | 所有 Hook 从 `index.ts` 导入 `./enforce` |
| 4 | `tool.execute.before` 无 agent 字段 | 官方类型定义 | 自建文件解析系统 |
| 5 | `Task()` 的 `output.args` 含 `subagent_type` | 错题集 §6 | 可拦截 Task() 调用 |
| 6 | `Task()` 串行执行 | 实测验证 | 无并发竞态 |
| 7 | `AGENT=1` 无身份信息 | agent-identity-plugin-hooks.md | session map 兜底 |
| 8 | `OPENCODE_RUN_ID` 每 session 唯一 | agent-identity-plugin-hooks.md | 跨 session 过期检查 |
| 9 | `context.agent` 在自定义工具中可用 | OpenCode `tools.ts` | 自定义工具无需 FRAMEWORK_AGENT |

---

## 8. 验证记录

### 8.1 单次派遣测试

```
派遣: explore → index.ts version 行
结果: ✅ TASK-IDENTITY wrote → @explore
      ✅ _dispatch_target.json = {"agent":"@explore","run_id":"..."}
      ✅ toolExecuteAfter cleanup → CLEAN
```

### 8.2 三次穿插派遣测试

| Step | Dispatch | TASK-IDENTITY log | File after? | Sub-agent identity |
|:---:|----------|-------------------|:-----------:|:---:|
| 1 | @explore | wrote → @explore | ❌ CLEAN | explore ✅ |
| 2 | @general | wrote → @general | ❌ CLEAN | general ✅ |
| 3 | @explore | wrote → @explore | ❌ CLEAN | explore ✅ |

### 8.3 并行派遣测试

| Test | Agents | Before-hook gap | Result |
|:---:|--------|:---:|:---:|
| 1 | explore × 2 | 1.26s (串行) | ✅ 均正确 |
| 2 | explore + general | 1.28s (串行) | ✅ 均正确 |

**结论**: OpenCode 串行处理 Task() 调用，无并发竞态。

### 8.4 跨 Session 残留清理测试

```
Session 1: _dispatch_target.json = { agent:"@explore", run_id:"R1" }
重启 → Session 2: OPENCODE_RUN_ID=R2
resolveAgent(): run_id "R1" !== "R2" → unlink → CLEAN ✅
```

---

## 9. 待改进项

| # | 问题 | 严重度 | 建议 |
|---|------|:---:|------|
| 1 | `toolExecuteBefore` 中 `agent` 局部变量与 `resolvedAgent` 不一致 | 🟡 | 后续 check 改用 `resolvedAgent` 或 `agent = resolvedAgent` |
| 2 | 如果 OpenCode 未来支持真正并行 Task() | 🟢 | 改用 `_dispatch_target_<callID>.json` |
| 3 | TASK-IDENTITY 日志出现重复写入 | 🟢 | 排查是否 `toolExecuteBefore` 被重复调用 |
| **4** | **废弃 FRAMEWORK_AGENT 环境变量** | **🟡** | **见 §10-12 详细方案** |

---

## 10. FRAMEWORK_AGENT 环境变量调查

### 10.1 写入点（4个）

| # | 文件:行 | 代码 | 触发时机 | 是否恢复 |
|---|---------|------|---------|:---:|
| W1 | `tools/dispatch_subagent.ts:153` | `process.env.FRAMEWORK_AGENT = '@Coder-BE'` | 主 Agent 调用 `dispatch_subagent` MCP 工具 | ❌ **从未恢复** |
| W2 | `scripts/.../dispatch-subagent.ts:102` | `process.env.FRAMEWORK_AGENT = '@Coder-BE'` | `dispatch-subagent.ts` 子脚本执行 (execFileSync) | N/A (进程退出) |
| W3 | `plugins/.../enforce.ts:46` | `process.env.FRAMEWORK_AGENT = d.agent` | `resolveAgent()` 读到有效 `_dispatch_target.json` | N/A (缓存) |
| W4 | `plugins/.../enforce.ts:390` | `process.env.FRAMEWORK_AGENT = resolvedAgent` | session map 从 "1" 解析出真实 agent | ❌ 条件性 |

### 10.2 读取点（按模块分类）

| 类别 | 文件:行 | 当前用法 | 替代方案 |
|------|---------|---------|---------|
| **插件** | `enforce.ts:25` | resolveAgent 第一优先级 | 删除，用 `_cachedAgent` |
| **插件** | `enforce.ts:43,52` | resolveAgent fallback | 删除 |
| **插件** | `enforce.ts:389` | sessionMap 写回 env | 删除，用 `_cachedAgent` |
| **预执行** | `pre-execution-gate.ts:270` | DAG 绕过判断 | 新增 `readDispatchTargetFile()` |
| **预执行** | `pre-execution-gate.ts:657` | UC7KS 绕过审计 | 同上 |
| **预执行** | `pre-execution-gate.ts:721,736` | agent 归属 | 同上 |
| **脚本** | `compliance-gate.ts:816` | UC7-001 合规检查 | `readDispatchTargetFile()` |
| **脚本** | `code-quality-lib.ts:971` | 写审计归属 | `"unknown"` 足矣 |
| **脚本** | `safe-bash-core.ts:479` | allowlist 查询 | `options.agent` 已由调用者传入 |
| **自定义工具** | `safe_edit.ts:22` | `context.agent ?? FRAMEWORK_AGENT` | 改为 `context.agent ?? "unknown"` |
| **自定义工具** | `safe_shell.ts:14` | 同上 | 同上 |
| **自定义工具** | `safe_diff.ts:51` | 同上 | 同上 |
| **自定义工具** | `safe_restore.ts:43` | 同上 | 同上 |
| **自定义工具** | `safe_delete.ts:14` | 同上 | 同上 |
| **自定义工具** | `knowledge_cache_search.ts:13` | `context.agent ?? FRAMEWORK_AGENT` | 同上 |
| **自定义工具** | `module_scope_declare.ts:19` | 同上 | 同上 |

### 10.3 关键发现：W1 的泄漏风险

```
dispatch_subagent.ts (MCP Tool):

  Line 152: const savedTaskId = process.env.FRAMEWORK_TASK_ID
  Line 153: process.env.FRAMEWORK_AGENT = '@Coder-BE'         ← 写入，永不恢复
  Line 155: process.env.FRAMEWORK_TASK_ID = dagTaskId
  ...
  Line 283: execFileSync("bun", ..., { env: {...process.env} })
  ...
  Line 307: if (savedTaskId === undefined) delete process.env.FRAMEWORK_TASK_ID    ← 恢复 ✅
  Line 310: else process.env.FRAMEWORK_TASK_ID = savedTaskId                       ← 恢复 ✅
            ❌ FRAMEWORK_AGENT 从未恢复！
            ❌ FRAMEWORK_DISPATCH_CONTEXT 也从未恢复！
```

**对比**：`FRAMEWORK_TASK_ID` 有完整的 save/restore 机制，但 `FRAMEWORK_AGENT` 写入后从未恢复。虽然实际运行中因进程隔离未观察到泄漏，但这违反了对称性原则。

### 10.4 实际效力分析

```
当前 safe_shell 的 env 快照:
  FRAMEWORK_AGENT        = (空)
  AGENT                  = (空)
  OPENCODE_PROCESS_ROLE  = (空)
```

工具调用在隔离上下文执行，`process.env` 的修改不泄漏到后续调用。**W1 注释中「in parent process so Task() sub-agents inherit it」的意图实际上没有生效**——因为隔离上下文中设置的 env var 无法被子 Agent 继承。真正的子 Agent 身份传递已由 L2 TASK-IDENTITY 机制覆盖。

---

## 11. 废弃 FRAMEWORK_AGENT 可行性分析

### 11.1 三个替代机制

| 替代机制 | 适用场景 | 状态 |
|---------|---------|:---:|
| `_dispatch_target.json` | 子 Agent 身份（所有 dispatch 场景） | ✅ 已实现 |
| `.session_map.json` | 主 Agent 身份（"1" 兜底） | ✅ 已实现 |
| `context.agent` | 自定义工具 agent 归属 | ✅ OpenCode 原生提供 |

### 11.2 影响矩阵

| 场景 | 当前依赖 FRAMEWORK_AGENT | 替代后 | 影响 |
|------|:---:|:---:|:---:|
| 子 Agent resolveAgent | ① env → ② file | ① file | ✅ 等价，env 原本冗余 |
| 主 Agent resolveAgent | ③ AGENT="1" → sessionMap | ③ "1" → sessionMap | ✅ 等价 |
| 自定义工具 agent | context.agent ?? env | context.agent | ✅ 更简洁 |
| pre-exec DAG 绕过 | env var | 读文件 | ⚠️ 需新增函数 |
| dispatch 写入 | env var 设置 | 文件写入已存在 | ✅ 无需额外操作 |
| audit log 归属 | env or "" | 读文件 or "unknown" | ✅ 可接受 |

### 11.3 结论

| 维度 | 评估 |
|------|:---:|
| 完全替代可行性 | ✅ **可行** |
| 最大改动点 | `pre-execution-gate.ts` 需新增 `readDispatchTargetFile()` (~10行) |
| 最大收益 | 消除 W1 泄漏风险 + 删除冗余 env var + 简化 resolveAgent |
| 风险 | `pre-execution-gate.ts` 读文件引入 I/O，与纯 env var 相比有微小延迟 |

---

## 12. 实施方案：废弃 FRAMEWORK_AGENT

### Step 1: enforce.ts — 用 _cachedAgent 替代 FRAMEWORK_AGENT

**文件**: `.opencode/plugins/framework-enforcer/enforce.ts`

```diff
+ let _cachedAgent = ""; // 模块级缓存，替代 FRAMEWORK_AGENT env var

  function resolveAgent(): string {
-   if (process.env.FRAMEWORK_AGENT) return process.env.FRAMEWORK_AGENT;
+   if (_cachedAgent) return _cachedAgent;
    if (!_agentResolved) {
      _agentResolved = true;
      try {
        const p = path.join(...);
        if (fs.existsSync(p)) {
          const d = JSON.parse(fs.readFileSync(p, "utf8"));
          const currentRunId = process.env.OPENCODE_RUN_ID || "";
          if (currentRunId && (!d.run_id || d.run_id !== currentRunId)) {
            try { fs.unlinkSync(p); } catch {}
-           return process.env.FRAMEWORK_AGENT || process.env.AGENT || "";
+           _cachedAgent = process.env.AGENT || "";
+           return _cachedAgent;
          }
          if (d.agent) {
-           process.env.FRAMEWORK_AGENT = d.agent;
+           _cachedAgent = d.agent;
            return d.agent;
          }
        }
      } catch {}
    }
-   return process.env.FRAMEWORK_AGENT || process.env.AGENT || "";
+   _cachedAgent = process.env.AGENT || "";
+   return _cachedAgent;
  }
```

并在 `toolExecuteBefore` 中删除 session map 写回 env：

```diff
    if (resolvedAgent !== agent) {
      demoLog("INFO", `...`);
-     if (resolvedAgent === "@Super-Admin" || resolvedAgent === "Super-Admin") {
-       const original = process.env.FRAMEWORK_AGENT;
-       process.env.FRAMEWORK_AGENT = resolvedAgent;
-     }
    }
```

### Step 2: dispatch_subagent.ts — 删除 FRAMEWORK_AGENT 写入

**文件**: `.opencode/tools/dispatch_subagent.ts`

```diff
    const savedTaskId = process.env.FRAMEWORK_TASK_ID
-   process.env.FRAMEWORK_AGENT = args.agent_type.startsWith('@') ? args.agent_type : '@' + args.agent_type
    process.env.FRAMEWORK_DISPATCH_CONTEXT = "orchestrated"
    if (args.dag_task_id) process.env.FRAMEWORK_TASK_ID = args.dag_task_id
```

> `_dispatch_target.json` 由 `dispatch-subagent.ts:118-129` 写入，已覆盖身份传递。

### Step 3: dispatch-subagent.ts — 删除 FRAMEWORK_AGENT 写入

**文件**: `.opencode/scripts/command-tools/dispatch-subagent.ts`

```diff
    process.env.FRAMEWORK_TASK_ID = taskId || "";
    process.env.FRAMEWORK_DISPATCH_CONTEXT = "orchestrated";
    const agentType = process.argv[2];
-   process.env.FRAMEWORK_AGENT = '@' + agentType;
```

> `_dispatch_target.json` 由 `dispatch-subagent.ts:118-129` 写入。

### Step 4: pre-execution-gate.ts — 新增 readDispatchTargetFile()

**文件**: `.opencode/scripts/pre-execution-gate.ts`

添加辅助函数：

```typescript
function readDispatchTargetAgent(): string {
  try {
    const p = path.join(
      process.env.OPENCODE_ROOT || ".",
      ".task_temp",
      "_dispatch_target.json",
    );
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      const currentRunId = process.env.OPENCODE_RUN_ID || "";
      if (currentRunId && (!d.run_id || d.run_id !== currentRunId)) {
        try { fs.unlinkSync(p); } catch {}
        return "";
      }
      return d.agent || "";
    }
  } catch {}
  return "";
}
```

替换 4 处读取：

```diff
- const agent = process.env.FRAMEWORK_AGENT || "";
+ const agent = readDispatchTargetAgent() || process.env.AGENT || "";
```

具体行数：`270`, `657`, `721`, `736`

### Step 5: 自定义工具 — 删除 FRAMEWORK_AGENT fallback

**文件**: `safe_edit.ts`, `safe_shell.ts`, `safe_diff.ts`, `safe_restore.ts`, `safe_delete.ts`

```diff
- const agent = context.agent ?? process.env.FRAMEWORK_AGENT ?? "unknown"
+ const agent = context.agent ?? "unknown"
```

**文件**: `knowledge_cache_search.ts`, `module_scope_declare.ts`

```diff
- var agent = (context && context.agent) || process.env.FRAMEWORK_AGENT || "unknown"
+ var agent = (context && context.agent) || "unknown"
```

### Step 6: compliance-gate.ts / code-quality-lib.ts / safe-bash-core.ts

```diff
- const currentAgent = process.env.FRAMEWORK_AGENT || "";
+ const currentAgent = readDispatchTargetAgent() || "";
```

或使用 `"unknown"` 兜底（这些文件中的 agent 仅用于审计日志）。

### Step 7: index.ts — 强制 Bun 缓存刷新

```diff
- // VERSION: 3.3.1-demo — ...
+ // VERSION: 4.0.0-draft — deprecated FRAMEWORK_AGENT
```

### 修改文件清单

| # | 文件 | 改动类型 | 行数 |
|---|------|---------|:---:|
| 1 | `enforce.ts` | 用 `_cachedAgent` 替代 FRAMEWORK_AGENT | ~8 |
| 2 | `dispatch_subagent.ts` | 删除 env var 写入 | ~2 |
| 3 | `dispatch-subagent.ts` | 删除 env var 写入 | ~1 |
| 4 | `pre-execution-gate.ts` | 新增 `readDispatchTargetFile()` + 替换 4 处 | ~20 |
| 5 | `safe_edit.ts` | 删除 FRAMEWORK_AGENT fallback | ~1 |
| 6 | `safe_shell.ts` | 同上 | ~1 |
| 7 | `safe_diff.ts` | 同上 | ~1 |
| 8 | `safe_restore.ts` | 同上 | ~1 |
| 9 | `safe_delete.ts` | 同上 | ~1 |
| 10 | `knowledge_cache_search.ts` | 同上 | ~1 |
| 11 | `module_scope_declare.ts` | 同上 | ~1 |
| 12 | `compliance-gate.ts` | 替换为 `readDispatchTargetFile()` | ~2 |
| 13 | `code-quality-lib.ts` | 改为 `"unknown"` 兜底 | ~1 |
| 14 | `safe-bash-core.ts` | 已是 `options.agent` 优先，删除 env fallback | ~1 |
| 15 | `index.ts` | 版本升至 4.0.0-draft | ~1 |

**合计: 15 个文件，~45 行改动。**

---

## 相关文件

| 文件 | 作用 |
|------|------|
| `.opencode/plugins/framework-enforcer/enforce.ts` | resolveAgent, chatMessageHook, TASK-IDENTITY, toolExecuteAfter cleanup |
| `.opencode/plugins/framework-enforcer/index.ts` | 插件入口 |
| `.opencode/tools/dispatch_subagent.ts` | dispatch_subagent MCP 工具 |
| `.opencode/scripts/command-tools/dispatch-subagent.ts` | dispatch 子脚本 |
| `.opencode/scripts/pre-execution-gate.ts` | 预执行门禁 |
| `.opencode/tools/safe_edit.ts` | safe_edit 自定义工具 |
| `.opencode/tools/safe_shell.ts` | safe_shell 自定义工具 |
| `.task_temp/_dispatch/.session_map.json` | Session → Agent 映射 |
| `.task_temp/_dispatch_target.json` | 临时 dispatch 目标 |
| `docs/official_docs/opencode/source-analysis/agent-identity-plugin-hooks.md` | OpenCode 插件 hook agent 传递分析 |
| `docs/official_docs/framework/plugin-debugging-precautions.md` | 错题集 — 插件调试防坑指南 |
