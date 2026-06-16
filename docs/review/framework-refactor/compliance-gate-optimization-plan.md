# Compliance Gate 优化可行性分析与实施方案

**日期：** 2026-06-15
**关联文档：** `framework-evaluation-report.md` §4c

---

## 一、设计背景

### 核心问题

Compliance Gate 三步协议（`check → confirm → complete`）的设计初衷是正确的——通过强制性 MCP 调用确保 LLM 不跳过对实际开发中减少错误、减少幻觉、减少漂移的重要步骤，追求开发的正确性、准确性、一致性。

但当前实现存在可靠性问题：历史数据显示曾出现 26 个 drained sessions（agent 经常忘记调用 `complete`），当前 gate-state.json 仅剩 3 个会话（1 armed, 2 checked, 0 drained），说明排空机制已生效清理了历史积压。

### 价值双层分析

Compliance Gate 的价值是**双层**的，需要区分对待：

| 层次 | 机制 | 价值 |
|------|------|------|
| **认知层** | LLM 主动调用 `check`/`confirm`/`complete`，在 context 中形成流程意识 | 注意力锚定——迫使 LLM 明确表述任务目标、规划步骤、反思结果 |
| **机械层** | 每次 MCP 调用内部执行 artifact 完整性验证、DAG 状态检查、权限合规 | 物理验证——不满足条件时返回结构化失败原因 |

### 三步协议的认知锚点

- **`check`（任务开始时）**：LLM 被迫明确表述 `task_description`，这个表述本身就是一种自我约束——后续执行会倾向于与初始表述保持一致。
- **`confirm`（计划确认后）**：LLM 被迫输出 `plan_summary`，在动手前先规划。这个 plan_summary 会留在后续 context 中，作为执行阶段的参照锚点。
- **`complete`（任务结束时）**：LLM 被迫输出 `execution_summary`，对刚完成的工作进行反思总结。

### `complete` 自修正循环的核心价值

当 LLM 调用 `complete` 且验证不通过时，框架返回结构化的失败原因，LLM 即时修正后重试：

```
LLM 调用 complete → 返回 "missing test_report.json"
  → LLM 补写 test_report.json → 再次调用 complete
  → 返回 "execution_evidence 字段缺失"
  → LLM 补充 execution_evidence → 再次调用 complete → pass ✓
```

这个自修正循环之所以高效，依赖三个条件：
1. **反馈即时**：LLM 还在任务 context 中，对刚做了什么有完整记忆，修正成本低
2. **反馈精确**：MCP 工具返回结构化失败原因（具体缺哪个 artifact、哪个字段），LLM 可直接针对性修复
3. **闭环在 LLM 端**：LLM 自己驱动修复→重试，过程本身强化了对"什么才算完成"的认知

如果将 `complete` 下沉到框架机械层（如 pre-commit hook），自修正循环变为：

```
LLM 写代码 → git commit → hook 返回 "missing test_report.json"
  → LLM 收到 hook 报错 → 但 context 可能已压缩/切换 → 修正成本显著升高
```

**结论：`complete` 必须保留在 LLM 层，因为自修正循环的即时反馈价值无法被框架层替代。**

### 优化核心原则

**不替代 LLM 参与，而是降低 LLM 遗忘的概率。**

---

## 二、当前实现

### 工具类型

Compliance gate 工具是 **MCP Tools**（非 Custom Tools）：
- 定义在 `.opencode/scripts/mcp-tools/compliance-gate.ts`（1963行）
- 通过 `@modelcontextprotocol/sdk` 注册为 MCP server
- 在 `opencode.json` 中配置为 `"compliance-gate"` MCP server
- LLM 调用时使用 `<server-name>_<tool-name>` 格式

### 参数 Schema

**`compliance_gate_check`**：
```json
{
  "properties": {
    "task_description": { "type": "string" },
    "task_id": { "type": "string" }
  },
  "required": ["task_description"]
}
```

**`compliance_gate_confirm`**：
```json
{
  "properties": {
    "session_id": { "type": "string" },
    "plan_summary": { "type": "string" },
    "task_id": { "type": "string" },
    "agent": { "type": "string" }
  },
  "required": ["session_id", "plan_summary"]
}
```

**`compliance_gate_complete`**：
```json
{
  "properties": {
    "session_id": { "type": "string" },
    "execution_summary": { "type": "string" }
  },
  "required": ["session_id", "execution_summary"]
}
```

### 状态机

```
check → creates session (status: checked)
confirm → arms session (status: armed, confirmed_at set)
complete → completes session (status: completed, consumed_at set)
```

### 返回值

**check 返回**：
```json
{
  "passed": true/false,
  "session_id": "cg_ses_xxx",
  "enforcement_mode": "strict",
  "failed_items": [],
  "rule_status": {}
}
```

**confirm 返回**：
```json
{
  "status": "armed",
  "session_id": "cg_ses_xxx",
  "confirmed_at": "2026-06-15T...",
  "expires_at": "2026-06-16T...",
  "plan_summary": "..."
}
```

---

## 三、优化方案（5 项）

### Point 1: 三步压缩为两步 — 合并 confirm 到 check

**提案：** 将 `confirm` 合并到 `check` 中——`check` 的返回值即为确认，LLM 只需记住 2 次调用（开始 + 结束），工作记忆负担降低 33%。

**实施：** 修改 `.opencode/scripts/mcp-tools/compliance-gate.ts` 中的 `runGateCheck()` 函数：
- 新增可选参数 `plan_summary`（string）
- 当 `plan_summary` 提供时，工具在单次调用中同时执行 check + confirm（创建 session → 立即 arm）
- 返回值合并：返回 `session_id` + `armed: true` + `plan_summary` + 提醒文本（见 Point 2）
- 现有 `compliance_gate_confirm` 工具保留向后兼容，但变为可选

**状态机变更：**
```
check(含 plan_summary) → creates + arms session (status: armed)  ← 合并
check(无 plan_summary) → creates session (status: checked)        ← 兼容旧行为
complete → completes session (status: completed)
```

**可行性：** 可行。`gate-core.ts` 的 `createSession()` → `armSession()` 可顺序调用，无阻塞。`pre-commit hook` 的 `findArmedSession()` 能正确识别合并后的 armed session。

**OpenCode 依据：** MCP Server handler 完全控制工具逻辑和返回值。

---

### Point 2: check 返回值中嵌入强提示

**提案：** 在 `check` 的返回值中显式包含"你必须在任务完成时调用 `compliance_gate_complete`"的提醒文本，使后续 context 中始终存在调用提示。

**实施：** 修改 `.opencode/scripts/mcp-tools/compliance-gate.ts` 的 MCP response handler：
- 当 check 成功（或 check+confirm 合并成功）时，在返回的 `text` 字段末尾追加提醒文本块：

```
✅ GATE ARMED [session: cg_ses_xxx]

⚠️ REMINDER: You MUST call compliance_gate_complete with:
   - session_id: "cg_ses_xxx"
   - execution_summary: "<summary of what you accomplished>"
when this task finishes. Failure to do so will leave the gate in armed state
and block future commits.
```

- 该文本随 MCP 工具返回值进入 LLM 的对话 context，并一直保留直到 context 压缩

**可行性：** 可行。MCP Tool 返回内容完全可控。

**OpenCode 依据：** MCP Server 的 `CallToolRequestSchema` handler 返回 `{ content: [{ type: "text", text: "..." }] }`，text 字段可自由定制。

---

### Point 3: 框架层兜底提醒（非替代）

**提案：** 当 Task 完成但 gate 仍处于 armed 状态时，框架注入提醒信息（而非自动执行 complete），促使 LLM 主动调用。

**OpenCode 官方能力评估：**

| Hook | 官方文档中的能力 | 能注入 LLM context? |
|------|----------------|-------------------|
| `tool.execute.after` | 可观察工具执行结果，执行副作用 | **否** — hook 签名 `Promise<void>` |
| `message.part.updated` | 通知/观察事件 | **否** — 无注入接口 |
| `session.idle` | 触发副作用（桌面通知等） | **否** — 仅副作用 |
| `tui.prompt.append` | 向用户 TUI 追加文本 | **否** — 无插件可调用 API（见下方说明） |
| `tui.toast.show` | 弹出 toast 通知 | **否** — 仅通知 |
| `experimental.session.compacting` | 可 `output.context.push()` | **是** — 但仅在 context 压缩时触发 |

**关键发现：** OpenCode 插件系统**没有**向 LLM 活跃对话 context 注入文本的 API。`message.part.updated` 和 `session.idle` 都是观察/通知类事件，不支持内容注入。

**`tui.prompt.append` 可行性澄清（实施阶段发现）：**
官方文档（`plugins.md` L128-131）将 `tui.prompt.append` 列为 TUI 事件之一，但**未提供插件主动触发该事件的 API**。插件架构是纯事件驱动（hooks subscribe to events）——插件只能订阅事件，不能触发事件。实际搜索全 `.opencode/` 目录确认零调用。因此实施时采用 **`client.app.log`（通过 `writeLog`）+ 持久化文件 + compaction push** 三层机制替代。

**实际实施路径（已实现）：**

**路径 A：持久化文件提醒（主要兜底机制，已实现于 `plugins/task-after.ts`）**
- 在 `tool.execute.after` 中检测 `input.tool === "Task"` 且 `outcome === "SUCCESS"`
- 读取 `gate-state.json`，调用 `findArmedSession()` 检查是否有 armed session
- 如果有，使用 atomic write 写入两个文件：
  - `.task_temp/_global/gate-reminder.md`（人类可读的 markdown）
  - `.task_temp/_global/gate-reminder.json`（机器可读的 JSON sidecar）
- 同时通过 `writeLog(level: WARN, event: GATE-REMINDER-WRITTEN)` 输出高可见度日志
- 文件持久化跨 context 压缩和 agent 切换，任何后续 agent 或用户都可查看

**路径 B：`experimental.session.compacting` push（最后一道防线，已实现于 `plugins/task-after.ts`）**
- 在 context 压缩时 push 提醒内容到 compaction context
- 确保即使 context 被压缩且 Point 2 的提醒文本被丢弃，提醒仍保留在压缩后的摘要中

**路径 C：`tui.prompt.append`（**未实施**——API 不可用）**

**综合策略：** Point 2 的 check/confirm 返回值嵌入提醒是**主要机制**（提醒文本随 context 保留），Point 3 的兜底提醒是**辅助机制**（持久化文件 + compaction push 保障），形成三层提醒纵深：
1. MCP 返回值中的提醒文本（PRIMARY，进入 LLM context）
2. `.task_temp/_global/gate-reminder.{md,json}` 文件（FALLBACK，持久化）
3. compaction push（LAST RESORT，跨 context 压缩存活）

**可行性：** 部分可行。检测可行，向 LLM context 直接注入不可行，但已通过持久化文件 + compaction push 实现等效的间接提醒。

---

### Point 4: 保留 complete 自修正循环

**提案：** 保持 `complete` 的自修正循环在 LLM 层，不下沉到框架机械层。

**实施：** 无需变更。当前 `compliance_gate_complete` MCP 工具已实现：
- 验证 artifacts 完整性（test_report.json、execution_evidence 等）
- 返回结构化 pass/fail 结果
- LLM 看到 fail 后自行修正并重试
- 尊重 enforcement mode（advisory 模式下宽松，strict/locked 模式严格）

**可行性：** 已实现，无需变更。

---

### Point 5: 保留 enforcement mode 控制开关

**提案：** 保留 `enforcement_mode`（advisory/strict/locked）作为所有合规行为的控制开关。

**实施：** 无需变更。当前 `gate-core.ts` 的 `getEnforcementMode()` 已实现：
- 从 `project.config.json` 读取 `template_resolution.{develop,runtime}_enforcement_mode`
- 支持 `ENFORCEMENT_MODE` 环境变量覆盖
- 所有 compliance gate 函数内置 mode 判断

**可行性：** 已实现，无需变更。

---

## 四、实施架构

```
Task Start
   │
   ▼
┌─────────────────────────────────────────────────────┐
│ compliance_gate_check (1 call = check + confirm)    │  ← MCP Tool
│ • Validates rules, rules registry                   │
│ • Accepts optional plan_summary                     │
│ • Creates + arms gate session in single call        │
│ • Returns session_id + ARMED REMINDER TEXT ◄───────│  ← Point 2
└────────────────────┬────────────────────────────────┘
                     │
                [LLM works on task]
                [Reminder text persists in context]
                     │
     ┌───────────────┼──────────────────────┐
     │               │                      │
     ▼               ▼                      ▼
 task tool      session.idle      experimental.session
 completes      fires             .compacting fires
     │               │                      │
     └───────────────┼──────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│ task-after plugin (Point 3 — 兜底)                  │  ← Plugin
│ • Reads gate-state.json                             │
│ • Detects armed session for completed task          │
│ • tui.prompt.append → notifies USER (not LLM)      │
│ • compaction push → preserves reminder in context   │
│ • Does NOT auto-call complete                       │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│ compliance_gate_complete (1 call)                   │  ← MCP Tool
│ • Validates artifacts (test_report, evidence)       │
│ • Self-correction loop on failure ◄────────────────│  ← Point 4
│ • Respects enforcement mode ◄──────────────────────│  ← Point 5
│ • Consumes armed state                             │
└─────────────────────────────────────────────────────┘

Result: 2 LLM calls instead of 3. Three reminder layers:
  1. check return text (primary, in context)
  2. tui.prompt.append (auxiliary, user-visible)
  3. compaction push (fallback, survives context compression)
```

---

## 五、可行性总结

| # | 优化点 | 机制 | OpenCode 原语 | 可行? |
|---|--------|------|--------------|-------|
| 1 | 合并 confirm → check | 修改 MCP 工具逻辑 | MCP Server (compliance-gate.ts) | **可行** |
| 2 | check 返回值嵌入提醒 | 追加文本到 MCP 响应 | MCP Tool return content | **可行** |
| 3 | 插件层兜底提醒 | 检测 armed + 通知用户 | Plugin detection + tui.prompt.append + compaction push | **部分可行**（无法直接注入 LLM context） |
| 4 | 保留 complete 自修正 | 无需变更 | MCP Tool 现有行为 | **可行** |
| 5 | 保留 enforcement mode | 无需变更 | MCP Tool 现有行为 | **可行** |

### OpenCode 能力边界

| 能力 | 支持? | 依据 |
|------|-------|------|
| Custom Tool 返回值控制 | 是 | custom-tools.md L25-27 |
| MCP Tool 返回值控制 | 是 | MCP SDK handler |
| `tool.execute.before` 阻断执行 | 是 | plugins.md L149-159 |
| `tool.execute.after` 观察结果 | 是 | plugins.md |
| `session.idle` 触发副作用 | 是 | plugins.md L137-145 |
| `tui.prompt.append` 通知用户 | 是 | plugins.md L129 |
| `experimental.session.compacting` 注入内容 | 是 | plugins.md L210-218 |
| **插件向 LLM context 注入文本** | **否** | 官方文档无任何此类示例 |
| **`message.part.updated` 内容注入** | **否** | 仅通知/观察事件 |

### 需要修改的文件

| 文件 | 修改内容 | 对应 Point |
|------|---------|-----------|
| `.opencode/scripts/mcp-tools/compliance-gate.ts` | 合并 check+confirm 逻辑，返回值嵌入提醒 | 1, 2 |
| `.opencode/plugins/task-after.ts` | 添加 armed session 检测 + tui.prompt.append | 3 |
| `.opencode/lib/gate-core.ts` | 确保 createSession+armSession 可顺序调用 | 1 |
| 新增 plugin 或修改现有 plugin | 添加 `experimental.session.compacting` push | 3 |

---

## 六、实施状态验证（2026-06-16，2026-06-16 re-verified by @Orchestrator）

**验证结论：5 项优化中，Points 1-3 已实施，Points 4-5 原本就无需变更（已具备）。**

| Point | 状态 | 实施位置 | 验证证据 |
|-------|------|---------|---------|
| 1 (合并 confirm→check) | **已实施** | `.opencode/scripts/mcp-tools/compliance-gate.ts` CallTool handler | `compliance_gate_check` schema 新增 `plan_summary` + `agent` 可选参数；handler 在 check 通过时自动调用 `runGateConfirm` |
| 2 (返回值嵌入提醒) | **已实施** | `.opencode/scripts/mcp-tools/compliance-gate.ts` `buildReminderText()` + handler | 新增 `buildReminderText` helper；check（combined flow）和 confirm 成功返回时追加 `✅ GATE ARMED ... ⚠️ REMINDER` 文本块 |
| 3 (框架兜底提醒) | **已实施**（部分） | `.opencode/plugins/task-after.ts` | `tool.execute.after` 检测 Task SUCCESS + armed session → 写 `gate-reminder.{md,json}` + `writeLog(WARN)`；新增 `experimental.session.compacting` hook push 提醒到压缩 context。**`tui.prompt.append` 未实施**（见 §3 可行性澄清——无插件可调用的 API） |
| 4 (保留 complete 自修正) | **已实现**（无需变更） | `.opencode/scripts/mcp-tools/compliance-gate.ts` `runGateComplete` | 已实现验证 + 结构化失败原因返回 |
| 5 (保留 enforcement mode) | **已实现**（无需变更） | `.opencode/lib/gate-core.ts` `getEnforcementMode()` | 从 `project.config.json` 读取 |

**方案假设验证：**

| 假设 | 验证结果 |
|------|---------|
| `createSession()` + `armSession()` 可顺序调用 | **吻合** — handler 通过 `runGateCheck` → `runGateConfirm` 顺序调用，`gate-before.ts` 的 auto-arm 模式已验证此路径 |
| `findArmedSession()` 可识别合并后的 armed session | **吻合** — 函数扫描 `gate_status === "armed" && consumed_at === null`，合并后的 armed session 完全匹配 |
| MCP Tool 返回值可自由定制 | **吻合** — check/confirm 返回已追加 markdown 风格的 reminder 文本块 |
| 插件无法直接注入 LLM context | **吻合** — `tui.prompt.append` 确认无调用 API；改为 compaction push 兜底 |
| compliance-gate.ts 2089 行（实施前基线 1963 行） | **吻合** — 当前文件 2089 行（+126 行，Point 1+2 实施增量） |
| gate-state.json 当前 7 会话 | **吻合** — 1 armed, 3 checked, 3 drained（含 E2E 测试会话，2026-06-16 重新验证） |

**实施后的提醒纵深（三层）：**

```
LLM 调用 compliance_gate_check(task_description, plan_summary)
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ Point 1+2 (PRIMARY)                                    │
│ • check + confirm 合并为 1 次 MCP 调用                │
│ • 返回值追加 ✅ GATE ARMED + ⚠️ REMINDER 文本         │
│ • 文本随 MCP response 进入 LLM conversation context    │
└───────────────────────────────────────────────────────┘
        │
   [LLM 执行任务]
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ Point 3a (FALLBACK) — task-after.ts                    │
│ • Task() SUCCESS 后检测 armed session                  │
│ • 写 .task_temp/_global/gate-reminder.{md,json}       │
│ • writeLog(WARN, GATE-REMINDER-WRITTEN)               │
│ • 持久化文件跨 context 压缩存活                        │
└───────────────────────────────────────────────────────┘
        │
   [context 压缩触发]
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ Point 3b (LAST RESORT) — compactionHook                │
│ • experimental.session.compacting hook                 │
│ • output.context.push(...) 注入 armed 提醒             │
│ • 即使 PRIMARY 文本被丢弃，压缩后摘要仍包含提醒        │
└───────────────────────────────────────────────────────┘
        │
        ▼
LLM 调用 compliance_gate_complete (Point 4 自修正循环)
```

**结论：Points 1-3 已实施，Points 4-5 原本就无需变更。优先级 P1 的所有待办已完成。**

### 重新验证记录（2026-06-16，@Orchestrator）

二次独立验证确认所有 5 项优化点的实施状态与首次验证一致：

| 验证项 | 方法 | 结果 |
|--------|------|:--:|
| compliance-gate.ts plan_summary 合并逻辑 | 源码扫描 runGateConfirm 调用点 | PASS (L1914, L1972) |
| buildReminderText() 函数 | 源码扫描函数体 | PASS (GATE ARMED + REMINDER 文本块) |
| task-after.ts 兜底提醒 | 源码扫描 gate-reminder / GATE-REMINDER-WRITTEN | PASS (168 行，完整实现) |
| compaction hook | 源码扫描 experimental.session.compacting | PASS (L18 注册，compactionHook 推送提醒) |
| runGateComplete 自修正 | 源码扫描函数签名 | PASS (验证 session 状态 + 返回结构化结果) |
| getEnforcementMode 控制开关 | 源码扫描 project.config / ENFORCEMENT_MODE | PASS (双重读取) |
| gate-state.json 当前状态 | 文件读取 | PASS (1 armed + 3 checked + 3 drained) |
| compliance-gate.ts 行数 | 文件统计 | PASS (2089 行，+126 vs 1963 基线) |
| tui.prompt.append 未实施 | 确认仅为注释 | PASS (无插件可调用 API，符合设计) |
