# Compliance Gate DISPATCH-INTEGRITY 缺陷分析与修复方案（完整版）

**日期**: 2026-06-18  
**调查人**: @Super-Admin（初审）、@Orchestrator（复审+验证）、@Super-Admin（Fix 3 深度分析）  
**状态**: 2026-06-18 复核后修订：Fix 1、Fix 2、Fix 3a、Fix 3b、Fix 4 主路径已落地；R3 CI 调度路径需修正（双 .mjs 文件缺失）  
**相关文件**: `.opencode/scripts/mcp-tools/compliance-gate.ts`, `.opencode/scripts/command-tools/dispatch-subagent.ts`, `.opencode/tools/dispatch_subagent.ts`, `.opencode/plugins/task-before.ts`, `.opencode/plugins/task-after.ts`, `.opencode/lib/agent-resolver.ts`, `.opencode/lib/db-state-manager.ts`, `.opencode/lib/db-manager.ts`, `.opencode/scripts/nightly-compaction.ts`, `.github/workflows/nightly-compaction.yml`  
**关联文档**: `dag-task-permission-gap-analysis.md`, `dispatch-gap-bug-analysis.md`, `framework-evaluation-report.md`

---

## 0. 2026-06-18 真实性复核结论

本轮按当前代码重新核验后，本文档主体结论“DISPATCH-INTEGRITY 问题存在，且核心修复已落地”基本属实，但原文有 4 处需要修正：

| 项 | 原文表述 | 当前代码复核结论 | 处理 |
|---|---|---|---|
| Fix 3b | "Fix 3b agent/sessionID 字段仍未实施" | **实际已实施！** compliance-gate.ts L781-798 完整实现：session_map ORDER BY DESC 查 agent+session_id，兜底 resolveDispatchTargetAgentDirect()，writeLog 含 sessionID/agent/agentType | **已改为"已实施"** |
| R2/Fix 4 | “session_map INSERT 竞态窗口已修复” | 主路径已缓解：生成器层在 prompt 生成前尝试写入并读回验证，工具层在返回 prompt 前再用 `context.sessionID` best-effort 写入。但工具层写入不阻断、不读回，因此不是强硬保证 | 已改为“主路径已缓解” |
| R3 | "dbCleanStaleEntries 未调度" | `nightly-compaction.ts` 已调用 `dbCleanStaleEntries()`。**新增发现：rotate-logs.mjs 也缺失！** 工作流 L46 调用 `node .opencode/scripts/rotate-logs.mjs`，但只有 `rotate-logs.ts`。两个 `.mjs` 文件均不存在，CI 定时路径需修正 | 已改待办 |
| 验证数量 | “列出全部 19 个 task_id” | 代码行为是 `SELECT DISTINCT` 列出当前 DB 中全部注册 task_id；19 是当时样本数量，不是稳定事实 | 已改为历史样本 |

复核使用的当前实现证据：

1. `compliance-gate.ts` `runGateCheck()` 使用 `SELECT DISTINCT dag_task_id FROM session_map WHERE dag_task_id IS NOT NULL`。
2. `command-tools/dispatch-subagent.ts` 在 preamble 中注入 dispatch-assigned task_id。
3. `command-tools/dispatch-subagent.ts` 在生成 prompt 前尝试写入 `session_map` 并读回验证。
4. `tools/dispatch_subagent.ts` 在返回 wrapped prompt 前基于 `context.sessionID` 再写入 `session_map`。
5. `task-before.ts` 已实现 Task() prompt `DISPATCH_TOKEN` 存在性校验。
6. `nightly-compaction.ts` 已接入 DB maintenance；但 GitHub workflow 路径仍是 `.mjs`。

---

## 一、问题现象

CI-CD-Agent 作为子 Agent 派遣时，`compliance_gate_check` 返回 `DISPATCH-INTEGRITY` 失败:

```
DISPATCH-INTEGRITY: task_id "CI-CD-VERIFY-BUG2" is not registered in any dispatch session.
Registered task_ids: AUDIT-GAP-DOC.
```

CI-CD-Agent 编织了任务 ID "CI-CD-VERIFY-BUG2"（全项目 grep 零匹配，确认为 LLM 幻觉），而非 dispatch 分配的 "VFY-LEAK-FIX"。

---

## 二、完整根因链路（5 层）

```
@Orchestrator → dispatch_subagent(CI-CD-Agent, dag_task_id="VFY-LEAK-FIX")
  │
  ├─ [R4] 生成包装 Prompt — P0 协议中不包含 dag_task_id 值
  │     → 子 Agent LLM 无法读取 process.env，自行编造 task_id
  │
  ├─ [R2] 写 session_map DB — INSERT 与子 Agent 启动存在竞态窗口
  │
  └─ @Orchestrator → Task(prompt) → CI-CD-Agent 启动
       │
       ├─ compliance_gate_check(task_id="CI-CD-VERIFY-BUG2") ← LLM 编造
       │
       ├─ [R1] L748: SELECT dag_task_id LIMIT 1 → 返回任意单个 task_id
       │     → 错误消息只显示 1 个 task_id，误导 Agent
       │
       ├─ [R5] L781: writeLog("DISPATCH_TASKID_TAMPER")
       │     → 缺少 sessionID/callID/agent 字段 → 全为 "—"
       │
       └─ 返回 passed=false → Agent 尝试 drain_stale → 无效 → 任务受阻
```

| # | 根因 | 位置 | 严重度 | 状态 |
|---|------|------|:------:|:----:|
| R1 | LIMIT 1 查询返回任意单个 task_id | compliance-gate.ts L748 | HIGH | ✅ 已修复 |
| R2 | session_map INSERT 竞态窗口 | command-tools/dispatch-subagent.ts + tools/dispatch_subagent.ts + session.ts | HIGH | ✅ 主路径已缓解 |
| R3 | session_map 定期清理链路 | dbCleanStaleEntries + nightly-compaction + GitHub workflow | MEDIUM | ⚠️ 脚本已接入，CI 路径需修 |
| R4 | dispatch prompt 不注入 dag_task_id 值 | dispatch-subagent.ts P0 协议模板 | HIGH | ✅ 已修复 |
| R5 | DISPATCH_TASKID_TAMPER 日志缺上下文 | compliance-gate.ts L781-786 | MEDIUM | ✅ Fix 3a 已实施 detail；✅ Fix 3b 已实施 agent/sessionID 上下文 |

---

## 三、修复方案与当前状态

### Fix 1: LIMIT 1 → SELECT DISTINCT (R1)

**文件**: `compliance-gate.ts` L748

```diff
- `SELECT dag_task_id FROM session_map WHERE dag_task_id IS NOT NULL LIMIT 1`
+ `SELECT DISTINCT dag_task_id FROM session_map WHERE dag_task_id IS NOT NULL`
```

**验证结果**: 当前代码会列出 DB 中全部 DISTINCT 注册 task_id；“19 个”是当时验证样本数量，不是稳定常量 ✅

### Fix 2: dispatch_subagent 注入 dag_task_id (R4)

**文件**: `.opencode/scripts/command-tools/dispatch-subagent.ts` L549-553

```typescript
if (taskId) {
  preamble += `\n> **Your dispatch-assigned task_id**: \`${taskId}\` — use this exact value when calling compliance_gate_check(task_id=...). Do NOT fabricate a different task_id.\n`;
}
```

**历史验证结果**: dispatch 输出文件中曾确认注入 `VFY-INTEG-TEST-1`；当前代码仍保留该注入逻辑 ✅

### Fix 3: 日志上下文 (R5) — 分阶段实施

#### Fix 3a (Phase 1 — 已实施): detail 字段增强

**文件**: `compliance-gate.ts` L781-787

```diff
  writeLog("mcp-compliance-gate", "ERROR", {
    event: "DISPATCH_TASKID_TAMPER",
    provided_task_id: taskId,
    dispatch_registered_task_ids: dispatchAssignedTaskIds,
+   framework_task_id: process.env.FRAMEWORK_TASK_ID || "—",
-   detail: "sub-agent attempted to use a task_id not registered...",
+   detail: `sub-agent attempted to use task_id "${taskId}" not registered. ` +
+            `Registered: [${dispatchAssignedTaskIds.join(", ")}]. ` +
+            `FRAMEWORK_TASK_ID env: ${process.env.FRAMEWORK_TASK_ID || "(empty)"}`,
  });
```

**Phase 1 日志输出**:
```
— | — | — | — | INFO | DISPATCH_TASKID_TAMPER | task_id="CI-CD-FABRICATED-TEST" not registered. Registered: [AUDIT-GAP-DOC, ...19 entries]. FRAMEWORK_TASK_ID env: (empty)
```

#### Fix 3b (Phase 2 — 待实施): agent + sessionID 字段填充

**根因分析**: MCP Server (`compliance-gate.ts`) 运行在独立进程（`StdioServerTransport`），MCP SDK 的 `CallToolRequest` 不携带 OpenCode 的 sessionID/callID/agent 上下文。DISPATCH_TASKID_TAMPER 触发时 taskId 为伪造值，`dbQuerySessionByDagTaskId()` 返回空，无法直接从 session_map 获取 caller 身份。

**来源对比分析**:

| 来源 | agent | sessionID | 竞态风险 | 篡改场景可用 |
|------|:-----:|:---------:|:--------:|:-----------:|
| `_dispatch_target.json` | ✅ | ❌ | **HIGH**（覆盖写入→身份偷换） | ✅ |
| `session_map` (最新条目) | ✅ | ✅ | **LOW**（独立行，ORDER BY 稳定） | ✅ |
| `FRAMEWORK_TASK_ID` env | ❌ | ❌ | 无 | ✅（仅task_id） |
| `OPENCODE_SESSION_ID` env | — | — | — | ❌ **不存在** |

**推荐方案**: session_map 最新条目为主查，`_dispatch_target.json` 为兜底：

```typescript
// Fix 3b: 在 L781 writeLog 之前新增
let _resolvedAgent = "—";
let _resolvedSessionId = "—";

// 优先: session_map 最新条目（DB级，无覆盖写入风险）
try {
  const latestCaller = db.query(
    `SELECT agent, session_id FROM session_map 
     ORDER BY created_at DESC LIMIT 1`
  ).get() as { agent: string; session_id: string } | null;
  if (latestCaller) {
    _resolvedAgent = latestCaller.agent || "—";
    _resolvedSessionId = latestCaller.session_id || "—";
  }
} catch {}

// 兜底: _dispatch_target.json
if (!_resolvedAgent || _resolvedAgent === "—") {
  _resolvedAgent = resolveDispatchTargetAgentDirect() || "—";
}

writeLog("mcp-compliance-gate", "ERROR", {
  sessionID: _resolvedSessionId,   // ← 新增
  callID: "—",                     // MCP Server 无法获取
  agent: _resolvedAgent,           // ← 新增
  agentType: _resolvedAgent,       // ← 新增
  ...
});
```

**Phase 2 预期日志输出**:
```
ses_1272df25... | — | @CI-CD-Agent | @CI-CD-Agent | ERROR | DISPATCH_TASKID_TAMPER | task_id="CI-CD-FABRICATED-TEST" not registered. Registered: [19 entries]. FRAMEWORK_TASK_ID env: (empty)
```

**session_map vs _dispatch_target.json 竞态对比**:

```
场景：并行派遣 @CI-CD-Agent 和 @Coder-BE

_dispatch_target.json (覆盖写入):
  t0: write {"agent":"@CI-CD-Agent"}      → 文件中: CI-CD-Agent
  t1: write {"agent":"@Coder-BE"}          → 文件中: Coder-BE (覆盖！)
  t2: CI-CD-Agent 读取                      → "@Coder-BE" ❌ 身份偷换

session_map (独立行):
  t0: INSERT (session_1, "@CI-CD-Agent")  → DB: 2 行
  t1: INSERT (session_2, "@Coder-BE")     → DB: 2 行 (不覆盖)
  t2: CI-CD-Agent 查 ORDER BY DESC LIMIT 1 → "@Coder-BE" ⚠️ 时序偏移(非身份偷换)
```

**核心差异**: `_dispatch_target.json` 竞态是**破坏性覆盖**，`session_map` 竞态是**时序偏移**（数据本身正确）。

### Fix 4: session_map INSERT 时序保证 (R2)

**文件**:
- `.opencode/scripts/command-tools/dispatch-subagent.ts` L555-578
- `.opencode/tools/dispatch_subagent.ts` L587-605

当前实现是双路径缓解：

1. 生成器层：在 Prompt 生成之前，如果 `OPENCODE_SESSION_ID` 存在，则同步写入 `session_map` 并读回验证。
2. 工具层：在返回 wrapped prompt 给主 Agent 之前，如果 `context.sessionID` 存在，则再次写入 `session_map`，并保留现有 agent 身份，避免 parent session agent 被临时污染。

生成器层实现：

```typescript
if (taskId) {
  try {
    const { dbWriteSessionMap, dbReadSessionMap } = require("../../lib/db-state-manager");
    const sessionId = process.env.OPENCODE_SESSION_ID || "";
    if (sessionId) {
      dbWriteSessionMap(sessionId, agentType, taskId);
      const verify = dbReadSessionMap(sessionId);
      if (!verify?.dag_task_id) {
        writeLog("dispatch-subagent", "ERROR", { ... });
      }
    }
  } catch (e) { ... }
}
```

工具层实现：

```typescript
if (dagTaskId && context.sessionID) {
  const existing = dbReadSessionMap(context.sessionID);
  dbWriteSessionMap(
    context.sessionID,
    existing?.agent || args.agent_type,
    dagTaskId,
    inferredDomainId || undefined,
  );
}
```

**复核结论**: R2 主路径已缓解，但工具层写入是 best-effort，不阻断、不读回验证；因此不能表述为“强硬保证”。✅/⚠️

---

## 四、关联 Bug（已修复）

| Bug | 描述 | 修复文件 | 状态 |
|-----|------|---------|:----:|
| Bug 1 | Task() 无 DISPATCH_TOKEN 存在性校验 | `plugins/task-before.ts` (新, 93 行) | ✅ strict/locked 阻断；仅校验 token 存在性 |
| Bug 2 | FRAMEWORK_TASK_ID 泄漏 | `tools/dispatch_subagent.ts` save/restore + `command-tools/dispatch-subagent.ts` save/restore | ✅ |

---

## 五、集成验证结果

| # | 测试 | 方式 | 结果 |
|:--:|------|------|:----:|
| 1 | Fix 2: Preamble 注入 | **实际派遣@Knowledge-Curator + @CI-CD-Agent** 确认 preamble 含 task_id | ✅ |
| 2 | Fix 4: session_map 预写 | **实际派遣确认** session_map 预写 + 子Agent compliance_gate_check 使用正确 task_id | ✅/⚠️ 主路径缓解 |
| 3 | Fix 1: SELECT DISTINCT | 触发 TAMPER → 列出当前 DB 全部 DISTINCT task_id | ✅ |
| 4 | Fix 3a: detail 字段 | 日志含 task_id + Registered + FRAMEWORK_TASK_ID | ✅ |
| 5 | Bug 1: task-before.ts | **实际派遣确认** — 两次 Task() 均未被阻断（DISPATCH_TOKEN 存在） | ✅ |
| 6 | Bug 2: FRAMEWORK_TASK_ID save/restore | **实际派遣确认** — dispatch后env正确恢复。**发现 gap：env 未传递到子Agent进程**（by design，v4 改用 preamble 注入） | ✅ main ⚠️ gap |
| 7 | Fix 3b: agent/sessionID 上下文 | **实际派遣+代码复核双确认** compliance-gate.ts L781-798 | ✅ |
| 8 | DAG 链路传递 | dispatch-before → dispatch-subagent → task-after 全链路 | ✅ |
| 9 | Fix 3b agent/sessionID 日志 | compliance-gate.ts L802-805 含 sessionID/agent/agentType | ✅ 代码确认 |
| 10 | Preamble task_id 注入 | **实际派遣 @Knowledge-Curator 确认**：收到 VFY-DISPATCH-INTEG-001 | ✅ |
| 11 | Preamble task_id 注入 | **实际派遣 @CI-CD-Agent 确认**：收到 VFY-DISPATCH-INTEG-002 | ✅ |
| 12 | DISPATCH_TOKEN 校验 | **实际派遣 Task() 两次均未被 task-before.ts 阻断** | ✅ |
| 13 | compliance_gate_check API | **实际派遣确认** — 子Agent能使用正确 task_id 调用并创建 session | ✅ |
| 14 | FRAMEWORK_TASK_ID env → 子Agent | **实际派遣 @CI-CD-Agent 确认** — 子Agent process 中找不到 FRAMEWORK_TASK_ID | ❌ **by design**（v4 改用 preamble 注入） |
| 15 | .dispatch_ctx 文件机制 | @Super-Admin 审计确认 — v4 改用 .dispatch_ctx + session_map | ✅ |
| 16 | R3 cleanup: dbCleanStaleEntries | nightly-compaction.ts L197 | ✅ 已接入脚本 |
| 17 | R3 CI path: nightly-compaction | 工作流 L43 调用 .mjs，但文件不存在 | ❌ 待修正 |
| 18 | R3 CI path: rotate-logs | 工作流 L46 调用 .mjs，但文件不存在 | ❌ 待修正 |

---

## 六、framework-evaluation-report.md 更新

评估报告已追加两节：
- **§4c-2**: DISPATCH-INTEGRITY 缺陷（5 层根因 + 修复方案 + 关联修复）
- **§13**: Framework DB Management System（DB 架构 + 5 个问题 + 优化方向）

---

## 七、待办

| 优先级 | 项 | 说明 |
|:------:|----|------|
| P1 | ~~Fix 3b: session_map agent/sessionID 上下文~~ | **已实施** — compliance-gate.ts L781-798 验证通过，无需修改 |
| P1 | 修正 nightly-compaction.yml CI 双路径 | 工作流 L43 调用 `nightly-compaction.mjs`、L46 调用 `rotate-logs.mjs`，**两个 .mjs 文件均不存在**。改为 `npx tsx .opencode/scripts/nightly-compaction.ts --dag` 和 `npx tsx .opencode/scripts/rotate-logs.ts` |
| P2 | session_map TTL 定期清理验证 | `nightly-compaction.ts` 已接入 `dbCleanStaleEntries()`；修正 CI 路径后需验证定时执行成功 |
| P2 | FRAMEWORK_TASK_ID 双语义统一 | dispatch-subagent.ts L15 说"非DAG ID"，gate-before.ts L147 当 DAG ID 用。@Super-Admin 建议拆分两个变量 |
| P2 | `runGateCheck()` 签名重构 | 传递 request.params 上下文，替代零散的环境变量/文件读取 |

---



---

## 九、实际集成测试发现的 Gap

### Gap 1: FRAMEWORK_TASK_ID env var 不传递到子Agent（by design）

**发现方式**: 实际派遣 @CI-CD-Agent，子Agent 报告 `echo $FRAMEWORK_TASK_ID` 为空。

**根本原因**: v4 修复（S25-FIX-V4）后，任务 ID 传递机制改为：
- ✅ **Preamble 文本注入**（主力）：`"Your dispatch-assigned task_id: \`{taskId}\`"`
- ✅ **.dispatch_ctx 文件**（工具层）：`dispatch_subagent.ts` L564-585 写入，`task-after.ts` L162 读取
- ✅ **session_map DB**（门禁层）：`compliance-gate.ts` L748 `SELECT DISTINCT` 查询
- ❌ ~~环境变量~~：不再传递到子Agent

**是否问题**: 不是 — 这是 v4 修复的刻意设计。Bug 2（env 污染导致永久 DAG 阻断）已通过 save/restore + 非 env 传递解决。

### Gap 2: FRAMEWORK_TASK_ID 双语义冲突

| 来源 | 说法 | 强制方式 |
|---|------|---------|
| `dispatch-subagent.ts` L15 | "dispatch session identifier — NOT a DAG task ID" | 仅注释 |
| `gate-before.ts` L147 | "treated as a DAG task ID by this audit" | strict/locked 物理阻断 |
| `dispatch_subagent.ts` L220-221 | 两种语义都描述 | 工具文档 |

**影响**: 非 DAG-exempt Agent 使用非 DAG 的 session ID 时，gate-before.ts 会阻断修改工具。

### Gap 3: CI 双 .mjs 文件缺失（未变）

`nightly-compaction.yml` 中两个 `.mjs` 路径均指向不存在的文件。

---

## 十、集成测试方法

| 测试 | 派遣 Agent | 测试内容 | 结果 |
|:---:|---|---------|:----:|
| Test 1 | @Knowledge-Curator (DAG-exempt) | task_id 注入 + DISPATCH_TOKEN + gate_check | ✅ 全部通过 |
| Test 2 | @CI-CD-Agent (non-exempt, auto_plan) | 同上 + FRAMEWORK_TASK_ID env | ✅ 前3项，❌ env |
| Test 3 | @Super-Admin (DAG-exempt) | FRAMEWORK_TASK_ID 全代码审计 | ✅ 完整报告 |

## 八、版本历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-06-18 | 1.0.0 | 初始版本：SA 诊断审核 + R4/R5 补充 + 4 项修复 + 日志集成规范 |
| 2026-06-18 | 2.0.0 | Fix 3 深度分析：session_map vs _dispatch_target.json 竞态对比 + Phase 2 方案 |
| 2026-06-18 | 2.1.0 | 当前代码复核：修正 Fix 3 状态、R2 强度、R3 nightly-compaction/CI 路径、历史验证数量表述 |
| 2026-06-18 | 3.0.0 | **全代码复核验证**：Fix 3b 确认已实施（改"待实施"→"已实施"）；新增 R3 rotate-logs.mjs 缺失发现；更新 §五 验证表 11 项；更新 §七 待办；补充 § 0 复核结论 |
| 2026-06-18 | 4.0.0 | **实际派遣集成测试**：派遣子Agent 3 次（@Knowledge-Curator + @CI-CD-Agent + @Super-Admin）。验证表扩展至 15 项。发现 FRAMEWORK_TASK_ID env 不传递到子Agent（by design，v4 改用 preamble 注入）。发现双语义冲突。新增 §九 Gap 分析 + §十 测试方法 |
