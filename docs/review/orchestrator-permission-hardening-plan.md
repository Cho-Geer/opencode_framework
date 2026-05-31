# Orchestrator权限强化实施方案

## 目标
修正Orchestrator权限配置，移除多余权限，使其严格专职调度。

## 当前问题
Orchestrator拥有以下多余权限，导致频繁越权：
- safe_bash（可执行任意shell命令）
- safe_edit（可修改文件）
- webfetch/websearch（可在线调研分析）
- 无限制的read权限

## 修正内容

### 1. opencode.json - Orchestrator权限块
- 移除safe_bash、safe_edit、webfetch、websearch权限
- 将read限制为仅允许调度相关文件

### 2. .opencode/agents/Orchestrator.md
- mcp_tools从7个缩减为仅compliance_gate_*
- agent_tools_whitelist从8个缩减为4个

### 3. rule_registry.json
- 更新5个agent文件的SHA256 digest

## 专职职责
Orchestrator修正后仅能：
1. 派遣子Agent（task）
2. 读取调度相关文件（read）
3. 跟踪任务状态（todowrite）
4. 合规门检查（compliance_gate_*）
5. 调度脚本（dispatch_subagent）

## 实施时间
2026-05-31
