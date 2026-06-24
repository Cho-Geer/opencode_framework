# 错题集独立域方案审计报告

**审计日期**: 2026-06-24  
**审计对象**: `docs/review/framework-refactor/mistake-precautions-domain-plan.md` (v1.0.0)  
**审计人**: @Super-Admin  
**状态**: 审计完成 — 发现 5 项关键问题

---

## 一、总体评估

| 维度 | 评分 | 说明 |
|------|------|------|
| **设计合理性** | ⭐⭐⭐⭐ | 独立域拆分逻辑清晰，SUMMARY.md 摘要机制有价值 |
| **代码对齐度** | ⭐⭐ | 文档假设 DB 有数据，但实际为空；实施细节不完整 |
| **子系统覆盖** | ⭐⭐⭐ | 覆盖了 8/12 子系统，4 个关键子系统未涉及 |
| **可执行性** | ⭐⭐ | Phase 1 步骤 1.3 (DB 迁移) 无法执行，需要补充数据初始化策略 |

**结论**: 设计方案合理，但文档与当前代码状态存在偏差，需要更新后才能执行。

---

## 二、准确性验证

### ✅ 准确的部分

| 项目 | 文档声明 | 实际状态 | 验证方式 |
|------|---------|---------|---------|
| Step 4.5 存在 | `knowledge_cache_attest.ts` 有 Step 4.5 | ✅ 第 413 行存在 | `grep -n "Step 4.5"` |
| 错题集文件存在 | 3 份文件在 `framework/mistake_precautions/` | ✅ 存在且总行数 1191 行 ≈ 1200 行 | `wc -l` |
| `mandatory_knowledge` 配置存在 | `project.config.json` 有该配置块 | ✅ 存在，当前指向 `opencode_framework` 域 | `grep -A 20` |
| 配置结构支持 per-domain | 支持 `domains` 对象格式 | ✅ 代码第 433 行支持 `mk.domains` | 代码审查 |
| Check 30 存在 | `framework-self-test.ts` 有 Check 30 | ✅ 第 2326 行存在 | `grep -n "Check 30"` |

### ❌ 不准确或缺失的部分

| 项目 | 文档声明 | 实际状态 | 影响 |
|------|---------|---------|------|
| **DB 数据存在** | §3.3 假设 `knowledge_entries` 有数据可 UPDATE | ❌ 表为空（`SELECT COUNT(*) = 0`） | **Phase 1.3 无法执行** |
| **knowledge_files 有记录** | 假设错题集文件已索引 | ❌ `knowledge_files` 无相关记录 | **Phase 4.2 验证会失败** |
| **SUMMARY.md 已创建** | §3.4.1 描述了 SUMMARY.md 内容 | ❌ 文件不存在 | **Phase 2.4 未执行** |
| **Check 30 更新细节** | §5 Phase 1.5 提到更新 Check 30 | ⚠️ 未说明具体改什么 | **实施不明确** |
| **@rule 提取工具** | §2.2 提到自动提取 @rule | ❌ 无提取脚本或工具 | **Phase 2.1-2.4 无工具支持** |

---

## 三、12 子系统对齐分析

### 1. Layout Architecture Subsystem ✅ 对齐

**文档**: 提出 `framework/mistake_precautions/` 目录结构  
**实际**: 目录已存在，包含 3 个 `.md` 文件  
**对齐**: ✅ 完全符合 `.opencode/` 布局规范

### 2. DB-only and DB-canonical based ⚠️ 部分对齐

**文档**: §3.3 提出 UPDATE `knowledge_entries`  
**问题**: 
- DB 表当前为空，UPDATE 无数据可更新
- 未说明如何初始化数据（是 KC 收集时写入？还是手动插入？）
- 未提及 `knowledge_files` 表的初始化

**建议**: 
```markdown
### 3.3 DB 数据变更（修订）

**前置条件**: 先通过 KC 收集流程或手动方式将 3 份错题集索引到 DB。

**方法 A: KC 收集（推荐）**
1. 启动 KC agent，dispatch 收集 `mistake_precautions` 域
2. KC 调用 `knowledge_cache_search` → 自动索引文件到 `knowledge_entries`
3. 验证: `SELECT COUNT(*) FROM knowledge_entries WHERE domain='mistake_precautions';` → 应返回 3

**方法 B: 手动插入（紧急）**
```sql
INSERT INTO knowledge_entries (library_id, query_topic, domain, created_at, updated_at)
VALUES 
  ('mistake_precautions', 'Plugin debugging precautions', 'mistake_precautions', unixepoch('now')*1000, unixepoch('now')*1000),
  ...
```

**UPDATE 语句（数据存在后执行）**:
```sql
UPDATE knowledge_entries
SET domain = 'mistake_precautions', updated_at = unixepoch('now') * 1000
WHERE library_id IN (
  SELECT library_id FROM knowledge_files
  WHERE file_path LIKE 'framework/mistake_precautions/%'
)
AND domain = 'opencode_framework';
```
```

### 3. Permission Matrix Subsystem ✅ 对齐

**文档**: §2.1 提出独立域  
**实际**: `project.config.json` 的 `agent_tool_scopes` 和 `knowledge_semantic_map` 已支持 per-domain 权限  
**对齐**: ✅ 域拆分后权限矩阵自动适配

### 4. Session/Same-Agent/Different-Agent/Task Concurrency Safe ⚠️ 部分对齐

**文档**: §1 提到"session 间 attestation 共享导致虚假满足"  
**问题**: 
- §4 描述了跨 session 行为，但未详细说明并发处理
- 未提及：Session A attest 后，Session B 是否需要重新 read SUMMARY.md？
- 未提及：多个 agent 同时 attest 同一域时的竞态条件

**建议**: 
```markdown
### 2.4 跨 Session 与并发处理

**跨 Session 行为**:
- Attestation 状态持久化在 DB (`uc7ks_pipeline_state` 表)
- Session A attest 后，Session B 查询 DB 可见 `attestation_status = 'attested'`
- **无需重读**: Session B 可直接复用 Session A 的 attest 结果
- **但需验证**: `files_read` 列表中的文件是否仍存在（TOCTOU 检查）

**并发处理**:
- `uc7ks_pipeline_state` 表有 `UNIQUE(pipeline_id, agent, domain_id)` 约束
- 多 agent 同时 attest → DB 层面串行化（SQLite 锁）
- 无应用层竞态风险
```

### 5. Hardened Enforcement Subsystem ✅ 对齐

**文档**: §4 描述 Step 4.5 强制执行  
**实际**: `knowledge_cache_attest.ts:413-510` 已实现：
- 读取 `project.config.json` 的 `mandatory_knowledge`
- 按域匹配强制文件列表
- 缺失文件 → 返回 `MANDATORY_KNOWLEDGE_MISSING` 错误
- strict/locked 模式下阻断写入

**对齐**: ✅ 强制执行机制已就绪

### 6. Framework Harness Subsystem ⚠️ 部分对齐

**文档**: §5 Phase 1.5 提到"更新 `framework-self-test.ts` Check 30"  
**问题**: 
- Check 30 验证 `knowledge_semantic_map.domains` 的必需字段
- 文档未说明新增 `mistake_precautions` 域后，Check 30 需要验证什么

**建议**:
```markdown
### 1.5 更新 `framework-self-test.ts` Check 30

**当前 Check 30 逻辑** (第 2330 行):
- 验证 `knowledge_semantic_map.domains` 中每个域有 `keywords`, `save_path`, `fallback_pattern`
- 硬编码 `requiredDomains` 列表（当前 12 个域）

**需要的变更**:
1. 在 `requiredDomains` 数组中添加 `"mistake_precautions"`
2. 添加新检查: 验证 `mandatory_knowledge.domains` 中的域存在于 `knowledge_semantic_map.domains`

**代码示例**:
```typescript
const requiredDomains = [
  "backend_api", "persistence", ..., 
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
```

### 7. Central State Management Subsystem ❌ 未涉及

**问题**: 
- 文档未提及 `@rule` 提取后的状态存储
- 未说明 SUMMARY.md 生成后如何更新 `substate_kv` 或 `uc7ks_pipeline_state`
- 未提及与 `gate-state.json` 的关系

**建议**:
```markdown
### 2.5 状态管理集成

**@rule 提取状态**:
- 存储在 `substate_kv` 表，key = `mistake_precautions_rules`
- 结构: `{ last_extracted_at: number, rule_count: number, rules: Rule[] }`
- 每次 KC 收集错题集后触发提取，更新状态

**SUMMARY.md 生成状态**:
- 存储在 `substate_kv` 表，key = `mistake_precautions_summary`
- 结构: `{ generated_at: number, source_files: string[], sha256: string }`
- 用于 TOCTOU 检查：验证 SUMMARY.md 是否与最新 @rule 一致
```

### 8. Multi-Agent Subsystem ✅ 对齐

**文档**: §3.5 描述了 KC agent 配置更新  
**实际**: `Knowledge-Curator.md` 已有域表结构  
**对齐**: ✅ KC 工作流可适配

### 9. Log Central Management Subsystem ❌ 未涉及

**问题**: 
- 文档未提及新域创建时的日志记录
- 未提及 `@rule` 提取过程的日志
- 未提及 SUMMARY.md 生成的日志

**建议**:
```markdown
### 2.6 日志集成

**新增日志事件** (使用 `writeLog(SRC, level, fields)`):

| 事件 | 级别 | 触发条件 |
|------|------|---------|
| `MISTAKE-PRECAUTIONS-DOMAIN-CREATED` | INFO | Phase 1.1 完成时 |
| `RULE-EXTRACTION-STARTED` | INFO | 开始提取 @rule 标记 |
| `RULE-EXTRACTION-COMPLETE` | INFO | 提取完成，记录 rule_count |
| `SUMMARY-MD-GENERATED` | INFO | SUMMARY.md 生成完成 |
| `MANDATORY-KNOWLEDGE-UPDATED` | INFO | mandatory_knowledge 配置更新 |

**日志格式示例**:
```typescript
writeLog(SRC, "INFO", {
  sessionID: sessionId,
  agent: agent,
  event: "RULE-EXTRACTION-COMPLETE",
  detail: `Extracted ${ruleCount} rules from ${fileCount} files`,
});
```
```

### 10. DB-canonical Management Subsystem ⚠️ 部分对齐

**问题**: 同第 2 点，DB 当前为空，需要初始化策略  
**对齐**: ⚠️ 设计符合 DB-canonical 原则，但实施细节缺失

### 11. Templatization & Parameterization Universality Subsystem ⚠️ 部分对齐

**文档**: §2.2 定义了 `@rule` 标记格式  
**问题**: 
- `@rule` 格式是硬编码的 HTML 注释，未参数化
- 未提供提取脚本或模板

**建议**:
```markdown
### 2.7 @rule 模板与提取工具

**@rule 模板** (存储在 `.opencode/templates/rule-marker.md`):
```markdown
<!-- @rule:
  id: {rule-id}
  症状: {symptom}
  根因: {root-cause}
  修复: {fix}
  排查: {debugging-steps}
  severity: {high|medium|low}
-->
```

**提取脚本** (`.opencode/scripts/extract-rules.ts`):
```typescript
// 扫描 docs/official_docs/framework/mistake_precautions/*.md
// 提取所有 @rule 标记
// 生成 SUMMARY.md
// 更新 substate_kv 状态
```
```

### 12. TypeScript + Bun Based Runtime Subsystem ⚠️ 部分对齐

**问题**: 
- 文档未提及 Bun 缓存对 SUMMARY.md 生成的影响
- 未提及 `@rule` 提取脚本的 Bun 缓存刷新策略

**建议**:
```markdown
### 2.8 Bun 缓存处理

**SUMMARY.md 生成脚本**:
- 添加 `// BUN-CACHE-VERSION: 2026-06-25` 注释
- 或使用唯一文件名: `extract-rules-v2026-06-25.ts`

**触发缓存刷新**:
```bash
# 方法 1: 清除全局缓存
rm -rf ~/.cache/bun

# 方法 2: 重命名文件（推荐）
mv extract-rules.ts extract-rules-v2.ts
```
```

---

## 四、关键修订建议

### 修订 1: 补充 DB 初始化策略（优先级 P0）

**位置**: §3.3 DB 数据变更  
**内容**: 添加"前置条件"小节，说明如何先初始化 `knowledge_entries` 和 `knowledge_files` 表

### 修订 2: 细化 Check 30 更新（优先级 P1）

**位置**: §5 Phase 1.5  
**内容**: 提供具体的代码变更示例，说明 `requiredDomains` 数组和新增检查逻辑

### 修订 3: 添加状态管理集成（优先级 P1）

**位置**: 新增 §2.5  
**内容**: 说明 `@rule` 提取和 SUMMARY.md 生成的状态存储方案

### 修订 4: 添加日志集成（优先级 P1）

**位置**: 新增 §2.6  
**内容**: 定义新增日志事件和格式

### 修订 5: 提供 @rule 提取工具（优先级 P2）

**位置**: 新增 §2.7  
**内容**: 提供提取脚本代码或工具说明

---

## 五、风险评估更新

| 风险 | 影响 | 缓解 | 文档状态 |
|------|------|------|---------|
| DB 表为空 | Phase 1.3 无法执行 | 补充 DB 初始化策略 | ❌ 未提及 |
| SUMMARY.md 未生成 | Phase 4 验证失败 | 先执行 Phase 2.4 | ⚠️ 隐含 |
| @rule 提取无工具 | Phase 2.1-2.4 无法自动化 | 提供提取脚本 | ❌ 未提及 |
| Check 30 更新不明确 | 实施时遗漏 | 提供具体代码 | ⚠️ 仅提及 |
| 日志缺失 | 审计追踪不完整 | 添加日志集成章节 | ❌ 未提及 |

---

## 六、结论与建议

### 文档质量: ⭐⭐⭐⭐ (4/5)

设计方案逻辑清晰，域拆分合理，SUMMARY.md 摘要机制有价值。

### 实施可行性: ⭐⭐ (2/5)

文档与当前代码状态存在偏差：
1. DB 表为空，UPDATE 语句无法执行
2. SUMMARY.md 未创建
3. @rule 提取工具缺失

### 建议行动

1. **立即**: 补充 DB 初始化策略（修订 1）
2. **短期**: 细化 Check 30 更新、添加状态管理和日志集成（修订 2-4）
3. **中期**: 开发 @rule 提取脚本（修订 5）
4. **执行前**: 先运行 Phase 2（内容改造）生成 SUMMARY.md，再执行 Phase 1（基础设施）

---

**审计完成**。建议更新文档后再执行实施计划。
