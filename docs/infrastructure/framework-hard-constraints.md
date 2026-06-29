# 框架全部硬约束清单（按模块分组）

**版本**: 2.0.0
**最后更新**: 2026-06-26（审核修订：修正 17 项偏差，包括行号、描述、文件路径）
**定义**: throw new Error() 阻断执行 OR exit 1 阻断提交流程 OR MCP tool 返回 rejected 阻断操作

---

## 模块1：Write Scope（15项）

| ID | 约束 | strict/locked | 位置 |
|----|------|:---:|------|
| WS-1 | Agent未授权工具 | block | scope-before.ts:83 |
| WS-2 | safe_shell写命令路径无法解析 | block | scope-before.ts:124 |
| WS-3 | safe_shell/**bash**直接文件修改 | block | scope-before.ts:160 |
| WS-4 | Agent越权写业务代码 ROUTE-MISMATCH | block | scope-before.ts:195 |
| WS-5 | KC写非文档目录 UC7-008 | block | scope-before.ts:223 |
| WS-6 | Agent身份未解析 **UNRESOLVED-AGENT** | block | scope-before.ts:245 |
| WS-7 | safe_edit显式DENY WRITE-SCOPE | block | scope-before.ts:262 |
| WS-8 | 未完成Config Read Attestation | block | scope-before.ts:306 |
| WS-9 | 未完成UC7-001知识管道写前阻断 | block | scope-before.ts:356 |
| WS-10 | 知识缓存>512KiB UC7-005 | block | scope-before.ts:372 |
| WS-11 | write-audit越权检测 | block | write-audit-lib.ts:50 |
| WS-12 | TDD违规写业务文件无对应测试 | block | tdd-before.ts:40 |
| WS-13 | JSON格式错误 | block | json-validate.ts:**132** |
| WS-14 | enforcement_mode降级 | block | json-validate.ts:117 |
| WS-15 | safe_shell白名单外命令 | block | opencode.json权限扫描 |

> **v2 修正**: WS-3 "bun"→"bash"（代码 line 154 检查 `safe_shell \|\| bash`）；WS-6 "WRITE-SCOPE"→"UNRESOLVED-AGENT"（line 254 实际标签）；WS-10 "500KB"→"512KiB"（line 371 实际阈值 524288 bytes）；WS-13 行号 117→132（117 是 WS-14 的 throw，WS-13 在 catch 块 line 132）

## 模块2：合规门禁（8项）

| ID | 约束 | 位置 | 备注 |
|----|------|------|------|
| CG-1 | 无armed gate session GATE block | gate-before.ts:83 | |
| CG-2 | Task不在Task.DAG.json DAG block | gate-before.ts:174 | ¹ |
| CG-3 | Task状态非pending/in_progress | gate-before.ts:198 | ¹ |
| CG-4 | ROUTE-MISMATCH Task分配Agent不符 | gate-before.ts:269 | |
| CG-5 | READ-BEFORE-APPROVE 未读HANDOVER | compliance-gate.ts:2606 | |
| CG-6 | non-exempt缺declared_deliverables | compliance-gate.ts:**1518** | |
| CG-7 | 交付物审批待处理 GATE-APPROVAL-LOCK | dispatch-before.ts:247 | |
| CG-8 | arm时plan_summary<10字符 | compliance-gate.ts:**1445** | |

> **v2 修正**: CG-6 行号 967→1518（967 是 GATE-RECOVERY 互斥逻辑，1518 才是 deliverables 检查）；CG-8 行号 934→1445（934 是 OPT-02 注释，1445 才是 plan_summary 检查）
>
> ¹ CG-2/CG-3 由 `dispatch_policy.require_dag_entry` 策略标志控制（非 strict/locked 模式门控），这是 FW-FIX-CONFIG-DAG-02 的刻意设计——DAG 审计独立于 enforcement_mode，`require_dag_entry=true` 时在所有模式下均 throw

## 模块3：分发管道（11项）

| ID | 约束 | 位置 | 备注 |
|----|------|------|------|
| DP-1 | PLAN-FIRST L1 dag_task_id为空 | dispatch-before.ts:354 | |
| DP-2 | PLAN-FIRST L1 auto_plan=true但policy禁用 | dispatch-before.ts:378 | |
| DP-3 | PLAN-FIRST L1 dag_task_id不在DAG | dispatch-before.ts:409 | |
| DP-4 | PLAN-FIRST L1 状态非pending/in_progress | dispatch-before.ts:427 | |
| DP-5 | PLAN-FIRST L2 Tool层二次校验 | dispatch_subagent.ts:313-398 | |
| DP-6 | DISPATCH-INTEGRITY Task()缺TOKEN | task-before.ts:267 | |
| DP-7 | DISPATCH-INTEGRITY TOKEN hash不匹配 | task-before.ts:321 | |
| DP-8 | DAG_TASK_ID REUSE 同ID不同任务 FATAL | **dispatch-subagent.ts:1133-1220** | ² |
| DP-9 | AUTO-DISPATCH队列agent_type不匹配 | task-before.ts:190 | |
| DP-10 | Super-Admin仅可dispatch KC | dispatch_subagent.ts:443-447 | ³ |
| DP-11 | Sub-Agent M14仅可dispatch KC | dispatch-before.ts:100 | |

> **v2 修正**: DP-8 文件路径 `dispatch_subagent.ts` → `dispatch-subagent.ts`（后者为正确文件，前者仅 865 行，line 1158 不存在；实际 exit(1) 在 1215/1219）；DP-10 行号 430-450→443-447
>
> ² DP-8 位于 `scripts/command-tools/dispatch-subagent.ts`（非 `tools/dispatch_subagent.ts`），`process.exit(1)` 在 line 1215 和 1219
>
> ³ DP-10 约束是**无条件** throw（非仅 locked 模式）。line 419 存在死代码 bug：`else if (isSuperAdmin && isKCTarget)` 不可达，因为 line 416 `if (isKCTarget)` 已覆盖所有 KC 目标

## 模块4：UC7KS知识管道（4项）

| ID | 约束 | 位置 | 备注 |
|----|------|------|------|
| UC-1 | UC7-001本地缓存优先写前未查 | uc7ks-utils.ts:484 | |
| UC-2 | UC7-004外部查询仅@Knowledge-Curator | **uc7ks-utils.ts:272** | ⁴ |
| UC-3 | UC7-008 KC仅写docs/official_docs | scope-before.ts:223 | |
| UC-4 | UC7-009 Super-Admin紧急绕行 | pre-execution-hook.sh:351-381 | |

> **v2 修正**: UC-2 文件路径 `framework-enforcer.ts` → `uc7ks-utils.ts:272`（`framework-enforcer.ts` 不存在于代码库中；`checkUC7KS()` 在 uc7ks-utils.ts，plugin `uc7ks-before.ts` 仅为 48 行薄包装层）

## 模块5：Pre-Commit Hook（6项）

| ID | 约束 | 位置 | 备注 |
|----|------|------|------|
| PC-1 | LAYER0 enforcement_mode降级 exit1 | hook-layers.ts:78 | |
| PC-2 | LAYER2 **keystone-validate脚本缺失** exit1 | hook-layers.ts:491 | ⁵ |
| PC-3 | LAYER2.5 TDD违规 exit1 | hook-layers.ts:376 | |
| PC-4 | LAYER2.6 UC7KS index.json损坏 | hook-layers.ts:408 | |
| PC-5 | LAYERN JSON语法错误 exit1 | hook-layers.ts:465 | |
| PC-6 | LOCKED Critical infra文件修改 | hook-layers.ts:177 | |

> **v2 修正**: PC-2 描述 "Keystone合约哈希不匹配" → "keystone-validate脚本缺失"（line 491 检测 validator 文件不存在；合约哈希不匹配会间接在 line 589 通过 validator 非零退出码触发）

## 模块6：Pre-Execution Gate（5项）

| ID | 约束 | 位置 |
|----|------|------|
| PG-1 | dag_task_id不在DAG exit1 | pre-execution-gate.ts:**418** |
| PG-2 | 无armed gate session exit1 | pre-execution-gate.ts:**512** |
| PG-3 | LOCKED Critical files修改 | pre-execution-hook.sh:279 |
| PG-4 | Stage4 UC7KS Gate缓存缺失 | pre-execution-hook.sh:337 |
| PG-5 | Stage4 UC7-001c证据完整性HARDEN | pre-execution-hook.sh:438 |

> **v2 修正**: PG-1 行号 213→418（213 在 REMEDIATION_MAP 字符串常量中，实际 exit 在 418）；PG-2 行号 218→512（同理，218 也在 REMEDIATION_MAP 中）

## 模块7：Question/Sub-Agent交互（3项）

| ID | 约束 | 位置 | 备注 |
|----|------|------|------|
| QA-1 | 子Agent禁止调question | question-policy-before.ts:112 | |
| QA-2 | Plugin禁止修改output.parts | hook-config-guard.ts:142 | ⁶ |
| QA-3 | Git hook bypass命令BLOCKED | git-guard-before.ts:153 | ⁷ |

> ⁶ QA-2 是**检测型**约束（非硬阻断）：strict/locked 模式下仅 `console.error()`，不 throw Error。违规被记录但不物理阻断执行
>
> ⁷ QA-3 是**无条件** throw（所有模式），比标准 strict/locked 门控更严格

## 模块8：Framework Self-Test（7项）

| ID | 约束 | 位置 | 备注 |
|----|------|------|------|
| ST-1 | Check6 TDD Layer2.5 BLOCKING | framework-self-test.ts:406 | ⁸ |
| ST-2 | Check17 UNRESOLVED占位符 | framework-self-test.ts:765 | |
| ST-3 | Check22 知识缓存index孤儿条目 | framework-self-test.ts:1195 | ⁹ |
| ST-4 | Check32 Agent含context7/webfetch | framework-self-test.ts:2611 | |
| ST-5 | Check35 **cache_sufficiency陈旧条目** | framework-self-test.ts:3583 | ¹⁰ |
| ST-6 | Check48 陈旧.dispatch_ctx | framework-self-test.ts:5225 | |
| ST-7 | Agent越权写路径路由验证 | route-validator.ts:369 | |

> ⁸ ST-1 有死代码：`isBlocking` 变量被计算但未在 `ok` 判定中使用（line 423-426）
>
> ⁹ ST-3 存在 Check ID 冲突：`checkDocsManifestIntegrity`（line 1195）和 `checkOpenCodeJsonAdapter`（line 1545）均报告为 Check 22
>
> ¹⁰ ST-5 描述修正："陈旧.pending.json"→"cache_sufficiency陈旧条目"；由于自动修复机制（downgrade 到 pending_attestation 后 total 硬编码为 0），该检查在正常操作中**始终通过**，仅异常时失败

---

## 总结

**44个硬约束**分布在8个框架模块中。strict/locked模式物理阻断（throw Error或exit 1），advisory仅记录警告。

| 阻断方式 | 数量 |
|---------|:---:|
| throw new Error() 插件运行时 | 31 |
| process.exit(1) Hook/Gate | 12 |
| MCP tool 返回 rejected | 1 |
| **合计** | **44** |

| 模式 | 行为 |
|------|------|
| advisory | 仅记录警告不阻断（QA-3 例外：无条件阻断） |
| strict | 全部阻断（QA-2 例外：仅检测不阻断） |
| locked | 全部阻断+额外locked-only约束 |

### 审计备注

| 类别 | 说明 |
|------|------|
| **设计性偏差** | CG-2/CG-3 由 `dispatch_policy.require_dag_entry` 控制，独立于 enforcement_mode |
| **检测型约束** | QA-2 仅记录不阻断；ST-5 自动修复后始终通过 |
| **死代码** | DP-10 line 419 不可达；ST-1 `isBlocking` 未使用 |
| **Check ID 冲突** | ST-3 有两个函数共用 Check 22 |

## 关键源文件索引

| 文件 | 包含约束 |
|------|---------|
| plugins/scope-before.ts | WS-1~WS-10 WS-15 |
| plugins/gate-before.ts | CG-1~CG-4 |
| plugins/dispatch-before.ts | CG-7 DP-1~DP-4 DP-11 |
| plugins/task-before.ts | DP-6~DP-7 DP-9 |
| tools/dispatch_subagent.ts | DP-5 DP-10 |
| scripts/command-tools/**dispatch-subagent.ts** | **DP-8** |
| scripts/mcp-tools/compliance-gate.ts | CG-5~CG-6 CG-8 |
| hooks/lib/hook-layers.ts | PC-1~PC-6 |
| scripts/pre-execution-gate.ts | PG-1~PG-2 |
| scripts/pre-execution-hook.sh | PG-3~PG-5 UC-4 |
| plugins/tdd-before.ts | WS-12 |
| plugins/json-validate.ts | WS-13~WS-14 |
| plugins/question-policy-before.ts | QA-1 |
| plugins/hook-config-guard.ts | QA-2 |
| plugins/git-guard-before.ts | QA-3 |
| lib/write-audit-lib.ts | WS-11 |
| lib/route-validator.ts | ST-7 |
| scripts/framework-self-test.ts | ST-1~ST-6 |
| lib/uc7ks-utils.ts | UC-1~UC-2 |
| plugins/uc7ks-before.ts | UC-2（plugin 包装层） |
