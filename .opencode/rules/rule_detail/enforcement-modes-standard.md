<!-- ARCHIVED / HISTORICAL — 2026-07-12 -->
> **⚠️ HISTORICAL / ARCHIVED.** The framework runtime no longer uses a global `ENFORCEMENT_MODE`. Enforcement is per-rule disposition via `getRuleDisposition(ruleId)` (see `service/enforcement/rule-disposition.ts`). This document is retained only as migration history; do not implement new behavior from it.
>
> Current model: `plugin-handlers/HANDLER_MANIFEST.md` and `service/enforcement/rule-disposition.ts`.

---
trigger: always_on
alwaysApply: false
version: 1.0.0-deprecated
status: deprecated
---

> **⚠️ DEPRECATED (2026-07-06)**
>
> This document describes the legacy three-tier enforcement mode model (advisory/strict/locked)
> which has been **replaced by single-policy per-rule disposition** (`rule-disposition.ts`).
>
> - `getEnforcementMode()` is a compat shim that always returns `"strict"`
> - New code uses `getRuleDisposition(ruleId)` → `hard_block | audit_only | warn_continue`
> - Each rule independently declares its enforcement level; no global mode switching
>
> This file is kept as **legacy reference only**. It is NOT loaded into active agent context
> (`alwaysApply: false`). Do not base new enforcement logic on this document.

# Enforcement Modes Standard v1.0 (DEPRECATED)

## 一、概述

本文件定义了 OpenCode 多智能体执行框架的**强制执行模式（Enforcement Modes）**。强制执行模式控制合规门禁、pre-commit 钩子、pre-execution 钩子以及 ESLint 审计在不同环境中的行为等级。所有 Agent、钩子和审计工具必须根据当前活动模式调整其阻断/警告策略。

## 二、三种强制执行层级

### 2.1 Advisory（咨询模式）

**适用环境**：本地开发、实验性分支、原型阶段

**核心行为**：所有违规**仅记录为警告**，不阻断任何操作。

| 检查点 | 行为 |
|--------|------|
| `compliance_gate_check` | 始终通过（`passed: true`），违规项记录到 `failed_items` 但具有 `severity: WARNING` |
| `compliance_gate_confirm` | 始终允许武装，即使前置 check 有警告 |
| `compliance_gate_complete` | 始终标记为完成；ESLint dirty_modules 仅记录，不阻断 |
| `pre-commit` Layer 0: Gate Armed Check | 跳过 —— 无 gate session 也允许提交 |
| `pre-commit` Layer 2: Keystone Validation | 运行验证，失败仅警告不阻断 |
| `pre-commit` Layer 2.5: TDD Order Check | 违规仅警告，不阻断提交 |
| `pre-execution-hook.sh` DAG Gate | DAG 缺失或任务不存在时仅警告，允许继续 |
| `eslint-audit` | 运行并报告违规，但不更新 `dirty_modules` 聚合状态 |
| `write_audit` role scope check | 越权写入仅记录警告 |

**标识**：所有工具输出以 `[ADVISORY]` 前缀标记，使用 `⚠️` 图标。

### 2.2 Strict（严格模式）

**适用环境**：CI 流水线、预发布/Staging 分支、代码审查阶段

**核心行为**：所有违规**阻断**非合规操作，强制修复后方可推进。

| 检查点 | 行为 |
|--------|------|
| `compliance_gate_check` | 规则文件缺失或未解决的 role violation → `passed: false`，阻断继续 |
| `compliance_gate_confirm` | 仅当 check 通过后方可武装 |
| `compliance_gate_complete` | ESLint dirty_modules 存在 → 返回 `failed`，阻断完成 |
| `pre-commit` Layer 0: Gate Armed Check | 无活跃 gate session → 阻断提交 |
| `pre-commit` Layer 2: Keystone Validation | 合约哈希不匹配或完整性链失败 → 阻断提交 |
| `pre-commit` Layer 2.5: TDD Order Check | 实现文件无对应测试文件 → 阻断提交 |
| `pre-execution-hook.sh` DAG Gate | DAG 缺失或任务不在 DAG 中或状态非 pending → 阻断执行 |
| `eslint-audit` | 违规写入 `dirty_modules`，阻断 gate_complete |
| `write_audit` role scope check | 越权写入标记为 BLOCKER，阻断后续操作 |

**标识**：所有工具输出以 `[STRICT]` 前缀标记，使用 `❌` 图标。

### 2.3 Locked（锁定模式）

**适用环境**：生产配置分支、发布标签、安全关键环境

**核心行为**：与 Strict 相同，**额外**强制执行以下检查，且**不接受任何豁免（waiver）**：

| 额外检查点 | 行为 |
|------------|------|
| 工作区根路径强制执行 | 任何 `machine.json` 中存在非当前 `OPENCODE_ROOT` 的路径 → 阻断所有读写操作 |
| gate-state 同步强制 | `gate-state.json.active_sessions` 与实际 `sessions` 状态不一致 → 阻断所有 gate 操作直到修复 |
| write_audit 完整性验证 | 每个文件的写入必须有对应的 write_audit 记录；缺失记录 → 阻断提交 |
| 豁免 (waiver) 策略 | **所有豁免被拒绝**。`WAIVE.md` 中技术债条目必须附带 @Arbiter 锁模式覆盖批准 |
| 模式降级 | 不允许从 Locked 降级到 Strict 或 Advisory。必须执行 `state-machine-reset.sh --force --unlock` 并附带 @Arbiter 签名的解锁令牌 |
| UC7KS 知识管道 | 所有外部文档查询（webfetch, websearch, context7_*）必须经过 @Knowledge-Curator。直接查询被 uc7ks-enforcer.ts 插件物理阻断（throw Error）。仅 @Knowledge-Curator 可豁免。详见 [UC7KS-PIPELINE-STANDARD.md](./UC7KS-PIPELINE-STANDARD.md) |

**标识**：所有工具输出以 `[LOCKED]` 前缀标记，使用 `🔒` 图标。

## 三、模式行为矩阵（完整）

| 检查项 | Advisory | Strict | Locked |
|--------|----------|--------|--------|
| 规则文件存在性 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| Role violation 检查 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| Gate armed 检查 (pre-commit) | ⏭️ 跳过 | ❌ 阻断 | ❌ 阻断 |
| Keystone 合约哈希 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| Keystone 完整性链 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| TDD 顺序检查 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| DAG 前置检查 (pre-execution) | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| ESLint audit 违规 | ⚠️ 警告 | ❌ 阻断 gate_complete | ❌ 阻断 gate_complete |
| 越权写入 (role scope) | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| Workspace-root 路径验证 | ⏭️ 跳过 | ⚠️ 警告 | ❌ 阻断 |
| Gate-state 同步验证 | ⏭️ 跳过 | ⚠️ 警告 | ❌ 阻断 |
| Write-audit 完整性 | ⏭️ 跳过 | ⚠️ 警告 | ❌ 阻断 |
| UC7KS 知识管道 (外部查询) | ⚠️ 警告 | ❌ 阻断 (缓存存在时) | ❌ 阻断 (全部直接查询) |
| Waiver 接受 | ✅ 接受 | ✅ 接受（需 @Arbiter） | ❌ 全部拒绝 |
| 模式降级允许 | N/A | ✅ 允许（需重置） | ❌ 禁止 |

## 四、模式配置

### 4.1 配置位置

强制执行模式在 `project.config.json` 的 `template_resolution` 中定义。

> **⚠️ FW-HARNESS-P6 双键设计（2026-05-22）**：`project.config.json` 使用**双模式键**设计，替代了早期的单一 `enforcement_mode` 键：
> - `develop_enforcement_mode`：本地开发模式（Agent 运行时使用，如 gate-core.ts、framework-enforcer.ts）
> - `runtime_enforcement_mode`：CI/生产运行时模式（部署脚本使用，如 framework-validation.cjs）
> - 二者分别由执行上下文自动区分，`ENFORCEMENT_MODE` 环境变量为最高优先级覆盖（locked 模式除外）

```json
{
  "template_resolution": {
    "develop_enforcement_mode": "advisory",
    "runtime_enforcement_mode": "advisory",
    "enforcement_config": {
      "advisory": {
        "description": "Warnings only, non-blocking. Suitable for local development.",
        "block_on": [],
        "log_level": "warn"
      },
      "strict": {
        "description": "Blocks non-compliant actions. Suitable for CI/staging.",
        "block_on": ["gate_armed", "keystone_hash", "tdd_order", "dag_gate", "eslint_audit", "role_scope"],
        "log_level": "error"
      },
      "locked": {
        "description": "Prevents all changes without governance override. Suitable for production config branches.",
        "block_on": ["gate_armed", "keystone_hash", "keystone_integrity", "tdd_order", "dag_gate", "eslint_audit", "role_scope", "workspace_root", "gate_state_sync", "write_audit_integrity"],
        "log_level": "error",
        "allow_waivers": false,
        "allow_downgrade": false
      }
    }
  }
}
```

### 4.2 环境变量覆盖

环境变量 `ENFORCEMENT_MODE` 可以覆盖 `project.config.json` 中的配置：

```bash
# 优先级：ENFORCEMENT_MODE > project.config.json.template_resolution.{develop,runtime}_enforcement_mode
export ENFORCEMENT_MODE=strict
```

**安全约束**：
- `ENFORCEMENT_MODE=locked` 在 `locked` 模式下不可被环境变量覆盖（写保护）
- `ENFORCEMENT_MODE=advisory` 在 `locked` 模式下被忽略

### 4.3 运行时查询

```bash
# 查询当前强制执行模式
.opencode/scripts/enforcement-mode-check.sh

# 输出示例：ENFORCEMENT_MODE=strict
```

## 五、模式转换规则

### 5.1 允许的转换

```
advisory ──→ strict ──→ locked
    ↑           ↑           │
    │           │           │
    └──重置─────┘           │
                            ↓
                      (不可降级)
```

### 5.2 转换命令

| 转换方向 | 命令 |
|----------|------|
| advisory → strict | 修改 `project.config.json` 中 `develop_enforcement_mode` 和 `runtime_enforcement_mode` 为 `"strict"`，提交 |
| strict → locked | 同上，改为 `"locked"`；需要 @Arbiter 批准 |
| strict → advisory | 执行 `state-machine-reset.sh --force`，然后修改双模式键为 `"advisory"` |
| locked → * | **禁止**。必须执行 `state-machine-reset.sh --force --unlock` 并附带 @Arbiter 签名的解锁令牌 |

### 5.3 转换审计

所有模式转换记录到 `.opencode/state/machine.json.compliance_records.enforcement_transitions`：

```json
{
  "enforcement_transitions": [
    {
      "from": "advisory",
      "to": "strict",
      "timestamp": "2026-05-22T01:00:00Z",
      "agent": "@Architect",
      "task_id": "RVW-REVIEW-08",
      "reason": "Promoting to strict for initial testing"
    }
  ]
}
```

## 六、集成点回顾

### 6.1 compliance_gate_check

在 `runGateCheck()` 中：
1. 通过 `getEnforcementMode()` 读取当前生效模式（解析自 `develop_enforcement_mode` / `runtime_enforcement_mode` / `ENFORCEMENT_MODE` 环境变量）
2. 若为 `advisory`：所有失败项降级为 `severity: WARNING`，返回 `passed: true`
3. 若为 `strict` 或 `locked`：所有失败项保持原有严重性，返回 `passed: false`

### 6.2 compliance_gate_complete

在 `runGateComplete()` 中：
1. 通过 `getEnforcementMode()` 读取当前生效模式（同上双键 + 环境变量解析）
2. 若为 `advisory`：忽略 `dirty_modules`，始终标记完成
3. 若为 `strict` 或 `locked`：`dirty_modules` → 返回 `failed`

### 6.3 pre-commit Hook

在 Layer 0 (Gate Armed Check) 中：
1. 若为 `advisory`：跳过检查，显示警告
2. 若为 `strict` 或 `locked`：执行完整检查，无 session → exit 1

### 6.4 pre-execution-hook.sh

在 DAG Gate 检查中：
1. 若为 `advisory`：缺失 DAG/任务 → 警告 + exit 0
2. 若为 `strict` 或 `locked`：缺失 DAG/任务 → exit 1

## 七、故障排除

| 症状 | 可能原因 | 解决方案 |
|------|----------|----------|
| 所有提交被阻断，但预期为 advisory | `ENFORCEMENT_MODE=strict` 已被设置 | `unset ENFORCEMENT_MODE` 或检查 `project.config.json` |
| Locked 模式无法提交紧急修复 | 模式降级被禁止 | 执行 `state-machine-reset.sh --force --unlock` + @Arbiter 令牌 |
| 模式转换后 audit 日志未更新 | `compliance_records` 未刷新 | 手动运行 `bun .opencode/scripts/mcp-tools/compliance-gate.ts` 或等待下一个 gate 操作 |
| 环境变量不生效 | `locked` 模式激活中 | locked 模式下环境变量覆盖被禁用；检查 `enforcement_config.locked.allow_downgrade` |

---

*版本历史*：
- **v1.0** (2026-05-22): 初始版本，定义 advisory/strict/locked 三层强制执行模式及完整行为矩阵。
