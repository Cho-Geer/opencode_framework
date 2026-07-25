# Agent Alias Mapping (Phase 2)

> **Created**: 2026-07-05
> **Phase**: 2 (原生 Agent 替换 + DAG 解耦)

---

## Alias 映射表

| 当前自定义身份 | 目标原生执行器 | 保留 | 迁移到 Skill |
|---|---|---|---|
| Orchestrator | Plan | alias, dispatch metadata | multi-agent-orchestration, dispatch-protocol |
| Meta-Planner | Plan | alias | (planning logic stays in DAG generation) |
| Architect | General | alias | (architecture knowledge in prompts) |
| Coder-BE | Build | alias, backend scope | (backend scope via write_scope) |
| Coder-FE | Build | alias, frontend scope | (frontend scope via write_scope) |
| Guardian | Explore | alias, readonly scope | (review logic in prompts) |
| Arbiter | General | alias, waiver permission | review-arbitration |
| CI-CD-Agent | Build | alias, ops scope | ci-cd-guardrails |
| Knowledge-Curator | Explore | alias, read/source policy | (knowledge pipeline in context7-first) |
| Super-Admin | Build (break-glass) | alias, explicit approval | customize-opencode |

## 映射说明

### 当前状态（Phase 2 起点）
- 10 个自定义 Agent 各有独立 .md prompt（1,282 行总计，Phase 1 瘦身之后）
- dispatch 通过 `dispatch_subagent` 工具 + L0-L4 route validator
- `require_dag_entry: false`（DAG 已可选）
- `route_rules.enforcement.dispatch: "block"` → Phase 2 改为 `"warn"`

### 目标状态（Phase 5 终点）
- 10 个 Agent .md 变为 alias manifest（每个 <50 行）
- 原生 Agent 负责执行，Skill 负责能力
- route mismatch 仅写日志不阻断
- DAG 仅为大型任务的可选规划 artifact

### 渐进迁移路径
1. **Phase 2**: route enforcement block→warn, alias 映射表建立
2. **Phase 3**: handler 收敛，硬约束分级
3. **Phase 5**: Agent .md alias manifest 化

## write_scope 保留

即使 Agent 变为 alias，write_scope 仍由 scope handler 控制：

| Agent | write_scope |
|---|---|
| Coder-BE | booking_system_refactor/booking-backend/ |
| Coder-FE | booking_system_refactor/booking-frontend/ |
| Super-Admin | .opencode/, docs/, .task_temp/ |
| Guardian | (read-only, no write) |
| Orchestrator | (no write) |

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始映射表创建 |
