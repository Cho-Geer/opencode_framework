# dispatch_queue 职责定义 (Phase 2)

> **Created**: 2026-07-05
> **Phase**: 2

---

## 保留用途

| 用途 | 说明 |
|------|------|
| Session Resume | 被拒交付恢复，需 dispatch_queue 记录原始 payload |
| ACP Bridge | QoderWork 通过 serve API 观察任务状态 |
| 长任务追踪 | 跨 session 的大型任务需要 payload integrity |
| 子会话 payload | dispatch_subagent 的 task_description 完整性保证 |

## 移除用途

| 用途 | 原行为 | Phase 2 变更 |
|------|--------|-------------|
| 普通任务强制写入 | 所有 dispatch 必须写 dispatch_queue | require_dag_entry=false 时跳过 |
| DAG 合法性来源 | dispatch 前必须检查 DAG entry | 不再强制，仅大型任务使用 |

## 写入条件

| 条件 | 写入 dispatch_queue? |
|------|---------------------|
| 有 dag_task_id | 是（trace/resume） |
| 用户要求大型规划 | 是（planning artifact） |
| 普通 bugfix/小任务 | 否（直接 dispatch） |
| 框架核心高风险 | 是（记录更多审计） |

---

## 变更日志

| 日期 | 操作 |
|------|------|
| 2026-07-05 | 初始职责定义 |
