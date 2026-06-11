# 强制所有派遣经过 dispatch_subagent — 实施方案

**版本**: v1.0
**日期**: 2026-06-08
**作者**: @Super-Admin
**状态**: 待审批
**前提**: v4.2.1 DISPATCH-GATE 已就位

---

## 1. 背景

### 当前两条派遣路径

```
路径 A (规范): dispatch_subagent → 生成包装 Prompt → .pending.json 入队 → Task() → hash 校验 ✅
路径 B (捷径): Task() 直接调用 → 无 .pending.json → hash 校验跳过 → 直接执行 ⚠️
```

路径 B 的子 Agent **缺少**：P0 Protocol、Agent Config、DISPATCH_TOKEN、Scope Boundary 表。
虽然 Plugin 被动阻止了写操作和外查，但子 Agent **不知道应该执行合规门禁流程**。

### 目标

强制所有 `Task()` 调用必须通过路径 A（`dispatch_subagent`），使每次派遣都具备完整上下文。

---

## 2. 七维度影响分析

### 2.1 Design Architecture (设计架构)

| 影响 | 评估 |
|------|:---:|
| 架构层 | ✅ 无变化 — 约束位于 `toolExecuteBefore` (plugin)，与现有 DISPATCH-GATE/TASK-IDENTITY 同级 |
| 派遣流程 | ✅ 强化 — 从「双路径可选」变为「单路径强制」，简化设计 |
| 回退路径 | ✅ 保留 — `FW_PROMPT_QUEUE_DRAIN=true` 环境变量可紧急绕过 |

**结论：增强架构一致性，无破坏。**

### 2.2 Hardened Enforcement Constraint (固化约束)

| 约束 | 当前 | 变更后 |
|------|:---:|:---:|
| UC7-001 (缓存搜索) | ✅ block | ➡️ 不变 |
| UC7-001b (充分性) | ✅ block | ➡️ 不变 |
| UC7-002 (外查拦截) | ✅ block | ➡️ 不变 |
| DISPATCH-GATE (授权) | ✅ block | ➡️ 不变 |
| Gate armed (写操作) | ✅ block | ➡️ 不变 |
| Write scope | ✅ block | ➡️ 不变 |
| TDD order | ✅ block | ➡️ 不变 |
| **Prompt hash (完整性)** | ⚠️ 仅队列非空时 | ✅ **强制** |
| **dispatch_subagent (必经过)** | ❌ 不强制 | ✅ **强制** |

**结论：新增 1 项约束，已有 7 项不变。不削弱任何现有约束。**

### 2.3 Harness System (框架系统)

| 组件 | 影响 |
|------|:---:|
| Plugin (framework-enforcer) | ✅ 约束位置正确 — `toolExecuteBefore` 中 `TASK_TOOLS.has(tool)` 块 |
| `dispatch_subagent` MCP Tool | ✅ 无变化 — 仍然负责生成 prompt + 写入 .pending.json |
| `dispatch-subagent.ts` 子脚本 | ✅ 无变化 |
| `compliance-gate.ts` | ✅ 无变化 |
| `pre-execution-gate.ts` | ✅ 无变化 |
| Custom Tools (safe_edit etc.) | ✅ 无变化 — 不受 Task() 拦截影响 |

**结论：仅 plugin 新增 ~15 行，其他组件零改动。**

### 2.4 Permission Matrix (权限矩阵)

| 维度 | 影响 |
|------|:---:|
| `agent_write_scopes` | ✅ 无变化 |
| `opencode.json` permissions | ✅ 无变化 |
| DISPATCH-GATE 授权 | ✅ 不变 — SA→KC only, Orchestrator→any |
| `task` tool permission | ✅ 无变化 |

**结论：权限矩阵完全不受影响。约束在 plugin 层，不在权限层。**

### 2.5 Multi-Agent System (多智能体)

| 场景 | 当前 | 变更后 |
|------|:---:|:---:|
| SA → dispatch_subagent → Task | ✅ | ✅ 不变 |
| SA → 直接 Task (绕过) | ⚠️ 允许 | ❌ **BLOCKED** |
| Orchestrator → dispatch_subagent → Task | ✅ | ✅ 不变 |
| 子 Agent → 再次 Task | ❌ DISPATCH-GATE 已拦截 | ➡️ 不变 |
| SA 紧急修复 → 直接工具调用 | ✅ 不涉及 Task() | ➡️ 不变 |

**结论：仅影响「主 Agent 直接 Task()」这一条路径，其他全部不变。**

### 2.6 Central State Management (中央状态管理)

| 状态文件 | 影响 |
|------|:---:|
| `.pending.json` | ✅ 被读取 (已有) — 强制作为 Task() 的前置条件 |
| `.task_temp/_dispatch_target.json` | ✅ 无变化 — TASK-IDENTITY 仍写入 |
| `machine.json` | ✅ 无变化 |
| `gate-state.json` | ✅ 无变化 |
| `.session_map.json` | ✅ 无变化 |

**结论：无新增状态文件，无现有状态文件结构变更。**

### 2.7 Templatization & Parameterization (模板化)

| 维度 | 影响 |
|------|:---:|
| `project.config.json` 占位符 | ✅ 无变化 |
| `dispatch-subagent.ts` 模板解析 | ✅ 无变化 |
| `subagent-preamble.md` | ✅ 无变化 |
| Agent configs (.md) | ✅ 无变化 |

**结论：完全不影响模板化体系。**

---

## 3. 实施方案

### 3.1 核心改动：强制 .pending.json 检查

**文件**: `.opencode/plugins/framework-enforcer/enforce.ts`

**位置**: `toolExecuteBefore` 中 `if (TASK_TOOLS.has(tool))` 块的**最末尾**（在 DISPATCH-GATE 之前）

**新增代码**:

```typescript
// ── FW-HARDEN-MANDATORY-DISPATCH: All Task() must go through dispatch_subagent ──
// The .pending.json queue is the proof that dispatch_subagent was called.
// If the queue doesn't exist or is empty, the dispatch bypassed the tool → BLOCK.
// Emergency override: FW_PROMPT_QUEUE_DRAIN=true (clears queue and allows bypass).
if (TASK_TOOLS.has(tool)) {
  let queueExists = false;
  let queueEmpty = true;
  try {
    const pf = path.join(
      process.env.OPENCODE_ROOT || ".", ".task_temp", "_dispatch", ".pending.json"
    );
    if (fs.existsSync(pf)) {
      queueExists = true;
      const q = JSON.parse(fs.readFileSync(pf, "utf8"));
      queueEmpty = !Array.isArray(q) || q.length === 0;
    }
  } catch {}
  
  if (!queueExists || queueEmpty) {
    const msg =
      `[FW-ENFORCE][MANDATORY-DISPATCH] All Task() dispatches must go through ` +
      `dispatch_subagent. No pending dispatch entry found. ` +
      `Call dispatch_subagent(agent_type, task_description) first. ` +
      `Emergency override: set FW_PROMPT_QUEUE_DRAIN=true.`;
    throw new Error(msg);
  }
}
```

### 3.2 插入位置

```
enforce.ts 结构:

  L435: if (TASK_TOOLS.has(tool)) {         ← 现有: Prompt hash check
  L650: }                                     ← 现有块结束
  L656: if (TASK_TOOLS.has(tool)) {         ← TASK-IDENTITY
  L707: }
  L709: if (TASK_TOOLS.has(tool)) {         ← DISPATCH-GATE
  L831: }
  ← 【插入 MANDATORY-DISPATCH 在这里】       ← 新增: 强制 .pending.json 检查
  L832: const EXEC_TOOLS = [...]
```

**插入位置选择理由**：
- 在 DISPATCH-GATE **之后**：先做授权检查（谁可以派遣），再做完整性检查（是否经过 dispatch_subagent）
- 在 TASK-IDENTITY **之后**：先做身份注入
- 使用独立的 `if (TASK_TOOLS.has(tool))` 块：与其他块解耦

### 3.3 修改文件清单

| 文件 | 改动 | 行数 |
|------|------|:---:|
| `enforce.ts` | 新增 MANDATORY-DISPATCH 检查块 | +18 |
| `index.ts` | 版本号更新 | 1 |

**合计: +19 行**。

---

## 4. 紧急绕过机制

```bash
# 环境变量绕过（死锁恢复）
export FW_PROMPT_QUEUE_DRAIN=true
```

现有代码已支持此绕过（L447-460），无需新增。绕过后：
1. `.pending.json` 被清空为 `[]`
2. MANDATORY-DISPATCH 检查到此为空队列 → 仍会 BLOCK
3. 需要**再次设置** `FW_PROMPT_QUEUE_DRAIN=true` 才能清理绕过后残留的空文件

**修正**：绕过逻辑应同时处理「队列被清空后仍需派遣」的场景 —— 检查 `FW_PROMPT_QUEUE_DRAIN` 环境变量，若为 `true` 则跳过 MANDATORY-DISPATCH 检查。

```typescript
if (!queueExists || queueEmpty) {
  if (process.env.FW_PROMPT_QUEUE_DRAIN === "true") {
    return; // Emergency bypass
  }
  const msg = ...;
  throw new Error(msg);
}
```

---

## 5. 验证计划

| # | 场景 | 预期 |
|---|------|------|
| 1 | SA → 直接 Task("explore") | ❌ BLOCKED: must go through dispatch_subagent |
| 2 | SA → dispatch_subagent → Task | ✅ 通过 |
| 3 | Orchestrator → dispatch_subagent → Task | ✅ 通过 |
| 4 | SA → 直接工具调用 (safe_edit) | ✅ 不触发（非 Task 工具） |
| 5 | FW_PROMPT_QUEUE_DRAIN=true → 直接 Task | ✅ 紧急绕过 |

---

## 6. 错题集约束

| 约束 | 来源 | 应对 |
|------|------|------|
| `throw` 可阻止工具执行 | 官方 plugins.md — .env protection 示例 | 使用 `throw new Error` 直接阻止 |
| Bun 缓存 | 错题集 §3 | 实施后更新 `index.ts` VERSION |
| `console.log` 不可见 | 错题集 §5 | 使用 `throw` + `logAuditEntry` |

---

## 7. 综合评估

| 维度 | 评估 |
|------|:---:|
| Design Architecture | ✅ 简化：双路径 → 单路径 |
| Hardened Enforcement | ✅ 强化：新增 1 项 + 8 项不变 |
| Harness System | ✅ 仅 plugin 变，零组件变 |
| Permission Matrix | ✅ 无影响 |
| Multi-Agent System | ✅ 仅拦截越权派遣 |
| State Management | ✅ 无新文件 |
| Templatization | ✅ 无影响 |
| 改动量 | 2 文件，~20 行 |
| 风险 | 🟢 低 — 紧急绕过机制保留 |
