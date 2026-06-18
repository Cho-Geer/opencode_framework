# Step 0d — Multi-Source Log Audit Mandate 实施方案

**版本**: v1.0.0
**日期**: 2026-06-18
**作者**: @Super-Admin
**状态**: 方案制定，待实施

---

## 一、问题背景

2026-06-18 DISPATCH-INTEGRITY 集成测试中，@Orchestrator 派遣 @Super-Admin 审计 FRAMEWORK_TASK_ID，任务描述遗漏了"结合日志"指令，导致仅做了代码 grep。

## 二、设计目标

强制所有调查/诊断/分析/审计/排错类子Agent任务必须结合源代码和运行时日志进行多源分析。

## 三、实施方案（4 修改点）

### 3.1 Preamble: subagent-preamble.md Step 0d

**位置**: Step 0c 之后，Step 1 之前。改动 ~25 行。

触发词:
- EN: investigation, audit, analysis, diagnosis, diagnose, debug, troubleshoot, root-cause, trace, tracing, forensic
- CN: 调查, 排查, 调试, 诊断, 根因, 审计, 追溯, 排错, 定位
- 故意排除: verify, examine, inspect (太宽，TDD和部署检查会误触发)

强制要求: HANDOVER.md 必须含 "## Logs Checked" 段，列至少 2 个日志/审计源。

日志分两类:
Text logs (read/grep): .opencode/logs/, .opencode/logs/mcp-compliance-gate/, .opencode/logs/safe-bash.log, .opencode/state/.transaction-log, .task_temp/_dispatch/, .opencode/logs/archive/
DB/JSON logs: .opencode/state/session_log/ (SQLite), gate-state.json, gate-state.history/, gate-state.archive.json, machine.json

### 3.2 Gate后置: compliance_gate_approve_deliverables()

**为什么放 approve 不放 submit_deliverables**:
1. submit_deliverables 只校验文件存在性，不读内容
2. approve 是 Orchestrator 审批入口，天然有权读 .task_temp/  
3. task_description 可从 gate-state.json.active_sessions[sid].plan_summary 获取

新增 enforceMultiSourceAudit(sessionId, taskId):
1. 从 gate-state 取 plan_summary，匹配 20 个触发词
2. 读取 .task_temp/{taskId}/HANDOVER.md
3. 检查 /##\s+Logs\s+Checked/i 段是否存在
4. 不存在 → 返回 failed，approval 被拒

### 3.3 task_description 来源

gate-state.json.active_sessions[sid].plan_summary ← 子Agent compliance_gate_confirm 时写入

### 3.4 Orchestrator 前置

Orchestrator.md 新增 Pre-Dispatch Checklist:
- Task desc 包含显式日志检查指令
- 目标 Agent 具备调查能力
- 日志路径与 Agent read 权限匹配

## 四、日志路径权威清单

| # | 类别 | 路径 | 方式 |
|---|------|------|------|
| 1 | 运行时日志 | .opencode/logs/ | read/grep |
| 2 | MCP Gate | .opencode/logs/mcp-compliance-gate/ | read/grep |
| 3 | Shell | .opencode/logs/safe-bash.log | read/grep |
| 4 | 交易 | .opencode/state/.transaction-log | read/grep |
| 5 | Dispatch输出 | .task_temp/_dispatch/dispatch-*.md | read/grep |
| 6 | Dispatch队列 | .task_temp/_dispatch/.pending.json | read |
| 7 | Dispatch失败 | .task_temp/_dispatch/.pending.json.failed | read |
| 8 | 调用摘要 | .task_temp/_dispatch/INVOCATION_SUMMARY.md | read |
| 9 | 归档 | .opencode/logs/archive/ | read/ls |
| 10 | Gate状态 | .opencode/state/gate-state.json | read |
| 11 | Gate历史 | .opencode/state/gate-state.history/ | read/ls |
| 12 | Gate归档 | .opencode/state/gate-state.archive.json | read |
| 13 | 机器状态 | .opencode/state/machine.json | read |
| 14 | Session DB | .opencode/state/session_log/ (SQLite) | safe_shell sqlite3 |

## 五、实施步骤

| Step | 文件 | 改动 | 验证 |
|:----:|------|------|------|
| 1 | subagent-preamble.md | +Step 0d (~25行) | 派遣调查任务，检查preamble |
| 2 | compliance-gate.ts | +enforceMultiSourceAudit() (~30行) + 插入runGateApproveDeliverables | HANDOVER缺Logs Checked→拒 |
| 3 | Orchestrator.md | +Pre-Dispatch Checklist | 文档复核 |
| 4 | framework-self-test.ts | +Check 33 trigger词存在性 | bun run |
| 5 | 集成测试 | 派遣调查任务，故意缺日志→确认被拒 | E2E |
