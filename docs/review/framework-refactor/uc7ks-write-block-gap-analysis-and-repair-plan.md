# UC7KS Write-Block 缺口分析与修复计划

**生成日期**: 2026-06-19
**基于**: SA-STORAGE-LANDSCAPE-EXEC-001 → SA-STORAGE-IMPLEMENT-001 → SA-DIAG-DOMAIN-ATTEST-001 → SA-DIAG-WRITE-BLOCK-GAP-001 四次诊断派遣 + 后续讨论
**状态**: 修复计划（尚未实施）

---

## 一、背景

### 1.1 问题起源

SA-STORAGE-IMPLEMENT-001 执行时，@Super-Admin 对 .opencode/ 框架文件执行了 **9 次 safe_edit 写操作**（修改了 read-audit.ts、state-compactor.ts、compliance-gate.ts 等 6 个文件），但：

1. **未调用 resolve_domain_id** 自查 dispatch 分配的 domain ID
2. **从未调用 knowledge_cache_attest** 验证已读知识缓存
3. UC7-001 write-block 机制**未阻断**这些写入

### 1.2 诊断过程

| 步骤 | 派遣任务 | 发现 |
|:----:|----------|------|
| 1 | SA-STORAGE-LANDSCAPE-EXEC-001 | 全景图审查，read_audit Phase 1 一致性确认 |
| 2 | SA-STORAGE-IMPLEMENT-001 | 实施全景图计划（修改 6 个文件、删除 2 个文件） |
| 3 | SA-DIAG-DOMAIN-ATTEST-001 | 诊断 resolve_domain_id 和 knowledge_cache_attest 为何未调用 |
| 4 | SA-DIAG-WRITE-BLOCK-GAP-001 | 诊断 write-block 为何未生效 |
| 5 | 后续讨论 | 完善修复方案（所有域 attest、文件级 domain 检查、save_path 唯一性、agent 自主 cache 充分性判断） |

### 1.3 诊断结论摘要

checkUC7KSWrite() 的 **3-path 架构**中，Path A（有完整域数据）是唯一要求 attestation 的路径。但**域不匹配**导致检查落到 Path B/C，两者均不要求 attestation，形成了架构级绕过缺口。

---

## 二、根因分析

### 2.1 旁路链条

派遣分配 domain_id="state_management"（DB session_map）
       ↓
Agent 调用 module_scope_declare("opencode_framework")     ← 域不匹配
       ↓
Agent 调用 knowledge_cache_search("opencode_framework") → true
       ↓
Agent 写文件（9+ safe_edit）但从未调 knowledge_cache_attest
       ↓
checkUC7KSWrite(domainId="state_management")
       ↓
Path A: 按 "state_management" 找数据 → 找不到
       ↓
Path B Fix v3: uc7_001_compliant=true → "容忍域不匹配"
       ↓
Path C: uc7_001_compliant=true → PASS（无 attestation 要求！）
       ↓
❌ 9 次写操作全部通过

### 2.2 四层缺口

| 缺口 | 位置 | 描述 |
|:----:|------|------|
| **G1** | subagent-preamble.md Step 0a | resolve_domain_id 标注为"可选"注释，agent 跳过 |
| **G2** | Super-Admin.md mcp_tools | knowledge_cache_attest 从未注册到 agent config |
| **G3** | checkUC7KSWrite() Path C | 只检查全局 uc7_001_compliant 布尔，无 attestation 要求 |
| **G4** | checkUC7KSWrite() Path B Fix v3 | 任何 uc7_001_compliant=true 都允许 fallthrough |

### 2.3 域不匹配根因

| 来源 | 值 | 问题 |
|:-----|:----|:------|
| agent_domain_map（config） | Super-Admin → "opencode_framework" | ✅ 正确 |
| DB session_map.domain_id | "state_management" | ❌ 与 config 不一致 |
| module_scope_declare() 声明 | "opencode_framework" | ✅ 正确 |
| checkUC7KSWrite() 查的 | DB 的值 "state_management" | ❌ 过时快照 |

### 2.4 save_path 冲突

| domain_id | save_path | 问题 |
|:----------|:----------|:-----|
| opencode_framework | opencode/framework/ | ✅ |
| state_management | opencode/framework/ | ❌ **与 opencode_framework 完全相同** |

两个 domain 的 save_path 相同，文件级 domain 检查无法区分文件归属。

### 2.5 Agent 自主 cache 充分性判定缺失

knowledge_cache_search 的 sufficient/insufficient 判定是**纯机械的**——只看 index.json 有没有文件条目，不涉及任务语义。Agent **没有空间**在读了 cache 后根据任务理解判断"这些文件内容不够"。

```
有文件条目 → sufficient → "读文件，然后 attest"     ← Agent 不能质疑
无文件条目 → insufficient → "请求 KC 外部搜索"      ← 唯一触发外部搜索的路径
```

---

## 三、修复清单

### P0 — write-block 绕过级（必须立即修复）

| # | 文件 | 修改内容 | 对应缺口 |
|:-:|------|----------|:--------:|
| **M1** | .opencode/agents/Super-Admin.md | mcp_tools 添加 knowledge_cache_attest | G2 |
| **M2** | .opencode/subagent-preamble.md | Step 0b 后新增 **Step 0b+**：强制调用 knowledge_cache_attest() | G1（部分） |
| **M3** | .opencode/lib/uc7ks-utils.ts → checkUC7KSWrite() Path C | 遍历 session 所有 domain，**每个 domain 的 attestation.status === "attested"** 才放行写操作。strict/locked 模式阻断写，advisory 模式记录 WARNING 日志并放行 | G3 |
| **M11** | .opencode/lib/uc7ks-utils.ts → checkUC7KSWrite() | **新增文件级 domain 检查**：根据 filePath 匹配 save_path 找到目标 domain，若该 domain 无 attestation 则阻断写。防止"attest 域 A，写域 B 文件"的绕过 | G4（补充） |

### P1 — 域一致性 + 数据完整性

| # | 文件 | 修改内容 | 对应缺口 |
|:-:|------|----------|:--------:|
| **M4** | .opencode/tools/module_scope_declare.ts | 调用时同步更新 DB session_map.domain_id 为 agent 声明的值（**✅ 已完成**） | 域不匹配 |
| **M5** | .opencode/lib/uc7ks-utils.ts → Path B Fix v3 | 仅当 agent **已有 >=1 个 attested domain** 时才容忍域不匹配 | G4 |
| **M6** | .opencode/subagent-preamble.md | Step 0a：resolve_domain_id 从可选注释升级为**强制执行步骤** | G1 |
| **M7** | 所有 writable agent configs（Architect, Coder-BE, Coder-FE, CI-CD-Agent, Meta-Planner） | 审计 mcp_tools 是否包含 knowledge_cache_attest，缺失则添加 | G2（扩展） |
| **M12** | .opencode/project.config.json | knowledge_semantic_map.state_management.save_path 从 "opencode/framework/" 改为 **"opencode/state/"** | save_path 重叠 |
| **M13** | .opencode/scripts/framework-self-test.ts | 新增 Check：knowledge_semantic_map 中所有 domain 的 save_path **不得相同、不得互为前缀** | save_path 重叠 |

### P2 — 自动化质量门禁

| # | 文件 | 修改内容 |
|:-:|------|----------|
| **M8** | .opencode/scripts/framework-self-test.ts | 新增 Check：所有 writable agent 的 mcp_tools 已注册 knowledge_cache_attest |
| **M9** | .opencode/tools/knowledge_cache_attest.ts | 追加 cache_sufficient 字段 + insufficiency_reason 字段。当 agent 判断 cache 不足时，写入 attestation.status="insufficient"，阻断写操作（M3/M11 天然生效） |
| **M10** | 新建 .opencode/lib/critical-files.ts | 函数 getCriticalFilesForDomain(domain_id)：从 knowledge_semantic_map 拿 save_path → 匹配 index.json 中 files[].path.startsWith(save_path) → 返回文件列表 |
| **M14** | dispatch_subagent.ts + opencode.json | 扩展 dispatch_subagent 权限，允许所有子 agent 以 @Knowledge-Curator 为 target 直接派遣（无需回 Orchestrator 中转） |

---

## 四、M9 详细设计：Agent 自主 cache 充分性判定

### 4.1 设计目标

给 agent **自主空间**，让它在读了 cache 文件后，根据当前任务的具体需要判断"这些内容够不够"。

### 4.2 新增字段

knowledge_cache_attest 工具参数追加：

```
knowledge_cache_attest({
  domain,
  task_id,
  files_read,
  reason,
  content_summary,
  cache_sufficient: boolean,   // ← 新增：agent 自主判断
  insufficiency_reason: string // ← 新增：cache_sufficient=false 时必填
})
```

### 4.3 两种路径的完整流程

#### 路径 A：Cache 足够

```
知识缓存搜索完成
    ↓
Agent 读取 cache 文件
    ↓
Agent 判断：当前 cache 内容是否足以完成本任务？
    ↓
knowledge_cache_attest(cache_sufficient=true, insufficiency_reason: "...")
    ↓
工具验证 files_read 确实被读过 + content_summary 非空
    ↓
✅ attestation: { status: "attested", cache_sufficient: true }
    ↓
M3/M11 write-block: attestation.status === "attested" → PASS
    ↓
✅ 写操作放行
```

#### 路径 B：Cache 不足（自愈闭环）

```
知识缓存搜索完成
    ↓
Agent 读取 cache 文件
    ↓
Agent 判断：当前 cache 内容不足以完成本任务
    （例如：任务需要 NestJS Guard v11 模式，cache 只有 v10）
    ↓
knowledge_cache_attest(cache_sufficient=false, insufficiency_reason="...")
    ↓
工具写入 attestation: { status: "insufficient", cache_sufficient: false }
    ↓
M3/M11 write-block: attestation.status !== "attested" → ❌ BLOCK 写操作
    ↓
返回消息: "Cache self-declared insufficient. Dispatch @Knowledge-Curator
           to fetch missing docs, then re-attest."
    ↓
Agent 直接 dispatch_subagent(@Knowledge-Curator, ...)
    （无需回 Orchestrator 中转 — M14 扩展权限）
    ↓
KC 获取外部文档 → 更新 index.json + docs/official_docs/
    ↓
Agent 重新读取更新后的 cache 文件
    ↓
knowledge_cache_attest(cache_sufficient=true, insufficiency_reason="补充后已足够")
    ↓
✅ attestation: { status: "attested", cache_sufficient: true }
    ↓
✅ 写操作放行
```

### 4.4 循环防护

为防止 agent 无限重试（cache_sufficient=false → KC → 重读 → 还是不够 → 又 false → ...），加入重试上限：

```
knowledge_cache_state.tasks[taskId].domains[domainId].attestation = {
  retry_count: 2,
  max_retries: 3
}

每次 cache_sufficient=false → retry_count++
retry_count >= max_retries → 不再自动路由到 KC，
                        改为提示人工介入
```

### 4.5 与 M3/M11 的协作

无需额外阻断逻辑。M3（Path C 所有域 attest）和 M11（文件级 domain 检查）天然生效：

| attestation.status | M3/M11 行为 |
|:-----------------:|:-----------:|
| "attested" | ✅ 写操作放行 |
| "insufficient" | ❌ 阻断写操作 |
| undefined（未调 attest） | ❌ 阻断写操作 |

---

## 五、M10 详细说明：Critical File List 自动生成

### 原理

利用已有的两个数据源自动算出 domain 的关键文档清单，无需手动维护。

**数据源**：

- project.config.json → knowledge_semantic_map: domain_id + save_path
- docs/official_docs/index.json: entries[].files[].path

**算法**（伪代码）：

```
function getCriticalFilesForDomain(domain_id):
    save_path = knowledge_semantic_map.domains[domain_id].save_path
    return index.json.entries
        .filter(e => e.files.path.startsWith(save_path))
        .flatMap(e => e.files)
        .map(f => f.path)
        .distinct()
```

**可选增强**：cache_sufficient=true 时，额外对比 files_read 与 critical_files 的覆盖率，作为质量控制参考（非阻断性）。

### save_path 唯一性保证

M12 + M13 确保每个 domain 的 save_path 唯一且不重叠，否则文件级 domain 匹配会出错。

---

## 六、M14 详细说明：子 agent 直接派遣 @Knowledge-Curator

### 当前限制

dispatch_subagent 的权限描述限制为 @Orchestrator 和 @Super-Admin 可用。子 agent 发现自己 cache 不足时，必须回 Orchestrator 中转派遣 KC，流程冗长。

### 修改方案

| 文件 | 修改内容 |
|------|----------|
| opencode.json | dispatch_subagent 权限扩展为所有 agent 允许以 Knowledge-Curator 为 target |
| dispatch_subagent.ts | tool 描述 + 权限检查更新：非 @Orchestrator/@Super-Admin 仅允许 target Knowledge-Curator |
| 各 agent config mcp_tools | 添加 dispatch_subagent（如有缺失） |

### 安全约束

- 子 agent 只能 target @Knowledge-Curator，不能 target 其他 agent 类型
- @Super-Admin 保留 target 所有 agent 的权限
- 每次 dispatch 计入 session_log，可审计

---

## 七、M3 和 M11 的协作关系

### M3（Path C 所有域 attest）

```
checkUC7KSWrite(agent, mode, sessionId, taskId, domainId)
    ↓
Path C 模式（no per-domain data found）:
    遍历 sa.tasks[taskId].domains[]:
        每个 domain 的 attestation.status === "attested"?
            ├─ 全部 ✅ → PASS
            └─ 任一 ❌ → BLOCK
```

### M11（文件级 domain 检查）

```
checkUC7KSWrite() → 通过后
    ↓
额外检查: 被写文件的目标 domain 是否也有 attestation?
    从 filePath → 匹配 save_path → 找 domain_id → 检查 attestation
```

### 协作效果

| 场景 | 纯 M3 | M3 + M11 |
|:-----|:-----:|:--------:|
| 写了域 A 文件，域 A 已 attest | ✅ 通过 | ✅ 通过 |
| 写了域 B 文件，域 B 在状态中存在但未 attest | ❌ 阻断 | ❌ 阻断 |
| 写了域 B 文件，但域 B 在状态中完全没出现过 | ✅ **通过（绕过）** | ❌ **阻断** |

**M3 只能拦截"状态中存在但未 attest"的域，M11 拦截"状态中不存在"的域。两者缺一不可。**

---

## 八、修改文件总表

| P | 文件 | M# | 修改性质 |
|:-:|------|:--:|:--------:|
| **P0** | .opencode/agents/Super-Admin.md | M1 | 添加一行 |
| **P0** | .opencode/subagent-preamble.md | M2 | 新增一个步骤 |
| **P0** | .opencode/lib/uc7ks-utils.ts | M3, M11 | 修改 Path C 逻辑 + 新增文件级检查 |
| ✅ 已完成 | .opencode/tools/module_scope_declare.ts | M4 | 加 DB 同步（已实现） |
| P1 | .opencode/subagent-preamble.md | M6 | 升级为强制执行 |
| P1 | .opencode/agents/Architect.md | M7 | 审计 + 添加 |
| P1 | .opencode/agents/Coder-BE.md | M7 | 审计 + 添加 |
| P1 | .opencode/agents/Coder-FE.md | M7 | 审计 + 添加 |
| P1 | .opencode/agents/CI-CD-Agent.md | M7 | 审计 + 添加 |
| P1 | .opencode/agents/Meta-Planner.md | M7 | 审计 + 添加 |
| P1 | .opencode/project.config.json | M12 | 修改 save_path |
| P1 | .opencode/scripts/framework-self-test.ts | M13 | 新增 Check |
| P2 | .opencode/scripts/framework-self-test.ts | M8 | 新增 Check |
| P2 | .opencode/tools/knowledge_cache_attest.ts | M9 | 追加 cache_sufficient 字段 + insufficiency_reason 字段 |
| P2 | 新建 .opencode/lib/critical-files.ts | M10 | 新文件 |
| P2 | .opencode/lib/dispatch_subagent.ts + opencode.json | M14 | 扩展 dispatch 权限，子 agent 可派遣 KC |

**总计：4 个 P0 + 5 个 P1（M4 已完成）+ 4 个 P2 = 13 项待执行修改，涉及最多 13 个文件。**

---

## 九、相关文档

| 文档 | 用途 |
|------|------|
| storage-entity-landscape.md | 框架存储实体全景图 |
| uc7ks-write-block-root-cause.md | write-block 根因分析（先前诊断） |
| uc7ks-read-before-write-plan.md | UC7KS read-before-write 设计 |
| UC7KS-PIPELINE-STANDARD.md | UC7KS 知识获取管道标准 |
| enforcement-modes-standard.md | advisory/strict/locked 模式定义 |
| TEMPLATE_VARIABLE_STANDARD.md | 模板变量标准 |