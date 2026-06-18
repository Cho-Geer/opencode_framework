# project.config.json [INFRA] 标记逻辑 & gate-before.ts DAG 审计 硬编码修复计划

**版本**: v1.0.0  
**创建**: 2026-06-19  
**作者**: @Super-Admin  
**任务ID**: SA-PLAN-CONFIG-DAG-GATE-FIX  
**状态**: PLAN — 待实施  

---

## §1 概述

本计划覆盖两项框架修复：

| 编号 | 问题 | 目标 |
|------|------|------|
| **FIX-1** | `hook-commit-msg.ts` 在 strict 模式下错误地要求 [INFRA] 标记 | 只有 locked 模式要求 [INFRA]，advisory/strict 仅警告 |
| **FIX-2** | `gate-before.ts` DAG 审计硬编码 `mode === "strict" \|\| mode === "locked"` | 读取 `dispatch_policy.require_dag_entry` 配置决定阻断行为 |

---

## §2 调查 1: [INFRA] 标记逻辑分析

### 2.1 数据流

```
project.config.json → CRITICAL_FILES 列表 (.opencode/lib/critical-files.ts)
    ↓
多个执行点检查是否有 critical files 被修改 (git diff HEAD / git diff --cached)
    ↓
┌──────────────────────────┬───────────────────────┬──────────┬──────────┬──────────┐
│ 执行点                   │ 文件                  │ Advisory │ Strict   │ Locked   │
├──────────────────────────┼───────────────────────┼──────────┼──────────┼──────────┤
│ pre-commit hook Layer 1.5│ hook-layers.ts L92-107│ ⚠️ WARN  │ ⚠️ WARN  │ ❌ BLOCK │
│ commit-msg hook          │ hook-commit-msg.ts    │ ⚠️ WARN  │ ❌ BLOCK  │ ❌ BLOCK │
│                          │ L103-126              │          │ ← ISSUE! │          │
│ pre-execution gate Check4│ pre-exec-gate.ts      │ ⚠️ WARN  │ ⚠️ WARN  │ ❌ BLOCK │
│                          │ L558-589              │          │          │          │
│ dispatch gate            │ dispatch-subagent.ts  │ ⚠️ WARN  │ ⚠️ WARN  │ ❌ BLOCK │
│                          │ L165-184              │          │          │          │
│ compliance_gate_check    │ compliance-gate.ts    │ ⚠️ WARN  │ ⚠️ WARN  │ ⚠️ WARN  │
│                          │ L317-347              │ (passed) │          │          │
└──────────────────────────┴───────────────────────┴──────────┴──────────┴──────────┘
```

### 2.2 问题定位

**问题文件**: `.opencode/hooks/lib/hook-commit-msg.ts`  
**问题行**: L103–126  
**问题描述**: `hook-commit-msg.ts` 在 strict 模式下错误地要求 [INFRA] 标记

**关键代码 (L103-126)**:
```typescript
// ── [INFRA] Marker Check (critical files) ──
if (criticalModified.length > 0) {
  if (!msg.includes('[INFRA]')) {
    console.log('═══════════════════════════════════════════════════════');
    console.log(
      '[FW-ENFORCE][INFRA] Critical infrastructure files in this commit:',
    );
    criticalModified.forEach((f) => console.log(`  - ${f}`));
    console.log('\nCommit message must include [INFRA] marker.');
    console.log(
      'Example: git commit -m "[Green][INFRA] update agent permissions"',
    );
    console.log('═══════════════════════════════════════════════════════');
    if (mode !== 'advisory') {          // ← 问题: strict 也在此分支
      process.exit(1);                   // ← 问题: strict 被阻断
    }
  }
}
```

### 2.3 对比其他执行点

| 执行点 | 代码 | advisory | strict | locked |
|--------|------|----------|--------|--------|
| `hook-layers.ts` L98 | `if (mode === 'locked')` → BLOCK | warn | warn | BLOCK |
| `pre-exec-gate.ts` L569 | `if (mode === 'locked')` → BLOCK | warn | warn | BLOCK |
| `hook-commit-msg.ts` L116 | `if (mode !== 'advisory')` → BLOCK | warn | **BLOCK** | BLOCK |

**结论**: `hook-commit-msg.ts` 的硬编码条件 `mode !== 'advisory'` 与 `hook-layers.ts` 和 `pre-exec-gate.ts` 中使用的 `mode === 'locked'` 不一致。只有 `hook-commit-msg.ts` 有问题。

### 2.4 修复方案

**将 L116 的条件从 `mode !== 'advisory'` 改为 `mode === 'locked'`**

```diff
-   if (mode !== 'advisory') {
+   if (mode === 'locked') {
      process.exit(1);
    }
```

**改动范围**: 1 行  

### 2.5 风险评估

| 风险 | 等级 | 说明 |
|------|------|------|
| strict 模式下 [INFRA] 强制被削弱 | **低** | 这是预期行为 — 只有 locked 模式才是 "infra 变更" 级别 |
| `hook-layers.ts` 已有 Layer 1.5 检查 | **缓解** | pre-commit 阶段 Layer 1.5 (L98: `mode === 'locked'`) 在 commit 前已正确阻断 locked 模式 |
| `pre-exec-gate.ts` 已有 Check 4 | **缓解** | dispatch 阶段 Check 4 (L569: `mode === 'locked'`) 在 dispatch 前已正确阻断 locked 模式 |

**结论**: 低风险。多个执行点协同保护 locked 模式的完整性。

---

## §3 调查 2: gate-before.ts DAG 审计硬编码分析

### 3.1 数据流

```
project.config.json → dispatch_policy.require_dag_entry (布尔值)
    ↓
┌──────────────────────────┬──────────────────────────────────┬─────────────────────┐
│ 执行点                   │ 当前行为                         │ 应使用               │
├──────────────────────────┼──────────────────────────────────┼─────────────────────┤
│ dispatch-before.ts       │ readDispatchPolicy().            │ ✅ 已正确使用          │
│ (Layer 1)                │ require_dag_entry                │ require_dag_entry     │
├──────────────────────────┼──────────────────────────────────┼─────────────────────┤
│ dispatch_subagent.ts     │ readDispatchPolicy().            │ ✅ 已正确使用          │
│ (Layer 2)                │ require_dag_entry                │ require_dag_entry     │
├──────────────────────────┼──────────────────────────────────┼─────────────────────┤
│ gate-before.ts           │ mode === "strict" \|\|           │ ❌ 应读取              │
│ (Layer 3)                │ mode === "locked"                │ require_dag_entry     │
│ L128-176                 │ (硬编码)                         │                       │
└──────────────────────────┴──────────────────────────────────┴─────────────────────┘
```

### 3.2 问题定位

**问题文件**: `.opencode/plugins/gate-before.ts`  
**问题行**: L128–176 (P2-1: DAG Task Existence/Status Audit)  
**问题描述**: DAG 审计阻断条件使用硬编码的 enforcement mode，未读取 `dispatch_policy.require_dag_entry` 配置

**关键代码 (L128-176)**:
```typescript
// P2-1: DAG Task Existence/Status Audit
if (isModifyTool(input.tool)) {
  const taskId = resolveTaskId(input.sessionID);
  const isExempt = isDagExempt(agent);           // ← 正确: 使用 dag-policy.ts 的豁免列表

  if (taskId && !isExempt) {
    const tc = findTaskInDag(taskId);
    if (!tc.found) {
      // ...
      if (mode === "strict" || mode === "locked") {  // ← 问题: 硬编码模式检查
        throw new Error(
          `[FW-ENFORCE][DAG] Task "${taskId}" not found in Task.DAG.json ...`,
        );
      }
    } else if (tc.status !== "pending" && tc.status !== "in_progress") {
      // ...
      if (mode === "strict" || mode === "locked") {  // ← 问题: 硬编码模式检查
        throw new Error(
          `[FW-ENFORCE][DAG] Task "${taskId}" status is "${tc.status}"...`,
        );
      }
    }
  }
}
```

### 3.3 与 dispatch_policy 的关系

当前 `project.config.json` 的配置 (L975-981):
```json
"dispatch_policy": {
  "require_dag_entry": false,
  "auto_plan_enabled": true,
  "auto_plan_max_per_session": 5,
  "auto_plan_timeout_ms": 120000
}
```

`require_dag_entry: false` 表示 DAG 条目要求处于 **关闭** 状态。然而 `gate-before.ts` 在 strict 模式下仍然阻断缺少 DAG 条目的任务，与配置不一致。

设计文档 `dag-policy.ts` L80-81 的意图:
> "Default: false during rollout (observation window); flipped to true in strict mode after a one-week observation window."

这说明 `require_dag_entry` 是控制开关，应独立于 enforcement mode。

### 3.4 修复方案

**读取 `readDispatchPolicy().require_dag_entry` 代替 enforcement mode 检查**

```diff
-   if (mode === "strict" || mode === "locked") {
+   const policy = readDispatchPolicy();
+   if (policy.require_dag_entry) {
      throw new Error(
        `[FW-ENFORCE][DAG] Task "${taskId}" not found...`,
      );
    }
```

需要在 `gate-before.ts` 顶部添加导入:

```diff
- import { isDagExempt } from "../lib/dag-policy";
+ import { isDagExempt, readDispatchPolicy } from "../lib/dag-policy";
```

**改动范围**: 3 处 (1 个导入 + 2 个条件替换)

**具体改动**:

| 位置 | 行号 | 改动 |
|------|------|------|
| 导入 | L12 | `import { isDagExempt, readDispatchPolicy } from "../lib/dag-policy";` |
| DAG-TASK-NOT-FOUND | L143 | `if (mode === "strict" \|\| mode === "locked")` → `if (readDispatchPolicy().require_dag_entry)` |
| DAG-TASK-STATUS | L163 | `if (mode === "strict" \|\| mode === "locked")` → `if (readDispatchPolicy().require_dag_entry)` |

### 3.5 行为矩阵对比

**修改前**:
| mode | require_dag_entry | DAG 审计行为 |
|------|:---:|------|
| advisory | false | ⚠️ warn |
| strict | false | ❌ **BLOCK** (与配置矛盾) |
| strict | true | ❌ BLOCK |
| locked | false | ❌ BLOCK |
| locked | true | ❌ BLOCK |

**修改后**:
| mode | require_dag_entry | DAG 审计行为 |
|------|:---:|------|
| advisory | false | ⚠️ warn |
| strict | false | ⚠️ **warn** (修复!) |
| strict | true | ❌ **BLOCK** (按配置) |
| locked | false | ⚠️ warn |
| locked | true | ❌ BLOCK |

### 3.6 风险评估

| 风险 | 等级 | 说明 |
|------|------|------|
| 当前 `require_dag_entry=false` 时 strict 模式不再阻断 | **目标行为** | 这是预期修复结果 |
| dispatch-before.ts 和 dispatch_subagent.ts 已有独立检查 | **缓解** | Layer 1/2 同样使用 `require_dag_entry`，行为一致 |
| `dag-policy.ts` 缓存需清除 | **低** | 已有 `resetDispatchPolicyCache()` 函数 |
| gate-before.ts ROUTE VALIDATION (L182-238) 也使用 mode 检查 | **注意** | route validation 是独立功能，不需要改动 |

---

## §4 实施步骤

### 4.1 FIX-1: hook-commit-msg.ts [INFRA] 标记

**文件**: `.opencode/hooks/lib/hook-commit-msg.ts`

**改动**:
1. 修改 L116: `if (mode !== 'advisory')` → `if (mode === 'locked')`

**验证**:
```bash
# 验证 commit-msg hook 行为
bun .opencode/scripts/framework-self-test.ts
# 手动测试:
# 1. 修改 project.config.json (添加注释)
# 2. git add project.config.json
# 3. 不带 [INFRA] 提交 → advisory 应通过, strict 应通过, locked 应阻断
```

### 4.2 FIX-2: gate-before.ts DAG 审计

**文件**: `.opencode/plugins/gate-before.ts`

**改动**:
1. L12: 导入 `readDispatchPolicy`
2. L143: 替换条件为 `if (readDispatchPolicy().require_dag_entry)`
3. L163: 替换条件为 `if (readDispatchPolicy().require_dag_entry)`

**验证**:
```bash
bun .opencode/scripts/framework-self-test.ts
# Check 41: 验证 gate-before.ts 导入 isDagExempt
# Check 32: 验证 context7 工具阻断
```

### 4.3 统一验证

```bash
# 1. 框架自测
bun .opencode/scripts/framework-self-test.ts

# 2. 状态一致性检查
bun .opencode/scripts/state-reconciliation.ts --fix

# 3. 最终验证: 修改 project.config.json → dispatch_policy.require_dag_entry 分别设为 true/false
# 确认 gate-before.ts 行为正确改变
```

---

## §5 影响范围与回滚计划

### 5.1 影响的子系统

| 子系统 | FIX-1 影响 | FIX-2 影响 |
|--------|:---:|:---:|
| pre-commit hook | 否 (Layer 1.5 不受影响) | 否 |
| commit-msg hook | **是** (行为变更) | 否 |
| pre-execution gate | 否 | 否 |
| dispatch 系统 | 否 | **是** (gate-before modify-tool 审计) |
| compliance gate | 否 | 否 |
| 日志系统 | 否 | 否 |
| 业务代码 (`booking-*/src/`) | 否 | 否 |

### 5.2 回滚计划

```bash
# FIX-1 回滚
git checkout -- .opencode/hooks/lib/hook-commit-msg.ts

# FIX-2 回滚
git checkout -- .opencode/plugins/gate-before.ts

# 清除 dag-policy 缓存 (如需要)
bun -e "const {resetDispatchPolicyCache} = require('./.opencode/lib/dag-policy'); resetDispatchPolicyCache();"
```

---

## §6 日志集成

### 6.1 FIX-1 日志增强

在 `hook-commit-msg.ts` 中，当 strict 模式下跳过阻断时，增加日志记录:

```typescript
if (mode === 'locked') {
  // ... 阻断逻辑 ...
  log(`[INFRA] Blocked in locked mode`);
} else {
  log(`[INFRA] Advisory: ${criticalModified.length} critical file(s) modified — [INFRA] marker recommended but not enforced in ${mode} mode`);
}
```

### 6.2 FIX-2 日志增强

在 `gate-before.ts` 中，当审计条件由 `require_dag_entry` 控制时，添加日志:

```typescript
const policy = readDispatchPolicy();
if (policy.require_dag_entry) {
  writeLog("gate-before", "runtime", {
    // ... 阻断日志 ...
    detail: `BLOCKED | DAG-TASK-NOT-FOUND | task=${taskId} | require_dag_entry=true`,
  });
} else {
  writeLog("gate-before", "runtime", {
    level: "WARN",
    event: "TOOL-BEFORE",
    detail: `DAG task not found but require_dag_entry=false — advisory only | task=${taskId}`,
  });
}
```

---

## §A 附录: 全部相关文件清单

| 文件 | 角色 | FIX-1 | FIX-2 |
|------|------|:---:|:---:|
| `.opencode/lib/critical-files.ts` | CRITICAL_FILES 定义 (含 project.config.json) | 读 | — |
| `.opencode/hooks/lib/hook-critical-files.ts` | 重导出层 | 读 | — |
| `.opencode/hooks/lib/hook-commit-msg.ts` | commit-msg [INFRA] 检查 | **改** | — |
| `.opencode/hooks/lib/hook-layers.ts` | pre-commit Layer 1.5 检查 | ✅ 正确 | — |
| `.opencode/scripts/pre-execution-gate.ts` | dispatch 前 Check 4 | ✅ 正确 | — |
| `.opencode/scripts/command-tools/dispatch-subagent.ts` | dispatch 时 critical files 检测 | 读 | — |
| `.opencode/plugins/gate-before.ts` | modify-tool 时 DAG 审计 | — | **改** |
| `.opencode/lib/dag-policy.ts` | DAG 豁免列表 + dispatch_policy 读取 | — | 读 |
| `.opencode/plugins/dispatch-before.ts` | dispatch 前 Layer 1 DAG 检查 | ✅ 正确 | 不变 |
| `.opencode/tools/dispatch_subagent.ts` | dispatch 核心 Layer 2 | ✅ 正确 | 不变 |
| `.opencode/project.config.json` | 配置源 | — | 读 |

---

## §B 变更记录

| 日期 | 版本 | 变更 | 作者 |
|------|------|------|------|
| 2026-06-19 | 1.0.0 | 初始计划：FIX-1 + FIX-2 调查结果和实施计划 | @Super-Admin |
