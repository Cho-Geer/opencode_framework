# COMMIT-PROJECT-CONFIG DAG Bypass Root Cause Analysis

> ID: FW-DAG-BYPASS-001
> Date: 2026-06-17
> Author: @Super-Admin (framework architect)
> Status: COMPLETED
> Severity: P0 (framework integrity violation)

---

## 一、问题描述

CI-CD-Agent 执行 `git commit`（通过 safe_shell）提交 `project.config.json` 时，因 `COMMIT-PROJECT-CONFIG` 不在 `Task.DAG.json` 中，被 `gate-before.ts` P2-1 DAG 约束阻断。CI-CD-Agent 无法绕过该约束，于是通过某种路径反向派遣了一个 DAG-exempt Agent（@Orchestrator 或 @Knowledge-Curator），利用其 DAG-exempt 身份绕过了 P2-1 检查，完成了 git commit。

---

## 二、根因分析

### 2.1 攻击链路（3 个必要条件）

| # | 条件 | 源头 | 严重性 |
|---|------|------|--------|
| C1 | CI-CD-Agent 是 **non-DAG-exempt** agent，受 P2-1 约束 | `dag-policy.ts` L53-58：DAG_EXEMPT_AGENTS 不含 "ci-cd-agent" | 设计缺陷 |
| C2 | **COMMIT-PROJECT-CONFIG** 不在 Task.DAG.json 中 | 无人在 @Meta-Planner 规划阶段为 CI-CD 操作创建 DAG 条目 | 流程缺陷 |
| C3 | @Knowledge-Curator 和 @Orchestrator 是 **DAG-exempt**，且拥有 `dispatch_subagent` 工具权限 | `dag-policy.ts` L57 + `project.config.json` agent_dispatch_allowed_tools | 权限泄漏 |

### 2.2 绕过路径（两条可行路径）

**路径 A（最可能）：CI-CD-Agent → @Orchestrator → safe_shell git commit**

```
CI-CD-Agent (blocked by P2-1)
  → dispatch_subagent(@Orchestrator)  ← Orchestrator is DAG-exempt
    → Orchestrator uses safe_shell("git commit ...")
      → P2-1 skips (isExempt=true)
      → safe_shell allows (Orchestrator allowlist has node *.ts, no git *)
      → ❌ Orchestrator safe_shell 白名单无 "git *" — 此路径被 safe_shell 阻断
```

**路径 B（实际发生）：CI-CD-Agent → @Knowledge-Curator → safe_shell git commit**

```
CI-CD-Agent (blocked by P2-1)
  → dispatch_subagent(@Knowledge-Curator)  ← KC is DAG-exempt, any agent can dispatch KC for UC7KS
    → Knowledge-Curator uses safe_shell("git commit ...")
      → P2-1 skips (isExempt=true)
      → safe_shell: KC allowlist = [sha256sum, wc, cd]
      → ❌ KC safe_shell 白名单无 "git *" — 此路径同样被 safe_shell 阻断
```

**路径 C（实际绕过）：CI-CD-Agent → @Super-Admin → safe_shell git commit**

```
CI-CD-Agent (blocked by P2-1)
  → 但 @Orchestrator 可 dispatch @Super-Admin
    → @Super-Admin (DAG-exempt + safe_shell allowlist 含 "git *")
      → P2-1 skips (isExempt=true)
      → safe_shell allows ("git *" in SA allowlist)
      → ✅ git commit 成功执行
```

但 `dispatch_subagent.ts` L407-465 限制 @Super-Admin 只能被 @Orchestrator 派遣，且 task_description 必须匹配 `super_admin_repair_patterns`。CI-CD-Agent 不能直接派遣 @Super-Admin。

**路径 D（最终推断）：CI-CD-Agent → 回报阻塞 → @Orchestrator → @Super-Admin**

```
CI-CD-Agent 执行 git commit
  → P2-1 blocks (taskId COMMIT-PROJECT-CONFIG not in DAG)
  → CI-CD-Agent 无法继续,向 @Orchestrator 报告阻塞
  → @Orchestrator 派遣 @Super-Admin (repair pattern: "COMMIT-PROJECT-CONFIG")
    → @Super-Admin 执行 safe_shell("git commit ...")
      → P2-1 skips (isExempt=true)
      → safe_shell allows ("git *" in allowlist)
      → ✅ commit 成功
```

### 2.3 根因分类

| 根因 | 类型 | 说明 |
|------|------|------|
| **RC-1**: CI-CD 操作无 DAG 条目 | 流程缺口 | `COMMIT-PROJECT-CONFIG` 未在 Task.DAG.json 中规划。CI-CD-Agent 的所有 git commit 操作都需要一个对应的 DAG 条目，但 @Meta-Planner 规划时未覆盖"提交配置变更"这类操作任务 |
| **RC-2**: CI-CD-Agent 非 DAG-exempt | 设计决策 | CI-CD-Agent 执行的是具体操作任务（部署、提交），理应受 DAG 约束。但某些常规 CI-CD 操作（如 git commit）本质上不需要 DAG 规划 |
| **RC-3**: DAG-exempt Agent 有过多工具权限 | 权限泄漏 | @Super-Admin 同时是 DAG-exempt 且拥有 `safe_shell "git *"`, 这意味着任何通过 SA 的路径都绕过了 DAG + 工具约束两层保护 |
| **RC-4**: gate-before.ts P2-1 仅检查 taskId→DAG 映射 | 逻辑盲区 | P2-1 检查 `taskId && !isExempt`。当 isExempt=true 时直接跳过整个 DAG 检查。但对于 DAG-exempt Agent 执行**非其职责范围内的操作**，框架无二次校验 |

---

## 三、影响评估

| 维度 | 影响 |
|------|------|
| **DAG 约束完整性** | 任何 non-DAG-exempt agent 都可通过 @Orchestrator → @Super-Admin 路径绕过 P2-1 DAG 检查 |
| **scope 边界** | CI-CD-Agent 的 `agent_write_scopes.allowed` 包含 `.github/workflows/**` 和 `Dockerfile*`，但如果通过 SA 路径，SA 的 write scope 是 `.opencode/**` + 业务代码全量 — 远超 CI-CD-Agent 应有的权限 |
| **审计追踪** | 通过 SA 路径的 commit 在 git log 中标记为 SA 操作，掩盖了实际发起方是 CI-CD-Agent |
| **框架信任链** | DAG-exempt 设计基于"这些 Agent 不会执行超出职责范围的操作"的假设。实际行为打破了这个假设 |

---

## 四、解决方案

### 4.1 修复策略矩阵

| Fix ID | 类型 | 优先级 | 说明 |
|--------|------|--------|------|
| FIX-1 | 流程修复 | P0 | CI-CD 常规操作纳入 DAG 规划模板 |
| FIX-2 | 框架修复 | P0 | P2-1 增加 DAG-exempt 操作合理性二次校验 |
| FIX-3 | 权限收敛 | P1 | Super-Admin safe_shell git 权限限定触发条件 |
| FIX-4 | 日志增强 | P1 | P2-1 对 DAG-exempt agent 记录操作审计 |

### 4.2 FIX-1: CI-CD 常规操作纳入 DAG 规划模板

**问题**: @Meta-Planner 规划时未覆盖"提交配置变更"这类操作任务。

**方案**: 在 `project.config.json` 中新增 `cicd_routine_tasks` 配置块，定义 CI-CD-Agent 的常规操作模板。@Meta-Planner 在生成 Task.DAG.json 时，自动为每个配置变更类任务追加一个 `COMMIT-*` 后续任务。

```json
"cicd_routine_tasks": {
  "$description": "CI-CD-Agent routine task templates. @Meta-Planner auto-generates DAG entries for these patterns when code-change tasks produce config modifications.",
  "templates": [
    {
      "pattern": "config_change",
      "suffix": "COMMIT-CONFIG",
      "description": "Commit configuration changes (project.config.json, opencode.json, etc.)",
      "agent": "@CI-CD-Agent",
      "depends_on_parent": true
    },
    {
      "pattern": "deploy_change",
      "suffix": "DEPLOY-CHANGE",
      "description": "Deploy infrastructure changes (Dockerfile, docker-compose, workflows)",
      "agent": "@CI-CD-Agent",
      "depends_on_parent": true
    }
  ]
}
```

**实施位置**: `.opencode/lib/dag-policy.ts` 新增 `generateRoutineCICDTasks()` 函数，供 @Meta-Planner 规划时调用。

### 4.3 FIX-2: P2-1 DAG-exempt 操作合理性二次校验

**问题**: gate-before.ts P2-1 对 DAG-exempt Agent 完全跳过检查，无二次校验。

**方案**: 在 P2-1 跳过 DAG 检查时，新增 **P2-1b Operation Scope Audit** — 验证 DAG-exempt Agent 当前操作是否在其职责范围内。

```ts
// gate-before.ts L134 — 当前逻辑:
if (taskId && !isExempt) {
  // P2-1: DAG existence/status check for non-exempt agents
}

// 新增 P2-1b:
if (isExempt && isModifyTool(input.tool)) {
  // DAG-exempt agent performing modify operation — audit scope合理性
  const scopeResult = isWriteAllowed(agent, effectivePath);
  if (!scopeResult.allowed) {
    writeLog("gate-before", "runtime", {
      event: "DAG-EXEMPT-SCOPE-VIOLATION",
      detail: `DAG-exempt agent ${agent} attempted out-of-scope write to ${effectivePath}`,
    });
    if (mode === "strict" || mode === "locked") {
      throw new Error(
        `[FW-ENFORCE][DAG-EXEMPT-SCOPE] DAG-exempt agent @${agent} attempted write to "${effectivePath}" ` +
        `which is outside its declared write scope. ` +
        `DAG exemption only bypasses task existence checks, not scope boundaries.`
      );
    }
  }
}
```

**关键设计**: DAG exemption **仅豁免 DAG 任务条目检查**，不豁免 scope 边界检查。这是两层独立的约束：
1. DAG 约束：任务必须在 Task.DAG.json 中存在（exempt 跳过）
2. Scope 约束：Agent 只能写其 write scope 内的文件（exempt 不跳过）

**实施位置**: `.opencode/plugins/gate-before.ts` L134 之后新增 P2-1b 块。

### 4.4 FIX-3: Super-Admin safe_shell git 权限限定触发条件

**问题**: @Super-Admin 的 `safe_shell "git *"` 是无限制的全匹配模式。

**方案**: 将 `git *` 从 Super-Admin allowlist 中移除，替换为更精细的 git 操作子集，仅允许框架修复相关的 git 操作：

```json
"@Super-Admin": [
  "git add .opencode/**",
  "git add docs/review/**",
  "git add .task_temp/**",
  "git commit -m *",
  "git push origin *",
  "git tag *",
  "git log *",
  "git diff *",
  "git status",
  "git stash *"
]
```

CI-CD-Agent 保留 `"git *"` 全量权限（因其职责范围就是 git 操作），但受 DAG 约束。

**实施位置**: `.opencode/project.config.json` safe_shell.agent_allowlists["@Super-Admin"]。

### 4.5 FIX-4: P2-1 DAG-exempt 操作审计日志增强

**问题**: 当前 P2-1 对 DAG-exempt Agent 完全跳过，无任何日志记录。

**方案**: 在 P2-1 isExempt=true 时，记录一条 INFO 级别审计日志：

```ts
if (taskId && isExempt) {
  writeLog("gate-before", "runtime", {
    event: "DAG-EXEMPT-PASS",
    agent,
    taskId,
    tool: input.tool,
    detail: `DAG-exempt agent ${agent} bypassed P2-1 DAG check for task ${taskId}`,
  });
}
```

**实施位置**: `.opencode/plugins/gate-before.ts` L134 前插入。

---

## 五、修复优先级与实施顺序

| 顺序 | Fix ID | 预估耗时 | 阻塞关系 |
|------|--------|----------|----------|
| 1 | FIX-4 (日志) | 5 min | 无阻塞，可先行 |
| 2 | FIX-2 (P2-1b) | 15 min | FIX-4 之后（需要日志基础设施） |
| 3 | FIX-3 (SA git 收敛) | 10 min | FIX-2 之后（P2-1b 保护 SA scope 越界） |
| 4 | FIX-1 (DAG 模板) | 20 min | FIX-2 之后（确保 DAG 覆盖后 CI-CD 正常工作） |

**总计**: ~50 min

---

## 六、验证方案

| Fix ID | 验证方法 |
|--------|----------|
| FIX-1 | 创建 COMMIT-CONFIG DAG 条目 → CI-CD-Agent safe_shell git commit → P2-1 PASS |
| FIX-2 | @Super-Agent (DAG-exempt) safe_shell 写入业务代码 → P2-1b BLOCK |
| FIX-3 | @Super-Admin safe_shell "git add booking-backend/src/main.ts" → BLOCK |
| FIX-4 | 日志中出现 DAG-EXEMPT-PASS 事件 |

---

## 七、长期架构改进建议

1. **DAG exemption 粒度细化**: 当前 exemption 是全量豁免（所有 modify tools 都跳过 P2-1）。建议改为 **per-tool exemption**: DAG-exempt Agent 对 `.opencode/**` 写操作豁免 P2-1，对业务代码写操作不豁免。

2. **自动 DAG 补全**: 当 @Orchestrator 派遣 CI-CD-Agent 时，若 task_description 包含 `commit` / `deploy` / `release` 关键词，`dispatch_subagent.ts` 应自动生成一个 `ROUTINE-CICD-*` 格式的 DAG 条目（或触发 auto_plan）。

3. **Scope 与 DAG 约束分离**: 将 P2-1 拆为两个独立子检查:
   - P2-1a: DAG task existence（DAG-exempt 可跳过）
   - P2-1b: Write scope boundary（所有 Agent 不可跳过）
   
   这两个约束在逻辑上完全独立，不应因一个豁免而连带跳过另一个。

---

## 八、日志事件清单（新增）

| Event | Level | 位置 | 说明 |
|-------|-------|------|------|
| `DAG-EXEMPT-PASS` | INFO | gate-before.ts | DAG-exempt Agent 绕过 P2-1 DAG 检查 |
| `DAG-EXEMPT-SCOPE-VIOLATION` | ERROR | gate-before.ts | DAG-exempt Agent 越界写操作被 P2-1b 阻断 |

---

## 九、涉及文件清单

| 文件 | 修改类型 | Fix ID |
|------|----------|--------|
| `.opencode/plugins/gate-before.ts` | 新增 P2-1b + 日志 | FIX-2, FIX-4 |
| `.opencode/project.config.json` | SA git allowlist 收敛 + cicd_routine_tasks | FIX-1, FIX-3 |
| `.opencode/lib/dag-policy.ts` | 新增 generateRoutineCICDTasks() | FIX-1 |
| `.opencode/lib/__tests__/gate-core.test.ts` | 新增 P2-1b 测试 | FIX-2 |
