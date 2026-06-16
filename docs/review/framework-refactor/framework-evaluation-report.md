# OpenCode 框架客观评估报告（修订版）

**评估日期：** 2026-06-15
**评估范围：** OpenCode 多智能体框架自身（框架即产品）
**评估方法：** 源码逐文件审查、状态文件分析、git 历史统计
**设计背景：** 框架旨在通过工程化硬约束缓解 LLM 的概率性产出，保证一致性、正确性、准确性，减少幻觉、漂移、注意力分散，使 LLM 能切实用于完整项目的构建、开发、维护与发布。

---

## 一、框架全景

| 维度 | 数据 |
|------|------|
| 框架源码 | 28 个 lib 模块 + 11 个工具 + 16 个插件（`withPluginLifecycle` HOF） + 34 个脚本 + 2 个 git hook（TS+Bun） |
| 配置文件 | opencode.json (918行) + project.config.json (1256行) + AGENTS.md (248行) |
| 状态管理 | machine.json (1MB+, 12+ 子状态) + gate-state.json + rule_registry.json (167行，已简化) + schema (1304行) |
| Agent 定义 | 10 个角色，分属 4 层 |
| 测试覆盖 | 17 个框架自测试文件 + 集成测试 |
| Git 提交 | 226 次，其中 99 次（44%）为框架维护 |
| 关键文件追踪 | 22 个 CRITICAL_FILES + git diff 检测 + [INFRA] commit 标记（SHA-256 已移除） |

**注：** 框架本身是当前正在开发的产品，因此框架维护提交占比高是合理的——这是"构建工具"而非"工具产出的管理开销"。

---

## 二、逐子系统分析

### 1. Layout Architecture System

**评价：**
目录约定清晰，`.opencode/` 下按职责划分为 `agents/`、`rules/`、`scripts/`、`tools/`、`plugins/`、`state/`、`context/`、`lib/` 等子目录。每个目录内文件命名一致（`*-core.ts`、`*-before.ts`、`*-after.ts`），新人可以快速定位功能模块。28 个 lib 模块按单一职责原则组织，依赖关系通过 `index.ts` barrel export 管理。

**问题：**
1. **路径解析脆弱**：pre-commit hook 前 34 行全是路径 fallback 逻辑（`$INNER/scripts/` → `$ROOT/.opencode/scripts/`），说明 layout 约定在 hook 场景与工具场景不一致。
2. **配置职责模糊**：`opencode.json`（918行，定义 agent 配置 + MCP + 权限块）与 `project.config.json`（1256行，定义 enforcement + 权限 + dispatch）存在重叠。`opencode.json` 中包含完整的 per-agent `safe_edit/safe_delete/safe_shell` 权限定义，而 `project.config.json` 中也有 `agent_write_scopes` 和 `safe_shell.agent_allowlists`。
3. **代码与状态混存**：`.opencode/` 既是框架源码目录（`lib/`、`tools/`、`plugins/`），又是运行时状态目录（`state/`、`logs/`），导致 `.gitignore` 规则复杂（135行）。
4. **authority 声明矛盾**：`framework-authorities.json` 声明 `opencode.json` 为 "ADAPTER"（镜像 agent 定义），但实际 `opencode.json` 包含完整的权限矩阵，行为上等同于规范文件。

**潜在风险：**
- 路径 fallback 逻辑在不同执行环境（hook vs tool vs script）可能产生不可预测的行为
- 两套权限定义的优先级和合并逻辑不透明，容易导致配置漂移

**优化方向：**
- 物理分离框架代码（`.opencode/src/`）与运行时状态（`.opencode/runtime/`）
- 统一权限定义到单一配置文件，消除 `opencode.json` 与 `project.config.json` 的歧义
- 明确 `framework-authorities.json` 与实际行为的对齐

**结论：** 保留目录约定。路径 fallback 和配置重叠是需要修复的技术债，但整体架构合理。

---

### 2. Permission Matrix System

**评价：**
框架中最有价值的硬约束子系统。在 `project.config.json` 中为 10 个 agent 分别定义了 `safe_edit`、`safe_delete`、`safe_mkdir`、`safe_shell`、`safe_test` 的 glob 权限矩阵。`safe-bash.log` 中有大量命令被 `NOT_IN_ALLOWLIST` 拦截的实际记录，证明即使 LLM 试图执行越权操作，框架也能在物理层面阻止。这是不依赖 LLM 遵守指令的真正硬约束。

**问题：**
1. **维护成本高**：10 个 agent × 50-80 行权限配置 = 500-800 行纯权限定义。新增 agent 需完整复制并定制权限矩阵。
2. **粒度不一致**：部分 agent 使用 `*` 通配符，部分使用精确路径，安全边界难以审计。
3. **scope 越界是常见故障**：WAIVE.md 记录了 @Coder-BE 被 DAG 分配了写框架测试的任务，但 `safe_edit` 权限不包含 `.opencode/`，最终需要 @Arbiter 裁决 + @Super-Admin 修改配置。权限矩阵与任务系统存在设计耦合。
4. **双配置源**：`opencode.json` 和 `project.config.json` 各有一套权限定义。

**潜在风险：**
- 权限粒度不一致可能导致安全审计盲区
- 双配置源增加配置漂移概率

**优化方向：**
- 引入权限模板/继承机制（如 "coder-base" 模板，Coder-BE/FE 继承后微调）
- 统一到单一配置文件，消除两套权限系统

**结论：** 权限隔离是框架最有价值的子系统，值得保留并投入优化。

---

### 3. Central State Management

**评价：**
设计灵感来源于现代前端状态管理系统（Redux/Vuex），试图将状态管理概念引入 LLM agent 调度场景。`machine.json` 通过 JSON Schema（1304行）严格定义了 12+ 个子状态：`eslint_state`、`type_check_state`、`dependency_state`、`format_state`、`write_audit_state`、`compliance_records`、`knowledge_audit_state`、`knowledge_cache_state`、`tdd_enforcement_state`、`contracts`、`keystone_hashes`、`transaction_state` 等。这是一个有前瞻性的设计思路。

**问题：**
1. **单点故障**：`machine.json` 是 1MB+ 的 JSON 文件，承担所有状态管理职责。1513 次修订（约 50-60 次/天）意味着极高频的完整 JSON 读写。任何一次格式错误的写入都可能导致框架瘫痪。
2. **状态膨胀**：`write_audit_state.files_written` 数组包含数百个条目，`eslint_state` 追踪 50+ 模块，历史数据未有效清理。
3. **状态同步复杂**：22 个 keystone 哈希需与 machine.json 中记录的契约哈希保持同步。Rule registry 的 SHA-256 同步问题已通过 git diff + [INFRA] 标记方案解决（见 `rule-registry-optimization-plan.md`，已完成）。
4. **补救机制过多**：state reconciliation、state compaction、state backup、state archive、state transaction log——五种补救机制的存在说明核心状态管理可靠性不足。
5. ~~**并发写入无锁**~~：~~大部分插件使用 `JSON.parse → mutate → JSON.stringify → writeFileSync` 的非原子模式。仅 UC7KS 工具使用了 CAS 模式（`atomicWriteMachine`）。若两个 hook 同时触发，后者覆盖前者。~~ **已修复**：所有 5 个写 machine.json 的插件已迁移到 `atomicWriteMachine()`（CAS-on-revision）；非 machine.json 写操作使用 `atomicWriteJson()`（temp+rename）。

**潜在风险：**
- 单文件状态管理在高并发场景下数据丢失概率随写入频率线性增长
- 补救机制本身也增加代码复杂度和维护成本
- JSON 大文件读写在 Node.js/Bun 中是同步阻塞操作

**优化方向：**
- **短期**：将 `machine.json` 拆分为独立子状态文件（`eslint-state.json`、`audit-state.json`、`knowledge-state.json`），降低单点故障风险
- **中期**：引入第三方对 JSON 数据和向量数据友好的内存数据库（如 Redis + RediSearch、SQLite + FTS5、或轻量级嵌入式数据库如 DuckDB/LMDB），替代 JSON 文件读写
- **长期**：将 keystone hash 和 rule registry digest 验证替换为 git diff 原生变更检测，消除状态同步负担 ~~（已完成：rule-registry-optimization-plan.md，SHA-256 已替换为 git diff + [INFRA] 标记）~~
- 引入 append-only 日志文件替代 JSON 状态文件，避免并发写入冲突

**结论：** 状态管理概念正确，但当前 JSON 单文件实现是框架最大的技术债来源。需要重构实现方式，保留状态管理的设计思想。

---

### 4. Hardened Enforcement System

#### 4a. Pre-commit Hook（已重写为 TypeScript + Bun）

**评价：**
多层防御体系的核心组件，在 commit 时执行 4+ 层验证：
- Layer 0: 合规门禁 armed 检查
- Layer 1.5: 关键基础设施文件 git diff 检测（替代 SHA-256）
- Layer 1.8: Gate 生命周期审计
- Layer 1.9: 状态格式验证
- Layer 1: lint-staged
- Layer 2.5: TDD 顺序检查
- Layer 2.6: UC7KS 文档一致性检查
- Layer 2.0: JSON 语法验证
- Layer 2: Keystone 哈希验证
- Layer 3: commit-msg 委托

Enforcement Mode（advisory/strict/locked）三级模式是务实设计，允许开发早期用 advisory 降低摩擦，关键阶段切换到 strict/locked。

**已修复（precommit-hook-fix-plan.md，已完成）：**
1. ~~**严重代码重复**~~：10x 重复的 1484 行 bash 脚本已重写为 TypeScript + Bun（hook-layers.ts 333行 + hook-commit-msg.ts 132行 + 2 个薄 bash wrapper 各 2 行），死代码已消除。
2. ~~**运行时不一致**~~：硬编码 `/home/zhaoge/.bun/bin/bun` 和 commit-msg 使用 `node` 的问题已修复，统一为 `exec bun`。

**当前状态：** Pre-commit hook 已完成 Bash → TypeScript 迁移，代码量从 1484 行压缩至 469 行（含 wrapper），可测试性和可维护性显著提升。

#### 4b. Commit Message Hook（已重写为 TypeScript + Bun）

**评价：**
纯 TypeScript hook 实现（hook-commit-msg.ts, 132行），不依赖 LLM。强制 TDD 阶段标记（`[Red]`/`[Green]`/`[Refactor]`），通过扫描 git log 验证阶段顺序。**新增 [INFRA] 标记检查**：当 staged files 包含关键基础设施文件时，commit message 必须包含 `[INFRA]`（advisory 仅警告，strict/locked 阻断）。

**问题：**
- 当前 `gate-state.json` 仅有少量活跃会话，TDD 排序验证在多数场景下处于惰性状态

#### 4c. Compliance Gate 三步协议

**评价：**
Compliance Gate 的价值是**双层**的，需要区分对待：

| 层次 | 机制 | 价值 |
|------|------|------|
| **认知层** | LLM 主动调用 `check`/`confirm`/`complete`，在 context 中形成流程意识 | 注意力锚定——迫使 LLM 明确表述任务目标、规划步骤、反思结果 |
| **机械层** | 每次 MCP 调用内部执行 artifact 完整性验证、DAG 状态检查、权限合规 | 物理验证——不满足条件时返回结构化失败原因 |

三步协议在 LLM context 中产生的认知锚点：

- **`check`（任务开始时）**：LLM 被迫明确表述 `task_description`，这个表述本身就是一种自我约束——后续执行会倾向于与初始表述保持一致。
- **`confirm`（计划确认后）**：LLM 被迫输出 `plan_summary`，在动手前先规划。这个 plan_summary 会留在后续 context 中，作为执行阶段的参照锚点。
- **`complete`（任务结束时）**：LLM 被迫输出 `execution_summary`，对刚完成的工作进行反思总结。

设计初衷是正确的——通过强制性的 MCP 调用确保 LLM 不跳过对实际开发中减少错误、减少幻觉、减少漂移的重要步骤，追求开发的正确性、准确性、一致性。

**`complete` 的自修正循环是协议中最关键的机制：**

当 LLM 调用 `complete` 且验证不通过时，框架返回结构化的失败原因，LLM 即时修正后重试：

```
LLM 调用 complete → 返回 "missing test_report.json"
  → LLM 补写 test_report.json → 再次调用 complete
  → 返回 "execution_evidence 字段缺失"
  → LLM 补充 execution_evidence → 再次调用 complete → pass ✓
```

这个自修正循环之所以高效，依赖三个条件：
1. **反馈即时**：LLM 还在任务 context 中，对刚做了什么有完整记忆，修正成本低
2. **反馈精确**：MCP 工具返回结构化失败原因（具体缺哪个 artifact、哪个字段），LLM 可直接针对性修复
3. **闭环在 LLM 端**：LLM 自己驱动修复→重试，过程本身强化了对"什么才算完成"的认知

如果将 `complete` 下沉到框架机械层（如 pre-commit hook），自修正循环变为：

```
LLM 写代码 → git commit → hook 返回 "missing test_report.json"
  → LLM 收到 hook 报错 → 但 context 可能已压缩/切换 → 修正成本显著升高
```

**结论：`complete` 必须保留在 LLM 层，因为自修正循环的即时反馈价值无法被框架层替代。**

**已修复（compliance-gate-optimization-plan.md，已完成）：**

1. ~~**三步压缩为两步**~~：`compliance_gate_check` schema 新增可选 `plan_summary` + `agent` 参数；CallTool handler 在 check 通过时自动调用 `runGateConfirm`，单次 MCP 调用完成 check+confirm。
2. ~~**返回值嵌入强提示**~~：新增 `buildReminderText()` helper；combined flow 和 legacy confirm 在 armed 成功时追加 `✅ GATE ARMED + ⚠️ REMINDER` 文本块到 MCP 响应，随 response 进入 LLM context。
3. ~~**框架层兜底提醒**~~：`plugins/task-after.ts` 在 `tool.execute.after` 中检测 Task SUCCESS + armed session → 写 `.task_temp/_global/gate-reminder.{md,json}`（atomic temp+rename）+ `writeLog(WARN, GATE-REMINDER-WRITTEN)`；新增 `experimental.session.compacting` hook push 提醒到压缩 context。**`tui.prompt.append` 未实施**——官方文档列出其为 TUI 事件但无插件可调用的 API，详见 plan §3 可行性澄清。

**当前状态：** 提醒纵深三层——(1) MCP 响应中的 reminder 文本（PRIMARY，进入 LLM context）；(2) `.task_temp/_global/gate-reminder.{md,json}` 文件（FALLBACK，跨 context 压缩存活）；(3) `experimental.session.compacting` push（LAST RESORT，压缩时重新注入）。

**问题：**
1. **LLM 忘记调用 `complete`**：26 个 drained sessions 证明 agent 在长任务中容易遗忘末尾的 `complete` 调用。这是 LLM 注意力衰减的固有特征——context 越长，越早的指令越容易被遗忘。
2. **三步对工作记忆负担过重**：LLM 需要在任务开始、中间、结束三个时间点分别记住调用不同的 MCP 工具。三步中任何一步被遗忘都会导致协议断裂。
3. **`confirm` 可合并到 `check`**：`check` 的返回值已经包含了确认信息，`confirm` 作为独立步骤增加了记忆负担但未增加实质价值。
4. **drained session 补救机制增加了系统复杂度**：drain 机制本身需要维护、测试和修复。

**潜在风险：**
- 协议失效时框架进入死锁（无法 commit），需要 Super-Admin drain 修复
- 每个任务 3 次 MCP 调用增加 token 消耗（combined flow 下已降为 2 次）

**优化方向：**

核心原则：**不替代 LLM 参与，而是降低 LLM 遗忘的概率。**

1. ~~**三步压缩为两步**~~（已实施）
2. ~~**`check` 返回值中嵌入强提示**~~（已实施）
3. ~~**框架层兜底提醒（非替代）**~~（已实施，`tui.prompt.append` 除外）
4. **保留 `complete` 的自修正循环**：这是协议的核心价值，不可下沉到框架机械层
5. **保留 enforcement mode 作为控制开关**

#### 4d. Rule Registry（已优化：SHA-256 → git diff + [INFRA] 标记）

**已解决（rule-registry-optimization-plan.md，已完成）：**

原方案使用 31 个注册条目的 SHA-256 digest 验证，存在自引用循环（registry 需手动维护→经常忘记→digest 不匹配→修复消耗 token）。已替换为：

- **触发机制不变**（dispatch 前 + commit 前），**检测手段替换为 git diff HEAD**
- **关键文件清单提取为 `.opencode/lib/critical-files.ts`**（22 个 CRITICAL_FILES），供 hooks、gate、compliance 等模块共享
- **commit-msg hook 追加 [INFRA] 标记检查**：advisory 仅警告，strict/locked 阻断
- **`rule_registry.json` 简化为纯文档清单**（167行，移除 sha256/semver/digest_history 字段）
- **`rule-registry-verify.ts` 和 `rule_registry_repair.ts` 已删除**
- **4 个检查点已替换**：pre-execution-gate.ts、compliance-gate.ts、gate-core.ts、gate-checks.ts

**遗留价值：** 两层检查链路（dispatch 前检测 + commit 时强制标记）保留了关键文件变更感知能力，同时消除了 registry 维护成本。

---

### 5. Framework Harness System（框架自测试基础设施）

**评价：**
框架为自身构建了完整的测试基础设施：
- 17 个框架自测试文件（覆盖 pre-execution-gate、state-reconciliation、compliance-gate、code-quality-gate、safe-bash、safe-edit、state-transaction 等核心组件）
- 集成测试（state-migration.integration.test.ts）覆盖 5 个 E2E 场景
- MCP 审计测试（ci-cd-agent-mcp-audit.spec.js、agent-mcp-audit.spec.js）验证 agent MCP 权限合规
- 37+ 项自验证检查（framework-self-test.ts）——"lint-the-linter" 工具
- `framework-doctor.ts` 诊断工具

测试覆盖了框架的核心路径：DAG/Gate 验证、状态对账、权限隔离、安全 shell、安全编辑、事务引擎等。

**问题：**
1. **RED 阶段测试较多**：7+ 个测试处于 RED 阶段（safe_edit TOCTOU、safeBash allowlist、framework-enforcer hooks、dispatch env propagation 等），说明多个功能模块尚未完成 GREEN 实现。这是 TDD 纪律的体现，但也意味着这些功能的硬约束尚未生效。
2. **framework-self-test.ts 混合模块系统**：使用 TypeScript 语法但 `require()` 导入，应统一为 ESM 或 CJS。
3. **backup 文件堆积**：`__tests__/.opencode_backups/` 有 13 个 backup 文件，应由 nightly-compaction 清理。

**潜在风险：**
- RED 阶段功能未实现意味着对应的安全约束（如 TOCTOU 保护）在实际运行中不生效
- 混合模块系统可能导致构建/运行时错误

**优化方向：**
- 优先完成 RED→GREEN 迁移，使安全约束尽快生效
- 统一模块系统
- 集成 backup 清理到 CI 流程

**结论：** 框架自测试基础设施是务实且有价值的。测试覆盖率和 RED 阶段标记体现了工程纪律。

---

### 6. Plugin System

**评价：**
16 个插件使用统一的 `withPluginLifecycle()` HOF（`lib/hook-lifecycle.ts`），消除 6 行样板代码：
1. HOF 顶层：`ensureLogDir()` → `writeLog("loaded")` → `updateIndex("PLUGIN-LOADED")`
2. `export default withPluginLifecycle(name, hooks)`：1 行替代原 6 行
3. Handler：`writeLog("runtime")` → 执行检查

架构统一，职责清晰：
- **8 个 before-hooks**：gate-before、scope-before、dispatch-before、tdd-before、uc7ks-before、audit-before、json-validate、session（chat.message）
- **8 个 after-hooks**：gate-after、cache-after、audit-after、tdd-after、task-after、scope-after、dispatch-after、uc7ks-after

验证逻辑通过 `lib/` 层共享，工具与插件之间无直接耦合。**所有 machine.json 写操作已使用 `atomicWriteMachine()`（CAS-on-revision），非 machine.json 写操作使用 `atomicWriteJson()`（temp+rename）。**

**已修复（plugin-system-fix-plan.md，已完成）：**
1. ~~**`capFailedEntries` 重复**~~：已提取到 `lib/state-utils.ts`，`task-after.ts` 和 `dispatch-after.ts` 从共享模块导入。
2. ~~**TDD 常量重复**~~：`TDD_AGENTS`/`TDD_MODIFY_TOOLS`/`isTddAgent`/`isTddTool` 统一到 `lib/state-utils.ts`，`tdd-before.ts` 和 `tdd-after.ts` 从共享模块导入。
3. ~~**`isBusinessSourceFile` 内联重复**~~：统一为 `lib/state-utils.ts` 的正则+前缀实现（更精确），`tdd-after.ts` 从共享模块导入。消除了不同实现的潜在分类不一致 bug。
4. ~~**safe_shell path scope guard 三处重复**~~：统一为 `lib/tool-scope.ts` 的 `getEffectivePathScopeFilePath()`，`scope-before.ts` 和 `audit-before.ts` 共用同一策略（对 cp/mv/rm 放行路径检查）。
5. ~~**machine.json 并发写入竞争**~~：5 个插件使用 `atomicWriteMachine()`（CAS-on-revision）替代裸 `fs.writeFileSync`；`session.ts` 使用 `atomicWriteJson()`（temp+rename）处理非 machine.json 写操作。
6. ~~**插件生命周期样板代码**~~：16 个插件全部迁移到 `withPluginLifecycle()`，96 行样板压缩为 16 行。

**当前状态：** 插件系统 9 类重复/不一致已全部消除（详见 `plugin-system-fix-plan.md`）。

---

### 7. Safe Tools System

**评价：**
11 个 MCP 暴露工具，统一使用 `withInterruptGuard` 包装器和 `context.agent` 身份解析：

| 工具 | 行数 | 功能 | 安全特性 |
|------|------|------|---------|
| safe_shell | 54 | allowlist shell 执行 | 委托 safeBashTool 验证 |
| safe_edit | 112 | 原子文件编辑 | TOCTOU 保护 + backup + rollback + 自愈重试 |
| safe_delete | 36 | 安全删除 | TOCTOU + backup |
| safe_mkdir | 28 | 原子目录创建 | 路径解析 |
| safe_test | 34 | TDD 测试报告验证 | phase enum 强制 |
| safe_diff | 117 | 统一 diff 生成 | 纯只读 |
| safe_restore | 57 | backup 恢复 | 原子 copy-temp-then-rename |
| dispatch_subagent | 550 | 子 agent 派遣 | PLAN-FIRST Layer 2 + Super-Admin 修复验证 + execFileSync（防注入）|
| ~~rule_registry_repair~~ | ~~296~~ | ~~规则摘要修复~~ | ~~已删除（SHA-256 替换为 git diff）~~ |
| knowledge_cache_search | 243 | UC7KS 缓存搜索 | 管道链验证 + CAS 写入 |
| knowledge_gap_report | 94 | 知识覆盖率分析 | 纯只读 |
| module_scope_declare | 125 | UC7KS 作用域声明 | 模块白名单 + CAS 写入 |

**问题：**
1. **dispatch_subagent 过于复杂**：550 行代码承担 4+ 层验证（REPAIR-DAG-DEADLOCK、PLAN-FIRST Layer 2、caller authorization、Super-Admin target），职责过载。
2. ~~**rule_registry_repair 死代码**~~：已随工具删除而消除。
3. **safe_edit 和 safe_delete 的 bootstrap retry 重复**：相同的 `"first call establishes baseline"` 字符串检查在两处重复。

**潜在风险：**
- dispatch_subagent 的复杂性使其难以审计和测试

**优化方向：**
- 将 dispatch_subagent 拆分为独立验证模块（每个验证层一个函数/文件）
- 将 bootstrap retry 提取到 `lib/` 共享

**结论：** 工具体系设计专业，安全特性（TOCTOU、backup、CAS、execFileSync）体现了防御纵深思想。dispatch_subagent 的复杂度需要治理。

---

### 8. Multi-Agent System

**评价：**
三层十角色架构：

| 层级 | Agent | 模式 | 核心职责 |
|------|-------|------|---------|
| 元认知层 | @Meta-Planner | subagent | 需求拆解 / DAG 生成 |
| 元认知层 | @Orchestrator | primary | 任务调度（唯一用户入口）|
| 执行层 | @Architect | subagent | 接口契约（contract.yaml）|
| 执行层 | @Coder-BE | subagent | NestJS/Prisma 后端实现 |
| 执行层 | @Coder-FE | subagent | Angular 前端实现 |
| 验证层 | @Guardian | subagent | 代码审查（ESLint/type-check/format）|
| 验证层 | @Arbiter | subagent | 冲突裁决 / 技术债豁免 |
| 运维层 | @CI-CD-Agent | subagent | GitHub Actions / 部署 |
| 治理层 | @Super-Admin | all | 框架修复 / 紧急操作 |
| 治理层 | @Knowledge-Curator | subagent | UC7KS 知识管道 |

设计初衷是最大程度保证 LLM 执行时注意力集中，通过角色分工使每个 agent 的 context window 聚焦于单一职责，从而保证成果物的准确性、正确性、一致性。

**有价值的核心思想：**
- 规划与执行分离（Meta-Planner vs Coder）
- 实现与审查分离（Coder vs Guardian）
- 角色权限隔离（Permission Matrix 配合）
- 注意力聚焦（每个 agent 只关注自身职责域）

**问题：**
1. **角色数量与注意力收益的边际递减**：10 个角色中，实际高频使用的核心角色是 Coder-BE/FE（写代码）、Guardian（审查）、CI-CD-Agent（部署）。其余 7 个角色的使用频率较低，但每个都需要独立的 agent 定义文件、权限矩阵、MCP 工具配置。
2. **@Orchestrator 的调度功能可硬编码**：其核心工作是读取 DAG JSON 然后 dispatch——这个逻辑不需要 LLM agent，可以用代码实现。
3. **@Arbiter 裁决的多是框架自身引起的冲突**（scope mismatch、digest drift）。如果简化框架，Arbiter 的需求自然减少。
4. **@Super-Admin 的主要工作量是修复框架自身的 bug**。这是框架复杂度的症状。
5. **@Knowledge-Curator 的 LLM 可以直接 Read 文件**，不需要中间人 agent。

**潜在风险：**
- 角色过多导致 dispatch 链路长，信息在 agent 间传递时衰减（HANDOVER.md 机制试图缓解但增加了仪式性工作）
- 每个角色的 agent 定义维护成本（`agents/*.md` + `opencode.json` + `project.config.json` 三处配置）

**优化方向：**
- **保留核心思想**（角色分离 + 注意力聚焦），**精简角色数量**
- 将 @Orchestrator 的调度逻辑硬编码到框架（`dispatch_subagent.ts` 已具备此能力）
- 将 @Meta-Planner 的规划功能转为人类 + LLM 对话（而非独立 agent）
- @Arbiter 和 @Super-Admin 随框架简化后自然消失
- 最终目标：**3 个核心角色**（Coder-BE/FE + Guardian + CI-CD）+ 框架内置调度逻辑

**结论：** 多角色分离的设计思想正确，注意力聚焦是 LLM 工程化的有效策略。但 10 个角色的维护成本与收益不成比例，建议精简到 3 个核心角色 + 框架内置调度。

---

### 9. PLAN-FIRST Constraint（三层防御纵深）

**评价：**
PLAN-FIRST 是框架中防御纵深最彻底的子系统，在三个独立层次检查相同不变量：

| 层次 | 文件 | 行为 |
|------|------|------|
| Layer 1 | `plugins/dispatch-before.ts` | 策略驱动；工具执行前检查 DAG 存在 |
| Layer 2 | `tools/dispatch_subagent.ts` | 无条件代码验证；支持 `auto_plan` 自愈 |
| Layer 3 | `plugins/gate-before.ts` P2-1 | 修改工具执行时的权威兜底 |

DAG-exempt agents（无需 DAG 条目）：Meta-Planner、Orchestrator、Super-Admin、Knowledge-Curator。规范在 `lib/dag-policy.ts` 统一管理。

`auto_plan` 自愈机制：当非 exempt agent 被派遣但无 DAG 条目时，可自动触发 Meta-Planner 生成规划，受 `dispatch_policy` 约束（`auto_plan_enabled`、`auto_plan_max_per_session`、`auto_plan_timeout_ms`）。

**问题：**
1. **DAG 本身的 ROI 存疑**：261 个任务的依赖关系通常是线性的（分析→设计→实现→测试→审查），不需要图结构。flat task list + 优先级标注可能就够了。
2. **DAG 生成消耗大量 token**：Meta-Planner 的主要工作是生成和维护 DAG，对于单开发者项目，人类 + LLM 对话规划任务更高效。
3. **auto_plan 当前默认关闭**（`auto_plan_enabled: false`），说明自愈机制尚未在实战中验证。

**潜在风险：**
- DAG 维护成为 LLM 的额外仪式性工作，偏离了"减少仪式"的设计目标
- 三层防御纵深虽彻底，但如果 DAG 本身价值有限，则三层检查都是在保护一个低价值的约束

**优化方向：**
- 评估是否将 DAG 简化为 flat task list（JSON array + priority 字段）
- 保留 PLAN-FIRST 的核心思想（先规划后执行），但简化规划的数据结构
- 将 auto_plan 作为正式特性启用并验证

**结论：** 防御纵深设计专业。但 DAG 作为规划数据结构可能过于复杂，flat task list 可能是更务实的选择。

---

### 10. UC7KS Knowledge Pipeline

**评价：**
五级获取级联，设计目标是确保 LLM 在编码前先获取充分的技术上下文：

```
1. Local cache (docs/official_docs/ + index.json)
   ↓ miss
2. Context7 MCP (技术文档查询)
   ↓ miss
3. WebFetch (白名单域名)
   ↓ miss
4. WebSearch (白名单查询模式)
   ↓ miss
5. Scout Agent (自主深度研究)
```

实现完整：7 个知识维护脚本（archiver、deduplicator、indexer、compressor、janitor、scout-extractor、scout-trigger）+ `module_scope_declare`（Step 0a）+ `knowledge_cache_search`（管道搜索）+ `knowledge_gap_report`（覆盖率分析）。

管道通过工具链顺序强制执行：`module_scope_declare → knowledge_cache_search → compliance_gate_check → modify tools`。`scope-before.ts` 的 `checkUC7KSWrite` 验证写操作前已执行知识缓存搜索。

**问题：**
1. **LLM 本身有 context window**，可以直接 Read 文件获取上下文。知识缓存、语义域映射（12 个域）、缓存对账等机制增加了大量复杂度，但 LLM 的 context window 已经具备类似能力。
2. **管道链验证增加仪式性工作**：agent 必须先调用 `module_scope_declare`，再调用 `knowledge_cache_search`，然后才能写代码。这 2 步 MCP 调用增加了 token 消耗。
3. **12 个语义域的维护成本**：`knowledge_semantic_map` 在 `project.config.json` 中定义了 12 个域（backend_api、persistence、frontend_ui、caching、queue、testing、auth_security、framework_tools、devops_ci、opencode_framework、infrastructure、state_management），每个域需要维护关键词、缓存路径、Context7 库映射。

**潜在风险：**
- 知识管道的复杂度可能超过它带来的上下文质量提升
- 管道链验证失败时阻塞写操作，可能导致开发中断

**优化方向：**
- 保留"先获取上下文再编码"的设计思想
- 简化实现：用 prompt-level 指令（"编码前先读取以下文档"）替代 MCP 工具链强制执行
- 保留 `docs/official_docs/` 目录结构和 index.json 作为知识组织约定
- 移除 UC7KS 管道链验证（`module_scope_declare` + `knowledge_cache_search` 强制调用）

**结论：** "先获取上下文再编码"的设计思想正确，但五级级联 + 12 域语义映射的实现过于复杂。建议保留知识组织约定，移除管道链强制验证。

---

### 11. Log Management System

**评价：**
- `safe-bash.log`（437KB+，5 个轮转文件 + gz 归档）：记录所有 shell 命令的 allow/block 决策
- `gate-state.history/`（25 个日文件）：合规门禁历史
- ~~`rule-registry-repair.log`~~：已随 rule_registry_repair 工具删除
- `.transaction-log`（67 条）：状态变更事务
- 插件日志：`.task_temp/_logs/<date>/plugin-<name>-{loaded,hooks,runtime}.log`，由 `log-index.json` 索引

`safe-bash.log` 确实提供了审计能力——可以回溯某个 agent 在某个时间执行了什么命令、是否被允许。

**问题：**
1. 日志系统的价值与框架复杂度成正比。简化框架后日志量会大幅减少。
2. 轮转和归档机制增加了代码量，但对单开发者项目价值有限。
3. `safe-bash.log` 大部分是框架维护操作记录，而非业务开发操作记录。

**潜在风险：**
- 日志基础设施本身的维护成本可能超过其审计价值

**优化方向：**
- 保留 `safe-bash.log` 的基本审计能力
- 移除轮转/归档/压缩机制，简化日志系统

**结论：** 基础审计有价值，日志管理基础设施可简化。

---

### 12. Scripts & Utility System

**评价：**
34 个脚本覆盖框架运维全生命周期：

| 类别 | 脚本 | 行数 |
|------|------|------|
| 核心执行 | pre-execution-gate.ts | 1061 |
| 状态管理 | state-reconciliation.ts / state-transaction.ts / state-reset.ts / state-canonicalize.ts / state-integrity-scan.ts | 1589 + 其他 |
| 框架健康 | framework-self-test.ts / framework-doctor.ts / framework-compliance-check.ts | 2688 + 其他 |
| MCP 服务 | compliance-gate.ts / eslint-audit.ts / keystone-validate.ts / code-quality-gate.ts / reconciliation-validate.ts | — |
| 知识管道 | knowledge/ 下 7 个脚本 | — |
| 部署运维 | nightly-compaction.ts / install-hooks.ts / monitor-status.ts | 208 + 205 + 其他 |

`pre-execution-gate.ts`（1061行）是框架最关键的执行点之一，在每次 agent dispatch 时运行 6 个顺序检查。`state-transaction.ts` 实现了统一状态事务引擎（UUID v4、SHA-256、WAL、crash recovery）。`state-reconciliation.ts`（1589行）实现了 7 项自修复检查。

**问题：**
1. **pre-execution-gate.ts 过于庞大**：1061 行代码承担 6 层检查，职责过载。
2. **framework-self-test.ts（2688行）** 使用 TS 语法但 `require()` 导入，模块系统混合。
3. **状态事务引擎（state-transaction.ts）** 实现了完整的 WAL + crash recovery，但当前大部分插件并未使用它，而是直接读写 JSON 文件。

**潜在风险：**
- 核心脚本过大导致审计和修改困难
- 状态事务引擎虽已实现但未被广泛使用，存在"有基础设施但没人用"的风险

**优化方向：**
- 将 pre-execution-gate.ts 拆分为独立的检查模块
- 将 framework-self-test.ts 统一为 ESM
- 评估是否让所有状态写入走 state-transaction 引擎，或简化为更轻量的方案

**结论：** 脚本系统覆盖全面，state-transaction 引擎的设计超前于实际使用。

---

## 三、综合评估

### 价值矩阵

| 子系统 | 价值 | 是否依赖 LLM | 建议 |
|--------|------|-------------|------|
| Permission Matrix | **高** | 否（硬约束） | 保留，引入模板继承 |
| Commit Message Hook + Enforcement Mode | **高** | 否（硬约束） | 保留 |
| Safe Tools（TOCTOU/backup/CAS） | **高** | 否（硬约束） | 保留，治理 dispatch_subagent 复杂度 |
| Plugin Architecture | **高** | 否（硬约束） | 保留，~~提取重复代码到 lib~~（**已完成**，详见 `plugin-system-fix-plan.md`） |
| Framework Harness（自测试） | **高** | 否 | 保留，加速 RED→GREEN |
| Layout Architecture | **中** | 否 | 保留，分离代码与运行时状态 |
| Central State Management（概念） | **中** | 否 | 保留设计思想，重构实现（引入数据库） |
| PLAN-FIRST 防御纵深 | **中** | 是 | 保留核心思想，简化 DAG → flat task list |
| Multi-Agent（核心 3 角色） | **中** | 是 | 精简为 Coder + Guardian + CI-CD |
| Tech Debt Registry | **中** | 否 | 保留，极简 markdown 实现 |
| Log Management | **低-中** | 否 | 保留基础审计，移除轮转/归档 |
| ~~Pre-commit Hook（1484行）~~ | ~~**低**~~ | ~~否~~ | ~~已完成：重写为 TypeScript + Bun（469行）~~ |
| Compliance Gate 协议（认知层） | **中-高** | 是（认知锚定） | 保留，三步压缩为两步 + 强化完成提醒 |
| Compliance Gate 协议（机械层） | **中** | 否（硬约束） | 保留自修正循环，不下沉到框架层 |
| ~~Rule Registry SHA-256 Digest~~ | ~~**低**~~ | ~~否~~ | ~~已完成：替换为 git diff + [INFRA] commit 标记~~ |
| UC7KS 管道链验证 | **低** | 是 | 保留知识组织，移除链式强制 |
| Multi-Agent（其余 7 角色） | **低** | 是 | 合并或转为框架内置逻辑 |

### 核心发现

1. **框架的硬约束子系统（不依赖 LLM 的部分）是高价值的**。Permission Matrix、Safe Tools、Plugin Architecture、Commit Message Hook——这些在物理层面阻止越权行为，不受 LLM 概率性产出影响。

2. **框架的"LLM 协议"子系统需要区分认知层和机械层**。Compliance Gate 的认知锚定和自修正循环是高价值的（不应下沉到框架层），但三步对工作记忆负担过重导致遗忘率高。UC7KS 管道链验证、TDD RED→GREEN 强制的 ROI 则较低。优化方向是降低 LLM 记忆负担（压缩步骤 + 强化提醒），而非移除 LLM 参与。

3. **状态管理的设计思想正确，但 JSON 单文件实现是当前最大的技术债**。引入对 JSON 和向量数据友好的数据库（如 Redis + RediSearch、SQLite + FTS5、或 LMDB）可以显著改善可靠性和性能。

4. **Pre-commit hook 的 10x 代码重复已修复**（TypeScript + Bun 重写，1484→469行）。
5. **dispatch_subagent.ts（550行）和 pre-execution-gate.ts（961行）的复杂度需要治理**，它们是框架中最关键的执行点，也是审计和维护的最大负担。

### 优化优先级

| 优先级 | 行动 | 原因 |
|--------|------|------|
| ~~P0~~ | ~~修复 pre-commit hook 10x 重复（1484→~250行）~~ | ~~已完成：TypeScript + Bun 重写，469行~~ |
| ~~P0~~ | ~~引入 CAS 写入模式到所有 machine.json 写操作~~ | ~~已完成：5 个插件使用 atomicWriteMachine + atomicWriteJson~~ |
| P1 | 拆分 machine.json 为独立子状态文件 | 降低单点故障风险 |
| ~~P1~~ | ~~Compliance Gate 三步压缩为两步 + 框架层兜底提醒~~ | ~~已完成：详见 `compliance-gate-optimization-plan.md` Points 1-3（combined flow + reminder text + 持久化文件 + compaction push）~~ |
| ~~P2~~ | ~~Rule Registry 替换为 git diff + `[INFRA]` commit 标记~~ | ~~已完成：SHA-256 移除，4 检查点已替换~~ |
| P2 | 引入数据库替代 JSON 文件状态管理 | 根本性改善状态管理可靠性 |
| P2 | 精简 Multi-Agent 从 10 到 3 角色 | 降低维护成本，减少 dispatch 链路 |
| P2 | 简化 DAG → flat task list | 降低规划复杂度 |
| P3 | 拆分 dispatch_subagent.ts 和 pre-execution-gate.ts | 治理核心脚本复杂度 |
| ~~P3~~ | ~~提取插件重复代码到 lib/~~ | ~~已完成：详见 `plugin-system-fix-plan.md`，9 类重复全部消除~~ |
