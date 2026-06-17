# 合规门卡死修复 + 成果物硬约束方案

**日期：** 2026-06-17
**制定者：** @Orchestrator
**前置条件：** P3 完成 (33/34 Steps, 97.1%)

---

## Context

**问题背景：** 合规门系统性无法关闭。DB `gate_sessions` 表中 12/13 (92%) 会话处于 `recoverable` 状态，全部报告 "Missing required task artifacts: HANDOVER.md, TASK_LOG.md"。

**三个根因已验证：**

| 根因 | 严重性 | 验证状态 |
|------|:------:|:--------:|
| RC1: FW-SLIM-03 删除了 preamble Step 4 close-gate 指令 | 🥇 主 | ✅ 已确认 — preamble 68 行无 Step 4，注释 "enforced by MCP tool" 是逻辑错误 |
| RC2: Complete 在 artifact 写入前被调用 | 🥈 副 | ✅ 已确认 — 无顺序约束，LLM 可在 HANDOVER.md 未写时就调用 complete |
| RC3: Recoverable 无自我修复路径 | 🥉 系统 | ✅ 已确认 — `retry_confirm` 仅限 @Super-Admin/@Orchestrator (line 1775) |

**新需求：** 在不破坏 9 个子系统前提下，合规门 confirm 阶段硬约束要求成果物声明，所有 sub-agent 必须经 Orchestrator 确认成果物后才能执行 complete。目的是让 Orchestrator 在多 sub-agent 派遣后最大限度掌握各 sub-agent 信息，为任务把控和汇总提供支持。

---

## 一、诊断审核结论

诊断报告 3 个根因均为真实：

1. **RC1 真实**：`.opencode/subagent-preamble.md` 仅 68 行，只有 Steps 0/1/2，无 Step 4 close-gate。注释 "Step 4 enforced by compliance_gate_complete MCP tool" 是逻辑错误（MCP 工具不能自我调用）
2. **RC2 真实**：无顺序约束代码或文本。`compliance_gate_complete` 不检查 artifact 写入顺序
3. **RC3 真实**：`ALLOWED_RETRY_AGENTS = ["@Super-Admin", "@Orchestrator"]`，sub-agent 完全无法自我修复

**实际数据比报告更严重**：报告称 78% (7/9)，实际 DB 查询显示 92% (12/13) stuck in recoverable。

---

## 二、新门生命周期状态机

### 当前状态机
```
checked → armed → completed/failed/recoverable → drained
```

### 新状态机（增加 `delivered` + `approved` 两个状态）
```
checked ──[confirm+deliverables]──> armed
armed ──[submit_deliverables]──> delivered
delivered ──[Orchestrator approve]──> approved
approved ──[complete]──> completed

armed ──[stale>24h]──> drained
delivered ──[stale>4h]──> drained
recoverable ──[self-repair(sub-agent)]──> armed (必须重走 submit→approve→complete)
recoverable ──[retry_confirm(Orchestrator)]──> armed (同上)
failed ──[retry_confirm(Orchestrator/Super-Admin)]──> armed

# 豁免路径（仅 @Orchestrator/@Super-Admin 的自身 session）
armed ──[approval_required=0]──> completed (直接跳过 delivered/approved)
```

**硬约束执行点：**
- `compliance_gate_confirm`: `declared_deliverables` 对非豁免 agent 为必需参数
- `compliance_gate_complete`: `approval_required=1` 的 session 必须处于 `approved` 状态

---

## 三、DB Schema v5（gate_sessions 表扩展）

| 新列 | 类型 | 默认值 | 用途 |
|------|------|--------|------|
| `declared_deliverables` | TEXT (JSON) | NULL | confirm 阶段声明的成果物列表 `[{"name":"HANDOVER.md","description":"...","artifact_path":".task_temp/{taskId}/HANDOVER.md"}]` |
| `submitted_deliverables` | TEXT (JSON) | NULL | submit 阶段提交的证据 `[{"name":"HANDOVER.md","artifact_path":"...","content_summary":"...","submitted_at":"..."}]` |
| `deliverables_approved_by` | TEXT | NULL | 审批者 agent 名称 |
| `deliverables_approved_at` | INTEGER | NULL | 审批时间戳 (Unix ms) |
| `deliverables_approval_note` | TEXT | NULL | 审批/驳回备注 |
| `approval_required` | INTEGER | 0 | 是否需要 Orchestrator 审批 (0=豁免, 1=需要) |

**迁移方式：** `initializeSchema()` v5 block，6 个 `ALTER TABLE gate_sessions ADD COLUMN`。

**GateSession TypeScript 类型扩展：**
```typescript
gate_status: 'checked' | 'armed' | 'delivered' | 'approved' | 'completed' | 'failed' | 'recoverable' | 'drained';
declared_deliverables?: DeliverableEntry[];
submitted_deliverables?: DeliverableEvidence[];
deliverables_approved_by?: string;
deliverables_approved_at?: string;
deliverables_approval_note?: string;
approval_required?: boolean; // 0/1 → false/true
```

---

## 四、新增/修改 MCP 工具

### 4.1 修改：`compliance_gate_confirm`

**新增参数：** `declared_deliverables` (JSON string 或结构化对象)

**验证逻辑：**
- 非豁免 agent (不在 `APPROVAL_EXEMPT_AGENTS` 中) 必须提供至少 1 个 deliverable
- 每个条目必须有 `name` + `description` (description ≥ 5 chars)
- 豁免 agent 可省略，`approval_required` 设为 0

**豁免列表：** `APPROVAL_EXEMPT_AGENTS = ["@Orchestrator", "@Super-Admin", "Orchestrator", "Super-Admin"]`

> @Meta-Planner 不再豁免：其规划产出 (Task.DAG.json, Project.graph) 也需 Orchestrator 确认质量后再关闭门。

### 4.2 新增：`compliance_gate_submit_deliverables`

**参数：** `session_id`, `deliverables_evidence` (JSON array of `{name, artifact_path, content_summary}`)

**行为：**
1. 验证 session 存在且为 `armed` 状态
2. 交叉核对：`deliverables_evidence` 中每个 name 必须在 `declared_deliverables` 中存在
3. 文件存在性检查：对有 `artifact_path` 的条目验证文件是否已写入
4. HANDOVER.md + TASK_LOG.md 仍然强制验证
5. 过渡：`armed → delivered` (文件全部存在) 或 `armed → recoverable` (文件缺失)
6. 返回 `{ status: "delivered", pending_approval_by: "Orchestrator" }`

**此工具解决 RC2**：sub-agent 必须先写 artifacts 再调用 submit，状态机层面强制顺序。

### 4.3 新增：`compliance_gate_approve_deliverables`

**参数：** `session_id`, `approval_decision` ("approve" | "reject"), `approval_note?`, `execution_summary?`

**权限：** 仅 @Orchestrator / @Super-Admin 可调用

**行为：**
- **approve**：过渡 `delivered → approved`。如果提供 `execution_summary`，自动执行 `approved → completed` (合并审批+关闭，一步完成)
- **reject**：过渡 `delivered → armed`，sub-agent 需重新 submit

**合并审批+关闭设计**：Orchestrator 调度 sub-agent 后，sub-agent Task() 返回结果。此时 sub-agent 已退出。Orchestrator 在自身 session 中调用 `approve_deliverables(session_id, "approve", note, execution_summary)` → 一步完成审批+关闭。这是最实用的工作流。

### 4.4 修改：`compliance_gate_complete`

**新增状态门控：**
- `approval_required=1`：session 必须为 `approved` 状态，否则 REJECTED
- `approval_required=0`：session 可为 `armed` 状态 (向后兼容)
- 错误消息明确指导下一步操作

### 4.5 修改：`compliance_gate_retry_confirm`

**修复 RC3：** 扩展 `recoverable` 状态的自我修复路径

**新权限矩阵：**
- `recoverable` 状态：**任何 agent** 可 retry (自我修复路径)
- `failed` 状态：仅 @Super-Admin/@Orchestrator (监督 retry，不变)

自我修复后 `recoverable → armed`，sub-agent 必须重走 `submit → approve → complete` 流程 (不绕过成果物硬约束)。

---

## 五、Agent-Type 成果物模板

**新增文件：** `.opencode/lib/deliverables-templates.ts`

| Agent Type | 必需成果物 | 典型附加 |
|------------|----------|---------|
| @Coder-BE | HANDOVER.md, TASK_LOG.md, test_report.json | API 实现文件, migration |
| @Coder-FE | HANDOVER.md, TASK_LOG.md, test_report.json | 组件文件, 样式 |
| @Architect | HANDOVER.md, TASK_LOG.md | contract.yaml, 设计文档 |
| @Guardian | HANDOVER.md, TASK_LOG.md | review_report.json |
| @Arbiter | HANDOVER.md, TASK_LOG.md | WAIVE.md (if applicable) |
| @CI-CD-Agent | HANDOVER.md, TASK_LOG.md | deployment_status.json |
| @Knowledge-Curator | HANDOVER.md | knowledge cache 更新 |
| @Meta-Planner | HANDOVER.md | Task.DAG.json 更新, Project.graph |
| @Orchestrator | (豁免) | — |
| @Super-Admin | (豁免) | — |

**模板格式：**
```typescript
interface DeliverableTemplate {
  name: string;
  description: string;
  artifact_path?: string; // 模板变量 {taskId} 在 dispatch 时替换
  required: boolean;
}
```

模板在 dispatch 时注入 wrapped prompt，sub-agent 可直接引用或扩展。

---

## 六、Preamble 重写（修复 RC1）

**当前：** 68 行，Steps 0/1/2，无 Step 4

**新 preamble：**

```
Step 0: Knowledge Pipeline (plugin-enforced)
Step 1: Invoke Skills (no plugin)
Step 2: Compliance Gate Check + Confirm (plugin + hard constraint)
  - declared_deliverables 必需参数（非豁免 agent）
Step 3: Execute — 写所有声明成果物
Step 4: Submit Deliverables (MCP-enforced hard constraint)
  - compliance_gate_submit_deliverables(session_id, evidence)
  - 必须在 complete 前调用，否则 REJECTED
Step 5: Close Gate (requires Orchestrator approval)
  - 豁免 agent (@Orchestrator/@Super-Admin): 直接调用 compliance_gate_complete
  - 非豁免 agent: 等待 Orchestrator 审批后，由 Orchestrator 调用 complete
```

**关键变更：**
- Step 4 恢复 (FW-SLIM-03 删除的)，现在是 `submit_deliverables`
- Step 5 新增：Orchestrator 审批环节
- `declared_deliverables` 硬约束在 Step 2b 文档化
- 顺序约束在 preamble AND 状态机两层强制

---

## 七、Dispatch Wrapper 集成

### 7.1 `dispatch-subagent.ts` 修改

- Import `deliverables-templates.ts`
- 新增 `deliverablesTemplateForAgent(agentType)` 函数
- 在 wrapped prompt 中注入成果物模板段落：
  ```
  ### Deliverables Declaration — MANDATORY
  When calling compliance_gate_confirm, you MUST include declared_deliverables.
  Your agent type's typical deliverables: [...]
  After writing ALL deliverables, call compliance_gate_submit_deliverables.
  Then wait for Orchestrator approval.
  ```

### 7.2 `dispatch-after.ts` 修改

- 新增：检测 `delivered` 状态 session 超过 2h 未审批，写 WARNING 日志提醒 Orchestrator

### 7.3 `gate-before.ts` 修改

- 当 Orchestrator 有未审批的 `delivered` session 时，dispatch 前写 WARNING 提醒

---

## 八、防卡死设计

| 卡死场景 | 防护机制 |
|----------|---------|
| Orchestrator 忘记审批 | `delivered` 状态 4h 自动 drain + gate-before WARNING |
| sub-agent 在 submit 前调用 complete | `complete` REJECT (状态机层面) |
| sub-agent 在 approve 前调用 complete | `complete` REJECT (状态机层面) |
| recoverable 自我修复 | 任何 agent 可 retry (RC3 修复) |
| Orchestrator 自身 session 死锁 | 豁免 (`approval_required=0`)，直接 armed→completed |
| Super-Admin 紧急修复 session | 同上豁免 |
| 并发多 agent dispatch | 每个 session 独立审批，无串行瓶颈 |

---

## 九、Orchestrator 实际工作流

### 正常流程（approve）

1. **Orchestrator 派遣** sub-agent via `dispatch_subagent` → 创建 Task() session
2. **sub-agent 执行**：check → confirm(声明成果物) → 工作 → `submit_deliverables` → Task() 返回 → **sub-agent 上下文结束**
3. **Orchestrator 收到结果**，阅读 sub-agent 产出的摘要和成果物证据
4. **Orchestrator 审批+关闭**：`compliance_gate_approve_deliverables(session_id, "approve", note, execution_summary)` → 一步完成 `delivered → approved → completed`

### 驳回流程（reject → re-dispatch）

5. **如果驳回**：`compliance_gate_approve_deliverables(session_id, "reject", reason)` → `delivered → armed`
6. **关键约束**：此时 sub-agent 的 Task() 已返回，**原始上下文已不存在**。Orchestrator 必须**重新派遣**同一 agent 类型：
   - 新的 `Task()` 调用 → 创建全新 session 上下文
   - 新 sub-agent 收到指令：修复成果物 → 重新 `submit_deliverables`
   - Orchestrator 再次审批 → approve+complete

```
reject 时序：
  Orchestrator reject → session 回 armed
    → Orchestrator dispatch 同一 agent（新 Task）→ 新 sub-agent 上下文
      → 新 sub-agent 修复成果物 → submit_deliverables → session 再进 delivered
        → Orchestrator approve+complete
```

**关键优化**：`approve_deliverables` 支持 `execution_summary` 参数，合并审批+关闭为一次调用。这是最实用的工作流——sub-agent 已退出，Orchestrator 在自身 session 中完成所有操作。

---

## 十、实施步骤（按依赖顺序）

### Phase 1: 类型与 Schema 基础（无行为变更）

| Step | 操作 | 文件 |
|------|------|------|
| S1 | GateSession 类型扩展：新增 deliverables 字段 + `delivered`/`approved` 状态 | `lib/gate-core.ts` |
| S2 | 新增 `DeliverableEntry` / `DeliverableEvidence` 接口 | `lib/gate-core.ts` |
| S3 | DB schema v5：gate_sessions 表 6 新列 | `lib/db-manager.ts` |
| S4 | 更新 `reconstructGateSession` 包含新字段 | `lib/db-state-manager.ts` |
| S5 | 创建成果物模板文件 | `lib/deliverables-templates.ts` (新) |

### Phase 2: MCP 工具修改

| Step | 操作 | 文件 |
|------|------|------|
| S6 | `compliance_gate_confirm` 新增 `declared_deliverables` 参数 + 硬约束验证 | `scripts/mcp-tools/compliance-gate.ts` |
| S7 | 新增 `compliance_gate_submit_deliverables` MCP 工具 | `scripts/mcp-tools/compliance-gate.ts` |
| S8 | 新增 `compliance_gate_approve_deliverables` MCP 工具 | `scripts/mcp-tools/compliance-gate.ts` |
| S9 | `compliance_gate_complete` 新增状态门控 (`approved` 要求) | `scripts/mcp-tools/compliance-gate.ts` |
| S10 | `compliance_gate_retry_confirm` 放宽 recoverable 权限 (RC3 修复) | `scripts/mcp-tools/compliance-gate.ts` |
| S11 | `gate-core.ts` 同步：`armSession` / `completeSession` + 新 `submitDeliverables` / `approveDeliverables` | `lib/gate-core.ts` |

### Phase 3: Preamble 与 Dispatch 集成

| Step | 操作 | 文件 |
|------|------|------|
| S12 | 重写 `subagent-preamble.md`：恢复 Step 4 + 新增 Step 5 | `.opencode/subagent-preamble.md` |
| S13 | `dispatch-subagent.ts` 注入成果物模板段落 | `scripts/command-tools/dispatch-subagent.ts` |
| S14 | `dispatch-after.ts` 新增 delivered 状态超时警告 | `plugins/dispatch-after.ts` |
| S15 | `gate-before.ts` 新增未审批 session WARNING | `plugins/gate-before.ts` |

### Phase 4: Drain 与 Reconciliation 更新

| Step | 操作 | 文件 |
|------|------|------|
| S16 | `drainStaleSessions` 新增 `delivered` 状态 (4h threshold) | `lib/gate-core.ts` + `scripts/mcp-tools/compliance-gate.ts` |
| S17 | `reconcileGateStore` 包含 `delivered`/`approved` 在 active_sessions | `lib/gate-core.ts` |
| S18 | `state-reconciliation.ts` Check #5 新增 `delivered`/`approved` 一致性检查 | `scripts/state-reconciliation.ts` |

### Phase 5: 验证

| Step | 操作 |
|------|------|
| S19 | `bun .opencode/scripts/framework-self-test.ts` — 无回归 |
| S20 | TypeScript 类型检查 |
| S21 | 模拟 sub-agent 全生命周期：check→confirm(deliverables)→work→submit→approve+complete |

### Phase 6 (可选): Session Resume 解锁

> **前置条件：** Phase 1-5 完成且验证通过。此 Phase 为可选增强，不实施也不影响成果物硬约束功能。

| Step | 操作 | 文件 | 对应阻断层 |
|------|------|------|:----------:|
| S22 | 新增 `resume_session_id` 参数 + Header 条件性 `task_id` | `.opencode/tools/dispatch_subagent.ts` | B1 |
| S23 | P0-FIX-BUG-15-L1 新增 resume 分支 (验证 SESSION_ID.md) | `.opencode/scripts/command-tools/dispatch-subagent.ts` | B2 |
| S24 | MANDATORY-DISPATCH 跳过含 `task_id` 的 Task() | enforcer 或 task-after | B3-A |
| S25 | 持久化 `metadata.sessionId` 到 SESSION_ID.md | `.opencode/plugins/task-after.ts` | B4 |
| S26 | dispatch-before 支持 resume 路径 (跳过 DAG gate) | `.opencode/plugins/dispatch-before.ts` | — |
| S27 | Orchestrator.md 文档化 resume 协议 | `.opencode/agents/Orchestrator.md` | — |
| S28 | 验证：模拟 reject→resume 流程 | — | — |

**Phase 6 工时：** ~2.2h (见 13.2 修改清单 R1-R7)

---

## 十一、9 子系统兼容性矩阵

| Agent | 当前流程 | 新流程 | 变更 |
|-------|---------|--------|------|
| @Orchestrator | check→confirm→complete | check→confirm(可选 deliverables)→complete | **无变更** (豁免) |
| @Super-Admin | check→confirm→complete | check→confirm(可选)→complete | **无变更** (豁免) |
| @Meta-Planner | check→confirm→work→complete | check→confirm(声明 deliverables)→work→submit→Orchestrator approve+complete | **新增 submit 步骤** |
| @Coder-BE | check→confirm→work→complete | check→confirm(声明 deliverables)→work→submit→Orchestrator approve+complete | **新增 submit 步骤** |
| @Coder-FE | 同上 | 同上 | 同上 |
| @Architect | 同上 | 同上 | 同上 |
| @Guardian | 同上 | 同上 | 同上 |
| @Arbiter | 同上 | 同上 | 同上 |
| @CI-CD-Agent | 同上 | 同上 | 同上 |
| @Knowledge-Curator | 同上 | 同上 | 同上 |

**豁免 agent (2个)** 流程完全不变。**非豁免 agent (8个)** 新增 1 个 submit 步骤，complete 由 Orchestrator 代理执行。

---

## 十二、关键文件清单

| 文件 | 修改类型 |
|------|---------|
| `.opencode/lib/gate-core.ts` | 类型扩展 + 新状态 + 新函数 |
| `.opencode/scripts/mcp-tools/compliance-gate.ts` | 3 新工具 + 3 修改工具 |
| `.opencode/lib/db-manager.ts` | Schema v5 迁移 |
| `.opencode/lib/db-state-manager.ts` | reconstructGateSession 更新 |
| `.opencode/lib/deliverables-templates.ts` | **新文件** |
| `.opencode/subagent-preamble.md` | 重写 (恢复 Step 4 + Step 5) |
| `.opencode/scripts/command-tools/dispatch-subagent.ts` | 成果物模板注入 + P0-FIX-BUG-15-L1 resume 分支 (Phase 6) |
| `.opencode/plugins/dispatch-after.ts` | 超时警告 |
| `.opencode/plugins/dispatch-before.ts` | 未审批提醒 + resume 路径 (Phase 6) |
| `.opencode/plugins/task-after.ts` | sessionId 持久化 (Phase 6) |
| `.opencode/tools/dispatch_subagent.ts` | resume_session_id 参数 (Phase 6) |
| `.opencode/agents/Orchestrator.md` | resume 协议文档化 (Phase 6) |
| `.opencode/scripts/state-reconciliation.ts` | Check #5 扩展 |

---

## 十三、OpenCode Session Resume 与双向通信能力边界

### 13.1 Task() Session Resume 能力

**上游 OpenCode 原生支持**：`Task()` 工具接受可选参数 `task_id`，文档描述 "This should only be set if you mean to resume a previous task"。传入时：
- 查找已有 session via `sessions.get(SessionID.make(params.task_id))`
- 新 prompt **追加**到该 session 的消息线程（sub-agent 看到完整历史）
- 返回 `metadata.sessionId` 供后续 resume 使用

**本项目框架 4 层阻断机制**：

| 阻断层 | 文件 | 行号 | 当前行为 | 最小修改 |
|--------|------|------|---------|---------|
| **B1** | `dispatch_subagent.ts` | 169-174 (描述), 496-521 (header) | "Every dispatch creates a NEW session"; Task() 模板不含 `task_id` | 新增 `resume_session_id` 参数; 条件性包含 `task_id` 在 header |
| **B2** | `dispatch-subagent.ts` (CLI) | 835-886 (P0-FIX-BUG-15-L1) | same `dagTaskId` + different `promptHash` → `process.exit(1)` | 新增 resume 分支: 有 `DISPATCH_RESUME_SESSION_ID` 且 `SESSION_ID.md` 存在 → 允许 |
| **B3-A** | `framework-enforcer.ts` | 1130-1183 (MANDATORY-DISPATCH) | 空 `.pending.json` → throw 阻断 | 当 `Task()` 含 `task_id` → 跳过 MANDATORY-DISPATCH |
| **B3-B** | 同上 | 794-875 (TASK-PROMPT-MISMATCH) | hash 不匹配 → throw | **无需修改** — `task_id` 是独立参数，不影响 prompt hash |
| **B4** | 无 (缺失特性) | N/A | `metadata.sessionId` 未被捕获 | 在 `task-after.ts` 持久化 sessionId 到 `.task_temp/{dagTaskId}/SESSION_ID.md` |

**阻断层互锁关系**：resume 需要 B1(传 task_id) + B2(允许 same dagTaskId) + B3-A(跳过 MANDATORY-DISPATCH) + B4(记录 sessionId) **同时修复**。缺一不可。

### 13.2 解锁 Session Resume 的具体修改清单

| # | 修改 | 文件 | 工时 | 安全保障 |
|---|------|------|:----:|---------|
| R1 | 新增 `resume_session_id` 参数到工具 schema | `.opencode/tools/dispatch_subagent.ts` | 0.5h | 仅当显式提供时才启用；缺省 = 当前行为 |
| R2 | Header 模板条件性包含 `task_id` | 同上 | 0.3h | resume 时显示 task_id；否则保持 "always new session" |
| R3 | P0-FIX-BUG-15-L1 新增 resume 分支 | `.opencode/scripts/command-tools/dispatch-subagent.ts` | 0.5h | 验证 SESSION_ID.md 存在 + prior session 状态为 delivered；否则保持 fatal |
| R4 | MANDATORY-DISPATCH 跳过含 `task_id` 的 Task() | `.opencode/plugins/task-after.ts` 或 enforcer | 0.3h | 上游验证 session 存在；本地可验证 SESSION_ID.md |
| R5 | 持久化 `metadata.sessionId` | `.opencode/plugins/task-after.ts` | 0.3h | 仅对合法 Task() 完成; 写入 `.task_temp/{taskId}/SESSION_ID.md` |
| R6 | dispatch-before.ts 支持 resume 路径 | `.opencode/plugins/dispatch-before.ts` | 0.2h | resume 时跳过 DAG existence + status gate (任务已规划) |
| R7 | Orchestrator.md 文档化 resume 协议 | `.opencode/agents/Orchestrator.md` | 0.1h | — |
| **总计** | | | **~2.2h** | |

### 13.3 Session Resume 对成果物方案的优化

**当前方案（无 resume）**：
```
reject → session 回 armed → Orchestrator 重新 dispatch (新 Task, 新 session)
  → 新 sub-agent 上下文 → 从 HANDOVER.md 恢复上下文 → 修复成果物 → submit → approve+complete
```

**启用 resume 后**：
```
reject → session 回 armed → Orchestrator resume 原 session (Task(task_id=原session_id), prompt="修复成果物")
  → sub-agent 看到完整历史 → 知晓之前做了什么 → 修复成果物 → submit → approve+complete
```

**优势**：
- sub-agent 保留完整上下文（无需 HANDOVER.md 恢复）
- 修复指令可直接基于历史对话，而非文件推断
- 减少 sub-agent 重新理解和定位代码的时间
- 成果物修复更精准（sub-agent 知晓哪些文件已修改、哪些测试已运行）

**安全约束**：
- resume 仅允许从 `delivered` 状态（sub-agent 已 submit 但未 approved）触发
- 不允许从 `completed`/`failed`/`drained` 状态 resume
- resume prompt 由 Orchestrator 构建，注入修复指令 + 保留原成果物声明
- 同一 session 最多 resume 3 次（防止无限循环）

### 13.4 Sub-agent Question 工具能力边界

| 问题 | 结论 |
|------|------|
| Sub-agent 能否用 question 工具？ | ✅ 可以。全部 10 个 agent 均配置 `"question": "allow"` |
| question 发给谁？ | **只发给人类用户** (TUI)，不发给 Orchestrator |
| Orchestrator 能否拦截/回答？ | ❌ 不能。无拦截层或消息转发机制 |
| 能否实现 Orchestrator↔sub-agent 双向通信？ | ❌ 不能。架构严格单向：parent→child (dispatch) + child→parent (Task 返回) + 文件 (HANDOVER.md) |

**对方案的影响：** sub-agent submit_deliverables 后，其 Task() 返回结果给 Orchestrator。Orchestrator 审批时无法与 sub-agent 实时交互——只能 approve（一步完成）或 reject（resume 原 session 或重新 dispatch 新 session）。question 工具不参与此流程。

### 13.5 设计约束确认

| 约束 | 原因 | 方案适配 |
|------|------|---------|
| reject 可 resume 或重新 dispatch | resume 需解锁 4 层阻断（~2.2h）| Phase 1 先用重新 dispatch；Phase 2 可选解锁 resume |
| 无法 sub-agent↔Orchestrator 实时交互 | question 只到人类用户 | 审批基于文件证据而非实时对话 |
| 跨 session 延续 | 无 resume 时靠 HANDOVER.md；有 resume 时靠消息线程 | HANDOVER.md + declared_deliverables DB 持久化 + SESSION_ID.md |
| 不破坏 9 个子系统 | 用户硬约束 | 豁免 @Orchestrator/@Super-Admin 2 个，其余 8 个仅新增 submit 步骤 |
| 不破坏框架一致性 | 用户硬约束 | 新增状态是扩展而非替换；resume 解锁是可选增强 |

---

## 十四、验证报告发现与三 Bug 修复方案

**日期**: 2026-06-17
**验证报告**: `docs/review/framework-refactor/implementation-verification-report.md`

### 验证报告发现

| Metric | Value |
|--------|-------|
| Total Steps | 28 |
| PASS | 27 |
| FAIL (runtime) | 1 (S25 — 3 版修复尝试均失败或引入新 bug) |
| NOT TESTED (blocked) | 3 (S23, S26, S28 — 阻塞于 S25) |
| Pre-existing issues | 2 (substate-manager module load errors — 无关) |
| Expected failures | 2 (uncommitted files block confirm — by design) |

### 14.1 三 Bug 分析

#### Bug 1: SESSION_ID.md 不创建

**根因**: `resolveTaskId()` 读取 `process.env.FRAMEWORK_TASK_ID`。`dispatch_subagent` 工具在 line 236 设置该 env var，但在 finally 块恢复/清除。当 `task-after.ts` 插件运行时，env var 已不存在 → `taskId` 为空 → `if (subSessionId && taskId)` 永不执行 → SESSION_ID.md 从未创建 → Phase 6 session resume 流程完全不可用。

**S25 修复历史 (4 版)**:

| 版本 | 方案 | 结果 | 原因 |
|------|------|------|------|
| v1 | `resolveTaskId()` (原代码) | ❌ FAIL | env var 被 finally 块清除，父进程读不到 |
| v2 | promptHash→.pending.json 桥接 | ❌ FAIL | hash mismatch: `.pending.json` 的 promptHash 是 SHA-256(12KB dispatch output)，而 `input.args.prompt` 是 ~100-char Task() 参数，完全不同内容 |
| v3 | 保留 FRAMEWORK_TASK_ID 在 parent process.env | ❌ 引入 Bug 2 | dispatch_subagent.ts finally 块不清除 env var → 环境污染 → DAG gate 永久阻断 |
| v4 | **`.dispatch_ctx` 文件 + `session_log` DB 表** | ✅ (设计) | 文件替代 env var，DB 替代 SESSION_ID.md，零环境污染 |

#### Bug 2: 环境污染 → DAG gate 永久阻断

**根因**: v3 方案让 `dispatch_subagent` finally 块不清除 `FRAMEWORK_TASK_ID`，导致 env var 永久残留在 parent process.env 上。

**三种永不清除的场景**:

| 场景 | 清除路径 | 结果 |
|------|---------|------|
| Task() 未调用 (LLM 决定不 dispatch) | `task-after.ts` 不触发 | env 永久残留 |
| Task() 失败 | `delete` 在 `outcome === "SUCCESS"` block 内 | env 永久残留 |
| Task() 成功但文件写入异常 | try/catch 吞掉异常，delete 被跳过 | env 永久残留 |

**阻断机制**: `gate-before.ts` P2-1 调 `resolveTaskId()` → 读到 stale dagTaskId → `findTaskInDag(staleTaskId)` → ID 不在 DAG 中或 status 已终态 → 所有 modify 工具被永久阻断 → agent 无法自救（无法清除 env var，无法通过 P2-1）。

#### Bug 3: 无 session 持久记录

**根因**: `.pending.json` 仅存未消费 dispatch，`Task()` 完成后无持久 session 记录。无法按 dagTaskId 查询历史 sessionId。

---

### 14.2 v4 修复方案: `.dispatch_ctx` 文件 + DB 表

**设计原则**: 不依赖 `process.env`，不创建 `SESSION_ID.md`，不创建 `.task_temp/{taskId}/` 专有目录。

#### 14.2.1 `.dispatch_ctx` 文件机制 (替代 process.env)

**文件路径**: `.task_temp/_dispatch/.dispatch_ctx`

**内容**: JSON，单次消费
```json
{ "dagTaskId": "VERIFY-REPORT-FINAL-V3", "createdAt": 1718926800000 }
```

**生命周期**:
1. `dispatch_subagent` (tool) 写 `.dispatch_ctx` → finally 块恢复清除 `FRAMEWORK_TASK_ID` (恢复 v1 行为)
2. Orchestrator 调用 Task()
3. `task-after.ts` 读 `.dispatch_ctx` 取 dagTaskId → 写 `session_log` DB 表 → 删 `.dispatch_ctx`
4. 如果 Task() 未调用 → `.dispatch_ctx` 残留但无害（不被 gate-before.ts 读取，不影响 DAG gate）

**优势**:
- **彻底解决 Bug 1+2**: 不依赖 process.env，无环境污染。`.dispatch_ctx` 不被 gate-before.ts 读取，残留不影响 DAG gate
- **消费即删**: task-after.ts 读取后删除
- **Orchestrator 串行调用**: 不存在并发写竞争
- **残留无害**: 下次 dispatch 自动覆盖

#### 14.2.2 `session_log` DB 表 (替代 SESSION_ID.md)

**直接 DB 化** (不做 JSONL 过渡，为后期基建准备):

```sql
CREATE TABLE IF NOT EXISTS session_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  dag_task_id  TEXT NOT NULL,
  agent_type   TEXT NOT NULL,
  run_id       TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slog_dag ON session_log(dag_task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_slog_session ON session_log(session_id);
CREATE INDEX IF NOT EXISTS idx_slog_agent ON session_log(agent_type);
```

**Resume 查询** (替代 `SESSION_ID.md` 文件读取):
```sql
SELECT session_id FROM session_log WHERE dag_task_id = ? ORDER BY created_at DESC LIMIT 1
```

**TTL 清理**: 7 天 TTL + 200 条上限，与 `.pending.json.failed` 的 `capFailedEntries()` 模式一致。

**解决 Bug 3**: 每次 Task() 完成 → task-after.ts 追加 `session_log` 行 → 持久记录 sessionId + dagTaskId + ts + agentType。

#### 14.2.3 `dispatch_failed_log` DB 表 (替代 .pending.json.failed)

**当前 `.pending.json.failed`**: 纯写入死信归档，48 条记录，零读取者。两种数据变体:

| 变体 | 来源 | 字段 |
|------|------|------|
| A | `dispatch-after.ts` (stale drain) | dispatchId, promptHash, filePath, createdAt, agentType, dagTaskId, failedAt, reason |
| B | `task-after.ts` (Task() failure) | sessionID, agentType, taskId, timestamp, error |

**DB 表设计**:

```sql
CREATE TABLE IF NOT EXISTS dispatch_failed_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_id  TEXT NOT NULL,
  prompt_hash  TEXT,
  file_path    TEXT,
  agent_type   TEXT NOT NULL,
  dag_task_id  TEXT,
  session_id   TEXT,
  created_at   INTEGER NOT NULL,
  failed_at    INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  error_msg    TEXT
);
CREATE INDEX IF NOT EXISTS idx_dfl_dag ON dispatch_failed_log(dag_task_id);
CREATE INDEX IF NOT EXISTS idx_dfl_agent ON dispatch_failed_log(agent_type);
CREATE INDEX IF NOT EXISTS idx_dfl_reason ON dispatch_failed_log(reason);
CREATE INDEX IF NOT EXISTS idx_dfl_failed_at ON dispatch_failed_log(failed_at);
```

**TTL**: 7 天 + 100 条上限 (与现有 `FAILED_TTL_MS` / `FAILED_MAX_ENTRIES` 一致)。

**收益**: 零读取者 → DB 化零风险。消除 `.task_temp/_dispatch/` 下又一 JSON 文件。为将来按 dagTaskId/agentType/reason 查询失败率提供索引能力。

#### 14.2.4 `session_map` DB 表 (替代 .session_map.json)

**最易 DB 化**: 数据简单 (session_id → agent + ts)，主进程读写，无子进程障碍。

```sql
CREATE TABLE IF NOT EXISTS session_map (
  session_id   TEXT PRIMARY KEY,
  agent        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_smap_agent ON session_map(agent);
```

**50 条上限**: 清理 oldest entries `DELETE FROM session_map WHERE session_id NOT IN (SELECT session_id FROM session_map ORDER BY updated_at DESC LIMIT 50)`。

**收益**: SQLite B-tree 按 session_id 查询比 JSON.parse 全文件更快，避免文件竞争。

---

### 14.3 DB Schema v6 迁移

**当前 schema 版本**: v5
**新增**: v6 block，3 新表 + 索引

所有新表在 `initializeSchema()` v6 block 中创建 (`CREATE TABLE IF NOT EXISTS`)，无需 ALTER TABLE。与现有模式一致:

```typescript
// v6: Add session_log + dispatch_failed_log + session_map tables
try {
  db.run(`CREATE TABLE IF NOT EXISTS session_log (...)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_slog_dag ON session_log(...)`);
  db.run(`CREATE TABLE IF NOT EXISTS dispatch_failed_log (...)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_dfl_dag ON dispatch_failed_log(...)`);
  db.run(`CREATE TABLE IF NOT EXISTS session_map (...)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_smap_agent ON session_map(...)`);
  db.run(`INSERT OR IGNORE INTO schema_version (version, applied_at, comment)
    VALUES (6, ?, 'S25-v4+DB: add session_log, dispatch_failed_log, session_map tables')`,
    [Date.now()]);
  writeLog(SRC, "INFO", { event: "DB-SCHEMA-MIGRATION", detail: "v6: ..." });
} catch (e: any) {
  writeLog(SRC, "WARN", { event: "DB-SCHEMA-MIGRATION-SKIPPED", detail: `v6: ${e.message}` });
}
```

---

### 14.4 DB 化矩阵

| 文件 | 当前形式 | DB 化 | 说明 |
|------|---------|:-----:|------|
| `.dispatch_ctx` | 新概念 (文件) | ❌ | 单次消费文件，生命周期 < 1s，DB 化无收益 |
| `SESSION_ID.md` | 单字符串文件 | ✅ 已替代 | → `session_log` DB 表，按 dagTaskId 索引查询 |
| `.session_log.json` | 不存在 | ✅ 直接建 DB 表 | 新基建，resume 查询核心 |
| `.pending.json.failed` | JSON 文件 (48 条, 零读取者) | ✅ | → `dispatch_failed_log` DB 表 |
| `.session_map.json` | JSON 文件 (~50 条) | ✅ | → `session_map` DB 表，最易 DB 化 |
| `.pending.json` | JSON 文件 | ❌ 暂不 | 子进程障碍 (`dispatch-subagent.ts` CLI 无 DB 访问) |

---

### 14.5 v4 方案修改文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `.opencode/lib/db-manager.ts` | v6 schema | 3 新表 (`session_log`, `dispatch_failed_log`, `session_map`) + 索引 |
| `.opencode/lib/db-state-manager.ts` | 新增 CRUD | `dbAppendSessionLog`, `dbQuerySessionByDagTaskId`, `dbAppendDispatchFailed`, `dbReadSessionMap`, `dbWriteSessionMap`, `dbCleanupSessionLog`, `dbCleanupDispatchFailed` |
| `.opencode/tools/dispatch_subagent.ts` | 修改 | 写 `.dispatch_ctx` 文件; finally 块恢复清除 `FRAMEWORK_TASK_ID` (恢复 v1 行为) |
| `.opencode/plugins/task-after.ts` | 修改 | 读 `.dispatch_ctx` → DB 写 `session_log` → 删文件; 失败记录写 `dispatch_failed_log` DB (替代 `.pending.json.failed` 写入) |
| `.opencode/plugins/dispatch-after.ts` | 修改 | stale drain 写 `dispatch_failed_log` DB (替代 `.pending.json.failed` 写入); session_map 清理改 DB |
| `.opencode/plugins/session.ts` | 修改 | session_map 写 DB (替代 `.session_map.json` 文件) |
| `.opencode/lib/agent-resolver.ts` | 修改 | `resolveAgentFromSessionMap()` 读 DB; `resolveTaskId()` 读 `.dispatch_ctx` 或 DB fallback |
| `.opencode/scripts/command-tools/dispatch-subagent.ts` | 修改 | P0-FIX-BUG-15 resume 分支改查 `session_log` DB (按 dagTaskId 取最新 sessionId)，不再读 `SESSION_ID.md` |
| `.opencode/lib/state-utils.ts` | 修改 | `capFailedEntries()` → DB 侧清理辅助函数 |
| `.opencode/plugins/dispatch-before.ts` | 不变 | resume 路径仍检查 `output?.args?.resume_session_id` (不变) |
| `.opencode/plugins/gate-before.ts` | 不变 | P2-1 不再受 `FRAMEWORK_TASK_ID` 污染影响 (env var 恢复清除) |

---

### 14.6 合规审计修复 (已完成)

**Bug**: `dispatch-before.ts` hook 签名错误。
**根因**: `tool.execute.before` hook 中 `input.args?.resume_session_id` → 应为 `output?.args?.resume_session_id`。
**修复**: 已完成 (line 72)。

### 14.7 Phase 1-5 验证状态

| 验证项 | 状态 |
|--------|:----:|
| S13 完善 (import deliverables-templates) | ✅ |
| S20 TypeScript 检查 | ✅ |
| S21 生命周期模拟 | ✅ |

### 14.8 Phase 6: Session Resume (S25 v4 待实施)

| Step | 当前状态 | v4 后预期 | 说明 |
|------|:--------:|:---------:|------|
| S22 | ✅ | ✅ | schema 参数 + Header 条件性 task_id (不变) |
| S23 | ⚠️ | ✅ (需改) | P0-FIX-BUG-15 resume 分支改查 DB session_log (不再读 SESSION_ID.md) |
| S24 | ✅ | ✅ | 不在活跃插件中 (不变) |
| S25 | ❌ | ✅ | `.dispatch_ctx` + DB session_log (不依赖 process.env) |
| S26 | ⚠️ | ✅ | dispatch-before resume 路径 (不变) |
| S27 | ✅ | ✅ | Orchestrator.md 文档化 (不变, 但需更新: SESSION_ID.md → DB) |
| S28 | ❌ | ✅ | Full resume cycle (需集成测试验证) |

### 三根因最终状态

| 根因 | 修复方式 | 验证 |
|------|---------|:----:|
| RC1: FW-SLIM-03 删除 Step 4 | S12: preamble 重写 Steps 0-5 | ✅ |
| RC2: Complete 先于 artifact 写入 | S7+S9: submit_deliverables 状态机强制 | ✅ |
| RC3: Recoverable 无自我修复 | S10: retry_confirm 放宽权限 | ✅ |

### 下一步行动 (按 15.4 安全迁移顺序)

1. **Phase A: DB Schema v6**: 3 新表 + 索引 + 7 个 CRUD 函数 + Check 38 self-test
2. **Phase B: `.dispatch_ctx` + `session_log`**: 修复 Bug 1+2 (S25 v4 核心) + 恢复 finally 清除 env var
3. **Phase C: `session_map` DB 化**: session.ts + agent-resolver.ts **原子同提交** (保护 P0-4 作用域执法)
4. **Phase D: `dispatch_failed_log` DB 化**: 两个写入者改 DB + TTL 清理扩展
5. **Phase E: 清理 + 文档**: 移除旧文件引用 + Orchestrator.md 更新 4 行
6. **集成测试**: 派遣真实 sub-agent 验证 `.dispatch_ctx` 写→读→删 + `session_log` DB + resume 查询
7. **提交基础设施文件**: 全部以 `[INFRA]` marker 提交

---

## 十五、v4 方案三维审计

### 15.1 九子系统影响审计

**结论**: 仅 @Orchestrator 受影响，其余 8 个 agent 零影响。

| 机制 | 受影响 Agent 配置 | 受影响文档 |
|------|-----------------|-----------|
| `process.env.FRAMEWORK_TASK_ID` | **无** | **无** |
| `SESSION_ID.md` | @Orchestrator.md (3 处: L149, L154, L161) | AGENTS.md/Rules/Preamble: 无 |
| `.session_map.json` | **无** | **无** |
| `.pending.json` / `.failed` | @Orchestrator.md (1 处: L48) | 无 |

**@Orchestrator.md 必需更新 (4 行)**:
- **L48**: `.pending.json` 描述 → 引用 `dispatch_failed_log` DB 表或新的 dispatch queue 机制
- **L149**: `SESSION_ID.md` 路径引用 → 指向 `session_log` DB 表查询
- **L154**: `task-after.ts` 描述 → 写 `session_log` DB 表替代 `SESSION_ID.md`
- **L161**: 存在性约束 → "session_log entry must exist" 替代 "SESSION_ID.md must exist"

**其余 8 个 agent 配置**: @Meta-Planner, @Architect, @Coder-BE, @Coder-FE, @Guardian, @Arbiter, @CI-CD-Agent, @Super-Admin, @Knowledge-Curator — 均无上述四种机制的直接引用，零修改需求。

**自定义 session 管理逻辑**: 各 agent 的 session 管理均围绕 `machine.json` 子状态字段（write_audit_state、gate sessions），与 v4 替换的四种文件机制无交集。

### 15.2 日志系统集成审计

**结论**: 日志系统与数据持久层职责分离清晰，v4 方案与现有日志架构完全兼容。

**writeLog() 定位**: 纯诊断日志系统，写入 `.task_temp/_logs/<date>/plugin-<source>-<category>.log`。POSIX O_APPEND 原子写入，按插件/类别分文件。**无 DB 交互**。

**DB 写入路径**: 全部通过 `db-state-manager.ts` CRUD 函数，不调用 `writeLog()`。每个 CRUD 函数的错误路径调用 `writeLog(SRC, "ERROR", { event, detail })` 记录诊断信息。

**v4 集成要求**:

| 操作 | writeLog() | DB CRUD |
|------|:---------:|:-------:|
| `dbAppendSessionLog()` | 错误时调用 | 直接 `db.run()` |
| `dbWriteSessionMap()` | 错误时调用 | 直接 `db.transaction()` |
| `dbAppendDispatchFailed()` | 错误时调用 | 直接 `db.run()` |
| Schema v6 迁移 | INFO 级别必须调用 | — |
| `dbCleanStaleEntries()` 扩展 | 错误时调用 | 直接 `db.run()` |

**现有审计表重叠分析**:

| 现有表 | 用途 | 与 v4 重叠 |
|--------|------|:---------:|
| `gate_audit_history` | Gate session 生命周期审计 | 无 — gate compliance vs dispatch execution |
| `audit_log` | 通用事件日志 | 无 — 无 dag_task_id 索引，非 resume 查询目标 |
| `audit_trail` | Per-session trail blob | 无 — session 级摘要，非 per-dispatch 记录 |

**结论**: v4 三张表服务独立运营需求（resume 查询、失败率追踪、agent 解析），与现有审计表职责正交，无功能重叠。

### 15.3 框架一致性审计

**结论**: DB 基础设施坚固，但有 5 处活跃消费者必须原子迁移，否则破坏 P0-4 作用域执法。

#### DB 基础设施一致性

- **单例模式**: `getDb()` 模块级 `_db`，`forceReset` 支持 VACUUM 后重连 — ✅ 一致
- **WAL 模式**: 每连接启用，支持并发读 — ✅ 一致
- **busy_timeout**: 5000ms — 对 framework 写入模式充分 — ✅ 一致
- **Schema 版本控制**: v1-v5 幂等迁移（try/catch + `ALTER TABLE` 列存在检查）— ✅ 一致
- **并发访问**: 新表继承 WAL + busy_timeout 保护，与 `gate_sessions` 等现有表完全一致 — ✅ 一致

#### 5 处活跃代码消费者 (必须原子迁移)

| 文件 | 操作 | 依赖文件 | 风险级别 |
|------|------|---------|:--------:|
| `.opencode/lib/agent-resolver.ts` | 读 `.session_map.json` | session_map | 🔴 高 — P0-4 作用域执法依赖 |
| `.opencode/plugins/session.ts` | 写 `.session_map.json` | session_map | 🔴 高 — 同上 |
| `.opencode/plugins/task-after.ts` | 写 `SESSION_ID.md` + `.pending.json.failed` | session_log + dispatch_failed_log | 🟡 中 |
| `.opencode/plugins/dispatch-after.ts` | 写 `.pending.json.failed` | dispatch_failed_log | 🟢 低 — 纯归档 |
| `.opencode/scripts/command-tools/dispatch-subagent.ts` | 读 `SESSION_ID.md` | session_log | 🟡 中 — resume 流程 |

**关键风险**: `agent-resolver.ts` 是 P0-4 作用域执法的基础（`resolveAgentFromSessionMap()` 是 Priority 1 agent 解析路径）。`session_map` DB 化必须与 `session.ts` **原子同步**迁移，否则 P0-4 会因 session_map 不可读而失效，导致路由越界检查被跳过。

#### 框架脚本兼容性

| 脚本 | 是否引用目标文件 | 风险 |
|------|:--------------:|:----:|
| `state-reconciliation.ts` | 否 | 无 |
| `framework-self-test.ts` | Check 33 验证 `.pending.json` (非 `.failed`) | 无 — 但需新增 v6 表检查 |
| `nightly-compaction.ts` | 否 | 无 — 已含 `dbMaintenanceStep()` |
| `gate-core.ts` | 否 — DB-first 架构 | 无 |
| MCP tools (`compliance-gate.ts` 等) | 否 | 无 |
| Git hooks (`hook-layers.ts` 等) | 否 | 无 |

**Self-test 缺口**: 当前 37 个检查中无验证 `session_log`、`dispatch_failed_log`、`session_map` 表的存在性或数据完整性。v6 schema 迁移后需新增 Check 38（验证 3 张新表存在且可查询）。

### 15.4 安全迁移顺序

基于 P0-4 保护要求，实施顺序如下：

```
Phase A: DB Schema (零行为变更)
  Step 1: db-manager.ts v6 schema (3 新表 + 索引)
  Step 2: db-state-manager.ts 新增 7 个 CRUD 函数
  Step 3: framework-self-test.ts 新增 Check 38

Phase B: .dispatch_ctx + session_log (修复 Bug 1+2)
  Step 4: dispatch_subagent.ts 写 .dispatch_ctx + 恢复 finally 清除 env var
  Step 5: task-after.ts 读 .dispatch_ctx → dbAppendSessionLog() → 删 .dispatch_ctx
  Step 6: dispatch-subagent.ts (CLI) resume 分支改查 dbQuerySessionByDagTaskId()

Phase C: session_map DB 化 (最高风险 — P0-4 保护)
  Step 7: session.ts 写 DB 替代 JSON 文件
  Step 8: agent-resolver.ts 读 DB 替代 JSON 文件
  → Step 7 和 8 必须在同一提交中原子完成

Phase D: dispatch_failed_log DB 化 (最低风险)
  Step 9: task-after.ts 写 DB 替代 .pending.json.failed
  Step 10: dispatch-after.ts 写 DB 替代 .pending.json.failed
  Step 11: dbCleanStaleEntries() 扩展 (7 天 TTL + 行上限)

Phase E: 清理 + 文档
  Step 12: 移除旧文件引用 (SESSION_ID.md, .session_map.json, .pending.json.failed)
  Step 13: Orchestrator.md 更新 4 行 (L48, L149, L154, L161)
```

**关键约束**:
- Phase C 的 Step 7 和 8 必须原子提交，否则 P0-4 作用域执法短暂失效
- Phase B 可独立实施（`.dispatch_ctx` + `session_log` 不影响 P0-4）
- Phase D 可独立实施（`.pending.json.failed` 无读取者，零风险）
- Phase E 在 A-D 全部验证通过后执行

---

## 十六、SA-FIX-APPROVE-PERMISSION: approve_deliverables 调用者身份硬化

### 16.1 漏洞分析

**问题**: `compliance_gate_approve_deliverables` 工具描述声明 "RESTRICTED to @Orchestrator/@Super-Admin"，但无代码级身份校验。任何 agent 可调用此工具审批/驳回任意 session 的成果物。

**漏洞类别**: 与 `SA-FIX-GATE-PERMISSION` (2026-06-11) 完全同类 — `compliance_gate_retry_confirm` 曾有相同漏洞，`Knowledge-Curator` 成功绕过。

**当前状态** (修复前):

| 校验层 | 状态 |
|--------|------|
| 工具描述 "RESTRICTED" | ✅ 存在 (仅文本) |
| JSDoc 注释 | ✅ 存在 (仅文档) |
| 代码级身份校验 | ❌ 不存在 |
| ALLOWED 列表 | ❌ 不存在 |

### 16.2 MCP 调用者身份获取约束

**关键发现**: `context.agent` 在 MCP 工具 handler 中**始终为 `undefined`**。

**证据** (`compliance-gate.ts` 三处注释):
- L2122: `"The MCP handler only receives (request), NOT (context). context?.agent is always undefined."`
- L2461: `"context?.agent is NOT available in the raw MCP handler"`
- L2085-2086: `"Removed deprecated FRAMEWORK_AGENT env var"`

**原因**: MCP stdio transport 的 JSON-RPC 协议不携带 caller identity 元数据。MCP handler 签名 `setRequestHandler(CallToolRequestSchema, async (request) => {...})` 仅接收 `request.params.name` + `request.params.arguments`。

**`FRAMEWORK_AGENT` 已废弃** (v4.0.0)，运行时从不设置。

### 16.3 修正方案: 三层 fallback chain

复用 `runGateRetryConfirm` (L2139-2142) 已验证的模式:

```
Layer A: agent_id 参数 (工具 schema 新增，调用者显式传入)
Layer B: session.agent (gate-state 持久化，confirm 时写入)
Layer C: resolveDispatchTargetAgentDirect() (_dispatch_target.json)
```

**三处修改**:

| # | 文件 | 修改 |
|---|------|------|
| 1 | `compliance-gate.ts` 工具 schema | 新增 `agent_id` 参数 (optional, string) |
| 2 | `runGateApproveDeliverables()` | 新增 `agentId` 参数 + `ALLOWED_APPROVE_AGENTS` 列表 + 三层 fallback chain + 拒绝非授权调用 |
| 3 | MCP handler dispatch | 传递 `args.agent_id` 到 `runGateApproveDeliverables` 第 5 参数 |

### 16.4 实施详情

**工具 schema 变更**:
```typescript
agent_id: {
  type: "string",
  description: "Agent identity of the caller (e.g. 'Orchestrator', '@Super-Admin'). "
    + "Used for permission enforcement. Restricted to @Orchestrator/@Super-Admin.",
}
```

**身份校验代码**:
```typescript
const ALLOWED_APPROVE_AGENTS = ["@Orchestrator", "@Super-Admin", "Orchestrator", "Super-Admin"];
const resolvedAgent = (agentId
  || (session && session.agent)
  || resolveDispatchTargetAgentDirect()
  || "").replace(/^@/, "");
if (resolvedAgent && !ALLOWED_APPROVE_AGENTS.includes(resolvedAgent)
    && !ALLOWED_APPROVE_AGENTS.includes("@" + resolvedAgent)) {
  return {
    status: "rejected",
    reason: `compliance_gate_approve_deliverables restricted to @Orchestrator/@Super-Admin. `
      + `Current agent: @${resolvedAgent}.`,
  };
}
```

### 16.5 9 子系统影响审计

| Agent | 影响 | 说明 |
|-------|:----:|------|
| @Orchestrator | ✅ 无 | 在 ALLOWED 列表中，调用不受阻 |
| @Super-Admin | ✅ 无 | 在 ALLOWED 列表中，调用不受阻 |
| @Meta-Planner | ✅ 无 | 非审批者，修复后阻止越权调用 |
| @Coder-BE/FE | ✅ 无 | 同上 |
| @Architect | ✅ 无 | 同上 |
| @Guardian | ✅ 无 | 同上 |
| @Arbiter | ✅ 无 | 同上 |
| @CI-CD-Agent | ✅ 无 | 同上 |
| @Knowledge-Curator | ✅ 无 | 同上 — 修复 SA-FIX-GATE-PERMISSION 同类漏洞 |

**结论**: 零 agent 配置需修改。仅阻止非授权 agent 调用 approve_deliverables，对合法流程无影响。

### 16.6 框架一致性审计

| 维度 | 一致性 | 说明 |
|------|:------:|------|
| MCP 工具模式 | ✅ | 复用 `retry_confirm` 已验证的三层 fallback chain |
| 日志系统 | ✅ | 拒绝时由 MCP handler 返回 `isError: true`，不额外写日志 (与 retry_confirm 一致) |
| DB schema | ✅ | 不涉及新表/新列 |
| 子进程隔离 | ✅ | 不依赖 process.env (FRAMEWORK_AGENT 已废弃) |
| P0-4 作用域 | ✅ | 补充了 approve_deliverables 的权限缺口，与 retry_confirm 对齐 |

### 16.7 实施状态

**日期**: 2026-06-17
**状态**: ✅ **已实施** — `compliance-gate.ts` 3 处修改已完成并验证加载通过
