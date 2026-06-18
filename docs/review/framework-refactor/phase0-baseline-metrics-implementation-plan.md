# Phase 0 基线测量实施方案

**日期**: 2026-06-17  
**状态**: Implementation Plan  
**适用阶段**: P2-D Permission Source Inversion 已完成之后的下一步  
**保存位置**: `docs/review/framework-refactor/phase0-baseline-metrics-implementation-plan.md`

## 1. 结论

根据 `execution-priority-analysis.md` 的优先级排序，P2-D 完成后下一步应优先执行 **Phase 0 基线测量**，而不是立即进入 P3-E 或代理职责合并。

原因如下：

1. `framework-architecture-optimization-proposal.md` 将 Phase 0 标记为所有主线优化的前置条件。
2. 后续 P3-E Permission Matrix System、A3 代理职责合并、C1 Hook Matrix 和 B1/B2 DAG 存储重构都需要基线数据来证明收益。
3. 如果在采集基线前继续实施结构性优化，会失去“当前 P2-D 后框架状态”的对照样本，后续无法严谨评估耗时、token、返工率和合规调用量是否改善。

因此本实施方案的目标是：在 P2-D 完成后的当前框架状态下，建立可重复采集的基线指标体系，并形成 `.opencode/state/baseline-metrics.json`。

## 2. 范围

### 2.1 本阶段包含

1. 定义基线指标 schema。
2. 增加只读指标采集脚本。
3. 采集 5-10 个完整任务流的端到端数据。
4. 生成 `.opencode/state/baseline-metrics.json`。
5. 输出基线报告，为后续 P3-E、A3、B/C 线优化提供比较依据。

### 2.2 本阶段不包含

1. 不实施 P3-E Permission Matrix 模板化。
2. 不合并或裁撤任何 Agent。
3. 不重构 DAG 存储。
4. 不修改 dispatch、gate、permission 的运行时决策逻辑。
5. 不改变当前 enforcement mode、DAG 策略和角色边界。

本阶段必须尽量保持低侵入，避免采集工具本身改变被测系统行为。

## 3. 关键输入

### 3.1 文档输入

1. `docs/review/framework-refactor/execution-priority-analysis.md`
2. `docs/review/framework-refactor/framework-evaluation-report.md`
3. `docs/review/framework-refactor/framework-architecture-optimization-proposal.md`
4. `docs/review/framework-refactor/p2d-permission-source-inversion-plan.md`

### 3.2 代码与状态输入

建议优先从以下本地真实来源采集数据：

1. `.opencode/lib/db-state-manager.ts`
   - `gate_sessions`
   - `session_log`
   - `dispatch_failed_log`
   - `session_map`
2. `.opencode/lib/log-manager.ts`
   - `.task_temp/_logs`
   - source-aware log index
3. `Task.DAG.json`
   - task id
   - agent type
   - dependency/status
4. Git 历史
   - commit hash
   - task commit marker
   - P2-D 后基线窗口起点

## 4. 指标定义

Phase 0 至少采集以下四类指标。

### 4.1 端到端耗时

用于衡量一个任务从 gate check / dispatch 到 complete 的完整耗时。

推荐字段：

1. `started_at`
2. `completed_at`
3. `duration_ms`
4. `duration_source`

优先使用 `gate_sessions.created_at`、`armed_at`、`completed_at`。如果单个任务跨多个 session，则使用最早开始时间和最晚完成时间。

### 4.2 Token 使用量

用于衡量当前 10-agent + DAG + full enforcement 模式下的上下文消耗。

推荐字段：

1. `input_tokens`
2. `output_tokens`
3. `total_tokens`
4. `collection_status`

注意：当前本地 DB 和日志不一定稳定记录 token。实施时不得臆造数据。若 OpenCode 本地 transcript 或运行日志没有可靠 token 字段，则将该指标标记为：

```json
{
  "input_tokens": null,
  "output_tokens": null,
  "total_tokens": null,
  "collection_status": "manual"
}
```

允许通过人工记录或外部运行台账补齐，但必须保留 `collection_status`，区分 `auto`、`manual`、`unavailable`。

### 4.3 返工率

用于衡量任务执行过程中由于审查失败、测试失败、权限拒绝或熔断导致的重复工作。

推荐字段：

1. `failed_reviews`
2. `failed_tests`
3. `dispatch_failures`
4. `permission_denials`
5. `retry_count`
6. `arbiter_waivers`
7. `rework_score`

`rework_score` 建议先采用简单加权：

```text
rework_score =
  failed_reviews
  + failed_tests
  + dispatch_failures
  + permission_denials
  + retry_count
  + arbiter_waivers
```

后续如果需要更细粒度分析，再引入权重，不在 Phase 0 过度设计。

### 4.4 合规门 MCP 调用次数

用于衡量当前 compliance gate 流程的治理开销。

推荐字段：

1. `check`
2. `confirm`
3. `submit_deliverables`
4. `approve_deliverables`
5. `complete`
6. `total`

如果日志中只能识别部分调用，则保留 `unknown` 字段并记录采集说明。

## 5. 目标产物

### 5.1 `.opencode/state/baseline-metrics.json`

建议 schema：

```json
{
  "schema_version": "1.0",
  "created_at": "2026-06-17T00:00:00.000Z",
  "baseline_window": {
    "start": null,
    "end": null
  },
  "framework_snapshot": {
    "commit": null,
    "p2d_status": "completed",
    "agent_count": 10,
    "enforcement_mode": null,
    "dag_mode": "Task.DAG.json"
  },
  "tasks": [
    {
      "task_id": null,
      "task_type": null,
      "primary_agent": null,
      "sessions": [],
      "started_at": null,
      "completed_at": null,
      "duration_ms": null,
      "gate_mcp_calls": {
        "check": 0,
        "confirm": 0,
        "submit_deliverables": 0,
        "approve_deliverables": 0,
        "complete": 0,
        "unknown": 0,
        "total": 0
      },
      "dispatch_count": 0,
      "rework": {
        "failed_reviews": 0,
        "failed_tests": 0,
        "dispatch_failures": 0,
        "permission_denials": 0,
        "retry_count": 0,
        "arbiter_waivers": 0,
        "score": 0
      },
      "token_usage": {
        "input_tokens": null,
        "output_tokens": null,
        "total_tokens": null,
        "collection_status": "manual"
      },
      "evidence": {
        "gate_sessions": [],
        "logs": [],
        "commits": []
      },
      "collection_notes": []
    }
  ],
  "aggregate": {
    "task_count": 0,
    "median_duration_ms": null,
    "p95_duration_ms": null,
    "avg_gate_mcp_calls": null,
    "avg_dispatch_count": null,
    "avg_rework_score": null,
    "token_coverage": "0/0"
  },
  "collection_notes": []
}
```

### 5.2 采集脚本

建议新增：

```text
.opencode/scripts/framework-baseline-metrics.ts
```

脚本职责：

1. 只读查询 DB 和日志。
2. 聚合任务级指标。
3. 支持 `--dry-run` 预览。
4. 支持 `--write .opencode/state/baseline-metrics.json` 写入快照。
5. 不修改 gate、dispatch、permission、DAG 的运行时状态。

### 5.3 基线报告

数据采集完成后新增：

```text
docs/review/framework-refactor/phase0-baseline-metrics-report.md
```

报告至少包含：

1. 样本任务列表。
2. 聚合指标。
3. token 指标覆盖率。
4. 返工原因分布。
5. 对 P3-E、A3、B/C 线后续优化的阈值建议。

## 6. 实施步骤

### Step 0: 冻结基线窗口

1. 记录 P2-D 完成后的当前 commit。
2. 确认在基线采集窗口内不实施 P3-E、A3、DAG 存储重构等结构性优化。
3. 定义样本数量：最低 5 个完整任务，目标 10 个完整任务。
4. 样本尽量覆盖：
   - framework/doc/review 类任务
   - backend 类任务
   - frontend 类任务
   - 至少 1 个涉及权限或 dispatch 的任务

完成标准：

1. 明确 `baseline_window.start`。
2. 当前 commit 写入 `framework_snapshot.commit`。
3. P2-D 状态写入 `framework_snapshot.p2d_status = "completed"`。

### Step 1: 定义并落地 schema

1. 创建 `.opencode/state/baseline-metrics.json` 初始文件。
2. 写入 `schema_version`、`framework_snapshot` 和空 `tasks`。
3. 明确 nullable 字段和 `collection_status` 语义。

完成标准：

1. JSON 可被标准解析器解析。
2. schema 能覆盖四类核心指标。
3. 未采集到的数据显式使用 `null` 或 `collection_status`，不得用 0 伪装。

### Step 2: 实现只读采集脚本

脚本建议分为四个采集器：

1. `collectGateSessions()`
   - 来源：`gate_sessions`
   - 输出：session 生命周期、gate 状态、task 描述。
2. `collectDispatchSessions()`
   - 来源：`session_log`、`dispatch_failed_log`
   - 输出：agent、run id、dispatch 次数、dispatch 失败。
3. `collectTaskLogs()`
   - 来源：`.task_temp/_logs`
   - 输出：测试失败、审查失败、权限拒绝、compliance gate 调用痕迹。
4. `collectGitEvidence()`
   - 来源：`git log`
   - 输出：commit 证据和任务 marker。

完成标准：

1. `--dry-run` 不写文件。
2. `--write` 只写 `.opencode/state/baseline-metrics.json`。
3. 脚本重复执行结果稳定。
4. 找不到 token 字段时不报错，写入 `collection_status = "unavailable"` 或保留人工补录入口。

### Step 3: 采集 5-10 个完整任务样本

每个样本任务完成后执行：

```bash
bun .opencode/scripts/framework-baseline-metrics.ts --write .opencode/state/baseline-metrics.json
```

如 token 需要人工补录，则在任务完成后立即补录，避免事后追溯失真。

完成标准：

1. 至少 5 个任务拥有完整 `started_at`、`completed_at`、`duration_ms`。
2. 每个任务都有 `evidence` 指向 session/log/commit 中至少一种证据。
3. 每个任务都有 `gate_mcp_calls` 和 `rework` 字段。
4. token 指标即使缺失，也必须明确 `collection_status`。

### Step 4: 聚合并生成报告

执行聚合逻辑：

1. `task_count`
2. `median_duration_ms`
3. `p95_duration_ms`
4. `avg_gate_mcp_calls`
5. `avg_dispatch_count`
6. `avg_rework_score`
7. `token_coverage`

然后生成 `phase0-baseline-metrics-report.md`。

完成标准：

1. 报告列出样本覆盖范围。
2. 报告明确哪些指标是自动采集，哪些是人工补录，哪些不可用。
3. 报告给出后续阶段可比较的基线值。

### Step 5: 后续阶段解锁判定

Phase 0 完成后，按以下条件决定是否进入下一阶段：

1. 若样本任务少于 5 个：不得进入 A3 代理合并验证；可继续补采样本。
2. 若 token 覆盖率为 0：可以进入 P3-E，但报告必须声明 token 基线不可用于收益判定。
3. 若缺少 backend/frontend 样本：不得启动 A3 的 BE/FE A/B 验证。
4. 若存在大量采集字段不可用：先补强采集脚本，再进入结构性重构。

## 7. 验证命令

实施完成后建议执行：

```bash
bun .opencode/scripts/framework-baseline-metrics.ts --dry-run
```

```bash
bun .opencode/scripts/framework-baseline-metrics.ts --write .opencode/state/baseline-metrics.json
```

```bash
node -e "JSON.parse(require('fs').readFileSync('.opencode/state/baseline-metrics.json', 'utf8')); console.log('baseline metrics json ok')"
```

如果当前框架自检脚本可用，再执行：

```bash
bun .opencode/scripts/framework-self-test.ts --strict
```

## 8. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| token 不在本地日志中稳定可得 | 无法自动计算 token 基线 | 使用 `collection_status` 明确标记，允许人工补录，不伪造数据 |
| 样本任务类型单一 | 后续优化比较失真 | 采样时强制覆盖 framework/backend/frontend/permission 相关任务 |
| 采集脚本影响运行时状态 | 基线被采集工具污染 | 脚本只读 DB 和日志，只允许写 baseline JSON |
| P2-D 后仍有未提交变更 | framework snapshot 不稳定 | 在 baseline 中记录 commit 和 dirty 状态 |
| 过早实施 P3-E/A3 | 失去当前状态基线 | 基线窗口内冻结结构性优化 |

## 9. 时间安排

建议排期：

1. Day 1: schema 与采集脚本实现。
2. Day 1-2: dry-run 验证和字段修正。
3. Day 2-7: 采集 5-10 个完整任务样本。
4. Day 7: 聚合指标并生成 Phase 0 报告。
5. Day 8: 决策是否进入 P3-E。

## 10. P3-E 的位置

P2-D 完成后，P3-E Permission Matrix System 已具备实施前置条件，但不应抢在 Phase 0 之前执行。

建议顺序：

1. 先完成 Phase 0 基线测量。
2. 再实施 P3-E Permission Matrix 模板化与 scope 简化。
3. 用 Phase 0 指标对比 P3-E 后的权限配置复杂度、dispatch/gate 失败率和返工率。
4. 如果 P3-E 后数据稳定，再进入 A3 代理职责合并或 C/B 线结构重构。

这一路径能保留严谨对照组，同时避免在没有数据的情况下继续扩大架构变更范围。

