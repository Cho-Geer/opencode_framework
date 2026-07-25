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

# auto-commit

在每次 Write/Edit 操作后，主动询问用户是否需要立即提交，并根据 machine.json 状态和 pre-commit hook 约束自动生成符合 TDD 规范的 commit message

**触发条件**: trigger_keywords:

> 完整文档: 使用 read 工具读取 .opencode/skills/auto-commit/FULL.md
