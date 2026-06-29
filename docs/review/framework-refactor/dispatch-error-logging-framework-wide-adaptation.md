# Dispatch 错误日志优化方案 — 全域适配审核

> **审核日期**: 2026-06-26
> **前提**: `dispatch-error-logging-optimization-plan.md` 聚焦 dispatch 管线 5 个黑洞（G1-G5）+ 2 个约定违反（G6-G7）。本文审核该方案能否推广至整个框架。
> **结论**: **可以适配，但 Pattern B（category 陷阱）必须改为 API 级修复**——全域 ~450+ 处违反，逐文件修改不可行。

---

## 一、全框架审计规模

| 模式 | 描述 | Plugins | Lib | Scripts/Tools | **全域合计** |
| --- | --- | --- | --- | --- | --- |
| **A** | `throw` 前无 `writeLog` | 9 | 14 | ~31 | **~54** |
| **B** | LogLevel 作为 category 且无 `fields.level` | 52 | ~286 | ~110+ | **~450+** |
| **C** | `agent, agent,` 重复键 typo | 19 | 0 | 0 | **19** |
| **D** | SRC 标识不一致 | 0 | 1 | 2 | **3** |
| **E** | 静默 catch（无 writeLog） | 62 | ~120+ | ~170+ | **~350+** |
| **F** | 脚本无顶层 try/catch | — | — | 14/17 | **14** |

### 关键发现

1. **Pattern B 是系统级约定缺陷**，不是个别 bug。`writeLog(src, category, fields)` 的 `category` 参数接受 LogLevel 字符串但**不提取为 severity**——这是 API 设计陷阱。25 个 lib 文件、8 个 plugin 文件、25 个 script/tool 文件均中招。
2. **Pattern A/E 有重叠**——很多 throw 前的静默 catch 本应记录错误但被吞掉。
3. **Pattern C 集中在 4 个文件**：`session.ts`(6)、`task-after.ts`(6)、`uc7ks-after.ts`(5)、`hook-config-guard.ts`(2)。

---

## 二、核心结论：Pattern B 必须 API 级修复

### 为什么不能逐文件改？

全域 ~450+ 处 `writeLog(SRC, "ERROR", { event, detail })` 需改为 `writeLog(SRC, "runtime", { level: "ERROR", event, detail })`。涉及 **58+ 个文件**。其中许多使用中间层 helper：

```ts
// srcLog helper（state-reconciliation.ts, framework-doctor.ts, knowledge scripts 等）
function srcLog(level, event, fields) {
  getWriteLog()("script-xxx", level, { event, ...fields });  // level 传入 category 位
}

// gateLog helper（pre-execution-gate.ts）
function gateLog(category, level, data) {
  wl("script-pre-execution-gate", level, {...});  // level 传入 category 位
}

// writeCliLog helper（knowledge/indexer.ts）
function writeCliLog(level, event, detail) {
  writeLog("script-knowledge-indexer", level, { event, detail });
}

// demoLog（shared-infra.ts）
function demoLog(level: "INFO" | "ERROR", message: string) {
  writeLog("lib-shared-infra", level, { event: "demo", detail: message });
}
```

这些 helper 将 `level` 作为第 2 位置参数传给 `writeLog`——恰好是 `category` 位。这是**符合直觉的调用方式**，但 API 语义不匹配。逐文件修复需改动每个 helper 及其所有调用点，工作量大且易遗漏。

### API 级修复方案（一行代码修复全域 ~450+ 处）

**文件**: `.opencode/lib/log-manager.ts`
**修改点**: `resolveLogLevel` 函数（当前 `:214-217`）

**现状**:
```ts
function resolveLogLevel(explicitLevel?: LogLevel): LogLevel {
  if (explicitLevel) return explicitLevel;
  return config.logLevel;  // 默认 INFO
}
```

**方案**: 在 `writeLog` 函数体内，当 `fields.level` 缺省且 `category` 是 LogLevel 字符串时，从 category 提取 severity:

```ts
// writeLog 函数体内（约 :337 处），在 resolveLogLevel 调用之前：
const effectiveLevel = fields.level || (isLogLevel(category) ? category : undefined);
const level = resolveLogLevel(effectiveLevel);
```

辅助函数:
```ts
function isLogLevel(s: string): s is LogLevel {
  return s === "DEBUG" || s === "INFO" || s === "WARN" || s === "ERROR";
}
```

**效果**:
- `writeLog(SRC, "ERROR", { event, detail })` → severity = ERROR ✅（之前 = INFO ❌）
- `writeLog(SRC, "WARN", { event, detail })` → severity = WARN ✅（之前 = INFO ❌）
- `writeLog(SRC, "runtime", { level: "ERROR", event, detail })` → severity = ERROR ✅（不变）
- `writeLog(SRC, "runtime", { event, detail })` → severity = INFO（不变，默认行为保留）
- `writeLog(SRC, "loaded", { event, detail })` → severity = INFO（不变）

**向后兼容**: 已正确传入 `fields.level` 的调用不受影响（`fields.level` 优先级更高）。此修复仅填补 `fields.level` 缺省时的 fallback 路径。

**风险评估**: 极低。唯一的"行为变化"是使原本错误记录为 INFO 的条目改为正确的 ERROR/WARN。这正是期望行为。

### 替代方案对比

| 方案 | 改动量 | 风险 | 覆盖率 |
| --- | --- | --- | --- |
| **A. API 级修复（推荐）** | 1 个文件，~10 行 | 极低 | 100%（~450+ 处同时修复） |
| B. 修改各 helper 函数 | ~15 个 helper + 调用点 | 中（易遗漏） | ~70%（直接调用 writeLog 的仍需改） |
| C. 逐文件修正 category 为 "runtime" | 58+ 个文件，~450 处 | 高（回归风险） | 100% 但工作量大 |

---

## 三、各模式的适配策略

### Pattern A: throw 无 writeLog（~54 处）

**策略**: 按模块分批处理，优先级排序：

| 优先级 | 模块 | 违反数 | 处理方式 |
| --- | --- | --- | --- |
| P0 | `tools/dispatch_subagent.ts` | 11 | 已在原方案变更 1 中覆盖 |
| P0 | `scripts/mcp-tools/compliance-gate.ts` | 10 | 新增变更：catch + writeLog 包装 |
| P1 | `scripts/state-transaction.ts` | 7 | 新增变更：catch + writeLog 包装 |
| P1 | `scripts/framework-self-test.ts` | 3 | 新增变更 |
| P1 | `lib/permission-isolation-core.ts` | 3 | 新增变更：整个文件无 writeLog，需引入 |
| P2 | `lib/dag-version-manager.ts` | 4 | 新增变更 |
| P2 | `lib/write-audit-lib.ts` | 1 | 新增变更 |
| P2 | 其余 plugins（9 处） | 9 | 逐文件修补 |

**通用模式**（与原方案变更 1B 相同）:
```ts
// 在模块顶层或函数组外层包一个 try/catch
try {
  // 原有 throw 逻辑不变
} catch (e: any) {
  writeLog(SRC, "runtime", {
    level: "ERROR",
    event: `${MODULE}-UNHANDLED-ERROR`,
    detail: `phase=${phase} | rawError=${(e.message || "").slice(0, 500)}`,
  });
  throw e;
}
```

### Pattern C: `agent, agent,` typo（19 处）

**策略**: 纯搜索替换，无逻辑变更，可一次性批量修复。

| 文件 | 违反数 | 修正 |
| --- | --- | --- |
| `plugins/session.ts` | 6 | 第二个 `agent,` → `agentType: ...,` |
| `plugins/task-after.ts` | 6 | 同上（已在原方案变更 3B 中覆盖） |
| `plugins/uc7ks-after.ts` | 5 | 同上 |
| `plugins/hook-config-guard.ts` | 2 | 同上 |

**自动化**: `sed -i 's/agent,\n    agent,/agent,\n    agentType: ...,/' file` 或手写替换。需确认每处的 `agentType` 取值来源（`input.args?.subagent_type` 或 `agent` 或 `context.agent`）。

### Pattern D: SRC 不一致（3 处）

| 文件 | 问题 | 修正 |
| --- | --- | --- |
| `lib/dag-version-manager.ts` | SRC = `"lib-dag-version-manager"` 但 :343, :364 使用硬编码 `"dag-version-manager"` | 替换为 SRC |
| `scripts/mcp-tools/compliance-gate.ts` | 混用 `"mcp-compliance-gate"` 和 `"compliance-gate"` | 统一为 `"mcp-compliance-gate"` |
| `tools/dispatch_subagent.ts` | 已在原方案变更 4B 中覆盖 | — |

### Pattern E: 静默 catch（~350+ 处）

**策略**: 分级处理，不全部修复。

| 级别 | 类型 | 数量（估计） | 处理方式 |
| --- | --- | --- | --- |
| **不修复** | 最佳努力操作（JSON.parse、file read、mkdir） | ~280 | 添加 writeLog 反而产生噪音 |
| **P2 修复** | 有意义的错误但被吞掉 | ~50 | 添加 writeLog WARN |
| **P0 修复** | 关键路径错误丢失 | ~20 | 添加 writeLog ERROR |

**判断标准**:
- catch 内有注释 `/* best-effort */` / `/* non-critical */` / `/* non-fatal */` → 不修复
- catch 内有 `return defaultValue` / `return []` / `return null` 且操作是非关键配置读取 → 不修复
- catch 捕获的是数据库操作、网络调用、权限检查等有意义的错误 → 修复

### Pattern F: 脚本无顶层错误处理（14 处）

**策略**: 与原方案变更 2 相同模式——包裹 `main().catch()`:

```ts
async function main() { /* 原逻辑 */ }
main().catch((e) => {
  writeLog(SRC, "runtime", {
    level: "ERROR",
    event: "SCRIPT-UNCAUGHT-CRASH",
    detail: `reason=${e.message} | stack=${(e.stack || "").slice(0, 500)}`,
  });
  console.error(JSON.stringify({ error: "UNCAUGHT", reason: e.message }));
  process.exit(1);
});
```

**需修复的 14 个脚本**:
1. `scripts/command-tools/dispatch-subagent.ts`（原方案变更 2 已覆盖）
2. `scripts/state-transaction.ts`
3. `scripts/state-reconciliation.ts`
4. `scripts/pre-execution-gate.ts`
5. `scripts/mcp-tools/reconciliation-validate.ts`
6. `scripts/knowledge/size-reporter.ts`
7. `scripts/knowledge/janitor.ts`
8. `scripts/knowledge/compressor.ts`
9. `scripts/knowledge/archiver.ts`
10. `scripts/knowledge/indexer.ts`
11. `scripts/knowledge/integrity-check.ts`
12. `scripts/framework-doctor.ts`
13. `scripts/framework-self-test.ts`
14. `scripts/knowledge/backfill-session-access.ts`（已有 main().catch() 但无 writeLog）

---

## 四、实施优先级与阶段

### Phase 0: API 级修复（最高 ROI，独立实施）

| 变更 | 文件 | 影响 |
| --- | --- | --- |
| `resolveLogLevel` fallback 从 category 提取 | `lib/log-manager.ts` | 一次性修复 ~450+ 处 Pattern B |

**验证**: 修复前后对比 `grep '| INFO |' plugin-*-runtime.log` 条目数变化——预期 ERROR/WARN 事件不再误归 INFO。

### Phase 1: 批量机械修复

| 变更 | 范围 | 影响 |
| --- | --- | --- |
| Pattern C: 19 处 typo 修正 | 4 个 plugin 文件 | 无逻辑变更 |
| Pattern D: 3 处 SRC 统一 | 3 个文件 | 无逻辑变更 |

### Phase 2: dispatch 管线（原方案）

| 变更 | 来源 |
| --- | --- |
| 变更 1-4 | `dispatch-error-logging-optimization-plan.md` 原方案 |

### Phase 3: 高优先级模块

| 变更 | 文件 | Pattern |
| --- | --- | --- |
| compliance-gate throw 补日志 | `scripts/mcp-tools/compliance-gate.ts` | A（10 处） |
| state-transaction throw 补日志 | `scripts/state-transaction.ts` | A（7 处） |
| permission-isolation-core 引入 writeLog | `lib/permission-isolation-core.ts` | A（3 处）+ 全文无 writeLog |
| framework-self-test throw 补日志 | `scripts/framework-self-test.ts` | A（3 处） |

### Phase 4: 脚本顶层错误处理

14 个脚本添加 `main().catch()` + writeLog（Pattern F）。

### Phase 5: 静默 catch 分级修复

按判断标准逐批处理 ~70 处有意义的静默 catch（Pattern E 的 P0/P2 部分）。

---

## 五、验证策略

### Phase 0 验证
```bash
# 修复前：记录所有 writeLog(SRC, "ERROR"/"WARN", ...) 的 severity 列
grep -rn 'writeLog.*"ERROR"' .opencode/lib/ .opencode/plugins/ .opencode/scripts/ .opencode/tools/ | wc -l
# 预期 ~450+

# 修复后：验证 log-manager 的 resolveLogLevel 行为
# 在测试环境中调用 writeLog("test", "ERROR", { event: "TEST" })
# 检查输出行的 severity 列是否为 ERROR（非 INFO）
```

### Phase 1 验证
```bash
# Pattern C: 无 agent, agent, 残留
grep -rn 'agent,\n.*agent,' .opencode/plugins/ | wc -l
# 预期 0

# Pattern D: SRC 一致
grep -n 'writeLog("dag-version-manager"' .opencode/lib/dag-version-manager.ts | wc -l
grep -n 'writeLog("compliance-gate"' .opencode/scripts/mcp-tools/compliance-gate.ts | wc -l
# 预期均为 0
```

### 全域验证
```bash
# 所有 ERROR 级事件应出现在 severity=ERROR 行中
grep '| ERROR |' .task_temp/_logs/*/plugin-*-runtime.log | wc -l

# 不应有 ERROR 事件出现在 INFO 行中（修复前的典型问题）
grep '| INFO |.*ERROR' .task_temp/_logs/*/plugin-*-runtime.log | head -5
```

---

## 六、结论

| 维度 | 原方案（dispatch 管线） | 全域适配 |
| --- | --- | --- |
| Pattern B 修复策略 | 逐文件改（7+3 处） | **API 级修复**（1 处改，~450+ 处受益） |
| Pattern A 修复策略 | catch 包装（变更 1B） | 相同模式，按优先级分批推广 |
| Pattern C 修复策略 | 逐文件改（6 处） | 相同模式，扩展至 19 处 |
| Pattern F 修复策略 | main().catch()（变更 2） | 相同模式，推广至 14 个脚本 |
| 新增工作 | — | Pattern E 分级处理（~70 处有意义 catch） |
| **总工作量估计** | ~4 个变更 | **~6 个阶段，~80+ 文件** |

**最终结论**: 原方案的设计原则（统一 catch + writeLog、category="runtime" + level-in-fields、rawError/phase/agentTarget）完全可推广至全域。但 Pattern B 的规模（~450+）决定了必须采用 **API 级修复**而非逐文件修改——这是原方案未预见的关键适配点。
