# knowledge-store API 导出收敛与物化运维入口实施方案

**制定时间**: 2026-06-21  
**状态**: 待实施  
**范围**: `.opencode/lib/knowledge-store.ts` 的未接入导出函数、知识物化运维入口、相关自测与日志收敛  
**非范围**: 不新增 MCP server；不新增插件 hook；不修改业务代码；不迁移 `booking_system_refactor/`

---

## 1. 结论与目标

当前审计结论应表述为：`materializeToFile()`、`searchByTags()`、`getPendingMaterializationJobs()`、`retryFailedJobs()` **导出存在，但外部正常入口接入不足**。其中 `getPendingMaterializationJobs()` 已被 `retryFailedJobs()` 内部调用，`materializeToFile()` 背后的 `materializeManifestFromDb()` 已被 `writeManifest()` 与 `addEntry()` 正常路径调用。因此这不是简单死代码删除问题，而是 DB-canonical 知识子系统的 API 表面与运维入口尚未完全闭环。

实施目标：

1. 让四个导出都进入明确的正常调用路径或受控运维入口。
2. 保持知识子系统 DB-canonical：DB 是源，`docs/official_docs/index.json` 是物化视图。
3. 保持 OpenCode 官方约束：本地框架库不伪装成 MCP；custom tool 必须使用 `.opencode/tools/*.ts` + `tool()`；插件不承担 CLI/运维命令职责。
4. 正确接入集中日志系统，所有审计级事件进入 `writeLog()`。
5. 对并发 session/dispatch 写入友好，显式物化与自动物化不得互相破坏。

---

## 2. 当前证据

| 函数 | 当前状态 | 风险 |
| --- | --- | --- |
| `searchByTags(tags)` | 仅是 `searchManifest({ tags })` 的薄封装；`knowledge_cache_search.ts` 当前直接调用 `searchManifest({ tags })` | API 表面重复，容易被误判为死代码 |
| `materializeToFile()` | 外部未接入；内部物化能力已被 `writeManifest()` / `addEntry()` 调用 | 维护者没有显式 DB -> file 修复入口 |
| `getPendingMaterializationJobs()` | 外部未接入；被 `retryFailedJobs()` 内部调用 | 物化失败 job 无可见诊断入口 |
| `retryFailedJobs()` | 外部未接入 | `knowledge_materialization_jobs` 的 retry 能力不可操作 |

当前相关路径：

- `.opencode/lib/knowledge-store.ts`: DB-first manifest/search/materialization API。
- `.opencode/tools/knowledge_cache_search.ts`: OpenCode custom tool，负责 UC7KS cache search。
- `.opencode/scripts/knowledge/indexer.ts`: 知识索引 CLI wrapper。
- `.opencode/scripts/knowledge/janitor.ts`: 知识缓存清理脚本，已直接写 `knowledge_materialization_jobs` 清理类记录。
- `.opencode/scripts/framework-self-test.ts`: 框架自测入口。

---

## 3. 设计原则

1. **不删除先行**: 这四个导出对应 DB-canonical 知识系统的查询、物化、诊断、恢复能力，先接入再评估是否缩窄 API。
2. **库/脚本/工具分层**:
   - `.opencode/lib/knowledge-store.ts`: 只做本地 DB 与物化视图逻辑，不调用 OpenCode 外部工具。
   - `.opencode/scripts/knowledge/indexer.ts`: 维护者与 @Knowledge-Curator 的 CLI 运维入口。
   - `.opencode/tools/*.ts`: 仅在确需 LLM 直接调用时新增，不作为首选。
3. **不新增 MCP**: MCP 用于外部协议/server 集成；本功能是本地框架库能力，应复用脚本或 custom tool。
4. **不新增插件**: 没有新的 `tool.execute.before/after` enforcement 需求，不应扩大 plugin hook 链。
5. **日志先行**: CLI 可以向 stdout 输出人类结果，但审计事件必须通过 `writeLog()`。
6. **并发安全**: 自动物化、显式物化、retry job 共享同一个物化锁或唯一 tmp 文件策略。

---

## 4. 实施方案

### Phase 1: 收敛 `searchByTags()`

**目标**: 让 tag search 的语义入口统一，消除薄封装未使用状态。

修改文件：

- `.opencode/tools/knowledge_cache_search.ts`

实施步骤：

1. 将导入从 `searchManifest` 调整为 `searchByTags`。
2. 在 domain keywords 分支中调用 `searchByTags(domainKeywords)`。
3. 保留现有 `writeLog("knowledge_cache_search", "INFO", { event: "KC-SEARCH-VIA-STORE", ... })`。
4. 不改变 tool 参数 schema，不改变返回 JSON shape。

验收：

- `rg "searchByTags" .opencode/tools .opencode/scripts .opencode/lib` 能看到正常调用方。
- `knowledge_cache_search.ts` 仍然是单文件 default `tool()` custom tool。
- 不新增权限、不改 MCP、不改 plugin。

### Phase 2: 增加知识物化 CLI 运维入口

**目标**: 让 `materializeToFile()`、`getPendingMaterializationJobs()`、`retryFailedJobs()` 成为 @Knowledge-Curator / @Super-Admin 可操作的维护入口。

修改文件：

- `.opencode/scripts/knowledge/indexer.ts`

实施步骤：

1. 在文件首行增加 `// safe_bash: allow-write`，因为新增 `materialize` / `retry-jobs` 会触发 DB -> file 物化写入。
2. 继续使用当前 CJS `createRequire()` 加载 `.opencode/lib/knowledge-store.ts` 的模式，避免破坏 Bun/TypeScript 兼容。
3. 增加 lazy `writeLog`：
   - source: `script-knowledge-indexer`
   - CLI stdout/stderr 只用于人类输出，审计事件必须写入 log-manager。
4. 增加命令：

```text
bun .opencode/scripts/knowledge/indexer.ts materialize [--json]
bun .opencode/scripts/knowledge/indexer.ts jobs [--json]
bun .opencode/scripts/knowledge/indexer.ts retry-jobs [--json]
```

5. 命令行为：

| 命令 | 调用 | 输出 | 退出码 |
| --- | --- | --- | --- |
| `materialize` | `knowledgeStore.materializeToFile()` | `{ ok: boolean }` 或人类文本 | 成功 0，失败 1 |
| `jobs` | `knowledgeStore.getPendingMaterializationJobs()` | job 数组 / summary | 查询成功 0，异常 1 |
| `retry-jobs` | `knowledgeStore.retryFailedJobs()` | `{ attempted, succeeded, failed }` | `failed === 0` 为 0，否则 1 |

6. 更新 `--help` 文案，明确 v11/v12 DB tables 是 canonical source，`index.json` 是 materialized view。

验收：

- `bun .opencode/scripts/knowledge/indexer.ts --help` 展示新增命令。
- `bun .opencode/scripts/knowledge/indexer.ts jobs --json` 可以返回结构化 JSON。
- `bun .opencode/scripts/knowledge/indexer.ts materialize --json` 成功后 `knowledge_materialization_jobs` 至少出现一条 `job_type="index_json"` 记录。
- `opencode.json` 中 @Knowledge-Curator 已允许 `bun .opencode/scripts/knowledge/*`，因此 Phase 2 不需要新增 OpenCode custom tool 权限。

### Phase 3: 补并发物化保护

**目标**: 显式物化入口接通后，避免并发 session/dispatch 下的文件与 job 状态竞争。

修改文件：

- `.opencode/lib/knowledge-store.ts`

实施步骤：

1. 在 `materializeManifestFromDb()` 内加入物化锁：
   - lock path: `.task_temp/_locks/knowledge-materialization.lock`
   - lock TTL: 从 `.opencode/project.config.json.template_resolution["knowledge.materialization_lock_ttl_ms"]` 读取，默认 `60000`
   - stale lock 可被后续调用回收
2. 将固定 tmp 路径 `index.json.tmp` 改为唯一 tmp 路径：

```text
index.json.<pid>.<timestamp>.tmp
```

3. lock 持有期间：
   - `materializeToFile()`
   - `writeManifest()` 内部物化
   - `addEntry()` 内部物化
   - `retryFailedJobs()` 内部物化
   全部走同一保护路径。
4. `insertMaterializationJob()` 仍保持 non-fatal，job tracking 失败不得阻断主物化路径。
5. `retryFailedJobs()` 在重试前先获取物化锁；拿不到锁时返回 `{ attempted: 0, succeeded: 0, failed: 0 }` 并记录 skipped/locked 日志，不重复处理同一批 job。

新增/调整日志事件：

| Source | Event | Level | 说明 |
| --- | --- | --- | --- |
| `lib-knowledge-store` | `KC-MATERIALIZE-REQUESTED` | INFO | 显式或内部物化请求开始 |
| `lib-knowledge-store` | `KC-MATERIALIZE-LOCK-ACQUIRED` | DEBUG | 成功获取物化锁 |
| `lib-knowledge-store` | `KC-MATERIALIZE-LOCK-BUSY` | WARN | 并发物化被跳过 |
| `lib-knowledge-store` | `KC-MATERIALIZED` | INFO | 已有事件，保留并补充 job id/sha256 |
| `lib-knowledge-store` | `KC-MATERIALIZE-FAILED` | ERROR | 已有事件，保留 |
| `lib-knowledge-store` | `KC-JOBS-RETRIED` | INFO | 已有事件，保留并确保 attempted/succeeded/failed 完整 |

验收：

- 并发运行两个 `materialize --json` 不会留下多个固定 `.tmp` 冲突文件。
- 如果 lock busy，调用方得到结构化结果，日志可追踪。
- `knowledge_materialization_jobs` 不因 job tracking 失败影响 `index.json` 生成。

### Phase 4: 自测与 Harness 接入

**目标**: 防止这些导出再次变成“存在但无入口”的孤儿 API。

修改文件：

- `.opencode/scripts/framework-self-test.ts`
- 可选：`.opencode/scripts/__tests__/framework-self-test.test.js`

新增自测项：

1. `knowledge-store.ts` 必须导出：
   - `searchByTags`
   - `materializeToFile`
   - `getPendingMaterializationJobs`
   - `retryFailedJobs`
2. `indexer.ts --help` 必须包含：
   - `materialize`
   - `jobs`
   - `retry-jobs`
3. DB 表与索引必须存在：
   - `knowledge_materialization_jobs`
   - `idx_knowledge_materialization_jobs_status`
   - `idx_knowledge_materialization_jobs_entry_id`
4. `knowledge_cache_search.ts` 不再直接调用 `searchManifest({ tags })`，而是通过 `searchByTags()`。
5. 自测日志：
   - source: `script-framework-self-test`
   - event: `KC-MATERIALIZATION-OPS-CHECK`

验收命令：

```bash
bun .opencode/scripts/framework-self-test.ts
bun .opencode/scripts/knowledge/indexer.ts --help
bun .opencode/scripts/knowledge/indexer.ts jobs --json
```

---

## 5. 子系统适配矩阵

| 子系统 | 适配要求 |
| --- | --- |
| Layout Architecture System | 文件仍位于既有边界：库在 `.opencode/lib/`，CLI 在 `.opencode/scripts/knowledge/`，custom tool 不新增，docs 在 `docs/review/framework-refactor/` |
| Permission Matrix System | Phase 2 复用 @Knowledge-Curator 现有 `safe_shell` 允许项；不新增全局 tool 权限；若未来新增 custom tool，只允许 @Knowledge-Curator 与 @Super-Admin |
| concurrent session/dispatch write system | 物化路径增加 lock + 唯一 tmp 文件；retry 与正常 `addEntry()`/`writeManifest()` 不并发覆盖 |
| Hardened enforcement System | 不绕过 `safe_shell`、`safe_edit`、UC7KS read-before-write；`indexer.ts` 使用 `// safe_bash: allow-write` 明确声明脚本写入意图 |
| Harness System | `framework-self-test.ts` 增加 API 接入、CLI 命令、DB 表索引、调用路径检查 |
| Central State Management | 不新增 JSON substate；`knowledge_audit_state` / `knowledge_cache_state` 继续由现有 helpers 管理 |
| Multi-Agent System | @Knowledge-Curator 负责知识维护；普通 Agent 不直接调用物化修复；@Orchestrator 需要时调度 @Knowledge-Curator 或 @Super-Admin |
| Log Central Management System | `lib-knowledge-store`、`script-knowledge-indexer`、`script-framework-self-test` 全部通过 `writeLog()` 写审计事件 |
| DB management system | `knowledge_materialization_jobs` 作为 job 状态源；DB 失败按调用场景 fail-safe/fail-closed，job tracking failure non-fatal |
| Templatization & Parameterization System For Universality | 新增可选模板键：`knowledge.materialization_lock_ttl_ms`、`knowledge.materialization_jobs_limit`、`knowledge.materialization_retry_max`，都有默认值 |
| TypeScript + Bun Based System | 不引入新依赖；custom tool 文件保持 ESM `import`；脚本保持当前 Bun/CJS interop 模式 |

---

## 6. 官方 OpenCode 合规要求

### 6.1 MCP

- 不新增 `opencode.json.mcp` 条目。
- 原因：知识物化是本地 DB/file 管理，不是外部 Model Context Protocol server。
- 若未来确需 MCP，工具命名必须遵循 `<server-name>_<tool-name>`，且应独立成 external protocol server；本方案不走该路径。

### 6.2 Plugin

- 不新增 `.opencode/plugins/*.ts`。
- 不修改 `tool.execute.before` / `tool.execute.after` 链。
- 原因：本问题不是运行时阻断或 hook 生命周期问题，新增插件会扩大 hook 链复杂度。
- 若未来必须加插件，必须使用 default export，hook 函数定义在同一模块内，并通过 `writeLog()` 记录 loaded/hooks/runtime。

### 6.3 Custom Tool

Phase 0-4 不新增 custom tool。理由：

1. @Knowledge-Curator 已有 `safe_shell` 权限执行 `.opencode/scripts/knowledge/*`。
2. 新增 tool 需要同步 `opencode.json` permission 与 agent frontmatter，增加 Permission Matrix 维护面。
3. 物化/重试是维护动作，不应给普通 Agent 直接暴露。

如后续必须给 LLM 直接调用，则新增 `.opencode/tools/knowledge_materialization_ops.ts`，并满足：

```typescript
import { tool } from "@opencode-ai/plugin";
import { withInterruptGuard } from "../lib";
import { writeLog } from "../lib/log-manager";
import {
  materializeToFile,
  getPendingMaterializationJobs,
  retryFailedJobs,
} from "../lib/knowledge-store";

export default tool({
  description: "UC7KS knowledge materialization maintenance operations.",
  args: {
    action: tool.schema
      .string()
      .describe("One of: materialize, jobs, retry-jobs"),
  },
  async execute(args, context) {
    return withInterruptGuard("knowledge_materialization_ops", async () => {
      if (!["materialize", "jobs", "retry-jobs"].includes(args.action)) {
        return JSON.stringify({
          ok: false,
          error: "Invalid action. Expected one of: materialize, jobs, retry-jobs",
        });
      }
      writeLog("knowledge-materialization-ops", "INFO", {
        event: "KC-MAT-OPS-CALLED",
        detail: `action=${args.action}`,
        sessionID: context?.sessionID,
        agent: context?.agent,
      });
      // Dispatch to the library functions and return JSON.stringify(result).
    });
  },
});
```

权限要求：

- `opencode.json.agent["Knowledge-Curator"].permission.knowledge_materialization_ops = "allow"`
- `opencode.json.agent["Super-Admin"].permission.knowledge_materialization_ops = "allow"`
- 其他 agent 默认 deny。

---

## 7. 日志集成方案

| 层 | Source | 必须事件 |
| --- | --- | --- |
| Library | `lib-knowledge-store` | `KC-MATERIALIZE-REQUESTED`, `KC-MATERIALIZE-LOCK-ACQUIRED`, `KC-MATERIALIZE-LOCK-BUSY`, `KC-MATERIALIZED`, `KC-MATERIALIZE-FAILED`, `KC-JOBS-QUERIED`, `KC-JOBS-RETRIED` |
| CLI | `script-knowledge-indexer` | `KC-INDEXER-MATERIALIZE`, `KC-INDEXER-JOBS`, `KC-INDEXER-RETRY-JOBS`, `KC-INDEXER-FAILED` |
| Tool | `knowledge_cache_search` | 现有 `KC-SEARCH-VIA-STORE` 保留；必要时补 `KC-SEARCH-TAGS-VIA-HELPER` |
| Harness | `script-framework-self-test` | `KC-MATERIALIZATION-OPS-CHECK` |

日志规则：

1. `writeLog(source, "INFO"|"WARN"|"ERROR"|"DEBUG", { event, detail, ... })` 是唯一审计写入路径。
2. CLI 可以 `console.log()` 返回用户可见 JSON，但不可只用 console 代替审计日志。
3. tool context 中可用时必须带 `sessionID`、`callID`、`agent`；CLI 无这些字段时不伪造。
4. job tracking 失败必须 `ERROR` 记录，但不阻断正常物化写入。

---

## 8. DB 与 job 状态规则

`knowledge_materialization_jobs` 状态建议统一为：

| status | 含义 |
| --- | --- |
| `pending` | 待处理或等待重试 |
| `written` | DB -> file 物化成功 |
| `failed` | 物化失败，可重试 |
| `superseded` | 原失败/待处理 job 已被后续成功物化覆盖 |
| `completed` | janitor purge/archive/evict 类维护动作完成，保留兼容现状 |

约束：

1. `getPendingMaterializationJobs()` 默认只返回 `pending` / `failed`。
2. `retryFailedJobs()` 成功后把原 job 标记为 `superseded`，新成功物化记录为 `written`。
3. janitor 的 `purge` / `archive` / `evict` 记录可以继续使用 `completed`，但不应被 `retryFailedJobs()` 处理。
4. 不新增表；如需锁，优先使用 `.task_temp/_locks` 文件锁，避免 v13 schema 迁移。

---

## 9. 实施顺序

1. **RED / 基线确认**
   - `rg "searchByTags\\(|materializeToFile\\(|getPendingMaterializationJobs\\(|retryFailedJobs\\(" .opencode`
   - 确认除 `knowledge-store.ts` 内部外，外部调用不足。
2. **Phase 1**
   - `knowledge_cache_search.ts` 改用 `searchByTags()`。
3. **Phase 2**
   - `indexer.ts` 增加 `materialize` / `jobs` / `retry-jobs`。
   - 增加 `script-knowledge-indexer` 日志。
4. **Phase 3**
   - `knowledge-store.ts` 增加物化锁与唯一 tmp 文件。
   - 保持导出签名向后兼容。
5. **Phase 4**
   - `framework-self-test.ts` 增加接入检查。
   - 必要时补测试文件静态断言。
6. **验证**
   - `bun .opencode/scripts/knowledge/indexer.ts --help`
   - `bun .opencode/scripts/knowledge/indexer.ts jobs --json`
   - `bun .opencode/scripts/knowledge/indexer.ts materialize --json`
   - `bun .opencode/scripts/knowledge/indexer.ts retry-jobs --json`
   - `bun .opencode/scripts/framework-self-test.ts`

---

## 10. 回滚策略

| 改动 | 回滚方式 |
| --- | --- |
| `knowledge_cache_search.ts` 使用 `searchByTags()` | 改回 `searchManifest({ tags })`，不影响 DB |
| `indexer.ts` 新增 CLI 命令 | 删除新增 command 分支和 help 文案 |
| 物化锁/唯一 tmp | 回退到现有 `index.json.tmp`，但不推荐长期保留 |
| self-test 新检查 | 删除新增 check 调用，保留业务代码 |
| 可选 custom tool | 删除 `.opencode/tools/knowledge_materialization_ops.ts`，撤销 permission |

回滚不需要删除 `knowledge_materialization_jobs` 表或历史 job 记录；它们是审计数据。

---

## 11. Definition of Done

- [ ] 四个导出均有正常调用方或受控 CLI 入口。
- [ ] `searchByTags()` 被 `knowledge_cache_search.ts` 使用，或文档明确改为删除导出；本方案选择使用。
- [ ] `indexer.ts` 提供 `materialize`、`jobs`、`retry-jobs`。
- [ ] 物化路径使用 lock 或唯一 tmp，避免并发 tmp 冲突。
- [ ] `knowledge_materialization_jobs` 可查询、可重试、可审计。
- [ ] 所有新增运行事件通过 `writeLog()`。
- [ ] 不新增 MCP server。
- [ ] 不新增 plugin hook。
- [ ] 若新增 custom tool，必须按 `.opencode/tools/*.ts` + default `tool()` 规范，并只授权 @Knowledge-Curator / @Super-Admin。
- [ ] `framework-self-test.ts` 覆盖 API 接入与 CLI 命令存在性。
- [ ] 验证命令全部通过或失败原因被记录到方案后续实施报告。
