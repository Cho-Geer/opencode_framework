# Framework Dispatch Gap Bug Analysis

**日期**: 2026-06-17
**状态**: 调查完成
**相关 Agent**: @Orchestrator, @Super-Admin
**发现 Session**: ses_129ad1690ffeZ9yODw7FoDmhOq (Architect blocked by FRAMEWORK_TASK_ID pollution)

---

## Bug 1: dispatch_subagent + Task 校验缺失

### 现象

@Orchestrator 调用了 `dispatch_subagent` 生成包装 Prompt（包含 DISPATCH_TOKEN、P0 protocol、scope boundary 声明），但在 `Task()` 中手动编写了简化的 prompt，没有原样传递 dispatch_subagent 的完整输出。框架没有在代码层校验两者的一致性。

### 根因追踪

```
dispatch_subagent(agent_type, task_description, dag_task_id)
  │
  ├─ dispatch-subagent.ts 生成包装 Prompt
  │     ├─ 注入 DISPATCH_TOKEN (SHA-256 hash)
  │     ├─ 注入 P0 protocol (compliance gate, UC7KS pipeline, submit deliverables)
  │     ├─ 注入 scope boundary 路由矩阵
  │     ├─ 注入 agent config + permissions
  │     └─ 写入 .task_temp/_dispatch/dispatch-{agent}-{timestamp}.md
  │
  └─ 返回包装 Prompt 给调用者

Task(subagent_type, prompt, task_id)
  │
  ├─ 框架将 prompt 直接传递给子 Agent → 无 any 校验
  └─ 子 Agent 收到底层 prompt → 无 P0 protocol, 无 scope boundary
```

**关键缺口**: `dispatch_subagent` 和 `Task` 是两次独立的工具调用，中间没有框架层的关联校验：

| 检查点 | 是否存在 | 说明 |
|--------|:------:|------|
| `dispatch-before.ts` | ✅ | 校验 L1-L4 路由，但只在 dispatch_subagent 被调用时触发 |
| `task-before.ts` | ❌ | 不存在 — 没有 task 工具的 before 钩子 |
| `task-after.ts` | ⚠️ | 存在但只记录 dispatch-outcome 日志，不校验 prompt 来源 |
| `gate-before.ts` | ❌ | 不校验 prompt 内容 |
| DISPATCH_TOKEN 校验 | ❌ | 没有任何代码检查 prompt 中是否包含 DISPATCH_TOKEN |

### 影响范围

| 影响 | 严重度 | 说明 |
|------|:------:|------|
| P0 protocol 绕过 | HIGH | Agent 可能不执行 compliance_gate_check/confirm |
| UC7KS pipeline 绕过 | HIGH | Agent 可能不调用 knowledge_cache_search |
| Scope boundary 缺失 | MEDIUM | Agent 不知道自己的路由边界 |
| DISPATCH_TOKEN 遗漏 | LOW | 主要用于审计追踪，不影响运行时 |
| 合规门未武装 | HIGH | 任务可能在不合规的状态下执行 |

### 修复方案

**方案 A: task-before.ts DISPATCH_TOKEN 检查 (推荐)**

新增 `task-before.ts` 插件，在 `tool.execute.before` 钩子中检查 Task() 的 prompt 参数：

```typescript
// task-before.ts (新文件, ~40行)
export default withPluginLifecycle("task-before", { "tool.execute.before": taskBefore });

function taskBefore(input: any, output: any): void {
  if (input.tool !== "task") return;
  
  const prompt = output?.args?.prompt || "";
  const mode = getEnforcementMode();
  
  // Check for DISPATCH_TOKEN in prompt
  const hasToken = /DISPATCH_TOKEN:[a-f0-9]{64}/.test(prompt);
  
  if (!hasToken && (mode === "strict" || mode === "locked")) {
    throw new Error(
      "[FW-ENFORCE][DISPATCH-INTEGRITY] Task() prompt missing DISPATCH_TOKEN. " +
      "All sub-agent dispatches MUST go through dispatch_subagent() first. " +
      "Re-dispatch using: dispatch_subagent(agent_type, task_description, dag_task_id) → Task({prompt: <output>})"
    );
  }
}
```

**改动量**: 新文件 ~40 行 + 注册到 index.ts (2 行)

**方案 B: dispatch-subagent.ts 端到端嵌入 (备选)**

修改 `dispatch-subagent.ts`，在生成包装 Prompt 后直接调 `Task()`，不让调用者有机会手动修改 prompt。但这改变了工具语义（dispatch_subagent 从"生成 prompt"变为"生成+派遣"），影响面的评估需要更谨慎。

**推荐**: 方案 A — 最小侵入，在 task-before 阶段拦截，不改变 dispatch_subagent 和 Task 的现有接口。

---

## Bug 2: knowledge_cache_search 自动注入 FRAMEWORK_TASK_ID 污染

### 现象

@Orchestrator 派遣 Architect 时**故意不设置 `dag_task_id`**（规避 gate-before P2-1 DAG 校验），但 Architect 在执行 P0 protocol 的 `knowledge_cache_search` 时，该工具自动设置了 `FRAMEWORK_TASK_ID=DAG-GAP-ANALYSIS`（来自之前 dispatch_subagent 调用的 dag_task_id 参数），导致 Architect 的后续写操作被 gate-before P2-1 阻断。

### 根因追踪

```
@Orchestrator 调用 dispatch_subagent(Architect, ..., dag_task_id="DAG-GAP-ANALYSIS")
  │
  ├─ dispatch-subagent.ts 设置 process.env.FRAMEWORK_TASK_ID = "DAG-GAP-ANALYSIS"
  │     (用于 .task_temp/{dag_task_id}/ 路径命名空间 + DAG 校验)
  │
  └─ 返回包装 Prompt → Orchestrator 调用 Task({prompt: ..., task_id: undefined})
       │
       ├─ 子 Agent 启动 → FRAMEWORK_TASK_ID 可能仍为 "DAG-GAP-ANALYSIS"
       │     (来自 dispatch_subagent 的环境变量设置)
       │
       ├─ 子 Agent 执行 knowledge_cache_search(domain, task_id)
       │     │
       │     ├─ knowledge_cache_search.ts:
       │     │     if (task_id) process.env.FRAMEWORK_TASK_ID = task_id;
       │     │     // 用传入的 task_id 覆盖了 FRAMEWORK_TASK_ID
       │     │     // 但这里传入的 task_id 是 undefined → 不覆盖
       │     │
       │     └─ 但实际上 FRAMEWORK_TASK_ID 已经在 dispatch_subagent 阶段被设置
       │        为 "DAG-GAP-ANALYSIS"，且未被清除
       │
       └─ 子 Agent 尝试 safe_edit → gate-before P2-1:
             findTaskInDag("DAG-GAP-ANALYSIS") → not found → BLOCKED
```

**关键问题**: `knowledge_cache_search` 的职责边界不清晰 — 它既读取 FRAMEWORK_TASK_ID 用于 UC7-001 compliance 记录，又可能在特定路径下设置 FRAMEWORK_TASK_ID。更重要的是，**dispatch_subagent 设置的环境变量没有在使用后被清除**，导致后续 Task() 调用继承了上一个 dispatch 的 task_id。

### 影响范围

| 影响 | 严重度 | 说明 |
|------|:------:|------|
| 子 Agent 写入被阻断 | HIGH | gate-before P2-1 将不存在的 DAG task 视为无效 |
| 合规门链接错误 | MEDIUM | session 被错误关联到不相关的 dag_task_id |
| 审计日志混乱 | MEDIUM | dispatch_failed_log 记录错误的 task_id |
| 调试困难 | LOW | 需要追踪环境变量传播链 |

### 修复方案

**方案 A: knowledge_cache_search 不设置 FRAMEWORK_TASK_ID (推荐)**

修改 `knowledge_cache_search.ts`，仅**读取** FRAMEWORK_TASK_ID（用于 UC7-001 记录），**不设置**：

```typescript
// knowledge_cache_search.ts 修改 (~5行)
// 删除: process.env.FRAMEWORK_TASK_ID = task_id;
// 改为: 仅从 process.env.FRAMEWORK_TASK_ID 读取已有值
const effectiveTaskId = process.env.FRAMEWORK_TASK_ID || task_id;
// 用于 UC7-001 记录，不修改环境变量
```

**方案 B: dispatch-subagent.ts 清理环境变量**

在 `dispatch-subagent.ts` 生成包装 Prompt 后，恢复 FRAMEWORK_TASK_ID：

```typescript
// dispatch-subagent.ts (~3行)
const savedTaskId = process.env.FRAMEWORK_TASK_ID;
process.env.FRAMEWORK_TASK_ID = dag_task_id;
// ... 生成包装 Prompt ...
process.env.FRAMEWORK_TASK_ID = savedTaskId; // 恢复
```

**推荐**: 方案 A — 源头治理，knowledge_cache_search 的职责是"记录合规状态"而非"设置任务上下文"，不应修改全局环境变量。

---

## 附录

### A. 两 Bug 的关系

Bug 1 和 Bug 2 在 Phase 0 规划过程中叠加出现：
1. Orchestrator 因 Bug 1 手动写了简化 prompt（绕过包装）
2. 派遣的子 Agent 因 Bug 2 被错误的 FRAMEWORK_TASK_ID 阻断
3. 两个 Bug 独立存在，但组合时加剧了问题

### B. 相关文件

| 文件 | Bug 1 | Bug 2 |
|------|:-----:|:-----:|
| `dispatch-subagent.ts` | 生成 DISPATCH_TOKEN | 设置 FRAMEWORK_TASK_ID (未清理) |
| `task-before.ts` | 不存在 — 待创建 | — |
| `task-after.ts` | 仅日志，无校验 | — |
| `knowledge_cache_search.ts` | — | 可能设置 FRAMEWORK_TASK_ID |
| `module_scope_declare.ts` | — | 可能设置 FRAMEWORK_TASK_ID |
| `gate-before.ts` | — | P2-1 DAG 校验使用 FRAMEWORK_TASK_ID |

### C. 版本历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-06-17 | 1.0.0 | 初始版本：Bug 1 + Bug 2 根因分析与修复方案 |
