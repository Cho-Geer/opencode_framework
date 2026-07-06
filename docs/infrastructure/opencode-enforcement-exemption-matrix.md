# OpenCode 框架 Enforcement & 豁免机制完整矩阵

> **版本**: v1.0.0
> **生成日期**: 2026-07-01 | 基于 work-one 项目当前代码状态
> **目的**: 完整记录 advisory/strict/locked 模式下所有工具的豁免机制、before/after hook 链、阻断/警告行为

---

## 目录

1. [Enforcement 模式体系](#一enforcement-模式体系)
2. [Before Hook 链详解](#二before-hook-链详解)
3. [After Hook 链详解](#三after-hook-链详解)
4. [工具 Hook 链完整矩阵](#四工具-hook-链完整矩阵)
5. [豁免机制矩阵](#五豁免机制矩阵)
6. [Agent 权限级别](#六agent-权限级别)
7. [阻断/警告行为速查表](#七阻断警告行为速查表)

---

## 一、Enforcement 模式体系

### 1.1 三种模式定义

| 模式 | 配置字段 | 行为 | 适用场景 |
|------|-----------|------|-----------|
| **advisory** | `develop_enforcement_mode: "advisory"` | 所有违规仅警告，不阻断 | 本地开发、实验分支、原型验证 |
| **strict** | `develop_enforcement_mode: "strict"` | 所有违规阻断操作，强制修复 | CI 流水线、预发布环境、代码审查阶段 |
| **locked** | `develop_enforcement_mode: "locked"` | strict 全部规则 + 额外完整性检查，拒绝 waiver | 生产配置分支、发布标签、安全关键环境 |

### 1.2 模式优先级解析（`getEnforcementMode()`）

```
优先级（高→低）:
1. 环境变量 ENFORCEMENT_MODE（locked 模式下不可覆盖）
2. develop_enforcement_mode（project.config.json）
3. runtime_enforcement_mode（project.config.json 回退）
4. 默认: "advisory"
```

**安全约束**: 当配置为 `locked` 时，环境变量 `ENFORCEMENT_MODE=advisory` **被忽略**。

### 1.3 模式切换规则

```
advisory ──→ strict ──→ locked
    ↑           ↑           │
    │           │           │
    └──reset───┘           │
                            ↓
                      （不允许）
```

| 切换方向 | 方法 | 要求 |
|-----------|------|------|
| advisory → strict | 编辑 `project.config.json` | 提交变更 |
| strict → locked | 编辑 `project.config.json` | @Arbiter 审批 |
| strict → advisory | `state-machine-reset.sh --force` + 编辑配置 | 需要重置 |
| locked → * | **禁止** | 必须用 `state-machine-reset.sh --force --unlock` + @Arbiter token |

### 1.4 `enforcement_config` 配置

```json
{
  "template_resolution": {
    "develop_enforcement_mode": "strict",
    "runtime_enforcement_mode": "strict",
    "enforcement_config": {
      "advisory": { "block_on": [], "allow_waivers": true, "allow_downgrade": true },
      "strict": {
        "block_on": ["gate_armed", "keystone_hash", "tdd_order", "dag_gate", "eslint_audit", "role_scope", "uc7ks_pipeline"],
        "allow_waivers": true,
        "allow_downgrade": true
      },
      "locked": {
        "block_on": ["gate_armed", "keystone_hash", "tdd_order", "dag_gate", "eslint_audit", "role_scope", "uc7ks_pipeline", "keystone_integrity", "workspace_root", "gate_state_sync", "write_audit_integrity"],
        "allow_waivers": false,
        "allow_downgrade": false
      }
    }
  }
}
```

---

## 二、Before Hook 链详解

### 2.1 Before Hook 执行顺序（14 个 Handler）

```
tool.execute.before 触发时，按以下顺序执行：
任何一个 before hook throw → tool 不执行，错误返回 Agent
```

| 顺序 | Handler | 触发条件 | 阻断行为 | advisory | strict | locked |
|-------|----------|-----------|-----------|----------|--------|--------|
| 1 | **anti-bypass** | ALL tools | 阻断：guidance gate 激活或累计失败达 hardThreshold | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| 2 | **phase0-enforce** | ALL tools | 阻断：initial_read 阶段调用非允许工具 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| 3 | **codegraph** | safe_edit, safe_delete, safe_restore, safe_shell, bash | 阻断：本 session 未调用 codegraph_impact | ❌ 阻断 | ❌ 阻断 | ❌ 阻断 |
| 4 | **config-guard** | safe_shell, bash | 阻断：strict/locked 下尝试修改 git hooks 配置 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| 5 | **scope** | ALL tools（可解析文件路径时） | 阻断：写入作用域检查失败 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| 6 | **gate** | ALL modify tools | 阻断：gate armed 检查失败、P2-1 DAG 审计失败 | ⏭️ 跳过 | ❌ 阻断 | ❌ 阻断 |
| 7 | **checklist** | ALL tools | 阻断：执行清单阶段门控失败 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| 8 | **dispatch** | dispatch_subagent tool | 阻断：PLAN-FIRST L0-L4 路由验证失败 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| 9 | **uc7ks** | ALL tools | 阻断：strict/locked 下 UC7KS 知识管线违规 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| 10 | **tdd** | Coder-BE/Coder-FE + write/edit tools | 阻断：TDD 强制执行未先写测试 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| 11 | **task** | task/Task tool | 阻断：DISPATCH-INTEGRITY 哈希校验失败 | ❌ 阻断 | ❌ 阻断 | ❌ 阻断 |
| 12 | **git-guard** | safe_shell | 阻断：git hook bypass 命令模式 | ❌ 阻断 | ❌ 阻断 | ❌ 阻断 |
| 13 | **question-policy** | question tool | 阻断：strict/locked 下子 Agent 提问策略违规 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| 14 | **json-validate** | write/edit/safe_edit 目标为关键 JSON | 阻断：JSON 语法无效或 enforcement mode 未授权下调 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |

### 2.2 关键 Before Hook 详解

#### anti-bypass（FIRST 执行）

**文件**: `.opencode/plugin-handlers/before/anti-bypass.ts`

**核心逻辑**:
- 跟踪每个 session 的工具调用失败计数
- 累计失败达 `softThreshold`（默认 2）→ 注入 STOP 指令
- 累计失败达 `hardThreshold`（默认 4）→ **阻断所有工具**（除 `acp_notify` 和 `clear_guidance`）
- 进入 **Guidance Gate** 两阶段协议：
  - Phase 1：Agent 必须调用 `acp_notify` 报告失败
  - Phase 2：QoderWork 提供指导 → Agent 调用 `clear_guidance` 恢复

**阈值配置**（`project.config.json`）:
```json
{
  "enforcement": {
    "tool_tracker": {
      "soft_threshold": 2,
      "hard_threshold": 4,
      "total_limit": 15,
      "compliance_threshold": 3,
      "read_only_block": false,
      "ttl_ms": 3600000
    }
  }
}
```

#### codegraph-enforce

**文件**: `.opencode/plugin-handlers/before/codegraph.ts`

**拦截工具**: `safe_edit`, `safe_delete`, `safe_restore`, `safe_shell`

**豁免条件**:
- Agent 是 `Super-Admin`
- 目标文件路径匹配豁免正则（见第五节）
- 本 session 已调用过 `codegraph_impact`

**阻断行为**: 未调用 `codegraph_impact` → throw `"must call codegraph_impact first"`

#### scope

**文件**: `.opencode/plugin-handlers/before/scope.ts`

**12 步写入作用域验证**:
1. P0-3 ROUTE-MISMATCH：Agent→文件作用域映射
2. P1-2 UC7-008：Knowledge-Curator 隔离
3. P0-5 Write scope：isWriteAllowed() 检查 opencode.json 权限
4. R4 Config Read Attestation：strict/locked 需 config_read_state 认证
5. P1-1 UC7-001：知识缓存搜索前置
6. P1-4 UC7-005：知识缓存文件大小上限 (500KB)
7. BACKUP-BYPASS 防护：阻止 safe_shell 修改文件（必须走 safe_edit）
8. 可信脚本路径豁免：`.opencode/scripts/`, `.opencode/lib/`

#### gate

**文件**: `.opencode/plugin-handlers/before/gate.ts`

**检查项**:
- Gate armed 检查：modify tool 需要 armed 的 compliance gate session
- Delivered-state 审批提醒
- P2-1 DAG 任务审计：验证 taskId 在 Task.DAG.json 中存在
- DAG 写入路由验证：验证 task.agent 匹配 scope_to_agent
- READ-BEFORE-APPROVE-P1：捕获 approve_deliverables 调用上下文

**注意**: 模块顶层有 auto-arm 逻辑（import 时执行）。

#### dispatch

**文件**: `.opencode/plugin-handlers/before/dispatch.ts`

**L0-L4 路由验证链**:
- L0: inferDispatchPurpose() + l0_purposeFilter() — 目的推断
- L1: l1_verbCandidates() — 动词匹配
- L2: l2_scopeFilter() — 用 Task.DAG.json target_files 过滤
- L3: l3_permissionFilter() — 用 pathMatchesGlob() 权限否决
- L4: l4_heuristicSelect() — 加权选择 (scope 35% + perm 40% + domain 25%)

**豁免**: DAG-exempt Agent（Meta-Planner, Orchestrator, Super-Admin, Knowledge-Curator）

---

## 三、After Hook 链详解

### 3.1 After Hook 执行顺序（14 个 Handler）

```
tool.execute.after 触发时，按以下顺序执行：
After hook 的 throw 不会阻断 tool（tool 已执行完），错误仅记录。
```

| 顺序 | Handler | 触发条件 | 行为 | 是否阻断 |
|-------|----------|-----------|------|-----------|
| 1 | **scope** | modify tool + 源文件 | 更新 eslint-state.json dirty_modules | ❌ 不阻断 |
| 2 | **format** | isModifyTool() 过滤 | 自动格式化写入内容 | ❌ 不阻断 |
| 3 | **read-track** | read/Read/read_skill | 追踪读事件（READ-BEFORE-APPROVE） | ❌ 不阻断 |
| 4 | **task** | ALL tools | 记录 task 完成、session_log 持久化 | ❌ 不阻断 |
| 5 | **audit** | modify tool | 追加 write_audit_state（滑动窗口 200 条） | ❌ 不阻断 |
| 6 | **tdd** | TDD Agent + TDD tool | 生成 diff、检测浅测试绕过 | ❌ 不阻断 |
| 7 | **uc7ks** | ALL tools | 追踪知识管线合规性 | ❌ 不阻断 |
| 8 | **gate** | compliance_gate_* tools | autoDrainStaleSessions() 清理过期 gate sessions | ❌ 不阻断 |
| 9 | **cache** | ALL tools | 同步 knowledge_cache_state | ❌ 不阻断 |
| 10 | **dispatch** | dispatch_subagent tool | 清理 dispatch 状态 | ❌ 不阻断 |
| 11 | **anti-bypass** | ALL tools | 检测失败 + rewardReport() | ❌ 不阻断 |
| 12 | **codegraph** | codegraph_explore tool | 追踪 codegraph_explore 调用 | ❌ 不阻断 |
| 13 | **db-health** | compliance_gate_* tools | 监控 DB 健康状态 | ❌ 不阻断 |

### 3.2 关键 After Hook 详解

#### audit

**文件**: `.opencode/plugin-handlers/after/audit.ts`

**行为**:
- 追加写审计追踪到 `write_audit_state`
- 滑动窗口 200 条
- **不阻断**：after hook 错误仅记录

#### tdd-after

**文件**: `.opencode/plugin-handlers/after/tdd.ts`

**行为**:
- 读 `.opencode_backups/` 最新备份
- 生成 diff（备份 vs 当前）
- 测试文件有实际变更 → `test_written = true`
- 实现文件：记录 diff 证据，检测浅测试绕过
- **不阻断**

#### anti-bypass-after

**文件**: `.opencode/plugin-handlers/after/anti-bypass.ts`

**行为**:
- 检测工具调用成功/失败
- 成功 → 重置 compliance_blocks 计数器
- 失败 → 累加失败计数，触发 guidance gate 检查
- 调用 `rewardReport()`（Agent 报告失败后）
- **不阻断**

---

## 四、工具 Hook 链完整矩阵

### 4.1 自定义工具（23 个）

#### safe_edit（触发最多 Before Hook：10 个）

| Hook 类型 | 触发的 Hook | Guard 条件 |
|-----------|--------------|--------------|
| **Before** | anti-bypass, phase0-enforce, codegraph, config-guard(否), scope, gate, checklist, dispatch, uc7ks, tdd, json-validate | codegraph: 必须先调用 codegraph_explore；json-validate: 编辑 .opencode/project.config.json 时验证 |
| **After** | scope, format, read-track(否), task, audit, tdd, uc7ks, cache, dispatch, anti-bypass | format: 仅 isModifyTool()；audit: 记录写入 |

**关键阻断**: codegraph（无 impact 分析）、scope（写入作用域）、gate、checklist、tdd（测试强制）

---

#### safe_shell（触发最多 Before Hook：11 个）

| Hook 类型 | 触发的 Hook | Guard 条件 |
|-----------|--------------|--------------|
| **Before** | anti-bypass, phase0-enforce, codegraph, config-guard, scope, gate, checklist, dispatch, uc7ks, tdd, git-guard | codegraph: 必须先调用 codegraph_explore；config-guard: 阻断 git hook bypass；git-guard: 阻断 git commit --no-verify 等 |
| **After** | scope, task, audit, tdd, uc7ks, cache, dispatch, anti-bypass | audit: 记录 shell 是否修改文件 |

**关键阻断**: codegraph（修改代码时）、config-guard（git hook bypass）、git-guard（git hook bypass）、scope、gate、checklist

---

#### safe_delete / safe_restore

| Hook 类型 | 触发的 Hook | Guard 条件 |
|-----------|--------------|--------------|
| **Before** | anti-bypass, phase0-enforce, codegraph, scope, gate, checklist, dispatch, uc7ks, tdd | codegraph: 必须先调用 codegraph_explore |
| **After** | scope, task, audit, tdd, uc7ks, cache, dispatch, anti-bypass | format: 否；audit: 记录写入 |

---

#### dispatch_subagent

| Hook 类型 | 触发的 Hook | Guard 条件 |
|-----------|--------------|--------------|
| **Before** | anti-bypass, phase0-enforce, scope, gate, checklist, dispatch, uc7ks, tdd | dispatch: 验证 DISPATCH_TOKEN 存在 |
| **After** | scope, task, audit, tdd, uc7ks, cache, dispatch, anti-bypass | dispatch: 清理 dispatch 状态 |

---

#### knowledge_cache_search

| Hook 类型 | 触发的 Hook | Guard 条件 |
|-----------|--------------|--------------|
| **Before** | anti-bypass, phase0-enforce, scope, gate, checklist, dispatch, uc7ks | uc7ks: 强制 UC7KS 知识管线 |
| **After** | scope, task, audit, tdd, uc7ks, cache, dispatch, anti-bypass | uc7ks: 追踪知识合规性；cache: 同步缓存状态 |

---

#### 只读工具（read, Read, grep, glob, config_read_attest, skill_read_attest, rule_read_attest, read_skill）

| Hook 类型 | 触发的 Hook | Guard 条件 |
|-----------|--------------|--------------|
| **Before** | anti-bypass, phase0-enforce, scope, gate, checklist, dispatch, uc7ks, tdd | phase0-enforce: initial_read 阶段在允许列表中；tdd: checkTddEnforcement 可能阻断 |
| **After** | scope, read-track(仅 read/Read/read_skill), task, audit(否), tdd, uc7ks, cache, dispatch, anti-bypass | read-track: 追踪读事件（READ-BEFORE-APPROVE） |

**关键**: 只读工具大多不触发阻断性检查，但 phase0-enforce 在 initial_read 阶段仍会限制。

---

#### safe_test

| Hook 类型 | 触发的 Hook | Guard 条件 |
|-----------|--------------|--------------|
| **Before** | anti-bypass, phase0-enforce, scope, gate, checklist, dispatch, uc7ks, tdd | tdd: TDD 强制执行（可能要求先写测试） |
| **After** | scope, task, audit, tdd, uc7ks, cache, dispatch, anti-bypass | tdd: 写后 TDD 验证 |

---

### 4.2 内置工具（11 个）

| 工具 | Before Hook 链 | After Hook 链 | 特殊行为 |
|-------|-----------------|-----------------|-----------|
| **read** | anti-bypass, phase0-enforce, scope, gate, checklist, dispatch, uc7ks, tdd | scope, read-track, task, audit(否), tdd, uc7ks, cache, dispatch, anti-bypass | 内置工具，不受 safe_* 包装保护 |
| **edit** | anti-bypass, phase0-enforce, scope, gate, checklist, dispatch, uc7ks, tdd, json-validate | scope, format, task, audit, tdd, uc7ks, cache, dispatch, anti-bypass | **原生 edit，开发 Agent 禁用** |
| **bash** | anti-bypass, phase0-enforce, codegraph, config-guard, scope, gate, checklist, dispatch, uc7ks, tdd, git-guard | scope, task, audit, tdd, uc7ks, cache, dispatch, anti-bypass | **原生 bash，开发 Agent 禁用** |
| **glob** | anti-bypass, phase0-enforce, scope, gate, checklist, dispatch, uc7ks, tdd | scope, task, audit(否), tdd, uc7ks, cache, dispatch, anti-bypass | 搜索工具 |
| **grep** | 同 glob | 同 glob | 搜索工具 |
| **Task** | anti-bypass, phase0-enforce, scope, gate, checklist, dispatch, uc7ks, tdd, task | scope, task, audit, tdd, uc7ks, cache, dispatch, anti-bypass | 子任务工具 |
| **question** | anti-bypass, phase0-enforce, scope, gate, checklist, dispatch, uc7ks, tdd, question-policy | scope, task, audit, tdd, uc7ks, cache, dispatch, anti-bypass | 提问工具 |

---

## 五、豁免机制矩阵

### 5.1 按 Enforcement Check 分类的豁免

| Enforcement Check | advisory | strict | locked | 豁免 Agent | 豁免路径 |
|------------------|----------|--------|--------|--------------|--------------|
| **Gate Armed** | ⏭️ 跳过 | ❌ 阻断 | ❌ 阻断 | （无） | （无） |
| **Keystone Hash** | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 | （无） | （无） |
| **Keystone Integrity** | ⚠️ 警告 | ⚠️ 警告 | ❌ 阻断 | （无） | （无） |
| **TDD Order** | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 | （待确认） | （待确认） |
| **DAG Gate** | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 | DAG-exempt agents | （无） |
| **ESLint Audit** | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 | （无） | （无） |
| **Role Scope** | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 | per `agent_tool_scopes` | per `permission.safe_edit` |
| **UC7KS Pipeline** | ⚠️ 警告 | ❌ 阻断* | ❌ 阻断 | @Knowledge-Curator | （无） |
| **Workspace Root** | ⏭️ 跳过 | ⚠️ 警告 | ❌ 阻断 | （无） | （无） |
| **Gate State Sync** | ⏭️ 跳过 | ⚠️ 警告 | ❌ 阻断 | （无） | （无） |
| **Write Audit Integrity** | ⏭️ 跳过 | ⚠️ 警告 | ❌ 阻断 | （无） | （无） |
| **CodeGraph Impact** | N/A | N/A | N/A | @Super-Admin | `.task_temp/`, `docs/`, 等 |
| **Git Hook Bypass** | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 | @Super-Admin（需 `[BYPASS]`） | N/A |
| **Config Guard** | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 | N/A | 批准脚本路径 |
| **Tool Failures** | 追踪 | 追踪 | 追踪 | N/A | 只读工具豁免 |

`* 本地缓存存在但未搜索时阻断`

---

### 5.2 CodeGraph 豁免路径

**文件**: `.opencode/plugin-handlers/before/codegraph.ts`

| 豁免类型 | 条件 | 代码位置 |
|-----------|------|-----------|
| **Super-Admin Agent** | `isSuperAdmin(agent)` 返回 true | Line 59 |
| **Exempt 路径** | 文件路径匹配正则模式 | Lines 13-20 |
| **Session 已调用** | `sessionRecord?.impact_called === true` | Lines 67-73 |

**Exempt 路径正则**:
```typescript
/^\.task_temp\//, /^docs\//, /^\.opencode\/agents\/.*\.md$/,
/^\.understand-anything\//, /^\.codegraph\//
```

** rationale**: 临时文件、文档、Agent 配置、理解 artifacts 不需要 impact 分析。

---

### 5.3 Scope 豁免路径

**文件**: `.opencode/plugin-handlers/before/scope.ts`

| 豁免类型 | 条件 |
|-----------|------|
| **可信脚本路径** | `.opencode/scripts/`, `.opencode/lib/` |
| **Agent Tool Scope** | per `agent_tool_scopes` 配置 |
| **Config Read Attestation** | strict/locked 下需 `config_read_state` 认证 |

---

### 5.4 UC7KS 知识管线豁免

**文件**: `.opencode/project.config.json`（lines 828-870）

| Agent | `doc_tools` 权限 | Rationale |
|-------|----------------------|------------|
| **@Knowledge-Curator** | `allow` | 指定知识管理员 - 必须获取外部文档 |
| **@Super-Admin** | `via_curator` | 紧急管理 - 应遵循 UC7KS 管线 |
| **@Coder-BE, @Coder-FE, @Architect, @Meta-Planner, @Orchestrator, @CI-CD-Agent** | `via_curator` | 必须通过 @Knowledge-Curator（strict+ 模式） |
| **@Guardian, @Arbiter** | `deny` | 质量门 - 只读，使用缓存规则 |

---

### 5.5 Dispatch 豁免

**文件**: `.opencode/service/dispatch/route-validator-l3-l4.ts`（lines 314-323）

| 豁免类型 | 条件 | 配置键 |
|-----------|------|-----------|
| **Dispatch-exempt Agents** | Agent 在 `route_rules.dispatch_exempt_agents` | `@Meta-Planner`, `@Super-Admin` |
| **DAG-exempt Agents** | `isDagExempt(agent)` 返回 true | `Meta-Planner`, `Orchestrator`, `Super-Admin`, `Knowledge-Curator` |

**Rationale**: 这些 Agent 拥有专业判断权限（AGENTS.md P0）。

---

### 5.6 Git Hook Bypass 豁免（Break-Glass）

**文件**: `.opencode/plugin-handlers/before/git-guard.ts`

| 豁免类型 | 条件 | 代码位置 |
|-----------|------|-----------|
| **Super-Admin Break-Glass** | 命令包含 `[BYPASS <incident_id>]` 标记 AND Agent 是 Super-Admin | Lines 33-45 |

**Blocked 模式**:
```
GIT_COMMIT_NO_VERIFY: git commit with --no-verify or -n
GIT_COMMIT_NO_COMMIT_MSG_VERIFY: git commit with --no-commit-msg-verify
GIT_CORE_HOOKSPATH_COMMIT: git -c core.hooksPath=<path> commit
GIT_CORE_SKIPHOOKS_COMMIT: git -c core.skipHooks=<bool> commit
GIT_CONFIG_HOOKSPATH: git config core.hooksPath <path>
GIT_CONFIG_SKIPHOOKS: git config core.skipHooks <bool>
```

**Rationale**: Super-Admin 的紧急框架修复可使用 break-glass（带事件追踪）。

---

### 5.7 Checklist 强制执行豁免

**文件**: `.opencode/project.config.json`（lines 91-119）

| 豁免类型 | 配置键 | 值 |
|-----------|---------------------|-------|
| **Passthrough 工具** | `checklist_passthrough_tools` | 25 个工具（read, glob, grep, compliance_gate_*, dispatch_subagent, safe_shell, safe_edit） |
| **Integrity Bypass Agents** | `dispatch_integrity_bypass_agents` | `[@explore]` |
| **Task Bypass Agents** | `checklist_task_bypass_agents` | `[@explore]` |
| **Agent Bypass** | `checklist_agent_bypass` | `[@explore]` |

**Rationale**: 探索 Agent `@explore` 是只读的，不应被 checklist 强制阻断。

---

### 5.8 Safe Shell 豁免

**文件**: `.opencode/project.config.json`（lines 1046-1156）

| 豁免类型 | 条件 | 配置 |
|-----------|------|-----------|
| **Agent-Allowed Scripts** | 仅 `@Super-Admin` | `state-reconciliation.ts`, `state-transaction.ts` |
| **Agent Dangerous Bypass** | `@Super-Admin` 和 `@Orchestrator` | 可执行 `rm -rf ~/.cache/bun` 及变体 |
| **Allowed Script Paths** | 所有 Agent | `__tests__`, `.opencode_backups`, `.task_temp` |

**Rationale**: Super-Admin 和 Orchestrator 需要清除 Bun 模块缓存以进行插件开发。

---

### 5.9 Tool Tracker 豁免（Anti-Bypass）

**文件**: `.opencode/service/enforcement/tool-tracker.ts`

| 豁免类型 | 条件 | Rationale |
|-----------|------|-----------|
| **只读工具不累积失败** | `readOnlyBlock: false`（默认） | read, glob, grep 等工具返回 "error" 不一定是真正的工具失败 |
| **只读工具列表** | `read`, `Read`, `glob`, `Grep`, `codegraph_query`, `codegraph_explore`, `acp_list`, `acp_events`, `acp_debug` | 观察工具 - 失败被追踪但不阻断 |
| **Compliance Blocks 成功时重置** | 工具在框架合规阻断后成功执行 | Agent 已遵守要求，compliance 计数器重置 |

---

## 六、Agent 权限级别

### 6.1 权限级别矩阵

| Agent | 权限级别 | 豁免项 | 特殊权限 |
|-------|-----------|---------|-----------|
| **@Super-Admin** | 最高 | 所有检查（有条件）、wildcard tool 访问、git hooks break-glass、Bun 缓存清除 | 框架修复、紧急干预 |
| **@Orchestrator** | 高 | Dispatch-exempt、特权分发、Bun 缓存清除 | 可分发子 Agent、管理合规 |
| **@Meta-Planner** | 高 | DAG-exempt、Dispatch-exempt | 专业判断权限 |
| **@Knowledge-Curator** | 中 | DAG-exempt、唯一 `doc_tools: allow` Agent | 唯一可获取外部文档的 Agent |
| **@Guardian, @Arbiter** | 标准 | `doc_tools: deny`、只读角色 | 质量门、冲突仲裁 |
| **@Coder-BE, @Coder-FE, @Architect, @CI-CD-Agent** | 标准 | `doc_tools: via_curator` | 必须通过 Knowledge-Curator |
| **@explore** | 只读 | Checklist bypass、Dispatch Integrity bypass | 仅读工具 |

### 6.2 Agent Tool Scope 配置（节选）

```json
{
  "@Super-Admin": { "tools": ["*"] },
  "@Orchestrator": { "tools": ["dispatch_subagent", "compliance_gate_*", "read", "write", "edit"] },
  "@Knowledge-Curator": { "tools": ["webfetch", "websearch", "context7_*", "pandoc", "read", "write"] },
  "@explore": { "tools": ["task", "read", "glob", "grep"] }
}
```

---

## 七、阻断/警告行为速查表

### 7.1 完整阻断矩阵

| 检查项 | advisory | strict | locked |
|---------|----------|--------|---------|
| Rule 文件存在 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| Role 违规 | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| Gate armed（pre-commit） | ⏭️ 跳过 | ❌ 阻断 | ❌ 阻断 |
| Keystone hash | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| Keystone integrity | ⚠️ 警告 | ⚠️ 警告 | ❌ 阻断 |
| TDD order | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| DAG pre-execution | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| ESLint audit | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| Role scope（写入） | ⚠️ 警告 | ❌ 阻断 | ❌ 阻断 |
| Workspace-root 路径 | ⏭️ 跳过 | ⚠️ 警告 | ❌ 阻断 |
| Gate-state 同步 | ⏭️ 跳过 | ⚠️ 警告 | ❌ 阻断 |
| Write-audit 完整性 | ⏭️ 跳过 | ⚠️ 警告 | ❌ 阻断 |
| UC7KS（外部查询） | ⚠️ 警告 | ❌ 阻断* | ❌ 阻断 |
| Waiver 接受 | ✅ 允许 | ✅ 允许 | ❌ 拒绝 |
| Mode 降级 | N/A | ✅ 允许 | ❌ 禁止 |

`* 本地缓存存在但未搜索时阻断`

### 7.2 识别标志

| 模式 | 输出前缀 | 图标 |
|------|-----------|------|
| **advisory** | `[ADVISORY]` | ⚠️ |
| **strict** | `[STRICT]` | ❌ |
| **locked** | `[LOCKED]` | 🔒 |

---

## 八、附录

### 8.1 Plugin 执行顺序配置

```json
{
  "plugin_execution_order": {
    "before": [
      "anti-bypass",    // FIRST - 防止 codegraph 抢占
      "phase0-enforce",
      "codegraph",
      "config-guard",
      "scope",
      "gate",
      "checklist",
      "dispatch",
      "uc7ks",
      "tdd",
      "task",
      "git-guard",
      "question-policy",
      "json-validate"
    ],
    "after": [
      "scope",
      "format",
      "read-track",
      "task",
      "audit",
      "tdd",
      "uc7ks",
      "gate",
      "cache",
      "dispatch",
      "anti-bypass",   // 失败检测
      "codegraph",
      "db-health"
    ],
    "system": [
      "anti-bypass"    // Guidance gate 指令注入
    ]
  }
}
```

**关键设计**: `anti-bypass` 在 `before` 链中 **第一个执行**，防止其他 plugin 抢占强制执行。

---

### 8.2 Guidance Gate 两阶段协议

```
Phase 1: 报告 + 等待
1. Agent 累计失败达 hardThreshold（默认 4）
2. before/anti-bypass.ts throw 阻断所有工具（除 acp_notify / clear_guidance）
3. system/anti-bypass.ts 注入 "report + wait" 指令到 Agent prompt
4. Agent 必须调用 acp_notify 并附上失败详情
5. after/anti-bypass.ts 检测到 acp_notify 成功 → 调用 rewardReport()
6. rewardReport() 生成 guidance_token 并设置 awaiting_guidance=1
7. 计数器 **冻结**（尚未重置）

Phase 2: QoderWork 提供指导 + 恢复
1. QoderWork 收到 acp_notify 事件
2. QoderWork 调查并提供指导
3. QoderWork 调用 deliverGuidance(sessionId, guidanceText)
4. deliverGuidance() 设置 guidance_requested_at 时间戳并存储 guidance_text
5. system/anti-bypass.ts 检测到 guidance_requested_at > 0（Phase 2 激活）
6. 注入 token + 恢复指令到 Agent prompt
7. Agent 调用 clear_guidance(agent_name, token)
8. clear_guidance() 验证 token，重置所有计数器，设置 awaiting_guidance=0
9. Agent 以修正后的方法恢复工作
```

---

### 8.3 关键文件索引

| 文件路径 | 内容 |
|-----------|------|
| `.opencode/project.config.json` | 中央配置：enforcement 模式、agent tool scopes、exemptions |
| `.opencode/service/enforcement/tool-tracker.ts` | 核心强制执行逻辑：追踪、阈值、guidance gate |
| `.opencode/service/gate/enforcement.ts` | 模式解析（getEnforcementMode()） |
| `.opencode/plugin-handlers/system/anti-bypass.ts` | Phase 1/2 指令注入到 Agent prompts |
| `.opencode/plugin-handlers/before/anti-bypass.ts` | Before-hook 强制执行、guidance gate 阻断 |
| `.opencode/plugin-handlers/after/anti-bypass.ts` | After-hook 失败检测、rewardReport() |
| `.opencode/plugin-handlers/before/codegraph.ts` | CodeGraph 强制执行 |
| `.opencode/plugin-handlers/before/scope.ts` | 12 步写入作用域验证 |
| `.opencode/plugin-handlers/before/gate.ts` | Gate armed 检查、DAG 审计 |
| `.opencode/plugin-handlers/before/dispatch.ts` | PLAN-FIRST L0-L4 路由验证 |
| `.opencode/plugin-handlers/before/uc7ks.ts` | UC7KS 知识管线强制 |
| `.opencode/plugin-handlers/before/tdd.ts` | TDD 强制执行 |
| `.opencode/plugin-handlers/before/config-guard.ts` | Git hook bypass 防护 |
| `.opencode/plugin-handlers/before/git-guard.ts` | Git hook bypass 阻断 |
| `.opencode/lib/gate-core.ts` | Bridge 文件 re-exporting enforcement 函数 |
| `.opencode/lib/interrupt-guard.ts` | 中断保护机制 |

---

### 8.4 更新记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-07-01 | v1.0.0 | 初始版本，基于 work-one 项目代码分析 |

---

**注**: 本文档基于 work-one 项目当前代码状态生成。若代码更新，请同步更新此文档。
