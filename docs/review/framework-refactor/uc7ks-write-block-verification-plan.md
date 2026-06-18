# UC7KS Write-Block 全场景验证方案

**版本**: v1.0.0
**生成日期**: 2026-06-19
**基于**: [uc7ks-write-block-gap-analysis-and-repair-plan.md](./uc7ks-write-block-gap-analysis-and-repair-plan.md)
**状态**: 验证方案（尚未执行）
**制定者**: @Architect (ARCH-VERIFICATION-PLAN-001)

---

## 一、概述

### 1.1 目的

本方案为 [UC7KS Write-Block 缺口分析与修复计划](./uc7ks-write-block-gap-analysis-and-repair-plan.md) 中定义的 **14 个修复项 (M1–M14)** 提供全场景验证用例。每个修复项的验证覆盖四个维度：

| 维度 | 标识 | 描述 |
|:----:|:----:|------|
| **成功路径** | ✅ | 修复生效，预期行为正确发生 |
| **失败路径** | ❌ | 异常条件触发，修复正确阻断/拒绝 |
| **边界条件** | 🧪 | 空状态、极限值、域不匹配、重试上限等 |
| **并发场景** | 🔀 | 多 agent 同时操作、竞态条件 |

### 1.2 验证优先级

```
Phase 1 ─── P0 项 (M1, M2, M3, M11)  ← write-block 绕过级，必须最先验证
Phase 2 ─── P1 项 (M5, M6, M7, M12, M13)  ← 域一致性 + 数据完整性
Phase 3 ─── P2 项 (M8, M9, M10, M14)  ← 自动化质量门禁
Phase 4 ─── 回归验证 (M4 已完成)  ← 确认已完成修改未退化
```

### 1.3 验证环境要求

| 条件 | 值 | 说明 |
|:-----|:---|:-----|
| Enforcement Mode | `strict` | 必须严格模式才能触发阻断行为 |
| Test Agent | @Super-Admin + @Coder-BE | 覆盖高权限和普通 writable agent |
| 预置域状态 | 2+ domain 有 attestation、1+ domain 无 attestation | 测试 Path C 分支 |
| pre-commit hook | 已安装 | 验证 keystone hash 同步 |

---

## 二、P0 修复项验证 (Write-Block 绕过级)

### M1: Super-Admin.md mcp_tools 添加 knowledge_cache_attest

**修改描述**: 在 `.opencode/agents/Super-Admin.md` 的 `mcp_tools` 列表中添加 `knowledge_cache_attest`。

**对应缺口**: G2 — Super-Admin 从未注册 knowledge_cache_attest 工具

---

#### M1-V1 ✅ 成功路径 — Super-Admin 可调用 knowledge_cache_attest

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M1 已实施<br>2. `opencode.json` 中 Super-Admin 具有 `knowledge_cache_attest: allow` 权限 |
| **操作** | Super-Admin 在任务中调用 `knowledge_cache_attest(domain, task_id, reason, files_read, content_summary)` |
| **预期结果** | 1. 工具调用成功，返回 attestation 确认<br>2. `machine.json.knowledge_cache_state.tasks[taskId].domains[domainId].attestation.status === "attested"` |
| **验证方式** | 派遣 @Super-Admin 执行一次完整的 knowledge_cache_attest 调用，检查 machine.json 状态写入 |

---

#### M1-V2 ❌ 失败路径 — Super-Admin 调用但 files_read 验证失败

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M1 已实施<br>2. Super-Admin 未实际读取声明的 files_read 中的文件 |
| **操作** | Super-Admin 调用 `knowledge_cache_attest` 但 files_read 中的文件未被 read_audit 记录 |
| **预期结果** | attestation 被拒绝，工具返回错误信息指示 agent 需先读取文件 |
| **验证方式** | 派遣 @Super-Admin 提供一个从未 read 过的文件路径，验证工具拒绝 |

---

#### M1-V3 🧪 边界条件 — 空 files_read 数组

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M1 已实施 |
| **操作** | `knowledge_cache_attest({ domain: "opencode_framework", files_read: [], reason: "...", content_summary: "..." })` |
| **预期结果** | 工具拒绝/警告：空 files_read 数组不允许 |
| **验证方式** | 直接调用验证参数校验 |

---

### M2: subagent-preamble.md Step 0b+ 强制 knowledge_cache_attest

**修改描述**: 在 `subagent-preamble.md` Step 0b (knowledge_cache_search) 之后新增 **Step 0b+**，强制要求调用 `knowledge_cache_attest()`。

**对应缺口**: G1（部分）— resolve_domain_id 标注为"可选"导致 agent 跳过

---

#### M2-V1 ✅ 成功路径 — Agent 遵循 preamble 调用 attest

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M2 已实施<br>2. preamble Step 0b+ 包含强制 attest 步骤 |
| **操作** | 派遣 @Coder-BE 执行任何需要写入文件的任务 |
| **预期结果** | 1. Agent 在 Step 0b 调用 knowledge_cache_search 后<br>2. Agent 在 Step 0b+ 调用 knowledge_cache_attest<br>3. 写操作不被阻断 |
| **验证方式** | 检查 sub-agent 的 dispatch output + machine.json 的 uc7_001_records |

---

#### M2-V2 ❌ 失败路径 — Agent 跳过 Step 0b+ 尝试写入

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M2 + M3 + M11 均已实施<br>2. enforcement_mode = strict |
| **操作** | Agent 调用 knowledge_cache_search 后直接写文件，跳过 attest |
| **预期结果** | 写操作被 M3 / M11 阻断：[FW-ENFORCE][UC7-001] BLOCKED |
| **验证方式** | 直接测试：跳过 attest 后尝试 safe_edit → 预期返回错误 |

---

#### M2-V3 🔀 并发场景 — 两个 sub-agent 同时 attest 不同 domain

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M2 已实施 |
| **操作** | Sub-agent A attest domain_a，Sub-agent B 同时 attest domain_b |
| **预期结果** | 两个 attestation 互不干扰，machine.json 正确写入两个 domain 的状态 |
| **验证方式** | 并发派遣两个 agent，检查 machine.json 的 domains 字段完整性 |

---

### M3: checkUC7KSWrite() Path C 遍历所有 domain

**修改描述**: 修改 `uc7ks-utils.ts` 的 `checkUC7KSWrite()` Path C 逻辑：遍历 session 所有 domain，**每个 domain 的 attestation.status === "attested"** 才放行写操作。

**对应缺口**: G3 — Path C 只检查全局 uc7_001_compliant 布尔，无 attestation 要求

---

#### M3-V1 ✅ 成功路径 — 所有 domain 均已 attest

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M3 已实施<br>2. enforcement_mode = strict<br>3. session 有 2 个 domain (domain_a, domain_b)<br>4. 两个 domain 均已 attest (status="attested") |
| **操作** | Agent 执行 safe_edit 写入文件 |
| **预期结果** | checkUC7KSWrite() Path C 遍历两个 domain → 全部 attest ✅ → PASS → 写操作放行 |
| **验证方式** | 派遣 agent，预先为两个 domain attest，然后写文件 → 预期成功 |

---

#### M3-V2 ❌ 失败路径 — 至少一个 domain 未 attest

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M3 已实施<br>2. enforcement_mode = strict<br>3. session 有 2 个 domain，仅 domain_a 已 attest，domain_b 未 attest |
| **操作** | Agent 执行 safe_edit 写入文件 |
| **预期结果** | checkUC7KSWrite() Path C 遍历 → domain_b attestation 缺失 → ❌ BLOCK |
| **验证方式** | 派遣 agent，只 attest 一个 domain，然后尝试写文件 → 预期被阻断 |

---

#### M3-V3 ❌ 失败路径 — 某个 domain attestation.status = "insufficient" (M9)

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M3 + M9 均已实施<br>2. enforcement_mode = strict<br>3. domain_a attestation.status = "insufficient" |
| **操作** | Agent 尝试写入任何文件 |
| **预期结果** | M3 检查 "insufficient" ≠ "attested" → ❌ BLOCK |
| **验证方式** | Agent 调用 knowledge_cache_attest(cache_sufficient=false) → 然后尝试写文件 → 预期阻断 |

---

#### M3-V4 🧪 边界条件 — session 无任何 domain

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M3 已实施<br>2. enforcement_mode = strict<br>3. session 的 domains 对象为空 `{}` |
| **操作** | Agent 执行写操作 |
| **预期结果** | 空 domains → 无任何 "attested" → ❌ BLOCK（保守策略：没有任何 attestation 就不放行） |
| **验证方式** | 派遣 agent 跳过 module_scope_declare 和 knowledge_cache_search → 直接写文件 → 预期阻断 |

---

#### M3-V5 🧪 边界条件 — advisory 模式行为

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M3 已实施<br>2. enforcement_mode = advisory<br>3. domain_a 未 attest |
| **操作** | Agent 执行写操作 |
| **预期结果** | 记录 WARNING 日志 `[UC7-001][ADVISORY]`，但写操作放行 |
| **验证方式** | 切换为 advisory 模式 → 未 attest 时写文件 → 检查日志有 WARNING 但文件写入成功 |

---

#### M3-V6 🧪 边界条件 — locked 模式额外约束

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M3 已实施<br>2. enforcement_mode = locked<br>3. domain_a 未 attest |
| **操作** | Agent 执行写操作 |
| **预期结果** | ❌ BLOCK，且不接受任何 waiver |
| **验证方式** | 切换为 locked 模式 → 未 attest 时写文件 → 预期阻断 + 错误消息明确 |

---

#### M3-V7 🔀 并发场景 — 多个 agent 并发 attest

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M3 已实施，enforcement_mode = strict |
| **操作** | Agent A 正在执行 checkUC7KSWrite() 时，Agent B 同时为 domain_x 写入 attestation |
| **预期结果** | Agent A 的检查使用当前快照，不因 Agent B 的并发写入而崩溃；最终一致性保证 |
| **验证方式** | 并发派遣两个 agent → 一个写文件，另一个同时 attest → 检查无 crash 和状态一致性 |

---

### M11: 文件级 domain 检查

**修改描述**: checkUC7KSWrite() 新增文件级 domain 检查：根据 filePath 匹配 save_path 找到目标 domain，若该 domain 无 attestation 则阻断写。

**对应缺口**: G4（补充）— 防止"attest 域 A，写域 B 文件"的绕过

---

#### M11-V1 ✅ 成功路径 — 文件目标 domain 已 attest

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M11 已实施<br>2. enforcement_mode = strict<br>3. domain_a.save_path = "opencode/" → 文件路径 `docs/official_docs/opencode/foo.md` 匹配 domain_a<br>4. domain_a 已 attest |
| **操作** | Agent 写文件 `docs/official_docs/opencode/foo.md` |
| **预期结果** | M11 匹配 domain_a → domain_a 已 attest → ✅ PASS |
| **验证方式** | 派遣 agent 写入匹配已 attest domain 的文件路径 → 成功 |

---

#### M11-V2 ❌ 失败路径 — 文件目标 domain 未 attest（绕过检测）

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M11 已实施<br>2. enforcement_mode = strict<br>3. domain_a 已 attest | 4. domain_b 未 attest<br>5. 文件路径匹配 domain_b.save_path |
| **操作** | Agent 只 attest 了 domain_a，但尝试写匹配 domain_b 的文件 |
| **预期结果** | M11 匹配 domain_b → domain_b 未 attest → ❌ BLOCK |
| **验证方式** | 派遣 agent，只 attest domain_a，写 domain_b 文件 → 预期阻断 |

---

#### M11-V3 ❌ 失败路径 — 文件目标 domain 在状态中完全不存在

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M11 已实施<br>2. enforcement_mode = strict<br>3. session 的 domains 中没有 domain_b<br>4. 文件路径匹配 domain_b.save_path |
| **操作** | Agent 写文件到 domain_b.save_path 对应路径 |
| **预期结果** | M11 匹配 domain_b → domain_b 在状态中不存在 → ❌ BLOCK<br>**关键**：这是 M3 无法覆盖的场景，M11 独立拦截 |
| **验证方式** | 派遣 agent 直接写文件到未声明的 domain 路径 → 预期阻断 |

---

#### M11-V4 🧪 边界条件 — 文件路径不匹配任何 save_path

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M11 已实施<br>2. enforcement_mode = strict<br>3. 文件路径为 `/tmp/random-file.log`，不匹配任何 domain.save_path |
| **操作** | Agent 写文件到 `/tmp/random-file.log` |
| **预期结果** | M11 无法匹配任何 domain → 保守策略：不阻断（因为不是知识域文件）或阻断（取决于实现策略） |
| **验证方式** | 根据实现策略验证：若允许非知识域写入，则应通过；若严格模式拒绝未知路径，则阻断 |

---

#### M11-V5 🧪 边界条件 — save_path 重叠（M12/M13 修复前）

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M11 已实施但 M12/M13 未实施<br>2. domain_a.save_path = "opencode/framework/"<br>3. domain_b.save_path = "opencode/framework/" (重叠!) |
| **操作** | Agent 写文件到 `docs/official_docs/opencode/framework/foo.md`，域 A 已 attest，域 B 未 attest |
| **预期结果** | 两个 save_path 都匹配 → 需要明确策略：任一个匹配 attest 就放行？还是全部匹配都需 attest？<br>**若策略不明确 → 此为边界问题** |
| **验证方式** | 在 M12/M13 修复前，测试重叠场景 → 验证 M11 的匹配顺序/优先级策略是否正确 |

---

#### M11-V6 🧪 边界条件 — 目录级匹配 vs 文件级匹配

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M11 已实施 |
| **操作** | 1. 写 `docs/official_docs/opencode/framework/file.md`（精确子目录）<br>2. 写 `docs/official_docs/opencode/`（目录本身）|
| **预期结果** | 精确子目录匹配 domain；目录本身操作不受文件级检查影响 |
| **验证方式** | 测试文件写入 vs 目录创建的不同行为 |

---

## 三、P1 修复项验证 (域一致性 + 数据完整性)

### M4: module_scope_declare 同步更新 DB session_map (✅ 已完成 — 回归验证)

**修改描述**: module_scope_declare 调用时同步更新 DB session_map.domain_id 为 agent 声明的值。

**对应缺口**: 域不匹配（DB session_map 与 agent 声明的 domain 不一致）

**状态**: ✅ 已完成

---

#### M4-R1 ✅ 回归验证 — module_scope_declare 后 DB 已同步

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M4 已实施 |
| **操作** | 1. 派遣 agent，dispatch 分配 domain_id = "state_management"<br>2. Agent 调用 `module_scope_declare("opencode_framework")`<br>3. 查询 DB session_map 中该 session 的 domain_id |
| **预期结果** | DB session_map.domain_id 已更新为 "opencode_framework"（agent 声明的值） |
| **验证方式** | SQL 查询 session_log DB 的 session_map 表 |

---

#### M4-R2 ✅ 回归验证 — checkUC7KSWrite 使用更新后的 domain

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M4 已实施 |
| **操作** | Agent 声明 "opencode_framework" → 随后 attest "opencode_framework" → 写文件 |
| **预期结果** | checkUC7KSWrite() 查到的 domain_id 与 agent 声明的 "opencode_framework" 一致，attestation 匹配 → ✅ PASS |
| **验证方式** | 派遣 agent 执行完整 UC7KS 流程 → 验证写操作不被阻断 |

---

#### M4-R3 ❌ 回归验证 — 域不匹配不应再出现

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M4 已实施 |
| **操作** | 模拟 SA-STORAGE-IMPLEMENT-001 场景：dispatch domain = "state_management"，agent 声明 "opencode_framework" |
| **预期结果** | module_scope_declare 将 DB 值同步为 "opencode_framework"，后续 checkUC7KSWrite 看到一致的 domain_id |
| **验证方式** | 复查原始诊断场景 → 确认不再重现旁路链条 |

---

### M5: Path B Fix v3 — 仅当已有 >=1 attested domain 时容忍域不匹配

**修改描述**: 修改 uc7ks-utils.ts Path B Fix v3 逻辑：仅当 agent **已有 >=1 个 attested domain** 时才容忍域不匹配。

**对应缺口**: G4 — 任何 uc7_001_compliant=true 都允许 fallthrough

---

#### M5-V1 ✅ 成功路径 — 有 1 个 attested domain 时域不匹配被容忍

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M5 已实施<br>2. enforcement_mode = strict<br>3. domain_a 已 attest (status="attested")<br>4. checkUC7KSWrite 传入 domainId="state_management" 但 domain_a 是 "opencode_framework" |
| **操作** | Agent 写文件 |
| **预期结果** | Path B 检测到 >=1 attested domain → 容忍域不匹配 → ✅ PASS |
| **验证方式** | 派遣 agent，attest domain_a，用 domainId="state_management" 触发 Path B → 验证通过 |

---

#### M5-V2 ❌ 失败路径 — 0 个 attested domain 时域不匹配被拒绝

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M5 已实施<br>2. enforcement_mode = strict<br>3. 没有任何 domain 被 attest<br>4. checkUC7KSWrite 传入 domainId="state_management" |
| **操作** | Agent 写文件 |
| **预期结果** | Path B 检测到 0 个 attested domain → 不容忍域不匹配 → ❌ BLOCK |
| **验证方式** | 派遣 agent，不调用 attest，直接写文件 → 预期阻断 |

---

#### M5-V3 🧪 边界条件 — 有 attested domain 但状态为 "insufficient" (M9)

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M5 + M9 已实施<br>2. domain_a attestation.status = "insufficient"<br>3. checkUC7KSWrite 传入不同的 domainId |
| **操作** | Agent 写文件 |
| **预期结果** | "insufficient" ≠ "attested" → 计数为 0 → 域不匹配被拒绝 → ❌ BLOCK |
| **验证方式** | Agent self-declare insufficient → 尝试写文件 → 预期阻断 |

---

### M6: subagent-preamble.md Step 0a — resolve_domain_id 升级为强制执行

**修改描述**: Step 0a 的 resolve_domain_id 从可选注释升级为**强制执行步骤**。

**对应缺口**: G1 — resolve_domain_id 标注为"可选"，agent 跳过

---

#### M6-V1 ✅ 成功路径 — Agent 必须调用 resolve_domain_id

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M6 已实施 |
| **操作** | 派遣任何 writable agent 执行任务 |
| **预期结果** | 1. Agent 在 Step 0a 调用 `resolve_domain_id()`<br>2. 获得 dispatch 分配的 domain_id<br>3. 用该 domain_id 调用 `module_scope_declare` |
| **验证方式** | 检查 dispatch output → 确认包含 resolve_domain_id 调用记录 |

---

#### M6-V2 ❌ 失败路径 — Agent 跳过 Step 0a 直接声明

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M6 已实施<br>2. enforcement_mode = strict |
| **操作** | Agent 跳过 resolve_domain_id，直接调用 module_scope_declare 使用错误的 domain |
| **预期结果** | 1. uc7ks-enforcer 插件在 pre-execution 阶段检测到缺少 resolve_domain_id 调用<br>2. 阻断后续写操作或记录违规 |
| **验证方式** | 派遣 agent 跳过 Step 0a → 验证 pre-execution hook 是否检测到 |

---

### M7: 审计所有 writable agent configs 的 knowledge_cache_attest 注册

**修改描述**: 审计 Architect, Coder-BE, Coder-FE, CI-CD-Agent, Meta-Planner 的 mcp_tools 是否包含 knowledge_cache_attest，缺失则添加。

**对应缺口**: G2（扩展）— 多个 agent 缺少 knowledge_cache_attest 注册

---

#### M7-V1 ✅ 验证路径 — 所有 writable agent 均已注册

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M7 已实施 |
| **操作** | 检查以下 agent config 的 `mcp_tools` 列表 |
| **预期结果** | 以下 agent 均包含 `knowledge_cache_attest`：<br>• Architect ✅<br>• Coder-BE ✅<br>• Coder-FE ✅<br>• CI-CD-Agent ✅<br>• Meta-Planner ✅<br>• Super-Admin ✅ (M1) |
| **验证方式** | `grep knowledge_cache_attest .opencode/agents/*.md` |

---

#### M7-V2 ❌ 失败路径 — 某 agent 缺少注册时的行为

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M7 未完全实施（故意遗漏一个 agent） |
| **操作** | 派遣该 agent 执行需要 attest 的任务 |
| **预期结果** | Agent 无法调用 knowledge_cache_attest → 写操作被 M3/M11 阻断 |
| **验证方式** | 移除某个 agent 的 mcp_tools 中的 knowledge_cache_attest → 派遣 → 验证阻断 |

---

#### M7-V3 🧪 边界条件 — Guardian/Arbiter 等非 writable agent

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M7 已实施 |
| **操作** | 检查 Guardian, Arbiter, Orchestrator, Meta-Planner 的 mcp_tools |
| **预期结果** | Guardian/Arbiter（审查角色，不写业务代码）不需要 knowledge_cache_attest；Orchestrator（调度角色）不需要<br>Meta-Planner（writable 因为修改 DAG）需要 |
| **验证方式** | 按角色职责分类检查：writable 角色有，read-only 角色无 |

---

### M12: 修改 knowledge_semantic_map state_management.save_path

**修改描述**: `project.config.json` 中 `knowledge_semantic_map.state_management.save_path` 从 `"opencode/framework/"` 改为 `"opencode/state/"`。

**对应缺口**: save_path 重叠（state_management 和 opencode_framework 共用 save_path）

---

#### M12-V1 ✅ 验证路径 — save_path 不再重叠

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M12 已实施<br>2. M13 已实施（save_path 唯一性检查） |
| **操作** | 1. 检查 `project.config.json` → `knowledge_semantic_map.state_management.save_path = "opencode/state/"`<br>2. 运行 `framework-self-test.ts` Check 13 (M13) |
| **预期结果** | 1. state_management.save_path = "opencode/state/"<br>2. opencode_framework.save_path = "opencode/framework/"<br>3. 两者不同且不互为前缀<br>4. Check 13 PASS |
| **验证方式** | 直接读取 project.config.json + 运行 framework-self-test |

---

#### M12-V2 🧪 边界条件 — 文件级 domain 匹配验证

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M12 已实施，M11 已实施 |
| **操作** | 1. 写文件到 `docs/official_docs/opencode/state/machine.json`<br>2. 写文件到 `docs/official_docs/opencode/framework/foo.md` |
| **预期结果** | 第一个文件正确匹配 state_management domain<br>第二个文件正确匹配 opencode_framework domain<br>两个 domain 不再产生误匹配 |
| **验证方式** | 派遣 agent 分别写入两个路径 → 验证 M11 各匹配正确的 domain |

---

### M13: framework-self-test.ts 新增 save_path 唯一性检查

**修改描述**: 新增 Check：knowledge_semantic_map 中所有 domain 的 save_path **不得相同、不得互为前缀**。

**对应缺口**: save_path 重叠

---

#### M13-V1 ✅ 验证路径 — Check 在正常配置下 PASS

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M12 + M13 已实施 |
| **操作** | 运行 `bun .opencode/scripts/framework-self-test.ts` |
| **预期结果** | 新增的 save_path 唯一性检查 PASS（所有 save_path 唯一且不互为前缀） |
| **验证方式** | 运行 self-test，检查新增 Check 的输出 |

---

#### M13-V2 ❌ 验证路径 — Check 在重叠配置下 FAIL

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M13 已实施，故意不实施 M12（保留重叠状态） |
| **操作** | 运行 `bun .opencode/scripts/framework-self-test.ts` |
| **预期结果** | 新增 Check FAIL → 检测到 "opencode/framework/" 被多个 domain 使用 → 输出冲突的 domain 列表 |
| **验证方式** | 回退 M12 修改 → 运行 self-test → 验证 Check 正确报错 |

---

#### M13-V3 🧪 边界条件 — 前缀关系检测

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M13 已实施，domains 配置 save_path 为 "opencode/" 和 "opencode/framework/"（前缀关系） |
| **操作** | 运行 framework-self-test |
| **预期结果** | Check FAIL → 检测到前缀冲突 → 输出例如 "opencode/framework/ is prefixed by opencode/" |
| **验证方式** | 构造前缀冲突配置 → 运行 self-test → 验证检测能力 |

---

#### M13-V4 🧪 边界条件 — 完全相同的 save_path

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M13 已实施，两个 domain 使用完全相同的 save_path |
| **操作** | 运行 framework-self-test |
| **预期结果** | Check FAIL → 检测到完全相同路径 → 输出冲突的 domain 列表 |
| **验证方式** | 构造相同路径配置 → 运行 self-test |

---

## 四、P2 修复项验证 (自动化质量门禁)

### M8: framework-self-test.ts 新增 knowledge_cache_attest 注册检查

**修改描述**: 新增 Check：所有 writable agent 的 mcp_tools 已注册 knowledge_cache_attest。

---

#### M8-V1 ✅ 验证路径 — 全部 agent 已注册时 PASS

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M1 + M7 + M8 已实施 |
| **操作** | 运行 `bun .opencode/scripts/framework-self-test.ts` |
| **预期结果** | 新增 Check PASS：Architect, Coder-BE, Coder-FE, CI-CD-Agent, Meta-Planner, Super-Admin 均已注册 knowledge_cache_attest |
| **验证方式** | 运行 self-test |

---

#### M8-V2 ❌ 验证路径 — 检测到缺失时 FAIL

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M8 已实施，从 Coder-BE.md 中移除 knowledge_cache_attest |
| **操作** | 运行 framework-self-test |
| **预期结果** | Check FAIL → 输出 "Coder-BE: missing knowledge_cache_attest in mcp_tools" |
| **验证方式** | 移除一个 agent 的注册 → 运行 self-test → 验证检测 |

---

#### M8-V3 🧪 边界条件 — 新增 agent 的自动检测

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M8 已实施 |
| **操作** | 新增一个 writable agent config（如 Coder-Mobile），未注册 knowledge_cache_attest |
| **预期结果** | self-test Check 自动检测新 agent 缺失注册 |
| **验证方式** | 创建新 agent config → 运行 self-test → 验证被检测到 |

---

### M9: knowledge_cache_attest 追加 cache_sufficient 字段

**修改描述**: knowledge_cache_attest 工具参数追加 `cache_sufficient: boolean` + `insufficiency_reason: string` 字段。

---

#### M9-V1 ✅ 成功路径 (路径 A) — cache_sufficient=true

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M9 已实施<br>2. enforcement_mode = strict |
| **操作** | Agent 读取 cache 文件后调用：<br>`knowledge_cache_attest({ domain, task_id, reason, files_read, content_summary, cache_sufficient: true })` |
| **预期结果** | 1. attestation.status = "attested"<br>2. attestation.cache_sufficient = true<br>3. 写操作放行 |
| **验证方式** | 派遣 agent 执行完整流程 → 验证 machine.json 中的 attestation 记录 |

---

#### M9-V2 ❌ 成功路径 (路径 B) — cache_sufficient=false 触发自愈

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M9, M3, M11, M14 均已实施<br>2. enforcement_mode = strict<br>3. cache 内容不足以完成任务 |
| **操作** | Agent 调用 `knowledge_cache_attest({ cache_sufficient: false, insufficiency_reason: "需要 NestJS Guard v11 模式但 cache 只有 v10" })` |
| **预期结果** | 1. attestation.status = "insufficient"<br>2. attestation.cache_sufficient = false<br>3. 写操作被 M3/M11 阻断<br>4. 返回消息指示 dispatch @Knowledge-Curator<br>5. Agent 直接 dispatch_subagent(@Knowledge-Curator) (M14) |
| **验证方式** | Agent 故意声明 cache 不足 → 验证写操作阻断 → 验证 KC 派遣 → 验证重读后 attest 成功 |

---

#### M9-V3 ❌ 失败路径 — cache_sufficient=false 但未提供 insufficiency_reason

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M9 已实施 |
| **操作** | `knowledge_cache_attest({ cache_sufficient: false })` — 未提供 insufficiency_reason |
| **预期结果** | 工具拒绝：`insufficiency_reason` 为必填字段（当 cache_sufficient=false 时） |
| **验证方式** | 直接调用验证参数校验 |

---

#### M9-V4 🧪 边界条件 — 重试上限 (max_retries: 3)

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M9 已实施 |
| **操作** | 连续 4 次调用 `knowledge_cache_attest({ cache_sufficient: false, ... })` |
| **预期结果** | 1. 第 1-3 次：正常返回 insufficiency，允许重试<br>2. 第 4 次：retry_count >= max_retries → 拒绝自动路由 → 提示人工介入 |
| **验证方式** | 循环调用 attest(insufficient) → 验证第 4 次的行为 |

---

#### M9-V5 🧪 边界条件 — cache_sufficient 从 false 切换到 true

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M9 已实施 |
| **操作** | 1. Agent 首次 attest(cache_sufficient=false)<br>2. KC 获取文档 → Agent 重读<br>3. Agent 重新 attest(cache_sufficient=true) |
| **预期结果** | 1. 首次 attestation.status = "insufficient" → 写阻断<br>2. 重读后 attestation.status 更新为 "attested" → 写放行 |
| **验证方式** | 模拟完整自愈闭环 |

---

#### M9-V6 🔀 并发场景 — 两个 agent 同时 attest 同一 domain 不同值

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M9 已实施 |
| **操作** | Agent A 和 Agent B 对同一 domain 同时调用 attest → A 说 sufficient=true，B 说 sufficient=false |
| **预期结果** | 后写入的值覆盖前者（Last-Write-Wins 语义），但两者不应导致数据损坏 |
| **验证方式** | 并发 attest 同一 domain → 检查 machine.json 完整性 |

---

### M10: 新建 critical-files.ts

**修改描述**: 新建 `.opencode/lib/critical-files.ts`，实现函数 `getCriticalFilesForDomain(domain_id)`：从 knowledge_semantic_map 拿 save_path → 匹配 index.json → 返回文件列表。

---

#### M10-V1 ✅ 验证路径 — 正确返回 domain 的关键文件列表

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M10 已实施，index.json 中有 opencode_framework 域的文件 |
| **操作** | `getCriticalFilesForDomain("opencode_framework")` |
| **预期结果** | 返回匹配 `opencode/framework/` 前缀的所有 files[].path 的去重列表 |
| **验证方式** | 对比返回结果与 index.json 中手动匹配的结果 |

---

#### M10-V2 🧪 边界条件 — domain 无缓存文件

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M10 已实施，domain "empty_domain" 在 index.json 中无文件 |
| **操作** | `getCriticalFilesForDomain("empty_domain")` |
| **预期结果** | 返回空数组 `[]`，不报错 |
| **验证方式** | 对不存在缓存的 domain 调用 → 验证返回空数组 |

---

#### M10-V3 🧪 边界条件 — domain 不存在于 knowledge_semantic_map

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M10 已实施 |
| **操作** | `getCriticalFilesForDomain("nonexistent_domain")` |
| **预期结果** | 返回空数组或抛出明确错误（取决于实现策略） |
| **验证方式** | 对未注册的 domain 调用 → 验证优雅处理 |

---

### M14: 子 agent 直接派遣 @Knowledge-Curator

**修改描述**: dispatch_subagent 权限扩展 — 子 agent 可以 target @Knowledge-Curator 直接派遣，无需回 Orchestrator 中转。

---

#### M14-V1 ✅ 成功路径 — 子 agent 直接派遣 KC

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | 1. M14 已实施<br>2. opencode.json 中 dispatch_subagent 权限包含了 agent → KC 的允许 |
| **操作** | @Coder-BE 调用 `dispatch_subagent({ agent_type: "Knowledge-Curator", task_description: "获取 NestJS v11 Guard 文档" })` |
| **预期结果** | 派遣成功，KC 开始执行 |
| **验证方式** | 派遣 @Coder-BE → 让其直接 dispatch KC → 验证 session_log 中有 KC 派遣记录 |

---

#### M14-V2 ❌ 失败路径 — 子 agent 尝试派遣非 KC target 被拒绝

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M14 已实施 |
| **操作** | @Coder-BE 调用 `dispatch_subagent({ agent_type: "Architect", task_description: "越权派遣" })` |
| **预期结果** | dispatch_subagent 拒绝：子 agent 只能 target Knowledge-Curator |
| **验证方式** | 派遣 @Coder-BE → 尝试 dispatch 非 KC agent → 验证被拒绝 |

---

#### M14-V3 ❌ 失败路径 — Super-Admin 仍可派遣所有 agent

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M14 已实施 |
| **操作** | @Super-Admin 调用 `dispatch_subagent({ agent_type: "Meta-Planner", ... })` |
| **预期结果** | 派遣成功（Super-Admin 保留完整权限） |
| **验证方式** | Super-Admin 派遣任意 agent → 验证不被限制 |

---

#### M14-V4 🧪 边界条件 — M9 自愈场景中 KC 派遣被记录

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M9 + M14 已实施 |
| **操作** | Agent cache_sufficient=false → dispatch_subagent(@KC) → KC 执行 → Agent 重读 |
| **预期结果** | 1. session_log 中有 KC 派遣记录<br>2. dispatch audit log 有完整记录<br>3. KC 执行结果正确返回 |
| **验证方式** | 模拟 M9 自愈闭环 → 检查所有 audit 记录 |

---

#### M14-V5 🔀 并发场景 — 多 agent 同时 dispatch KC

| 项目 | 内容 |
|:-----|:-----|
| **前置条件** | M14 已实施 |
| **操作** | Agent A 和 Agent B 同时 dispatch_subagent(@Knowledge-Curator) |
| **预期结果** | 两次 dispatch 均可成功，各自创建独立 session |
| **验证方式** | 并发 dispatch KC → 验证两个 session 独立且不冲突 |

---

## 五、跨修复项集成验证

### INT-1 🔀 完整绕过防御链测试

**目的**: 验证 M2 + M3 + M5 + M11 联合防御绕过链条

| 步骤 | 操作 | 预期结果 |
|:----:|------|:--------:|
| 1 | Agent 调用 resolve_domain_id (M6 强制) | 获得 dispatch domain_id |
| 2 | Agent 调用 module_scope_declare (M4 同步 DB) | DB domain_id 已同步 |
| 3 | Agent 调用 knowledge_cache_search | cache 状态已记录 |
| 4 | Agent 读取 cache 文件 | read_audit 有记录 |
| 5 | Agent 调用 knowledge_cache_attest (M2 强制) | attestation 写入 machine.json |
| 6 | Agent 写文件 | M3 遍历 domain → ✅ PASS → M11 文件级匹配 → ✅ PASS |
| 7 | Agent 跳过 attest 直接写文件 (尝试绕过) | M3 Path C → ❌ BLOCK (M3-V2) |
| 8 | Agent 只 attest domain_a 但写 domain_b 文件 (尝试绕过) | M11 文件级 → ❌ BLOCK (M11-V2) |

**验证方式**: 派遣 agent 遍历所有绕过路径 → 验证全部被拦截

---

### INT-2 🔀 M9 自愈闭环端到端测试

**目的**: 验证 cache_sufficient=false 的完整自愈流程

| 步骤 | 操作 | 预期结果 |
|:----:|------|:--------:|
| 1 | Agent 判断 cache 不足 | knowledge_cache_attest(cache_sufficient=false) |
| 2 | Attestation 写入 | status = "insufficient" |
| 3 | Agent 尝试写文件 | M3 + M11 → ❌ BLOCK |
| 4 | Agent dispatch_subagent(@KC) | M14 派遣成功 |
| 5 | KC 获取外部文档 | index.json 更新 |
| 6 | Agent 重读新文档 | read_audit 记录 |
| 7 | Agent 重新 attest(cache_sufficient=true) | status 更新为 "attested" |
| 8 | Agent 写文件 | ✅ 放行 |

**验证方式**: 派遣 agent 触发完整自愈闭环

---

### INT-3 🧪 强制模式矩阵测试

**目的**: 验证 advisory / strict / locked 三种模式下各修复项的正确行为

| 修复项 | Advisory | Strict | Locked |
|:------:|:--------:|:------:|:------:|
| M3 Path C | ⚠️ WARNING + 放行 | ❌ BLOCK | ❌ BLOCK + 无豁免 |
| M5 Path B | ⚠️ WARNING | ❌ BLOCK | ❌ BLOCK |
| M11 文件级 | ⚠️ WARNING + 放行 | ❌ BLOCK | ❌ BLOCK |
| M9 cache_sufficient=false | ⚠️ 提示 + 放行 | ❌ BLOCK + KC 派遣 | ❌ BLOCK + 人工介入 |

**验证方式**: 分别在三种模式下执行关键验证用例 → 确认行为差异符合设计

---

### INT-4 🧪 回归测试 — 正常任务流程不受影响

**目的**: 确保所有修复项不会阻断合法的正常任务流程

| 步骤 | 操作 | 预期结果 |
|:----:|------|:--------:|
| 1 | 派遣 @Coder-BE 执行完整 UC7KS 流程 | ✅ 通过 |
| 2 | 派遣 @Coder-FE 执行完整 UC7KS 流程 | ✅ 通过 |
| 3 | 派遣 @Architect 执行完整 UC7KS 流程 | ✅ 通过 |
| 4 | 派遣 @Super-Admin 执行完整 UC7KS 流程 (UC7-009) | ✅ 通过（cache 健康时） |
| 5 | Super-Admin 在 cache 不健康时执行紧急修复 | ✅ 通过 (UC7-009 健康状态豁免) |

**验证方式**: 派遣各 agent 执行各自的标准任务流程 → 全流程通过

---

## 六、验证执行计划

### 6.1 Phase 排序 (按依赖关系)

```
Phase 1  (Config 级)     M1 → M6 → M7
Phase 2  (Preamble 级)   M2
Phase 3  (Core 逻辑)     M3, M5, M11, M9
Phase 4  (域一致性)      M4(R), M12, M13
Phase 5  (质量门禁)      M8, M10, M14
Phase 6  (集成验证)      INT-1, INT-2, INT-3, INT-4
```

### 6.2 总验证用例清单

| Phase | 修复项 | 用例数 | 类型分布 |
|:-----:|:------:|:------:|:--------:|
| 1 | M1 | 3 | 1✅ 1❌ 1🧪 |
| 1 | M6 | 2 | 1✅ 1❌ |
| 1 | M7 | 3 | 1✅ 1❌ 1🧪 |
| 2 | M2 | 3 | 1✅ 1❌ 1🔀 |
| 3 | M3 | 7 | 1✅ 2❌ 3🧪 1🔀 |
| 3 | M5 | 3 | 1✅ 1❌ 1🧪 |
| 3 | M11 | 6 | 1✅ 2❌ 3🧪 |
| 3 | M9 | 6 | 1✅ 1❌ 2🧪 2🔀 |
| 4 | M4 | 3 | 2✅ 1❌ (回归) |
| 4 | M12 | 2 | 1✅ 1🧪 |
| 4 | M13 | 4 | 1✅ 1❌ 2🧪 |
| 5 | M8 | 3 | 1✅ 1❌ 1🧪 |
| 5 | M10 | 3 | 1✅ 2🧪 |
| 5 | M14 | 5 | 1✅ 2❌ 1🧪 1🔀 |
| 6 | INT | 4 | 4 集成 |
| **总计** | **14 项** | **57 用例** | — |

### 6.3 验证环境配置

```bash
# 严格模式设置
export ENFORCEMENT_MODE=strict

# 运行 framework-self-test 基线
bun .opencode/scripts/framework-self-test.ts > baseline.txt

# 验证工具链
which bun
bun --version

# 读取 machine.json 初始状态
cat .opencode/state/machine.json
```

---

## 七、预期结果判定标准

| 结果 | 条件 |
|:----:|------|
| ✅ **PASS** | 所有用例按预期执行，无意外行为 |
| ⚠️ **PASS with ADVISORY** | 所有用例按预期执行，但 advisory 模式下的日志/行为需人工确认 |
| ❌ **FAIL** | 任一关键用例未按预期执行 |
| 🔄 **RETEST** | 修复项有迭代修改，需重新验证 |

### 门禁标准

- **P0 项 (M1, M2, M3, M11)**: 100% 用例 PASS 方可进入下一阶段
- **P1 项 (M5, M6, M7, M12, M13)**: 100% 用例 PASS
- **P2 项 (M8, M9, M10, M14)**: 功能用例 100% PASS，边界用例 ≥ 80% PASS
- **集成验证 (INT-1~4)**: 全部 PASS

---

## 八、未覆盖风险

| 风险 | 级别 | 缓解 |
|:-----|:----:|:-----|
| lock 文件并发写入导致 machine.json 损坏 | 低 | 使用 atomic write 策略 (写临时文件 → rename) |
| knowledge_cache_attest 被伪造调用 | 中 | 依赖 read_audit 交叉验证 files_read 真实性 |
| session_map DB 损坏导致域无法查询 | 低 | 已有 fallback 到 .dispatch_ctx 文件 |
| save_path 修改后旧缓存文件归属混乱 | 中 | M12 修改后需清理或迁移旧缓存 |
| 多 agent 并发时 attestation 状态竞争 | 中 | 需要 Last-Write-Wins 或乐观锁机制 |
| KC 派遣超时导致自愈中断 | 低 | M14 有超时管理 + M9 有重试上限 |

---

## 九、相关文档

| 文档 | 用途 |
|------|------|
| [gap-analysis-and-repair-plan.md](./uc7ks-write-block-gap-analysis-and-repair-plan.md) | 本方案的基础输入 |
| [UC7KS-PIPELINE-STANDARD.md](../../.opencode/rules/rule_detail/UC7KS-PIPELINE-STANDARD.md) | UC7KS 管道标准 |
| [enforcement-modes-standard.md](../../.opencode/rules/rule_detail/enforcement-modes-standard.md) | 强制执行模式定义 |
| [storage-entity-landscape.md](./storage-entity-landscape.md) | 框架存储实体全景图 |
