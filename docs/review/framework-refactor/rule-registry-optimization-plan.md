# Rule Registry 优化方案：SHA-256 Digest → git diff + [INFRA] 标记

**日期：** 2026-06-15
**关联文档：** `framework-evaluation-report.md` §4d
**优先级：** P2
**状态：** ✅ 已完成 (2026-06-15)

---

## 一、现状分析

### 当前实现

Rule Registry（`rule_registry.json`，1219行）追踪 31 个文件条目：
- 每个条目记录 `semver` + `SHA-256` 内容摘要 + `digest_history`
- 验证在两个时点触发：
  - `pre-execution-gate.ts` Check #5（每次 agent dispatch 前）
  - `pre-commit hook` Layer 1.5（每次 git commit 前）
- 验证方式：读取文件当前磁盘内容 → 计算 SHA-256 → 与 registry 中存储的摘要比对

### 核心问题

**1. 自引用循环**

registry 试图用"手动注册"机制追踪"自然发生"的文件变更：
- Agent 修改文件 → 忘记更新 registry → digest 不匹配 → repair session
- 人类修改文件 → 几乎从不更新 registry → digest 不匹配 → commit 被阻断

"不同步"这个故障模式是 registry 自身引入的——如果没有 registry，就不存在"不同步"的问题。

**2. 自动更新 digest 等同于取消审计**

如果可以自动修复 digest，检查将永远 pass，审计约束失效。审计的价值恰恰在于检测"变更发生了但没有被正式记录"。自动更新使所有变更"自动被记录"，消除了审计的检测目标。

**3. 人类和 Agent 都会直接修改文件**

- `pre-execution-gate.ts` 仅在 agent dispatch 时触发，人类直接修改文件不会被检查
- `pre-commit hook` Layer 1.5 是人类操作的唯一前置检查点，不可简化
- 两个检查点的验证逻辑一致（`computeSHA256(fileContent) === registry.stored_digest`），但触发上下文不同

**4. repair 工具存在死代码**

`rule_registry_repair.ts` 中 semver 检查的 `if (!force ...)` 分支体为空，semver 递增实际无条件执行。

### 设计目标（保留什么）

| 目标 | 说明 |
|------|------|
| 关键文件变更感知 | 在 commit 前和 dispatch 前检测到关键基础设施文件被修改 |
| 前置检测时机 | 不仅在 commit 时检测，更在 agent dispatch 时检测（多天不 commit 是常态） |
| 人类操作覆盖 | 人类直接修改文件时也能被检测到 |
| enforcement mode 控制 | advisory/strict/locked 三级模式控制检测行为 |

---

## 二、优化方案

### 核心思路

**触发机制不变**（dispatch 前 + commit 前），**检测手段从 SHA-256 对比 registry 替换为 git diff 对比 HEAD**。

```
当前方案：
  文件内容 → SHA-256 → 对比 rule_registry.json 中存储的摘要
  问题：registry 需要手动维护，人和 Agent 都经常忘记

替代方案：
  git diff HEAD --name-only -- <critical_files>
  对比基准：HEAD（最后一次 commit 时的文件状态）
  无需维护任何注册表
```

### 为什么 git diff 满足时机要求

`git diff` 不依赖 commit 才能工作——它比较的是工作目录与 HEAD 的差异：

| 时点 | 命令 | 检测能力 |
|------|------|---------|
| Agent dispatch 前 | `git diff HEAD --name-only -- <file>` | 自上次 commit 以来，该文件是否有未提交的变更 |
| Commit 前 | `git diff --cached --name-only -- <file>` | 即将 commit 的变更中是否包含关键文件 |
| 多天未 commit | `git diff HEAD --name-only` | 所有累积的未提交变更中的关键文件 |

**多天未 commit 的场景：**

```
Day 1: Agent 修改了 common-project.md
Day 3: Agent 修改了 skill-compliance-guide.md
Day 5: 人类修改了 common-project.md
Day 7: Agent dispatch → git diff HEAD --name-only
        → 检测到 common-project.md, skill-compliance-guide.md 有变更 ✅

Day 8: 人类 git commit → git diff --cached --name-only
        → 检测到关键文件在 staged changes 中 ✅
```

### 唯一盲区（可接受）

变更被直接包含在 commit 中，且 commit 后没有进一步修改：

```
commit A: common-project.md 内容为 "version 1"
commit B: common-project.md 改为 "version 2"（在该 commit 中修改并提交）
Agent dispatch → git diff HEAD → 无变更（HEAD 就是 commit B）
```

这不是问题——commit 本身就是一个审查点（commit message、hook、PR review），已提交的变更已通过 commit 流程审查。

### 两层检查链路

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: Dispatch 前检测（pre-execution-gate.ts Check #5）     │
│                                                                   │
│  git diff HEAD --name-only -- <critical_files>                   │
│                                                                   │
│  有变更？                                                         │
│    advisory → 警告，允许继续                                      │
│    strict   → 提醒，记录审计日志                                  │
│    locked   → 阻断 dispatch，要求先处理                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                        [开发继续进行]
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Commit 时强制标记（commit-msg hook）                   │
│                                                                   │
│  git diff --cached --name-only -- <critical_files>               │
│                                                                   │
│  staged 中包含关键文件？                                          │
│    YES → commit message 必须包含 [INFRA] 标记                    │
│          无 [INFRA] → exit 1 ❌                                  │
│          有 [INFRA] → pass ✅                                    │
│    NO  → 正常通过                                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、`[INFRA]` Commit 标记

### 设计

当 staged files 包含 `critical_files` 中的文件时，commit message 必须包含 `[INFRA]` 标记，确认操作者知晓关键基础设施文件被修改。

### 与现有 TDD 标记的兼容性

一个 commit 可以同时携带多个标记：

```bash
# 仅修改业务代码
git commit -m "[Green] SA-BAK-CLEANUP-003 implement backup cleanup"

# 仅修改框架文件
git commit -m "[INFRA] update common-project.md with new rule"

# 同时修改业务代码和框架文件
git commit -m "[Green][INFRA] FW-UNIFY-TS add framework rule and update agent"

# Refactor 阶段修改了框架文件
git commit -m "[Refactor][INFRA] simplify pre-commit hook structure"
```

### 实现位置

全部逻辑放在 `commit-msg` hook 中，无需 pre-commit 和 commit-msg 之间的状态传递：

```bash
# commit-msg hook（追加到现有 TDD 检查之后）

# 关键文件清单（从 project.config.json 或独立配置文件加载）
CRITICAL_FILES=(
  ".opencode/rules/common-project.md"
  ".opencode/rules/mcp-compliance-guide.md"
  ".opencode/rules/skill-compliance-guide.md"
  ".opencode/agents/Meta-Planner.md"
  ".opencode/agents/Orchestrator.md"
  ".opencode/agents/Coder-BE.md"
  ".opencode/agents/Coder-FE.md"
  ".opencode/agents/Guardian.md"
  ".opencode/agents/Arbiter.md"
  ".opencode/agents/CI-CD-Agent.md"
  ".opencode/agents/Super-Admin.md"
  ".opencode/agents/Knowledge-Curator.md"
  ".opencode/agents/Architect.md"
  ".opencode/project.config.json"
  ".opencode/lib/gate-core.ts"
  ".opencode/lib/dag-policy.ts"
  ".opencode/lib/permission-isolation-core.ts"
  ".opencode/tools/dispatch_subagent.ts"
  ".opencode/hooks/pre-commit"
  ".opencode/hooks/commit-msg"
  "opencode.json"
  "AGENTS.md"
)

# 获取 staged 文件
STAGED=$(git diff --cached --name-only)

# 检查是否有交集
INFRA_MATCH=false
MATCHED_FILES=()
for staged_file in $STAGED; do
  for critical in "${CRITICAL_FILES[@]}"; do
    if [[ "$staged_file" == "$critical" ]]; then
      INFRA_MATCH=true
      MATCHED_FILES+=("$staged_file")
      break
    fi
  done
done

# 如果有交集，要求 commit message 包含 [INFRA]
if $INFRA_MATCH; then
  COMMIT_MSG=$(cat "$1")
  if [[ ! "$COMMIT_MSG" =~ \[INFRA\] ]]; then
    echo "═══════════════════════════════════════════════════════"
    echo "[FW-ENFORCE][INFRA] Critical infrastructure files in this commit:"
    for f in "${MATCHED_FILES[@]}"; do
      echo "  - $f"
    done
    echo ""
    echo "Commit message must include [INFRA] marker to confirm"
    echo "intentional change to infrastructure files."
    echo ""
    echo "Example: git commit -m \"[Green][INFRA] update agent permissions\""
    echo "═══════════════════════════════════════════════════════"
    exit 1
  fi
fi
```

### Enforcement Mode 控制

| Mode | Dispatch 前（Layer 1）| Commit 时（Layer 2）|
|------|---------------------|-------------------|
| advisory | 警告，允许 dispatch | 不要求 `[INFRA]`，仅提醒 |
| strict | 提醒，记录日志 | 要求 `[INFRA]`，无标记则阻断 |
| locked | 阻断 dispatch | 要求 `[INFRA]`，无标记则阻断 |

---

## 四、保留与移除清单

### 保留

| 组件 | 说明 |
|------|------|
| 关键文件清单 | 提取为独立配置（`critical_files` 数组），可存放在 `project.config.json` 或独立文件 |
| `pre-execution-gate.ts` Check #5 | 替换内部实现为 `git diff HEAD --name-only`，外部接口不变 |
| `pre-commit hook` Layer 1.5 | 替换内部实现为 `git diff --cached --name-only`，外部接口不变 |
| `commit-msg hook` | 追加 `[INFRA]` 标记检查 |
| Enforcement Mode 控制 | advisory/strict/locked 三级控制 |

### 移除

| 组件 | 原因 |
|------|------|
| `rule_registry.json` 中的 SHA-256 摘要存储 | 被 git diff 替代 |
| `digest_history` 追加记录 | 不再需要摘要历史 |
| `rule_registry_repair.ts` | 不再需要 digest 修复 |
| `rule-registry-verify.ts` | 不再需要 digest 验证 |
| `pre-commit hook` Layer 1.5 中的 SHA-256 计算逻辑 | 替换为 git diff |
| `pre-execution-gate.ts` Check #5 中的 SHA-256 计算逻辑 | 替换为 git diff |
| semver 版本递增逻辑 | 不再与 digest 关联 |

### 简化

| 组件 | 变更 |
|------|------|
| `rule_registry.json` | 可保留为纯规则清单（仅记录路径和描述），移除 sha256/digest_history/semver 字段 |
| `pre-execution-gate.ts` | Check #5 从 SHA-256 比对简化为 `git diff` 命令，代码量显著减少 |

---

## 五、语义变化对比

| 维度 | SHA-256 Registry | git diff + [INFRA] |
|------|-----------------|-------------------|
| **基准** | registry 中存储的固定摘要（需手动更新） | HEAD（自动随 commit 更新） |
| **检测含义** | "文件与上次注册时不同" | "文件与上次 commit 时不同" |
| **维护成本** | 高（每次修改需手动更新 registry） | 零（git 自动维护 HEAD） |
| **自引用循环** | 有（registry 本身也需要维护） | 无（基准由 git 自动管理） |
| **人类操作覆盖** | Layer 1.5（commit 前） | Layer 1.5 + `[INFRA]` 标记（commit 时） |
| **Agent dispatch 前检测** | SHA-256 比对 | git diff HEAD（同一时机，不同手段） |
| **自动修复风险** | 有（自动更新 digest 使审计失效） | 无（HEAD 仅在 commit 时更新） |
| **盲区** | 无（只要内容变了就能检测） | 已包含在 commit 中的变更无法回溯（可接受） |
| **审计追踪** | digest_history 记录变更 | git log 天然记录变更历史 |

---

## 六、需要修改的文件

| 文件 | 修改内容 |
|------|---------|
| `.opencode/scripts/pre-execution-gate.ts` | Check #5：SHA-256 比对 → `git diff HEAD --name-only` |
| `.opencode/hooks/pre-commit` | Layer 1.5：SHA-256 计算 → `git diff --cached --name-only` |
| `.opencode/hooks/commit-msg` | 追加 `[INFRA]` 标记检查逻辑 |
| `.opencode/project.config.json` | 新增 `critical_files` 数组（从 registry 的 critical_files 列表迁移） |
| `.opencode/state/rule_registry.json` | 简化为纯规则清单，移除 sha256/digest_history/semver |
| `.opencode/tools/rule_registry_repair.ts` | 移除（或简化为仅处理规则清单的增删） |
| `.opencode/scripts/rule-registry-verify.ts` | 移除 digest 验证逻辑 |
