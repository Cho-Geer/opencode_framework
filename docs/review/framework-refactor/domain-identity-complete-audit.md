# Domain Identity 全量审计

**版本**: v1.0.0  
**调查日期**: 2026-06-23  
**调查 Agent**: @Super-Admin  
**状态**: 调查完成  
**范围**: `.opencode/` 框架全部 TS 文件（~80 个模块）  
**来源**: `parameter-name-confusion-audit.md` §4 — Domain 标识 5 种写法

---

## §1 Domain 标识的 5 种写法

原先估计 5 种，深入审计后确认 **7 种变体**，分布在两个层面：

### 1.1 变量层（代码上下文）

| #   | 写法             | 出现位置                                       | 语义                     | 示例                                        |
| --- | ---------------- | ---------------------------------------------- | ------------------------ | ------------------------------------------- |
| 1   | `domain`         | args, 函数参数, writeLog key                   | 通用 domain 引用         | `args.domain`, `{ domain: value }`          |
| 2   | `domainId`       | 内部变量, writeLog key, resolveDomainId 返回值 | camelCase 版             | `const domainId = resolveDomainId(sid)`     |
| 3   | `domainName`     | UC7KS 工具内部变量                             | `args.module` 的本地副本 | `var domainName = args.module \|\| "all"`   |
| 4   | `dispatchDomain` | module_scope_declare 临时变量                  | dispatch 指定的 domain   | `var dispatchDomain = resolveDomainId(sid)` |

### 1.2 持久化层（DB / Schema / Config）

| #   | 写法             | 出现位置                             | 语义                     | 示例                                       |
| --- | ---------------- | ------------------------------------ | ------------------------ | ------------------------------------------ |
| 5   | `domain_id`      | DB 列名, config key, schema 字段     | snake_case 主键          | `knowledge_session_access.domain_id`       |
| 6   | `declared_scope` | JSON blob legacy 字段 + UC7KS schema | 旧版 flat session_access | `kcs.session_access[agent].declared_scope` |
| 7   | `save_path`      | `knowledge_semantic_map.domains[]`   | domain→文件系统路径映射  | `"save_path": "backend/nestjs/"`           |

---

## §2 Domain 来源（两层语义系统）

Domain 在同一框架中有**两层不同语义**：

### 2.1 UC7KS 知识领域（Knowledge Domain）

**定义**: `knowledge_semantic_map.domains[].domain_id` — 技术知识分类（如 `backend_api`、`persistence`、`frontend_ui`）

**配置源**: `project.config.json` → `knowledge_semantic_map.domains[]`

```json
{
  "domain_id": "backend_api",
  "keywords": ["controller", "endpoint", "guard", ...],
  "context7_libraries": ["NestJS"],
  "save_path": "backend/nestjs/",
  "ttl_days": 30
}
```

**当前共 12 个 domain**: `backend_api`, `persistence`, `frontend_ui`, `caching`, `testing`, `devops_ci`, `infrastructure`, `opencode_framework`, `opencode`, `web-fallback`, `opencode-plugins`, `opencode-tools`

### 2.2 调度领域（Dispatch Domain）

**定义**: `agent_domain_map` 映射的 domain_id — 派发时按 agent 类型自动分配的默认知识领域

**配置源**: `project.config.json` → `agent_domain_map`

```
@Coder-BE   → backend_api
@Coder-FE   → frontend_ui
@Architect  → opencode_framework
@Guardian   → (cross-domain)
...
```

**关系**: `agent_domain_map` 的值必须是 `knowledge_semantic_map.domains[].domain_id` 的子集。

---

## §3 Domain 解析路径

### 3.1 核心函数：`resolveDomainId(sessionId)` / `resolveDomainIdWithSource(sessionId)`

**文件**: `lib/agent-resolver.ts` L487

```
Priority 1:     session_map DB (per-session domain_id, race-free)
Priority 1.5:   dispatch:child:{dagTaskId} child slot
Priority 2:     ctx/{dagTaskId}.json per-dispatch files
Priority 3:     .dispatch_ctx legacy fallback
```

**返回值**: `string | null`

### 3.2 调度时推断：`inferDomainId(agentType)`

**文件**: `tools/dispatch_subagent.ts` L175  
**来源**: `project.config.json` → `agent_domain_map`  
**用途**: dispatch 时预先写入 `session_map.domain_id`

### 3.3 工具查询：`resolve_domain_id` MCP 工具

**文件**: `tools/resolve_domain_id.ts`  
**用途**: Agent 在 Step 0a 调用，验证 dispatch-assigned domain

---

## §4 Domain 存储

### 4.1 DB 表（6 张表 `domain_id` 列）

| 表名                       | domain 列名               | 唯一键                            |
| -------------------------- | ------------------------- | --------------------------------- |
| `session_map`              | `domain_id` TEXT (v9)     | —                                 |
| `knowledge_session_access` | `domain_id` TEXT NOT NULL | UNIQUE(agent, task_id, domain_id) |
| `knowledge_discovery`      | `domain_id` TEXT NOT NULL | UNIQUE(agent, task_id, domain_id) |
| `knowledge_attestation`    | `domain_id` TEXT NOT NULL | UNIQUE(agent, task_id, domain_id) |
| `dispatch_context`         | `domain_id` TEXT          | —                                 |
| `execution_checklist_runs` | `domain_id` TEXT          | —                                 |

**唯一键模式**: `UNIQUE(agent, task_id, domain_id)` — agent+task+domain 是大多数知识表的主键。

### 4.2 JSON blob（UC7KS 子状态）

**文件**: `knowledge_cache_state`（machine.json 子状态）

```
session_access[agent].declared_scope = "backend_api"          // legacy flat
session_access[agent].tasks[taskId].domains[domainId] = {     // nested
  pipeline_status: "declared",
  cache_sufficiency: { status: "sufficient", ... }
}
```

### 4.3 配置文件

| 配置段                             | 字段                                 | 说明               |
| ---------------------------------- | ------------------------------------ | ------------------ |
| `knowledge_semantic_map.domains[]` | `domain_id`, `save_path`, `keywords` | 知识领域定义       |
| `agent_domain_map`                 | `agent → domain_id`                  | Agent 默认领域映射 |

---

## §5 Domain 在 UC7KS Pipeline 中的使用

### 5.1 声明：`module_scope_declare`

**文件**: `tools/module_scope_declare.ts`

Agent 调用 `module_scope_declare(module="backend_api", task_id="T001")`:

1. 验证 `module` 是否在 `knowledge_semantic_map.domains[].domain_id` 中
2. 写入 `knowledge_session_access` DB
3. 更新 JSON blob `session_access[agent].declared_scope`

### 5.2 搜索：`knowledge_cache_search`

**文件**: `tools/knowledge_cache_search.ts`

Agent 调用 `knowledge_cache_search(domain="backend_api", task_id="T001")`:

1. 检查 pipeline 链（是否已 declare）
2. 在本地缓存中匹配 domain 的 `save_path`
3. 写入 `knowledge_discovery` DB

### 5.3 验证：`knowledge_cache_attest`

**文件**: `tools/knowledge_cache_attest.ts`

Agent 调用 `knowledge_cache_attest(domain="backend_api", ...)`:

1. 验证 agent 确实读取了缓存文件
2. 写入 `knowledge_attestation` DB
3. 更新 `cache_sufficiency`

### 5.4 写保护：`scope-before.ts` per-domain check

**文件**: `plugins/scope-before.ts`

`checkUC7KSWrite(agent, filePath, taskId, domainId)`:

- Path A: taskId+domainId 存在 → per-domain 验证
- Path B: taskId+domainId 存在但没有 per-domain 数据 → 阻断
- Path C: 无 taskId → 无法做 per-domain 检查 → 阻断

---

## §6 Domain 流转图

```
project.config.json
├─ knowledge_semantic_map.domains[]   ← 12 个知识领域定义
└─ agent_domain_map                   ← agent → domain 映射

dispatch_subagent:
├─ inferDomainId(agentType)           ← 从 agent_domain_map 推断
├─ writeDispatchCtx(dagTaskId, agent, domainId)
└─ dbWriteSessionMap("dispatch:child:{dagTaskId}", agent, dagTaskId, domainId)

子 agent:
├─ resolve_domain_id()                ← Step 0a: 验证 dispatch domain
├─ module_scope_declare(module, task_id)  ← 声明 domain
│   └─ knowledge_session_access DB + JSON blob
├─ knowledge_cache_search(domain, task_id) ← 搜索缓存
│   └─ knowledge_discovery DB
├─ knowledge_cache_attest(domain, task_id) ← 验证
│   └─ knowledge_attestation DB + cache_sufficiency
└─ scope-before.ts: checkUC7KSWrite() ← 写前 per-domain 检查
```

---

## §7 混淆点与问题

### I1: `domain` vs `domainId` 在 writeLog 中混合使用（MED）

**12+ 个模块**在 writeLog 中混用 `domain` 和 `domainId`：

- `knowledge_cache_attest.ts`: 全部使用 `domainId: domain`（值来自 `args.domain`）
- `module_scope_declare.ts`: 使用 `domain: domainName`
- `knowledge_cache_search.ts`: 使用 `domain: domainName`

无一致性——同一概念在不同模块中使用不同 key。

### I2: `domainName` 变量是 `args.module` 的副本（LOW）

`module_scope_declare.ts`:

```typescript
var domainName = args.module; // MCP 参数名是 "module"，变量名是 "domainName"
```

参数名 `module` 与概念名 `domain` 不一致。Agent 调用 `module_scope_declare(module="backend_api")` 但概念上这是 domain。

### I3: `declared_scope` 是 legacy 遗留（LOW）

`declared_scope` 是 `DomainEntry` 在 JSON blob 中的旧写法，与 DB 中的 `domain_id` 语义相同但命名不同。新旧代码同时维护。

### I4: `save_path` 隐含 domain 语义但命名不反映（LOW）

`knowledge_semantic_map.domains[].save_path` 是 domain→文件系统的映射，但名称不含 "domain" 字样，初次阅读容易混淆其用途。

### I5: `domain` 在 `args` 与 `args.module` 中的不一致（LOW）

- `knowledge_cache_search`: 参数名 `domain` → args.domain
- `module_scope_declare`: 参数名 `module` → args.module

两者指向同一概念（knowledge_semantic_map domains），但参数名不同。

### I6: JSON blob vs DB 双写未完全同步（MED）

`session_access[agent].declared_scope`（JSON blob）与 `knowledge_session_access.domain_id`（DB）都记录 agent 声明的 domain。`module_scope_declare` 同时写入两者，但其他 DB 操作（如 backfill）可能只写一个，导致不一致。

---

## §8 命名使用统计

| 写法                            | 出现文件数 | 典型模块                                                  |
| ------------------------------- | ---------- | --------------------------------------------------------- |
| `domain_id`（DB 列）            | 6 表       | knowledge\_\*, session_map, dispatch_context              |
| `domainId`（变量/log key）      | 12+        | agent-resolver, dispatch_subagent, knowledge_cache_attest |
| `domain`（args/log key）        | 8+         | knowledge_cache_search, module_scope_declare              |
| `domainName`（内部变量）        | 3          | module_scope_declare, knowledge_cache_search, backfill    |
| `declared_scope`（legacy JSON） | 4          | uc7ks-schema, backfill, framework-self-test               |
| `save_path`（config）           | 2          | knowledge_semantic_map, critical-files                    |

---

## §9 建议

### 短期

1. **统一 writeLog key**: `domainId` → `domain`（让所有模块使用一致的 log key）
2. **`module_scope_declare` 参数重命名**: `module` → `domain`（概念一致）

### 中期

3. **废弃 `declared_scope`**: JSON blob 统一迁移到 DB `domain_id`
4. **`save_path` 更名**: 或添加 `domain_path` 别名

### 长期

5. **Domain 类型系统**: 定义 branded type `DomainId`，编译时校验 domain 值合法

---

## §10 相关文档

| 文档                                      | 关系                                    |
| ----------------------------------------- | --------------------------------------- |
| `parameter-name-confusion-audit.md`       | 参数名混淆全量（§4 为本文来源）         |
| `agent-identity-complete-audit.md`        | Agent 标识审计（agent_domain_map 映射） |
| `task-id-duality-complete-audit.md`       | Task ID 审计（task+domain 复合键）      |
| `uc7ks-domain-fix-implementation-plan.md` | UC7KS per-domain 修复方案               |
| `uc7ks-pipeline-db-canonical-design.md`   | Pipeline DB 设计                        |

---

## §11 实施记录

| 操作                                  | 文件                         | 变更 | 说明                  |
| ------------------------------------- | ---------------------------- | ---- | --------------------- |
| `domainName` → `domainId`             | `module_scope_declare.ts`    | 12   | 变量重命名            |
| `domainName` → `domainId`             | `knowledge_cache_search.ts`  | 12   | 变量重命名            |
| `domainName` → `domainId`             | `backfill-session-access.ts` | 14   | 变量 + 循环变量重命名 |
| `var domain =` → `var domainId =`     | `knowledge_cache_attest.ts`  | 1+14 | 本地变量别名重命名    |
| `dispatchDomain` → `dispatchDomainId` | `module_scope_declare.ts`    | 3    | 临时变量重命名        |

### 命名规则

| 语境                        | 命名                | 示例                                    |
| --------------------------- | ------------------- | --------------------------------------- |
| DB 列 / MCP schema / config | `domain_id`         | `knowledge_session_access.domain_id`    |
| TypeScript 变量 / log key   | `domainId`          | `const domainId = resolveDomainId(sid)` |
| MCP public param (保留)     | `domain` / `module` | `args.domain`, `args.module`            |

---

_审计 v1.1.0 — 实施 domain naming 统一。_
