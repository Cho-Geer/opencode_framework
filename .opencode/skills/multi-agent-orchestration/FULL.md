---
name: multi-agent-orchestration
description: Trigger and orchestrate the three-layer eight-role multi-agent system for complex development tasks. Use when user mentions "多智能体模式", "multi-agent", or when tasks require full-lifecycle development (requirements analysis, architecture design, coding, testing, review, deployment). Automatically validates AGENTS.md alignment, verifies all 8 agent configurations, and initiates the standard multi-agent workflow.
---

# Multi-Agent Orchestration

## Trigger Conditions

Activate when user conversation contains any of:
- "多智能体模式" (multi-agent mode)
- "multi-agent"
- Complex full-lifecycle development tasks requiring multiple roles
- **Any new issue / bug / style inconsistency / error fix** (详见下方自动触发规则)

### 🚨 Automatic Trigger Rule

以下场景**自动触发** multi-agent 流程，无论用户是否明确提及"multi-agent"：

| 场景 | 示例 | 是否触发 |
|------|------|---------|
| 描述了一个可验证的**代码问题或需求** | "样式不一致"、"报错了"、"按钮不工作" | ✅ 触发 |
| 问题**涉及代码变更**（非纯信息查询） | "修复这个 bug"、"调整布局" | ✅ 触发 |
| 问题**跨越多个组件/模块** | "前后端联调问题"、"暗亮模式主题色" | ✅ 触发 |
| **纯信息查询** | "这个 API 参数含义是什么"、"文档哪里写了" | ❌ 不触发 |

**满⾜以上任意一条代码变更场景** → 必须走完整 multi-agent 流程，**以 dispatch @Meta-Planner 为第一动作**。

## Pre-flight Validation

### Step 1: Verify AGENTS.md

1. Read `AGENTS.md` at project root
2. Confirm it exists and contains the 8-agent registry:
   - @Meta-Planner, @Orchestrator, @Architect, @Coder-FE, @Coder-BE, @Guardian, @Arbiter, @CI-CD-Agent
3. Verify the standard execution flow (Section 六) is present

### Step 2: Validate Agent Configurations

Check each agent file in `.opencode/agents/`:

| Agent | File | Expected Name |
|-------|------|---------------|
| Meta-Planner | `meta-planner.md` | Meta-Planner |
| Orchestrator | `orchestrator.md` | Orchestrator |
| Architect | `architect.md` | Architect |
| Coder-FE | `coder-fe.md` | Coder-FE |
| Coder-BE | `coder-be.md` | Coder-BE |
| Guardian | `guardian.md` | Guardian |
| Arbiter | `arbiter.md` | Arbiter |
| CI-CD-Agent | `ci-cd-agent.md` | CI-CD-Agent |

For each agent file verify:
- YAML frontmatter `name` field matches AGENTS.md declaration
- `skills` list is present and non-empty
- `model` field is set
- Core职责, 强制约束, 输入契约, 输出产物 sections exist

### Step 3: Alignment Check

Compare AGENTS.md agent list (Section 一 & 三) against actual `.opencode/agents/*.md` files:
- Count must match: 8 agents
- Names must match exactly (case-sensitive)
- Layer assignments must match (Meta/Execution/Validation)

If any misalignment found, report specific discrepancies and halt until resolved.

## Multi-Agent Execution Flow

Once validation passes, follow the standard flow from AGENTS.md Section 六:

```
0. 【Entry Gate】收到新工作项 → 检查 Task.DAG.json
   - 无 DAG → dispatch @Meta-Planner
   - 有 DAG 有对应条目且 pending → 按 DAG 执行
1. @Meta-Planner 读取要件 → 生成 Project.graph + Task.DAG.json
2. @Orchestrator 调度 → @Architect 输出 contract.yaml（TDD唯一依据）
3. 【TDD-RED】@Coder-FE/@Coder-BE 基于契约+要件 → 编写失败测试用例 → 执行（强制失败）
4. 【TDD-GREEN】@Coder-FE/@Coder-BE 基于测试 → 编写最简代码 → 测试全通过
5. 【TDD-REFACTOR】@Coder-FE/@Coder-BE 重构 → 回归测试（保持全通过）
6. @Guardian 审查（规范/安全/架构）→ 冲突由 @Arbiter 裁决
7. 代码合并 → @CI-CD-Agent 部署/自愈 → 结果回传@Orchestrator
```

### TDD Enforcement (Absolute)

- No test cases = no business code
- RED: tests must fail first before development
- GREEN: write minimal code to pass tests only
- REFACTOR: only after all tests pass
- Gate: tests not 100% passing = no code review

### Collaboration Protocols

1. **Permission Isolation**: Each agent only calls its bound skills, no cross-authority
2. **DAG Scheduling**: @Orchestrator parses Task.DAG.json, schedules by dependency order
3. **Contract-Driven**: @Architect's contract.yaml is read-only, sole basis for dev/test/review
4. **Quality Gate**: All code must pass @Coder-FE/@Coder-BE tests + @Guardian review, no merge without pass
5. **Closed Loop**: @CI-CD-Agent reports back to @Orchestrator, @Arbiter reports to @Meta-Planner
6. **Context Governance**: Compress context after each phase, no pollution
7. **Dead-Loop Circuit Breaker**: 3 consecutive failures → @Arbiter介入

## Compliance Requirements

All agents must strictly follow:
- `.opencode/rules/common-project.md`
- `.opencode/rules/mcp-compliance-guide.md`
- `.opencode/rules/skill-compliance-guide.md`
- All requirement documents in `.opencode/context/requirements/`

## Quick Reference: Agent Layer Map

```
Meta Layer (元认知层)
  ├── @Meta-Planner   → Project.graph, Task.DAG.json
  └── @Orchestrator   → Task scheduling ONLY (NO requirement analysis)

Execution Layer (编排与执行层)
  ├── @Architect      → contract.yaml, architecture docs
  ├── @Coder-FE       → Frontend code (pages, components)
  └── @Coder-BE       → Backend code (API, business logic, DB)

Validation Layer (验证与运维层)
  ├── @Guardian       → Code review, security scan, architecture check, test evidence validation
  ├── @Arbiter        → Conflict resolution, tech debt waiver
  └── @CI-CD-Agent    → CI/CD, deployment, incident response
```
