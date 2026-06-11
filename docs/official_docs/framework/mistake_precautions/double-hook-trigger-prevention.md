# OpenCode 双 Hook 触发防坑指南

**日期**: 2026-06-09
**适用范围**: OpenCode 框架插件开发、hook 链式触发调试、多插件共存场景
**来源**: framework-enforcer + uc7ks-enforcer 双插件共存导致 hook 重复触发的 P0 故障排查
**关联文件**: `plugin-debugging-precautions.md`（同一目录）

---

## 目录

1. [问题定义：什么是双 Hook 触发](#1-问题定义什么是双-hook-触发)
2. [表现形式](#2-表现形式)
3. [根因分析](#3-根因分析)
4. [修复方案：合并插件](#4-修复方案合并插件)
5. [防御性编程：Hook ID 去重](#5-防御性编程hook-id-去重)
6. [诊断策略](#6-诊断策略)
7. [排查清单](#7-排查清单)

---

## 1. 问题定义：什么是双 Hook 触发

### 核心问题

当 OpenCode 中注册了 **两个及以上具有不同 ID 的插件**，且它们注册了 **相同的 hook 事件**（如 `tool.execute.before` 和 `tool.execute.after`）时，每个工具调用都会触发 **所有插件中匹配的 hook**——导致 hook 函数被重复执行。

### 简单类比

```
工具调用 "safe_edit"
  ↓
plugin.trigger("tool.execute.before")
  ├── Plugin A (ID: "framework-enforcer")  →  executes hook ✅
  ├── Plugin B (ID: "uc7ks-enforcer")      →  executes hook ✅  ← 重复！
  └── ...
  ↓
工具执行
  ↓
plugin.trigger("tool.execute.after")
  ├── Plugin A (ID: "framework-enforcer")  →  executes hook ✅
  ├── Plugin B (ID: "uc7ks-enforcer")      →  executes hook ✅  ← 重复！
  └── ...
```

### 为什么是陷阱

开发者直觉上可能认为"后注册的插件覆盖前面的"（last-writer-wins），但 OpenCode 的行为是 **链式调用（chaining）**——所有不同 ID 的插件都会触发。

---

## 2. 表现形式

### 2.1 管控规则重复执行

```typescript
// 每次工具调用，以下检查被执行两次
'tool.execute.before': async (input, output) => {
  // ① write-scope 检查 —— 第一次执行
  checkWriteScope(input.tool, output.args);
  // ② TDD 合规检查 —— 第一次执行
  checkTddCompliance(input.tool, output.args);
  // ③ UC7KS 缓存检查 —— 第一次执行

  // → 第二次执行（相同逻辑，来自第二个插件）←
}
```

### 2.2 可观测的症状

| 症状 | 严重程度 | 说明 |
|------|----------|------|
| **日志重复** | 🟡 中 | 每条 `[FW-ENFORCE]` 日志出现两次 |
| **性能下降** | 🟡 中 | 每次工具调用 hook 处理时间翻倍 |
| **写入审计重复计数** | 🔴 高 | `write_audit_state.count` 被重复累加 |
| **副作用冲突** | 🔴 高 | 第一个 hook 修改了 output.args，第二个 hook 基于修改后的值再次判断 |
| **竞态条件** | 🔴 高 | 两个 hook 同时操作同一状态，导致数据不一致 |

### 2.3 实际案例（本项目 P0 故障）

在 **FW-MERGE-UC7KS** 修复之前，项目同时存在两个插件：

```
.opencode/plugins/
├── framework-enforcer/      # ID: "framework-enforcer"
│   └── index.ts             # 注册 tool.execute.before + after
└── uc7ks-enforcer/          # ID: "uc7ks-enforcer"
    └── index.ts             # 注册 tool.execute.before + after
```

结果：每次工具调用，**两个插件的 hook 都触发**，导致：
- `write_audit_state` 计数翻倍
- UC7KS 缓存检查执行两次
- machine.json 状态更新被重复写入

---

## 3. 根因分析

### 3.1 上游源码分析

OpenCode 的 hook 触发机制在 `packages/core/src/plugin.ts` 的 `triggerFor` 方法中：

```typescript
// packages/core/src/plugin.ts (upstream OpenCode)
triggerFor: Effect.fn("Plugin.triggerFor")(function* (id, name, input, output) {
    for (const item of hooks) {                    // ← 遍历所有已注册插件
      if (id !== ID.make("*") && item.id !== id) continue
      const match = item.hooks[name]               // ← 按 hook 名称匹配
      if (!match) continue                         // ← 跳过未注册该 hook 的插件
      yield* match(event as any).pipe(...)          // ← 执行匹配的 hook
    }
}),
```

**关键行为**：
- `hooks` 数组存储了所有注册的插件（不同 ID = 不同条目）
- `ID.make("*")` 时匹配所有插件
- 对每个匹配的插件，**逐个调用**其 hook 函数
- 不同 ID 的插件 → **链式调用**（非覆盖）

### 3.2 插件注册机制

```typescript
// plugin.ts - add 方法
const existing = hooks.find((item) => item.id === input.id)
if (existing) yield* Scope.close(existing.scope, Exit.void)
// 仅当 ID 相同才替换
hooks = [...hooks.filter((item) => item.id !== input.id), newEntry]
```

**关键结论**：
- **相同 ID** → 后注册的替换先注册的（last-writer-wins）
- **不同 ID** → 都保留（chaining）

### 3.3 触发路径

从 `packages/opencode/src/session/tools.ts` 可以看到，每次工具调用的触发路径：

```typescript
// Built-in tools 与 MCP tools 均使用相同的触发模式
yield* plugin.trigger("tool.execute.before", { tool, sessionID, callID }, { args })
// ...
yield* plugin.trigger("tool.execute.after", { tool, sessionID, callID, args }, output)
```

每次 `trigger()` 调用 → 内部调用 `triggerFor("*", ...)` → 遍历所有插件 → 执行所有匹配的 hook。

---

## 4. 修复方案：合并插件

### 4.1 统一入口设计

**核心原则**：整个项目中**只保留一个插件入口**，所有 hook 逻辑合并到该插件中：

```
.opencode/plugins/
└── framework-enforcer/          # ✅ 单一插件，唯一 ID
    ├── index.ts                 # 入口：注册所有 hook
    ├── hooks/
    │   ├── tool-execute.ts      # tool.execute.before + after
    │   └── shell-env.ts         # shell.env hook
    └── enforcers/
        ├── uc7ks-enforcer.ts    # UC7KS 规则（内部模块）
        ├── framework-enforcer.ts # 框架规则（内部模块）
        └── write-scope.ts       # 写入范围检查
```

### 4.2 合并后的入口文件

```typescript
// .opencode/plugins/framework-enforcer/index.ts
// ✅ 正确：单一入口，所有 hook 合并到一个插件中

import { buildBeforeHooks } from './enforcers/uc7ks-enforcer';
import { buildFrameworkHooks } from './enforcers/framework-enforcer';

export const FrameworkEnforcer = async (ctx) => {
  // 在单一插件内部显式编排 hook 执行顺序
  return {
    'tool.execute.before': async (input, output) => {
      // 先执行 UC7KS 规则
      await buildBeforeHooks(input, output);
      // 再执行框架规则
      await buildFrameworkHooks(input, output);
    },
    'tool.execute.after': async (input, output) => {
      await buildAfterHooks(input, output);
    },
  };
};
```

### 4.3 opencode.json 配置

```json
{
  "plugins": [
    ".opencode/plugins/framework-enforcer"    // ✅ 只保留一个插件
  ]
}
```

### 4.4 验证单插件完整性

```bash
# 检查是否有多个插件被注册
grep -n '"plugins"' opencode.json -A 10

# 确保 plugins 数组只有一个条目
# 如果发现多个条目，必须合并
```

---

## 5. 防御性编程：Hook ID 去重

### 5.1 运行时检查

在 hook 函数内部添加去重判断，防止意外重复触发：

```typescript
const executedHooks = new Set<string>();

'tool.execute.before': async (input, output) => {
  const hookKey = `${input.sessionID}:${input.callID}:before`;
  
  if (executedHooks.has(hookKey)) {
    // ✅ 检测到重复触发，跳过
    logDebug('Duplicate hook trigger detected and skipped', { key: hookKey });
    return;
  }
  executedHooks.add(hookKey);
  
  // 实际 hook 逻辑...
  
  // 清理（可选：防止 Set 无限增长）
  if (executedHooks.size > 10000) {
    executedHooks.clear();
  }
}
```

### 5.2 基于 callID 的幂等性

每个工具调用都有唯一的 `callID`，可以用它实现幂等性：

```typescript
'tool.execute.before': async (input, output) => {
  // callID 在同一 session 内唯一
  // 同一工具调用的 before 和 after 共享 same callID
  if (processedCalls.has(input.callID)) {
    // 此 callID 已处理，跳过
    return;
  }
  processedCalls.add(input.callID);
  // ...
}
```

### 5.3 插件注册防御

创建一个工具函数，在插件初始化时验证没有重复 ID：

```typescript
// 插件初始化时检查
async function verifySinglePlugin() {
  const configPath = join(process.cwd(), 'opencode.json');
  const config = JSON.parse(await readFile(configPath, 'utf-8'));
  
  if (config.plugins && config.plugins.length > 1) {
    console.error(
      `[WARNING] 检测到 ${config.plugins.length} 个插件！`,
      '多插件共存可能导致 hook 重复触发。',
      '建议合并为单一插件。'
    );
  }
}
```

---

## 6. 诊断策略

### 6.1 如何检测双 Hook 触发

#### 方法 A：文件日志计数法

在 hook 中添加调用计数日志：

```typescript
import { appendFileSync } from 'fs';

let hookCallCount = 0;

'tool.execute.before': async (input, output) => {
  hookCallCount++;
  const logLine = `[${new Date().toISOString()}] ` +
    `hook-call-#${hookCallCount} | tool=${input.tool} | ` +
    `session=${input.sessionID} | call=${input.callID}\n`;
  
  appendFileSync('.task_temp/_logs/hook-trace.log', logLine);
  
  // 正常 hook 逻辑...
}
```

然后执行一个工具调用，检查日志中同一 `callID` 的出现次数：

```bash
# 执行一个工具调用后检查
grep "call=call_" .task_temp/_logs/hook-trace.log | wc -l
# 如果 > 1，说明 hook 被多次触发
```

#### 方法 B：检查 opencode.json 插件列表

```bash
# 统计注册的插件数量
grep -c '"\.opencode/plugins' opencode.json
# 如果 > 1，存在双 Hook 触发风险
```

#### 方法 C：机器状态异常检测

检查 `machine.json` 中的 `write_audit_state` 是否出现异常计数：

```bash
# 执行一次工具调用后检查审计计数
grep -A 5 '"write_audit_state"' .opencode/state/machine.json
# 如果 counts_checks_run > files_changed×2，提示双触发
```

### 6.2 严重程度判断

| 检测结果 | 严重程度 | 建议操作 |
|----------|----------|----------|
| 2 个不同 ID 的插件注册了相同 hook | 🔴 **P0 阻塞** | 立即合并插件 |
| 同一 ID 被多次注册 | 🟡 中 | 检查插件加载流程 |
| callID 在处理中出现重复计数 | 🟡 中 | 添加幂等性保护 |
| 仅开发者环境有多个插件 | 🟢 低 | 文档记录，规划合并 |

---

## 7. 排查清单

当怀疑存在双 Hook 触发时，按以下顺序排查：

- [ ] **检查插件数量**：`opencode.json` 中 `plugins` 数组有几个条目？
- [ ] **检查插件 ID**：每个插件入口返回的对象是否有不同的 ID？
- [ ] **验证合并状态**：是否已执行 FW-MERGE-UC7KS 类似的合并操作？
- [ ] **检查 hook 计数**：使用文件日志法统计同一 callID 的 hook 调用次数
- [ ] **检查 write_audit_state**：`machine.json` 中审计计数是否异常翻倍？
- [ ] **检查性能**：工具调用响应时间是否因 hook 处理而明显增加？
- [ ] **回顾 git 历史**：是否有插件被拆分而未合并的记录？

如果确认存在双 Hook 触发：

1. **创建合并插件**（参考 §4）：将多个插件的 hook 逻辑合并到一个入口
2. **更新 opencode.json**：移除多余的插件路径
3. **添加幂等性保护**（参考 §5.1）：在关键 hook 中添加去重逻辑
4. **验证修复**：执行一个工具调用后检查 hook 计数是否为 1
5. **回归测试**：确认所有管控规则（write-scope、TDD、UC7KS）仍然正常执行

### 合并前后的效果对比

| 指标 | 合并前（双插件） | 合并后（单插件） |
|------|-----------------|-----------------|
| `tool.execute.before` 触发次数 | 2 次/工具调用 | 1 次/工具调用 |
| hook 处理总耗时 | ~2x 基准时间 | ~1x 基准时间 |
| write_audit 计数准确性 | 翻倍计数 ❌ | 正常计数 ✅ |
| 状态更新一致性 | 两个 hook 可能冲突 ❌ | 单一执行流 ✅ |
| 调试复杂度 | 高（需追踪两个入口） | 低（单一入口） |

---

## 附录 A：核心源码参考

| 源码文件 | 路径（upstream OpenCode） | 关键函数 |
|----------|---------------------------|----------|
| Plugin 类型定义 | `packages/plugin/src/index.ts` | `Hooks` 接口 |
| Hook 链式触发 | `packages/core/src/plugin.ts` | `triggerFor()`, `trigger()` |
| 插件注册 | `packages/core/src/plugin.ts` | `add()`, `hooks` 数组 |
| 工具执行 + Hook 触发 | `packages/opencode/src/session/tools.ts` | `resolve()`, `plugin.trigger()` |
| 插件加载 | `packages/opencode/src/plugin/loader.ts` | 插件加载管道 |
| 入口解析 | `packages/opencode/src/plugin/shared.ts` | `resolvePluginEntrypoint()` |

## 附录 B：相关文档

| 文档 | 位置 | 说明 |
|------|------|------|
| 插件调试防坑指南 | `mistake_precautions/plugin-debugging-precautions.md` | 通用插件调试技巧 |
| 插件加载机制分析 | `docs/official_docs/opencode/plugins/source-analysis/plugin-loading-mechanics.md` | 上游源码分析 |
| Agent 身份与 Hook 机制 | `docs/official_docs/opencode/source-analysis/agent-identity-plugin-hooks.md` | Hook 数据流分析 |

---

*本文档基于 framework-enforcer + uc7ks-enforcer 双插件导致的 P0 双 Hook 触发故障排查总结。核心教训：OpenCode 中不同 ID 的插件永远链式触发，不会互相覆盖。*
