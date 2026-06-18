# UC7-001 读后写约束加固 — 全面验收报告

**版本**: v1.0.0  
**日期**: 2026-06-18  
**验收人**: @Orchestrator  
**验收对象**: `docs/review/framework-refactor/uc7ks-read-before-write-plan.md` 实施结果  
**计划版本**: v1.1.0 (reviewed-revision)

---

## 执行摘要

本次验收对 SA 实施的 9 文件改动进行了**全量验证**，对照计划的 §7 最小验收标准 11 项。结果：

| 等级 | 数量 | 明细 |
|:---:|:----:|------|
| ✅ 通过 | 7 | C1, C2, C3, C4, C5, C6, C9 |
| ⚠️ 有条件通过 | 2 | C8 (tools 自动发现 OK，agent permissions 未更新), C10 (部分日志事件缺少) |
| ❌ 未通过 | 2 | C7 (write-audit-policy.ts 未创建), C11 (compliance-gate/self-test/preamble 未同步) |

**综合判定**: ⚠️ **条件通过** — 核心架构（discovery/attestation 分离、checkUC7KSWrite 双状态、isUC7KSWriteTarget、shell 解析）正确实现。需补完 C7 和 C11 后方可切换至 strict 模式。

---

## §1 验收标准逐项检查

### C1 ✅ knowledge_cache_search 不再生成伪证据

| 检查项 | 状态 |
|--------|:----:|
| `files_read` 从 index.json 自动填充 | ✅ **已修复** — 改为空数组 `files_read: []` |
| `reason` 自动生成可采信理由 | ✅ **已修复** — 改为 `"[DEPRECATED] Auto-generated from index.json — NOT authoritative"` |
| `content_summary` 自动生成摘要 | ✅ **已修复** — 同上 |
| 新字段 `discovery.discovered_files` | ✅ **已添加** — 替代 `files_read` |
| legacy 字段保留供展示 | ✅ 保留但标明 DEPRECATED |

**证据**: `knowledge_cache_search.ts` L175-189

```typescript
var sufficiency: CacheSufficiency = {
  status: cacheSufficient ? "sufficient" : "insufficient",
  reason: "[DEPRECATED] Auto-generated from index.json — NOT authoritative...",
  files_read: [],                              // ← 空数组
  content_summary: "[DEPRECATED] Auto-generated...",
  discovery: { status, missing_topics, discovered_files, discovered_at }, // ← 新
};
```

---

### C2 ✅ strict/locked 未 attest 必定阻断

| 场景 | 预期 | 实际 |
|------|:----:|:----:|
| discovery.sufficient + attestation.attested | PASS | ✅ |
| discovery.sufficient + attestation missing (undefined) | BLOCK | ✅ |
| discovery.sufficient + attestation.pending | BLOCK | ✅ |
| discovery.insufficient + attestation.attested | BLOCK: insufficient | ✅ |
| legacy_discovered_only + strict/locked | BLOCK: re-attest required | ✅ |

**关键代码** (`uc7ks-utils.ts` checkUC7KSWrite Path A):

```
├─ discovery insufficient → BLOCK (L240-255)
├─ advisory 模式 → legacy/warn 通过 (L259-281)
├─ strict/locked:
│   ├─ attestation missing → BLOCK (L287-301)
│   ├─ attestation.pending/skipped → BLOCK (L304-319)
│   ├─ legacy_discovered_only → BLOCK (L321-336)
│   └─ discovery.sufficient + attestation.attested → PASS (L340-348)
```

§2.7 要求：legacy 数据 strict/locked 不能隐式通过 — 已满足。

---

### C3 ✅ uc7ks-after.ts 不再自动写 sufficient

**证据** (`uc7ks-after.ts` L88-108):
```typescript
// Does NOT write cache_sufficiency.status=sufficient.
// Phase 0 (2026-06-18): Only records read metadata.
domainEntry.pipeline_status = "completed";
// NOTE: NOT auto-setting sufficient — attestation required
```

之前的行为：读取 `docs/official_docs/` 后自动写 `cache_sufficiency.status = "sufficient"` 并设置 `uc7_001_compliant = true`。现已停止。

---

### C4 ✅ isUC7KSWriteTarget 覆盖正确

| 路径 | 是否触发 UC7KS | 验证 |
|------|:--------------:|:----:|
| 业务源码 `.ts` | ✅ | `isSourceFile()` |
| `.opencode/plugins/*.ts` | ✅ | `startsWith(".opencode/")` |
| `.opencode/rules/*.md` | ✅ | `startsWith(".opencode/")` |
| `.opencode/state/*.json` | ✅ | `startsWith(".opencode/")` |
| `docs/review/*.md` | ✅ | `startsWith("docs/review/")` |
| `docs/design/*.md` | ✅ | `startsWith("docs/design/")` |
| `AGENTS.md` | ✅ | 精确匹配 |
| `contract.yaml` | ✅ | 精确匹配 |
| `opencode.json` | ✅ | 精确匹配 |

**代码** (`tool-scope.ts` L248-278)。

---

### C5 ✅ isUC7KSExcludedPath 排除正确

| 路径 | 是否跳过 UC7KS | 验证 |
|------|:--------------:|:----:|
| `.opencode/logs/runtime.log` | ✅ 排除 | `startsWith(".opencode/logs/")` |
| `node_modules/pkg/a.js` | ✅ 排除 | `startsWith("node_modules/")` |
| `.task_temp/T/HANDOVER.md` | ✅ 排除 | `startsWith(".task_temp/")` |
| `docs/official_docs/index.json` | ✅ 排除（KC 治理） | `startsWith("docs/official_docs/")` |

**代码** (`tool-scope.ts` L285-311)。

---

### C6 ✅ safe_shell 多路径解析 + 不可解析阻断

| 命令 | 解析结果 | 严格模式行为 |
|------|---------|:-----------:|
| `sed -i 's/x/y/' file.ts` | `["file.ts"]` parsed | ✅ 逐路径检查 |
| `sed -i.bak 's/x/y/' file.ts` | `["file.ts"]` parsed | ✅ |
| `cp src dst` | `["dst"]` parsed | ✅ |
| `mv src dst` | `["src","dst"]` parsed | ✅ |
| `dd if=a of=file.ts` | `["file.ts"]` parsed | ✅ |
| `node -e "fs.writeFileSync(...)"` | `[]` unparseable | ✅ BLOCK |
| `echo "x" >> file` | `[]` unparseable | ✅ BLOCK |
| `sh -c "sed ..."` | `[]` unparseable | ✅ BLOCK |
| `node script.ts` | read_only (no write) | ✅ 跳过 |
| `bun build.ts` | read_only (no write) | ✅ 跳过 |

**scope-before.ts L84-97**: strict/locked 下 `unparseable_modify_shell` 直接 BLOCK 并提示改用 `safe_edit`/`safe_mkdir`。

---

### ❌ C7: write-audit-policy.ts 未创建

**缺失项**: `write-audit-policy.ts` 未创建，`project.config.json` 未新增 `write_audit` 配置段。

**影响**: `audit-before.ts`、`audit-after.ts`、`write-audit-lib.ts` 仍使用硬编码路径/扩展名，未统一策略化。UC7KS 写前目标和 write audit 目标可能不一致。

**严重性**: 🟡 中 — 不影响核心 UC7KS 阻断逻辑，但可能导致 audit 遗漏某些框架文件写入的审计。

---

### ⚠️ C8: opencode.json 未更新 agent permissions

OpenCode 框架通过 `.opencode/tools/` 自动发现工具，无需在 `opencode.json` 注册工具列表。但以下 agent 需要能调用 `knowledge_cache_attest`：

| Agent | 是否配置了 attest 权限 | 状态 |
|-------|:---------------------:|:----:|
| @Coder-BE | ❌ 未配置 | ⚠️ 通过 dispatch_subagent 注入的 preamble 自动包含（如有） |
| @Coder-FE | ❌ 未配置 | 同上 |
| @Architect | ❌ 未配置 | 同上 |
| @Guardian | ❌ 未配置 | 同上 |
| @Meta-Planner | ❌ 未配置 | 同上 |
| @Orchestrator | ❌ 未配置 | 同上 |
| @Super-Admin | ❌ 未配置 | 同上 |

**实际影响**: 由于 `dispatch_subagent` 注入的 preamble 不会自动包含自定义工具的允许列表（`opencode.json` agent permissions 控制），agent 可能需要明确在 `opencode.json` permissions 或 `project.config.json` `agent_dispatch_allowed_tools` 中允许 `knowledge_cache_attest`，否则 agent 调用该工具时可能被权限系统阻止。

**严重性**: 🟡 中 — 工具会通过 `checkUC7KSWrite()` 阻断被阻塞的 agent，agent 会看到"调 knowledge_cache_attest"的提示但无法实际调用。

---

### C9 ✅ knowledge_cache_attest.ts 符合官方规范

| 规范项 | 符合性 |
|--------|:------:|
| `.opencode/tools/<name>.ts` 发现 | ✅ |
| `export default tool({...})` | ✅ |
| `execute(args, context)` | ✅ 含 `context.sessionID` |
| Zod schema (`tool.schema.string()`) | ✅ |
| `withInterruptGuard` | ✅ |
| 无 `console.log` | ✅ — 全部使用 `writeLog` |
| 完整 JSDoc | ✅ |

**5 步验证实现** (`knowledge_cache_attest.ts` L116-230):
1. ✅ 验证 `discovery.status === "sufficient"`
2. ✅ 验证 `files_read ⊆ discovered_files`
3. ✅ 验证 `read_audit.jsonl` 交叉验证 (`context.sessionID`)
4. ✅ 验证 `reason`/`content_summary` 非空
5. ✅ 写入 `attestation = {status:"attested", ...}`

---

### ⚠️ C10: writeLog 使用评估

| 新事件 | 定义 | 实际使用 |
|--------|:----:|:--------:|
| `UC7KS-ATTEST-PASS` | ✅ §4.1 | ✅ `knowledge_cache_attest.ts` |
| `UC7KS-ATTEST-FAIL-DISCOVERY` | ✅ §4.1 | ✅ |
| `UC7KS-ATTEST-FAIL-FILES` | ✅ §4.1 | ✅ |
| `UC7KS-ATTEST-FAIL-AUDIT` | ✅ §4.1 | ✅ |
| `UC7KS-ATTEST-FAIL-EMPTY` | ✅ §4.1 | ✅ |
| `UC7KS-ATTEST-FAIL-SESSION` | ✅ §4.1 | ✅ |
| `UC7KS-ATTEST-LEGACY-PENDING` | ✅ §4.1 | ❌ 未找到 |
| `UC7KS-WRITE-PASS-ATTESTED` | ✅ §4.1 | ✅ `uc7ks-utils.ts` L341 |
| `UC7KS-WRITE-BLOCK-ATTEST` | ✅ §4.1 | ✅ L289, L306 |
| `UC7KS-WRITE-BLOCK-DISCOVERY` | ✅ §4.1 | ✅ L241 |
| `UC7KS-WRITE-BLOCK-LEGACY` | ✅ §4.1 | ✅ L322 |
| `UC7KS-WRITE-BLOCK-UNPARSEABLE-SHELL` | ✅ §4.1 | ✅ `scope-before.ts` L90 |
| `UC7KS-SA-EMERGENCY-BYPASS` | ✅ §4.1 | ❌ 未找到（当前 SA bypass 只有通用日志） |

**严重性**: 🟢 低 — 13 个事件中 11 个已实现，2 个缺失但不影响核心功能。

---

### ❌ C11: compliance-gate / self-test / preamble / search-knowledge 未同步

| 文件 | §7 要求 | 状态 |
|------|---------|:----:|
| `compliance-gate.ts` | pipeline 完成检查使用 `discovery/attestation` | ❌ 仍使用 legacy `cache_sufficiency` |
| `framework-self-test.ts` | Check 29 新工具 + Check 35 检测 legacy pseudo evidence | ⚠️ Check 29 存在但未验证新增 `knowledge_cache_attest`；Check 35 仍检查旧字段 |
| `subagent-preamble.md` | Step 0 改为 search → read → attest | ❌ 未更新（仍为"search 即证据完整"） |
| `search-knowledge.md` | `files_read` → `discovered_files` | ❌ 未更新 |
| Agent 配置 | 补充 `knowledge_cache_attest` 调用说明 | ❌ 未更新 |

**严重性**: 🔴 高 — 虽然核心阻断逻辑正确，但这些同步的缺失意味着：
1. agent 不知道 attest 工具的存在（preamble 未改）
2. self-test 不会捕捉新的伪证据
3. compliance-gate 不会验证 attestation 状态

---

## §2 综合评估矩阵

| §7 标准 | 状态 | 备注 |
|:-------:|:----:|------|
| 1. search 不再生成伪证据 | ✅ 通过 | |
| 2. strict/locked 未 attest 必阻断 | ✅ 通过 | |
| 3. uc7ks-after 不自动 sufficient | ✅ 通过 | |
| 4. 受保护对象覆盖完整 | ✅ 通过 | |
| 5. 排除目录正确 | ✅ 通过 | |
| 6. safe_shell 解析+阻断 | ✅ 通过 | |
| 7. write_audit 策略配置 | ❌ 未实现 | 需补 write-audit-policy.ts + project.config.json |
| 8. opencode.json 权限权威 | ⚠️ 未更新 | tools 自动发现 OK，agent permissions 未改 |
| 9. 新工具符合规范 | ✅ 通过 | |
| 10. writeLog 诊断 | ⚠️ 2 事件缺失 | UC7KS-ATTEST-LEGACY-PENDING, UC7KS-SA-EMERGENCY-BYPASS |
| 11. compliance-gate/self-test/preamble/search-knowledge 同步 | ❌ 未更新 | 4 个文件需同步 |

### 优先级建议

| 优先级 | 项目 | 工作量 |
|:------:|------|:-------:|
| **🔴 P0** | 更新 preamble 和 agent 配置（让 agent 知道 attest 工具） | ~30 分钟 |
| **🔴 P0** | 同步 compliance-gate.ts attestation 状态检查 | ~20 分钟 |
| **🟡 P1** | 更新 framework-self-test.ts Check 29/35 | ~30 分钟 |
| **🟡 P1** | 创建 write-audit-policy.ts + project.config.json write_audit | ~1 小时 |
| **🟢 P2** | 补充缺失日志事件 + 更新 search-knowledge.md | ~20 分钟 |
| **🟢 P2** | 更新 opencode.json agent permissions | ~10 分钟 |
