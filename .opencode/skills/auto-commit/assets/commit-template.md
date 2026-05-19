# Commit Message 模板

本模板定义了符合 pre-commit hook 阶段 3 要求的 commit message 格式。

## 标准格式

```
[{TDD_Phase}] {task_id}: {summary}

{detailed_description}

Changed files:
- {file1} (+{lines}/-{lines})
- {file2} (+{lines}/-{lines})
```

## TDD_Phase 标记

| 标记 | 阶段 | 说明 |
|------|------|------|
| `[Red]` | RED 阶段 | 编写失败的测试用例 |
| `[Green]` | GREEN 阶段 | 实现最简代码通过测试 |
| `[Refactor]` | REFACTOR 阶段 | 重构代码保持测试通过 |
| `[Testing]` | Testing 阶段 | 执行集成/E2E 测试 |
| `[Review]` | Review 阶段 | 代码审查通过 |
| `[Done]` | Done 阶段 | 任务完成 |

## 示例

### Red 阶段示例

```
[Red] TASK-001: 编写 {feature} 创建单元测试

- 创建 {FeatureService} 单元测试
- 测试用例：创建 {entity} 成功场景
- 测试用例：{conflict_scenario} 冲突场景
- 测试用例：{dependency} 不存在场景

Changed files:
- {backend_src_dir}/modules/{module}/{module}.service.spec.ts (+150/-0)
```

### Green 阶段示例

```
[Green] TASK-001: 实现 {feature} 创建服务逻辑

- 实现 {FeatureService}.create() 方法
- 添加 {conflict_detection} 冲突检测
- 添加 {dependency} 存在性验证
- 使用 prisma.$transaction() 管理事务

Changed files:
- {backend_src_dir}/modules/{module}/{module}.service.ts (+85/-10)
- {backend_src_dir}/modules/{module}/dto/create-{entity}.dto.ts (+25/-0)
- {backend_src_dir}/modules/{module}/{module}.service.spec.ts (+20/-5)
```

### Refactor 阶段示例

```
[Refactor] TASK-001: 优化 {feature} 服务事务管理

- 提取事务边界到独立方法
- 优化错误处理逻辑
- 简化 {conflict_detection} 冲突检测算法

Changed files:
- {backend_src_dir}/modules/{module}/{module}.service.ts (+30/-45)
```

## 注意事项

1. **Red 阶段**：只允许提交测试文件（`.spec.ts`、`.test.ts`）
2. **Green 阶段**：必须存在 `red_report.json` 证据文件
3. **Refactor 阶段**：必须存在 `green_report.json` 证据文件且覆盖率 ≥ 70%
4. **Testing 阶段**：必须存在 `refactor_report.json` 证据文件
5. **Review 阶段**：必须存在 `test_report.json` 证据文件
6. **Done 阶段**：必须存在 `guardian_report.md` 且包含 "PASS"

## 自动生成规则

- **task_id**：从 `.opencode/state/machine.json` 的 `currentTask.id` 获取
- **summary**：基于 `git diff --stat` 分析生成
- **detailed_description**：基于 `git diff --no-color` 提取关键变更
- **Changed files**：基于 `git diff --cached --stat` 生成
