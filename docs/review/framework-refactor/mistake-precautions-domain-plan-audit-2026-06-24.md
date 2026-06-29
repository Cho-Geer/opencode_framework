# 错题集独立域方案审计报告

**审计日期**: 2026-06-26（更新自 2026-06-24 原始审计）  
**审计对象**: `docs/review/framework-refactor/mistake-precautions-domain-plan.md` (v1.0.0)  
**审计人**: @Super-Admin  
**状态**: 审计完成 — 发现 7 项问题（原始 5 项 + 新增 2 项），原始 DB 空表结论已修正

---

## 一、总体评估

| 维度 | 评分 | 说明 |
|------|------|------|
| **设计合理性** | ⭐⭐⭐⭐ | 独立域拆分逻辑清晰，SUMMARY.md 摘要机制有价值 |
| **代码对齐度** | ⭐⭐⭐ | DB 已有 63 行数据（非空），但 domain 字段为 'opencode' 而非 'mistake_precautions'；index.json 结构与文档描述不符 |
| **子系统覆盖** | ⭐⭐⭐⭐ | 本次审计已覆盖全部 12 子系统，补充了日志系统和状态管理系统的详细分析 |
| **可执行性** | ⭐⭐⭐ | DB 有数据可直接 UPDATE（不再受阻），但 index.json 的 library_id/domain 实际值与文档假设不一致 |

**结论**: 设计方案合理。原始审计中最大的阻塞项（DB 空表）已不存在——`knowledge_entries` 有 63 行，3 份错题集文件已索引。但发现新的偏差：index.json 中 library_id 为 `"framework"` 而非文档假设的 `"opencode-framework"`；DB 中 domain 为 `"opencode"` 而非 `"opencode_framework"`。文档需更新以反映这些实际值。

---

## 二、准确性验证

### ✅ 准确的部分

| 项目 | 文档声明 | 实际状态 | 验证方式 |
|------|---------|---------|---------|
| Step 4.5 存在 | `knowledge_cache_attest.ts` 有 Step 4.5 | ✅ 第 412–520 行 | 代码审查 |
| 错题集文件存在 | 3 份文件在 `framework/mistake_precautions/` | ✅ 存在，合计约 39KB | `ls -la` |
| `mandatory_knowledge` 配置存在 | `project.config.json` 有该配置块 | ✅ 第 1013–1022 行，`opencode_framework` 域含 3 文件 | `grep -A 20` |
| 配置结构支持 per-domain | 支持 `domains` 对象格式 | ✅ `knowledge_cache_attest.ts` 第 433 行支持 `mk.domains` | 代码审查 |
| Check 30 存在 | `framework-self-test.ts` 有 Check 30 | ✅ 第 2326–2387 行，12 个 requiredDomains | `grep -n "Check 30"` |
| `@rule` 格式已定义 | §2.2 定义了 `@rule` 标记格式 | ✅ 格式清晰，可解析 | 文档审查 |
| KC Agent 域表可扩展 | §3.5 描述 KC 域表追加方式 | ✅ `Knowledge-Curator.md` 有域表结构 | 文件审查 |

### ❌ 不准确或缺失的部分（2026-06-26 更新）

| 项目 | 文档声明 | 实际状态 | 影响 |
|------|---------|---------|------|
| **DB 数据存在** | §3.3 假设 `knowledge_entries` 有数据可 UPDATE | ⚠️ **有数据但 domain 不匹配**：63 行数据，3 份错题集文件已索引（ID 513/515/516），但 `domain='opencode'` 而非 `'mistake_precautions'` | Phase 1.3 UPDATE 可执行，但需先确认目标 domain 值 |
| **index.json library_id** | §3.2 假设 library_id 为 `"opencode-framework"` | ❌ 实际为 `"framework"`，domain 也为 `"framework"`，tags 为 `["framework"]` | §3.2 diff 需修正为从 `"framework"` 改为 `"mistake_precautions"` |
| **SUMMARY.md 已创建** | §3.4.1 描述了 SUMMARY.md 内容 | ❌ 文件不存在 | Phase 2.4 未执行 |
| **@rule 提取工具** | §2.2 提到自动提取 @rule | ❌ 无提取脚本或工具（`.opencode/scripts/extract-rules.ts` 不存在） | Phase 2.1-2.4 无工具支持 |
| **@rule 模板文件** | §2.7（原始审计建议）提到模板 | ❌ `.opencode/templates/rule-marker.md` 不存在 | 需创建 |
| **日志系统 API** | 原始审计 §9 使用 `writeLog(SRC, level, fields)` | ❌ 当前 API 为 `writeLog(plugin, category, fields)`，其中 category 为 `"loaded"|"hooks"|"runtime"` | 日志集成代码需修正 |
| **Check 30 更新细节** | §5 Phase 1.5 提到更新 Check 30 | ⚠️ 未说明具体改什么 | 实施不明确 |

---

## 三、12 子系统对齐分析

### 1. Layout Architecture Subsystem ✅ 对齐

**文档**: 提出 `framework/mistake_precautions/` 目录结构  
**实际**: 目录已存在，包含 3 个 `.md` 文件（合计约 39KB），另有 `.opencode_backups/` 子目录含 1 份备份  
**对齐**: ✅ 完全符合 `.opencode/` 布局规范  
**备注**: 域拆分后文件路径不变，仅 `index.json` 和 DB 中的域归属变更

### 2. DB-only and DB-canonical based ⚠️ 部分对齐（已修正原始结论）

**原始审计结论**: DB 表为空，UPDATE 无法执行  
**当前实际状态（2026-06-26）**:
- `knowledge_entries`: **63 行**（原始审计为 0）
- `knowledge_files`: **63 行**（原始审计为 0）
- `knowledge_entry_tags`: **766 行**（原始审计未提及）
- `knowledge_files WHERE file_path LIKE 'framework/mistake_precautions/%'`: **3 行**（条目 ID 513/515/516）
- `uc7ks_pipeline_state`: **72 行**
- `substate_kv`: **13 行**

**3 份错题集 DB 记录详情**:

| entry_id | library_id | domain | file_path | size_bytes |
|----------|------------|--------|-----------|------------|
| 513 | opencode-framework | **opencode** | plugin-debugging-precautions.md | 19,245 |
| 515 | opencode-framework | **opencode** | double-hook-trigger-prevention.md | 13,542 |
| 516 | opencode-framework | **opencode** | opencode-plugin-loading-bun-cache.md | 5,227 |

**关键发现**: 
- 3 份文件已在 DB 中索引（`source='curated'`, `status='active'`, `ttl_days=90`）
- `domain` 字段值为 `'opencode'`（**不是** `'opencode_framework'`，也**不是** `'mistake_precautions'`）
- `library_id` 为 `'opencode-framework'`（与 index.json 中 `'framework'` 不同）
- 所有 3 份文件的 `access_count=0`，从未被读取过
- `knowledge_entry_tags` 表存在且含丰富标签（如 entry 515 有 "mistake-prevention"、"precautions" 等标签）

**DB 域分布**: `opencode`(32), `devops_ci`(12), `opencode_framework`(5), `testing`(5), `frontend_ui`(3), `infrastructure`(3), `backend_api`(2), `framework_tools`(1)

**文档修正建议**:

```sql
-- §3.3 DB 数据变更（修订版，基于实际数据）
-- 当前 domain='opencode'，需改为 'mistake_precautions'
UPDATE knowledge_entries
SET domain = 'mistake_precautions', updated_at = unixepoch('now') * 1000
WHERE id IN (513, 515, 516);

-- 影响行数：3。已验证这些 ID 存在。
```

### 3. Permission Matrix Subsystem ✅ 对齐

**文档**: §2.1 提出独立域  
**实际**: `project.config.json` 的 `knowledge_semantic_map` 已支持 12 个 per-domain 定义（第 375–612 行）。`dispatch_policy.fallback_tools`（第 989–1011 行）列出 25 个工具白名单，包含 `knowledge_cache_search`、`knowledge_cache_attest`、`module_scope_declare` 等 UC7KS 工具。  
**对齐**: ✅ 新增 `mistake_precautions` 域后，权限矩阵通过 `knowledge_semantic_map.domains` 自动适配。`agent_tool_scopes` 按工具名授权，不受域变更影响。  
**新增相关配置**: `route_rules`（第 1044–1259 行）定义了 `verb_to_agent` 和 `scope_to_agent` 路由规则，域拆分后 `framework/mistake_precautions/**` 路径需确认路由目标。

### 4. Session/Same-Agent/Different-Agent/Task Concurrency Safe ✅ 对齐（已补充）

**当前实际实现**:
- `uc7ks_pipeline_state` 表有 `UNIQUE(pipeline_id, agent, domain_id)` 约束
- `atomicUpsertDiscovery()` 使用 `INSERT ... ON CONFLICT(pipeline_id, agent, domain_id) DO UPDATE`（`uc7ks-pipeline-db.ts` 第 136–149 行）
- `atomicUpsertAttestation()` 使用事务包裹的 `UPDATE ... WHERE pipeline_id=? AND agent=? AND domain_id=?`（第 255–296 行）
- SQLite 行级锁保证并发安全：多 agent 同时 attest 同一域时，DB 层面串行化
- `discovery_status` 和 `attestation_status` 按 `(pipeline_id, agent, domain_id)` 隔离，不同 session 的 agent 有独立状态

**跨 Session 行为**:
- Attestation 状态持久化在 `uc7ks_pipeline_state` 表
- Session A attest 后，Session B 的同一 (pipeline_id, agent, domain_id) 可见 `attestation_status='attested'`
- `files_read` 字段记录已读文件列表（JSON 数组），支持 TOCTOU 检查
- **原始审计的并发担忧已由 UNIQUE+UPSERT 机制解决**

**对齐**: ✅ 并发安全机制已完善。域拆分不引入新的竞态条件。

### 5. Hardened Enforcement Subsystem ✅ 对齐

**文档**: §4 描述 Step 4.5 强制执行  
**实际**: `knowledge_cache_attest.ts` 第 412–520 行已实现完整强制链：

1. 读取 `project.config.json` 的 `mandatory_knowledge`（第 422–431 行）
2. 支持两种格式：
   - 新 per-domain 格式：`mk.domains[domainId]`（第 433 行）
   - 旧 flat 格式：`mk.files` + `mk.apply_to_domains`（第 434–438 行）
3. 模式门控：`enabled_in_modes` 默认 `["strict", "locked"]`（第 442 行）
4. ENFORCEMENT_MODE 解析优先级（第 443–448 行）：
   - `process.env.ENFORCEMENT_MODE`
   - `pc.template_resolution.develop_enforcement_mode`
   - fallback `"advisory"`
5. 缺失文件检测：substring 匹配 `filesRead[fj].indexOf(mf) >= 0`（第 456 行）
6. 失败处理（第 463–489 行）：
   - 记录 `writeLog(SRC, "ERROR", ...)` 事件 `UC7KS-ATTEST-FAIL-MANDATORY`
   - 调用 `checklistWireFailed()` 记录到 checklist
   - 返回 `{ attested: false, step: "4.5", error: "MANDATORY_KNOWLEDGE_MISSING" }`
7. 成功处理（第 491–499 行）：调用 `checklistWirePassed()`
8. 非致命异常捕获（第 511–520 行）：config 读取失败时跳过检查

**对齐**: ✅ 强制执行机制已就绪。域拆分只需更新 `mandatory_knowledge.domains` 配置即可生效。

### 6. Framework Harness Subsystem ⚠️ 部分对齐

**当前 Check 30 逻辑**（`framework-self-test.ts` 第 2326–2387 行）:
- `requiredDomains` 数组（第 2344–2357 行）：12 个域，**不含** `"mistake_precautions"`
- 验证每个域有 `keywords`、`save_path`、`fallback_pattern`（第 2367–2373 行）
- 检测缺失域：`requiredDomains.filter(d => !existingIds.has(d))`（第 2363–2365 行）

**需要的变更**（文档未明确说明）:
1. 在 `requiredDomains` 数组中添加 `"mistake_precautions"`
2. 新增检查：验证 `mandatory_knowledge.domains` 中的域键存在于 `knowledge_semantic_map.domains` 中

**新增 Check 68**（第 4133–4172 行）: 验证 `p0-evidence-injector.ts` 已从磁盘和 `opencode.json` 中移除——与本次变更无关。

**对齐**: ⚠️ 需要新增域到 requiredDomains 并添加一致性检查。当前文档未提供具体代码变更。

### 7. Central State Management Subsystem ⚠️ 部分对齐（已补充）

**当前实际实现**:

**DB-canonical 状态层**（`uc7ks-pipeline-db.ts`，452 行）:
- `resolvePipelineId()` — 解析 pipeline ID
- `atomicUpsertDiscovery()` — UPSERT 发现状态
- `readDiscoveryForAttest()` — 读取发现状态供 attest 使用
- `atomicUpsertAttestation()` — 事务内 UPDATE attestation 状态
- `queryAttestationForWriteGate()` — 写入门前查询 attestation
- `readPipelineState()` — 读取完整 pipeline 状态
- `queryAllAgentPipelineDomains()` — 查询所有 agent 的域状态

**JSON blob 状态层**（`substate_kv` 表，13 行）:
- 与 `uc7ks_pipeline_state` 共存（状态二元性）
- 存储非 pipeline 的配置/元数据状态

**文档未涉及的状态问题**:
- `@rule` 提取后的状态存储位置未定义
- SUMMARY.md 生成后如何验证一致性（SHA256 比对？时间戳？）
- 未提及 `gate-state.json` 或 `gate_*` 相关表是否需要更新

**建议**: 新增 §2.5 状态管理集成

```markdown
### 2.5 状态管理集成

**@rule 提取状态**:
- 存储在 `substate_kv` 表，key = `mistake_precautions_rules`
- 结构: `{ last_extracted_at: number, rule_count: number, rules: Rule[], source_files: string[] }`
- 每次 KC 收集错题集后触发提取，更新状态

**SUMMARY.md 生成状态**:
- 使用 `knowledge_files.sha256` 校验源文件完整性
- 存储生成时间戳在 `substate_kv`，key = `mistake_precautions_summary`
- 结构: `{ generated_at: number, source_files: string[], source_sha256s: string[], summary_sha256: string }`
- 用于 TOCTOU 检查：验证 SUMMARY.md 是否与最新 @rule 一致

**uc7ks_pipeline_state 集成**:
- 新增 `mistake_precautions` 域的 discovery/attestation 行由 `atomicUpsertDiscovery()` 自动创建
- `files_read` 字段记录 `["framework/mistake_precautions/SUMMARY.md"]`
- `evidence_file_count` 记录实际读取文件数（1，即 SUMMARY.md）
```

### 8. Multi-Agent Subsystem ✅ 对齐

**文档**: §3.5 描述了 KC agent 配置更新  
**实际**: `Knowledge-Curator.md` 第 17–30 行有域表结构，当前未列出 `mistake_precautions`。KC agent 使用 `context7_resolve-library-id` 和 `context7_query-docs` MCP 工具进行知识获取。  
**对齐**: ✅ KC 工作流可适配。收集流程加一步：写入错题集后扫描 `@rule` 标记并更新 `SUMMARY.md`。

### 9. Log Central Management Subsystem ✅ 已补充完整分析

**当前日志系统** (`log-manager.ts` v3.0，637 行):

**核心 API** (第 330 行):
```typescript
export function writeLog(
  plugin: string,
  category: LogCategory,  // "loaded" | "hooks" | "runtime"
  fields: LogFields,      // { sessionID?, callID?, agent?, agentType?, level?, event, detail }
): void
```

**LogFields 接口** (第 42–50 行):
- `sessionID?: string` — 会话标识
- `callID?: string` — 调用标识
- `agent?: string` — agent 名称
- `agentType?: string` — agent 类型
- `level?: LogLevel` — 日志级别
- `event: string` — 事件名称（必填）
- `detail: string` — 详细信息（必填）

**输出格式**: `ISO_TIMESTAMP | sessionID | callID | agent | agentType | level | event | detail`

**缓冲机制**: 异步缓冲写入，可配置 flush 间隔（默认 5s）和缓冲区大小（默认 20 条）。`"loaded"` 类别立即 flush；`"runtime"` 类别触发 archive 检查。

**normalizeCategory()** (第 116–120 行): 将旧的 LogLevel 字符串映射为规范的 `"runtime"` 类别。

**全代码库 writeLog() 调用点**: 645 处。

**新增日志事件建议**（使用正确 API）:

| 事件 | category | level | 触发条件 |
|------|----------|-------|---------|
| `MISTAKE-PRECAUTIONS-DOMAIN-CREATED` | `"runtime"` | `"INFO"` | Phase 1.1 完成 |
| `RULE-EXTRACTION-STARTED` | `"runtime"` | `"INFO"` | 开始提取 @rule |
| `RULE-EXTRACTION-COMPLETE` | `"runtime"` | `"INFO"` | 提取完成 |
| `SUMMARY-MD-GENERATED` | `"runtime"` | `"INFO"` | SUMMARY.md 生成 |
| `MANDATORY-KNOWLEDGE-UPDATED` | `"runtime"` | `"INFO"` | 配置更新 |

**日志格式示例**（修正为当前 API）:
```typescript
import { writeLog } from "../lib/log-manager";

writeLog("mistake-precaution-extractor", "runtime", {
  sessionID: sessionId,
  agent: "@Super-Admin",
  level: "INFO",
  event: "RULE-EXTRACTION-COMPLETE",
  detail: `Extracted ${ruleCount} rules from ${fileCount} files`,
});
```

**对齐**: ✅ 日志系统 v3.0 完善。原始审计使用的 `writeLog(SRC, level, fields)` 旧 API 需要更新为 `writeLog(plugin, category, fields)`。

### 10. DB-canonical Management Subsystem ✅ 已补充

**当前 DB 架构**:
- `knowledge_entries` (9 列): `id, library_id, query_topic, domain, tags, source, status, created_at, updated_at`
- `knowledge_files` (12 列): `id, entry_id, file_path, sha256, size_bytes, source, ttl_days, status, access_count, last_accessed, created_at, updated_at`
- `knowledge_entry_tags` (3 列): `id, entry_id, tag` — 766 行，归一化标签表
- `uc7ks_pipeline_state` (18 列): `id, pipeline_id, agent, domain_id, session_id, dag_task_id, discovery_status, discovered_files, discovered_count, missing_topics, discovered_at, attestation_status, cache_sufficient, files_read, evidence_file_count, content_summary, attested_at, created_at, updated_at`

**DB 初始化状态**:
- 3 份错题集文件已索引（`knowledge_files` entry_id 513/515/516）
- 对应 `knowledge_entries` 行的 `domain='opencode'`，需改为 `'mistake_precautions'`
- `knowledge_entry_tags` 已含 "mistake-prevention"、"precautions" 等标签（entry 515 有 12 个标签）
- `access_count=0` 说明从未通过 UC7KS 流程被读取

**文档 §3.3 修正**:
- 原始 SQL 的 `WHERE library_id IN (SELECT ... WHERE file_path LIKE ...)` 是正确的
- 但实际 domain 是 `'opencode'` 而不是文档假设的 `'opencode_framework'`
- `knowledge_entry_tags` 无需变更（现有标签正确）

**对齐**: ✅ DB 有数据可直接 UPDATE。设计符合 DB-canonical 原则：所有状态以 DB 为准，`index.json` 为缓存层。

### 11. Templatization & Parameterization Universality Subsystem ⚠️ 部分对齐

**文档**: §2.2 定义了 `@rule` 标记格式（HTML 注释，含 id/症状/根因/修复/排查/severity 字段）

**当前实际状态**:
- `@rule` 格式是硬编码的 HTML 注释，未参数化
- 3 份错题集文件均无 `@rule` 标记
- 无提取脚本（`.opencode/scripts/extract-rules.ts` 不存在）
- 无模板文件（`.opencode/templates/rule-marker.md` 不存在）

**MCP/Tool/Plugin 标准合规分析**:

| 标准维度 | 要求 | 当前状态 | 合规 |
|----------|------|---------|------|
| **Plugin 规范** | `withPluginLifecycle()` + `resolveAgent()` + `getEnforcementMode()` + `writeLog()` | 提取工具如作为 plugin，需遵循此模式 | ⚠️ 工具未实现 |
| **Tool 规范** | 在 `opencode.json` 注册 tool 路径 | 提取脚本注册为 tool | ⚠️ 未注册 |
| **MCP 工具** | 通过 `mcp_tools` 声明依赖 | 提取工具不依赖外部 MCP | ✅ N/A |
| **writeLog 规范** | `writeLog(plugin, category, fields)` 格式 | 提取工具需集成日志 | ⚠️ 未实现 |
| **safe_edit 规范** | 写文件通过 `safe_edit` 工具 | 生成 SUMMARY.md 应使用 safe_edit | ⚠️ 未实现 |
| **checklist 集成** | 关键步骤调用 `checklistWirePassed/Failed` | 提取过程应记录 checklist | ⚠️ 未实现 |

**建议**: 新增提取工具应作为 tool（非 plugin），因工具不介入 tool.execute 生命周期钩子，无需 `withPluginLifecycle()`。但需遵循以下规范：
- 注册到 `opencode.json` 的 tools 数组
- 使用 `writeLog()` 记录提取过程
- 使用 `safe_edit` 写入 SUMMARY.md
- 使用 `safe_shell` 运行 sqlite3 UPDATE

### 12. TypeScript + Bun Based Runtime Subsystem ⚠️ 部分对齐

**文档**: 未提及 Bun 缓存影响  
**实际框架处理**: `hook-config-guard.ts` 第 65–73 行定义了 7 个 `PLUGIN_PARTS_MUTATION_PATTERNS`，阻止 `output.parts` 的直接修改（这是 Bun 缓存相关的已知问题模式）。`EXEMPT_FILES`（第 92 行）将 guard 自身排除在扫描外。

**对域拆分的影响**:
- SUMMARY.md 生成脚本需要 Bun 缓存刷新策略
- 建议在提取脚本中添加 `// BUN-CACHE-VERSION: 2026-06-26` 注释
- `uc7ks_pipeline_state` 的 DB 操作使用 `bun:sqlite` 同步 API，缓存无影响

**对齐**: ⚠️ Bun 缓存策略需在提取工具中考虑。其它运行时影响已由框架处理。

---

## 四、MCP / Plugin / Tool 标准合规总览

| 检查项 | 标准要求 | 当前域方案合规性 | 备注 |
|--------|---------|-----------------|------|
| **Plugin 注册** | `opencode.json` plugins 数组注册 | ✅ 23 个 plugin 已注册，无需新 plugin | 域拆分是配置变更 |
| **Tool 注册** | `opencode.json` tools 数组注册 | ⚠️ `extract-rules.ts` 若创建需注册 | 待实现 |
| **writeLog 规范** | `writeLog(plugin, category, fields)` | ✅ 框架已使用 | 提取工具需遵循 |
| **safe_edit 规范** | 写文件通过 `safe_edit` | ✅ 框架已使用 | SUMMARY.md 生成需使用 |
| **checklist 集成** | `checklistWirePassed/Failed` | ✅ `knowledge_cache_attest.ts` Step 4.5 已集成 | 提取过程建议集成 |
| **hook-config-guard** | 禁止 `output.parts` 修改 | ✅ 7 种模式被阻断 | 与本次变更无关 |
| **dispatch_subagent** | PLAN-FIRST 强制检查 | ✅ Layer 2 强制执行 | KC agent dispatch 符合 |
| **MCP 工具声明** | agent 配置中 `mcp_tools` 列表 | ✅ KC 使用 context7 工具 | 无需新增 MCP 工具 |

---

## 五、关键修订建议

### 修订 1: 修正 DB 状态描述与 UPDATE 语句（优先级 P0）

**位置**: §3.3 DB 数据变更  
**问题**: 原始审计声称 DB 为空（已过时），文档 UPDATE 语句的 WHERE 条件与实际 domain 值 (`'opencode'`) 不完全匹配  
**修正**:
```
实际 DB 状态（2026-06-26）:
- knowledge_entries 有 63 行（非空）
- 3 份错题集 domain='opencode'（非 'opencode_framework'）
- UPDATE 可直接执行：WHERE id IN (513, 515, 516) 或 WHERE file_path LIKE 'framework/mistake_precautions/%'
```

### 修订 2: 修正 index.json 描述（优先级 P0）

**位置**: §3.2 docs/official_docs/index.json  
**问题**: 文档假设 library_id 为 `"opencode-framework"`，实际为 `"framework"`  
**修正**:
```diff
  {
-   "library_id": "framework",
+   "library_id": "mistake_precautions",
-   "domain": "framework",
+   "domain": "mistake_precautions",
    "query_topic": "mistake_precautions",
-   "tags": ["framework"],
+   "tags": ["mistake_precautions"],
    ...
  }
```

### 修订 3: 细化 Check 30 更新（优先级 P1）

**位置**: §5 Phase 1.5  
**问题**: 文档未说明具体代码变更  
**修正**:
```typescript
// framework-self-test.ts Check 30
const requiredDomains = [
  // ... existing 12 domains ...
  "mistake_precautions",  // 新增
];

// 新增检查: mandatory_knowledge 域一致性
const mandatoryDomains = Object.keys(config.mandatory_knowledge?.domains || {});
const semanticDomains = config.knowledge_semantic_map.domains.map(d => d.domain_id);
for (const md of mandatoryDomains) {
  if (!semanticDomains.includes(md)) {
    issues.push(`mandatory_knowledge domain "${md}" not in knowledge_semantic_map`);
  }
}
```

### 修订 4: 添加状态管理集成（优先级 P1）

**位置**: 新增 §2.5  
**内容**: 定义 `@rule` 提取和 SUMMARY.md 生成的状态存储方案（见子系统 7 建议）

### 修订 5: 添加日志集成（优先级 P1）

**位置**: 新增 §2.6  
**内容**: 使用当前 `writeLog(plugin, category, fields)` API 定义日志事件（见子系统 9 建议）

### 修订 6: 提供 @rule 提取工具（优先级 P2）

**位置**: 新增 §2.7  
**内容**: 
- 创建 `.opencode/templates/rule-marker.md` 模板文件
- 创建 `.opencode/scripts/extract-rules.ts` 提取脚本
- 注册到 `opencode.json` tools 数组
- 使用 `safe_edit` 写入 SUMMARY.md，使用 `writeLog()` 记录过程

### 修订 7: 添加 knowledge_entry_tags 数据一致性验证（优先级 P2）

**位置**: §3.3 DB 数据变更  
**内容**: 更新 `knowledge_entries.domain` 后，验证 `knowledge_entry_tags` 中相关标签（"mistake-prevention"、"precautions" 等）仍然正确关联

---

## 六、风险评估更新

| 风险 | 影响 | 缓解 | 状态变化（vs 2026-06-24） |
|------|------|------|--------------------------|
| ~~DB 表为空~~ | ~~Phase 1.3 无法执行~~ | ~~补充 DB 初始化策略~~ | ✅ **已解决**：DB 有 63 行，3 份文件已索引 |
| domain 值不匹配 | UPDATE 可能影响错误的行 | 使用精确 id 匹配（IN (513,515,516)） | 🆕 **新发现** |
| index.json 结构偏差 | §3.2 diff 无法直接应用 | 从实际值 `"framework"` 改为 `"mistake_precautions"` | 🆕 **新发现** |
| SUMMARY.md 未生成 | Phase 4 验证失败 | 先执行 Phase 2.4 生成 SUMMARY.md | ⚠️ 持续存在 |
| @rule 提取无工具 | Phase 2.1-2.4 无法自动化 | 提供提取脚本 | ⚠️ 持续存在 |
| 日志 API 版本不匹配 | 日志集成代码需用旧 API | 更新为 `writeLog(plugin, category, fields)` | 🆕 **新发现** |
| Check 30 更新不明确 | 实施时遗漏 | 提供具体代码 | ⚠️ 仅提及 |
| access_count=0 | 错题集从未被 UC7KS 流程读取 | 域拆分后通过 mandatory_knowledge 强制执行 | 🆕 **新发现** |

---

## 七、实施可行性评估（更新）

### 修正后的 Phase 执行顺序

原文档的 Phase 执行顺序需要调整：DB 已有数据，Phase 1.3 可立即执行。

**推荐执行顺序**:

1. **Phase 2 先行**（内容改造）：加 @rule 标记 → 生成 SUMMARY.md → 这是其它 Phase 的前置条件
2. **Phase 1**（基础设施）：更新 project.config.json → 更新 DB domain → 更新 index.json → 更新 Check 30
3. **Phase 3**（KC 流程）：更新 Knowledge-Curator.md 域表
4. **Phase 4**（验证）：运行 framework-self-test → 验证 UC7KS pipeline → 跨 session 验证

### 文档质量: ⭐⭐⭐⭐ (4/5)

设计方案逻辑清晰，域拆分合理，SUMMARY.md 摘要机制有价值。

### 实施可行性: ⭐⭐⭐ (3/5，从 2/5 提升)

主要阻塞项（DB 空表）已解决。剩余工作：
1. 创建 SUMMARY.md（手动或自动）
2. 添加 @rule 标记到 3 份文件
3. 更新配置文件和 DB
4. 开发 @rule 提取工具（可选，中期）

### 建议行动

1. **立即**: 更新域计划文档中的 index.json 和 DB 描述，使其与实际值对齐（修订 1–2）
2. **短期**: 添加 @rule 标记 + 生成 SUMMARY.md + 更新配置（Phase 1 + Phase 2）
3. **中期**: 开发 @rule 提取脚本 + 更新 KC 流程（修订 6）
4. **执行前**: 先完成内容改造（Phase 2），再执行基础设施变更（Phase 1）

---

## 八、结论

**原始审计**（2026-06-24）的核心发现——DB 空表导致 Phase 1.3 无法执行——已经过时。当前框架 DB 有 63 行数据，3 份错题集文件已在库中索引。但发现新的偏差需要修正：

1. **index.json**: 实际 library_id 为 `"framework"` 而非文档假设的 `"opencode-framework"`
2. **DB domain**: 实际为 `"opencode"` 而非 `"opencode_framework"`
3. **日志 API**: 当前为 `writeLog(plugin, category, fields)` 而非旧 `writeLog(SRC, level, fields)`
4. **access_count=0**: 3 份错题集从未通过 UC7KS 流程被读取，证实了 mandatory_knowledge 强制执行的必要性

域计划的核心设计不需要变更，但 §3.2（index.json）和 §3.3（DB UPDATE）的细节需要与当前实际状态对齐。实施可行性从 2/5 提升至 3/5。

---

**审计完成**。建议先更新域计划文档中的偏差项，再按推荐顺序执行实施步骤。
