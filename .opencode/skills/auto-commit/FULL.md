---
skill_name: auto-commit
display_name: 自动提交助手
category: P1-领域专业类
description: 在每次 Write/Edit 操作后，主动询问用户是否需要立即提交，并根据 machine.json 状态和 pre-commit hook 约束自动生成符合 TDD 规范的 commit message
trigger_keywords:
  - Write
  - Edit
  - 文件修改
  - 提交
  - commit
  - git commit
  - TDD提交
  - 状态转换
use_cases:
  - 文件修改后交互式提交
  - TDD 状态感知的 commit message 生成
  - 证据链前置校验（模拟 pre-commit hook）
  - 非法提交拦截（Red 阶段非测试文件、证据文件缺失等）
priority: P1
core_features:
  - 文件修改检测与提示
  - TDD 状态感知的 commit message 生成
  - 证据链前置校验（machine.json + pre-commit hook 规则）
  - 交互式提交确认
  - 负向测试拦截（非法状态转换、证据文件缺失等）
always_first: false
status: active
added_date: 2026-04-21
added_by: system
---

# Auto-Commit Skill

## 触发条件

当用户完成 Write 或 Edit 操作后，或用户明确要求提交时，触发此 Skill。

## 核心工作流

### 步骤 1：检测工作区状态 `[ANALYSIS]`

```bash
git status --porcelain
```

分析修改的文件列表和类型，生成变更摘要。

### 步骤 2：读取 machine.json 状态 `[ANALYSIS]`

```bash
jq '.currentTask' .opencode/state/machine.json
```

获取：
- `currentTask.id`：当前任务 ID
- `currentTask.status`：当前 TDD 阶段（Red/Green/Refactor/Testing/Review）
- `currentTask.owner`：负责 Agent

### 步骤 3：生成 Commit Message `[ANALYSIS]`

根据 TDD 阶段生成符合 pre-commit hook 阶段 3 要求的 commit message：

```
[{TDD_Phase}] {task_id}: {summary}

{detailed_description}

Changed files:
- {file1} (+{lines}/-{lines})
- {file2} (+{lines}/-{lines})
```

**TDD_Phase 标记规则**：

| 状态转换 | 标记 | 允许提交的文件类型 |
|---------|------|------------------|
| InProgress→Red | `[Red]` | 仅测试文件（`.spec.ts`、`.test.ts`） |
| Red→Green | `[Green]` | 测试文件 + 实现文件 |
| Green→Refactor | `[Refactor]` | 重构的实现文件 |
| Refactor→Testing | `[Testing]` | 测试文件 + 配置 |
| Testing→Review | `[Review]` | 所有文件 |
| Review→Done | `[Done]` | 所有文件 |

**Summary 生成规则**：
1. 使用 `git diff --stat` 分析修改的文件列表
2. 使用 `git diff --no-color` 提取关键变更摘要
3. 结合修改内容，生成 1-2 句描述性摘要

### 步骤 4：前置证据链校验（模拟 pre-commit hook 阶段 2） `[ANALYSIS]`

> **重要区分**：本步骤是「模拟」hook 的校验逻辑，属于 `[ANALYSIS]`，不是 `[VERIFICATION]`。
> 读取证据文件并判断其内容，不等于真实 hook 的运行态校验。只有步骤 7 的真实 `git commit` + hook 执行才是 `[VERIFICATION]`。
> **合理化检测**：如果你发现自己在想「模拟校验通过了，提交肯定没问题」--停下来，模拟通过 ≠ 真实 hook 通过。

**关键**：在提交前验证证据文件，避免提交被 hook 拒绝。

校验规则：

```
IF 状态转换 == "InProgress→Red":
  检查: tasks/{taskId}/TASK_LOG.md
  验证: 文件存在

IF 状态转换 == "Red→Green":
  检查: tasks/{taskId}/red_report.json
  验证: execution_evidence.exit_code ≠ 0
  验证: 符合 machine.json 中定义的 JSON Schema

IF 状态转换 == "Green→Refactor":
  检查: tasks/{taskId}/green_report.json
  验证: execution_evidence.exit_code = 0
  验证: coverage.lines ≥ 70

IF 状态转换 == "Refactor→Testing":
  检查: tasks/{taskId}/refactor_report.json
  验证: execution_evidence.exit_code = 0

IF 状态转换 == "Testing→Review":
  检查: tasks/{taskId}/test_report.json
  验证: execution_evidence.exit_code = 0

IF 状态转换 == "Review→Done":
  检查: tasks/{taskId}/guardian_report.md
  验证: 包含 "PASS"
  验证: 不包含 "FAIL"
```

**校验失败处理**：
- 拦截提交
- 显示详细错误信息
- 提示用户如何修复

### 步骤 5：Red 阶段文件类型校验（模拟 pre-commit hook 阶段 3） `[ANALYSIS]`

> 同步骤 4，本步骤是模拟校验，属于 `[ANALYSIS]`。

```
IF 当前状态 == "Red" OR 目标状态 == "Red":
  检查: 是否包含非测试文件
  IF 包含:
    拦截提交
    显示: "Red 状态下只允许提交测试文件"
    列出: 非测试文件列表
```

测试文件模式：`*.{spec,test}.{ts,js}`

### 步骤 6：用户交互确认

向用户展示：

```markdown
## 📦 Git 提交确认

**当前任务**: {task_id}
**TDD 阶段**: {old_status} → {new_status}
**Commit Message**:
```
[{stage}] {task_id}: {summary}

{description}
```

**修改文件**:
- {file1} (+{lines}/-{lines})
- {file2} (+{lines}/-{lines})

**证据链校验**: ✅ 通过 / ❌ 失败（详情）
**文件类型校验**: ✅ 通过 / ❌ 失败（详情）

是否立即提交？ [Y/n]
```

### 步骤 7：执行提交（用户确认后） `[VERIFICATION]`

> **本步骤是唯一的 `[VERIFICATION]`**--真实 `git commit` + pre-commit hook 执行。
> 模拟校验（步骤 4-5）通过不保证本步骤通过。hook 可能有模拟未覆盖的校验规则。
> 执行后必须记录 `Verified-by: git commit 输出 + hook 执行结果（通过/拒绝）`。

```bash
git add {files}
git commit -m "{commit_message}"
```

### 步骤 8：提交后处理

- **提交成功**：提示用户 pre-commit hook 已执行校验
- **提交失败**：显示 hook 拒绝原因，提供修复建议

## 与 Pre-commit Hook 的协同

| 组件 | 职责 | 时机 |
|-----|------|------|
| **Auto-Commit Skill** | 前置校验 + 交互式提交 | `git commit` 之前 |
| **Pre-commit Hook** | 最终校验 + 强制拦截 | `git commit` 执行时 |

**设计原则**：
- Skill 负责**提前拦截**，减少提交被 hook 拒绝的概率
- Hook 负责**最终验证**，确保合规性
- 两者校验规则**保持一致**，避免冲突

## 错误处理

| 错误类型 | 处理方式 | 用户提示 |
|---------|---------|---------|
| 证据文件缺失 | 拦截提交 | "证据文件缺失：{file}" |
| 证据文件不符合 Schema | 拦截提交 | "证据文件不符合 Schema 要求" |
| 非法状态转换 | 拦截提交 | "非法状态转换：{old} → {new}" |
| Red 阶段非测试文件 | 拦截提交 | "Red 状态下只允许提交测试文件" |
| Commit message 格式错误 | 自动修复 | "已自动修复 commit message 格式" |
| machine.json Schema 错误 | 拦截提交 | "machine.json 不符合 Schema 定义" |
| 契约哈希不匹配 | 提示修复 | "请运行 npm run keystone:hash 更新哈希" |

## 验收标准

- [ ] Commit message 符合 pre-commit hook 阶段 3 要求
- [ ] 证据文件前置校验通过
- [ ] Red 阶段文件类型限制生效
- [ ] 非法状态转换拦截生效
- [ ] 用户交互体验友好
- [ ] 所有错误提示清晰准确

## 相关文件

- `.opencode/state/machine.json` - 任务状态机定义
- `.opencode/hooks/pre-commit` - Pre-commit Hook 校验逻辑
- `.opencode/rules/rule_detail/skill-invocation-standard.md` - Skill 注册规范
- `assets/commit-template.md` - Commit Message 模板
