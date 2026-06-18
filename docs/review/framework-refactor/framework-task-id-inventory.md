# FRAMEWORK_TASK_ID 残留清单

**调查日期**: 2026-06-18  
**调查 Agent**: @Orchestrator  

---

## 总览

FRAMEWORK_TASK_ID 设计意图已被 `.dispatch_ctx` + session_map DB 替代（见 S25-FIX-V4），但仍有 **19 处执行级残留** 分布在 **5 个活跃文件** 中。另有 **30 处测试文件引用**（2 个测试文件）需在清理时同步更新。此外发现 **1 个运行时 TDZ Bug**（L851 ReferenceError）。

---

## 第一类：ENV VAR READ — 运行时读取值（直接产生依赖）

| # | 文件 | 行 | 代码 | 用途 |
|---|------|:--:|------|------|
| 1 | `.opencode/lib/agent-resolver.ts` | 99 | `process.env.FRAMEWORK_TASK_ID \|\| ""` | **Priority 0** — session_map DB 前先读 env |
| 2 | `.opencode/scripts/command-tools/dispatch-subagent.ts` | 86 | `const _savedFwTaskId = process.env.FRAMEWORK_TASK_ID` | 入口保存 |
| 3 | 同上 | 87 | `let taskId = process.env.FRAMEWORK_TASK_ID \|\| null` | 主流程读取 |
| 4 | 同上 | 851 | `process.env.FRAMEWORK_TASK_ID \|\| taskId \|\| "(unknown)"` | 输出日志 |
| 5 | 同上 | 892 | `process.env.FRAMEWORK_TASK_ID \|\| taskId \|\| "(unknown)"` | resume 日志 |
| 6 | 同上 | 924 | `process.env.FRAMEWORK_TASK_ID \|\| taskId \|\| null` | 审计追踪 |
| 7 | 同上 | 932 | `taskId=${process.env.FRAMEWORK_TASK_ID \|\| taskId \|\| 'null'}` | 日志格式化 |
| 8 | `.opencode/scripts/mcp-tools/compliance-gate.ts` | 809 | `process.env.FRAMEWORK_TASK_ID \|\| "—"` | 审计日志输出 |
| 9 | 同上 | 810 | `FRAMEWORK_TASK_ID env: ${process.env.FRAMEWORK_TASK_ID \|\| "(empty)"}` | 错误详情 |
| 10 | 同上 | 1079 | `taskId \|\| process.env.FRAMEWORK_TASK_ID \|\| ""` | task_id fallback |
| 11 | 同上 | 2171 | 描述字符串引用 FRAMEWORK_TASK_ID | 参数文档 |
| 12 | `.opencode/plugins/task-after.ts` | 162 | 注释描述 fallback 路径 | 注释 |

## 第二类：ENV VAR WRITE — 运行时写入（产生污染源）

| # | 文件 | 行 | 代码 | 用途 |
|---|------|:--:|------|------|
| 13 | `.opencode/tools/dispatch_subagent.ts` | 266 | `process.env.FRAMEWORK_TASK_ID = args.dag_task_id` | **父进程写入** — 在 execFileSync 前置入 |
| 14 | 同上 | 630 | `delete process.env.FRAMEWORK_TASK_ID` | finally 清理 |
| 15 | 同上 | 632 | `process.env.FRAMEWORK_TASK_ID = savedTaskId` | finally 恢复 |
| 16 | `.opencode/scripts/command-tools/dispatch-subagent.ts` | 106 | `process.env.FRAMEWORK_TASK_ID = taskId \|\| ""` | 脚本写入 |
| 17 | 同上 | 997 | `process.env.FRAMEWORK_TASK_ID = _savedFwTaskId` | 脚本恢复 |

## 第三类：SUB-PROCESS INHERIT — 传给子进程 env

| # | 文件 | 行 | 代码 | 用途 |
|---|------|:--:|------|------|
| 18 | `.opencode/tools/dispatch_subagent.ts` | 530 | `...(dagTaskId ? { FRAMEWORK_TASK_ID: dagTaskId } : {})` | **传给 dispatch-subagent.js 子进程** |
| 19 | 同上 | 320 | `FRAMEWORK_TASK_ID: planningDagId` | **传给 auto-plan Meta-Planner 子进程** |

## 🚨 已发现缺陷：L851 运行时 TDZ (Temporal Dead Zone) Bug

`dispatch-subagent.ts` L851 存在 **ReferenceError** 级别 Bug：

```js
// Line 87 (script-level):
let taskId = process.env.FRAMEWORK_TASK_ID || null;

// Line 850-851 (inside if block):
if (dedupedEntries.length > 0) {
  const taskId = process.env.FRAMEWORK_TASK_ID || taskId || "(unknown)";  // ← TDZ!
```

`const taskId` 在 block scope 内 shadow 了外层的 `let taskId`。JavaScript TDZ 规则导致 `|| taskId` 引用的是尚未初始化的 `const taskId` 自身，而非外层的 `let taskId`。**当 `dedupedEntries.length > 0` 时（即 dag_task_id 复用被检测到时），此行必然抛出 ReferenceError 导致脚本崩溃**。

已用 Node.js v22 验证：`let x = 'outer'; { const x = x || 'fallback'; }` → `ReferenceError: Cannot access 'x' before initialization`。

**修复方案**: 将 L851 改为 `const resolvedTaskId = process.env.FRAMEWORK_TASK_ID || taskId || "(unknown)";` 并更新后续引用。

## 第四类：测试文件引用（不计入执行级残留，但清理时必须同步更新）

| # | 文件 | 引用次数 | 性质 |
|---|------|:-------:|------|
| — | `.opencode/scripts/__tests__/framework-enforcer.test.js` | 14 | 测试用 `process.env.FRAMEWORK_TASK_ID = "TEST-001"` 设置环境 |
| — | `.opencode/scripts/__tests__/dispatch-subagent.test.js` | 16 | 测试 FRAMEWORK_TASK_ID 传播逻辑（3 个独立 test case） |

## 文件索引

```
.opencode/lib/agent-resolver.ts                                    →  L99
.opencode/plugins/gate-before.ts                                   →  L147 (error message string only)
.opencode/plugins/task-after.ts                                    →  L139, L162 (comments)
.opencode/scripts/command-tools/dispatch-subagent.ts               →  L13, L15, L82, L86, L87, L106, L550, L851⚠️, L892, L924, L932, L997
.opencode/scripts/mcp-tools/compliance-gate.ts                     →  L809, L810, L1079, L2171
.opencode/tools/dispatch_subagent.ts                               →  L220, L221, L253, L254, L262, L264, L266, L305, L320, L362, L530, L573, L625, L630, L632
.opencode/tools/knowledge_cache_search.ts                          →  L32, L33, L38 (comments only)
.opencode/scripts/__tests__/dispatch-subagent.test.js              →  16 refs (test cases)
.opencode/scripts/__tests__/framework-enforcer.test.js             →  14 refs (test setup)
```

⚠️ = 存在 TDZ Bug（详见"已发现缺陷"节）

## 清理建议

### 执行顺序（P0 → P1，有依赖关系）

| 优先级 | 文件 | 改动 | 说明 |
|--------|------|------|------|
| **P0-BUG** | `.opencode/scripts/command-tools/dispatch-subagent.ts` L851 | 修复 TDZ Bug：`const taskId` → `const resolvedTaskId` | **必须先修**。运行时 ReferenceError，影响 dag_task_id 复用检测的错误提示路径 |
| **P0** | `.opencode/tools/dispatch_subagent.ts` L266 | 停止父进程写入 `process.env.FRAMEWORK_TASK_ID` | 改为只在子进程 env 对象中传递（L530, L320 保留） |
| **P0** | `.opencode/lib/agent-resolver.ts` L99-100 | 删除 `process.env.FRAMEWORK_TASK_ID` Priority 0 检查 | session_map DB 已成为唯一主路径 |
| **P1** | `.opencode/scripts/command-tools/dispatch-subagent.ts` L87, 106 | 改为从 `.dispatch_ctx` 文件或 `--task-id` CLI 参数读取 task_id | **依赖 P0 L266**: 父进程停止写入 env 后，子进程需改用替代源 |
| **P1** | `.opencode/scripts/command-tools/dispatch-subagent.ts` L851, 892, 924, 932 | 将 `process.env.FRAMEWORK_TASK_ID` fallback 改为 `taskId`（已从 CLI/文件获取） | 与 P1 L87/106 同步 |
| **P1** | `.opencode/scripts/mcp-tools/compliance-gate.ts` L809, 810, 1079 | 改读 session_map DB 或 `.dispatch_ctx` | 审计/互斥逻辑需要 task_id，不再依赖 env |
| **P1** | `.opencode/tools/dispatch_subagent.ts` L630, 632 | 删除 finally 块中的 save/restore 逻辑 | P0 L266 停止写入后，save/restore 不再需要 |

### 可延后处理

| 优先级 | 文件 | 改动 |
|--------|------|------|
| P2 | `.opencode/tools/dispatch_subagent.ts` L220-221, L253-254, L262, L305, L362, L573, L625 | 清理注释中对 FRAMEWORK_TASK_ID 的引用 |
| P2 | `.opencode/scripts/command-tools/dispatch-subagent.ts` L13, L15, L82, L550 | 清理注释/文档字符串引用 |
| P2 | `.opencode/plugins/task-after.ts` L139, L162 | 清理注释引用 |
| P2 | `.opencode/plugins/gate-before.ts` L147 | 清理错误消息字符串引用（需评估是否影响用户理解） |
| P2 | `.opencode/tools/knowledge_cache_search.ts` L32, L33, L38 | 清理注释引用 |

### 测试文件同步更新（与 P0/P1 同步）

| 文件 | 引用次数 | 影响 |
|------|:-------:|------|
| `.opencode/scripts/__tests__/framework-enforcer.test.js` | 14 | 如果 FRAMEWORK_TASK_ID env 被完全移除，这些测试需改为 mock session_map DB 或 `.dispatch_ctx` |
| `.opencode/scripts/__tests__/dispatch-subagent.test.js` | 16 | 3 个 test case 直接测试 FRAMEWORK_TASK_ID 传播，移除后需重写为测试 `.dispatch_ctx` 或 CLI 参数传播 |

### 清理顺序约束图

```
P0-BUG: L851 TDZ fix (独立，可先修)
   ↓
P0: dispatch_subagent.ts L266 (停止 env 写入)
   ↓  同时修改 L630/632 (删除 save/restore)
   ↓  同时修改 agent-resolver.ts L99 (删除 Priority 0 env 读取)
   ↓
P1: dispatch-subagent.ts L87/106 (改用 CLI/文件读取)
   ↓  同时修改 L851/892/924/932 (移除 env fallback)
   ↓
P1: compliance-gate.ts (改读 DB/文件)
   ↓
P2: 清理所有注释引用 + 测试文件重写
```
