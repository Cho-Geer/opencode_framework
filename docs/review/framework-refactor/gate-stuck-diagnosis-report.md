# 合规门无法关闭 — 根因诊断报告

**日期：** 2026-06-16
**诊断者：** @Orchestrator（数据收集 + 路径验证）+ @Meta-Planner（根因分析 DIAG-GATE-STUCK-ROOTCAUSE）
**状态：** 根因已确认，修复方案已制定

---

## 一、症状

每次派遣 subagent 执行任务时，合规门（compliance gate）**系统性无法关闭**。`gate_sessions` 表中 **7/9（78%）** 的会话处于 `recoverable` 状态，全部报告相同错误：

> "Missing required task artifacts: HANDOVER.md, TASK_LOG.md"

然而验证确认，所有 7 个 `task_id` 对应的 `.task_temp/{task_id}/` 目录下**现在都有** HANDOVER.md 和 TASK_LOG.md。路径解析正确，不存在路径不匹配问题。

| Session ID | task_id | 状态 | 失败原因 |
|------------|---------|:--:|------|
| cg_ses_1781611025591 | VERIFY-FINAL-005 | recoverable | HANDOVER.md, TASK_LOG.md 缺失 |
| cg_ses_1781611111902 | VERIFY-FINAL-005-GATE-TEST | recoverable | HANDOVER.md, TASK_LOG.md 缺失 |
| cg_ses_1781611425402 | UPDATE-EVAL-REPORT-006 | recoverable | HANDOVER.md, TASK_LOG.md 缺失 |
| cg_ses_1781612284216 | UPDATE-VERIFY-RPT-007 | recoverable | HANDOVER.md, TASK_LOG.md 缺失 |
| cg_ses_1781618850207 | KC-MULTI-AGENT-ARCH-RESEARCH | recoverable | HANDOVER.md, TASK_LOG.md 缺失 |
| cg_ses_1781619129130 | VERIFY-P3-FINAL | recoverable | HANDOVER.md, TASK_LOG.md 缺失 |
| cg_ses_1781619427371 | SAVE-P3-VERIFY-RPT | recoverable | HANDOVER.md, TASK_LOG.md 缺失 |

---

## 二、验证过程

### 2.1 路径解析验证

- `OPENCODE_ROOT`: `/home/zhaoge/workspace/opencode/work-one`
- `validateTaskArtifacts` 检查路径: `.task_temp/{resolvedId}/HANDOVER.md`
- 7 个 task_id 对应的目录下，artifact 文件全部存在 ✅

### 2.2 代码追踪

| 位置 | 行号 | 内容 |
|------|:--:|------|
| compliance-gate.ts | L1299 | `validateTaskArtifacts(session.task_id, sessionId)` |
| gate-core.ts | L967 | `resolvedId = taskId || sessionId` |
| gate-core.ts | L970 | `taskDir = .task_temp/{resolvedId}` |
| compliance-gate.ts | L1300-1301 | strict/locked 模式: 缺失时 `retry_count++` |
| compliance-gate.ts | L1333-1334 | 缺失 → `gate_status='recoverable'` |
| compliance-gate.ts | L1757-1762 | `retry_confirm` 仅限 @Super-Admin/@Orchestrator |

### 2.3 自动触发检查

检查了 7 个插件（gate-before, gate-after, task-after, dispatch-before, dispatch-after, session, scope-after）— **没有一个**在 Task() session 结束时自动调用 `compliance_gate_complete`。

---

## 三、根因分析

### 🥇 根因 #1（主）：FW-SLIM-03 删除了 P0 协议中的 close-gate 指令

**文件：** `.opencode/subagent-preamble.md`（68 行，从 163 行瘦身）

FW-SLIM-03 注释写道 "Step 4 enforced by compliance_gate_complete MCP tool" — 但 **MCP 工具不能调用自己**。LLM 必须主动调用 `compliance_gate_complete`。瘦身后 subagent 收到的 P0 Protocol 中不再包含显式的 close-gate 步骤。每个 dispatch prompt 中唯一提到 complete 的地方是 "Invocation Summary" 审计表格（归类为"审计追踪"而非"强制协议"）。

**影响：** LLM 可能完全忘记调用 `compliance_gate_complete`，或在错误时机调用。

### 🥈 根因 #2（副）：Complete 在 Artifact 写入之前被调用

由于没有显式的顺序约束，LLM 可能立即调用 `compliance_gate_complete`，但 HANDOVER.md / TASK_LOG.md 还没写。`validateTaskArtifacts` 返回缺失 → `retry_count=1` → `recoverable`。

> **Meta-Planner 诊断任务中已复现此 bug**：DIAG-GATE-STUCK-ROOTCAUSE 任务的 `compliance_gate_complete` 首次调用返回 `recoverable`。

### 🥉 根因 #3（系统）：无可恢复状态的自我修复路径

`recoverable` → 唯一出口是 `compliance_gate_retry_confirm`，但该工具**仅限于 @Super-Admin / @Orchestrator**。Subagent（@Coder-BE/FE、@Guardian、@Architect 等）在 recoverable 状态下**完全无法自我修复**。即使 artifact 文件后来被写入，subagent 也无法重试 complete。

**死锁链：**
```
compliance_gate_complete (过早) → recoverable
  → artifact write (太晚)
    → compliance_gate_complete 重试 → "session not armed (recoverable)"
      → compliance_gate_retry_confirm → "restricted to @Super-Admin/@Orchestrator"
        → 🪦 gate stuck forever (until drain or admin intervention)
```

---

## 四、修复方案

| 优先级 | 方案 | 修改文件 | 工作量 |
|:-----:|------|---------|:-----:|
| **P0** | 恢复 preamble Step 4 close-gate 指令 + 修正 Execution Order | `subagent-preamble.md`, `dispatch-subagent.ts` | ~15 行 |
| **P1** | 放宽 retry_confirm 权限：允许 agent 自我修复 recoverable | `compliance-gate.ts` | ~5 行 |
| **P2** | dispatch-after.ts auto-complete 钩子作为安全网 | `dispatch-after.ts` | ~20 行 |
| **P2** | dispatch wrapper 注入显式 pre-termination checklist | `dispatch-subagent.ts` | ~10 行 |

### P0 修复详细说明

在 `subagent-preamble.md` 的 Execution Order 中恢复：

```
### Step 4: Close Gate — P0 Mandatory

After completing the task and writing all artifacts:
1. Call compliance_gate_complete(session_id, execution_summary) to close the gate
2. This MUST be the LAST tool call in your session
3. Failure to call this results in an unrecoverable gate session

⚠️ IMPORTANT: Call complete ONLY after writing HANDOVER.md, TASK_LOG.md,
and any other required artifacts. Calling complete before artifacts
exist will permanently block the gate.
```

### P1 修复详细说明

在 `compliance-gate.ts` 的 `retry_confirm` 处理器中，将权限检查从仅 @Super-Admin/@Orchestrator 改为：允许**与原始 session agent 相同的 agent** 执行 retry。

---

## 五、附加发现

### agent-type-agnostic artifact 要求

当前 `validateTaskArtifacts` 对所有 agent 类型**一视同仁**地要求 HANDOVER.md + TASK_LOG.md，包括 @Meta-Planner（输出 Project.graph/DAG）、@Guardian（输出审查报告）、@Arbiter（输出裁决）。应考虑根据 `agent_type` 区分 artifact 要求。

---

*诊断报告由 @Orchestrator + @Meta-Planner 联合生成，2026-06-16*
