# UC7KS 绕过修复 + domain_id 集成实施方案

> **编号**: FW-UC7KS-DOMAIN-001
> **日期**: 2026-06-17
> **状态**: ✅ **COMPLETED** — 12/12 Phases 已实施并通过验证（详见 `uc7ks-domain-verification-report.md`）
> **前置依赖**: FW-DISPATCH-TASKID-IMMUTABLE（已完成 — session_map DB dag_task_id 列已上线）

---

## 一、根因确认

| 位置 | 代码 | 问题 |
|---|---|---|
| `uc7ks-utils.ts:212` | `if (!sa?.uc7_001_compliant)` | 只检查 agent 级布尔值，非 per-task/per-domain |
| `knowledge_cache_search.ts:198` | `uc7_001_compliant = true` | 搜索后设 agent 级标志（不是 per-domain） |
| `uc7ks-after.ts:34` | `uc7_001_compliant = true` | 读任意 `docs/official_docs/` 文件即翻转（低门槛旁路） |
| `uc7ks-schema.ts:49-54` | `DomainEntry.cache_sufficiency` | per-task/per-domain 字段已定义并写入，但写入检查完全忽略 |

**绕过链**:
```
SA 读任意 docs/official_docs/ 文件 → uc7_001_compliant = true（agent 级）
  ↓
SA 写 Task A → 通过（布尔为真）
  ↓
SA 写 Task B（未搜缓存） → 通过（布尔仍为真）
  ↓
SA 写 Task C（不同 domain） → 通过（布尔仍为真）
```

**读写门禁不对称**: `checkUC7KS()`（读路径）有 per-domain `cache_sufficiency` 检查，但 `checkUC7KSWrite()`（写路径）只看扁平布尔值。

---

## 二、设计原则

1. **不破坏子系统**: 所有变更通过 DB migration + 向后兼容代码实现，无 taskId/domain 时回退到现有全局检查
2. **框架一致性**: domain_id 来源统一使用 `project.config.json` → `knowledge_semantic_map.domains[].domain_id`（12 个标准 domain）
3. **日志集成**: 所有拒绝/通过事件通过 `writeLog()` / `writeLogSafe()` 写入标准框架日志系统，event 名遵循 `UC7KS-xxx` 前缀
4. **SSOT**: session_map DB 是 domain_id 的唯一权威来源，与 dag_task_id 同表同列存储

---

## 三、变更清单

### Phase 1: DB Schema 扩展（v9 migration）

**文件**: `db-manager.ts`

session_map 已有 `dag_task_id` 列（v8）。追加 `domain_id` 列：

```sql
-- v9: FW-UC7KS-DOMAIN-001
ALTER TABLE session_map ADD COLUMN domain_id TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_smap_domain ON session_map(domain_id);
```

`domain_id` 取值为 `knowledge_semantic_map.domains[].domain_id` 之一（12 个标准值），或 NULL（无 dispatch context / 手动调用）。

### Phase 2: CRUD 层扩展

**文件**: `db-state-manager.ts`

#### 2.1 dbReadSessionMap

返回类型追加 `domain_id: string | null`：

```ts
export function dbReadSessionMap(sessionId: string): {
  agent: string;
  dag_task_id: string | null;
  domain_id: string | null;       // ← NEW
  created_at: number;
  updated_at: number;
} | null
```

SQL 改为：
```sql
SELECT agent, dag_task_id, domain_id, created_at, updated_at FROM session_map WHERE session_id = ?
```

#### 2.2 dbWriteSessionMap

签名追加 `domainId` 参数：

```ts
export function dbWriteSessionMap(
  sessionId: string,
  agent: string,
  dagTaskId?: string,
  domainId?: string,              // ← NEW
): boolean
```

SQL 路径分三种：
- dagTaskId + domainId 都提供 → INSERT OR REPLACE 显式写入
- 仅 dagTaskId 提供 → COALESCE 保留现有 domain_id
- 都不提供 → COALESCE 保留现有 dag_task_id + domain_id

#### 2.3 dbQuerySessionByDomain

新增函数，供 scope-before.ts 查询某 domain_id 的活跃 session：

```ts
export function dbQuerySessionByDomain(domainId: string): string[] {
  // SELECT session_id FROM session_map WHERE domain_id = ?
}
```

#### 2.4 清理死代码

删除 `dbWriteSessionMap` 中未使用的 `resolvedDagTaskId` 变量（lines 1083-1085）。

### Phase 3: Dispatch 时 domain_id 写入

**文件**: `tools/dispatch_subagent.ts`

#### 3.1 domain_id 推断

dispatch 时已知 `args.agent_type`。从 `project.config.json` 的 `knowledge_semantic_map` 读取 `agent_domain_map`（新增配置项，见 Phase 6），推断 domain_id。

默认推断规则（硬编码 fallback，配置未定义时使用）：

| agent_type | domain_id |
|---|---|
| Coder-BE | backend_api |
| Coder-FE | frontend_ui |
| Architect | backend_api + frontend_ui（多 domain，取主 domain backend_api） |
| CI-CD-Agent | devops_ci |
| Knowledge-Curator | NULL（跨 domain，不做写检查） |
| Super-Admin | opencode_framework |
| Orchestrator | NULL（调度角色，不做写检查） |
| Meta-Planner | NULL（规划角色） |
| Guardian | NULL（审查角色） |
| Arbiter | NULL（裁决角色） |

#### 3.2 dbWriteSessionMap 调用更新

当前代码（line ~563）：
```ts
dbWriteSessionMap(context.sessionID, args.agent_type, dagTaskId);
```

改为：
```ts
dbWriteSessionMap(context.sessionID, args.agent_type, dagTaskId, inferredDomainId);
```

#### 3.3 临时 agent 映射污染修复

当前问题：dispatch_subagent 写 `(parentSessionID, args.agent_type)` 到 session_map，导致 parent 的 resolveAgent() 暂时返回子 agent 类型。

修复：dispatch_subagent 应使用**专用 dispatch session 记录**而非覆盖 parent 的 agent 映射。方案：写入 `(parentSessionID + "_dispatch_" + dagTaskId, args.agent_type, dagTaskId, inferredDomainId)` 作为独立 dispatch 记录，不污染 parent 的 agent 行。chatMessageHook 后续正常覆盖 parent 的正确 agent 映射。

**但**：这会改变 session_map 的 key 结构。更简单方案：dispatch_subagent 只写 dagTaskId 和 domainId，不写 agent 字段（agent 由 chatMessageHook 负责写入）。

改为：
```ts
// 仅写入 dagTaskId + domainId（不覆盖 agent）
const existing = dbReadSessionMap(context.sessionID);
dbWriteSessionMap(context.sessionID, existing?.agent || "unknown", dagTaskId, inferredDomainId);
```

### Phase 4: session.ts chatMessageHook 同步

**文件**: `plugins/session.ts`

当前代码（line ~76-77）：
```ts
const dagTaskId = resolveTaskId(sid);
dbWriteSessionMap(sid, agent, dagTaskId || undefined);
```

改为：追加 domainId 读取。domainId 来源优先级：
1. session_map DB 已有 domainId（COALESCE 保留）
2. `resolveDomainId(sid)` 函数（新增，见 Phase 5）

```ts
const dagTaskId = resolveTaskId(sid);
const domainId = resolveDomainId(sid);        // ← NEW
dbWriteSessionMap(sid, agent, dagTaskId || undefined, domainId || undefined);
```

`dbWriteSessionMap` 的 COALESCE 逻辑确保不覆盖 dispatch 写入的 domainId。

### Phase 5: agent-resolver.ts 扩展

**文件**: `lib/agent-resolver.ts`

新增 `resolveDomainId()` 函数：

```ts
export function resolveDomainId(sessionId?: string): string | null {
  if (sessionId) {
    try {
      const entry = dbReadSessionMap(sessionId);
      if (entry?.domain_id) {
        demoLog("INFO", `resolveDomainId: session_map DB → ${entry.domain_id}`);
        return entry.domain_id;
      }
    } catch {}
  }

  // Fallback: 从 .dispatch_ctx 文件读取（legacy）
  try {
    const ctxPath = path.join(process.env.OPENCODE_ROOT || ".", ".task_temp", "_dispatch", ".dispatch_ctx");
    if (fs.existsSync(ctxPath)) {
      const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
      if (ctx && ctx.domainId) return ctx.domainId;
    }
  } catch {}

  return null;
}
```

### Phase 6: project.config.json 配置扩展

**文件**: `.opencode/project.config.json`

新增 `agent_domain_map` 配置项，放在 `knowledge_semantic_map` 之后：

```json
"agent_domain_map": {
  "Coder-BE": "backend_api",
  "Coder-FE": "frontend_ui",
  "Architect": "backend_api",
  "CI-CD-Agent": "devops_ci",
  "Super-Admin": "opencode_framework",
  "Knowledge-Curator": null,
  "Orchestrator": null,
  "Meta-Planner": null,
  "Guardian": null,
  "Arbiter": null
}
```

`dispatch-subagent.ts`（command-tools 版本）和 `dispatch_subagent.ts`（tools 版本）读取此配置推断 domain_id。

### Phase 7: .dispatch_ctx 文件扩展

**文件**: `tools/dispatch_subagent.ts`

当前 `.dispatch_ctx` 内容：
```json
{ "dagTaskId": "...", "createdAt": ... }
```

追加 `domainId` 字段：
```json
{ "dagTaskId": "...", "domainId": "...", "createdAt": ... }
```

这是 legacy fallback 路径（.dispatch_ctx 文件仍有 race condition），但为 `resolveDomainId()` 和 `uc7ks-after.ts` 提供 fallback domainId。

### Phase 8: uc7ks-utils.ts 写入检查改造（核心修复）

**文件**: `lib/uc7ks-utils.ts`

#### 8.1 checkUC7KSWrite 签名扩展

当前：
```ts
export function checkUC7KSWrite(agent: string, mode: string): string | null
```

改为：
```ts
export function checkUC7KSWrite(
  agent: string,
  mode: string,
  sessionId?: string,           // ← NEW: 用于 DB 查询 domain_id
  taskId?: string,              // ← NEW: 用于 per-task 合规检查
  domainId?: string,            // ← NEW: 用于 per-domain 合规检查
): string | null
```

#### 8.2 检查逻辑改造

```ts
export function checkUC7KSWrite(
  agent: string,
  mode: string,
  sessionId?: string,
  taskId?: string,
  domainId?: string,
): string | null {
  // Advisory 模式：跳过（现有逻辑不变）
  if (mode === "advisory") return null;

  const agentKey = normalizeAgent(agent);
  const cacheHealthy = isCacheHealthy();
  const sa = readCachedSessionAccess(agentKey);

  // KC exempt（现有逻辑不变）
  if (isKC(agentKey)) return null;

  // SA emergency bypass（现有逻辑不变）
  if (isSA && !cacheHealthy) {
    writeLogSafe(SRC, "WARN", { event: "UC7KS-SA-EMERGENCY-BYPASS" });
    return null;
  }

  // ── NEW: Per-task per-domain 检查 ──
  // 如果有 taskId + domainId，检查嵌套 schema 的 cache_sufficiency
  if (taskId && domainId && sa?.tasks?.[taskId]?.domains?.[domainId]) {
    const suff = sa.tasks[taskId].domains[domainId].cache_sufficiency;
    if (suff?.status === "sufficient") {
      writeLogSafe(SRC, "INFO", {
        event: "UC7KS-WRITE-PASS-PER-DOMAIN",
        agent, taskId, domainId,
        detail: `per-task per-domain check passed`,
      });
      return null;
    }
    // per-domain 不充分 → 拒绝
    writeLogSafe(SRC, "ERROR", {
      event: "UC7KS-WRITE-BLOCK-PER-DOMAIN",
      agent, taskId, domainId,
      missing_topics: suff?.missing_topics || [],
      detail: `Task ${taskId} domain ${domainId} cache insufficient: ${suff?.reason || "unknown"}`,
    });
    return buildUC7KSError(agent, "write", mode, cacheHealthy,
      `UC7-001: Task "${taskId}" domain "${domainId}" cache insufficient. ` +
      `Search knowledge cache for this domain before writing. ` +
      `Missing topics: ${suff?.missing_topics?.join(", ") || "unknown"}`);
  }

  // ── 向后兼容：无 taskId/domainId 时回退到全局检查 ──
  if (!sa?.uc7_001_compliant) {
    writeLogSafe(SRC, "WARN", {
      event: "UC7KS-WRITE-BLOCK-GLOBAL",
      agent,
      detail: `global uc7_001_compliant flag not set (legacy fallback path)`,
    });
    return buildUC7KSError(agent, "write", mode, cacheHealthy, ...);
  }

  // 全局通过（legacy 路径）
  writeLogSafe(SRC, "INFO", {
    event: "UC7KS-WRITE-PASS-GLOBAL",
    agent,
    detail: `global uc7_001_compliant passed (no per-task/domain context available)`,
  });
  return null;
}
```

**关键设计点**:
- per-task/per-domain 检查优先于全局检查
- 无 taskId/domainId 时完全回退到现有全局布尔值检查 — **零破坏性**
- 日志事件区分 `UC7KS-WRITE-PASS-PER-DOMAIN` vs `UC7KS-WRITE-PASS-GLOBAL` vs `UC7KS-WRITE-BLOCK-PER-DOMAIN` vs `UC7KS-WRITE-BLOCK-GLOBAL`

### Phase 9: scope-before.ts 调用点改造

**文件**: `plugins/scope-before.ts`

当前调用（line ~207）：
```ts
const uc7Block = checkUC7KSWrite(agent, mode);
```

改为：
```ts
const taskId = resolveTaskId(input.sessionID);
const domainId = resolveDomainId(input.sessionID);
const uc7Block = checkUC7KSWrite(agent, mode, input.sessionID, taskId, domainId);
```

**新增 import**: `resolveDomainId` from `agent-resolver`。

**context 获取链**:
```
input.sessionID
  → resolveTaskId(input.sessionID) → session_map DB dag_task_id
  → resolveDomainId(input.sessionID) → session_map DB domain_id
```

全部通过 DB 查询获取，无需新增 hook 参数。

### Phase 10: uc7ks-after.ts 改造

**文件**: `plugins/uc7ks-after.ts`

当前（line ~34）：
```ts
state.session_access[agent].uc7_001_compliant = true;
```

问题：读任意 docs 文件即翻转全局标志。

改造：改为 per-domain 标记而非全局翻转。从读取的文件路径推断 domain_id：

```ts
// 从 docs/official_docs/{save_path}/ 推断 domain_id
const filePath = input.args?.path || "";
const inferredDomain = inferDomainFromPath(filePath);

if (inferredDomain && taskId) {
  // per-task per-domain 标记
  var domainEntry = getDomainEntry(state.session_access, agent, taskId, inferredDomain);
  domainEntry.pipeline_status = "completed";
  domainEntry.cache_sufficiency = {
    status: "sufficient",
    missing_topics: [],
    declared_at: new Date().toISOString(),
    reason: "docs file read",
    files_read: [filePath],
    content_summary: "auto-read via uc7ks-after",
  };
} else {
  // 向后兼容：无 domain/task 信息时仍设全局标志
  state.session_access[agent].uc7_001_compliant = true;
}
```

新增 `inferDomainFromPath()` 函数：遍历 `knowledge_semantic_map.domains`，匹配文件路径中的 `save_path` 子串。

### Phase 11: knowledge_cache_search.ts 改造

**文件**: `tools/knowledge_cache_search.ts`

当前（line ~198）：
```ts
kcs.session_access[agentRef].uc7_001_compliant = true;
```

改造：per-domain 标记已存在（lines 185-188 写入了 `domainEntry.cache_sufficiency`），只需**删除**全局 `uc7_001_compliant = true` 翻转，或将它改为**仅当无 per-domain 数据时**的 fallback：

```ts
// 删除或改为 fallback：
// 不再无条件设全局标志
// per-domain 的 pipeline_status + cache_sufficiency 已在 lines 185-188 写入
// 如果未来有代码仍依赖 uc7_001_compliant，保留为 fallback：
if (!taskId || !domainName) {
  kcs.session_access[agentRef].uc7_001_compliant = true;  // 仅 fallback
}
```

### Phase 12: 测试更新

**文件**: `lib/__tests__/gate-core.test.ts`

追加 UC7KS domain 集成测试：

```ts
describe('armSession UC7KS domain integration', () => {
  it('should reject when domain_id mismatch (SA writes backend but dispatched for frontend)', () => {
    // 注册 session: (sess-1, Coder-FE, GAP-FIX-ALL-001, frontend_ui)
    dbWriteSessionMap('sess-1', 'Coder-FE', 'GAP-FIX-ALL-001', 'frontend_ui');
    // SA 尝试以 backend_api 的 taskId 通过 → 但 taskId 不匹配 domain
    // （此测试验证 domain_id 与 dag_task_id 的关联性）
  });

  it('should allow when domain_id matches dispatch assignment', () => {
    dbWriteSessionMap('sess-2', 'Coder-BE', 'GAP-FIX-ALL-002', 'backend_api');
    // 正确匹配 → 通过
  });

  it('should fallback to global uc7_001_compliant when no domain_id in DB', () => {
    // session_map 无 domain_id → 回退到现有全局检查 → 不破坏现有流程
  });
});
```

**文件**: 新增 `lib/__tests__/uc7ks-domain.test.ts`

```ts
describe('checkUC7KSWrite per-domain', () => {
  it('should block when per-domain cache_sufficiency is insufficient', () => {});
  it('should pass when per-domain cache_sufficiency is sufficient', () => {});
  it('should fallback to global check when no taskId/domainId', () => {});
  it('should block fabricated domain_id not in knowledge_semantic_map', () => {});
});
```

---

## 四、影响评估

| 子系统 | 影响 | 说明 |
|---|---|---|
| compliance-gate MCP | **零** | 不涉及 UC7KS 检查，无需改动 |
| gate-core.ts | **零** | armSession 完整性检查不受 domain_id 影响 |
| agent-resolver.ts | **增量** | 新增 `resolveDomainId()` 函数，不影响现有 `resolveAgent()` / `resolveTaskId()` |
| session_map DB | **增量** | v9 migration 添加 domain_id 列，v8 dag_task_id 列不变 |
| uc7ks-utils.ts | **增量** | checkUC7KSWrite 签名扩展，向后兼容（无参数 = 全局检查） |
| scope-before.ts | **增量** | 调用点传入 sessionId/taskId/domainId，全通过 DB 查询获取 |
| dispatch_subagent.ts | **增量** | 追加 domainId 参数到 dbWriteSessionMap 调用 |
| knowledge_cache_search.ts | **收敛** | 删除无条件全局标志翻转，改为 per-domain fallback |
| uc7ks-after.ts | **收敛** | 从全局翻转改为 per-domain 标记 + fallback |
| 所有现有流程 | **零** | 无 dispatch context 时完全回退到全局检查，行为不变 |

---

## 五、执行顺序

| Step | Phase | 文件 | 预估耗时 |
|---|---|---|---|
| 1 | P1 DB migration | db-manager.ts | 5 min |
| 2 | P2 CRUD | db-state-manager.ts | 15 min |
| 3 | P6 Config | project.config.json | 5 min |
| 4 | P3+P7 Dispatch | dispatch_subagent.ts + .dispatch_ctx | 10 min |
| 5 | P4+P5 Resolver | session.ts + agent-resolver.ts | 10 min |
| 6 | P8+P9 UC7KS core | uc7ks-utils.ts + scope-before.ts | 20 min |
| 7 | P10+P11 UC7KS writers | uc7ks-after.ts + knowledge_cache_search.ts | 15 min |
| 8 | P12 Tests | gate-core.test.ts + uc7ks-domain.test.ts | 15 min |
| 9 | Verification | 全量测试 + framework-self-test | 10 min |

**总计**: ~105 min

---

## 六、风险与缓解

| 风险 | 缓解 |
|---|---|
| 多 domain agent（如 Architect 同时写 backend + frontend） | domain_id 取主 domain；per-domain 检查允许跨 domain 写入（只要任一 domain 有 sufficient cache） |
| uc7ks-after inferDomainFromPath 匹配失败 | fallback 到全局 uc7_001_compliant（向后兼容） |
| DB migration v9 在已有 DB 上 ALTER TABLE 失败 | try/catch + WARN log（与 v8 一致的处理模式） |
| dispatch_subagent 临时 agent 映射污染 | 写入时保留 existing agent（不覆盖 parent agent） |
| framework-self-test 域覆盖检查 | domain_id 列不影响现有 12 domain 覆盖验证 |

---

## 七、日志事件清单

| Event | Level | 位置 | 说明 |
|---|---|---|---|
| `UC7KS-WRITE-PASS-PER-DOMAIN` | INFO | uc7ks-utils.ts | per-domain 检查通过 |
| `UC7KS-WRITE-BLOCK-PER-DOMAIN` | ERROR | uc7ks-utils.ts | per-domain 检查拒绝（含 missing_topics） |
| `UC7KS-WRITE-PASS-GLOBAL` | INFO | uc7ks-utils.ts | 全局 fallback 通过 |
| `UC7KS-WRITE-BLOCK-GLOBAL` | WARN | uc7ks-utils.ts | 全局 fallback 拒绝 |
| `UC7KS-SA-EMERGENCY-BYPASS` | WARN | uc7ks-utils.ts | SA emergency bypass（现有） |
| `UC7KS-WRITE-BLOCK-NO-PER-TASK` | ERROR | uc7ks-utils.ts | taskId+domainId 有但 per-task 数据缺失→阻断（Path B） |
| `DB-SESSION-MAP-DOMAIN-WRITE` | INFO | db-state-manager.ts | domain_id 写入 session_map |
| `DB-SESSION-MAP-DOMAIN-QUERY` | INFO | db-state-manager.ts | domain_id 查询 |

所有日志通过 `writeLog()` / `writeLogSafe()` 写入，遵循框架日志系统 v2.0 标准。

---

## 八、实施验证结果

> 验证报告: `docs/review/framework-refactor/uc7ks-domain-verification-report.md`
> 验证人: @Orchestrator | 审核人: @Super-Admin（派遣验证）

### 总体判定

| 维度 | 结果 |
|---|---|
| 12 Phases | ✅ **12/12 全部实施** |
| Path B gap fix | ✅ **已实施**（Appendix A 缺口修复） |
| 测试 | ✅ **13/13 PASS**（`uc7ks-domain.test.ts`）+ **24/24 PASS**（`gate-core.test.ts`）= **36/36** |
| 向后兼容 | ✅ 保证（COALESCE + global fallback） |
| 最终判定 | ✅ **通过 — 已投入实际使用** |

### Phase 实施状态

| Phase | 文件 | 状态 |
|---|---|:---:|
| P1 DB migration v9 | db-manager.ts | ✅ |
| P2 CRUD 扩展 | db-state-manager.ts | ✅ |
| P3 Dispatch domain_id 写入 | dispatch_subagent.ts | ✅ |
| P4 session.ts 同步 | session.ts | ✅ |
| P5 agent-resolver.ts 扩展 | agent-resolver.ts | ✅ |
| P6 agent_domain_map 配置 | project.config.json | ✅ |
| P7 .dispatch_ctx 扩展 | dispatch_subagent.ts | ✅ |
| P8 checkUC7KSWrite 核心修复 | uc7ks-utils.ts | ✅ |
| P9 scope-before.ts 调用点 | scope-before.ts | ✅ |
| P10 uc7ks-after.ts 改造 | uc7ks-after.ts | ✅ |
| P11 knowledge_cache_search.ts | knowledge_cache_search.ts | ✅ |
| P12 测试 | uc7ks-domain.test.ts | ✅ |

### @Super-Admin 追加修复

验证过程中 @Super-Admin 修复了以下额外问题：

| # | 文件 | 修复 |
|---|---|---|
| 1 | `tsconfig.json` | `types` 添加 `"jest"` |
| 2 | `uc7ks-domain.test.ts` | `require()` → ES `import` |
| 3 | `knowledge_cache_search.ts` L198 | `uc7_001_compliant = true` 改为条件 fallback `if (!taskId \|\| !domainName)` |
| 4 | `substate-types.ts` | `session_access` 类型嵌套修正 |
| 5 | `db-state-manager.ts` | 重复函数重命名 |
| 6 | `dispatch-subagent.ts` (command-tools) | 函数名引用更新 |

### Appendix A Path B gap fix (UC7KS-WRITE-BLOCK-NO-PER-TASK)

验证报告附录 A 发现 `checkUC7KSWrite()` 存在静默 fallthrough 缺口：当 `taskId+domainId` 已提供但 per-task 数据不存在时（Agent 未调用 `knowledge_cache_search`），代码跳过 per-domain 检查直接 fallthrough 到全局 `uc7_001_compliant` 检查。若全局标志已被前次 session 设置为 `true`，写入操作绕过阻断。

**修复方案**：将 L224 的条件判断拆为 3 路独立路径：

```ts
if (taskId && domainId) {
  if (sa?.tasks?.[taskId]?.domains?.[domainId]) {
    // Path A: per-domain 数据存在 → 正常检查 sufficiency
  } else {
    // Path B: taskId+domainId 有但 per-task 数据缺失 → 阻断
    // 新日志事件: UC7KS-WRITE-BLOCK-NO-PER-TASK
  }
}
// Path C: 无 taskId/domainId → 全局检查（向后兼容）
```

**涉及修改**:
| # | 文件 | 变更 |
|---|---|---|
| 1 | `uc7ks-utils.ts` L224-252 | 2-path 改为 3-path，新增 Path B 阻断逻辑 |
| 2 | `uc7ks-domain.test.ts` | 新增 2 个 Path B 测试用例 |
| 3 | `gate-core.test.ts` | beforeEach 清理改为 `DELETE FROM session_map`（修复测试隔离） |

**新增测试用例**:
- `should block via Path B when taskId+domainId present but per-task data missing`
- `should block via Path B even when global uc7_001_compliant is true (Appendix A gap fix)` — 验证即使全局标志为 `true`，Path B 仍阻断

**测试结果**: 36/36 PASS（`bun test`, 0 fail）
