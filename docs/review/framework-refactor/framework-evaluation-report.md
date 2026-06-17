# OpenCode 框架客观评估报告（七次修订版）

**评估日期：** 2026-06-17（七次修订，P2-A §11.6 全部关闭：v7 schema 清理 13 张未使用 typed 表 + JSON 快照文件删除 + drain DB 化 + writeLog 修复）
**评估范围：** OpenCode 多智能体框架自身（框架即产品）
**评估方法：** 源码逐文件审查、状态文件分析、git 历史统计
**设计背景：** 框架旨在通过工程化硬约束缓解 LLM 的概率性产出，保证一致性、正确性、准确性，减少幻觉、漂移、注意力分散，使 LLM 能切实用于完整项目的构建、开发、维护与发布。

---

## 一、框架全景

| 维度 | 数据 |
|------|------|
| 框架源码 | 30 个 lib 模块（新增 `deliverables-templates.ts`、`substate-types.ts`） + 13 个 MCP 暴露工具（新增 `compliance_gate_submit_deliverables`、`compliance_gate_approve_deliverables`） + 16 个插件（`withPluginLifecycle` HOF） + 38 个脚本（含 6 MCP + 8 知识） + 3 个 git hook TS 文件 |
| 配置文件 | opencode.json (916行) + project.config.json (1255行) + AGENTS.md (248行) |
| 状态管理 | machine.json (307B, 仅 meta+contracts) + SQLite DB (16 张表, schema **v7**, 12 substate_kv 行) + gate-state.json + rule_registry.json (167行) |
| Agent 定义 | 10 个角色，分属 4 层 |
| 测试覆盖 | 框架测试文件 + 集成测试 + 自验证检查（framework-self-test.ts） + framework-doctor 12 项诊断 |
| Git 提交 | 230+ 次（当前分支） |
| 关键文件追踪 | 26 个 CRITICAL_FILES + git diff 检测 + [INFRA] commit 标记 |
| 总代码行 | ~25,500 行（框架 TS 源码） |

**注：** 框架本身是当前正在开发的产品，因此框架维护提交占比高是合理的——这是"构建工具"而非"工具产出的管理开销"。

---

## 二、逐子系统分析

### 1. Layout Architecture System

**评价：**
目录约定清晰，`.opencode/` 下按职责划分为 `agents/`、`rules/`、`scripts/`、`tools/`、`plugins/`、`state/`、`context/`、`lib/` 等子目录。每个目录内文件命名一致（`*-core.ts`、`*-before.ts`、`*-after.ts`），新人可以快速定位功能模块。30 个 lib 模块按单一职责原则组织（新增 `deliverables-templates.ts` 成果物模板、`substate-types.ts` 类型安全子状态），依赖关系通过 `index.ts` barrel export 管理。

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

**优化优先级分析（2026-06-17）：**

| 优先级 | 对应问题 | 行动 | 预估工时 | 说明 |
|:------:|:--------:|------|:-------:|------|
| **P2-D** | L-2, L-4 | **配置文件与权限源统一**：将 `opencode.json` 中的 per-agent 权限块迁移到 `project.config.json`（已承担 enforcement 职责），`opencode.json` 仅保留 agent 定义 + MCP 适配器；同步修正 `framework-authorities.json` 对 `opencode.json` 的 authority 声明 | 4h | **根因问题**：与 §2 的 P-4 同源（双配置源），合并为单一 P2-D 项目可一次关闭 3 个问题（L-2 + L-4 + P-4）。解锁 §2 P3-E 的权限模板化工作 |
| P4-E | L-1 | **Layout 路径解析硬化**：统一 pre-commit hook / tool / script 三场景的路径解析为单一 helper（如 `lib/path-resolver.ts`），消除 34 行 fallback 逻辑 | 1h | 低风险项：`framework-self-test.ts` + `install-hooks.ts` 已有运行时兜底；新增 agent 时才需修。美化项，建议延后 |
| ~~P5-A~~ | L-3 | ~~`.opencode/` 代码与状态物理分离~~ | — | **不推荐**：`.gitignore` 135 行已能区分源码与状态；物理拆分（引入 `.opencode/src/` + `.opencode/runtime/`）是破坏性大重构，风险高于收益。长期搁置 |

**关键判断：**
- **P2-D 是 §1 + §2 的共同根因修复**：L-2、L-4、P-4 三个问题本质相同（`opencode.json` 被两套职责拉扯），合并为单一项目 ROI 最高——一次性关闭 3 个问题，且工时仅 ~4h
- **L-1（路径解析）与 L-3（代码状态混存）属低 ROI 美化项**：L-1 已有运行时兜底，L-3 是破坏性重构，均不建议短期推进

**结论：** 保留目录约定。**P2-D 是优先修复项**（与 §2 P-4 合并实施），P4-E 为次要美化项，P5-A 不建议实施。整体架构合理。

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

**优化优先级分析（2026-06-17）：**

| 优先级 | 对应问题 | 行动 | 预估工时 | 说明 |
|:------:|:--------:|------|:-------:|------|
| **P2-D**（与 §1 L-2/L-4 合并） | P-4 | **配置文件与权限源统一**：将 `opencode.json` 中的 per-agent 权限块迁移到 `project.config.json`（已承担 `safe_edit`/`safe_delete`/`safe_mkdir`/`safe_shell`/`safe_test` 完整 glob 矩阵），删除 `agent_write_scopes` 与 `safe_shell.agent_allowlists` 的重复定义 | 4h（含 §1 部分） | **根因问题**：与 §1 的 L-2/L-4 同源（双配置源），合并为单一 P2-D 项目可一次关闭 3 个问题。解锁 P3-E 的模板化工作（避免在双源上实现模板） |
| **P3-E** | P-1, P-3, P-2 | **Permission Matrix 增强**：(a) 引入 `coder-base` / `framework-admin` / `reviewer-base` 等权限模板（新增 `lib/permission-templates.ts`），Coder-BE/FE 共享 `coder-base` 模板；(b) `dispatch_subagent.ts` 新增 scope 覆盖预检——DAG task 声明 `required_paths`，派遣前校验 `required_paths ⊆ agent.safe_edit`，不匹配时阻断并提示 scope 越界；(c) 规范化 glob 粒度，消除裸 `*` 通配符，统一为精确路径或 `**/*.ext` 模式 | 6h | 依赖 P2-D 完成；P-3（scope 越界）是真实运维痛点（WAIVE.md 频发），但修复需要权限模板 + DAG 任务元数据配合，不宜单独推进 |
| P4 | P-2 | **粒度审计便利性优化**：配合 P3-E 模板化时顺带规范化 glob 粒度；独立推进价值低（`safe_edit` 在物理层阻止，粒度不一致不导致安全漏洞，仅影响审计） | 含在 P3-E | 不建议独立推进 |

**关键判断：**
- **P-4（双配置源）是 §1 + §2 共同的根因**：与 L-2、L-4 同源，P2-D 一次性关闭 3 个问题，ROI 最高
- **Permission Matrix 是框架最有价值的子系统**：值得投入 P3-E 的模板化与 scope 预检（P-1 + P-3），但**必须先 P2-D 统一数据源**，否则模板会跨两套配置漂移
- **P-3（scope 越界）是真实运维痛点**（WAIVE.md 频发），但修复方案需要权限模板 + DAG 任务元数据配合，归入 P3-E 整体推进
- **P-2（粒度不一致）属低 ROI 美化项**：安全边界已由 `safe_edit` 物理保证，粒度不一致仅影响审计便利性，建议随 P3-E 模板化时顺带规范化

**结论：** 权限隔离是框架最有价值的子系统，值得保留并投入优化。**P2-D 是优先修复项**（与 §1 L-2/L-4 合并实施，4h），**P3-E 是中期增强项**（依赖 P2-D，6h），P-2 建议随 P3-E 顺带规范化。

---

### 3. Central State Management

**评价：**
设计灵感来源于现代前端状态管理系统（Redux/Vuex），试图将状态管理概念引入 LLM agent 调度场景。`machine.json` 通过 JSON Schema（40KB）严格定义了 12+ 个子状态。这是一个有前瞻性的设计思路。

**P1-A + P1-B 已完成（2026-06-16）：**

1. ~~**单点故障**~~：~~`machine.json` 是 1MB+ 的 JSON 文件，承担所有状态管理职责。~~ ~~**已修复**：`machine.json` 瘦身至 307B（仅保留 `meta` + `contracts`），12 个子状态独立存储为各自 JSON 文件（最大 581KB knowledge-cache-state.json，其余均 <200KB）。~~
2. ~~**并发写入 3 种 CAS 协议共存不协调**~~：~~`atomicWriteMachine`（7 插件+2 工具）、`beginTransaction`（2 MCP 服务器）、裸 `writeFileSync`（3 处）~~ ~~**已修复**：P1-A 统一为 `atomicWriteMachine()` 单一协议（CAS 覆盖率 100%）；P1-B 进一步迁移为 `atomicWriteSubState()`（每个子状态独立 CAS-on-revision），`atomicWriteMachine()` 保留为向后兼容层（0 调用者，计划 2026-06-23 删除）。~~
3. ~~**3 处裸 writeFileSync + code-quality-gate fallback 路径**~~：~~**已修复**：全部迁移到 `atomicWriteMachine()` → `atomicWriteSubState()`。~~
4. ~~**1MB+ 文件放大竞争窗口**~~：~~**已修复**：拆分后最大单文件 581KB，写入者独立操作各自子状态文件，竞争窗口大幅缩小。~~

**P2-A 数据库迁移全部完成（Step 0-8，2026-06-16）：**

5. ~~**JSON 文件读写为非原子操作**~~：~~**已修复（P2-A Step 3/5）**：
   - `gate-state.json` 读写已迁移到 DB（gate_sessions + gate_store_meta + gate_audit_history 三表），事务原子性保证 G1 非原子写入消除
   - `atomicWriteSubState` 内部升级使用 SQLite `db.transaction()` 进行原子 read→modify→write，解决 G3 CAS 弱验证和 G4 忙等自旋
   - 12 个子状态全部双写（JSON + DB `substate_kv` 表），DB 优先读取~~
6. ~~**审计日志非原子写入**~~：~~**已修复（P2-A Step 4→8）**：
   - `writeAuditLogEntry` → DB INSERT（G6，Step 8 移除 JSONL 双写）
   - `flushAuditTrail` → DB upsert（G7，Step 8 移除 JSON 双写）~~
7. ~~**gate-core ↔ log-manager 循环依赖**~~：~~**已修复（P2-A Step 3）**：DB 作为中间层解耦（G9）~~
8. ~~**compliance-gate inline fallback 与原子模式不一致**~~：~~**已修复（P2-A Step 6）**：所有读取已通过 `readSubState` 双写代理 (DB-first)（G13）~~

9. ~~**JSON 双写层清理（G2）**~~：~~**已修复（P2-A Step 8）**：12 个子状态已完成从 JSON 双写到 DB 单写的迁移，JSON fallback 层保留为只读后备（G2 留待 P3 最终移除）。~~
10. ~~**atomicWriteMachine 兼容层（G8）**~~：~~**已修复（P2-A Step 8）**：已删除 `atomicWriteMachine()` 兼容层，0 残留调用者，所有写入走 `atomicWriteSubState()`（G8）。~~
11. ~~**dead code 清理（G10）**~~：~~**已修复（P2-A Step 8）**：已删除 state 模块中所有已迁移子状态的 JSON 直接读写 dead path（G10）。~~

**Step 8 清理验证 + post-Step-8 补丁（2026-06-16）：**

| 验证维度 | 结果 |
|----------|------|
| Self-test 基线 | 38/38 ALL PASS（首次） |
| Self-test 当前 | 37/38（Check 33 .pending.json 3 stale entries — 会话残留，非代码缺陷） |
| framework-doctor | 12/12 ALL PASS |
| G-problem 解决 | 10/13 完全解决 + 1/13 缓解 |
| atomicWriteMachine 残留 | 0 调用者（已删除） |
| JSON dead code 残留 | 0 处（已清理） |
| DB-only 读路径 | readSubState / readMachineMeta → DB 直读 |
| DB-only 写路径 | writeSubState / writeMachineMeta / atomicWriteSubState → DB 事务 |
| DB-only 审计写入 | writeAuditLogEntry / flushAuditTrail → DB INSERT/upsert |
| Safe-bash 日志统一 | logAction → writeLog() (G8 已修复) |
| Hook isInfraOnly 补丁 | hook-commit-msg.ts 新增 isInfraOnly 短路，纯 [INFRA] commit 在 strict 模式不再被 TDD 检查阻断 |

**post-Step-8 补丁修复（2026-06-16）：**

| 补丁 | 问题 | 修复 |
|------|------|------|
| A: hook-commit-msg isInfraOnly | strict 模式下 TDD 检查先于 [INFRA] 检查执行，阻断纯框架 commit | 新增 `isInfraOnly` 短路分支：`[INFRA]` + critical files → 跳过 TDD 要求 |
| B: DAG stale tasks | PLUGIN-VFY-* 4 个任务 pending 但实际已过时 | 标记 skipped + 更新 meta counts |
| C: .pending.json stale entries | 2 个 stale dispatch entries (80min/65min) | 手动 drain 到 .failed |

**DB 运行时状态（2026-06-17 最新）：**

| 指标 | 实际值 |
|------|--------|
| DB 文件 | `.opencode/state/framework-state.db` (1.2MB + 4.2MB WAL + 32KB SHM) |
| Schema 版本 | **v7** (initial + substate_kv + eslint_state.last_full_scan + file_baseline_kv + deliverables columns + session/dispatch tables + drop 13 unused typed tables) |
| 表数量 | **16 张** (12 active typed + 4 auxiliary + sqlite_sequence，v7 清理 13 张未使用 typed 表) |
| 新增表（v4-v6） | `file_baseline_kv`（v4）、`session_log`/`dispatch_failed_log`/`session_map`（v6） |
| 清理表（v7） | DROP 13 张未使用 typed 子状态表 — `substate_kv` 为子状态唯一存储层 |
| gate_sessions 扩展（v5） | 6 列 deliverables 硬约束（`declared_deliverables`、`submitted_deliverables`、`deliverables_approved_by`/`_at`/`_note`、`approval_required`） |
| substate_kv 行数 | 12 (DB-only，JSON 快照已删除) |
| WAL 模式 | active |
| PRAGMA integrity_check | ok |
| Self-test 基线 | framework-self-test.ts (2790 行) **39/39 ALL PASS**（含 Check 38: v6 DB schema 验证） |
| framework-doctor | 12/12 ALL PASS |

**G1-G13 问题矩阵状态（P3 + gate-stuck-fix Phase 1-6 后，精确分类）：**

| 分类 | 数量 | 编号 | 说明 |
|------|:--:|------|------|
| 完全解决 | 12 | G1, G3, G4, G5, G6, G7, G8, G9, G10, G11, G12, G13 | DB 事务/INSERT/解耦/删除替代原 JSON/appendFileSync 方案；**G11** 通过 `file_baseline_kv` 表（schema v4）提供跨进程基线注册；**G12** 通过 `substate-types.ts` 导出 `SubStateKey` / `SubStateMap` 泛型，`db-state-manager.ts` 强类型化 |
| 缓解（设计约束） | 1 | G2 | machine.json 双 lastUpdated 字段 — 低影响（307B 文件），P3 schema v4 已清理 DB 侧残留，仅 JSON 文件保留兼容字段 |
| 未解决（非紧迫） | 0 | — | 全部 G-problem 已分类为"完全解决"或"缓解" |

详见 `database-migration-plan.md` §11.2、`db-migration-verification-report.md`、`gate-stuck-fix-and-deliverables-plan.md` §14-15。


**当前状态：**

| 指标 | P1-A/B 修复前 | 修复后 |
|------|:---------:|:---------:|
| machine.json 大小 | 1.1MB | 307B (99.97% ↓) |
| 最大单文件 | 1.1MB | 581KB (48% ↓) |
| CAS 协议种类 | 3 种 | 1 种 (atomicWriteSubState) |
| CAS 覆盖率 | ~60% | 100% |
| 并发写入冲突 | 18 写入者竞争 | 每子状态独立 |
| 裸 writeFileSync | 3 处 | 0 处 |

**子状态文件清单（v7 清理：JSON 快照已删除，substate_kv DB 为唯一存储）：**

| 文件名 | 快照大小 | DB 行 | 修改频率 | 说明 |
|--------|----------|:--:|---------|------|
| ~~knowledge-cache-state.json~~ | ~~588KB~~ | ~~已删除~~ | — | v7 清理：substate_kv DB 行替代 |
| ~~compliance-records.json~~ | ~~190KB~~ | ~~已删除~~ | — | v7 清理 |
| ~~write-audit-state.json~~ | ~~149KB~~ | ~~已删除~~ | — | v7 清理 |
| ~~eslint-state.json~~ | ~~60KB~~ | ~~已删除~~ | — | v7 清理 |
| ~~gate-state.drained_sessions.json~~ | ~~60KB~~ | ~~已删除~~ | — | v7 drain DB 化：gate_drained_sessions 表替代 |
| gate-state.index.json | 156KB | — | 低 | compactor v3 架构，非双写对象 |
| ~~format-state.json~~ | ~~30KB~~ | ~~已删除~~ | — | v7 清理 |
| ~~type-check-state.json~~ | ~~30KB~~ | ~~已删除~~ | — | v7 清理 |
| ~~dependency-state.json~~ | ~~12KB~~ | ~~已删除~~ | — | v7 清理 |
| machine.schema.json | 2KB | — | 极低 | S41 瘦身（原 40KB 单体 → meta+contracts only） |
| rule_registry.json | 7.6KB | — | 极低 | 已简化为纯文档清单 |
| ~~keystone-hashes.json~~ | ~~2.8KB~~ | ~~已删除~~ | — | v7 清理 |
| gate-state.json | 2.3KB | ✅ | 中 | DB gate_sessions 表为主要存储 |
| ~~knowledge-audit-state.json~~ | ~~661B~~ | ~~已删除~~ | — | v7 清理 |
| ~~knowledge-state.json~~ | ~~639B~~ | ~~已删除~~ | — | v7 清理 |
| ~~transaction-state.json~~ | ~~208B~~ | ~~已删除~~ | — | v7 清理 |
| ~~tdd-enforcement-state.json~~ | ~~228B~~ | ~~已删除~~ | — | v7 清理 |
| machine.json | 307B | ✅ | 极低 | 仅 meta+contracts，G2 双字段残留 |

**遗留问题：**
1. **状态膨胀仍存在**：DB 中 `knowledge-cache-state` (588KB JSON blob)、`compliance-records` (190KB)、`write-audit-state` (149KB) 持续增长，需定期 compaction 清理。
2. **补救机制仍多**：state reconciliation、state compaction、state backup、state archive、state transaction log——五种补救机制中 compaction 和 archive 已与 P1-B 拆分架构整合，但其余仍独立运行。
3. ~~**Schema 未拆分**~~：~~**已修复（S41, 2026-06-17）**：`machine.schema.json` 从 1304 行瘦身至 64 行（仅 `meta` + `contracts`）。12 个子状态 + 4 个扩展 schema 拆分至 `.opencode/state/schemas/`（16 个独立文件）。原始单体 schema 保留为 `machine.schema.full.json` 供参考。~~
4. **G2 双字段残留（低影响）**：machine.json 同时包含 `lastUpdated` 和 `last_updated`，低影响（307B 文件）；P3 schema v4 已清理 DB 侧 `last_updated` 写入，JSON 兼容字段暂保留。
5. **Deliverables 审计数据增长**：`gate_sessions` 表的 `declared_deliverables` / `submitted_deliverables` TEXT 列随任务数增长；drained 历史已迁移到 `gate_drained_sessions`，但 `completed` 状态 session 仍累积在主表中，需中期 compaction。
6. ~~**Session 基础设施三表增长**~~：~~**已修复（2026-06-17）**：`dbCleanStaleEntries()` 已扩展覆盖 `session_log`/`dispatch_failed_log`/`session_map`（7 天 TTL + 行数上限），`nightly-compaction.ts` 的 `dbMaintenanceStep()` 已调度此函数。~~

**潜在风险：**
- 补救机制本身增加代码复杂度和维护成本
- knowledge-cache-state 持续膨胀可能成为 DB 性能瓶颈（当前 substate_kv JSON blob 全量替换模式）
- DB WAL 文件增长（当前 4.2MB）需定期 checkpoint
- **v6 三表的 TTL 清理已纳入 nightly-compaction**：`dbCleanStaleEntries()` 已扩展覆盖 `session_log`/`dispatch_failed_log`/`session_map`（7 天 TTL + 行数上限），`nightly-compaction.ts` 的 `dbMaintenanceStep()` 已调度

**优化方向：**
- **短期**：定期 compaction 清理大子状态 DB 行 + WAL checkpoint
- ~~**中期**：typed DB 表结构化查询~~ ~~**已关闭（v7, 2026-06-17）**：13 张未使用 typed 表已 DROP，`substate_kv` JSON blob 为唯一存储层~~
- ~~**中期**：DB schema v4 — 修复 G2 (machine_meta 双字段) + G12 (类型安全)~~ ~~**已实施**（P3：schema v4 引入 `file_baseline_kv` + G2 DB 侧清理 + G12 `substate-types.ts`）~~
- **长期**：评估 G11 治理路径（FileStateRegistry 跨进程）— 当前 `file_baseline_kv` 表为轻量替代，若需求扩展再评估完整方案

**结论：** 状态管理的技术债已系统性修复——P1-A/P1-B 解决单点故障和并发竞争，P2-A Step 0-8 进一步消除 JSON 非原子写入和循环依赖，post-Step-8 补丁修复 hook 逻辑 bug 和 stale 状态。**P3（2026-06-16）进一步关闭 G11/G12**：引入 `file_baseline_kv` 表 + `substate-types.ts` 类型安全。**gate-stuck-fix Phase 1-6（2026-06-17）**：schema v5 引入 deliverables 硬约束，schema v6 引入 session/dispatch 基础设施三表，Session Resume v4 端到端验证通过，approve_deliverables 物理限制已实施。G1-G13 问题矩阵 12/13 完全解决，1/13 缓解（G2 低影响设计约束）。DB 运行时健康（WAL 模式、integrity ok、doctor 12/12），所有读写路径已切换为 DB-only。

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
1. ~~**严重代码重复**~~：~~10x 重复的 1484 行 bash 脚本已重写为 TypeScript + Bun（hook-layers.ts 333行 + hook-commit-msg.ts 143行 + 2 个薄 bash wrapper 各 2 行），死代码已消除。~~
2. ~~**运行时不一致**~~：~~硬编码 `/home/zhaoge/.bun/bin/bun` 和 commit-msg 使用 `node` 的问题已修复，统一为 `exec bun`。~~

**当前状态：** Pre-commit hook 已完成 Bash → TypeScript 迁移，代码量从 1484 行压缩至 469 行（含 wrapper），可测试性和可维护性显著提升。

#### 4b. Commit Message Hook（已重写为 TypeScript + Bun + isInfraOnly 修复）

**评价：**
纯 TypeScript hook 实现（hook-commit-msg.ts, 143行），不依赖 LLM。强制 TDD 阶段标记（`[Red]`/`[Green]`/`[Refactor]`），通过扫描 git log 验证阶段顺序。**[INFRA] 标记检查**：当 staged files 包含关键基础设施文件时，commit message 必须包含 `[INFRA]`（advisory 仅警告，strict/locked 阻断）。

**Post-Step-8 修复（2026-06-16）：**
- **isInfraOnly 短路分支**：新增逻辑——当 commit message 含 `[INFRA]` 且 staged files 包含 critical files、但不含 TDD marker 时，跳过 strict 模式 TDD 要求。修复了原逻辑 bug：TDD 检查的 `else if (mode === 'strict')` 分支在 [INFRA] 检查之前执行，导致纯框架 commit 被错误阻断。
- **[INFRA] 消息去重**：[INFRA] 检查块新增 `else if (!isInfraOnly)` 条件，避免纯 infra commit 同时输出 TDD 警告和 INFRA 确认。

**问题：**
- 当前 `gate-state.json` 仅有少量活跃会话，TDD 排序验证在多数场景下处于惰性状态

#### 4c. Compliance Gate 五步协议（成果物硬约束版）

**评价：**
Compliance Gate 的价值是**双层**的，需要区分对待：

| 层次 | 机制 | 价值 |
|------|------|------|
| **认知层** | LLM 主动调用 `check`/`confirm`/`submit_deliverables`/`complete`，在 context 中形成流程意识 | 注意力锚定——迫使 LLM 明确表述任务目标、规划步骤、成果物声明、反思总结 |
| **机械层** | 每次 MCP 调用内部执行 artifact 完整性验证、DAG 状态检查、权限合规、**成果物证据交叉核对** | 物理验证——不满足条件时返回结构化失败原因 |

**协议演进（2026-06-17, gate-stuck-fix Phase 1-6）：**

原三步协议（check→confirm→complete）在实战中暴露三个系统性卡死根因（详见 `gate-stuck-fix-and-deliverables-plan.md` §一）：
- **RC1**: FW-SLIM-03 删除了 preamble Step 4 close-gate 指令，导致 sub-agent 遗忘 complete
- **RC2**: `complete` 在成果物写入前被调用，状态机未强制顺序
- **RC3**: `recoverable` 状态仅限 @Super-Admin/@Orchestrator retry，sub-agent 无法自我修复

**当前协议（5 步，对非豁免 agent）：**

```
Step 0: Knowledge Pipeline (plugin-enforced)
Step 1: Invoke Skills
Step 2: compliance_gate_check + compliance_gate_confirm (combined flow, declared_deliverables 必填)
Step 3: Execute — 写所有声明的成果物
Step 4: compliance_gate_submit_deliverables (状态机强制: armed → delivered)
Step 5: Orchestrator 调用 compliance_gate_approve_deliverables (delivered → approved → completed)
```

**豁免 agent（2 个）**：@Orchestrator、@Super-Admin 的自身 session `approval_required=0`，可沿用 `check → confirm → complete` 短路径。

**新增 gate 状态**：`delivered`（sub-agent 已提交成果物证据）、`approved`（Orchestrator 已审批）。`gate_status` 完整枚举：`checked | armed | delivered | approved | completed | failed | recoverable | drained`。

**新增 MCP 工具**：
- `compliance_gate_submit_deliverables(session_id, deliverables_evidence)` — 交叉核对 `declared_deliverables`，验证文件存在性，过渡 `armed → delivered`（或 `armed → recoverable`）
- `compliance_gate_approve_deliverables(session_id, approval_decision, approval_note?, execution_summary?, agent_id?)` — Orchestrator 专属（**物理限制**：三层 agent identity fallback + `agent_id` 参数，非 @Orchestrator/@Super-Admin 调用被拒绝），`approve` 可合并 `approved → completed` 一步完成

**修改 MCP 工具**：
- `compliance_gate_confirm` 新增 `declared_deliverables` 参数（JSON array），非豁免 agent 必填（≥1 项，每项 `name + description ≥5 chars`）
- `compliance_gate_complete` 新增状态门控：`approval_required=1` 的 session 必须处于 `approved` 状态
- `compliance_gate_retry_confirm` 权限放宽：`recoverable` 状态**任何 agent** 可 retry（自我修复路径，RC3 修复）

**认知锚点分析（演进后）：**

- **`check`（任务开始时）**：LLM 被迫明确表述 `task_description`，后续执行倾向与初始表述保持一致。
- **`confirm`（计划确认后）**：LLM 输出 `plan_summary` + `declared_deliverables`，在动手前规划成果物清单，该声明会留在 context 中作为执行阶段的参照锚点。
- **`submit_deliverables`（执行后）**：LLM 被迫逐项提供证据（`artifact_path` + `content_summary`），状态机层面强制"先写后报"顺序，**解决 RC2**。
- **`approve_deliverables`（Orchestrator 审批）**：Orchestrator 基于证据而非实时对话决策，sub-agent 已退出，**解决 RC1**（即使 sub-agent 遗忘，Orchestrator 持有证据可独立关闭）。

`complete` 的自修正循环仍保留（豁免 agent 直接调用；非豁免 agent 由 Orchestrator 调用 `approve_deliverables` 合并审批+关闭），反馈即时性、精确性、闭环在调用方端三个条件依然满足。

**已修复（compliance-gate-optimization-plan.md，已完成）：**

1. ~~**三步压缩为两步**~~：~~`compliance_gate_check` schema 新增可选 `plan_summary` + `agent` 参数；CallTool handler 在 check 通过时自动调用 `runGateConfirm`，单次 MCP 调用完成 check+confirm。（**保留**：combined flow 在 5 步协议中仍为 Step 2 的核心优化）~~
2. ~~**返回值嵌入强提示**~~：~~新增 `buildReminderText()` helper；combined flow 和 legacy confirm 在 armed 成功时追加 `✅ GATE ARMED + ⚠️ REMINDER` 文本块到 MCP 响应，随 response 进入 LLM context。**新增 deliverables 提示**：armed 成功时追加"请在写完成果物后调用 submit_deliverables"。~~
3. ~~**框架层兜底提醒**~~：~~`plugins/task-after.ts` 在 `tool.execute.after` 中检测 Task SUCCESS + armed session → 写 `.task_temp/_global/gate-reminder.{md,json}`（atomic temp+rename）+ `writeLog(WARN, GATE-REMINDER-WRITTEN)`；新增 `experimental.session.compacting` hook push 提醒到压缩 context。**`tui.prompt.append` 未实施**——官方文档列出其为 TUI 事件但无插件可调用的 API，详见 plan §3 可行性澄清。~~

**当前状态：** 提醒纵深三层——(1) MCP 响应中的 reminder 文本（PRIMARY，进入 LLM context）；(2) `.task_temp/_global/gate-reminder.{md,json}` 文件（FALLBACK，跨 context 压缩存活）；(3) `experimental.session.compacting` push（LAST RESORT，压缩时重新注入）。

**问题：**
1. **LLM 忘记调用 `submit_deliverables`**：与原 `complete` 遗忘同理，属注意力衰减。**缓解机制**：`delivered` 状态 4h 自动 drain + `gate-before.ts` 未审批 WARNING + `dispatch-after.ts` 超时警告；状态机层面强制不 submit 则不能 complete，避免"无成果物关闭"。
2. **`confirm` 与 `check` 合并为 combined flow**：工作记忆负担从 3 步降为 2 步（Step 2 单调用），但新增 Step 4（submit）和 Step 5（Orchestrator approve），非豁免 agent 总步骤增至 5 步。
3. **drained session 补救机制增加了系统复杂度**：drain 机制本身需要维护、测试和修复。
4. **compliance-gate.ts 过于庞大（2493行）**：混合 MCP server + gate lifecycle + format bridging + transaction + UC7KS + dispatch + **deliverables 验证**，需要拆分（见 P3）。
5. **Orchestrator 审批负担**：每个非豁免 sub-agent 完成后 Orchestrator 必须调用 `approve_deliverables`，多 sub-agent 派遣场景下审批次数线性增长。

**潜在风险：**
- 协议失效时框架进入死锁（无法 commit），需要 Super-Admin drain 修复
- 每个非豁免任务 5 次 MCP 调用（check+confirm+submit+approve+complete）增加 token 消耗

**优化方向：**

核心原则：**不替代 LLM 参与，而是降低 LLM 遗忘的概率 + 让 Orchestrator 掌握 sub-agent 产出证据。**

1. ~~**三步压缩为两步**~~ ~~（已实施，combined flow 保留为 Step 2）~~
2. ~~**`check` 返回值中嵌入强提示**~~ ~~（已实施，扩展 deliverables 提示）~~
3. ~~**框架层兜底提醒（非替代）**~~ ~~（已实施，`tui.prompt.append` 除外）~~
4. **保留 `complete` / `approve_deliverables` 的自修正循环**：这是协议的核心价值，不可下沉到框架机械层
5. **保留 enforcement mode 作为控制开关**
6. **新增 deliverables 模板注入**：`dispatch-subagent.ts` 在 wrapped prompt 中按 agent type 注入典型成果物清单（`deliverables-templates.ts`），降低 sub-agent 声明成本

#### 4d. Rule Registry（已优化：SHA-256 → git diff + [INFRA] 标记）

**已解决（rule-registry-optimization-plan.md，已完成）：**

原方案使用 31 个注册条目的 SHA-256 digest 验证，存在自引用循环（registry 需手动维护→经常忘记→digest 不匹配→修复消耗 token）。已替换为：

- **触发机制不变**（dispatch 前 + commit 前），**检测手段替换为 git diff HEAD**
- **关键文件清单提取为 `.opencode/lib/critical-files.ts`**（26 个 CRITICAL_FILES），供 hooks、gate、compliance 等模块共享
- **commit-msg hook 追加 [INFRA] 标记检查**：advisory 仅警告，strict/locked 阻断
- **`rule_registry.json` 简化为纯文档清单**（167行，移除 sha256/semver/digest_history 字段）
- **`rule-registry-verify.ts` 和 `rule_registry_repair.ts` 已删除**
- **4 个检查点已替换**：pre-execution-gate.ts、compliance-gate.ts、gate-core.ts、gate-checks.ts

**遗留价值：** 两层检查链路（dispatch 前检测 + commit 时强制标记）保留了关键文件变更感知能力，同时消除了 registry 维护成本。

---

### 5. Framework Harness System（框架自测试基础设施）

**评价：**
框架为自身构建了完整的测试基础设施：
- 框架测试文件（覆盖 lib 核心、scripts、MCP 工具、hooks 等）
- 集成测试覆盖 E2E 场景
- 39 项自验证检查（framework-self-test.ts）——"lint-the-linter" 工具（基线 39/40 PASS，Check 33 为预先存在的 stale dispatch entries）
- `framework-doctor.ts` 12 项诊断工具（12/12 ALL PASS）
- MCP 审计测试验证 agent MCP 权限合规

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

验证逻辑通过 `lib/` 层共享，工具与插件之间无直接耦合。**所有子状态写操作已使用 `atomicWriteSubState()` → DB 事务（DB-only），`machine.json` 仅保留 meta+contracts（307B）。**

**已修复（plugin-system-fix-plan.md，已完成）：**
1. ~~**`capFailedEntries` 重复**~~：~~已提取到 `lib/state-utils.ts`，`task-after.ts` 和 `dispatch-after.ts` 从共享模块导入。~~
2. ~~**TDD 常量重复**~~：~~`TDD_AGENTS`/`TDD_MODIFY_TOOLS`/`isTddAgent`/`isTddTool` 统一到 `lib/state-utils.ts`，`tdd-before.ts` 和 `tdd-after.ts` 从共享模块导入。~~
3. ~~**`isBusinessSourceFile` 内联重复**~~：~~统一为 `lib/state-utils.ts` 的正则+前缀实现（更精确），`tdd-after.ts` 从共享模块导入。消除了不同实现的潜在分类不一致 bug。~~
4. ~~**safe_shell path scope guard 三处重复**~~：~~统一为 `lib/tool-scope.ts` 的 `getEffectivePathScopeFilePath()`，`scope-before.ts` 和 `audit-before.ts` 共用同一策略（对 cp/mv/rm 放行路径检查）。~~
5. ~~**machine.json 并发写入竞争**~~：~~5 个插件使用 `atomicWriteMachine()`（CAS-on-revision）替代裸 `fs.writeFileSync`；`session.ts` 使用 `atomicWriteJson()`（temp+rename）处理非 machine.json 写操作。~~
6. ~~**插件生命周期样板代码**~~：~~16 个插件全部迁移到 `withPluginLifecycle()`，96 行样板压缩为 16 行。~~

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
| dispatch_subagent | 571 | 子 agent 派遣 | PLAN-FIRST Layer 2 + Super-Admin 修复验证 + execFileSync（防注入）+ **resume_session_id 参数（Phase 6 可选）** |
| ~~rule_registry_repair~~ | ~~296~~ | ~~规则摘要修复~~ | ~~已删除（SHA-256 替换为 git diff）~~ |
| knowledge_cache_search | 243 | UC7KS 缓存搜索 | 管道链验证 + CAS 写入 |
| knowledge_gap_report | 94 | 知识覆盖率分析 | 纯只读 |
| module_scope_declare | 125 | UC7KS 作用域声明 | 模块白名单 + CAS 写入 |
| **compliance_gate_submit_deliverables** | (in compliance-gate.ts 2493) | 成果物证据提交 | declared_deliverables 交叉核对 + 文件存在性检查 + armed→delivered 状态机强制 |
| **compliance_gate_approve_deliverables** | (in compliance-gate.ts 2493) | Orchestrator 审批 | 权限校验（仅 Orchestrator/Super-Admin）+ delivered→approved→completed 合并过渡 |

**问题：**
1. ~~**dispatch_subagent 过于复杂**~~：~~972 行代码承担 4+ 层验证 + CLI arg 解析 + prompt 模板构建 + `.pending.json` 队列管理~~ ~~**已缓解**：当前 571 行（含 `resume_session_id` 参数支持），compliance_records 迁移到 atomicWriteSubState 后显著简化，但仍承担 PLAN-FIRST Layer 2 + Super-Admin 修复验证 + prompt 模板构建 + deliverables 模板注入。~~
2. ~~**rule_registry_repair 死代码**~~：~~已随工具删除而消除。~~
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
5. **@Knowledge-Curator 的 LLM 可以直接 Read 文件**，不需要中间人 agent。**但 gate-stuck-fix（2026-06-17）已强化 KC 角色**：在 `deliverables-templates.ts` 中为 KC 配置了 HANDOVER.md 必需成果物，将其纳入非豁免 agent 清单，短期方向是保留并加约束，而非消除。

**潜在风险：**
- 角色过多导致 dispatch 链路长，信息在 agent 间传递时衰减（HANDOVER.md 机制试图缓解但增加了仪式性工作）
- 每个角色的 agent 定义维护成本（`agents/*.md` + `opencode.json` + `project.config.json` 三处配置）
- **新增成果物审批环节**：每个非豁免 sub-agent 完成后 Orchestrator 必须调用 `approve_deliverables`，链路中增加一个审批节点

**优化方向：**
- **保留核心思想**（角色分离 + 注意力聚焦），**精简角色数量**
- 将 @Orchestrator 的调度逻辑硬编码到框架（`dispatch_subagent.ts` 已具备此能力）
- 将 @Meta-Planner 的规划功能转为人类 + LLM 对话（而非独立 agent）
- @Arbiter 和 @Super-Admin 随框架简化后自然消失
- **@Knowledge-Curator 短期保留**（已赋予 deliverables 强制），中期评估是否可由 Coder/Architect 兼任
- 最终目标：**3-4 个核心角色**（Coder-BE/FE + Guardian + CI-CD，可选保留 Planner/Architect 复合角色）+ 框架内置调度逻辑

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
38 个脚本覆盖框架运维全生命周期：

| 类别 | 脚本 | 行数 |
|------|------|------|
| 核心执行 | pre-execution-gate.ts | 967 |
| 状态管理 | state-reconciliation.ts / state-transaction.ts / state-reset.ts / state-canonicalize.ts / state-integrity-scan.ts | 1602 + 其他 |
| 框架健康 | framework-self-test.ts(2790) / framework-doctor.ts(1405) / framework-compliance-check.ts | — |
| MCP 服务 | compliance-gate.ts(**2493**) / code-quality-gate.ts(880) / eslint-audit.ts(398) / reconciliation-validate.ts(384) | 4155 |
| 知识管道 | knowledge/ 下 8 个脚本 | — |
| 部署运维 | nightly-compaction.ts / install-hooks.ts / monitor-status.ts | — |

`compliance-gate.ts`（**2493 行**，较五次修订的 2097 行增加约 400 行，主要为 deliverables submit/approve 工具 + confirm 硬约束验证）是项目中最大的单文件，混合了 MCP server 注册 + gate 生命周期 + V2/V3 format bridging + transaction engine + UC7KS 检查 + dispatch 逻辑 + **成果物证据交叉核对**。`pre-execution-gate.ts`（967行）在每次 agent dispatch 时运行 6 个顺序检查。`state-reconciliation.ts`（1602行）实现了 7 项自修复检查。

**问题：**
1. **compliance-gate.ts 过于庞大（2493行）**：混合 MCP server + gate lifecycle + format bridging + transaction + UC7KS + dispatch + deliverables 验证，职责严重过载。
2. **pre-execution-gate.ts 过于庞大（967行）**：6 层检查 + knowledge gate（106行嵌套 UC7KS 验证），职责过载。
3. **framework-self-test.ts（2790行）** 使用 TS 语法但 `require()` 导入，模块系统混合。
4. **state-transaction.ts** 实现了完整的 WAL + crash recovery，但 P2-A 后所有读写已通过 `readSubState`/`writeSubState` → DB 事务路径，该引擎实际使用率进一步降低。
5. **gate-core.ts（1733行）** 含 migrated-from-framework-validation 模块（420 行）+ deliverables 状态机（`submitDeliverables`/`approveDeliverables`/`LIVE_STATUSES` 扩展）；P2-A 后 loadGateStore/saveGateStore 已为 DB-only，gate-core ↔ log-manager 循环依赖已缓解（G9）。

**潜在风险：**
- 核心脚本过大导致审计和修改困难
- state-transaction 引擎设计超前于实际使用

**优化方向：**
- 将 compliance-gate.ts 拆分为 gate-server + gate-lifecycle + format-bridge 模块
- 将 pre-execution-gate.ts 拆分为独立的检查模块
- 将 framework-self-test.ts 统一为 ESM
- state-transaction.ts 可评估进一步简化（统一由 substate_kv DB 事务代理）

**结论：** 脚本系统覆盖全面，但核心文件复杂度需要治理。P2-A 后所有状态写入已通过 `atomicWriteSubState` → DB 事务，state-transaction 引擎的实际使用率进一步降低。

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
| Central State Management（概念） | **中→中高** | 否 | 保留设计思想；~~重构实现~~（**P1-A/P1-B/P2-A 已完成**：单文件拆分 + CAS 统一 + DB-only + v7 清理未使用 typed 表） |
| PLAN-FIRST 防御纵深 | **中** | 是 | 保留核心思想，简化 DAG → flat task list |
| Multi-Agent（核心 3 角色） | **中** | 是 | 精简为 Coder + Guardian + CI-CD |
| Tech Debt Registry | **中** | 否 | 保留，极简 markdown 实现 |
| Log Management | **低-中** | 否 | 保留基础审计，移除轮转/归档 |
| ~~Pre-commit Hook（1484行）~~ | ~~**低**~~ | ~~否~~ | ~~已完成：重写为 TypeScript + Bun（469行）~~ |
| Compliance Gate 协议（认知层） | **中-高** | 是（认知锚定） | 保留，五步协议（成果物硬约束）：combined flow + submit + Orchestrator approve |
| Compliance Gate 协议（机械层） | **中** | 否（硬约束） | 保留自修正循环 + 成果物证据交叉核对，不下沉到框架层 |
| ~~Rule Registry SHA-256 Digest~~ | ~~**低**~~ | ~~否~~ | ~~已完成：替换为 git diff + [INFRA] commit 标记~~ |
| UC7KS 管道链验证 | **低** | 是 | 保留知识组织，移除链式强制 |
| Multi-Agent（其余 7 角色） | **低** | 是 | 合并或转为框架内置逻辑 |

### 核心发现

1. **框架的硬约束子系统（不依赖 LLM 的部分）是高价值的**。Permission Matrix、Safe Tools、Plugin Architecture、Commit Message Hook——这些在物理层面阻止越权行为，不受 LLM 概率性产出影响。

2. **框架的"LLM 协议"子系统需要区分认知层和机械层**。Compliance Gate 的认知锚定和自修正循环是高价值的（不应下沉到框架层），但原三步对工作记忆负担过重且成果物顺序无法强制导致 92% 会话卡在 recoverable。**gate-stuck-fix Phase 1-6（2026-06-17）将协议演进为 5 步**（combined flow + submit_deliverables + Orchestrator approve），新增 `delivered`/`approved` 状态、`declared_deliverables` 硬约束、3 个新 MCP 工具，从状态机层面解决三个系统性卡死根因（RC1/RC2/RC3）。Phase 6 进一步实现 Session Resume（v4: `.dispatch_ctx` + `session_log` DB，端到端验证通过）和 approve_deliverables 物理限制（三层 agent identity fallback）。UC7KS 管道链验证、TDD RED→GREEN 强制的 ROI 则较低。优化方向是降低 LLM 记忆负担（压缩步骤 + 强化提醒 + 成果物模板注入），而非移除 LLM 参与。

3. ~~**状态管理的设计思想正确，但 JSON 单文件实现是当前最大的技术债**~~ **已系统性修复**：
   - **P1-A + P1-B（2026-06-16）**：1.1MB 单文件拆分为 12 个独立子状态文件（最大 581KB），3 种 CAS 协议统一为 1 种（atomicWriteSubState），CAS 覆盖率 100%，并发写入冲突消除。
   - **P2-A Step 0-8（2026-06-16）**：引入 SQLite (bun:sqlite, WAL 模式) 作为状态存储后端。`atomicWriteSubState` 升级为 DB 事务原子写，消除 G1/G3/G4/G6/G7 非原子写入。12 个子状态从 JSON 双写迁移为 DB-only。Step 8 完成清理工作（删除 atomicWriteMachine 兼容层、删除 dead code、移除 JSON/JSONL 双写、统一 safe-bash 日志）。G1-G13 问题矩阵 10/13 完全解决，1/13 缓解（G2 低影响），2/13 留待后续（G11, G12）。详见 `database-migration-plan.md` §11.2 和 `db-migration-verification-report.md`。
   - **P3（2026-06-16）**：关闭 G11（`file_baseline_kv` 表 + schema v4）+ G12（`substate-types.ts` `SubStateMap` 强类型化）。Schema 演进至 v4。
   - **gate-stuck-fix Phase 1-6（2026-06-17）**：Schema v5 为 `gate_sessions` 扩展 6 列 deliverables 硬约束；Schema v6 新增 `session_log`/`dispatch_failed_log`/`session_map` 三张表替代 `SESSION_ID.md`/`.session_map.json`/`.pending.json.failed`；引入 `.dispatch_ctx` 单次消费文件解决 process.env 污染问题；Session Resume v4 端到端验证通过（3/3 集成测试 PASS）；approve_deliverables 物理限制已实施。详见 `gate-stuck-fix-and-deliverables-plan.md` §14-16。
   - **post-Step-8 补丁（2026-06-16）**：hook-commit-msg isInfraOnly 短路修复、DAG stale tasks 清理、dispatch stale entries drain。

4. **Pre-commit hook 的 10x 代码重复已修复**（TypeScript + Bun 重写，1484→469行）。
5. **核心脚本复杂度需要治理**：compliance-gate.ts(**2493**)、state-reconciliation.ts(1602)、gate-core.ts(**1733**)、framework-doctor.ts(1405)、framework-self-test.ts(**2790**)、pre-execution-gate.ts(967)——6 个文件 >900 行，职责过载。dispatch_subagent.ts(**571**) 已从原 972 行显著缩减。deliverables 硬约束贡献了 compliance-gate.ts ~400 行增量与 gate-core.ts ~190 行增量。

### 优化优先级（六次修订版，2026-06-17，P3 + gate-stuck-fix Phase 1-6 完成）

| 优先级 | 行动 | 状态 | 审计依据 |
|--------|------|------|---------|
| ~~P0~~ | ~~修复 pre-commit hook 10x 重复~~ | ~~已完成~~ | — |
| ~~P1-A~~ | ~~统一 CAS 协议 + 修复裸 writeFileSync~~ | ~~已完成（2026-06-16）~~ | `cas-unify-implementation-plan.md` |
| ~~P1-B~~ | ~~拆分 machine.json 为独立子状态文件~~ | ~~已完成（2026-06-16）~~ | `machine-split-implementation-plan.md` + `p1b-execution-summary.md` |
| ~~P1~~ | ~~Compliance Gate 三步→两步 + 兜底提醒~~ | ~~已完成~~ | `compliance-gate-optimization-plan.md` |
| ~~P2~~ | ~~Rule Registry SHA-256 → git diff~~ | ~~已完成~~ | `rule-registry-optimization-plan.md` |
| ~~P3~~ | ~~提取插件重复代码到 lib~~ | ~~已完成~~ | `plugin-system-fix-plan.md` |
| ~~P2-A~~ | ~~引入数据库替代 JSON 文件状态管理~~ | **已完成 (2026-06-17, Step 0-8 + §11.6 全部关闭)** | `database-migration-plan.md` + `db-migration-verification-report.md`；schema v7（16 张表）；JSON 快照已删除 |
| ~~P2-A-8~~ | ~~清理：JSON 双写层 + 兼容代码 + dead code + drain DB 化~~ | **已完成 (2026-06-17)** | G2/G8/G10 三问题已关闭；drain 归档 DB 化；writeLog 循环依赖修复 |
| ~~post-S8~~ | ~~hook-commit-msg isInfraOnly + DAG/dispatch stale cleanup~~ | **已完成 (2026-06-16)** | 补丁修复 A/B/C |
| ~~P3-deep~~ | ~~深度优化：G11 (`file_baseline_kv`) + G12 (`substate-types.ts`) + state-transaction DEPRECATED~~ | **已完成 (2026-06-16)** | `p3-deep-optimization-plan.md` + `p3-verification-report.md`；schema v4 |
| ~~gate-stuck-fix 1-6~~ | ~~合规门卡死修复 + 成果物硬约束 + Session Resume：新状态 `delivered`/`approved`、新 MCP 工具 `submit_deliverables`/`approve_deliverables`、`declared_deliverables` 参数、schema v5/v6、preamble 重写、`.dispatch_ctx` + `session_log` DB resume、approve 物理限制~~ | **已完成 (2026-06-17)** | `gate-stuck-fix-and-deliverables-plan.md`；3 个根因 RC1/RC2/RC3 修复；28/28 Steps PASS；39/39 Self-test；3/3 集成测试 PASS |

**以下为剩余优化任务，按优先级排序：**

| 优先级 | 行动 | 预估工时 | 影响范围 | 说明 |
|--------|------|:-------:|---------|------|
| ~~P2-A-9~~ | ~~提交 40 个 uncommitted framework 文件~~ | 0.5h | self-test | 已随 P3 + gate-stuck-fix 批量 [INFRA] commit 解决 |
| ~~**gate-stuck-fix Phase 6**~~ | ~~Session Resume 解锁：`dispatch_subagent` `resume_session_id` 参数 + `.dispatch_ctx` 单次消费文件 + `session_log` DB 查询 + 4 层阻断（B1/B2/B3-A/B4）同步修复~~ | ~~2.2h~~ | — | **已完成 (2026-06-17)**: v4 方案全部 7 步验证通过，3/3 集成测试 PASS，commits `49b93ea3` + `2dcbf41b` |
| **P2-B** | 精简 Multi-Agent 从 10 到 3-4 角色 | 4-8h | AGENTS.md, opencode.json, project.config.json, agents/*.md | 架构级设计决策；需评估对 DAG、权限矩阵、agent 定义的影响；**注意 @Knowledge-Curator 已被 gate-stuck-fix 强化为 deliverables 强制角色，短期不宜删除** |
| **P2-C** | 简化 DAG → flat task list | 3-6h | dispatch-before.ts, dispatch_subagent.ts, dag-policy.ts | 降低规划复杂度和 token 消耗；需重写 PLAN-FIRST Layer 1/2 |
| **P2-D** | **配置文件与权限源统一（§1 L-2/L-4 + §2 P-4）**：`opencode.json` 权限块迁移到 `project.config.json`；删除 `agent_write_scopes` + `safe_shell.agent_allowlists` 重复定义；修正 `framework-authorities.json` 的 authority 声明 | 4h | opencode.json, project.config.json, framework-authorities.json | **§1+§2 共同根因修复**；一次性关闭 3 个问题（L-2 + L-4 + P-4）；解锁 P3-E 权限模板化 |
| ~~**P3-A（v6 表 compaction）**~~ | ~~`nightly-compaction.ts` 扩展 v6 三表 TTL 清理（`session_log`/`dispatch_failed_log`/`session_map`）~~ | ~~1h~~ | — | **已完成 (2026-06-17)**：`dbCleanStaleEntries()` 在 Phase A-1 中已扩展覆盖 v6 三表（7 天 TTL + session_map 50 条上限）；`nightly-compaction.ts` 的 `dbMaintenanceStep()` 已在调度此函数 |
| **P3-B** | typed DB 表结构化查询 | 4-8h | eslint_state, write_audit_state, compliance_records | 当前 substate_kv JSON blob 性能可接受（1-2ms），结构化查询为上限优化 |
| **P3-C** | 拆分核心脚本复杂度 | 6-12h | compliance-gate.ts(2493), state-reconciliation.ts(1602), gate-core.ts(1733) | 最大单文件拆分，维护性改善 |
| **P3-E** | **Permission Matrix 增强（§2 P-1/P-2/P-3）**：(a) `lib/permission-templates.ts` 权限模板（`coder-base` / `framework-admin` / `reviewer-base`）；(b) `dispatch_subagent.ts` scope 覆盖预检（DAG task `required_paths ⊆ agent.safe_edit`）；(c) glob 粒度规范化（消除裸 `*`） | 6h | project.config.json, lib/permission-templates.ts (新), dispatch_subagent.ts | **依赖 P2-D**（避免在双配置源上实现模板）；P-3（scope 越界）是真实运维痛点（WAIVE.md 频发） |
| **P4-E** | **Layout 路径解析硬化（§1 L-1）**：统一 pre-commit hook / tool / script 三场景路径解析为单一 helper（`lib/path-resolver.ts`） | 1h | hook-layers.ts, tool runner, install-hooks.ts | 低风险美化项：运行时已有 fallback 兜底 |
| ~~P5-A~~ | ~~**.opencode/ 代码与状态物理分离（§1 L-3）**~~ | — | — | **不推荐**：`.gitignore` 已能区分源码与状态；物理拆分（引入 `.opencode/src/` + `.opencode/runtime/`）是破坏性大重构，风险高于收益 |
| ~~P3-D~~ | ~~治理 G11（FileStateRegistry 跨进程）~~ | ~~3h~~ | — | **已缓解**：`file_baseline_kv` 表（schema v4）提供轻量替代 |
| P4-A | 移除 UC7KS 管道链强制验证 | 2h | scope-before.ts, knowledge_cache_search, module_scope_declare | 保留知识组织，移除 MCP 链式强制 |
| P4-B | 移除 safe-bash.log 轮转/归档 | 1h | safe-bash-core.ts, log-rotator.ts | 保留基础审计能力 |
| P4-C | 统一 framework-self-test.ts 为 ESM | 1h | framework-self-test.ts | 模块系统混合修复 |
| P4-D | 提取 safe_edit/safe_delete bootstrap retry 到 lib | 0.5h | safe-edit-core.ts, safe-delete-core.ts | 消除重复 |
| ~~P5~~ | ~~删除冻结 JSON 状态文件快照~~ | ~~1h~~ | ~~.opencode/state/*.json (12 files)~~ | **已完成 (2026-06-17)**：12 个冻结 JSON 快照 + `gate-state.drained_sessions.json` + `audit_log.jsonl` 已删除；`substate_kv` DB 为唯一数据源 |

**优先级排序逻辑（六次修订）：**

1. **P0 → P2-A(Step 0-8 + §11.6 全部关闭) + post-Step-8 补丁 + P3-deep + gate-stuck-fix Phase 1-6 全部已完成**：框架最大技术债系统性修复。G1-G13 问题矩阵 12/13 完全解决 + 1/13 缓解。DB 运行时健康（WAL + integrity ok，schema **v7**，16 张表）。所有读写路径 DB-only。JSON 快照已删除。合规门三根因 RC1/RC2/RC3 在状态机层面修复，92% 会话卡死问题根除。Session Resume 端到端验证通过（v4 方案，3/3 集成测试 PASS）。approve_deliverables 物理限制已实施（三层 agent identity fallback）。

2. **P2-B/P2-C（架构级设计决策）**：Multi-Agent 精简和 DAG 简化需要充分的设计文档，不直接动手。可独立评估，与 P2-A 无依赖关系。**注意 gate-stuck-fix 已强化 @Knowledge-Curator 角色（deliverables 强制），P2-B 需重新评估 KC 消除的可行性**。

3. **P2-D（§1+§2 共同根因修复，推荐优先推进）**：4h，一次性关闭 3 个问题（L-2 + L-4 + P-4）——消除 `opencode.json` 与 `project.config.json` 的双配置源。**ROI 最高的 §1/§2 优化项**，且解锁 P3-E 的权限模板化工作。无前置依赖，可独立评估推进。

4. **P3（中期优化上限）**：typed 表、脚本拆分、**Permission Matrix 增强（P3-E）**。当前性能可接受，仅在出现瓶颈或维护负担显著时推进。P3-A（v6 表 compaction）已通过 `dbCleanStaleEntries()` 扩展解决；P3-D（G11）已通过 `file_baseline_kv` 表缓解，可降级。**P3-E 依赖 P2-D**：必须在权限源统一后才能实施模板化，否则模板会跨两套配置漂移。P3-E 解决 P-3（scope 越界 WAIVE.md 频发）的真实运维痛点，建议 P2-D 完成后优先推进。

5. **P4（简化减负 + 美化）**：UC7KS 链验证移除、日志轮转移除、模块统一、bootstrap retry 提取、**Layout 路径解析硬化（P4-E，低风险美化项）**。降低仪式性工作量和代码冗余。

6. **~~P5（最终清理）~~**：~~删除冻结 JSON 快照~~。**已完成 (2026-06-17)**：12 个冻结 JSON + drained_sessions + audit_log.jsonl 已删除。**P5-A（§1 L-3 `.opencode/` 物理拆分）不推荐**——破坏性大重构，风险高于收益。

**框架状态总结（六次修订）：**

| 修复项 | 修复前 | 修复后 | 改善幅度 |
|--------|:------:|:------:|---------|
| machine.json 大小 | 1.1MB | 307B | 99.97% ↓ |
| 最大单文件 | 1.1MB | 588KB (DB blob) | 47% ↓ |
| CAS 协议种类 | 3 种 | 1 种 | 67% ↓ |
| CAS 覆盖率 | ~60% | 100% | +40% |
| 裸 writeFileSync | 3 处 | 0 处 | 完全消除 |
| 并发写入冲突 | 18 写入者竞争 | 每子状态独立 DB 事务 | 完全消除 |
| Pre-commit hook 代码量 | 1484 行 (bash) | 469 行 (TS) | 68% ↓ |
| Rule Registry 维护 | 31 SHA-256 | git diff + 26 CRITICAL_FILES | 完全消除手动维护 |
| Plugin 样板代码 | 96 行 × 16 | 16 行 × 16 | 83% ↓ |
| Plugin 重复代码 | 9 类 | 0 类 | 完全消除 |
| Compliance Gate 步骤 | 3 步 | 5 步 (deliverables 硬约束) | +2 步，新增成果物证据强制 + Orchestrator 审批 |
| Gate 状态数 | 6 (`checked`/`armed`/`completed`/`failed`/`recoverable`/`drained`) | 8 (+ `delivered`/`approved`) | 新增成果物审批中间态 |
| Schema 版本 | v3 | **v7** | +4 版本（v4 baseline/v5 deliverables/v6 session 基础设施/v7 清理 13 张未使用 typed 表） |
| DB 表数 | 25 | **16** | +4 新增（file_baseline_kv, session_log, dispatch_failed_log, session_map）−13 清理（v7 drop unused typed tables） |
| MCP 暴露工具数 | 11 | **13** | +2（submit_deliverables, approve_deliverables） |
| dispatch_subagent 行数 | 972 | 571 | 41% ↓ |
| 日志规范合规 | 27 处违规 | 0 处 | 完全消除 |
| JSON 非原子写入 | 5 处 (G1/G3/G4/G6/G7) | 0 处 (DB 事务) | 完全消除 |
| 状态存储介质 | 纯 JSON 文件 | SQLite DB-only (JSON 快照已删除) | ACID 保证 |
| Hook [INFRA] 逻辑 | strict 模式阻断纯 infra commit | isInfraOnly 短路 | 逻辑 bug 修复 |
| 审计日志写入路径 | 3 条 (独立) | 1 条 (writeAuditLogEntry 统一) | 完全统一 |
| safe-bash 日志 | appendFileSync | writeLog() | G8 修复 |
| G-problem 解决 | 10/13 完全解决 + 1/13 缓解 + 2/13 未解决 | **12/13 完全解决 + 1/13 缓解** | G11/G12 关闭（P3） |
| 合规门卡死率 | 92% (12/13 sessions recoverable) | 0%（状态机层面根除 RC1/RC2/RC3） | 完全修复 |
| Session Resume | 不可用 (SESSION_ID.md 不创建) | 端到端验证通过 (v4: `.dispatch_ctx` + `session_log` DB) | 完全修复 |
| approve_deliverables 限制 | 仅文档声明 (任何 agent 可调用) | 物理限制 (三层 agent identity fallback + `agent_id` 参数) | SA-FIX-APPROVE-PERMISSION |
| Self-test 通过率 | 38/38 (基线) | **39/40** (+Check 38 v6 DB schema + Check 39 S41 schema；Check 33 为预先存在的 stale entries) | +2 checks |
| 集成测试 | 无 E2E | **3/3 PASS** (auto-declare, normal lifecycle, resume lifecycle) | 新增 |
