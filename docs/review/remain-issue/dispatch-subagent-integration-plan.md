# dispatch_subagent 功能集成到 Plugin 实施方案

**版本**: v1.0
**日期**: 2026-06-08
**作者**: @Super-Admin
**状态**: 待实施
**前提**: Agent 身份传递方案 v4.1.1 已完成

---

## 1. 背景

### 问题

`dispatch_subagent` 是一个 MCP 自定义工具，仅在**主 Agent 显式调用**时执行。实际使用中，主 Agent 经常绕过它直接调用 `Task()`，导致以下功能**非必达**：

```
dispatch_subagent 调用 → 完整功能（安全门 + prompt + 身份 + 审计）
Task() 直接调用       → 仅 TASK-IDENTITY 身份写入 + session map
```

### 目标

将 `dispatch_subagent` 中**可通用化**的功能移到 plugin (`toolExecuteBefore`)，保证**每次 `Task()` 派遣都必经过**。

---

## 2. 功能模块归属分析

| 模块 | 当前位置 | 是否每次派遣必达 | 归属 |
|------|:---:|:---:|------|
| 安全门 B1-B4 | dispatch_subagent tool | ❌ 仅显式调用时 | → **Plugin** |
| Agent 身份 A1 | child script + TASK-IDENTITY | ✅ TASK-IDENTITY 已覆盖 | → **已解决** |
| 审计 C1-C2 | dispatch_subagent tool | ❌ 仅显式调用时 | → **Plugin** |
| P0 Protocol D1 | child script | ❌ 仅显式调用时 | → **保留** (内容生成) |
| DISPATCH_TOKEN D2 | child script | ❌ 仅显式调用时 | → **保留** (与 prompt 耦合) |
| 模板解析 D3 | child script | ❌ 仅显式调用时 | → **保留** (子进程) |
| 输出文件 D5 | child script | ❌ 仅显式调用时 | → **保留** (子进程) |

---

## 3. 实施方案

### Phase 1: 安全门移到 Plugin (P0)

**目标**: 无论 `dispatch_subagent` 还是直接 `Task()`，安全门都生效。

**文件**: `.opencode/plugins/framework-enforcer/enforce.ts`

**位置**: `toolExecuteBefore` 中 TASK-IDENTITY 拦截之后（约 L710）

**新增代码**:

```typescript
// ── FW-HARDEN-DISPATCH-SECURITY: Security gates for ALL Task() dispatches ──
// Merged from dispatch_subagent.ts. Must run for EVERY Task() call, not just
// when dispatch_subagent is explicitly invoked.
if (TASK_TOOLS.has(tool)) {
  const targetAgent = (output.args?.subagent_type as string) || "";
  const taskDesc = ((output.args?.description as string) || 
                    (output.args?.prompt as string) || "").toLowerCase();
  const callingAgent = resolvedAgent || agent;
  const mode = getEnforcementMode();

  // ── Gate 1: Non-Orchestrator/Non-SA dispatch restriction ──
  const isOrchestrator = callingAgent === "@Orchestrator" || callingAgent === "Orchestrator";
  const isSuperAdmin = callingAgent === "@Super-Admin" || callingAgent === "Super-Admin";
  const isKC = targetAgent === "Knowledge-Curator" || targetAgent === "@Knowledge-Curator";

  if (!isOrchestrator) {
    if (isSuperAdmin && isKC) {
      // SA→KC: pattern matching required
      const kcPatterns = ["knowledge","cache","docs","official","context7","uc7ks",
        "fetch","curator","index","explore","source code","repository",
        "github","documentation","library","api reference"];
      const matched = kcPatterns.filter(p => taskDesc.includes(p.toLowerCase()));
      if (matched.length === 0) {
        violations.push(
          `[FW-ENFORCE][DISPATCH-GATE] Super-Admin may only dispatch @Knowledge-Curator ` +
          `for UC7KS knowledge tasks. Task description must match UC7KS patterns.`
        );
      }
    } else if (isSuperAdmin) {
      violations.push(
        `[FW-ENFORCE][DISPATCH-GATE] Super-Admin dispatch restricted to @Knowledge-Curator. ` +
        `Got: "${targetAgent}".`
      );
    } else {
      violations.push(
        `[FW-ENFORCE][DISPATCH-GATE] Non-Orchestrator agent "${callingAgent}" may not ` +
        `dispatch sub-agents. Only @Orchestrator may dispatch general agents.`
      );
    }
  }

  // ── Gate 2: Super-Admin target repair pattern ──
  const isSATarget = targetAgent === "Super-Admin" || targetAgent === "@Super-Admin";
  if (isSATarget) {
    const repairPatterns = ["repair","fix","restore","corrupt","broken",
      "emergency","reset","drain","purge","reconcile","inconsistency",
      "state","hook","plugin","integrity","machine.json","gate-state","compliance"];
    const matched = repairPatterns.filter(p => taskDesc.includes(p.toLowerCase()));

    if (mode === "locked") {
      violations.push(
        `[FW-ENFORCE][DISPATCH-GATE] Super-Admin dispatch DENIED in locked mode. ` +
        `Super-Admin is human-only when enforcement mode is locked.`
      );
    } else if (mode === "strict" && matched.length === 0) {
      violations.push(
        `[FW-ENFORCE][DISPATCH-GATE] Super-Admin dispatch requires repair pattern match. ` +
        `Task: "${taskDesc.slice(0, 100)}"`
      );
    }
  }
}
```

**影响**: 约 50 行新增。

**验证**: SA 直接 `Task(subagent_type="general")` → 被 dispatch gate 拦截。

---

### Phase 2: 删除子脚本中的重复 Agent 身份写入 (P1)

**目标**: 消除 `_dispatch_target.json` 的双重写入。

**文件**: `.opencode/scripts/command-tools/dispatch-subagent.ts`

```diff
- /**
-  * FW-FIX-IDENTITY-01: Write _dispatch_target.json for agent identity propagation.
-  * enforce.ts resolveAgent() reads this file as a fallback when FRAMEWORK_AGENT
-  * env var is not set ...
-  */
- const identityFile = path.join(OPENCODE_ROOT, '.task_temp', '_dispatch_target.json');
- try {
-   const dir = path.dirname(identityFile);
-   if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
-   fs.writeFileSync(identityFile, JSON.stringify({
-     agent: '@' + agentType,
-     task_id: taskId || null,
-     timestamp: new Date().toISOString()
-   }));
- } catch (e) {
-   logWarn(`Failed to write _dispatch_target.json: ${e.message}`);
- }
```

**理由**: TASK-IDENTITY 在 plugin 中为 ALL `Task()` 调用写入同一个文件，包含 `run_id`。子脚本的写入是冗余的。

**影响**: 删除 ~15 行。

---

### Phase 3: 审计统一到 Plugin (P2)

**目标**: dispatch_subagent 改用 plugin 的 `writeAuditLogEntry` / `logAuditEntry`。

**当前**: dispatch_subagent.ts 自行写 `audit_log.jsonl` + `machine.json.compliance_records`。

**方案**: 
1. dispatch_subagent.ts 中的审计调用改为通过环境标记（如设置 `FRAMEWORK_DISPATCH_AUDIT` env var），让 plugin 的 `toolExecuteAfter` 检测并写审计。
2. 或者保留 dispatch_subagent 的审计，但在 plugin 中为直接 Task() 调用补充同等审计。

**推荐**: 保留两处审计（各有用途），但在 plugin 中补上直接 Task() 派遣的审计记录。

---

## 4. 修改文件清单

| Phase | 文件 | 改动 | 行数 |
|:---:|------|------|:---:|
| P0 | `enforce.ts` | 新增 dispatch security gates | ~50 |
| P1 | `dispatch-subagent.ts` | 删除冗余 _dispatch_target 写入 | -15 |
| P2 | `enforce.ts` | 补充 Task() 派遣审计 | ~10 |
| — | `index.ts` | 版本号更新 | 1 |

**合计: ~60 行新增, ~15 行删除。**

---

## 5. 错题集约束

| 约束 | 来源 | 应对 |
|------|------|------|
| Bun 缓存不自动失效 | 错题集 §3 | 实施后更新 `index.ts` VERSION 注释 |
| `console.log` 不可见 | 错题集 §5 | 新增日志使用 `demoLog()` 或 `logAuditEntry()` |
| `output.args` 形状因工具而异 | 错题集 §6 | Task() 的 `output.args.subagent_type` 已确认可用 |

---

## 6. 验证计划

| # | 测试场景 | 预期结果 |
|---|---------|---------|
| 1 | SA 直接 `Task(subagent_type="general")` | 被 dispatch gate 拦截 |
| 2 | SA 直接 `Task(subagent_type="Knowledge-Curator", desc="fix cache")` | 被 KC pattern 拦截（不含 UC7KS 关键词） |
| 3 | SA 直接 `Task(subagent_type="Knowledge-Curator", desc="fetch docs for context7")` | 通过 ✅ |
| 4 | Orchestrator `dispatch_subagent("Coder-BE")` → `Task()` | 安全门不拦截 Orchestrator ✅ |
| 5 | `_dispatch_target.json` 仍由 TASK-IDENTITY 写入 | ✅ |

---

## 7. 完成后的效果

```
任何派遣路径:

dispatch_subagent → Task():
  ├─ 安全门 ✅ (dispatch_subagent 自身 + Plugin 双重保障)
  ├─ Agent 身份 ✅ (TASK-IDENTITY)
  ├─ P0 Protocol ✅ (dispatch_subagent)
  └─ 审计 ✅ (dispatch_subagent)

直接 Task():
  ├─ 安全门 ✅ (Plugin 新增)
  ├─ Agent 身份 ✅ (TASK-IDENTITY)
  ├─ P0 Protocol ❌ (无，简化派遣)
  └─ 审计 ✅ (Plugin 新增)
```
