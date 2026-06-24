# 错题集独立域 + 摘要方案实施计划

**版本**: v1.0.0  
**日期**: 2026-06-25  
**作者**: @Super-Admin  
**状态**: draft

---

## §1 背景与动机

### 问题 1：session 间 attestation 共享导致虚假满足

当前 `knowledge_cache_attest` 的 attestation 状态跨 session 持久化在 DB 中。Session A 做完 attest 后，Session B 即使从未读过错题集，`checkUC7KSWrite` 也会放行——因为 DB 里有 `attested` 记录。Agent 的 LLM 上下文没有错题集的知识，但框架认为"已读"。

### 问题 2：1200 行全量读取浪费上下文

3 份错题集合计约 1200 行，每 session 完整读取开销大。Agent 需要的是核心教训，细节可以在遇到相关场景时按需查阅原文。

### 问题 3：KC 收集时无结构化

Knowledge-Curator 收集错题集时产出的是散文格式，没有规则提取机制。新增错题集无法自动汇总。

---

## §2 设计方案

### 2.1 错题集独立域

从 `opencode_framework` 域中拆出独立的 `mistake_precautions` 域：

```
opencode_framework          mistake_precautions（新）
├── plugins/                ├── plugin-debugging-precautions.md
├── framework/              ├── double-hook-trigger-prevention.md
├── findings/               ├── opencode-plugin-loading-bun-cache.md
├── sessions/               └── SUMMARY.md（自动生成）
└── releases/
```

SA 需要同时 attest 两个域，但因为 Step 4.5 按域匹配，只有 attest `mistake_precautions` 域时才强制检查错题集。

### 2.2 @rule 标记 + 自动摘要

每份错题集的每个章节末尾添加结构化 `@rule` 标记：

```markdown
## 3. Bun 缓存：过时的编译模块

...（完整上下文保留不变）...

<!-- @rule:
  id: bun-cache-stale
  症状: 修改 .ts 文件后 Bun 仍执行旧代码
  根因: Bun 编译缓存基于文件内容哈希，不自动失效
  修复: 添加 BUN-CACHE-VERSION 注释或重命名文件
  severity: high
-->
```

`SUMMARY.md` 从所有错题集的 `@rule` 标记自动提取，Agent 只需读 ~30 行规则表即可获得核心知识。需要深入时跟随 `来源` 链接读原文。

### 2.3 KC 自动收集流程更新

```
KC 收集新文档
  → 写入 docs/official_docs/framework/mistake_precautions/xxx.md
  → 提取 @rule 标记
  → 追加到 SUMMARY.md 规则表
  → 更新 index.json
  → 更新 knowledge_entries 表（DB）
```

---

## §3 变更清单

### 3.1 project.config.json

```diff
  "knowledge_semantic_map": {
    "domains": [
+     {
+       "domain_id": "mistake_precautions",
+       "keywords": [
+         "错题集", "防坑", "经验教训", "pitfall",
+         "precaution", "mistake", "debugging", "陷阱"
+       ],
+       "context7_libraries": [],
+       "fallback_pattern": "https://opencode.ai/docs/framework/mistake_precautions/{topic}",
+       "save_path": "framework/mistake_precautions/",
+       "ttl_days": 90
+     },
      ...
    ]
  },

  "mandatory_knowledge": {
    "enabled_in_modes": ["strict", "locked"],
    "domains": {
-     "opencode_framework": [
+     "mistake_precautions": [
-       "framework/mistake_precautions/plugin-debugging-precautions.md",
+       "framework/mistake_precautions/SUMMARY.md"
-       "framework/mistake_precautions/double-hook-trigger-prevention.md",
-       "framework/mistake_precautions/opencode-plugin-loading-bun-cache.md"
      ]
    }
  }
```

注意：`mandatory_knowledge` 从 3 份全文改为 1 份 `SUMMARY.md`（~30 行）。

### 3.2 docs/official_docs/index.json

3 条错题集条目的 `library_id` 从 `"opencode-framework"` 改为 `"mistake_precautions"`：

```diff
  {
-   "library_id": "opencode-framework",
+   "library_id": "mistake_precautions",
    "query_topic": "OpenCode plugin debugging precautions...",
    "domain": "opencode_framework",
    "tags": ["opencode", "plugins", "debugging", "mistake-prevention", ...],
    ...
  }
```

新增 `SUMMARY.md` 条目：

```json
{
  "library_id": "mistake_precautions",
  "query_topic": "错题集核心规则速查（自动生成）",
  "domain": "mistake_precautions",
  "tags": ["mistake-prevention", "summary", "rules", "错题集"],
  "files": [
    {
      "path": "framework/mistake_precautions/SUMMARY.md",
      "source": "auto-generated",
      "sha256": "<computed>",
      "size_bytes": "<computed>",
      "created_at": "2026-06-25T00:00:00.000Z",
      "ttl_days": 90,
      "status": "active"
    }
  ]
}
```

### 3.3 DB 数据变更

**表: `knowledge_entries`**

```sql
UPDATE knowledge_entries
SET domain = 'mistake_precautions', updated_at = unixepoch('now') * 1000
WHERE library_id IN (
  SELECT library_id FROM knowledge_files
  WHERE file_path LIKE 'framework/mistake_precautions/%'
)
AND query_topic LIKE '%precaution%';
```

影响行数：3。

**表: `knowledge_entry_tags`**

无需变更（现有标签已正确）。

### 3.4 错题集文件改造

#### 3.4.1 新增 SUMMARY.md

```markdown
# 错题集核心规则速查

> 自动生成于 2026-06-25 | 来源：3 份错题集 | 共 N 条规则

| #   | 严重度 | 规则                                             | 来源                                                                                    |
| --- | :----: | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 1   | 🔴 高  | ❌ 单引号含换行 → ✅ 反引号模板字符串            | [plugin-debugging §1](../framework/mistake_precautions/plugin-debugging-precautions.md) |
| 2   | 🔴 高  | ❌ 子目录深层 `../` → ✅ 扁平结构同级导入        | [plugin-debugging §2](../framework/mistake_precautions/plugin-debugging-precautions.md) |
| 3   | 🔴 高  | ❌ 依赖 Bun 自动刷新 → ✅ BUN-CACHE-VERSION 注释 | [plugin-debugging §3](../framework/mistake_precautions/plugin-debugging-precautions.md) |
| 4   | 🔴 高  | ❌ 非 `index.ts` 入口 → ✅ 必须 `index.ts`       | [plugin-debugging §4](../framework/mistake_precautions/plugin-debugging-precautions.md) |
| 5   | 🟡 中  | ❌ `console.log` → ✅ `appendFileSync` 文件日志  | [plugin-debugging §5](../framework/mistake_precautions/plugin-debugging-precautions.md) |
| 6   | 🔴 高  | ❌ 假设 args 结构统一 → ✅ 按工具名 switch       | [plugin-debugging §6](../framework/mistake_precautions/plugin-debugging-precautions.md) |
| 7   | 🔴 高  | ❌ 多插件共存同 hook → ✅ 合并为单一插件         | [double-hook §4](../framework/mistake_precautions/double-hook-trigger-prevention.md)    |
| 8   | 🔴 高  | ❌ 不同 ID 重复注册 → ✅ 使用同一 plugin ID      | [double-hook §5](../framework/mistake_precautions/double-hook-trigger-prevention.md)    |
| ... |  ...   | ...                                              | ...                                                                                     |
```

#### 3.4.2 现有错题集加 @rule 标记

3 份文件每个章节末尾添加结构化标记，以 `plugin-debugging-precautions.md` §1 为例：

```diff
  ### 深层原因

  Bun 的 TypeScript 解析器在单引号字符串中遇到字面换行符时...
+
+ <!-- @rule:
+   id: syntax-single-quote-newline
+   症状: Bun 报 Unexpected token，不指明是换行符引起的
+   根因: 单引号字符串中的字面换行符
+   修复: 改用反引号模板字符串或显式 \n 转义
+   排查: 检查报错行号附近的引号字符串；用 no-unexpected-multiline ESLint 规则
+   severity: high
+ -->
```

### 3.5 KC Agent 配置

`Knowledge-Curator.md` 域表追加：

```markdown
| Domain              | Save Path                      | TTL | Description       |
| ------------------- | ------------------------------ | --- | ----------------- |
| mistake_precautions | framework/mistake_precautions/ | 90d | 错题集 / 经验教训 |
```

收集流程加一步：写入错题集后，扫描 `@rule` 标记并更新 `SUMMARY.md`。

---

## §4 Agent 执行流程（改造后）

```
Agent 执行任务 (strict 模式)
  → module_scope_declare("opencode_framework")
  → knowledge_cache_search("opencode_framework")
  → knowledge_cache_attest(domain="opencode_framework", files_read=[...])
    → Step 4.5: mandatory_knowledge.domains["opencode_framework"] → 空 → 跳过
    → ATTEST-PASS ✅
  → 可以写 opencode_framework 域的文件

Agent 执行任务 (strict 模式)
  → module_scope_declare("mistake_precautions")
  → knowledge_cache_search("mistake_precautions")
    → DB: knowledge_entries WHERE domain='mistake_precautions' → 命中 SUMMARY.md
  → read SUMMARY.md（~30 行，极快）
  → knowledge_cache_attest(domain="mistake_precautions", files_read=["framework/mistake_precautions/SUMMARY.md"])
    → Step 4.5: mandatory_knowledge.domains["mistake_precautions"] = ["SUMMARY.md"]
    → SUMMARY.md ⊆ files_read → ✅
    → ATTEST-PASS ✅
  → Agent 上下文中已有所有核心规则
  → 遇到具体场景时，按 SUMMARY.md 链接 read 原文细节
```

---

## §5 实施步骤

### Phase 1: 基础设施（不可逆）

| 步骤 | 操作                                   | 文件                     |   类型   |
| :--: | -------------------------------------- | ------------------------ | :------: |
| 1.1  | 新增 `mistake_precautions` 域定义      | `project.config.json`    |   配置   |
| 1.2  | 更新 `mandatory_knowledge.domains`     | `project.config.json`    |   配置   |
| 1.3  | 更新 `knowledge_entries.domain`        | SQLite                   | DB 数据  |
| 1.4  | 更新 `index.json` 条目 library_id      | `index.json`             | 缓存索引 |
| 1.5  | 更新 `framework-self-test.ts` Check 30 | `framework-self-test.ts` |   代码   |

### Phase 2: 内容改造

| 步骤 | 操作                                                   | 文件           |
| :--: | ------------------------------------------------------ | -------------- |
| 2.1  | `plugin-debugging-precautions.md` 加 `@rule` 标记      | 6 处（每个 §） |
| 2.2  | `double-hook-trigger-prevention.md` 加 `@rule` 标记    | ~5 处          |
| 2.3  | `opencode-plugin-loading-bun-cache.md` 加 `@rule` 标记 | ~3 处          |
| 2.4  | 从 `@rule` 生成 `SUMMARY.md`                           | 新文件         |

### Phase 3: KC 流程

| 步骤 | 操作                                   | 文件                   |
| :--: | -------------------------------------- | ---------------------- |
| 3.1  | KC.md 加 `mistake_precautions` 域说明  | `Knowledge-Curator.md` |
| 3.2  | （可选）KC 收集脚本加 `@rule` 自动提取 | KC 脚本                |

### Phase 4: 验证

| 步骤 | 操作                                                                              |
| :--: | --------------------------------------------------------------------------------- |
| 4.1  | 重启 OpenCode                                                                     |
| 4.2  | `knowledge_cache_search("mistake_precautions")` → 命中 SUMMARY.md                 |
| 4.3  | attest `opencode_framework` 不含错题集 → PASS（不再强制）                         |
| 4.4  | attest `mistake_precautions` 不含 SUMMARY.md → FAIL (MANDATORY_KNOWLEDGE_MISSING) |
| 4.5  | attest `mistake_precautions` 含 SUMMARY.md → PASS                                 |
| 4.6  | 验证跨 session：Session A 读过 SUMMARY.md → Session B 不需要重读但 DB 记录仍有效  |

---

## §6 风险评估

| 风险                            | 影响                                                                     | 缓解                                                      |
| ------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| `knowledge_entries` UPDATE 遗漏 | `knowledge_cache_search("mistake_precautions")` 返回 0 结果              | Phase 4.2 验证                                            |
| `index.json` 与 DB 不同步       | 新条目在 DB 中搜索不到                                                   | `readManifest()` DB-first，验证即可                       |
| `@rule` 提取不完整              | SUMMARY.md 遗漏规则                                                      | 人工审核 + KC 流程内置校验                                |
| 旧 session attestation 残留     | `checkAllDomainsAttested` 检查到旧 `opencode_framework` 域仍有错题集要求 | 域拆出后 `opencode_framework` 的 mandatory 已清空，不影响 |
