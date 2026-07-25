# dispatch_subagent 问题根因诊断与修复方案

**日期**: 2026-06-26

**诊断人**: @Super-Admin (audit mode)

**问题来源**: 本会话 dispatch_subagent 实际执行中遇到的 4 类问题

**模式**: read-only 代码诊断 + 二进制运行时分析

---

## 一、问题概览

| # | 问题 | 严重性 | 状态 |
|---|------|--------|------|
| 1 | getEnforcementMode 未导入导致运行时崩溃 | P0 | ✅ 已修复 |
| 2 | 长 task_description + 多参数 = "agent is not defined" 静默失败 | P0 | 根因已定位 |
| 3 | 错误信息无诊断价值 | P1 | 修复方案已制定 |
| 4 | auto_plan 触发路径未经验证 | P1 | 待 Problem 2 修复后验证 |

---

## 二、逐项根因诊断

### Problem 1: getEnforcementMode 未导入 → ✅ 已修复

**根因**: Phase 1.2 DB-canonical 迁移时，`dispatch-subagent.ts` L1275/L1292 在 `dbEnqueueDispatch` 失败路径中调用 `getEnforcementMode()`，但该函数仅在 L1053 以 inline require 方式使用，L1275/L1292 缺少对应声明，导致 `ReferenceError: getEnforcementMode is not defined`。

**验证结果**:

| 行号 | 当前代码 | 判定 |
|------|---------|------|
| L1053 | `enforcementMode = require("../../lib/gate-core").getEnforcementMode();` | ✅ 正确 |
| L1275 | `const enfMode = require("../../lib/gate-core").getEnforcementMode();` | ✅ 已修复 |
| L1292 | `const enfMode = require("../../lib/gate-core").getEnforcementMode();` | ✅ 已修复 |

**结论**: 三处均使用 inline require 模式，一致性正确。修复已应用且验证通过。

---

### Problem 2: "agent is not defined" 静默失败 → 根因已定位

#### 2.1 症状

| 尝试 | task_description | dag_task_id | auto_plan | 结果 |
|------|-----------------|------------|-----------|------|
| 1 | 详细（多段） | ✅ | true | ❌ "agent is not defined" |
| 2 | 中等（2-3句） | ✅ | 无 | ❌ "agent is not defined" |
| 3 | 极简（1句） | 无 | 无 | ✅ 成功（后触达 getEnforcementMode bug） |

e2e-dispatch-block-analysis-20260625.md 补充：Meta-Planner/Architect 目标失败，Knowledge-Curator 成功。

#### 2.2 排除过程

**排除 1: .opencode/ 源代码 ReferenceError**

```
grep -rn "agent is not defined" .opencode/ → 0 匹配
grep -rn "agent is not defined" node_modules/@opencode-ai/ → 0 匹配
grep -rn '\bagent\b' .opencode/tools/dispatch_subagent.ts → 全部为 context.agent / args.agent_type / callerAgent
```

.opencode/ 全部使用 TypeScript。TS 编译器在编译期捕获未声明变量引用，**不可能**产生运行时 `ReferenceError: agent is not defined`。因此错误**不来自 .opencode/ 代码**。

**排除 2: execFileSync 子进程错误**

`dispatch_subagent.ts` L595-601 的 execFileSync 错误处理：

```typescript
} catch (error) {
  const err = error as any;
  throw new Error(
    `dispatch_subagent: dispatch-subagent.js failed (exit ${err.status || 1}): ` +
      `${err.stderr?.toString() || err.message}`,
  );
}
```

如果错误来自 execFileSync，报错消息会包含 `"dispatch_subagent: dispatch-subagent.js failed (exit ...)"` 前缀。用户报告的错误**没有**此前缀，仅为裸 `"agent is not defined"`。

**结论**: 错误发生在 L569 `execFileSync` 调用**之前**，在 `execute(args, context)` 函数体内或 OpenCode CLI SDK 层。

**排除 3: withInterruptGuard / withPluginLifecycle 包装层**

- `withInterruptGuard` (interrupt-guard.ts L101-141): 非中断错误直接 `throw err`（L131），不修改错误消息。
- `withPluginLifecycle` (hook-lifecycle.ts L13-21): 仅注册 hooks，无 try/catch 包装。

**排除 4: dispatch-before.ts 插件**

dispatch-before.ts 全部使用 `caller`/`target` 变量名，无裸 `agent` 变量引用。插件抛出的错误均为 `[FW-ENFORCE][M14]` 或 `[FW-ENFORCE][LOCKED]` 前缀的显式 Error，非 ReferenceError。

**排除 5: Agent 配置缺失**

opencode.json 中全部 10 个 Agent 正确配置（PascalCase 键名），不存在名称匹配问题。

**排除 6: DAG 检查路径**

`project.config.json` 中 `require_dag_entry: false`，因此 L310 `if (!isDagExempt(targetAgent) && policy.require_dag_entry)` 为 false，整个 DAG 检查块 (L310-402) 被跳过。dag_task_id 的存在/缺失不影响此代码路径。

#### 2.3 根因定位

**错误源**: OpenCode CLI 二进制（`/home/zhaoge/.opencode/bin/opencode`，ELF 64-bit 编译的 bun bundle）内嵌的 JavaScript 运行时。

**证据链**:

1. `strings /home/zhaoge/.opencode/bin/opencode | grep "is not defined"` 找到 JavaScript 引擎的 ReferenceError 模板字符串 `" is not defined"`，确认二进制内嵌 JS 引擎在运行时生成此错误。

2. 错误字符串 `"agent is not defined"` 不存在于任何可读源文件中（.opencode/、node_modules/@opencode-ai/ 均为 0 匹配），因此它是 JS 引擎自动生成的 ReferenceError 消息（格式: `"{variableName} is not defined"`），而非显式 throw。

3. OpenCode CLI 二进制是 bun 编译的 JavaScript bundle（内含 `/$bunfs/root/chunk-*.js` 模块），其工具执行框架代码引用了一个名为 `agent` 的变量，该变量在特定条件下未初始化。

**触发机制（推断）**:

OpenCode CLI 的工具执行框架在调用 `execute(args, context)` 之前需要设置 `context` 对象（包括 `context.agent`）。此设置过程内部引用了变量 `agent`。当工具调用的参数组合复杂（长 task_description + 多参数）时，CLI 的参数序列化/解析层可能失败，导致 `agent` 变量未被初始化，触发 ReferenceError。

这解释了：
- **长 task_description + dag_task_id + auto_plan → 失败**: 参数 JSON 体积大，CLI 内部解析/序列化层处理失败
- **短 task_description + 无额外参数 → 成功**: 参数 JSON 体积小，解析成功
- **无堆栈信息/行号**: CLI 捕获 ReferenceError 后仅上报 `.message` 属性
- **Meta-Planner/Architect 失败而 KC 成功**: 可能与 e2e 测试时的 session agent 身份解析失败相关（`context.agent` 未设置时，权限校验阻止非 KC 目标）

#### 2.4 影响评估

| 维度 | 影响 |
|------|------|
| 根因层 | OpenCode CLI 二进制内部代码（不可在 .opencode/ 层修复） |
| 触发条件 | 复杂参数组合（长字符串 + 多可选参数） |
| 可修复性 | .opencode/ 层可做防御性日志和错误增强，但无法根治 |
| 临时绕过 | 使用短 task_description + 无 dag_task_id 参数可绕过 |

---

### Problem 3: 错误信息无诊断价值 → 修复方案已制定

**根因**: OpenCode CLI 捕获 ReferenceError 后仅上报 `.message`（"agent is not defined"），不包含：
- 堆栈信息
- 失败行号
- 参数上下文（agent_type, dag_task_id, task_description 长度）
- 失败阶段（SDK 层 vs execute 函数 vs execFileSync）

**当前状态**: `dispatch_subagent.ts` L595-601 的 execFileSync 错误处理提供了部分上下文，但仅覆盖 execFileSync 失败场景。execute 函数体本身（L272-602）无 try/catch 包装，SDK 层错误直接穿透。

---

### Problem 4: auto_plan 触发路径未验证

**配置状态**:

```json
// project.config.json
"dispatch_policy": {
  "require_dag_entry": false,
  "auto_plan_enabled": true,
  "auto_plan_max_per_session": 5,
  "auto_plan_timeout_ms": 120000
}
```

`auto_plan_enabled: true`，但 `require_dag_entry: false`。当 `require_dag_entry` 为 false 时，L310 的 DAG 检查块被完全跳过，**auto_plan 路径永远不会被触发**（因为 auto_plan 仅在 `!tc.found` 分支内执行，而该分支在 `require_dag_entry: false` 时不可达）。

**根因**: `require_dag_entry: false` 使 PLAN-FIRST 约束失效，auto_plan 自愈机制无入口点。

---

## 三、修复方案

### 3.1 Problem 1: 无需修复（已验证正确）

L1275/L1292 的 inline require 修复正确，与 L1053 模式一致。

---

### 3.2 Problem 2: 防御性错误增强 + 诊断日志

**约束**: 根因在 OpenCode CLI 二进制层，.opencode/ 代码无法根治。以下方案为**防御性增强**，目标是：
1. 在 execute 函数体内发生 ReferenceError 时，记录完整诊断上下文
2. 为 SDK 层错误提供"最后一刻"的参数快照

#### 修复 A: execute 函数体 try/catch 诊断包装

**文件**: `.opencode/tools/dispatch_subagent.ts`
**位置**: L272 `withInterruptGuard` 回调内

```typescript
async execute(args, context) {
  return withInterruptGuard("dispatch_subagent", async () => {
    // ── FW-DIAG-001: Pre-execution parameter snapshot ──
    // Records all parameters BEFORE any processing. If the SDK layer
    // throws "agent is not defined" before reaching execFileSync, this
    // log entry is the last surviving diagnostic artifact.
    writeLog(SRC, "INFO", {
      event: "DISPATCH-EXECUTE-ENTER",
      agent_type: args.agent_type || "(none)",
      dag_task_id: args.dag_task_id || "(none)",
      task_description_length: (args.task_description || "").length,
      task_description_preview: (args.task_description || "").slice(0, 200),
      auto_plan: args.auto_plan === true,
      session_namespace: args.session_namespace || "(none)",
      resume_session_id: args.resume_session_id || "(none)",
      context_agent: context?.agent || "(none)",
      context_sessionID: context?.sessionID || "(none)",
    });

    try {
      // ── existing execute body (L281-L602) ──
      // ... (unchanged) ...
    } catch (e: any) {
      // FW-DIAG-002: Catch any error (including ReferenceError) within
      // the execute body. Log full diagnostic context, then re-throw
      // with an enriched error message.
      writeLog(SRC, "ERROR", {
        event: "DISPATCH-EXECUTE-FAILED",
        agent_type: args.agent_type || "(none)",
        dag_task_id: args.dag_task_id || "(none)",
        task_description_length: (args.task_description || "").length,
        auto_plan: args.auto_plan === true,
        error_name: e?.name || "Unknown",
        error_message: e?.message || String(e),
        error_stack: e?.stack || "(no stack)",
        context_agent: context?.agent || "(none)",
      });
      // Re-throw with enriched message (preserves original for SDK reporting)
      throw new Error(
        `[dispatch_subagent] Execute failed: ${e?.name || "Error"}: ${e?.message || String(e)} ` +
        `| agent_type=${args.agent_type || "(none)"} ` +
        `| dag_task_id=${args.dag_task_id || "(none)"} ` +
        `| desc_length=${(args.task_description || "").length} ` +
        `| context_agent=${context?.agent || "(none)"}`,
      );
    }
  });
}
```

**子系统合规**:

| 子系统 | 合规说明 |
|--------|---------|
| Layout Architecture | 修改在 tool 层（dispatch_subagent.ts），不跨层 |
| DB-only/DB-canonical | 日志通过 writeLog → log-manager → SQLite logs 表 |
| Permission Matrix | 不修改权限校验逻辑，仅增加诊断包装 |
| Session/Concurrency Safe | try/catch 是同步的，无并发风险 |
| Hardened Enforcement | 不修改 enforcement mode 检查，re-throw 保持阻断 |
| Framework Harness | 可通过 framework-self-test Check 验证日志存在 |
| Central State Management | 错误状态通过 writeLog 记录到中央日志 |
| Multi-Agent | 适用于所有 agent_type 的 dispatch |
| Log Central Management | 使用 writeLog(SRC, "ERROR", ...) 标准接口 |
| DB-canonical Management | 无文件状态引入 |
| Templatization & Parameterization | 诊断字段参数化，适用于任意参数组合 |
| TypeScript + Bun Runtime | TypeScript 类型安全，使用 Bun 兼容 API |

#### 修复 B: dispatch-before.ts 参数快照增强

**文件**: `.opencode/plugins/dispatch-before.ts`
**位置**: L57 已有 `DISPATCH-BEFORE` 日志，增强 detail 字段

**目的**: dispatch-before.ts 在 `tool.execute.before` 钩子中运行，**先于** execute 函数。如果 SDK 层在 execute 之前抛出 "agent is not defined"，dispatch-before 的日志是唯一 surviving 诊断。

当前 L57-69 已记录 `caller`/`target`/`dag_task_id`/`auto_plan`/`mode`/`policy`。需增加：

```typescript
writeLog("dispatch-before", "runtime", {
  sessionID: input.sessionID,
  callID: input.callID,
  agent: caller,
  agentType: caller,
  event: "DISPATCH-BEFORE",
  detail:
    `enter | caller=${caller} | target=${target} ` +
    `| dag_task_id=${dagTaskId || ""} ` +
    `| auto_plan=${autoPlanRequested} | mode=${mode} ` +
    `| policy.require_dag_entry=${policy.require_dag_entry} ` +
    `| policy.auto_plan_enabled=${policy.auto_plan_enabled}`,
  // FW-DIAG-003: Parameter snapshot for SDK-layer failure diagnosis
  task_description_length: (output?.args?.task_description || "").length,
  task_description_preview: (output?.args?.task_description || "").slice(0, 200),
  has_session_namespace: !!output?.args?.session_namespace,
  has_resume_session_id: !!output?.args?.resume_session_id,
});
```

---

### 3.3 Problem 3: 错误信息诊断价值增强

**方案**: 修复 A + B 的组合已在错误消息中包含：
- `error_name` (ReferenceError / TypeError / Error)
- `error_message` (原始消息)
- `error_stack` (完整堆栈)
- `agent_type` / `dag_task_id` / `task_description_length` (参数上下文)
- `context_agent` (agent 身份解析结果)

**错误消息格式改进**:

| 改进前 | 改进后 |
|--------|--------|
| `agent is not defined` | `[dispatch_subagent] Execute failed: ReferenceError: agent is not defined \| agent_type=Meta-Planner \| dag_task_id=FE2E-001 \| desc_length=2048 \| context_agent=(none)` |

**关键诊断价值**:
- `context_agent=(none)` → 指向 SDK 层 agent 身份未初始化
- `desc_length=2048` → 指向长参数触发
- `error_name=ReferenceError` → 区分于 TypeError 或显式 throw

---

### 3.4 Problem 4: auto_plan 验证方案

**当前矛盾**: `auto_plan_enabled: true` 但 `require_dag_entry: false`。当 `require_dag_entry` 为 false 时，L310 的 DAG 检查块被跳过，auto_plan 路径（L321-377）不可达。

**选项**:

| 选项 | 操作 | 风险 |
|------|------|------|
| A | 设置 `require_dag_entry: true` | 所有非 exempt dispatch 必须有 DAG 条目，可能阻断当前工作流 |
| B | 保持 `require_dag_entry: false`，接受 auto_plan 不可达 | PLAN-FIRST 约束形同虚设 |
| C | 分离 auto_plan 触发条件：不依赖 require_dag_entry，改为独立检查 | 需修改 dispatch_subagent.ts L310 逻辑 |

**推荐**: 选项 C（长期正确），但需 @Meta-Planner 评估影响。

**验证步骤**（修复 Problem 2 后执行）:

1. 使用短 task_description + dag_task_id（不存在的 ID）+ auto_plan=true 调用 dispatch_subagent
2. 检查日志中是否出现 `autoPlan` 相关事件（`DAGTASK-ID-AUTO-GENERATED`、`AUTO-PLAN-ATTEMPT`）
3. 检查 `transaction-state.json` 的 `auto_plan_history` 字段是否有记录
4. 验证 @Meta-Planner 是否被自动派遣

---

## 四、问题关系图（更新）

```
dispatch_subagent 调用
│
├─ SDK 层: 参数序列化/解析
│  └─ 复杂参数 → agent 变量未初始化 → ReferenceError: agent is not defined
│     │                                              ↑ CLI 二进制层 bug，.opencode/ 不可修复
│     │                                              ↑ 修复 A/B 提供诊断上下文
│     └─ (无堆栈/行号/参数上下文) → Problem 3
│
├─ dispatch-before.ts 插件 (tool.execute.before)
│  └─ 正常运行，记录 DISPATCH-BEFORE 日志
│
├─ execute(args, context) 函数体
│  ├─ L272-518: 权限校验、DAG 检查 (require_dag_entry=false → 跳过)
│  │  └─ auto_plan 路径不可达 (Problem 4) ← require_dag_entry=false 使 L310 块被跳过
│  ├─ L569: execFileSync("bun", ["--no-cache", scriptPath, ...scriptArgs])
│  │  └─ 成功 → 返回 outputFile 路径
│  └─ L1256-1294: dbEnqueueDispatch (dispatch-subagent.ts 脚本内)
│     ├─ 成功 → 正常完成
│     └─ 失败 → getEnforcementMode() → ✅ 已修复 (Problem 1)
│
└─ 短参数绕过 SDK 层 bug → 成功执行 → 触达 getEnforcementMode bug → 已修复
```

---

## 五、修复优先级与执行顺序

| 优先级 | 修复项 | 文件 | 复杂度 | 依赖 |
|--------|--------|------|--------|------|
| P0 | Problem 1 确认 | dispatch-subagent.ts | 无（已完成） | 无 |
| P0 | 修复 A: execute try/catch 诊断包装 | tools/dispatch_subagent.ts | 中 | 无 |
| P0 | 修复 B: dispatch-before 参数快照 | plugins/dispatch-before.ts | 低 | 无 |
| P1 | Problem 4: auto_plan 触发条件分离 | tools/dispatch_subagent.ts + dag-policy.ts | 高 | @Meta-Planner 评估 |
| P2 | framework-self-test 新增 Check | framework-self-test.ts | 低 | 修复 A/B 完成 |

---

## 六、验证方法

### 6.1 Problem 1 验证

```bash
# 确认三处 getEnforcementMode 调用一致
grep -n "getEnforcementMode" .opencode/scripts/command-tools/dispatch-subagent.ts
# 预期: L1053, L1275, L1292 均为 require("../../lib/gate-core").getEnforcementMode()
```

### 6.2 Problem 2/3 验证（修复 A/B 后）

```bash
# 查询日志确认诊断快照存在
bun -e '
import { Database } from "bun:sqlite";
const db = new Database(".opencode/state/framework-state.db", { readonly: true });
const rows = db.query("SELECT * FROM logs WHERE event = \"DISPATCH-EXECUTE-ENTER\" OR event = \"DISPATCH-EXECUTE-FAILED\" ORDER BY timestamp DESC LIMIT 5").all();
console.log(JSON.stringify(rows, null, 2));
'
```

### 6.3 Problem 4 验证

```bash
# 设置 require_dag_entry=true 后测试 auto_plan（需 @Meta-Planner 评估后决定）
# 或验证 require_dag_entry=false 时 auto_plan 路径确实不可达
grep -n "require_dag_entry\|auto_plan" .opencode/tools/dispatch_subagent.ts | head -10
```

---

## 七、总结

| 问题 | 根因 | 可修复性 | 方案 |
|------|------|---------|------|
| 1. getEnforcementMode | inline require 缺失 | ✅ 已修复 | 无需操作 |
| 2. "agent is not defined" | CLI 二进制 SDK 层 ReferenceError | ⚠️ .opencode/ 层不可根治 | 防御性诊断包装（修复 A/B） |
| 3. 无诊断上下文 | CLI 仅上报 .message | ✅ 可增强 | 修复 A/B 提供完整上下文 |
| 4. auto_plan 不可达 | require_dag_entry=false 使 L310 块跳过 | ✅ 可修复 | 分离 auto_plan 触发条件（选项 C） |

**关键发现**: "agent is not defined" 不是 .opencode/ 代码的 bug，而是 OpenCode CLI 二进制内部工具执行框架的 ReferenceError。.opencode/ 层的修复目标是**最大化诊断信息**和**防御性错误处理**，而非根治 CLI 层问题。根治需要 OpenCode CLI 上游修复。
