# 框架架构优化执行优先级分析

**日期**: 2026-06-17
**来源**: framework-evaluation-report.md §1-§2 + framework-architecture-optimization-proposal.md
**方法**: 源码逐文件验证 + 依赖分析
**状态**: Analysis complete

---

## 一、§1 Layout Architecture System — 代码验证

### 问题验证矩阵

| 问题 | 报告描述 | 代码验证 | 修正 |
|------|---------|---------|------|
| **L-1 路径解析脆弱** | "pre-commit hook 前34行全是路径 fallback 逻辑" | `hook-layers.ts:42-54` 仅13行路径解析，`getProjectRoot()` 仅2行 (`OPENCODE_ROOT env > cwd`)。实际 fallback 仅2处（L50 `|| '.'` 和 L52 catch fallback） | **"34行"严重夸大**，实际为13行/2处 fallback。P4-E 分类正确（低优先级美化项） |
| **L-2 配置职责模糊** | "两套权限定义的优先级和合并逻辑不透明" | **479行权限定义跨两文件**：opencode.json 301行（safe_edit/safe_delete/safe_mkdir × 10 agents）+ project.config.json 178行（agent_write_scopes）。重叠覆盖全部10个 agent | **完全确认**。Meta-Planner 8/12 路径重叠，其余 agent 同样 |
| **L-4 authority 声明矛盾** | "framework-authorities.json 声明 opencode.json 为 ADAPTER，但实际包含完整权限矩阵" | `framework-authorities.json` 声明 `"ADAPTER — it reflects/mirrors"`，但 opencode.json 定义**独立权限规则**（safe_edit/safe_shell），OpenCode runtime 直接读取作为权威源 | **完全确认**。声明与实际行为矛盾 |
| **L-3 代码与状态混存** | ".opencode/ 既是源码又是运行时状态" | `.gitignore` 135行已能区分；物理拆分是破坏性重构 | **确认但不推荐修复**（P5-A 正确否决） |

### 关键发现：权限执行层分裂

代码验证揭示评估报告未显式标注的结构问题——**同一权限数据在4个不同执行层以4种格式表达**：

| 执行层 | 配置源 | 消费者 | 功能 |
|--------|--------|--------|------|
| **写入路径阻断** | project.config.json `agent_write_scopes` | gate-checks.ts, scope-before.ts, code-quality-gate.ts | 物理阻止 agent 写入越权路径 |
| **派遣路由过滤** | opencode.json `permission.safe_edit` | route-validator.ts, dispatch-before.ts, gate-before.ts, dispatch-subagent.ts | L3 过滤候选 agent 的写权限 |
| **Shell 命令权限** | project.config.json `safe_shell` | safe-bash-core.ts | 命令 allowlist 执行 |
| **OpenCode runtime** | opencode.json `permission.*` | OpenCode CLI 引擎 | 上游原生权限强制 |

---

## 二、§2 Permission Matrix System — 代码验证

### 问题验证矩阵

| 问题 | 报告描述 | 代码验证 | 修正 |
|------|---------|---------|------|
| **P-1 维护成本高** | "10 agent × 50-80 行权限配置 = 500-800 行" | **479行**（opencode.json 301行 + project.config.json 178行）。每个 agent scope 重复3-4次（safe_edit + safe_delete + safe_mkdir + agent_write_scopes） | **确认，量化精确** |
| **P-4 双配置源** | "opencode.json 和 project.config.json 各有一套权限定义" | 210+ 路径规则 + 290+ 命令规则跨两文件重复。safe-bash-core.ts 读 project.config.json，route-validator 读 opencode.json | **完全确认**。执行层分裂使问题更深 |
| **P-3 scope 越界** | "WAIVE.md 记录了 scope 越界是常见故障" | WAIVE.md WV-2026-010 文档：@Coder-BE 写入 `.opencode/scripts/__tests__/`（denied glob `.opencode/scripts/**` 过宽），需要 Arbiter 裁决 | **确认真实运维痛点** |
| **P-2 粒度不一致** | "部分 agent 使用 `*` 通配符" | opencode.json 中 Super-Admin `".opencode/**": "allow"` vs Coder-BE 精细路径列表 | **确认但低 ROI**（安全边界由 safe_edit 物理保证） |

### P2-D 工时修正

评估报告预估 P2-D 为 **4h**。代码验证显示5个消费者需迁移 + 格式适配器，修正为 **6h**。

| 消费者 | 当前读 | 需改为读 | 修改量 |
|--------|--------|---------|--------|
| safe-bash-core.ts:74-88 | project.config.json `safe_shell` | opencode.json `agent.*.permission.safe_shell` | 重写 `_loadSafeShellConfig()` |
| gate-checks.ts:158 | project.config.json `agent_write_scopes` | opencode.json `agent.*.permission.safe_edit` | 重写 `isWriteAllowed()` |
| scope-before.ts:165 | 通过 `isWriteAllowed()` 间接 | 同上 | 仅消息文本修改 |
| code-quality-gate.ts:615-642 | project.config.json `agent_write_scopes` | opencode.json `agent.*.permission.safe_edit` | 重写 scope 检查 |
| framework-self-test.ts:190-202 | project.config.json `agent_write_scopes` | opencode.json `agent.*.permission.safe_edit` | 适配验证检查 |

格式差异：opencode.json 用 `{path: "allow"/"deny"}` map，project.config.json 用 `{allowed: [...], denied: [...]}` 数组。需统一解析层。

---

## 三、优化提案执行优先级分析

### 提案独立性声明 vs 代码验证的实际依赖

| Phase | 提案声称 | 实际依赖 | 证据 |
|-------|---------|---------|------|
| A1 Orchestrator 拆分 | 独立 | **真独立** | 调度/approve 逻辑不涉及权限配置 |
| A2 Planner-Architect 合并 | 独立 | **弱依赖 P2-D** | 合并权限矩阵时需统一源，可临时手动合并 |
| A3 Coder 参数化合并 | 独立 | **强依赖 P3-E** | 参数化 Coder 需要 BE/FE 权限模板区分，模板必须基于单一权威源 |
| A4 KC 简化 | 独立 | **依赖 P2-D** | KC scope 简化需要统一权限源 |
| B1-B4 DAG 简化 | 独立 | **真独立** | 数据结构问题，不涉及权限 |
| C1 钩子矩阵 | 独立 | **真独立** | 纯分析无代码变更 |
| C2 UC7KS 精简 | 独立 | **弱依赖 P2-D** | 管道合并需理解权限流 |
| C3 state 合并 | 独立 | **真独立** | DB/JSON 层面，不涉及权限 |
| P3-E 权限模板 | (评估报告定义) | **强依赖 P2-D** | 双源上实现模板会跨配置漂移 |

### 推荐执行优先级（代码驱动排序）

```
优先级 1 ─── P2-D (权限源反转统一) — 6h
           │  关闭 3 个问题 (L-2 + L-4 + P-4)
           │  解锁 P3-E → Phase A3 → Phase C2
           │  上游约束：opencode.json 必须为权威源
           │  5 个消费者需迁移 + 格式适配器
           │
优先级 2 ─── Phase 0 (基线测量) — 1-2 周
           │  所有后续 Phase 的前置条件
           │  采集 per-task 端到端指标
           │
优先级 3 ─── Phase C1 (钩子矩阵) — 4h [可与 P2-D 并行]
           │  纯分析，无代码变更
           │
优先级 3 ─── Phase B1-B2 (DAG 存储) — 3h [可与 P2-D 并行]
           │  真独立，立即降 token 成本
           │
优先级 4 ─── Phase A1 (Orchestrator 拆分) — 6h
           │  真独立，但风险最高（approve LLM 工程）
           │  建议在 P2-D 完成后推进（避免并行变更冲突）
           │
优先级 5 ─── P3-E (权限模板) — 6h
           │  直接依赖 P2-D
           │  解锁 Phase A3 (Coder 参数化)
           │  解决 P-3 (scope 越界 WAIVE.md 痛点)
           │
优先级 6 ─── Phase A2 (Planner-Architect) — 8h
           │  弱依赖 P2-D（权限合并可手动处理）
           │
优先级 7 ─── Phase A3 (Coder 合并) — 6h + A/B 实测
           │  强依赖 P3-E
           │  最高风险：建议先 A/B 实测再决定
           │
优先级 8 ─── Phase A4 + C2 (Agent 简化 + UC7KS) — 6h
           │  P2-D 依赖（KC scope 统一）
           │
优先级 9 ─── Phase B3-B4 + C3 — 9h
           │  清理/评估，低优先级
           │
优先级 10 ── Phase A5 (文档清理) — 2h
```

### 关键决策点

1. **P2-D 必须最先推进** — §1+§2 共同根因，解锁最多下游 Phase（4个）。6h 修正预估仍为最高 ROI 单项。

2. **Phase A3 (Coder 合并) 不应过早推进** — BE/FE 生态差异超出模板变量覆盖范围。3+3 A/B 实测是必要前置条件。

3. **提案时间线修正** — P2-D 4h→6h；Phase 0 基线测量为必要前置；P2-D 完成前 Phase A3/C2 无法推进。修正总工时约 **42h over 7周**（原36h/6周）。

4. **P4-E (路径硬化) 和 P5-A (物理拆分) 正确否决** — 路径解析实际仅13行/2处 fallback，远非"34行"所暗示的严重程度。`.gitignore` 已足够区分源码与状态。

---

## 四、上游约束验证（OpenCode 官方文档）

P2-D 的权威方向反转基于以下上游约束（评估报告 §1/§2 已验证）：

1. `{env:VAR}` / `{file:path}` 仅做字符串替换，无法注入 JSON object/array（config.md:633-662）
2. `project.config.json` 不在上游 8 个预设 config 位置中（config.md:40-48），上游权限引擎完全读不到
3. 移除 `safe_edit`/`safe_shell` 等自定义工具权限块会让上游回落到 permissive defaults（permissions.md:100-103）

**结论**: opencode.json 必须保留为所有权限数据的唯一权威源。P2-D 操作方向：opencode.json **不瘦身**，project.config.json **删除冗余定义**。
